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
