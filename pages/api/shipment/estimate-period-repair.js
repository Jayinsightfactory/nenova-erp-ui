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
//     - 박스단위 품목인데 EstQuantity 가 단(bunch)으로 들어가 금액이 BunchOf1Box 배로 부풀려짐.
//     - 보정: EstQuantity 를 OutUnit 기준(박스→OutQuantity, 단→×BunchOf1Box, 송이→×SteamOf1Box)으로
//       재계산하고 Amount/Vat 을 다시 산출. (전산 행은 이미 정상이라 대상에서 자동 제외)
//
//  GET  ?week=23-01[&weeks=23-01,23-02][&q=검색어]   → 진단(읽기 전용, 변경 없음)
//  POST { week|weeks, action:'fix', fixDate=true, fixEst=false }
import { withAuth } from '../../../lib/auth';
import { withTransaction, query, sql } from '../../../lib/db';
import { withActionLog } from '../../../lib/withActionLog';
import { normalizeOrderWeek } from '../../../lib/orderUtils';

// 전산(nenova.exe) 규약: EstQuantity = OutQuantity (실데이터로 확인 — Freedom OutUnit='단' 9행 모두 Est=Out).
// 과거 웹 업로드 버그만 Est = Out × BunchOf1Box(예 10배)로 들어갔다. 따라서 기대값은 OutQuantity.
// (p 인자는 시그니처 호환용, 현재 식에서는 미사용)
const EXP_EST = (sd /* , p */) => `${sd}.OutQuantity`;

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
