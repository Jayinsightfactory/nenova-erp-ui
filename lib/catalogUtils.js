// 거래처 카탈로그 — 순수 유틸

import { arrivalCostWithVat } from './pivotArrivalCalc.js';
import { catalogSaleUnit } from './catalogUnitMatch.js';
import { jamoMatch, getEnglishOf, suggestDisplayName } from './displayName.js';

// 품목별 한글 자동제안명 캐시 — 검색 타이핑마다 재계산하지 않게
const _korSuggestCache = new WeakMap();
function korSuggestText(p) {
  if (_korSuggestCache.has(p)) return _korSuggestCache.get(p);
  let v = '';
  try { v = String(suggestDisplayName(p.ProdName || '') || '').toLowerCase(); } catch { /* ignore */ }
  _korSuggestCache.set(p, v);
  return v;
}

// ── 한글 검색어 → 로마자 근사 매칭 (노비오→Nobbio, 마벨로즈→Mabelrose 처럼 사전에 없는 품종명 커버) ──
const ROM_CHO = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const ROM_JUNG = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', '', 'ui', 'i']; // ㅡ 는 음가 생략(레드→red)
const ROM_JONG = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'l', 'l', 'l', 'l', 'l', 'l', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];
function romanizeKo(s) {
  let out = '';
  for (const ch of String(s || '')) {
    const code = ch.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) {
      const idx = code - 0xac00;
      out += ROM_CHO[Math.floor(idx / 588)] + ROM_JUNG[Math.floor((idx % 588) / 28)] + ROM_JONG[idx % 28];
    } else if (/[a-z0-9]/i.test(ch)) out += ch.toLowerCase();
  }
  return out;
}
function lcsLen(a, b) {
  const m = a.length, n = b.length;
  if (!m || !n) return 0;
  let prev = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i += 1) {
    const cur = new Array(n + 1).fill(0);
    for (let j = 1; j <= n; j += 1) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return prev[n];
}
function latinWordsOf(p) {
  const words = String(`${p.ProdName || ''} ${p.DisplayName || ''}`).toLowerCase().match(/[a-z]{3,}/g) || [];
  // 인접 단어 결합도 후보에 (레드나오미 → rednaomi)
  const joined = [];
  for (let i = 0; i < words.length - 1; i += 1) joined.push(words[i] + words[i + 1]);
  return [...new Set([...words, ...joined])];
}
// 발음 정규화 — 음차 시 갈리는 자음 통일 (f/p, l/r, v/b, z/j …) + 중복 문자 축약
function phoneticSquash(s) {
  return String(s)
    .replace(/f/g, 'p').replace(/v/g, 'b').replace(/z/g, 'j')
    .replace(/[cq]/g, 'k').replace(/l/g, 'r').replace(/w/g, 'u').replace(/y/g, 'i')
    .replace(/(.)\1+/g, '$1');
}
function romFuzzyHit(rom, p) {
  if (rom.length < 3) return false;
  const rq = phoneticSquash(rom);
  return latinWordsOf(p).some(w => {
    // 포함은 제품단어 ⊇ 쿼리 방향만 — 쿼리('rednaomi')가 짧은 단어('red')를 품는 역방향은 오탐
    if (w.includes(rom)) return true;
    const wq = phoneticSquash(w);
    if (rq.length >= 4 && wq.includes(rq)) return true;
    const l = lcsLen(rq, wq);
    return l / Math.max(rq.length, wq.length) >= 0.75;
  });
}

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

export function fmtArrivalVatLabel(useVat) {
  return useVat ? 'VAT포함' : 'VAT별도';
}

/** 품목/라인별 도착원가 기준 차수 */
export function resolveArrivalCostWeek(item, { costMode, anchorWeek, selectedWeek } = {}) {
  if (item?.arrivalSource === 'upload') return '엑셀';
  if (item?.arrivalWeek) return String(item.arrivalWeek);
  if (costMode === 'selected' && selectedWeek) return String(selectedWeek);
  if (anchorWeek) return String(anchorWeek);
  return null;
}

