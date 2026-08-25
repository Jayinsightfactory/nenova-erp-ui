import { requireOrderYear } from './orderUtils.js';

function inputError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = 'PASTE_UNDO_INPUT_INVALID';
  return error;
}

export function normalizePasteUndoBatch(body = {}) {
  const entries = Array.isArray(body.entries) ? body.entries : [];
  if (!entries.length || entries.length > 1000) throw inputError('되돌릴 일괄 결과가 없습니다.');
  const scope = requireOrderYear(body.week, body.year || body.orderYear || '');
  const normalized = entries.map((row, inputIndex) => {
    const originalType = String(row.originalType || row.type || '').toUpperCase();
    if (!['ADD', 'CANCEL'].includes(originalType)) throw inputError(`${inputIndex + 1}번째 원동작이 올바르지 않습니다.`);
    const custKey = Number(row.custKey);
    const prodKey = Number(row.prodKey);
    const qty = Number(row.qty);
    const expectedOrderQty = Number(row.orderQtyAfter);
    const expectedShipmentQty = Number(row.outQtyAfter);
    if (!Number.isInteger(custKey) || custKey <= 0 || !Number.isInteger(prodKey) || prodKey <= 0 || !(qty > 0)) {
      throw inputError(`${inputIndex + 1}번째 업체·품목·수량이 올바르지 않습니다.`);
    }
    if (!Number.isFinite(expectedOrderQty) || !Number.isFinite(expectedShipmentQty)) {
      throw inputError(`${inputIndex + 1}번째 처리 직후 수량이 없어 안전하게 되돌릴 수 없습니다.`);
    }
    return {
      inputIndex, originalType,
      body: {
        custKey, prodKey, qty, unit: row.unit, year: scope.orderYear, week: scope.orderWeek, force: false,
        type: originalType === 'ADD' ? 'CANCEL' : 'ADD',
        mode: originalType === 'ADD' ? 'PASTE_UNDO_BOTH' : 'PASTE_UNDO_SHIPMENT_ONLY',
        expectedOrderQty, expectedShipmentQty,
        ...(row.editGuard ? { editGuard: row.editGuard } : {}),
        memo: `붙여넣기 전체 일괄 되돌리기: ${row.prodName || prodKey}`,
      },
    };
  });
  return {
    orderYear: scope.orderYear,
    orderWeek: scope.orderWeek,
    entries: [
      ...normalized.filter(row => row.originalType === 'ADD'),
      ...normalized.filter(row => row.originalType === 'CANCEL'),
    ],
  };
}

export async function runPasteUndoBatchTransaction({
  batch,
  user,
  capabilities,
  withTransactionFn,
  executeEntryFn,
}) {
  return withTransactionFn(async (tQ) => {
    const rows = [];
    for (let executionIndex = 0; executionIndex < batch.entries.length; executionIndex += 1) {
      const entry = batch.entries[executionIndex];
      try {
        const result = await executeEntryFn(tQ, { body: entry.body, user, capabilities });
        if (result?.verified !== true) {
          const error = new Error('되돌리기 저장 직후 전산 대조가 완료되지 않았습니다.');
          error.code = 'PASTE_UNDO_NOT_VERIFIED';
          error.statusCode = 409;
          throw error;
        }
        rows.push({ ...result, inputIndex: entry.inputIndex, originalType: entry.originalType });
      } catch (error) {
        error.failedEntry = {
          executionIndex,
          inputIndex: entry.inputIndex,
          originalType: entry.originalType,
          custKey: entry.body.custKey,
          prodKey: entry.body.prodKey,
        };
        throw error;
      }
    }
    return rows;
  });
}
