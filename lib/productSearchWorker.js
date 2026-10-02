import { rankProductSearchOptions } from './productSearchRanking.js';
import { filterProducts } from './displayName.js';

let products = [];
self.onmessage = ({ data }) => {
  if (data.type === 'products') { products = data.products; return; }
  try {
    let matches = rankProductSearchOptions(data.query, products, { limit: data.limit });
    if (!matches.length && data.fallback) matches = filterProducts(products, data.query).slice(0, data.limit);
    const indices = new Map(products.map((product, index) => [product, index]));
    self.postMessage({ id: data.id, indices: matches.map(product => indices.get(product)) });
  } catch (error) {
    self.postMessage({ id: data.id, error: error.message || '품목 검색 실패' });
  }
};
