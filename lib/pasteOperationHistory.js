import { normalizeOrderHistorySearch } from './orderHistorySearch.js';

const text = value => typeof value === 'string' ? value.slice(0, 300) : '';
const number = value => value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
export function parsePasteOperation(row) {
  let payload, incomplete = false;
  try { payload = JSON.parse(row.Payload); } catch {
    // Only the known top-level legacy prefix is recoverable. Never inspect nested fragments.
    const match = String(row.Payload || '').match(/^\s*\{\s*"week"\s*:\s*"(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}-\d{1,2})"\s*,\s*"year"\s*:\s*"?(\d{4})"?\s*,\s*"entries"\s*:\s*\[/);
    if (!match) return null;
    payload = { week: match[1], year: match[2], entries: [] }; incomplete = true;
  }
  if (!payload || typeof payload !== 'object' || !payload.year) return null;
  let scope;
  try { scope = normalizeOrderHistorySearch({ year: String(payload.year), week: payload.week }); } catch { return null; }
  if (!scope.week || scope.majorOnly) return null;
  const committedMatch = String(row.ResultDesc || '').match(/(?:^|;\s*)committed=(\d+)(?:;|$)/);
  const committed = number(payload.committedCount) ?? (committedMatch ? Number(committedMatch[1]) : null);
  const preview = payload.preflightOnly === true || (row.Result === 'SUCCESS' && committed === 0);
  const status = preview ? 'preview' : row.Result === 'SUCCESS' && committed > 0 ? 'committed' : row.Result === 'SUCCESS' ? 'unknown' : 'failed';
  const entries = (Array.isArray(payload.entries) ? payload.entries : []).map(entry => ({
    type: ['ADD', 'CANCEL'].includes(entry?.type) ? entry.type : 'UNKNOWN',
    custKey: number(entry?.custKey), prodKey: number(entry?.prodKey),
    custName: text(entry?.custName), prodName: text(entry?.prodName),
    qty: number(entry?.qty), unit: text(entry?.unit),
  }));
  return { key: Number(row.LogKey), at: text(row.ActionDtm), actor: text(row.Actor),
    year: scope.year, week: scope.week, status, committedCount: committed,
    undo: row.ActionType === 'SHIPMENT_ADJUST_BATCH_UNDO',
    incomplete: incomplete || payload.incomplete === true || !Array.isArray(payload.entries) || (status === 'committed' && entries.length !== committed), entries };
}

export function matchesPasteOperation(operation, scope) {
  if (!operation || operation.year !== scope.year) return false;
  if (scope.week && (scope.majorOnly ? !operation.week.startsWith(scope.week + '-') : operation.week !== scope.week)) return false;
  const contains = (value, search) => search.toLowerCase().split(/\s+/).filter(Boolean).every(token => value.toLowerCase().includes(token));
  // A matching row selects the whole operation, retaining its other customer/add/cancel rows.
  return !scope.custName && !scope.prodName || operation.entries.some(entry =>
    contains(entry.custName, scope.custName) && contains([entry.prodName, entry.flowerName, entry.counName].filter(Boolean).join(' '), scope.prodName));
}
