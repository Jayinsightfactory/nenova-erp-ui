// Add context to a batch failure without changing the server's error or write payload.
// executionIndex is the processing order; only inputIndex points into targets.
export function formatPasteBatchFailure({ message, failedEntry, targets = [], year, week } = {}) {
  const original = String(message || '전체 일괄 처리에 실패했습니다.');
  const failed = failedEntry && typeof failedEntry === 'object' ? failedEntry : null;
  const type = String(failed?.type || '').toUpperCase();
  const custKey = Number(failed?.custKey);
  const prodKey = Number(failed?.prodKey);
  if (!['ADD', 'CANCEL'].includes(type) || !Number.isInteger(custKey) || custKey <= 0 ||
      !Number.isInteger(prodKey) || prodKey <= 0) return original;

  const inputIndex = failed.inputIndex;
  const candidate = Number.isInteger(inputIndex) && inputIndex >= 0 && inputIndex < targets.length
    ? targets[inputIndex] : null;
  const targetType = candidate?.action === '취소' || candidate?.type === 'CANCEL' ? 'CANCEL' : 'ADD';
  const target = candidate && Number(candidate.custKey) === custKey &&
    Number(candidate.prodKey) === prodKey && targetType === type ? candidate : null;

  const customer = String(failed.custName || target?.custName || '').trim();
  const alias = String(failed.inputName || target?.inputName || '').trim();
  const product = String(failed.prodName || target?.prodName || target?.displayName || '').trim();
  const qty = failed.qty ?? target?.qty;
  const unit = String(failed.unit || target?.unit || '').trim();
  const batchYear = String(year || '').trim();
  const batchWeek = String(week || '').trim();
  if ((!alias && !product) || !Number.isFinite(Number(qty)) || Number(qty) <= 0 ||
      !unit || !/^\d{4}$/.test(batchYear) || !batchWeek ||
      (/^\d{4}-/.test(batchWeek) && !batchWeek.startsWith(`${batchYear}-`))) return original;

  const scope = batchWeek.startsWith(`${batchYear}-`) ? batchWeek : `${batchYear}-${batchWeek}`;
  const action = type === 'ADD' ? '분배 추가' : '분배 취소';
  const names = alias && product && alias !== product
    ? `입력 ${alias} → 매칭 ${product} (#${prodKey})`
    : `${alias || product} (#${prodKey})`;
  return `${action} 실패: ${customer || '업체'} (#${custKey}) · ${names} · ${qty}${unit} · ${scope}\n원인: ${original}`;
}
