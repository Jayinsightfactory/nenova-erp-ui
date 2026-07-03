// ShipmentDate.EstQuantity/Amount/Vat 동기화 — usp_DistributeOne + nenova.exe 견적 공통 규칙.
// 출고일별 ShipmentQuantity(OutUnit) → distributeUnits → EstQuantity. Detail 총량 복제 금지.
import { distributeUnits, amountVatFromCostEst } from './distributeUnits.js';
import { isActiveShipmentOutQty, purgeZeroOutShipmentDetail } from './shipmentDetailWriteGuard.js';

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

/**
 * ShipmentDetail 금액 기준 — Date 합계가 Detail 과 다를 때 **레거시 데이터 복구 전용**.
 * 정상 쓰기 경로(update-quantity, usp_Distribute*)는 distributeUnits 로 Detail·Date 를 동일하게 맞춰야 하며,
 * 이 함수로 사후 보정하면 웹 전용 규칙이 exe 와 어긋난 채 굳어질 수 있음.
 */
export async function reconcileShipmentDateAmountsFromDetail(tQ, sdetailKey, sql) {
  const ctx = await tQ(
    `SELECT sd.SdetailKey,
            ISNULL(sd.EstQuantity,0) AS EstQuantity,
            ISNULL(sd.Cost,0) AS Cost,
            ISNULL(sd.Amount,0) AS Amount,
            ISNULL(sd.Vat,0) AS Vat
       FROM ShipmentDetail sd
      WHERE sd.SdetailKey = @dk`,
    { dk: { type: sql.Int, value: sdetailKey } },
  );
  const detail = ctx.recordset?.[0];
  if (!detail) return { reconciled: false, reason: 'no-detail' };

  const dates = await tQ(
    `SELECT SdateKey, ISNULL(ShipmentQuantity,0) AS ShipmentQuantity,
            ISNULL(EstQuantity,0) AS EstQuantity,
            ISNULL(Amount,0) AS Amount, ISNULL(Vat,0) AS Vat
       FROM ShipmentDate
      WHERE SdetailKey = @dk
      ORDER BY ShipmentDtm`,
    { dk: { type: sql.Int, value: sdetailKey } },
  );
  const rows = dates.recordset || [];
  if (!rows.length) return { reconciled: false, reason: 'no-dates' };

  const dateAmtSum = rows.reduce((s, r) => s + Number(r.Amount || 0), 0);
  const detailAmt = Number(detail.Amount || 0);
  if (Math.abs(dateAmtSum - detailAmt) < 1) {
    return { reconciled: false, reason: 'already-synced', dateAmtSum, detailAmt };
  }

  const detailVat = Number(detail.Vat || 0);
  const detailEst = Number(detail.EstQuantity || 0);
  const detailCost = Number(detail.Cost || 0);
  let updated = 0;

  if (rows.length === 1) {
    await tQ(
      `UPDATE ShipmentDate
          SET EstQuantity=@est, Cost=@cost, Amount=@amount, Vat=@vat
        WHERE SdateKey=@sk`,
      {
        sk: { type: sql.Int, value: rows[0].SdateKey },
        est: { type: sql.Float, value: detailEst },
        cost: { type: sql.Float, value: detailCost },
        amount: { type: sql.Float, value: detailAmt },
        vat: { type: sql.Float, value: detailVat },
      },
    );
    return {
      reconciled: true,
      mode: 'single-copy',
      updated: 1,
      before: dateAmtSum,
      after: detailAmt,
    };
  }

  const qtySum = rows.reduce((s, r) => s + Number(r.ShipmentQuantity || 0), 0);
  let allocatedAmt = 0;
  let allocatedVat = 0;
  let allocatedEst = 0;

  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    const isLast = i === rows.length - 1;
    const ratio = qtySum > 0
      ? Number(r.ShipmentQuantity || 0) / qtySum
      : 1 / rows.length;
    const amount = isLast ? detailAmt - allocatedAmt : Math.round(detailAmt * ratio);
    const vat = isLast ? detailVat - allocatedVat : Math.round(detailVat * ratio);
    const est = isLast ? detailEst - allocatedEst : Math.round(detailEst * ratio);
    allocatedAmt += amount;
    allocatedVat += vat;
    allocatedEst += est;

    await tQ(
      `UPDATE ShipmentDate
          SET EstQuantity=@est, Cost=@cost, Amount=@amount, Vat=@vat
        WHERE SdateKey=@sk`,
      {
        sk: { type: sql.Int, value: r.SdateKey },
        est: { type: sql.Float, value: est },
        cost: { type: sql.Float, value: detailCost },
        amount: { type: sql.Float, value: amount },
        vat: { type: sql.Float, value: vat },
      },
    );
    updated += 1;
  }

  return {
    reconciled: true,
    mode: 'proportional',
    updated,
    before: dateAmtSum,
    after: detailAmt,
  };
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

