// 도착원가 화면 — 차수>국가>품종>품목 그룹과 농장별 원가 표시. DB 없이 순수 함수만.

export function arrivalCostGroupKey(row = {}) {
  const productId = Number(row.prodKey) > 0
    ? `pk:${Number(row.prodKey)}`
    : `raw:${String(row.productNameRaw || row.displayName || '').trim()}`;
  return [
    String(row.orderWeek || ''),
    String(row.countryName || row.dbCountryName || '').trim(),
    String(row.countryFlower || '').trim(),
    productId,
  ].join('|');
}

export function groupArrivalCostRows(rows = []) {
  const groups = [];
  const index = new Map();
  for (const row of rows) {
    const key = arrivalCostGroupKey(row);
    let group = index.get(key);
    if (!group) {
      group = {
        key,
        orderWeek: row.orderWeek || '',
        countryName: row.countryName || row.dbCountryName || '',
        countryFlower: row.countryFlower || '',
        productName: row.displayName || row.prodName || row.productNameRaw || '',
        productNameRaw: row.productNameRaw || '',
        rows: [],
      };
      index.set(key, group);
      groups.push(group);
    }
    group.rows.push(row);
  }
  return groups;
}

function farmLabel(row = {}) {
  return String(row.farmName || row.autoFarmName || row.farmNameRaw || '').trim() || '농장미지정';
}

function rowCost(row = {}) {
  const selected = Number(row.selectedArrivalCostKRW);
  if (Number.isFinite(selected) && selected !== 0) return selected;
  const source = Number(row.sourceArrivalCostKRW);
  return Number.isFinite(source) ? source : null;
}

export function formatFarmCostSummary(rows = [], formatNumber = (value) => (
  Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 0 })
)) {
  const parts = [];
  const seen = new Set();
  for (const row of rows) {
    const farm = farmLabel(row);
    let part;
    if (row.uploadStatus === 'COST_NOT_UPLOADED') part = farm + ' 원가 미업로드';
    else {
      const cost = rowCost(row);
      part = cost == null ? farm + ' -원' : farm + ' ' + formatNumber(cost) + '원';
    }
    if (seen.has(part)) continue;
    seen.add(part);
    parts.push(part);
  }
  return parts.join(' / ');
}

export function sectionArrivalCostGroupsByWeek(groups = []) {
  const sections = [];
  for (const group of groups) {
    const orderWeek = String(group.orderWeek || '');
    const last = sections[sections.length - 1];
    if (!last || last.orderWeek !== orderWeek) sections.push({ orderWeek, groups: [group] });
    else last.groups.push(group);
  }
  return sections;
}

export function arrivalWeightMode(grossWeight, chargeableWeight) {
  const gw = Number(grossWeight);
  const cw = Number(chargeableWeight);
  if (!(gw > 0) || !(cw > 0)) return 'UNKNOWN';
  return cw > gw ? 'VOLUME' : 'WEIGHT';
}

export function arrivalFlowerFamily(row = {}) {
  const text = [
    row.flowerNameRaw, row.countryFlower, row.dbFlowerName,
    row.productNameRaw, row.displayName, row.prodName,
  ].map((v) => String(v || '')).join(' ');
  if (/카네이션|carnation/i.test(text)) return 'CARNATION';
  if (/알스트로|alstro/i.test(text)) return 'ALSTRO';
  if (/장미|rose/i.test(text)) return 'ROSE';
  return 'OTHER';
}

export function isColombiaArrivalRow(row = {}) {
  const text = [
    row.countryName, row.dbCountryName, row.countryFlower,
    row.flowerNameRaw, row.productNameRaw,
  ].map((value) => String(value || '')).join(' ');
  return /콜롬비아|colombia/i.test(text);
}

export function arrivalRowVisibleByWeight(row = {}) {
  if (!isColombiaArrivalRow(row)) return true;
  const mode = arrivalWeightMode(row.grossWeight, row.chargeableWeight);
  if (mode === 'UNKNOWN') return true;
  const family = arrivalFlowerFamily(row);
  if (mode === 'VOLUME') return family === 'ROSE';
  return family !== 'ROSE';
}

export function filterArrivalRowsByWeight(rows = []) {
  return rows.filter(arrivalRowVisibleByWeight);
}

export function arrivalWeightHint(row = {}) {
  if (!isColombiaArrivalRow(row)) return '';
  const mode = arrivalWeightMode(row.grossWeight, row.chargeableWeight);
  const week = String(row.orderWeek || '').trim();
  if (mode === 'VOLUME') return (week + ' 콜롬비아 CW>GW · 장미만').trim();
  if (mode === 'WEIGHT') return (week + ' 콜롬비아 CW≤GW · 카네이션·알스트로').trim();
  return '';
}

export function arrivalWeightHints(rows = []) {
  const seen = new Set();
  const hints = [];
  for (const row of rows) {
    const hint = arrivalWeightHint(row);
    if (!hint || seen.has(hint)) continue;
    seen.add(hint);
    hints.push(hint);
  }
  return hints;
}

export function normalizeWeekOrder(value) {
  return String(value || '').toLowerCase() === 'asc' ? 'asc' : 'desc';
}
