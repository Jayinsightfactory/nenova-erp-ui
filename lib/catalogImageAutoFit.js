// 카탈로그 정사각 칸 — 비율에 맞춰 자동 확대(cover) + 중앙 정렬

import { normalizeRotate, resolveCatalogImageTransform } from './catalogImagePosition';

/** 정사각 칸에 꽉 차도록 contain+zoom% 산출 */
export function computeCatalogAutoFitScale(imgW, imgH) {
  const w = Number(imgW);
  const h = Number(imgH);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 100;
  const ratio = w / h;
  const scale = Math.ceil(100 * Math.max(ratio, 1 / ratio));
  return Math.min(400, Math.max(100, scale));
}

export function buildCatalogAutoFitTransform(imgW, imgH) {
  return {
    posX: 50,
    posY: 50,
    scale: computeCatalogAutoFitScale(imgW, imgH),
    rotate: 0,
    autoAdjusted: true,
    manualAdjusted: false,
  };
}

function isDefaultTransform(source) {
  const t = resolveCatalogImageTransform(source);
  return t.scale === 100 && t.posX === 50 && t.posY === 50 && t.rotate === 0;
}

/** 서버 이미지 레코드 또는 라인 — 자동 맞춤 필요 여부 */
export function needsCatalogImageAutoFit(source) {
  if (!source) return false;
  if (source.manualAdjusted || source.imageManualAdjusted) return false;
  if (source.autoAdjusted || source.imageAutoAdjusted) return false;
  return isDefaultTransform(source);
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
