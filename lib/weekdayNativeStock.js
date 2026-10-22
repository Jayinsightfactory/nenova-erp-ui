import { normalizeShipmentQty } from './shipmentAvailability.js';
import { weekdayDistributionError } from './weekdayDistributionPolicy.js';

// Read-only equivalent of the installed usp_ShipmentFix availability formula.
// Product.Stock is a separate cumulative counter, not the native FIX predicate.
export const WEEKDAY_NATIVE_STOCK_SQL = `
DECLARE @previous int;
SELECT TOP (1) @previous=StockKey FROM StockMaster WITH (UPDLOCK,HOLDLOCK)
 WHERE OrderYearWeek<@startYearWeek ORDER BY OrderYearWeek DESC,OrderWeek DESC;
;WITH weeks AS (
 SELECT OrderYear,OrderWeek,OrderYearWeek FROM StockMaster WITH (HOLDLOCK)
 WHERE OrderYearWeek>=@startYearWeek AND OrderYearWeek<@yearWeek
 UNION
 SELECT OrderYear,OrderWeek,OrderYear+REPLACE(OrderWeek,'-','') FROM OPENJSON(@batchWeeks)
 WITH (OrderYear nvarchar(20),OrderWeek nvarchar(20))
 WHERE OrderYear+REPLACE(OrderWeek,'-','')>=@startYearWeek
 AND OrderYear+REPLACE(OrderWeek,'-','')<@yearWeek
), priorChanges AS (
 SELECT ISNULL((SELECT ROUND(SUM(vw.OutQuantity),2) FROM ViewWarehouse vw
   WHERE vw.OrderYear=w.OrderYear AND vw.OrderWeek=w.OrderWeek AND vw.ProdKey=@pk),0)
 -ISNULL((SELECT ROUND(SUM(vs.OutQuantity),2) FROM ViewShipment vs
   WHERE vs.OrderYear=w.OrderYear AND vs.OrderWeek=w.OrderWeek AND vs.ProdKey=@pk AND vs.DetailFix=1),0)
 +ISNULL((SELECT ROUND(SUM(sh.AfterValue-sh.BeforeValue),2) FROM StockHistory sh
   JOIN CodeInfo ci ON ci.Category=N'StockType' AND ci.Descr=sh.ChangeType
   WHERE sh.OrderYear=w.OrderYear AND sh.OrderWeek=w.OrderWeek AND sh.ProdKey=@pk),0) AS Delta
 FROM weeks w
)
SELECT
 ROUND(ISNULL((SELECT Stock FROM ProductStock WITH (UPDLOCK,HOLDLOCK)
   WHERE StockKey=@previous AND ProdKey=@pk),0)+ISNULL((SELECT SUM(Delta) FROM priorChanges),0),2) AS BeforeStock,
 ISNULL((SELECT ROUND(SUM(OutQuantity),2) FROM ViewWarehouse
   WHERE OrderYear=@yr AND OrderWeek=@wk AND ProdKey=@pk),0) AS Incoming,
 ISNULL((SELECT ROUND(SUM(OutQuantity),2) FROM ViewShipment
   WHERE OrderYear=@yr AND OrderWeek=@wk AND ProdKey=@pk AND DetailFix=1),0) AS Confirmed,
 ISNULL((SELECT ROUND(SUM(sh.AfterValue-sh.BeforeValue),2) FROM StockHistory sh
   JOIN CodeInfo ci ON ci.Category=N'StockType' AND ci.Descr=sh.ChangeType
   WHERE sh.OrderYear=@yr AND sh.OrderWeek=@wk AND sh.ProdKey=@pk),0) AS Adjustment;`;

const keyOf = change => `${change.year}${change.orderWeek.replace('-', '')}`;

export async function checkWeekdayNativeStock(tQ, sql, plans) {
  const scopes = new Map();
  for (const plan of plans) {
    const key = `${keyOf(plan.change)}|${plan.change.prodKey}`;
    const entry = scopes.get(key) || { change: plan.change, product: plan.actual?.product,
      consumed: 0, allocation: 0, yearWeek: keyOf(plan.change) };
    entry.consumed += Number(plan.lifecycle.consumedDelta);
    entry.allocation += Number(plan.delta);
    scopes.set(key, entry);
  }
  const entries = [...scopes.values()];
  const validations = [];
  for (const entry of entries) {
    const increase = normalizeShipmentQty(Math.max(entry.consumed, entry.allocation, 0));
    if (increase <= 0.000001) continue;
    const { change } = entry;
    const productEntries = entries.filter(other => String(other.change.prodKey) === String(change.prodKey));
    const result = await tQ(WEEKDAY_NATIVE_STOCK_SQL, {
      yr: { type: sql.NVarChar, value: change.year },
      wk: { type: sql.NVarChar, value: change.orderWeek },
      yearWeek: { type: sql.NVarChar, value: entry.yearWeek },
      startYearWeek: { type: sql.NVarChar, value: productEntries.map(other=>other.yearWeek).sort()[0] },
      batchWeeks: { type: sql.NVarChar, value: JSON.stringify(productEntries.map(other=>({OrderYear:other.change.year,OrderWeek:other.change.orderWeek}))) },
      pk: { type: sql.Int, value: Number(change.prodKey) },
    });
    const row = result.recordset?.[0];
    if (!row || ['BeforeStock','Incoming','Confirmed','Adjustment'].some(k => row[k] == null || !Number.isFinite(Number(row[k]))))
      throw weekdayDistributionError('WEEK_STOCK_INVALID', '차수별 재고 검산 자료가 없어 저장하지 않았습니다.', 500);
    // Earlier changes in this atomic batch have not yet reached the snapshots.
    // Later cancellations must never finance an earlier shipment.
    const priorConsumption = entries.filter(other => String(other.change.prodKey) === String(change.prodKey)
      && other.yearWeek < entry.yearWeek).reduce((sum, other) => sum + other.consumed, 0);
    const available = normalizeShipmentQty(Number(row.BeforeStock) + Number(row.Incoming)
      - Number(row.Confirmed) + Number(row.Adjustment) - priorConsumption);
    const remain = normalizeShipmentQty(available - increase);
    const productLabel = entry.product?.ProdName || String(change.prodKey);
    const validation = { prodKey: change.prodKey, productLabel, orderYear: change.year,
      orderWeek: change.orderWeek, available, increase, remain, source: 'native-week-ledger',
      beforeStock: Number(row.BeforeStock), incoming: Number(row.Incoming),
      confirmed: Number(row.Confirmed), adjustment: Number(row.Adjustment), priorConsumption };
    validations.push(validation);
    // Keep the web's millesimal shortage guard; no native integer-rounding bypass.
    if (Math.round(remain * 1000) < 0) {
      const error = weekdayDistributionError('STOCK_SHORTAGE',
        `${productLabel} · ${change.year}/${change.orderWeek} 가용재고 ${available}, 필요 ${increase}, 부족 ${-remain}입니다. 전체 변경을 저장하지 않았습니다.`, 409);
      error.stockValidation = { availability: validations, postNative: [] };
      throw error;
    }
  }
  return validations;
}
