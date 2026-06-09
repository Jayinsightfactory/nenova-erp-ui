// pages/api/shipment/estimate-period-repair.js
//  엑셀 업로드/분배 경로에서 잘못 저장된 두 가지 견적 누락·금액오류를 차수 단위로 진단·보정한다.
//
//  ① 출고일 시각 불일치 (견적서 "표시 안 됨")
//     - ShipmentDate.ShipmentDtm 이 03:00 등으로 저장돼 PeriodDay.BaseYmd(자정) 와 정확매칭 실패.
//     - 견적 GetDetail 의 `sdd.ShipmentDtm = pd.BaseYmd` INNER JOIN 에서 탈락 → 견적서 누락.
//     - 보정: ShipmentDetail/ShipmentDate 의 ShipmentDtm 을 같은 날짜의 PeriodDay.BaseYmd 와 정확히 일치시킴.
//       (OutQuantity/재고 미변경 → 확정 차수에도 안전)
//
//  ② EstQuantity 환산 오류 (견적 "합계 틀림")
//     - 단(bunch) 단위 품목인데 업로드 버그로 EstQuantity 가 OutQuantity 의 10배로 부풀려짐(장미/알스트로).
//     - 보정: 단 품목의 EstQuantity 를 OutQuantity 로 되돌리고 Amount/Vat 재산출.
//       박스 품목은 박스당 단수가 마스터에 신뢰성 있게 없어(수국=null) SQL 로 기대값 재현이 불가 →
//       자동 보정에서 제외(현재값 유지). 박스 누락의 진짜 원인은 ① 출고일 불일치이며 fixDate 가 처리.
//
//  GET  ?week=23-01[&weeks=23-01,23-02][&q=검색어]   → 진단(읽기 전용, 변경 없음)
//  POST { week|weeks, action:'fix', fixDate=true, fixEst=false }
import { withAuth } from '../../../lib/auth';
import { withTransaction, query, sql } from '../../../lib/db';
import { withActionLog } from '../../../lib/withActionLog';
import { normalizeOrderWeek } from '../../../lib/orderUtils';

// 전산(nenova.exe) 규약: EstQuantity 는 "단(bunch) 환산수량".
//  - 단 품목: Est = OutQuantity (입력이 이미 단). 과거 업로드 버그만 Out×10 으로 부풀림 → 이것만 보정.
//  - 박스 품목: Est = OutQuantity × (박스당 단수). 그러나 박스당 단수가 Product.BunchOf1Box 에
//    신뢰성 있게 들어있지 않다(예: 수국은 0/null 이지만 실제 1박스=30단, 카네이션은 15 로 채워짐).
//    → 박스 품목의 기대값을 SQL 만으로 정확히 재현할 수 없어, 자동 보정 대상에서 제외한다.
//      (박스 EstQuantity 는 현재값을 그대로 기대값으로 두어 절대 변경되지 않게 함. 수국 30→1 파괴 방지)
//      박스 품목이 견적서에서 빠지는 진짜 원인은 출고일 시각 불일치이며 그것은 fixDate 가 해결한다.
//  - 송이 등 기타 단위: 확증 데이터가 없어 보수적으로 현재값 유지(미보정).
// 결과적으로 EstBroken 으로 잡히는 것은 "단 품목인데 Est ≠ Out" 인 장미/알스트로 부풀림 행뿐이다.
const EXP_EST = (sd, p) => `CASE
  WHEN ISNULL(${p}.OutUnit, N'박스') = N'단' THEN ${sd}.OutQuantity
  ELSE ${sd}.EstQuantity END`;

function parseWeeks(req) {
  const raw = String(req.query?.weeks || req.query?.week || req.body?.weeks || req.body?.week || '');
  return raw.split(',').map(w => normalizeOrderWeek(w.trim())).filter(Boolean);
}

