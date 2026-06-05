// lib/pasteLocalMapping.js
// 붙여넣기 매칭 보조 — parse-paste 가 못 잡은 항목을 저장된 매핑(서버 /api/orders/mappings,
//  customer-mappings)으로 재매칭하는 클라이언트 폴백. 웹 paste.js 의 findLocalMapping 과 동일 로직을
//  공유해서 챗봇 주문수정에서도 동일하게 매칭되도록 한다.

export function normalizePasteToken(inputName) {
  return (inputName || '')
    .toLowerCase()
    .replace(/[()[\]{}]/g, ' ')
    .replace(/\b(add|cancel|delete|box|bunch|stem|stems|cm|ea)\b/gi, ' ')
    .replace(/(추가|취소|삭제|출고|입고|변경사항|변경|오늘|일요일|월요일|화요일|수요일|목요일|금요일|토요일)/g, ' ')
    .replace(/\d+(\.\d+)?\s*(박스|단|송이|개|box|bunch|stem|stems|cm|ea)?/gi, ' ')
    .replace(/[|:：,\-→>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenParts(s) {
  return normalizePasteToken(s).split(/\s+/).filter(t => t.length >= 2);
}

// 품목 매핑 찾기 (정확 → compact → 토큰부분집합 fuzzy)
export function findLocalMapping(inputName, cache) {
  const exact = normalizePasteToken(inputName);
  if (cache && cache[exact]) return cache[exact];
  const compactExact = exact.replace(/\s+/g, '');
  for (const [key, value] of Object.entries(cache || {})) {
    const compactKey = normalizePasteToken(key).replace(/\s+/g, '');
    if (compactKey && compactKey === compactExact) return value;
  }
  const inputTokens = tokenParts(inputName);
  if (inputTokens.length === 0) return null;
  const hits = [];
  Object.entries(cache || {}).forEach(([key, value]) => {
    const keyTokens = tokenParts(key);
    if (keyTokens.length === 0) return;
    const allIn = inputTokens.every(t => keyTokens.some(k =>
      t === k || (t.length >= 4 && k.length >= 4 && (t.includes(k) || k.includes(t)))
    ));
    if (allIn) hits.push({ key, value, score: inputTokens.length / Math.max(inputTokens.length, keyTokens.length) });
  });
  hits.sort((a, b) => b.score - a.score);
  return hits[0]?.value || null;
}

function customerToken(inputName) {
  return (inputName || '')
    .toLowerCase()
    .replace(/[()[\]{}]/g, ' ')
    .replace(/(추가|취소|삭제|출고|입고|변경사항|변경|오늘|일요일|월요일|화요일|수요일|목요일|금요일|토요일)/g, ' ')
    .replace(/[|:：,\-→>]/g, ' ')
    .replace(/\s+/g, '')
    .trim();
}

// 거래처 매핑 찾기 (정규화 compact 일치 / 포함)
export function findCustomerLocalMapping(inputName, cache) {
  const key = customerToken(inputName);
  if (!key) return null;
  if (cache && cache[key]) return cache[key];
  for (const [k, v] of Object.entries(cache || {})) {
    const ck = customerToken(k);
    if (ck && (ck === key || ck.includes(key) || key.includes(ck))) return v;
  }
  return null;
}
