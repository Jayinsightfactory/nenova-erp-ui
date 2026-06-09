// pages/api/shipment/estimate-period-repair.js
//  엑셀 업로드/분배 경로에서 잘못 저장된 견적 누락·금액오류를 차수 단위로 진단·보정한다.
//
//  ★ 정답 기준 = "정상 차수(기본 22차)".  nenova.exe 의 자동분배는 C# 이 아니라 DB 저장
//    프로시저 usp_DistributeOne 이 EstQuantity 를 만든다(C#은 EXEC 만 호출). 그 산식을 그대로
//    재현하는 대신, 이미 정상인 차수(22차)의 실데이터에서 품목별 정상 비율을 직접 뽑아 기준으로
//    삼는다. 이러면 마스터(BunchOf1Box)가 비어있는 수국 같은 품목도 정확히 판정된다.
//      품목별 기준비율 Ratio = AVG(EstQuantity / OutQuantity)  (정상 차수에서)
//      기대 EstQuantity      = ROUND(OutQuantity × Ratio)
//    기준 차수에 없는 품목은 비교 대상이 없으므로 EstQuantity 를 건드리지 않는다(현재값 유지).
//
//  ① 출고일 시각 불일치 (견적서 "표시 안 됨")
//     - ShipmentDate.ShipmentDtm 이 03:00 등으로 저장돼 PeriodDay.BaseYmd(자정) 와 정확매칭 실패.
//     - 보정: ShipmentDetail/ShipmentDate 의 ShipmentDtm 을 같은 날짜 PeriodDay.BaseYmd 로 정확히 맞춤.
//
//  ② EstQuantity 환산 오류 (견적 "합계 틀림")
//     - 단 품목인데 업로드 버그로 OutQuantity 의 N배로 부풀려짐(장미/알스트로).
//     - usp_DistributeOne 확정 규약: EstQuantity 는 EstUnit 기준 수량(ROUND).
//       단(EstUnit=단,OutUnit=단) → EstQuantity = OutQuantity. 박스 → OutQuantity×BunchOf1Box.
//       하지만 수국은 마스터 BunchOf1Box 가 비어 proc 식 재현 시 0 이 되므로, 정상 차수(22차)
//       실비율로 보정한다(박스 정상값은 비율 일치로 자동 제외, 단 ×N 만 OutQuantity 로 복원).
//     - 금액: Amount = ROUND(Cost×Est/1.1, 0), Vat = Cost×Est − Amount (proc 과 동일).
//
//  GET  ?week=23-01[&weeks=23-01,23-02][&ref=22-01,22-02][&q=검색어]   → 진단(읽기 전용)
//  GET  ?proc=1                                                          → usp_DistributeOne 원문 덤프
//  GET  ?all=1[&ref=...]                                                 → 전수 진단
//  POST { week|weeks, ref?, action:'fix', fixDate=true, fixEst=false }   → 보정
import { withAuth } from '../../../lib/auth';
import { withTransaction, query, sql } from '../../../lib/db';
import { withActionLog } from '../../../lib/withActionLog';
import { normalizeOrderWeek } from '../../../lib/orderUtils';

const DEFAULT_REF = ['22-01', '22-02'];

function parseWeeks(raw) {
  return String(raw || '').split(',').map(w => normalizeOrderWeek(w.trim())).filter(Boolean);
}

function agentDebugLog(hypothesisId, message, data = {}) {
  // #region agent log
  fetch('http://127.0.0.1:7474/ingest/a0422b17-2238-4edf-9629-527898dfcfbd', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '9f5faa' }, body: JSON.stringify({ sessionId: '9f5faa', runId: 'pre-fix', hypothesisId, location: 'pages/api/shipment/estimate-period-repair.js:agentDebugLog', message, data, timestamp: Date.now() }) }).catch(() => {});
  // #endregion
}

