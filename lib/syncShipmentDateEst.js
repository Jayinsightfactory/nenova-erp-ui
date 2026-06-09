// ShipmentDate.EstQuantity/Amount/Vat 동기화 — usp_DistributeOne + nenova.exe 견적 공통 규칙.
// 출고일별 ShipmentQuantity(OutUnit) → distributeUnits → EstQuantity. Detail 총량 복제 금지.
import { distributeUnits, amountVatFromCostEst } from './distributeUnits.js';

/**
 * @param {Function} tQ transaction query
 * @param {number} sdetailKey
 * @returns {Promise<{updated:number, rows:Array, detailKey:number}>}
 */
export async function syncShipmentDateEstBySdetailKey(tQ, sdetailKey, sql) {
  const ctx = await tQ(
    `SELECT sd.SdetailKey, sd.ShipmentKey, sd.ProdKey,
            ISNULL(sd.Cost,0) AS Cost,
            p.OutUnit, p.EstUnit,
            ISNULL(p.BunchOf1Box,0) AS BunchOf1Box,
            ISNULL(p.SteamOf1Bunch,0) AS SteamOf1Bunch,
            ISNULL(p.SteamOf1Box,0) AS SteamOf1Box
       FROM ShipmentDetail sd
       JOIN Product p ON p.ProdKey = sd.ProdKey
      WHERE sd.SdetailKey = @dk`,
    { dk: { type: sql.Int, value: sdetailKey } }
  );
  const detail = ctx.recordset?.[0];
  if (!detail) return { updated: 0, rows: [], detailKey: sdetailKey };

  const dates = await tQ(
    `SELECT SdateKey, ShipmentDtm, ISNULL(ShipmentQuantity,0) AS ShipmentQuantity,
            ISNULL(EstQuantity,0) AS EstQuantity, ISNULL(Cost,0) AS Cost,
            ISNULL(Amount,0) AS Amount, ISNULL(Vat,0) AS Vat
       FROM ShipmentDate
      WHERE SdetailKey = @dk
      ORDER BY ShipmentDtm`,
    { dk: { type: sql.Int, value: sdetailKey } }
  );
  const product = {
    OutUnit: detail.OutUnit,
    EstUnit: detail.EstUnit,
    BunchOf1Box: detail.BunchOf1Box,
    SteamOf1Bunch: detail.SteamOf1Bunch,
    SteamOf1Box: detail.SteamOf1Box,
  };
  const unitCost = Number(detail.Cost) || 0;
  let updated = 0;
  const rows = [];

  for (const d of dates.recordset || []) {
    const shipQty = Number(d.ShipmentQuantity) || 0;
    const { estQty } = distributeUnits(shipQty, product);
    const { amount, vat } = amountVatFromCostEst(unitCost, estQty);
    const cost = unitCost;
    const changed = Math.abs(Number(d.EstQuantity) - estQty) > 0.001
      || Math.abs(Number(d.Amount) - amount) > 0.001
      || Math.abs(Number(d.Vat) - vat) > 0.001
      || Math.abs(Number(d.Cost) - cost) > 0.001;
    if (changed) {
      await tQ(
        `UPDATE ShipmentDate
            SET EstQuantity=@est, Cost=@cost, Amount=@amount, Vat=@vat
          WHERE SdateKey=@sk`,
        {
          sk: { type: sql.Int, value: d.SdateKey },
          est: { type: sql.Float, value: estQty },
          cost: { type: sql.Float, value: cost },
          amount: { type: sql.Float, value: amount },
          vat: { type: sql.Float, value: vat },
        }
      );
      updated += 1;
    }
    rows.push({
      shipmentDtm: d.ShipmentDtm,
      shipmentQuantity: shipQty,
      estQty,
      amount,
      vat,
      changed,
    });
  }

  return { updated, rows, detailKey: sdetailKey };
}

/** 차수 범위 내 모든 ShipmentDate 행을 distributeUnits 기준으로 재동기화 */
export async function syncShipmentDateEstForWeeks(tQ, weekInSql, wkParams, sql) {
  const keys = await tQ(
    `SELECT DISTINCT sd.SdetailKey
       FROM ShipmentDetail sd
       JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
      WHERE sm.OrderWeek IN (${weekInSql})
        AND ISNULL(sm.isDeleted,0)=0
        AND ISNULL(sd.OutQuantity,0)<>0
        AND EXISTS (SELECT 1 FROM ShipmentDate sdt WHERE sdt.SdetailKey = sd.SdetailKey)`,
    wkParams
  );
  let totalUpdated = 0;
  const samples = [];
  for (const r of keys.recordset || []) {
    const res = await syncShipmentDateEstBySdetailKey(tQ, r.SdetailKey, sql);
    totalUpdated += res.updated;
    if (samples.length < 15 && res.updated > 0) {
      samples.push({ sdetailKey: r.SdetailKey, rows: res.rows });
    }
  }
  return { sdetailKeys: keys.recordset?.length || 0, dateRowsUpdated: totalUpdated, samples };
}
