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

export function rowCost(row = {}) {
  const selected = Number(row.selectedArrivalCostKRW);
  if (Number.isFinite(selected) && selected !== 0) return selected;
  const source = Number(row.sourceArrivalCostKRW);
  return Number.isFinite(source) ? source : null;
}

/**
 * @param {*} rows
 * @param {(value:number)=>string} [formatNumber]
 * @param {(row:*)=>number|null} [costFn] 행별 원가 계산 override — 기본은 rowCost(원본 표시원가).
 *   환율 재계산 미리보기처럼 화면에서만 다른 값을 보여주고 싶을 때 주입한다.
 */
export function formatFarmCostSummary(rows = [], formatNumber = (value) => (
  Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 0 })
), costFn = rowCost) {
  const parts = [];
  const seen = new Set();
  for (const row of rows) {
    const farm = farmLabel(row);
    let part;
    if (row.uploadStatus === 'COST_NOT_UPLOADED') part = farm + ' 원가 미업로드';
    else {
      const cost = costFn(row);
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

export function arrivalWeightActivePhrase(mode) {
  if (mode === 'VOLUME') return '콜롬비아장미 면 활성화';
  if (mode === 'WEIGHT') return '콜롬비아카네이션·알스트로 면 활성화';
  return '';
}

export function arrivalWeightHint(row = {}) {
  if (!isColombiaArrivalRow(row)) return '';
  const phrase = arrivalWeightActivePhrase(arrivalWeightMode(row.grossWeight, row.chargeableWeight));
  if (!phrase) return '';
  const week = String(row.orderWeek || '').trim();
  return week ? `${week} ${phrase}` : phrase;
}

export function arrivalVarietyWeightActive(varietyName, rows = []) {
  const name = String(varietyName || '');
  if (!/콜롬비아|colombia/i.test(name)) return false;
  const family = arrivalFlowerFamily({ countryFlower: name, flowerNameRaw: name, productNameRaw: name });
  for (const row of rows) {
    if (!isColombiaArrivalRow(row)) continue;
    const mode = arrivalWeightMode(row.grossWeight, row.chargeableWeight);
    if (mode === 'VOLUME' && family === 'ROSE') return true;
    if (mode === 'WEIGHT' && (family === 'CARNATION' || family === 'ALSTRO')) return true;
  }
  return false;
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

const DEPRECATED_ORIGIN_PREFIX = /^(?:사용금지|단종|폐기|미사용)\s*/i;

export function cleanArrivalVarietyTabLabel(name = '') {
  const raw = String(name || '').trim();
  if (!raw) return '';
  if (raw === '사용금지수국') return '수국';
  const stripped = raw.replace(DEPRECATED_ORIGIN_PREFIX, '').trim();
  return stripped || '기타';
}

export function normalizeArrivalVarietyTabs(list = []) {
  const seen = new Set();
  const out = [];
  for (const item of list || []) {
    const cleaned = cleanArrivalVarietyTabLabel(item);
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out;
}

export function cleanArrivalFlowerChip(row = {}) {
  const explicit = [row.dbFlowerName, row.flowerNameRaw]
    .map(v => String(v || '').replace(DEPRECATED_ORIGIN_PREFIX, '').trim())
    .find(Boolean);
  const hay = [
    explicit,
    row.countryFlower,
    row.displayName,
    row.prodName,
    row.productNameRaw,
  ].map(v => String(v || '')).join(' ');
  if (/수국|hydrangea/i.test(hay)) return '수국';
  if (/카네이션|carnation/i.test(hay)) return '카네이션';
  if (/장미|\broses?\b/i.test(hay) && !/roselily/i.test(hay)) return '장미';
  if (/알스트로|alstro/i.test(hay)) return '알스트로';
  if (/루스커스|ruscus/i.test(hay)) return '루스커스';
  if (/백합|\blily\b|\blilies\b|roselily/i.test(hay)) return '백합';
  if (/호접난|호접란|orchid|phalaenopsis/i.test(hay)) return '호접난';
  if (/유칼립투스|eucalypt/i.test(hay)) return '유칼립투스';
  if (/리시안|lisianthus|eustoma/i.test(hay)) return '리시안';
  if (/안개|gypsophila/i.test(hay)) return '안개';
  if (/튤립|tulip/i.test(hay)) return '튤립';
  if (/델피늄|delphinium/i.test(hay)) return '델피늄';
  if (/아마릴리스|amaryllis/i.test(hay)) return '아마릴리스';
  if (/아스틸베|astilbe/i.test(hay)) return '아스틸베';
  if (explicit && !/^(기타|사용금지)$/i.test(explicit)) return explicit;
  const cf = cleanArrivalVarietyTabLabel(row.countryFlower);
  if (cf && cf !== '기타') {
    const withoutCountry = cf.replace(/^(?:콜롬비아|네덜란드|중국|에콰도르|에티오피아|베트남|태국|호주|미국|뉴질랜드)\s*/, '').trim();
    return withoutCountry || cf;
  }
  return '기타';
}

export function cleanArrivalFarmChip(row = {}) {
  const raw = String(row.farmName || row.autoFarmName || row.farmNameRaw || '').trim();
  if (!raw || raw === '-' || raw === '농장미지정') return '';
  return raw;
}

export function cleanArrivalProductChip(row = {}) {
  return String(row.displayName || row.prodName || row.productNameRaw || '').trim() || '품목미확인';
}

export function buildArrivalThreeTierChips(rows = [], {
  selectedVarieties = [],
  selectedFarms = [],
} = {}) {
  const varietySet = new Set(selectedVarieties);
  const farmSet = new Set(selectedFarms);
  const varietyCounts = new Map();
  const farmCounts = new Map();
  const productCounts = new Map();

  for (const row of rows) {
    const v = cleanArrivalFlowerChip(row);
    varietyCounts.set(v, (varietyCounts.get(v) || 0) + 1);
    if (varietySet.size > 0 && !varietySet.has(v)) continue;
    const f = cleanArrivalFarmChip(row);
    if (f) farmCounts.set(f, (farmCounts.get(f) || 0) + 1);
    if (farmSet.size > 0 && !farmSet.has(f)) continue;
    const p = cleanArrivalProductChip(row);
    productCounts.set(p, (productCounts.get(p) || 0) + 1);
  }

  const sortByLabel = (a, b) => Number(a[0] === '기타') - Number(b[0] === '기타') || a[0].localeCompare(b[0], 'ko');
  return {
    varietyButtons: [...varietyCounts.entries()].sort(sortByLabel).map(([label, count]) => ({ label, count })),
    farmButtons: [...farmCounts.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ko')).map(([farmName, count]) => ({ farmName, count })),
    productButtons: [...productCounts.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ko')).map(([productName, count]) => ({ productName, count })),
  };
}

export function filterArrivalRowsThreeTier(rows = [], {
  selectedVarieties = [],
  selectedFarms = [],
  selectedProducts = [],
  quickQuery = '',
} = {}) {
  const varietySet = new Set(selectedVarieties);
  const farmSet = new Set(selectedFarms);
  const productSet = new Set(selectedProducts);
  const q = String(quickQuery || '').trim().toLowerCase();
  if (!varietySet.size && !farmSet.size && !productSet.size && !q) return rows;
  return rows.filter(row => {
    if (varietySet.size > 0 && !varietySet.has(cleanArrivalFlowerChip(row))) return false;
    if (farmSet.size > 0 && !farmSet.has(cleanArrivalFarmChip(row))) return false;
    const prodLabel = cleanArrivalProductChip(row);
    if (productSet.size > 0 && !productSet.has(prodLabel)) return false;
    if (q) {
      const hay = `${prodLabel} ${row.productNameRaw || ''} ${row.prodName || ''} ${cleanArrivalFarmChip(row)} ${row.countryName || ''} ${row.orderWeek || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function summarizeArrivalFilteredRows(rows = [], costFn = rowCost) {
  let rowCount = 0;
  let pricedRows = 0;
  let missingRows = 0;
  let totalCostKRW = 0;
  let weightedQty = 0;
  const qtyByUnit = new Map();
  for (const row of rows) {
    rowCount += 1;
    const qty = Number(row.quantity) || 0;
    const unit = String(row.unit || '단').trim() || '단';
    if (qty > 0) qtyByUnit.set(unit, (qtyByUnit.get(unit) || 0) + qty);
    if (row.uploadStatus === 'COST_NOT_UPLOADED') {
      missingRows += 1;
      continue;
    }
    const cost = Number(costFn(row));
    if (Number.isFinite(cost) && cost > 0) {
      pricedRows += 1;
      const effectiveQty = qty > 0 ? qty : 1;
      totalCostKRW += cost * effectiveQty;
      weightedQty += effectiveQty;
    }
  }
  return {
    rowCount,
    pricedRows,
    missingRows,
    avgCostKRW: weightedQty > 0 ? totalCostKRW / weightedQty : null,
    totalCostKRW,
    qtySummary: [...qtyByUnit.entries()]
      .map(([unit, sum]) => `${Number(sum).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}${unit}`)
      .join(' · ') || '0',
  };
}

export function normalizeWeekOrder(value) {
  return String(value || '').toLowerCase() === 'asc' ? 'asc' : 'desc';
}
