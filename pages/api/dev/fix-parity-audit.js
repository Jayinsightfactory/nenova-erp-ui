/**
 * GET /api/dev/fix-parity-audit?week=25-01
 * nenova.exe vs nenovaweb 확정 상태 불일치 진단
 */
import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { deriveExeAlignedStatus, deriveShipmentDetailStatus } from '../../../lib/shipmentFixReconcile';

function parseWeek(input) {
  const raw = String(input || '').trim();
  const full = raw.match(/^(\d{4})-(\d{2}-\d{2})$/);
  if (full) return { year: full[1], week: full[2] };
  const short = raw.match(/^(\d{2}-\d{2})$/);
  if (short) return { year: String(new Date().getFullYear()), week: short[1] };
  return null;
}

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const parsed = parseWeek(req.query.week);
  if (!parsed) return res.status(400).json({ success: false, error: 'week 필요 (예: 25-01)' });

  const { year, week } = parsed;
  const params = {
    yr: { type: sql.NVarChar, value: year },
    wk: { type: sql.NVarChar, value: week },
  };

  const summary = await query(
    `SELECT
       COUNT(DISTINCT sm.ShipmentKey) AS masterCount,
       SUM(CASE WHEN ISNULL(sm.isFix,0)=1 THEN 1 ELSE 0 END) AS masterFixRows,
       COUNT(DISTINCT CASE WHEN ISNULL(sm.isFix,0)=1 THEN sm.ShipmentKey END) AS masterFixedKeys,
       COUNT(DISTINCT CASE WHEN ISNULL(sm.isFix,0)=0 THEN sm.ShipmentKey END) AS masterUnfixedKeys,
       COUNT(sd.SdetailKey) AS detailCount,
       SUM(CASE WHEN ISNULL(sd.isFix,0)=1 AND ISNULL(sd.OutQuantity,0)>0 THEN 1 ELSE 0 END) AS detailFixedOutRows,
       SUM(CASE WHEN ISNULL(sd.isFix,0)=0 AND ISNULL(sd.OutQuantity,0)>0 THEN 1 ELSE 0 END) AS detailUnfixedOutRows,
       SUM(CASE WHEN ISNULL(sm.isFix,0)<>ISNULL(sd.isFix,0) AND ISNULL(sd.OutQuantity,0)>0 THEN 1 ELSE 0 END) AS masterDetailMismatchRows
     FROM ShipmentMaster sm
     LEFT JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
     WHERE sm.isDeleted=0 AND sm.OrderWeek=@wk`,
    params
  );

  const viewCompare = await query(
    `SELECT TOP 30
       sd.SdetailKey, sm.ShipmentKey, c.CustName, p.ProdName,
       ISNULL(sm.isFix,0) AS MasterFix,
       ISNULL(sd.isFix,0) AS DetailFix,
       ISNULL(vs.DetailFix,0) AS ViewDetailFix,
       ISNULL(vs.MasterFix,0) AS ViewMasterFix,
       ISNULL(sd.OutQuantity,0) AS OutQuantity
     FROM ShipmentDetail sd
     JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
     JOIN Customer c ON c.CustKey = sm.CustKey
     JOIN Product p ON p.ProdKey = sd.ProdKey
     LEFT JOIN ViewShipment vs ON vs.SdetailKey = sd.SdetailKey
     WHERE sm.isDeleted=0 AND sm.OrderWeek=@wk
       AND ISNULL(sd.OutQuantity,0)>0
       AND (
         ISNULL(sm.isFix,0)<>ISNULL(sd.isFix,0)
         OR ISNULL(sd.isFix,0)<>ISNULL(vs.DetailFix,0)
         OR vs.SdetailKey IS NULL
       )
     ORDER BY c.CustName, p.ProdName`,
    params
  );

  const stockMaster = await query(
    `SELECT StockKey, OrderYear, OrderWeek, ISNULL(isFix,0) AS isFix
       FROM StockMaster
      WHERE OrderWeek=@wk`,
    params
  );

  const negativeProductStock = await query(
    `SELECT TOP 30 p.ProdKey, p.ProdName, p.Stock AS ProductStockLive
       FROM Product p
      WHERE p.isDeleted=0 AND ISNULL(p.Stock,0) < 0
        AND EXISTS (
          SELECT 1 FROM ShipmentDetail sd
          JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey
          WHERE sd.ProdKey=p.ProdKey AND sm.OrderWeek=@wk AND sm.isDeleted=0 AND ISNULL(sd.OutQuantity,0)>0
        )
      ORDER BY p.Stock ASC`,
    params
  );

  const productStockWeek = await query(
    `SELECT TOP 30 ps.ProdKey, p.ProdName, ps.Stock AS WeekStock,
            sm.OrderWeek, ISNULL(sm.isFix,0) AS StockMasterFix
       FROM ProductStock ps
       JOIN StockMaster sm ON sm.StockKey=ps.StockKey
       JOIN Product p ON p.ProdKey=ps.ProdKey
      WHERE sm.OrderWeek=@wk AND p.isDeleted=0 AND ISNULL(ps.Stock,0) < 0
      ORDER BY ps.Stock ASC`,
    params
  );

  let recentUnfix = { recordset: [] };
  try {
    recentUnfix = await query(
      `SELECT TOP 20 ActionDtm AS LogDtm, Step, Detail, IsError
         FROM AppLog
        WHERE Category=N'shipmentFix'
          AND (Detail LIKE @wkPat OR Detail LIKE @wkPat2)
        ORDER BY ActionDtm DESC`,
      {
        wkPat: { type: sql.NVarChar, value: `%${week}%` },
        wkPat2: { type: sql.NVarChar, value: `%/${week.replace('-', '/')}%` },
      }
    );
  } catch {
    /* AppLog 스키마 차이 시 무시 */
  }

  const s = summary.recordset[0] || {};
  const webShipmentStatus = deriveShipmentDetailStatus({
    detailCount: Number(s.detailCount || 0),
    fixedDetailCount: Number(s.detailFixedOutRows || 0),
    unfixedDetailCount: Number(s.detailUnfixedOutRows || 0),
  });
  const stockRows = stockMaster.recordset || [];
  const stockFixed = stockRows.some((r) => Number(r.isFix) === 1);
  const stockFixStatus = stockRows.length > 0 ? (stockFixed ? 'FIXED' : 'OPEN') : 'NONE';
  const parity = deriveExeAlignedStatus({
    shipmentStatus: webShipmentStatus,
    stockFixStatus,
    negativeLiveCount: (negativeProductStock.recordset || []).length,
    masterDetailMismatchCount: Number(s.masterDetailMismatchRows || 0),
  });
  const webStatus = parity.status;

  const risks = [];
  if (Number(s.masterDetailMismatchRows || 0) > 0) {
    risks.push(`ShipmentMaster.isFix ≠ ShipmentDetail.isFix 불일치 ${s.masterDetailMismatchRows}행`);
  }
  if (viewCompare.recordset.length > 0) {
    risks.push(`ViewShipment 미노출/DetailFix 불일치 ${viewCompare.recordset.length}건 이상`);
  }
  if (!stockFixed && stockRows.length > 0) {
    risks.push('StockMaster.isFix=0 (차수 재고 마감 미확정) — exe 재고 화면과 어긋날 수 있음');
  }
  if ((negativeProductStock.recordset || []).length > 0) {
    risks.push(`Product.Stock 음수 ${negativeProductStock.recordset.length}품목 (exe 실시간 재고)`);
  }
  if (webStatus === 'FIXED_PENDING_STOCK' || (webShipmentStatus === 'FIXED' && !stockFixed && stockRows.length > 0)) {
    risks.push('웹 출고확정(Detail) 이지만 StockMaster 미확정 — 사용자 체감 “exe는 풀림, 웹은 확정” 패턴');
  }

  return res.status(200).json({
    success: true,
    week: `${year}-${week}`,
    summary: s,
    webFixStatus: webStatus,
    webShipmentStatus,
    exeAligned: parity.exeAligned,
    parityWarnings: parity.warnings,
    stockMaster: stockRows,
    stockMasterFixed: stockFixed,
    viewMismatches: viewCompare.recordset,
    negativeProductStock: negativeProductStock.recordset,
    negativeProductStockWeek: productStockWeek.recordset,
    recentFixLogs: recentUnfix.recordset,
    risks,
    notes: [
      'nenovaweb fix-status: ShipmentDetail.isFix 기준 (unfixedDetailCount=0 → FIXED)',
      'nenovaweb 견적 SubWeeksFix: ShipmentMaster.isFix 기준 (배지)',
      'nenova.exe 출고확정/재고: usp_ShipmentFix + ViewShipment.DetailFix + Product.Stock',
      'StockMaster.isFix 는 usp_StockCalculation 마감 확정 — fix-status에 stockFixed로 노출하나 UI 배지에는 미표시',
    ],
  });
}

export default withAuth(handler);
