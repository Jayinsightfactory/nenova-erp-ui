export function productFlower(product) {
  return String(product.FlowerName || '').trim() || '미지정';
}

export function productFlowerCounts(products) {
  const counts = new Map();
  for (const product of products) {
    const flower = productFlower(product);
    counts.set(flower, (counts.get(flower) || 0) + 1);
  }
  return [...counts].sort(([a], [b]) => a.localeCompare(b, 'ko'));
}

// Empty selection means all, not a master-data activation flag.
export function matchesProductFlowers(product, selected) {
  return !selected.length || selected.includes(productFlower(product));
}

export function productCountry(product) {
  return String(product.CounName ?? '').trim() || '미지정';
}

export function matchesProductCountry(product, selected) {
  return selected == null || productCountry(product) === selected;
}

export function productCountryCounts(products) {
  const counts = new Map();
  for (const product of products) {
    const country = productCountry(product);
    counts.set(country, (counts.get(country) || 0) + 1);
  }
  return [...counts].sort(([a], [b]) => a.localeCompare(b, 'ko'));
}

// Keep countries separate even when their flower names match. Preserve ranked
// order within each group and original product identities; never rewrite masters.
export function groupProductsByCountryFlower(products) {
  const groups = new Map();
  for (const product of products) {
    const country = productCountry(product), flower = productFlower(product);
    const key = JSON.stringify([country, flower]);
    if (!groups.has(key)) groups.set(key, { key, country, flower, products: [] });
    groups.get(key).products.push(product);
  }
  let start = 0;
  return [...groups.values()].sort((a, b) => a.country.localeCompare(b.country, 'ko') || a.flower.localeCompare(b.flower, 'ko'))
    .map(group => { const result = { ...group, start }; start += group.products.length; return result; });
}
