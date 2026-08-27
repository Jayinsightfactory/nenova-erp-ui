import { defaultUnit, normalizeOrderUnit } from './orderUtils.js';

export function parseExplicitOrderUnit(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const compact = raw.replace(/\s+/g, '').toLowerCase();
  if (/^(?:박스|boxes?|box|bx)$/.test(compact)) return '박스';
  if (/^(?:단|bunch(?:es)?|bun)$/.test(compact)) return '단';
  if (/^(?:송이|개)(?:\(대\))?$|^(?:스팀|스템)(?:\(대\))?$|^stems?$|^steam$/.test(compact)) return '송이';
  return '';
}

export function resolvePasteOrderUnit({ prod, parsedUnit, unitExplicit, prodUnitMap = {} } = {}) {
  const explicitUnit = unitExplicit ? parseExplicitOrderUnit(parsedUnit) : '';
  if (explicitUnit) return explicitUnit;
  return normalizeOrderUnit(defaultUnit(prod, '', prodUnitMap));
}