/** 도착원가 확인용 부가 정보 — 차수 · VAT · 출처 */
export function fmtArrivalCostMeta(item, { costMode, anchorWeek, selectedWeek, useVat } = {}) {
  const vatLabel = fmtArrivalVatLabel(!!useVat);
  if (item?.arrivalSource === 'upload') {
    return { week: '엑셀', vatLabel, text: `엑셀 · ${vatLabel}` };
  }
  const week = resolveArrivalCostWeek(item, { costMode, anchorWeek, selectedWeek });
  const parts = [];
  if (week) parts.push(week);
  parts.push(vatLabel);
  if (item?.arrivalIsFallback) parts.push('이전차수');
  return { week, vatLabel, text: parts.join(' · ') };
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
  // 한글 매칭디테일: 부분일치 + 자모(초성)매칭 + 한글→영문 사전(장미→ROSE 등). 공백 구분 다중 토큰은 AND
  const tokens = q.split(/\s+/).filter(Boolean);
  return list.filter(p => {
    const parts = [
      p.ProdName, p.DisplayName, p.FlowerName, p.CounName, p.ProdCode,
      p.catalogKorName, p.mappingKorName, p.catalogMatchKorName, korSuggestText(p),
    ].filter(Boolean).map(s => String(s).toLowerCase());
    const hay = parts.join(' ');
    const hayCompact = hay.replace(/\s+/g, '');
    return tokens.every(tok => {
      if (hay.includes(tok) || hayCompact.includes(tok)) return true;
      const en = getEnglishOf(tok);
      // 사전 영문은 단어 단위로만 (rose 가 rosewood/mabelrose 를 잡지 않게)
      if (en && new RegExp(`(^|[^a-z])${en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(hay)) return true;
      if (!/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(tok)) return false;
      if (parts.some(t => jamoMatch(tok, t))) return true;
      // 마지막 폴백: 한글→로마자 근사 (노비오→Nobbio)
      return romFuzzyHit(romanizeKo(tok), p);
    });
  });
}

export function displayProductName(p) {
  return p.DisplayName || p.ProdName || '';
}

/** ③ 세부 품목 카드 — 접힌 제목(영문만, 괄호 한글 제외) */
export function compactProductTitle(p) {
  const full = String(displayProductName(p) || '').trim();
  if (!full) return '';
  const paren = full.match(/^(.+?)\s*[\(\（]([^)\）]+)[\)\）]\s*$/);
  if (paren && /[가-힣]/.test(paren[2])) {
    const before = paren[1].trim();
    if (before) return before;
  }
  const { eng } = splitEngKor(full);
  if (eng) return eng.replace(/\s*[\(\（].*$/, '').trim() || eng;
  return full;
}

/** ▼ 펼침 시 ProdName에서 분리한 한글(괄호·슬래시) */
export function compactProductKorHint(p) {
  const full = String(displayProductName(p) || '').trim();
  if (!full) return '';
  const paren = full.match(/^(.+?)\s*[\(\（]([^)\）]+)[\)\）]\s*$/);
  if (paren && /[가-힣]/.test(paren[2])) return paren[2].trim();
  return splitEngKor(full).kor || '';
}

/** 추출기 split_eng_kor — 영문+한글 분리 (공급자 [태그], / 구분 지원) */
function stripBracketPrefix(text) {
  return String(text || '').replace(/^\[[^\]]*\]\s*/, '').trim();
}

function splitEngKorCore(text) {
  const raw = String(text || '').replace(/_x000B_/g, ' ').replace(/\s+/g, ' ').trim();
  if (!raw) return { eng: '', kor: '' };
  const hangul = /[가-힣]/;
  const strip = ' -·:_()（）[]';
  const trimEdge = (s) => s.replace(/^[\s\-·:_()（）\[\]]+|[\s\-·:_()（）\[\]]+$/g, '');

  if (hangul.test(raw) && /[A-Za-z]/.test(raw)) {
    const idx = raw.search(/[가-힣]/);
    return { eng: trimEdge(raw.slice(0, idx)), kor: trimEdge(raw.slice(idx)) };
  }
  if (hangul.test(raw)) return { eng: '', kor: trimEdge(raw) };
  return { eng: trimEdge(raw), kor: '' };
}

export function splitEngKor(text) {
  let raw = String(text || '').replace(/_x000B_/g, ' ').replace(/\s+/g, ' ').trim();
  if (!raw) return { eng: '', kor: '' };

  raw = stripBracketPrefix(raw);

  if (raw.includes('/')) {
    const parts = raw.split('/').map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const left = splitEngKorCore(parts[0]);
      const right = splitEngKorCore(parts.slice(1).join(' / '));
      const eng = left.eng || right.eng;
      let kor = left.kor || right.kor;
      if (left.kor && right.kor && left.kor !== right.kor) {
        kor = right.kor || left.kor;
      }
      kor = kor.replace(/\([^)]*$/, '').replace(/\s+/g, ' ').trim();
      return { eng, kor };
    }
  }

  return splitEngKorCore(raw);
}

/** 깨진 eng/kor (예: eng='[', kor='오경] ROSE...') 복구 */
export function repairCatalogLineNames(line) {
  const eng = String(line?.engName || '').trim();
  const kor = String(line?.korName || '').trim();
  const brokenEng = !eng || eng.length <= 2 || /^[\[\(\)\s./\\|]+$/.test(eng);

  if (brokenEng) {
    const sources = [line?.prodName, line?.catalogName, kor].filter(Boolean);
    for (const source of sources) {
      const fixed = splitEngKor(source);
      if (fixed.eng && fixed.kor) {
        return { engName: fixed.eng, korName: fixed.kor };
      }
      if (fixed.eng && !/^[\[\(\)\s./\\|]+$/.test(fixed.eng)) {
        return { engName: fixed.eng, korName: fixed.kor || kor };
      }
    }
  }
  if (!eng && kor && /[A-Za-z]/.test(kor) && /[가-힣]/.test(kor)) {
    const fixed = splitEngKor(kor);
    return { engName: fixed.eng, korName: fixed.kor };
  }
  return { engName: eng, korName: kor };
}

/** 카탈로그 슬라이드용 영문명·한글명 (추출기 eng_name / name) */
export function deriveCatalogNames(prod) {
  const display = String(prod?.DisplayName || '').trim();
  const prodName = String(prod?.ProdName || '').trim();

  const fromDisplay = splitEngKor(display);
  if (fromDisplay.eng && fromDisplay.kor) {
    return { engName: fromDisplay.eng, korName: fromDisplay.kor };
  }

  const fromProd = splitEngKor(prodName);
  if (fromProd.eng && fromProd.kor) {
    return { engName: fromProd.eng, korName: fromProd.kor };
  }

  const engName = fromDisplay.eng || fromProd.eng || prodName.replace(/^\[[^\]]*\]\s*/, '').replace(/^[A-Za-z]+\s+/, '').trim() || prodName;
  const korName = fromDisplay.kor || fromProd.kor || '';
  return { engName, korName };
}

export function catalogLineNames(line) {
  const repaired = repairCatalogLineNames(line || {});
  const eng = String(repaired.engName || '').trim();
  const kor = String(repaired.korName || '').trim();
  if (eng || kor) {
    return { eng: eng || kor, kor };
  }
  const fromCat = splitEngKor(line?.catalogName || line?.prodName || '');
  if (fromCat.eng || fromCat.kor) return fromCat;
  return { eng: line?.prodName || '품목', kor: '' };
}

export function newCatalogLine(prod, {
  arrivalCost, arrivalUnit, salePrice, catalogName, imageId, imageUrl,
  engName, korName, extra1, extra2, extra3,
} = {}) {
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
    engName: engName ?? names.engName,
    korName: korName ?? names.korName,
    extra1: extra1 ?? '',
    extra2: extra2 ?? '',
    extra3: extra3 ?? '',
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
