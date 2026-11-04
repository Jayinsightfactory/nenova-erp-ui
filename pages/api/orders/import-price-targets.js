// pages/api/orders/import-price-targets.js
// 업로드 주문등록 → 분배단가 적용 대상 조회 (읽기 전용)
// GET ?custKey=42&orderYear=2026&parentWeek=44
//   → 해당 거래처의 44-01, 44-02 … 세부차수별 ShipmentMaster/ShipmentDetail(ProdKey, Cost, OutQuantity, isFix)
// 규칙 1 준수: SELECT 만. 실제 단가 변경은 /api/estimate/update-cost (확정차수 가드 포함) 가 담당.

import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const custKey = parseInt(req.query.custKey, 10);
  const orderYear = String(req.query.orderYear || '').trim();
  const parentWeek = String(req.query.parentWeek || '').trim().replace(/-.*$/, '');

  if (!Number.isInteger(custKey) || custKey <= 0) {
    return res.status(400).json({ success: false, error: 'custKey 필요' });
  }
  if (!/^\d{4}$/.test(orderYear)) {
    return res.status(400).json({ success: false, error: 'orderYear(4자리) 필요' });
  }
  if (!/^\d{1,2}$/.test(parentWeek)) {
    return res.status(400).json({ success: false, error: 'parentWeek(대차수 NN) 필요' });
  }
  const pw = parentWeek.padStart(2, '0');

  try {
    const masters = await query(
      `SELECT sm.ShipmentKey, sm.OrderWeek, ISNULL(sm.isFix, 0) AS isFix
         FROM ShipmentMaster sm
        WHERE sm.CustKey = @ck
          AND sm.OrderYear = @yr
          AND sm.OrderWeek LIKE @pwLike
          AND ISNULL(sm.isDeleted, 0) = 0
        ORDER BY sm.OrderWeek, sm.ShipmentKey`,
      {
        ck: { type: sql.Int, value: custKey },
        yr: { type: sql.NVarChar, value: orderYear },
        pwLike: { type: sql.NVarChar, value: `${pw}-%` },
      },
    );

    const masterRows = masters.recordset || [];
    if (masterRows.length === 0) {
      return res.status(200).json({ success: true, custKey, orderYear, parentWeek: pw, subWeeks: [] });
    }

    const skParams = {};
    masterRows.forEach((m, i) => { skParams[`sk${i}`] = { type: sql.Int, value: m.ShipmentKey }; });
    const details = await query(
      `SELECT sd.SdetailKey, sd.ShipmentKey, sd.ProdKey,
              p.ProdName, ISNULL(p.DisplayName, p.ProdName) AS DisplayName, p.OutUnit, p.EstUnit,
              ISNULL(sd.OutQuantity, 0) AS OutQuantity,
              ISNULL(sd.EstQuantity, 0) AS EstQuantity,
              ISNULL(sd.Cost, 0) AS Cost,
              ISNULL(sd.Amount, 0) AS Amount,
              ISNULL(sd.isFix, 0) AS isFix,
              CONVERT(NVARCHAR(10), sd.ShipmentDtm, 23) AS ShipmentDate
         FROM ShipmentDetail sd
         JOIN Product p ON p.ProdKey = sd.ProdKey
        WHERE sd.ShipmentKey IN (${masterRows.map((_, i) => `@sk${i}`).join(',')})
        ORDER BY sd.ShipmentKey, p.ProdName, sd.SdetailKey`,
      skParams,
    );

    const byWeek = new Map();
    for (const m of masterRows) {
      if (!byWeek.has(m.OrderWeek)) {
        byWeek.set(m.OrderWeek, {
          orderWeek: m.OrderWeek,
          shipmentKeys: [],
          masterFixed: false,
          shipmentDates: [],
          details: [],
        });
      }
      const w = byWeek.get(m.OrderWeek);
      w.shipmentKeys.push(m.ShipmentKey);
      if (Number(m.isFix) === 1) w.masterFixed = true;
    }
    const weekByShipmentKey = new Map(masterRows.map(m => [Number(m.ShipmentKey), m.OrderWeek]));
    for (const d of details.recordset || []) {
      const wk = weekByShipmentKey.get(Number(d.ShipmentKey));
      const w = byWeek.get(wk);
      if (!w) continue;
      if (d.ShipmentDate && !w.shipmentDates.includes(d.ShipmentDate)) w.shipmentDates.push(d.ShipmentDate);
      w.details.push({
        sdetailKey: d.SdetailKey,
        shipmentKey: d.ShipmentKey,
        prodKey: d.ProdKey,
        prodName: d.ProdName,
        displayName: d.DisplayName,
        outUnit: d.OutUnit,
        estUnit: d.EstUnit,
        outQty: Number(d.OutQuantity),
        estQty: Number(d.EstQuantity),
        cost: Number(d.Cost),
        amount: Number(d.Amount),
        isFix: Number(d.isFix) === 1,
        shipmentDate: d.ShipmentDate || null,
      });
    }

    const subWeeks = [...byWeek.values()].map(w => ({
      ...w,
      detailCount: w.details.length,
      fixedDetailCount: w.details.filter(d => d.isFix).length,
      // 상세행 기준 확정 여부 (update-cost 의 FIXED_WEEK 판정과 동일 단위)
      hasFixedDetail: w.details.some(d => d.isFix),
    }));

    return res.status(200).json({ success: true, custKey, orderYear, parentWeek: pw, subWeeks });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

export default withAuth(handler);
