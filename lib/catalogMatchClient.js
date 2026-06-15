// 브라우저 — 카탈로그 매칭 데이터 영구 저장

import { apiPost } from './useApi.js';
import { setCatalogPrimary } from './catalogImageClient.js';

export async function persistCatalogProductMatch(body) {
  return apiPost('/api/catalog/product-match', body);
}

/** 이미지 선택 시 대표 지정 + 매칭 저장 */
export async function persistCatalogImageSelection({ prodKey, imageId, prod, line }) {
  if (imageId) {
    await setCatalogPrimary(imageId);
  }
  if (!prodKey || !prod) return null;
  return persistCatalogProductMatch({
    prodKey,
    prodName: prod.ProdName,
    flowerName: prod.FlowerName,
    counName: prod.CounName,
    engName: line?.engName || prod.catalogEngName || '',
    korName: line?.korName || prod.catalogKorName || '',
    imageId: imageId || undefined,
  });
}