/** 다중 출고일 ShipmentQuantity 를 새 Detail.OutQuantity 에 맞게 비율 스케일 (합계 보정) */
export function scaleShipmentDateQtys(dateRows, oldTotalOut, newTotalOut) {
  const rows = [...(dateRows || [])];
  const oldSum = Number(oldTotalOut) || 0;
  const newSum = Number(newTotalOut) || 0;
  if (!rows.length) return [];
  if (oldSum <= 0) {
    const each = rows.length ? Math.floor(newSum / rows.length) : 0;
    return rows.map((d, i) => ({
      ...d,
      newShipQty: i === rows.length - 1 ? newSum - each * (rows.length - 1) : each,
    }));
  }
  const scaled = rows.map((d) => ({
    ...d,
    newShipQty: Math.round((Number(d.ShipmentQuantity) || 0) * newSum / oldSum),
  }));
  const diff = newSum - scaled.reduce((s, r) => s + r.newShipQty, 0);
  if (scaled.length) scaled[scaled.length - 1].newShipQty += diff;
  return scaled;
}

/**
 * ShipmentDetail 수량 변경 직후 호출 — 전산 구조(1 Detail + N ShipmentDate) 유지.
 * 다중 출고일: 날짜별 ShipmentQuantity 비율 스케일 + distributeUnits 동기화.
 * 단일/없음: 1행 INSERT/UPDATE.
 */
export async function refreshShipmentDatesAfterDetailChange(tQ, sdetailKey, sql, { shipDtm } = {}) {
  const detail = await tQ(
    `SELECT sd.SdetailKey, ISNULL(sd.OutQuantity,0) AS OutQuantity, ISNULL(sd.Cost,0) AS Cost,
            sd.ShipmentDtm
       FROM ShipmentDetail sd WHERE sd.SdetailKey=@dk`,
    { dk: { type: sql.Int, value: sdetailKey } }
  );
  const sd = detail.recordset?.[0];
  if (!sd) return { mode: 'missing', dateCount: 0 };

  const newOut = Number(sd.OutQuantity) || 0;
  const dates = await tQ(
    `SELECT SdateKey, ShipmentDtm, ISNULL(ShipmentQuantity,0) AS ShipmentQuantity
       FROM ShipmentDate WHERE SdetailKey=@dk ORDER BY ShipmentDtm`,
    { dk: { type: sql.Int, value: sdetailKey } }
  );
  const dateRows = dates.recordset || [];

  if (!isActiveShipmentOutQty(newOut)) {
    const purged = await purgeZeroOutShipmentDetail(tQ, sdetailKey, sql);
    return { mode: 'purged-zero-detail', dateCount: 0, ...purged };
  }

  if (dateRows.length > 1) {
    const oldSum = dateRows.reduce((s, d) => s + (Number(d.ShipmentQuantity) || 0), 0);
    const scaled = scaleShipmentDateQtys(dateRows, oldSum, newOut);
    for (const row of scaled) {
      await tQ(
        `UPDATE ShipmentDate SET ShipmentQuantity=@sq WHERE SdateKey=@sk`,
        { sk: { type: sql.Int, value: row.SdateKey }, sq: { type: sql.Float, value: row.newShipQty } }
      );
    }
    const sync = await syncShipmentDateEstBySdetailKey(tQ, sdetailKey, sql);
    return { mode: 'scaled', dateCount: dateRows.length, ...sync };
  }

  const dt = shipDtm || sd.ShipmentDtm;
  if (dateRows.length === 1) {
    await tQ(
      `UPDATE ShipmentDate
          SET ShipmentDtm=COALESCE(@dt, ShipmentDtm), ShipmentQuantity=@sq
        WHERE SdateKey=@sk`,
      {
        sk: { type: sql.Int, value: dateRows[0].SdateKey },
        dt: dt ? { type: sql.DateTime, value: dt } : { type: sql.DateTime, value: null },
        sq: { type: sql.Float, value: newOut },
      }
    );
  } else {
    await tQ(
      `INSERT INTO ShipmentDate (SdetailKey, ShipmentDtm, ShipmentQuantity, EstQuantity, Cost, Amount, Vat)
       SELECT @dk, @dt, @sq, @est, ISNULL(Cost,0), ISNULL(Amount,0), ISNULL(Vat,0)
         FROM ShipmentDetail WHERE SdetailKey=@dk`,
      {
        dk: { type: sql.Int, value: sdetailKey },
        dt: { type: sql.DateTime, value: dt },
        sq: { type: sql.Float, value: newOut },
        est: { type: sql.Float, value: 0 },
      }
    );
  }
  const sync = await syncShipmentDateEstBySdetailKey(tQ, sdetailKey, sql);
  return {
    mode: dateRows.length === 1 ? 'single-update' : 'single-insert',
    dateCount: 1,
    ...sync,
  };
}
