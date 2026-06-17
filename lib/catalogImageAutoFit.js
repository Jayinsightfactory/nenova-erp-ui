// 카탈로그 정사각 칸 — cover(채우기) 100%가 기본

import { resolveCatalogImageTransform } from './catalogImagePosition';

/** cover 기본 — 100%면 칸을 가득 채움 */
export function computeCatalogAutoFitScale() {
  return 100;
}

export function buildCatalogAutoFitTransform() {
  return {
    posX: 50,
    posY: 50,
    scale: 100,
    rotate: 0,
    autoAdjusted: true,
    manualAdjusted: false,
  };
}

function isLegacyContainScale(source) {
  const t = resolveCatalogImageTransform(source);
  return t.scale > 100 && (source?.autoAdjusted || source?.imageAutoAdjusted);
}

/** cover 전환: 예전 contain용 확대값이면 다시 맞춤 */
export function needsCatalogImageAutoFit(source) {
  if (!source) return false;
  if (source.manualAdjusted || source.imageManualAdjusted) return false;
  if (isLegacyContainScale(source)) return true;
  if (source.autoAdjusted || source.imageAutoAdjusted) return false;
  const t = resolveCatalogImageTransform(source);
  return t.scale === 100 && t.posX === 50 && t.posY === 50 && t.rotate === 0;
}

export function loadCatalogImageNaturalSize(url) {
  const full = String(url || '').trim();
  if (!full) return Promise.reject(new Error('이미지 URL 없음'));
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('이미지 로드 실패'));
    img.src = full;
  });
}
