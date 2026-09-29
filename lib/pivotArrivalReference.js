// Uploaded arrival ledger references; no writes and no fuzzy product matching.
import { convertArrivalUnitCost } from './catalogUnitMatch.js';

export function pivotArrivalWeek(value) {
  const match = String(value ?? '').trim().match(/^(\d{1,2})-(\d{1,2})$/);
  return match && +match[1] > 0 && +match[2] > 0 ? +match[1] * 100 + +match[2] : null;
}
export const pivotArrivalKey = row => [String(row.OrderYear), pivotArrivalWeek(row.OrderWeek), Number(row.ProdKey)].join('|');
const unit = value => /^(대|st|stems?|스팀)$/i.test(String(value).trim()) ? '송이' : String(value ?? '').trim();

function convertedCost(row) {
  const raw = row.SelectedArrivalCostKRW;
  const cost = Number(raw);
  const from = unit(row.ArrivalUnit), to = unit(row.OutUnit);
  if (raw == null || raw === '' || cost < 0 || !Number.isFinite(cost) || !from || !to) return null;
  if (cost === 0) return convertedCost({ ...row, SelectedArrivalCostKRW: 1 }) != null ? 0 : null;
  const bundle = from.match(/^단\s*[-(]\s*([1-9]\d*)\s*(?:스팀|송이|대|stems?|st)\s*\)?$/i);
  const count = bundle ? Number(bundle[1]) : from === '단' ? Number(row.SourceStemsPerBunch) : 0;
  if (count > 0 && (bundle || to !== '단')) return convertArrivalUnitCost(cost / count, '송이', to, row);
  return convertArrivalUnitCost(cost, from, to, row);
}

export function buildPivotArrivalReferences(targetRows = [], sources = []) {
  const groups = new Map();
  for (const source of sources) {
    const week = pivotArrivalWeek(source.OrderWeek);
    if (!week || !/^\d{4}$/.test(String(source.OrderYear)) || !(Number(source.ProdKey) > 0) || source.IsCurrent === 0) continue;
    const key = `${source.OrderYear}|${Number(source.ProdKey)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...source, week });
  }
  const result = {};
  for (const target of targetRows) {
    const key = pivotArrivalKey(target);
    if (Object.hasOwn(result, key)) continue;
    const targetWeek = pivotArrivalWeek(target.OrderWeek);
    const candidates = (groups.get(`${target.OrderYear}|${Number(target.ProdKey)}`) || []).filter(row => targetWeek && row.week <= targetWeek);
    const latest = candidates.reduce((n, row) => Math.max(n, row.week), 0);
    const current = candidates.filter(row => row.week === latest);
    // A broken current unit must not be silently replaced with a historical price.
    const converted = current.map(row => ({ row, cost: convertedCost(row) }));
    const best = converted.filter(x => x.cost != null && Number.isFinite(x.cost)).sort((a, b) => b.cost - a.cost)[0];
    result[key] = best ? {
      arrivalCost: best.cost, sourceWeek: best.row.OrderWeek, unit: best.row.OutUnit,
      isFallback: latest < targetWeek,
    } : null;
  }
  return result;
}
