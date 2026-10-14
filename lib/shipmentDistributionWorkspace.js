const name = (value) => String(value || '').trim();
const az = (a, b) => name(a).localeCompare(name(b), 'en', { sensitivity: 'base', numeric: true });

export function sortDistributionProducts(rows = [], search = '') {
  const needle = name(search).toLocaleLowerCase();
  return [...rows].filter(row => !needle ||
    [row?.ProdName, row?.DisplayName, row?.CountryFlower].some(value =>
      name(value).toLocaleLowerCase().includes(needle)))
    .sort((a, b) => az(a?.ProdName, b?.ProdName) || Number(a?.ProdKey) - Number(b?.ProdKey));
}

export function sortDistributionCustomers(rows = [], search = '') {
  const needle = name(search).toLocaleLowerCase();
  return [...rows].filter(row => !needle || name(row?.CustName).toLocaleLowerCase().includes(needle))
    .sort((a, b) => az(a?.CustName, b?.CustName) || Number(a?.CustKey) - Number(b?.CustKey));
}

export function distributionQuantityRemark(persisted, before, draft, unit = '') {
  const original = name(persisted);
  const oldQty = Number(before || 0);
  const newQty = Number(draft || 0);
  if (!Number.isFinite(newQty) || oldQty === newQty) return original || '—';
  return `${original ? `${original} · ` : ''}미저장 ${oldQty.toLocaleString()} → ${newQty.toLocaleString()}${name(unit)}`;
}

export function hasDistributionDrafts(custDist = [], outInputs = {}, custItems = [], custEditInputs = {}) {
  return custDist.some(row => Number(outInputs[row.CustKey] ?? row.출고수량 ?? 0) !== Number(row.출고수량 ?? 0)) ||
    custItems.some(row => {
      const edit = custEditInputs[row.ProdKey] || {};
      return Number(edit.outQty ?? row.출고수량 ?? 0) !== Number(row.출고수량 ?? 0) ||
        Number(edit.cost ?? row.Cost ?? 0) !== Number(row.Cost ?? 0);
    });
}

export function parseDistributionFavorite(row) {
  try {
    const data = JSON.parse(row?.FilterData || '{}');
    const prodKey = Number(data.prodKey);
    const favoriteKey = Number(row?.FavoriteKey);
    return Number.isSafeInteger(prodKey) && prodKey > 0 &&
      Number.isSafeInteger(favoriteKey) && favoriteKey > 0
      ? { prodKey, favoriteKey } : null;
  } catch { return null; }
}

export function distributionWeekOptions(value, radius = 3) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return [];
  const year = Number(match[1]);
  const center = Number(match[2]);
  const options = [];
  for (let offset = -radius; offset <= radius; offset += 1) {
    let candidateYear = year;
    let candidateWeek = center + offset;
    if (candidateWeek < 1) { candidateYear -= 1; candidateWeek += 52; }
    if (candidateWeek > 52) { candidateYear += 1; candidateWeek -= 52; }
    for (let suffix = 1; suffix <= 4; suffix += 1) {
      options.push(`${candidateYear}-${String(candidateWeek).padStart(2, '0')}-${String(suffix).padStart(2, '0')}`);
    }
  }
  return options;
}
