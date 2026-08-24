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
  return rows.map((row) => {
    const farm = farmLabel(row);
    if (row.uploadStatus === 'COST_NOT_UPLOADED' || row.uploadStatus === 'COST_NOT_UPLOADED') return `${farm} 원가 미업로드`;
    const cost = rowCost(row);
    if (cost == null) return `${farm} -원`;
    return `${farm} ${formatNumber(cost)}원`;
  }).join(' / ');
}

export function normalizeWeekOrder(value) {
  return String(value || '').toLowerCase() === 'asc' ? 'asc' : 'desc';
}
