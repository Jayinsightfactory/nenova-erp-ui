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
