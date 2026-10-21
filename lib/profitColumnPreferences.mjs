// Presentation preferences only: no report values, periods or credentials are stored.
export const OUTPUT_COLUMNS_KEY = 'nenova_profitReport_outputCols_v1';

export function normalizeColumnSelection(value, allowed, fallback) {
  if (!Array.isArray(value)) return [...fallback];
  if (value.length === 0) return []; // Explicitly unchecked is not a missing preference.
  const keys = allowed.filter(key => value.includes(key));
  return keys.length ? keys : [...fallback];
}

export function readColumnSelection(storage, key, allowed, fallback) {
  try {
    const raw = storage.getItem(key);
    return { columns: normalizeColumnSelection(raw == null ? null : JSON.parse(raw), allowed, fallback), error: '' };
  } catch {
    return { columns: [...fallback], error: '저장된 항목 설정을 읽지 못했습니다. 현재 선택을 다시 저장해 주세요.' };
  }
}

export function writeColumnSelection(storage, key, columns) {
  try { storage.setItem(key, JSON.stringify(columns)); return ''; }
  catch { return '브라우저 저장이 차단되어 다음 방문에는 선택이 유지되지 않을 수 있습니다.'; }
}
