// lib/parseMappings.js
// 붙여넣기 주문 파싱 매핑 캐시 (서버 공유)
// inputToken → { prodKey, prodName, displayName, flowerName, counName, savedAt }

import { MAPPING_STORE_KEYS, readMappingDocument, mutateMappingDocument } from './mappingDbStore.js';
import { normalizeToken, detectFallbackProdKey } from './pasteMappingMatch.js';
export { normalizeToken, findMappingFuzzy, detectFallbackProdKey, getMapping } from './pasteMappingMatch.js';

export async function loadMappings(_forceRefresh = false) {
  return readMappingDocument(MAPPING_STORE_KEYS.products);
}

export async function saveMapping(inputToken, prodInfo, options = {}) {
  const { force = false } = options;
  const key = normalizeToken(inputToken);
  if (!key) return { saved: false, reason: 'empty-key' };
  return mutateMappingDocument(MAPPING_STORE_KEYS.products, cache => {
    if (cache[key]?.manual === true && prodInfo?.manual !== true) {
      return { changed: false, result: { saved: false, reason: 'manual-mapping-protected' } };
    }
    // Guard the current snapshot while the document lock is held.
    if (!force && prodInfo?.prodKey) {
      const guard = detectFallbackProdKey(prodInfo.prodKey, key, cache);
      if (guard.isFallback) return { changed: false, result: {
        saved: false,
        reason: 'fallback-suspect',
        warning: `이 품목(${prodInfo.prodName || prodInfo.prodKey})은 이미 ${guard.count}개 입력에 매핑되어 있어 자동 추측 fallback 일 가능성이 높습니다. 정말 저장하려면 force=true 옵션 사용.`,
        sampleKeys: guard.sampleKeys,
      } };
    }
    return { document: { ...cache, [key]: { ...prodInfo, savedAt: new Date().toISOString() } },
      result: { saved: true, key } };
  });
}

// 매핑 삭제 — 저장된 키(정규화 토큰) 또는 입력 토큰 모두 허용
export async function deleteMapping(keyOrToken) {
  return mutateMappingDocument(MAPPING_STORE_KEYS.products, cache => {
    let key = keyOrToken;
    if (!Object.hasOwn(cache, key)) {
      const norm = normalizeToken(keyOrToken);
      if (Object.hasOwn(cache, norm)) key = norm;
    }
    if (!Object.hasOwn(cache, key)) return { changed: false, result: { deleted: false, reason: 'not-found' } };
    const removed = cache[key];
    const document = { ...cache };
    delete document[key];
    return { document, result: { deleted: true, key, removed } };
  });
}
