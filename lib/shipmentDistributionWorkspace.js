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

// nenova.exe 출고분배와 같은 버튼형 차수 선택: 기준 차수 앞뒤 ±radius 대차수(최대 2*radius+1개), 같은 연도·세부차수 유지
export function distributionWeekButtons(value, radius = 3) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return [];
  const [, year, center, suffix] = match;
  const buttons = [];
  for (let offset = -radius; offset <= radius; offset += 1) {
    const major = Number(center) + offset;
    if (major < 1 || major > 52) continue;
    buttons.push(`${year}-${String(major).padStart(2, '0')}-${suffix}`);
  }
  return buttons;
}

// 세부차수(-01~-04) 버튼: 같은 연도·대차수 유지
export function distributionSubWeekButtons(value, count = 4) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return [];
  const [, year, major] = match;
  return Array.from({ length: count }, (_, index) => `${year}-${major}-${String(index + 1).padStart(2, '0')}`);
}

// Ctrl+S / 저장 버튼 결과를 화면 로그 한 줄로
export function distributionSaveLogLine({ mode, name: target, week, savedCount, totalQty, error, skipped }, now = new Date()) {
  const two = (n) => String(n).padStart(2, '0');
  const stamp = `${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}`;
  const head = `${stamp} ${name(week)} ${mode === 'cust' ? '업체' : '품목'} ${name(target)}`;
  if (skipped) return `${head} — 변경 없음, 저장 생략`;
  if (error) return `${head} — 저장 실패: ${name(error)}`;
  return `${head} — 저장 완료 ${Number(savedCount || 0)}건 · 총 ${Number(totalQty || 0).toLocaleString()}`;
}

// 두 업체의 custItems를 품목(ProdKey) 기준으로 합쳐 나란히 보기 행으로 (ProdName A-Z). a/b는 해당 업체에 주문이 없으면 null
export function mergeDistributionCustomerItems(itemsA = [], itemsB = []) {
  const rows = new Map();
  const put = (item, side) => {
    const key = Number(item?.ProdKey);
    if (!Number.isFinite(key)) return;
    const row = rows.get(key) || { ProdKey: key, ProdName: item.ProdName, DisplayName: item.DisplayName,
      OutUnit: item.OutUnit, CounName: item.CounName, FlowerName: item.FlowerName, a: null, b: null };
    row[side] = item;
    rows.set(key, row);
  };
  itemsA.forEach(item => put(item, 'a'));
  itemsB.forEach(item => put(item, 'b'));
  return sortDistributionProducts([...rows.values()]);
}