async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ success: false, error: 'GET/POST only' });
  }
  // 전수 점검: GET 에서만 week=all 허용(진단 전용). 보정(POST)은 안전을 위해 차수 명시 필수.
  const scanAll = req.method === 'GET'
    && (String(req.query?.all || '') === '1' || String(req.query?.week || req.query?.weeks || '').toLowerCase() === 'all');
  const weeks = scanAll ? [] : parseWeeks(req);
  if (!scanAll && weeks.length === 0) return res.status(400).json({ success: false, error: 'week 필요 (전수 점검은 GET ?all=1)' });
  const q = String(req.query?.q || req.body?.q || '').trim();

  const wkParams = {};
  weeks.forEach((w, i) => { wkParams[`w${i}`] = { type: sql.NVarChar, value: w }; });
  const wkIn = scanAll ? null : weeks.map((_, i) => `@w${i}`).join(',');
  const weekFilter = scanAll ? '1=1' : `sm.OrderWeek IN (${wkIn})`;
  const qFilter = q
    ? ` AND ( p.ProdName LIKE @q OR ISNULL(p.CounName,'') LIKE @q OR ISNULL(p.FlowerName,'') LIKE @q OR c.CustName LIKE @q )`
    : '';
  const baseParams = { ...wkParams };
  if (q) baseParams.q = { type: sql.NVarChar, value: `%${q}%` };

  try {
    if (req.method === 'GET') {
      // 깨진 행 판정 CTE (전 품목/전 차수 정확 집계 — TOP 제한 없음)
      const flaggedCte = `
        WITH flagged AS (
          SELECT sm.OrderWeek, p.ProdName, ISNULL(p.CounName,N'') AS CounName, ISNULL(p.FlowerName,N'') AS FlowerName,
                 c.CustName, p.OutUnit, sd.SdetailKey, ISNULL(sm.isFix,0) AS SmFix,
                 ISNULL(sd.OutQuantity,0) AS OutQuantity, ISNULL(sd.EstQuantity,0) AS EstQuantity,
                 ${EXP_EST('sd','p')} AS ExpEst,
                 CONVERT(NVARCHAR(30), sdt.ShipmentDtm, 121) AS DateDtm,
                 CONVERT(NVARCHAR(30), pm.BaseYmd, 121) AS PeriodBaseYmd,
                 CASE WHEN sdt.ShipmentDtm IS NOT NULL AND pm.BaseYmd IS NOT NULL
                           AND sdt.ShipmentDtm <> pm.BaseYmd THEN 1 ELSE 0 END AS DateBroken,
                 CASE WHEN ABS(ISNULL(sd.EstQuantity,0) - (${EXP_EST('sd','p')})) > 0.001 THEN 1 ELSE 0 END AS EstBroken
            FROM ShipmentMaster sm
            JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
            JOIN Product p ON p.ProdKey = sd.ProdKey
            JOIN Customer c ON c.CustKey = sm.CustKey
            OUTER APPLY (SELECT TOP 1 sdt0.ShipmentDtm FROM ShipmentDate sdt0 WHERE sdt0.SdetailKey = sd.SdetailKey) sdt
            OUTER APPLY (SELECT TOP 1 pd.BaseYmd FROM PeriodDay pd
                          WHERE CONVERT(date, pd.BaseYmd) = CONVERT(date, sdt.ShipmentDtm) ORDER BY pd.BaseYmd) pm
           WHERE ${weekFilter} AND ISNULL(sm.isDeleted,0)=0 AND ISNULL(sd.OutQuantity,0)<>0${qFilter}
        )`;

      // 1) 차수+품목별 집계 (깨진 것만)
      const agg = await query(
        `${flaggedCte}
         SELECT OrderWeek, ProdName, CounName, FlowerName,
                COUNT(*) AS TotalRows,
                SUM(DateBroken) AS DateBroken,
                SUM(EstBroken)  AS EstBroken,
                SUM(CASE WHEN (DateBroken=1 OR EstBroken=1) AND SmFix=1 THEN 1 ELSE 0 END) AS FixedBroken
           FROM flagged
          WHERE DateBroken=1 OR EstBroken=1
          GROUP BY OrderWeek, ProdName, CounName, FlowerName
          ORDER BY OrderWeek, ProdName`,
        baseParams
      );
      // 2) 상세 샘플 (깨진 행 TOP 200)
      const samp = await query(
        `${flaggedCte}
         SELECT TOP 200 OrderWeek, CustName, ProdName, CounName, OutUnit, SdetailKey, SmFix,
                OutQuantity, EstQuantity, ExpEst, DateDtm, PeriodBaseYmd, DateBroken, EstBroken
           FROM flagged
          WHERE DateBroken=1 OR EstBroken=1
          ORDER BY OrderWeek, ProdName, CustName`,
        baseParams
      );

      const byProduct = agg.recordset || [];
      const samples = samp.recordset || [];
      const dateMismatchCount = byProduct.reduce((a, x) => a + Number(x.DateBroken || 0), 0);
      const estMismatchCount = byProduct.reduce((a, x) => a + Number(x.EstBroken || 0), 0);
      const fixedWeekRowCount = byProduct.reduce((a, x) => a + Number(x.FixedBroken || 0), 0);
      // 차수별 롤업
      const weekMap = {};
      for (const x of byProduct) {
        const w = x.OrderWeek;
        weekMap[w] = weekMap[w] || { week: w, dateBroken: 0, estBroken: 0, products: 0 };
        weekMap[w].dateBroken += Number(x.DateBroken || 0);
        weekMap[w].estBroken += Number(x.EstBroken || 0);
        weekMap[w].products += 1;
      }
      return res.status(200).json({
        success: true, scope: scanAll ? 'all' : weeks, q: q || null,
        dateMismatchCount, estMismatchCount, fixedWeekRowCount,
        affectedWeeks: Object.values(weekMap),
        byProduct,
        dateSamples: samples.filter(x => Number(x.DateBroken) === 1).slice(0, 100),
        estSamples: samples.filter(x => Number(x.EstBroken) === 1).slice(0, 100),
        hint: '차수별로 POST { week, action:"fix", fixDate:true, fixEst:true } 보정. 전수 진단은 GET ?all=1.',
      });
    }

    // POST — 보정
    if (String(req.body?.action) !== 'fix') {
      return res.status(400).json({ success: false, error: 'action=fix 필요' });
    }
    const fixDate = req.body?.fixDate !== false; // 기본 true
    const fixEst = req.body?.fixEst === true || req.body?.fixEst === 'true'; // 기본 false

    const result = await withTransaction(async (tQ) => {
      let dateDetailUpdated = 0, dateDateUpdated = 0, estDetailUpdated = 0, estDateSynced = 0;

      if (fixDate) {
        // ShipmentDate.ShipmentDtm → 같은 날짜 PeriodDay.BaseYmd 정확값
        const d1 = await tQ(
          `UPDATE sdt SET sdt.ShipmentDtm = pm.BaseYmd
             FROM ShipmentDate sdt WITH (UPDLOCK, ROWLOCK)
             JOIN ShipmentDetail sd ON sd.SdetailKey = sdt.SdetailKey
             JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
             CROSS APPLY (SELECT TOP 1 pd.BaseYmd FROM PeriodDay pd
                           WHERE CONVERT(date, pd.BaseYmd) = CONVERT(date, sdt.ShipmentDtm) ORDER BY pd.BaseYmd) pm
            WHERE sm.OrderWeek IN (${wkIn}) AND ISNULL(sm.isDeleted,0)=0 AND ISNULL(sd.OutQuantity,0)<>0
              AND sdt.ShipmentDtm <> pm.BaseYmd`,
          wkParams
        );
        dateDateUpdated = d1.rowsAffected?.[0] || 0;
        // ShipmentDetail.ShipmentDtm 도 동일하게
        const d2 = await tQ(
          `UPDATE sd SET sd.ShipmentDtm = pm.BaseYmd
             FROM ShipmentDetail sd WITH (UPDLOCK, ROWLOCK)
             JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
             CROSS APPLY (SELECT TOP 1 pd.BaseYmd FROM PeriodDay pd
                           WHERE CONVERT(date, pd.BaseYmd) = CONVERT(date, sd.ShipmentDtm) ORDER BY pd.BaseYmd) pm
            WHERE sm.OrderWeek IN (${wkIn}) AND ISNULL(sm.isDeleted,0)=0 AND ISNULL(sd.OutQuantity,0)<>0
              AND sd.ShipmentDtm <> pm.BaseYmd`,
          wkParams
        );
        dateDetailUpdated = d2.rowsAffected?.[0] || 0;
      }

      if (fixEst) {
        // EstQuantity 를 OutUnit 기준으로 재계산 + Amount/Vat 재산출 (전산 정상행은 차이 0 이라 자동 제외)
        const e1 = await tQ(
          `UPDATE sd
              SET sd.EstQuantity = x.ExpEst,
                  sd.Amount = ROUND(ISNULL(NULLIF(sd.Cost,0),0) * x.ExpEst / 1.1, 0),
                  sd.Vat    = ROUND(ISNULL(NULLIF(sd.Cost,0),0) * x.ExpEst / 11, 0)
             FROM ShipmentDetail sd WITH (UPDLOCK, ROWLOCK)
             JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
             JOIN Product p ON p.ProdKey = sd.ProdKey
             CROSS APPLY (SELECT ${EXP_EST('sd','p')} AS ExpEst) x
            WHERE sm.OrderWeek IN (${wkIn}) AND ISNULL(sm.isDeleted,0)=0 AND ISNULL(sd.OutQuantity,0)<>0
              AND ABS(ISNULL(sd.EstQuantity,0) - x.ExpEst) > 0.001`,
          wkParams
        );
        estDetailUpdated = e1.rowsAffected?.[0] || 0;
        // ShipmentDate 의 EstQuantity/Amount/Vat 를 ShipmentDetail 과 동기화
        const e2 = await tQ(
          `UPDATE sdt
              SET sdt.EstQuantity = sd.EstQuantity, sdt.Amount = sd.Amount, sdt.Vat = sd.Vat
             FROM ShipmentDate sdt WITH (UPDLOCK, ROWLOCK)
             JOIN ShipmentDetail sd ON sd.SdetailKey = sdt.SdetailKey
             JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
            WHERE sm.OrderWeek IN (${wkIn}) AND ISNULL(sm.isDeleted,0)=0 AND ISNULL(sd.OutQuantity,0)<>0
              AND ( ABS(ISNULL(sdt.EstQuantity,0) - ISNULL(sd.EstQuantity,0)) > 0.001
                 OR ABS(ISNULL(sdt.Amount,0) - ISNULL(sd.Amount,0)) > 0.001
                 OR ABS(ISNULL(sdt.Vat,0) - ISNULL(sd.Vat,0)) > 0.001 )`,
          wkParams
        );
        estDateSynced = e2.rowsAffected?.[0] || 0;
      }

      return { dateDetailUpdated, dateDateUpdated, estDetailUpdated, estDateSynced };
    });

    return res.status(200).json({
      success: true, weeks, fixDate, fixEst, ...result,
      message: `보정 완료 — 출고일(ShipmentDetail ${result.dateDetailUpdated} / ShipmentDate ${result.dateDateUpdated}), `
        + `견적수량(ShipmentDetail ${result.estDetailUpdated} / ShipmentDate ${result.estDateSynced}). `
        + `이제 견적서관리에 정상 표시·합산됩니다.`,
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

export default withAuth(withActionLog(handler, {
  actionType: 'ESTIMATE_PERIOD_REPAIR',
  affectedTable: 'ShipmentDetail/ShipmentDate',
  riskLevel: 'MEDIUM',
}));
