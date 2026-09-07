// Pure Shilla same-hotel matching.  Database callers decide which saved rows are
// active; this module only applies the deliberately narrow name/unit identity.

export function normalizeShillaHotelMatchText(value) {
  return String(value ?? '').replace(/[\s\u00a0]+/g, ' ').trim();
}

function ordinary(row) {
  return !(row?.isCustom ?? row?.IsCustom);
}

function positiveProdKey(row) {
  const value = row?.prodKey ?? row?.ProdKey;
  const key = Number(value);
  return Number.isInteger(key) && key > 0 ? key : null;
}

/** Exact normalized source name + unit; custom rows deliberately have no group. */
export function shillaHotelMatchKey(row) {
  if (!ordinary(row)) return null;
  const name = normalizeShillaHotelMatchText(row?.name ?? row?.ItemName);
  const unit = normalizeShillaHotelMatchText(row?.unit ?? row?.Unit);
  return name && unit ? `${name}\u0000${unit}` : null;
}

/**
 * Apply only an already-saved, unique active Product mapping to blank ordinary
 * import rows.  Conflicts and inactive/deleted Products are excluded by the
 * caller's candidate query, so this function never guesses between keys.
 */
export function applyShillaHotelAutoMatches(items, activeMappings) {
  const keysByGroup = new Map();
  for (const row of activeMappings || []) {
    const group = shillaHotelMatchKey(row);
    const prodKey = positiveProdKey(row);
    if (!group || !prodKey) continue;
    if (!keysByGroup.has(group)) keysByGroup.set(group, new Set());
    keysByGroup.get(group).add(prodKey);
  }

  let autoMatchedCount = 0;
  const matched = (items || []).map(item => {
    const group = shillaHotelMatchKey(item);
    if (!group || positiveProdKey(item)) return item;
    const candidates = keysByGroup.get(group);
    if (!candidates || candidates.size !== 1) return item;
    autoMatchedCount += 1;
    return { ...item, prodKey: [...candidates][0] };
  });
  return { items: matched, autoMatchedCount };
}
