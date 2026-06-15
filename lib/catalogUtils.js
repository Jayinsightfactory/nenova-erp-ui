// 거래처 카탈로그 — 순수 유틸

import { arrivalCostWithVat } from './pivotArrivalCalc.js';
import { catalogSaleUnit } from './catalogUnitMatch.js';

export function fmtNum(n) {
  const v = Number(n || 0);
  if (!Number.isFinite(v) || v === 0) return '';
  return Math.round(v).toLocaleString('ko-KR');
}

/** 도착원가 확인용 — PPT·슬라이드에는 미포함 */
export function fmtArrivalDisplay(arrival, unit) {
  const n = Number(arrival || 0);
  if (!(n > 0)) return '—';
  const u = String(unit || '단').trim();
  return `${fmtNum(n)}원/${u}`;
}

/** 슬라이드/PPT 판매단가 표시 */
export function fmtCatalogSalePrice(line) {
  const price = Number(line?.salePrice || 0);
  if (!(price > 0)) return '';
  const unit = String(line?.outUnit || '단').trim();
  return `${fmtNum(price)}원/${unit}`;
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

export function productGroupKey(p) {
  const cf = String(p?.CountryFlower || '').trim();
  if (cf) return cf;
  const coun = String(p?.CounName || '').trim();
  const flower = String(p?.FlowerName || '').trim();
  if (coun || flower) return `${coun}${flower}`;
  return '(미분류)';
}

/** nenova.exe 품종 정리 순서 — Country.Sort → Flower.Sort → OrderNo → CountryFlower */
export function compareProductGroupOrder(a, b) {
  const ca = a?.cSort ?? 9999;
  const cb = b?.cSort ?? 9999;
  if (ca !== cb) return ca - cb;
  const fa = a?.fSort ?? 9999;
  const fb = b?.fSort ?? 9999;
  if (fa !== fb) return fa - fb;
  const oa = a?.fOrderNo ?? 9999;
  const ob = b?.fOrderNo ?? 9999;
  if (oa !== ob) return oa - ob;
  return String(a?.label || '').localeCompare(String(b?.label || ''), 'ko');
}

export function compareProductErpOrder(a, b) {
  const g = compareProductGroupOrder(
    { cSort: a?.cSort, fSort: a?.fSort, fOrderNo: a?.fOrderNo, label: productGroupKey(a) },
    { cSort: b?.cSort, fSort: b?.fSort, fOrderNo: b?.fOrderNo, label: productGroupKey(b) },
  );
  if (g !== 0) return g;
  return String(a?.ProdName || '').localeCompare(String(b?.ProdName || ''), 'ko');
}

/** CountryFlower(국가+품종) 그룹 — 전산 품종 트리와 동일 */
export function groupProductsByCountryFlower(products) {
  const map = new Map();
  for (const p of products) {
    const key = productGroupKey(p);
    if (!map.has(key)) {
      map.set(key, {
        key,
        label: key,
        counName: p.CounName || '',
        flowerName: p.FlowerName || '',
        cSort: p.cSort ?? null,
        fSort: p.fSort ?? null,
        fOrderNo: p.fOrderNo ?? null,
        items: [],
      });
    }
    map.get(key).items.push(p);
  }
  const groups = [...map.values()];
  groups.sort(compareProductGroupOrder);
  for (const g of groups) {
    g.items.sort((a, b) => String(a.ProdName || '').localeCompare(String(b.ProdName || ''), 'ko'));
  }
  return groups;
}

/** @deprecated groupProductsByCountryFlower 사용 */
export function groupProductsByFlower(products) {
  return groupProductsByCountryFlower(products).map(g => ({ flower: g.label, items: g.items }));
}

export function filterProducts(products, { flower, countryFlower, search }) {
  let list = products;
  const group = countryFlower ?? flower;
  if (group && group !== '__all__') {
    list = list.filter(p => productGroupKey(p) === group);
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

/** 추출기 split_eng_kor — 영문+한글 분리 */
export function splitEngKor(text) {
  const raw = String(text || '').replace(/_x000B_/g, ' ').replace(/\s+/g, ' ').trim();
  if (!raw) return { eng: '', kor: '' };
  const hangul = /[가-힣]/;
  const strip = ' -·:_()（）';
  const trimEdge = (s) => s.replace(/^[\s\-·:_()（）]+|[\s\-·:_()（）]+$/g, '');
  if (hangul.test(raw) && /[A-Za-z]/.test(raw)) {
    const idx = raw.search(/[가-힣]/);
    return { eng: trimEdge(raw.slice(0, idx)), kor: trimEdge(raw.slice(idx)) };
  }
  if (hangul.test(raw)) return { eng: '', kor: trimEdge(raw) };
  return { eng: trimEdge(raw), kor: '' };
}

/** 카탈로그 슬라이드용 영문명·한글명 (추출기 eng_name / name) */
export function deriveCatalogNames(prod) {
  const display = String(prod?.DisplayName || '').trim();
  const prodName = String(prod?.ProdName || '').trim();

  const fromDisplay = splitEngKor(display);
  if (fromDisplay.eng && fromDisplay.kor) {
    return { engName: fromDisplay.eng, korName: fromDisplay.kor };
  }

  if (display.includes('/')) {
    const tail = display.split('/').pop().trim();
    const sk = splitEngKor(tail);
    if (sk.eng) {
      return { engName: sk.eng, korName: sk.kor || fromDisplay.kor || splitEngKor(prodName).kor };
    }
  }

  const fromProd = splitEngKor(prodName);
  if (fromProd.eng && fromProd.kor) {
    return { engName: fromProd.eng, korName: fromProd.kor };
  }

  const variety = prodName.replace(/^[A-Za-z]+\s+/, '').trim() || prodName;
  return {
    engName: variety,
    korName: fromProd.kor || fromDisplay.kor || splitEngKor(display).kor || '',
  };
}

export function catalogLineNames(line) {
  const eng = String(line?.engName || '').trim();
  const kor = String(line?.korName || '').trim();
  if (eng || kor) {
    return { eng: eng || kor, kor };
  }
  const fromCat = splitEngKor(line?.catalogName || line?.prodName || '');
  if (fromCat.eng || fromCat.kor) return fromCat;
  return { eng: line?.prodName || '품목', kor: '' };
}

export function newCatalogLine(prod, { arrivalCost, arrivalUnit, salePrice, catalogName, imageId, imageUrl }) {
  const names = deriveCatalogNames(prod);
  return {
    id: `${prod.ProdKey}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    prodKey: prod.ProdKey,
    prodCode: prod.ProdCode,
    flowerName: prod.FlowerName,
    counName: prod.CounName,
    countryFlower: prod.CountryFlower || productGroupKey(prod),
    cSort: prod.cSort ?? null,
    fSort: prod.fSort ?? null,
    fOrderNo: prod.fOrderNo ?? null,
    prodName: prod.ProdName,
    catalogName: catalogName || displayProductName(prod),
    engName: names.engName,
    korName: names.korName,
    outUnit: prod.saleUnit || catalogSaleUnit(prod),
    saleUnit: prod.saleUnit || catalogSaleUnit(prod),
    arrivalCost: Number(arrivalCost || 0),
    arrivalUnit: arrivalUnit || catalogSaleUnit(prod),
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
