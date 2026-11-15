import { rankProductSearchOptions } from './productSearchRanking.js';
import { filterProducts } from './displayName.js';

let products = [];
let indices = new Map();
self.onmessage = ({ data }) => {
  if (data.type === 'products') {
    products = data.products;
    indices = new Map((products || []).map((product, index) => [product, index]));
    return;
  }
  try {
    if (!Array.isArray(products)) throw new Error('품목 목록을 읽지 못했습니다.');
    const candidates = data.filterFirst ? filterProducts(products, data.query) : products;
    let matches = rankProductSearchOptions(data.query, candidates, { limit: data.limit });
    if (!matches.length && data.fallback) matches = filterProducts(products, data.query).slice(0, data.limit);
    self.postMessage({ id: data.id, indices: matches.map(product => indices.get(product)) });
  } catch (error) {
    self.postMessage({ id: data.id, error: error.message || '품목 검색 실패' });
  }
};
