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

export function newCatalogLine(prod, { arrivalCost, arrivalUnit, salePrice, catalogName, imageId, imageUrl }) {
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
    imageId: imageId || null,
    imageUrl: imageUrl || null,
  };
}

export function pickPrimaryImageRecord(byProdKey, prodKey) {
  const list = byProdKey?.[String(prodKey)] || byProdKey?.[prodKey] || [];
  if (!list.length) return null;
  return list.find(i => i.isPrimary) || list[0];
}

/** UI 차수(2026-23-01 / 23-1 / 23-01) → freight API용 orderYear + weekStart(NN-NN) */
export function splitCatalogWeekForApi(weekValue, fallbackYear) {
  const v = String(weekValue || '').trim();
  const fallback = String(fallbackYear || new Date().getFullYear());
  if (!v) return { orderYear: fallback, weekStart: '', weekEnd: '' };

  const m4 = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m4) {
    return {
      orderYear: m4[1],
      weekStart: `${String(m4[2]).padStart(2, '0')}-${String(m4[3]).padStart(2, '0')}`,
    };
  }
  const m2 = v.match(/^(\d{1,2})-(\d{1,2})$/);
  if (m2) {
    return {
      orderYear: fallback,
      weekStart: `${String(m2[1]).padStart(2, '0')}-${String(m2[2]).padStart(2, '0')}`,
    };
  }
  if (/^\d{2}-\d{2}$/.test(v)) return { orderYear: fallback, weekStart: v };
  throw new Error(`차수 형식 오류: '${v}' (예: 23-01 또는 2026-23-01)`);
}

export function absCatalogUrl(url) {
  if (!url) return null;
  if (url.startsWith('http') || url.startsWith('data:')) return url;
  if (typeof window !== 'undefined') return `${window.location.origin}${url.startsWith('/') ? '' : '/'}${url}`;
  return url;
}
