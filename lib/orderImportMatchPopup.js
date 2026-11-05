// lib/orderImportMatchPopup.js — 업로드 주문등록 품목 매칭 새 창(팝업) 공통 헬퍼.
// 순수 함수만 둔다(DB·네트워크 없음). 선택 결과는 opener 화면의 클라이언트 상태로만 전달된다.
import { scoreProductSearchOptions } from './productSearchRanking.js';

export const IMPORT_MATCH_POPUP_PATH = '/orders/product-match';
export const IMPORT_MATCH_POPUP_NAME = 'importProductMatchPopup';
export const IMPORT_MATCH_POPUP_FEATURES = 'popup=yes,width=980,height=760,left=120,top=80,resizable=yes,scrollbars=yes';
export const IMPORT_MATCH_MESSAGE = Object.freeze({
  ready: 'import-match-popup-ready',
  init: 'import-match-popup-init',
  selected: 'import-match-popup-selected',
  cleared: 'import-match-popup-cleared',
  cancel: 'import-match-popup-cancel',
});
const POPUP_TO_OPENER = new Set([
  IMPORT_MATCH_MESSAGE.ready,
  IMPORT_MATCH_MESSAGE.selected,
  IMPORT_MATCH_MESSAGE.cleared,
  IMPORT_MATCH_MESSAGE.cancel,
]);

export function createImportMatchToken(cryptoLike = globalThis.crypto) {
  if (cryptoLike?.randomUUID) return `import-${cryptoLike.randomUUID()}`;
  return `import-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function buildImportMatchPopupUrl(token) {
  return `${IMPORT_MATCH_POPUP_PATH}?${new URLSearchParams({ popup: '1', token: String(token || '') }).toString()}`;
}

/** opener 가 팝업으로 보내는 init 메시지. 행 객체 전체가 아니라 필요한 값만 담는다. */
export function buildImportMatchInit(row, custName = '', token = '') {
  return {
    type: IMPORT_MATCH_MESSAGE.init,
    token,
    inputName: String(row?.inputName || ''),
    matchName: String(row?.matchName || row?.inputName || ''),
    currentProdKey: Number(row?.prodKey) > 0 ? Number(row.prodKey) : null,
    currentName: String(row?.displayName || row?.prodName || ''),
    custName: String(custName || ''),
    suggestedProducts: Array.isArray(row?.suggestedProducts) ? row.suggestedProducts.slice(0, 50) : [],
  };
}

/**
 * opener 쪽 수신 검증. 통과하면 data, 아니면 null.
 * pending: { token, popup }. 같은 출처 · 우리가 연 창 · 현재 토큰 · 팝업→opener 타입만 허용한다.
 */
export function readTrustedPopupMessage(event, pending, origin) {
  if (!pending || !event) return null;
  if (event.origin !== origin || event.source !== pending.popup) return null;
  const data = event.data;
  if (!data || typeof data !== 'object' || data.token !== pending.token || !POPUP_TO_OPENER.has(data.type)) return null;
  return data;
}

/** 팝업 쪽 init 수신 검증. */
export function isTrustedInitMessage(event, opener, origin, token) {
  return Boolean(event && event.origin === origin && event.source === opener
    && event.data?.type === IMPORT_MATCH_MESSAGE.init && event.data?.token === token);
}

/** selected 메시지에 실릴 품목 필드만 추린다. ProdKey 가 양의 정수가 아니면 null. */
export function pickProductPayload(prod) {
  const prodKey = Number(prod?.ProdKey ?? prod?.prodKey);
  if (!Number.isInteger(prodKey) || prodKey <= 0) return null;
  const name = prod?.ProdName ?? prod?.prodName ?? '';
  return {
    ProdKey: prodKey,
    ProdName: String(name),
    DisplayName: String(prod?.DisplayName ?? prod?.displayName ?? name),
    FlowerName: String(prod?.FlowerName ?? prod?.flowerName ?? ''),
    CounName: String(prod?.CounName ?? prod?.counName ?? ''),
    OutUnit: String(prod?.OutUnit ?? prod?.outUnit ?? ''),
  };
}

/** opener 가 받은 selected 의 prod 를 다시 검증한다(깨진 값이면 null). */
export function readSelectedProduct(data) {
  if (data?.type !== IMPORT_MATCH_MESSAGE.selected) return null;
  return pickProductPayload(data.prod);
}

/**
 * 팝업 후보 목록: (a) 서버 후보 점수순 → (b) 전체 품목 검색 결과, 중복 제거, 최대 limit.
 * query 가 비어 있으면 서버 후보만 보인다. 자동 선택은 하지 않는다(순서만 정함).
 */
export function mergeMatchCandidates({ suggestions = [], allProducts = [], query = '', limit = 50 } = {}) {
  const out = [];
  const seen = new Set();
  const push = (prod, score, source, usage = 0) => {
    const payload = pickProductPayload(prod);
    if (!payload || seen.has(payload.ProdKey) || out.length >= limit) return;
    seen.add(payload.ProdKey);
    out.push({ ...payload, score: Number.isFinite(score) ? Math.min(100, Math.round(score)) : null, source, usageCount: Number(usage) || 0 });
  };
  const needle = String(query || '').trim();
  const sorted = [...suggestions].sort((a, b) => Number(b?.score || 0) - Number(a?.score || 0));
  for (const s of sorted) push(s, s.score, 'server', s.customerUsageCount);
  if (needle) {
    const usageByKey = new Map(suggestions.map((s) => [Number(s.prodKey), Number(s.customerUsageCount) || 0]));
    for (const { product, matchScore } of scoreProductSearchOptions(needle, allProducts)) {
      push(product, matchScore, 'search', usageByKey.get(Number(product.ProdKey)) || 0);
    }
    const lower = needle.toLocaleLowerCase();
    for (const product of allProducts) {
      const text = `${product.DisplayName || ''} ${product.ProdName || ''}`.toLocaleLowerCase();
      if (text.includes(lower)) push(product, NaN, 'contains');
    }
  }
  return out;
}
