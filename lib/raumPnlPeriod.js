// Web settlement periods are not ERP OrderWeek subweeks. Keep the complete key
// for settlement identity; derive baseMajor only at an explicit ERP read boundary.
export function parsePnlPeriod(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'number' && (!Number.isInteger(value) || value < 1 || value > 99)) return null;
  const text = String(value);
  const match = text.match(/^(0?[1-9]|[1-9][0-9])(?:-([1-9]))?$/);
  if (!match) return null;
  const major = Number(match[1]);
  const baseMajor = String(major).padStart(2, '0');
  const subPeriod = match[2] == null ? null : Number(match[2]);
  const key = subPeriod == null ? baseMajor : `${baseMajor}-${subPeriod}`;
  return { key, baseMajor, subPeriod, label: `${major}${subPeriod == null ? '' : `-${subPeriod}`}차` };
}

export function normalizePnlPeriod(value, { allowSubPeriod = false } = {}) {
  const parsed = parsePnlPeriod(value);
  if (!parsed) throw new Error('결산 차수는 1~99 또는 신라 하위 기간 1~9 형식으로 입력하세요 (예: 39, 39-2).');
  if (parsed.subPeriod != null && !allowSubPeriod) throw new Error('하위 결산 기간은 신라호텔에서만 사용할 수 있습니다.');
  return parsed.key;
}

export function formatPnlPeriod(value) {
  return parsePnlPeriod(value)?.label ?? null;
}

// Preserve the legacy numeric shape for ordinary weeks in existing DTOs.
export function pnlPeriodValue(value) {
  const parsed = parsePnlPeriod(value);
  if (!parsed) return null;
  return parsed.subPeriod == null ? Number(parsed.baseMajor) : parsed.key;
}

export function comparePnlPeriods(a, b) {
  const left = parsePnlPeriod(a);
  const right = parsePnlPeriod(b);
  if (!left || !right) throw new Error('정렬할 결산 차수가 올바르지 않습니다.');
  return Number(left.baseMajor) - Number(right.baseMajor)
    || (left.subPeriod ?? 0) - (right.subPeriod ?? 0);
}

export function pnlPeriodBaseMajor(value) {
  const parsed = parsePnlPeriod(value);
  if (!parsed) throw new Error('ERP 참조를 위한 결산 차수가 올바르지 않습니다.');
  return parsed.baseMajor;
}
