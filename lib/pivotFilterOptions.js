// Pivot 통계 — 국가/꽃/품목명 필터 옵션 (계층 연동)

function activeFilterList(filterArr) {
  if (!filterArr?.length || filterArr.includes('__EMPTY__')) return null;
  return filterArr;
}

/** @param {object[]} rows pivot rows */
export function buildPivotDimensionOptions(rows, filters = {}) {
  const all = rows || [];
  const activeCountries = activeFilterList(filters.country);
  const activeFlowers = activeFilterList(filters.flower);

  const countryOptions = [...new Set(all.map((r) => r.country).filter(Boolean))].sort();

  let flowerPool = all;
  if (activeCountries) {
    flowerPool = flowerPool.filter((r) => activeCountries.includes(r.country));
  }
  const flowerOptions = [...new Set(flowerPool.map((r) => r.flower).filter(Boolean))].sort();

  let prodPool = flowerPool;
  if (activeFlowers) {
    prodPool = prodPool.filter((r) => activeFlowers.includes(r.flower));
  }
  const prodNameOptions = [...new Set(prodPool.map((r) => r.prodName).filter(Boolean))].sort();

  return { countryOptions, flowerOptions, prodNameOptions };
}

/** 컬럼 헤더 필터(국가/꽃/품목명) — 현재 rows 기준 유효값만 남김 */
export function pruneDimensionFilters(filters = {}, rows = []) {
  const next = { ...filters };
  const all = rows || [];

  const pruneKey = (key, valid) => {
    const cur = next[key];
    if (!cur?.length || cur.includes('__EMPTY__')) return;
    const kept = cur.filter(v => valid.includes(v));
    if (!kept.length) delete next[key];
    else if (kept.length !== cur.length) next[key] = kept;
  };

  pruneKey('country', [...new Set(all.map(r => r.country).filter(Boolean))].sort());
  const afterCountry = buildPivotDimensionOptions(all, next);
  pruneKey('flower', afterCountry.flowerOptions);
  const afterFlower = buildPivotDimensionOptions(all, next);
  pruneKey('prodName', afterFlower.prodNameOptions);
  pruneKey('area', [...new Set(all.map(r => r.area).filter(Boolean))].sort());

  return next;
}

/** 필드 목록 필터영역 — 선택값이 데이터에 없으면 제거 */
export function pruneFieldFilters(fieldFilters = {}, rows = [], customers = []) {
  const next = { ...fieldFilters };
  const custNames = new Set((customers || []).map(c => c.custName).filter(Boolean));
  const dimOpts = buildPivotDimensionOptions(rows, {});

  Object.keys(next).forEach((id) => {
    const sel = next[id];
    if (!sel?.length || sel.includes('__EMPTY__')) return;
    let valid = sel;
    if (id === 'country') valid = sel.filter(v => dimOpts.countryOptions.includes(v));
    else if (id === 'flower') valid = sel.filter(v => dimOpts.flowerOptions.includes(v));
    else if (id === 'prodName') valid = sel.filter(v => dimOpts.prodNameOptions.includes(v));
    else if (id === 'custName') valid = sel.filter(v => custNames.has(v));
    if (!valid.length) delete next[id];
    else if (valid.length !== sel.length) next[id] = valid;
  });
  return next;
}

/** 차수피벗 — 품목 기준 국가/꽃 distinct (거래처×차수 중복 제거) */
export function buildWeekPivotDimensionOptions(rows, selectedCountry = '') {
  const prodMap = new Map();
  (rows || []).forEach((r) => {
    if (!r?.ProdKey || prodMap.has(r.ProdKey)) return;
    prodMap.set(r.ProdKey, { country: r.CounName || '', flower: r.FlowerName || '' });
  });
  const prods = [...prodMap.values()];
  const countries = [...new Set(prods.map((p) => p.country).filter(Boolean))].sort();
  const flowerPool = selectedCountry
    ? prods.filter((p) => p.country === selectedCountry)
    : prods;
  const flowers = [...new Set(flowerPool.map((p) => p.flower).filter(Boolean))].sort();
  return { countries, flowers };
}