async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ success: false, error: 'GET/POST only' });
  }

  // 0-a) 제품 마스터 조회 — 환산 컬럼(OutUnit/EstUnit/BunchOf1Box/SteamOf1Bunch/SteamOf1Box) 확인용
  if (req.method === 'GET' && (req.query?.master != null)) {
    try {
      const kw = String(req.query.master || '').trim();
      const rows = await query(
        `SELECT TOP 200 ProdKey, ProdName, OutUnit, EstUnit,
                ISNULL(BunchOf1Box,0) AS BunchOf1Box, ISNULL(SteamOf1Bunch,0) AS SteamOf1Bunch,
                ISNULL(SteamOf1Box,0) AS SteamOf1Box, ISNULL(CounName,'') AS CounName, ISNULL(FlowerName,'') AS FlowerName
           FROM Product
          WHERE ISNULL(isDeleted,0)=0
            AND (@kw='' OR ProdName LIKE @kw OR ISNULL(FlowerName,'') LIKE @kw)
          ORDER BY ProdName`,
        { kw: { type: sql.NVarChar, value: kw ? `%${kw}%` : '' } }
      );
      return res.status(200).json({ success: true, count: rows.recordset?.length || 0, products: rows.recordset || [] });
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  }

  // 0-b) ShipmentDate(출고일별 분할) 진단 — 한 SdetailKey 가 여러 출고일로 나뉘는지 확인용
  if (req.method === 'GET' && (req.query?.shipdates != null)) {
    try {
      const wk = normalizeOrderWeek(String(req.query.shipdates || '').trim());
      const custKw = String(req.query.cust || '').trim();
      const rows = await query(
        `SELECT sm.OrderWeek, c.CustName, ISNULL(c.Manager,'') AS Manager, p.ProdName,
                sm.ShipmentKey, c.CustKey, p.ProdKey,
                p.OutUnit, p.EstUnit, ISNULL(p.BunchOf1Box,0) AS BunchOf1Box,
                ISNULL(p.SteamOf1Bunch,0) AS SteamOf1Bunch, ISNULL(p.SteamOf1Box,0) AS SteamOf1Box,
                sd.SdetailKey,
                sd.EstQuantity AS DetailEst, sd.OutQuantity AS DetailOut, sd.Cost,
                sd.Amount AS DetailAmount, sd.Vat AS DetailVat,
                CONVERT(NVARCHAR(10), sdd.ShipmentDtm, 120) AS DateYmd,
                sdd.ShipmentQuantity AS DateShipQty, sdd.EstQuantity AS DateEst,
                sdd.Amount AS DateAmount, sdd.Vat AS DateVat,
                cnt.DateCount
           FROM ShipmentMaster sm
           JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
           JOIN Customer c ON c.CustKey = sm.CustKey
           JOIN Product p ON p.ProdKey = sd.ProdKey
           JOIN ShipmentDate sdd ON sdd.SdetailKey = sd.SdetailKey
           CROSS APPLY (SELECT COUNT(*) AS DateCount FROM ShipmentDate z WHERE z.SdetailKey = sd.SdetailKey) cnt
          WHERE sm.OrderWeek = @wk AND ISNULL(sm.isDeleted,0)=0
            AND (@cust='' OR c.CustName LIKE @cust)
          ORDER BY c.CustName, p.ProdName, sdd.ShipmentDtm`,
        { wk: { type: sql.NVarChar, value: wk }, cust: { type: sql.NVarChar, value: custKw ? `%${custKw}%` : '' } }
      );
      const split = (rows.recordset || []).filter(r => r.DateCount > 1);
      const focused = (rows.recordset || []).filter(r => (
        String(r.CustName || '').includes('주광')
        || String(r.ProdName || '').toLowerCase().includes('hydrangea')
        || String(r.ProdName || '').includes('수국')
      ));
      agentDebugLog('H1,H2,H3,H4', 'shipdates diagnostic raw rows', {
        week: wk,
        totalRows: rows.recordset?.length || 0,
        splitRows: split.length,
        focused: focused.slice(0, 20).map(r => ({
          shipmentKey: r.ShipmentKey,
          custKey: r.CustKey,
          prodKey: r.ProdKey,
          prodName: r.ProdName,
          sdetailKey: r.SdetailKey,
          outUnit: r.OutUnit,
          estUnit: r.EstUnit,
          bunchOf1Box: r.BunchOf1Box,
          steamOf1Bunch: r.SteamOf1Bunch,
          steamOf1Box: r.SteamOf1Box,
          detailOut: r.DetailOut,
          detailEst: r.DetailEst,
          dateYmd: r.DateYmd,
          dateShipQty: r.DateShipQty,
          dateEst: r.DateEst,
          dateAmount: r.DateAmount,
          dateVat: r.DateVat,
          dateCount: r.DateCount,
        })),
      });
      return res.status(200).json({
        success: true, week: wk, totalRows: rows.recordset?.length || 0,
        splitDetailRows: split.length, rows: rows.recordset || [],
      });
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  }

  // 0) usp_DistributeOne(정답 산식) 원문 덤프 — nenova 가 실제로 쓰는 EstQuantity 로직 확인용
  if (req.method === 'GET' && String(req.query?.proc || '') === '1') {
    try {
      const names = parseProcNames(req.query?.name);
      const rows = await query(
        `SELECT o.name AS ProcName, m.definition AS Definition
           FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id
          WHERE o.name IN (${names.map((_, i) => `@n${i}`).join(',')})`,
        names.reduce((a, n, i) => (a[`n${i}`] = { type: sql.NVarChar, value: n }, a), {})
      );
      return res.status(200).json({ success: true, procs: rows.recordset || [] });
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  }

  const refWeeks = (() => {
    const r = parseWeeks(req.query?.ref || req.body?.ref);
    return r.length ? r : DEFAULT_REF;
  })();
  const scanAll = req.method === 'GET'
    && (String(req.query?.all || '') === '1' || String(req.query?.week || req.query?.weeks || '').toLowerCase() === 'all');
  const weeks = scanAll ? [] : parseWeeks(req.query?.weeks || req.query?.week || req.body?.weeks || req.body?.week);
  if (!scanAll && weeks.length === 0) return res.status(400).json({ success: false, error: 'week 필요 (전수 점검은 GET ?all=1)' });
  const q = String(req.query?.q || req.body?.q || '').trim();

  // 파라미터: 대상 차수(@w*), 기준 차수(@r*), 검색어(@q)
  const wkParams = {};
  weeks.forEach((w, i) => { wkParams[`w${i}`] = { type: sql.NVarChar, value: w }; });
  refWeeks.forEach((w, i) => { wkParams[`r${i}`] = { type: sql.NVarChar, value: w }; });
  const wkIn = scanAll ? null : weeks.map((_, i) => `@w${i}`).join(',');
  const refIn = refWeeks.map((_, i) => `@r${i}`).join(',');
  const weekFilter = scanAll ? '1=1' : `sm.OrderWeek IN (${wkIn})`;
  const qFilter = q
    ? ` AND ( p.ProdName LIKE @q OR ISNULL(p.CounName,'') LIKE @q OR ISNULL(p.FlowerName,'') LIKE @q OR c.CustName LIKE @q )`
    : '';
  const baseParams = { ...wkParams };
  if (q) baseParams.q = { type: sql.NVarChar, value: `%${q}%` };

  // 기준 차수에서 품목별 정상 비율(Est/Out) 추출
  const refRatioCte = `
    refRatio AS (
      SELECT sd.ProdKey,
             CAST(ROUND(AVG(1.0 * NULLIF(sd.EstQuantity,0) / NULLIF(sd.OutQuantity,0)), 4) AS float) AS Ratio,
             COUNT(*) AS RefRows
        FROM ShipmentMaster sm
        JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
       WHERE sm.OrderWeek IN (${refIn}) AND ISNULL(sm.isDeleted,0)=0 AND ISNULL(sd.OutQuantity,0)<>0
       GROUP BY sd.ProdKey
    )`;
  // 기대 EstQuantity: 기준비율이 있으면 OutQuantity×Ratio, 없으면 현재값(=비교제외)
  const EXP = `CASE WHEN rr.Ratio IS NOT NULL THEN ROUND(sd.OutQuantity * rr.Ratio, 0) ELSE sd.EstQuantity END`;

  try {
    if (req.method === 'GET') {
      const flaggedCte = `
        WITH ${refRatioCte},
        flagged AS (
          SELECT sm.OrderWeek, p.ProdName, ISNULL(p.CounName,N'') AS CounName, ISNULL(p.FlowerName,N'') AS FlowerName,
                 c.CustName, p.OutUnit, p.EstUnit, rr.Ratio AS RefRatio, rr.RefRows,
                 sd.SdetailKey, ISNULL(sm.isFix,0) AS SmFix,
                 ISNULL(sd.OutQuantity,0) AS OutQuantity, ISNULL(sd.EstQuantity,0) AS EstQuantity,
                 ${EXP} AS ExpEst,
                 CONVERT(NVARCHAR(30), sdt.ShipmentDtm, 121) AS DateDtm,
                 CONVERT(NVARCHAR(30), pm.BaseYmd, 121) AS PeriodBaseYmd,
                 CASE WHEN sdt.ShipmentDtm IS NOT NULL AND pm.BaseYmd IS NOT NULL
                           AND sdt.ShipmentDtm <> pm.BaseYmd THEN 1 ELSE 0 END AS DateBroken,
                 CASE WHEN rr.Ratio IS NOT NULL AND ABS(ISNULL(sd.EstQuantity,0) - (${EXP})) > 0.001
                      THEN 1 ELSE 0 END AS EstBroken
            FROM ShipmentMaster sm
            JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
            JOIN Product p ON p.ProdKey = sd.ProdKey
            JOIN Customer c ON c.CustKey = sm.CustKey
            LEFT JOIN refRatio rr ON rr.ProdKey = sd.ProdKey
            OUTER APPLY (SELECT TOP 1 sdt0.ShipmentDtm FROM ShipmentDate sdt0 WHERE sdt0.SdetailKey = sd.SdetailKey) sdt
            OUTER APPLY (SELECT TOP 1 pd.BaseYmd FROM PeriodDay pd
                          WHERE CONVERT(date, pd.BaseYmd) = CONVERT(date, sdt.ShipmentDtm) ORDER BY pd.BaseYmd) pm
           WHERE ${weekFilter} AND ISNULL(sm.isDeleted,0)=0 AND ISNULL(sd.OutQuantity,0)<>0${qFilter}
        )`;

      const agg = await query(
        `${flaggedCte}
         SELECT OrderWeek, ProdName, CounName, FlowerName, MAX(OutUnit) AS OutUnit, MAX(RefRatio) AS RefRatio,
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
      const samp = await query(
        `${flaggedCte}
         SELECT TOP 200 OrderWeek, CustName, ProdName, CounName, OutUnit, EstUnit, RefRatio, RefRows, SdetailKey, SmFix,
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
      const weekMap = {};
      for (const x of byProduct) {
        const w = x.OrderWeek;
        weekMap[w] = weekMap[w] || { week: w, dateBroken: 0, estBroken: 0, products: 0 };
        weekMap[w].dateBroken += Number(x.DateBroken || 0);
        weekMap[w].estBroken += Number(x.EstBroken || 0);
        weekMap[w].products += 1;
      }
      return res.status(200).json({
        success: true, scope: scanAll ? 'all' : weeks, ref: refWeeks, q: q || null,
        dateMismatchCount, estMismatchCount, fixedWeekRowCount,
        affectedWeeks: Object.values(weekMap),
        byProduct,
        dateSamples: samples.filter(x => Number(x.DateBroken) === 1).slice(0, 100),
        estSamples: samples.filter(x => Number(x.EstBroken) === 1).slice(0, 100),
        hint: `기준 차수(${refWeeks.join(',')})의 품목별 비율로 비교. 보정: POST { week, ref, action:"fix", fixDate:true, fixEst:true }. 프로시저 원문: GET ?proc=1`,
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
        // 기준 차수 비율로 EstQuantity 재계산 + Amount/Vat 재산출.
        // 기준비율이 있는 품목만(rr.Ratio IS NOT NULL) 보정 → 22차에 없던 품목은 손대지 않음.
        // 금액/부가세는 usp_DistributeOne 과 100% 동일하게:
        //   Amount = ROUND(Cost*Est/1.1, 0),  Vat = Cost*Est - Amount  (←/11 아님)
        const e1 = await tQ(
          `WITH ${refRatioCte}
           UPDATE sd
              SET sd.EstQuantity = x.ExpEst,
                  sd.Amount = ROUND(ISNULL(sd.Cost,0) * x.ExpEst / 1.1, 0),
                  sd.Vat    = (ISNULL(sd.Cost,0) * x.ExpEst) - ROUND(ISNULL(sd.Cost,0) * x.ExpEst / 1.1, 0)
             FROM ShipmentDetail sd WITH (UPDLOCK, ROWLOCK)
             JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
             LEFT JOIN refRatio rr ON rr.ProdKey = sd.ProdKey
             CROSS APPLY (SELECT ${EXP} AS ExpEst) x
            WHERE sm.OrderWeek IN (${wkIn}) AND ISNULL(sm.isDeleted,0)=0 AND ISNULL(sd.OutQuantity,0)<>0
              AND rr.Ratio IS NOT NULL AND ABS(ISNULL(sd.EstQuantity,0) - x.ExpEst) > 0.001`,
          wkParams
        );
        estDetailUpdated = e1.rowsAffected?.[0] || 0;
        // ShipmentDate 는 전산 견적(nenova.exe)이 출고일별로 직접 읽는 테이블이다.
        // Detail 전체 Est/Amount/Vat 를 각 날짜에 복제하면 목요일 10박스 행도 전체 5700단으로 보인다.
        const e2 = await tQ(
          `UPDATE sdt
              SET sdt.EstQuantity = x.DateEst,
                  sdt.Amount = ROUND(ISNULL(sd.Cost,0) * x.DateEst / 1.1, 0),
                  sdt.Vat = (ISNULL(sd.Cost,0) * x.DateEst) - ROUND(ISNULL(sd.Cost,0) * x.DateEst / 1.1, 0)
             FROM ShipmentDate sdt WITH (UPDLOCK, ROWLOCK)
             JOIN ShipmentDetail sd ON sd.SdetailKey = sdt.SdetailKey
             JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
             CROSS APPLY (
               SELECT CASE
                 WHEN ISNULL(sd.OutQuantity,0) <> 0
                   THEN ROUND(ISNULL(sd.EstQuantity,0) * ISNULL(sdt.ShipmentQuantity,0) / sd.OutQuantity, 0)
                 ELSE ISNULL(sd.EstQuantity,0)
               END AS DateEst
             ) x
            WHERE sm.OrderWeek IN (${wkIn}) AND ISNULL(sm.isDeleted,0)=0 AND ISNULL(sd.OutQuantity,0)<>0
              AND ( ABS(ISNULL(sdt.EstQuantity,0) - x.DateEst) > 0.001
                 OR ABS(ISNULL(sdt.Amount,0) - ROUND(ISNULL(sd.Cost,0) * x.DateEst / 1.1, 0)) > 0.001
                 OR ABS(ISNULL(sdt.Vat,0) - ((ISNULL(sd.Cost,0) * x.DateEst) - ROUND(ISNULL(sd.Cost,0) * x.DateEst / 1.1, 0))) > 0.001 )`,
          wkParams
        );
        estDateSynced = e2.rowsAffected?.[0] || 0;
      }

      return { dateDetailUpdated, dateDateUpdated, estDetailUpdated, estDateSynced };
    });

    return res.status(200).json({
      success: true, weeks, ref: refWeeks, fixDate, fixEst, ...result,
      message: `보정 완료 — 출고일(ShipmentDetail ${result.dateDetailUpdated} / ShipmentDate ${result.dateDateUpdated}), `
        + `견적수량(ShipmentDetail ${result.estDetailUpdated} / ShipmentDate ${result.estDateSynced}). `
        + `기준 차수(${refWeeks.join(',')}) 비율로 보정. 이제 견적서관리에 정상 표시·합산됩니다.`,
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

function parseProcNames(raw) {
  const list = String(raw || '').split(',').map(s => s.trim()).filter(Boolean);
  const def = ['usp_DistributeOne', 'usp_DistributeTotal', 'usp_StockCalculation'];
  return (list.length ? list : def).slice(0, 10);
}

export default withAuth(withActionLog(handler, {
  actionType: 'ESTIMATE_PERIOD_REPAIR',
  affectedTable: 'ShipmentDetail/ShipmentDate',
  riskLevel: 'MEDIUM',
}));
