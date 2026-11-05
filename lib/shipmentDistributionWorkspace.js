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
export function distributionSaveLogLine({ mode, name: target, week, savedCount, totalQty, error, skipped, orderCount }, now = new Date()) {
  const two = (n) => String(n).padStart(2, '0');
  const stamp = `${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}`;
  const head = `${stamp} ${name(week)} ${mode === 'cust' ? '업체' : '품목'} ${name(target)}`;
  if (skipped) return `${head} — 변경 없음, 저장 생략`;
  if (error) return `${head} — 저장 실패: ${name(error)}`;
  const orders = Number(orderCount || 0) > 0 ? ` · 주문등록 ${Number(orderCount)}건` : '';
  return `${head} — 저장 완료 ${Number(savedCount || 0)}건 · 총 ${Number(totalQty || 0).toLocaleString()}${orders}`;
}

// 한쪽 업체의 출고수량 일부(또는 전부)를 다른 쪽으로 옮기는 계산. requested 가 비어 있으면 전부.
// 보내는 쪽보다 많이는 못 옮기고, 0 이하면 아무것도 옮기지 않는다 (화면 입력값만; 주문수량은 건드리지 않음).
export function planDistributionMove({ fromQty, toQty, requested }) {
  const from = Math.max(0, Number(fromQty) || 0);
  const to = Math.max(0, Number(toQty) || 0);
  const wanted = requested === '' || requested === undefined || requested === null ? from : Number(requested);
  const moved = Math.round(Math.min(from, Number.isFinite(wanted) ? wanted : 0) * 100) / 100;
  if (moved <= 0) return { moved: 0, fromAfter: from, toAfter: to };
  return { moved, fromAfter: Math.round((from - moved) * 100) / 100, toAfter: Math.round((to + moved) * 100) / 100 };
}

// 받는 업체에 주문이 없던 품목(pendingOrder)에 수량이 들어간 행 → 저장 직전 주문등록할 품목 목록.
// 수량이 0으로 돌아간 행은 주문등록하지 않는다. 주문수량 = 분배수량(품목 OutUnit 단위).
export function pendingDistributionOrderItems(items = [], inputs = {}) {
  return items
    .filter(item => item?.pendingOrder)
    .map(item => ({ prodKey: Number(item.ProdKey), qty: Number(inputs[item.ProdKey]?.outQty) || 0, unit: item.OutUnit || '박스' }))
    .filter(item => item.qty > 0);
}

// 주문이 없는 업체에 품목을 옮길 때 화면에 먼저 만드는 임시 행 (주문수량 0, 저장 시 주문등록 후 분배)
export function pendingDistributionItem(source) {
  return { ProdKey: source.ProdKey, ProdName: source.ProdName, DisplayName: source.DisplayName, FlowerName: source.FlowerName,
    CounName: source.CounName, OutUnit: source.OutUnit, Cost: source.Cost || 0, 주문수량: 0, 출고수량: 0, ShipmentDescr: '', pendingOrder: true };
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
