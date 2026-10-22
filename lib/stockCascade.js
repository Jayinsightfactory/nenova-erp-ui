import { runOrderStockCalculationBatch } from './orderStockCalculation.js';
import { verifyInvoiceStockReadback } from './invoiceReceiptStockReadback.js';

// Caller owns the business transaction. Never commit a mutation before CALC/readback.
export async function recalculateStockCascade(tQuery, types, scope, dependencies = {}) {
  const runNative = dependencies.runNative || runOrderStockCalculationBatch;
  const verify = dependencies.verify || verifyInvoiceStockReadback;
  const { orderYear, orderWeek, uid, prodKeys } = scope;
  const native = await runNative({ withTransactionFn: fn => fn(tQuery), types,
    orderYear, orderWeek, uid, prodKeys });
  const readback = await verify(tQuery, types, { orderYear, orderWeek }, prodKeys);
  return { native, readback };
}
