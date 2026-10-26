import { shiftOrderWeek } from './orderUtils.js';

export function normalizeRoundInput(value) {
  const match = String(value ?? '').trim().match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);
  if (!match) return '';
  const major = Number(match[1]);
  const sub = Number(match[2]);
  if (major < 1 || major > 52 || sub < 1 || sub > 4) return '';
  return `${String(major).padStart(2, '0')}-${String(sub).padStart(2, '0')}`;
}

export function roundOrdinal(value) {
  const normalized = normalizeRoundInput(value);
  if (!normalized) return NaN;
  const [major, sub] = normalized.split('-').map(Number);
  return (major - 1) * 4 + sub;
}

export function volumeMenuQuickWeeks(baseWeek) {
  const base = normalizeRoundInput(baseWeek);
  if (!base) return [];
  const options = [base];
  for (const direction of [-1, 1]) {
    let current = base;
    for (let step = 0; step < 5; step += 1) {
      const next = shiftOrderWeek(current, direction);
      if ((roundOrdinal(next) - roundOrdinal(current)) * direction <= 0) break;
      if (direction < 0) options.unshift(next); else options.push(next);
      current = next;
    }
  }
  return options;
}

export function volumeMenuQuery(year, start, end, rangeMode = false) {
  return { orderYear: String(year), weekStart: start, weekEnd: rangeMode === true ? end : start };
}
