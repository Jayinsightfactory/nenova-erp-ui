// Shared browser/server interpretation: empty preserves ERP; explicit zero is a price.
export function normalizeVolumeUnitPrice(value) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
  const price = Number(value);
  if (!['number', 'string'].includes(typeof value) || !Number.isFinite(price) || price < 0 || price > 1_000_000_000) {
    const error = new Error('원화 단가는 공란 또는 0~1,000,000,000 범위의 숫자로 입력하세요.');
    error.code = 'INVALID_KRW_PRICE';
    error.statusCode = 400;
    throw error;
  }
  return price;
}
