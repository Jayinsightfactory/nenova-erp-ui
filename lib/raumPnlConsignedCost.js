// Pure helpers linking an ordinary WebRaumPnlItem row to its (사입) consigned counterpart by
// product name+unit only. Quantity/SalePrice/SaleAmount/IsConsigned rows are never merged —
// only a single unambiguous CostPrice is copied into a blank/previously-linked consigned row.
// Used by pages/raum/pnl.js (live edit), lib/raumPnl.js (server save, both single-week and
// multi-week import), and lib/raumPnlCostComparison.js (shared purchase-cost matrix identity).
const normSpace = value => String(value == null ? '' : value).replace(/[\s ]+/g, ' ').trim();
const normUnit = value => normSpace(value).toLowerCase();

// Trailing "(사입)" / "（사입）" / " 사입" display suffix — leading/embedded "사입" is left alone.
const CONSIGNED_SUFFIX_RE = /(?:[\s ]*[(（]\s*사입\s*[)）]|[\s ]+사입)[\s ]*$/u;

/** Strip a trailing (사입)/사입 suffix for matching identity only — never mutates the stored ItemName. */
export function stripConsignedSuffix(name) {
  const trimmed = normSpace(name);
  const stripped = normSpace(trimmed.replace(CONSIGNED_SUFFIX_RE, ''));
  return stripped || trimmed;
}

function isCustomRow(item) {
  return !!(item?.isCustom ?? item?.IsCustom);
}
function isConsignedRow(item) {
  return !!(item?.consigned ?? item?.IsConsigned);
}
function itemName(item) {
  return item?.name ?? item?.Name ?? item?.itemName ?? item?.ItemName;
}
function itemUnit(item) {
  return item?.unit ?? item?.Unit;
}
function itemCostValue(item) {
  const cost = item?.costPrice ?? item?.CostPrice;
  if (cost == null || String(cost).trim() === '') return null;
  const number = Number(cost);
  return Number.isFinite(number) ? number : null;
}

/** name+unit matching key shared between an ordinary row and its (사입) counterpart. ProdKey/IsCustom excluded. */
export function raumPnlConsignedMatchKey(item) {
  const name = stripConsignedSuffix(itemName(item));
  const unit = normUnit(itemUnit(item));
  return name ? `name:${name}|unit:${unit}` : null;
}

/**
 * For every blank-cost consigned row, when the ordinary (non-custom, non-consigned) rows
 * sharing the same suffix-stripped name+unit carry exactly one distinct cost value, copy that
 * value in with CostSource 'linked'. A manually entered/existing non-linked consigned cost is
 * always preserved. A value previously filled with CostSource 'linked' follows the unique
 * ordinary cost when that cost is edited. Multiple differing candidates are never averaged or
 * guessed. Returns the same array reference when nothing changes.
 */
export function fillConsignedCostsFromOrdinary(items) {
  const list = Array.isArray(items) ? items : [];
  const candidatesByKey = new Map();
  for (const item of list) {
    if (isCustomRow(item) || isConsignedRow(item)) continue;
    const cost = itemCostValue(item);
    if (cost == null) continue;
    const key = raumPnlConsignedMatchKey(item);
    if (!key) continue;
    if (!candidatesByKey.has(key)) candidatesByKey.set(key, new Set());
    candidatesByKey.get(key).add(cost);
  }
  let changed = false;
  const next = list.map(item => {
    if (isCustomRow(item) || !isConsignedRow(item)) return item;
    const existingCost = itemCostValue(item);
    const source = item?.costSource ?? item?.CostSource;
    if (existingCost != null && source !== 'linked') return item;
    const key = raumPnlConsignedMatchKey(item);
    const candidates = key ? candidatesByKey.get(key) : null;
    if (!candidates || candidates.size !== 1) return item;
    const [value] = candidates;
    if (existingCost === value && source === 'linked') return item;
    changed = true;
    return { ...item, costPrice: value, costSource: 'linked' };
  });
  return changed ? next : list;
}
