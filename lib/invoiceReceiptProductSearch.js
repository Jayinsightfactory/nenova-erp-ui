export function receiptProductLabel(product) {
  if (!product) return '';
  const names = [...new Set([product.DisplayName, product.ProdName].map(value => String(value || '').trim()).filter(Boolean))];
  return `${names.join(' · ') || product.ProdCode || '이름 없음'} (#${product.ProdKey})`;
}
const normalized = value => String(value || '').normalize('NFKC').toLowerCase()
  .replace(/\bwo+l+y\b/g, 'woolly').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function searchReceiptProducts(products, query, limit = 30) {
  const words = normalized(query).split(/\s+/).filter(Boolean);
  return products.filter(product => product.selectable !== false && words.every(word =>
    normalized([product.ProdName, product.DisplayName, product.ProdCode, product.ProdKey].join(' ')).includes(word))).slice(0, limit);
}
