// 거래처 카탈로그 — 순수 유틸

import { arrivalCostWithVat } from './pivotArrivalCalc.js';

export function fmtNum(n) {
  const v = Number(n || 0);
  if (!Number.isFinite(v) || v === 0) return '';
  return Math.round(v).toLocaleString('ko-KR');
}

export function fmtPct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}

/** 판매단가 대비 도착원가 마진율 */
export function marginPct(arrival, sale) {
  const a = Number(arrival || 0);
  const s = Number(sale || 0);
  if (!(s > 0)) return null;
  if (!(a > 0)) return null;
  return ((s - a) / s) * 100;
}

export function effectiveArrival(arrivalCost, useVat) {
  const v = Number(arrivalCost || 0);
  return useVat ? arrivalCostWithVat(v) : v;
}

export function groupProductsByFlower(products) {
  const map = new Map();
  for (const p of products) {
    const flower = p.FlowerName || '(미분류)';
    if (!map.has(flower)) map.set(flower, []);
    map.get(flower).push(p);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'ko'))
    .map(([flower, items]) => ({ flower, items }));
}

export function filterProducts(products, { flower, search }) {
  let list = products;
  if (flower && flower !== '__all__') {
    list = list.filter(p => (p.FlowerName || '') === flower);
  }
  const q = String(search || '').trim().toLowerCase();
  if (!q) return list;
  return list.filter(p => {
    const hay = [
      p.ProdName, p.DisplayName, p.FlowerName, p.CounName, p.ProdCode,
    ].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  });
}

export function displayProductName(p) {
  return p.DisplayName || p.ProdName || '';
}

export function newCatalogLine(prod, { arrivalCost, arrivalUnit, salePrice, catalogName }) {
  return {
    id: `${prod.ProdKey}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    prodKey: prod.ProdKey,
    prodCode: prod.ProdCode,
    flowerName: prod.FlowerName,
    counName: prod.CounName,
    prodName: prod.ProdName,
    catalogName: catalogName || displayProductName(prod),
    outUnit: prod.OutUnit || '단',
    arrivalCost: Number(arrivalCost || 0),
    arrivalUnit: arrivalUnit || prod.OutUnit || '단',
    salePrice: Number(salePrice || 0),
    masterCost: Number(prod.Cost || 0),
  };
}
