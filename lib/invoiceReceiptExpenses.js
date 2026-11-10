import { getInvoiceDocument } from './invoiceReceiptDocuments.js';
import { readVerifiedInvoiceReceiptLines } from './invoiceReceiptCost.js';

// Money remains in its source currency, separate from physical quantities.
export function invoiceExpenseValues(document) {
  const meta = document.reviewedMetadata || {};
  const entries = Object.entries(meta.costInputs || {}).map(([kind, item]) => {
    if (!item || typeof item.amount !== 'number' || !Number.isFinite(item.amount) || item.amount < 0
      || !/^[A-Z]{3}$/.test(item.currency || '')) throw Object.assign(new Error('입고 비용의 금액·통화를 확인하세요.'), { statusCode: 409 });
    return { kind, currency: item.currency, amount: item.amount };
  });
  const totals = entries.reduce((sum, item) => ({ ...sum, [item.currency]: (sum[item.currency] ?? 0) + item.amount }), {});
  return { entries, totals, unclassified: meta.unclassifiedAdditionalCharges ?? null };
}

export async function readInvoiceReceiptExpenses({ queryFn, types, warehouseKey }) {
  const key = Number(warehouseKey);
  if (!Number.isSafeInteger(key) || key < 1) throw Object.assign(new Error('입고 번호를 확인하세요.'), { statusCode: 400 });
  const result = await queryFn(`/* invoice-expenses:committed-scope */ SELECT DISTINCT d.DocumentId
    FROM dbo.WebInvoiceDocument d JOIN dbo.WebInvoiceOperation o ON o.DocumentId=d.DocumentId
    WHERE o.WarehouseKey=@warehouseKey AND o.Status=N'COMMITTED'
      AND d.ReceiptStatus=N'COMMITTED' AND o.DocumentRevision=d.Revision`, {
    warehouseKey: { type: types.Int, value: key },
  });
  const rows = result?.recordset;
  if (!Array.isArray(rows)) throw Object.assign(new Error('입고 비용 연결 조회 결과를 확인하지 못했습니다.'), { statusCode: 503 });
  if (!rows.length) return null;
  if (rows.length !== 1) throw Object.assign(new Error('이 입고에 연결된 비용 문서가 여러 개입니다. 확인이 필요합니다.'), { statusCode: 409 });
  const document = await getInvoiceDocument({ queryFn, types, documentId: String(rows[0].DocumentId) });
  if (!document) throw Object.assign(new Error('연결된 입고 문서가 변경되었습니다. 다시 조회하세요.'), { statusCode: 409 });
  let verified;
  try { verified = await readVerifiedInvoiceReceiptLines({ queryFn, types, document }); }
  catch (error) {
    if (error.code !== 'RECEIPT_CHANGED') throw error;
    return { entries: [], totals: {}, verified: false, warehouseKey: key,
      orderYear: document.orderYear, orderWeek: document.orderWeek,
      warning: '전산에서 입고가 변경되어 과거 웹 비용은 적용하지 않았습니다. 현재 원장 운송료를 사용하며, 없으면 비용 확인이 필요합니다.' };
  }
  if (Number(verified.operation.warehouseKey) !== key) throw Object.assign(new Error('입고와 비용 문서의 연결이 다릅니다.'), { statusCode: 409 });
  return { ...invoiceExpenseValues(document), documentId: document.documentId, orderYear: document.orderYear,
    orderWeek: document.orderWeek, warehouseKey: key, verified: true };
}

export function receiptFreightAmount(source, legacyAmount) {
  const expenses = source.receiptExpenses;
  if (!expenses) return legacyAmount;
  if (expenses.verified === false && expenses.entries.length === 0) return legacyAmount;
  if (expenses.orderYear !== source.orderYear || expenses.orderWeek !== source.orderWeek
    || Number(expenses.warehouseKey) !== Number(source.warehouseKey) || !expenses.verified)
    throw Object.assign(new Error('입고 비용의 연도·차수·입고 연결을 확인하세요.'), { statusCode: 409 });
  const cost = expenses.entries.filter(e => ['freight', 'docFee'].includes(e.kind));
  if (!cost.length) return legacyAmount;
  if (expenses.unclassified || cost.some(e => e.currency !== 'EUR')) throw Object.assign(new Error('운송비 통화·비용 구분을 확인하세요.'), { statusCode: 409 });
  const total = cost.reduce((sum, e) => sum + e.amount, 0);
  if (legacyAmount != null && Math.abs(total - legacyAmount) > 0.01)
    throw Object.assign(new Error('전산 운송료와 웹 입고 비용이 다릅니다. 중복 가산하지 않았습니다.'), { statusCode: 409 });
  return legacyAmount ?? total;
}
