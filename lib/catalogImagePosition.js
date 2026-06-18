// 카탈로그 이미지 — cover(채우기) + 위치 + 확대 + 회전

import { absCatalogUrl } from './catalogUtils';

function isLegacyContainScale(source) {
  const t = resolveCatalogImageTransform(source);
  return t.scale > 100
    && (source?.autoAdjusted || source?.imageAutoAdjusted)
    && !source?.manualAdjusted
    && !source?.imageManualAdjusted;
}
export const CATALOG_POS_MIN = -80;
export const CATALOG_POS_MAX = 180;

export function normalizeRotate(deg) {
  const v = Number(deg);
  if (!Number.isFinite(v)) return 0;
  let r = Math.round(v) % 360;
  if (r > 180) r -= 360;
  if (r < -180) r += 360;
  return r;
}

export function clampCatalogPos(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 50;
  return Math.min(CATALOG_POS_MAX, Math.max(CATALOG_POS_MIN, Math.round(v)));
}

/** 미리보기·인쇄·PPT — 예전 contain용 확대값 보정, 슬롯과 동일 cover 기준 */
export function normalizeCatalogLineForRender(line) {
  if (!line) return line;
  const t = resolveCatalogImageTransform(line);
  if (!isLegacyContainScale(line)) {
    return {
      ...line,
      imagePosX: t.posX,
      imagePosY: t.posY,
      imageScale: t.scale,
      imageRotate: t.rotate,
    };
  }
  return {
    ...line,
    imagePosX: 50,
    imagePosY: 50,
    imageScale: 100,
    imageRotate: 0,
  };
}

export function resolveCatalogImageTransform(source) {
  const posX = Number(source?.imagePosX ?? source?.posX ?? 50);
  const posY = Number(source?.imagePosY ?? source?.posY ?? 50);
  const scale = Number(source?.imageScale ?? source?.scale ?? 100);
  const rotate = Number(source?.imageRotate ?? source?.rotate ?? 0);
  return {
    posX: clampCatalogPos(posX),
    posY: clampCatalogPos(posY),
    scale: Number.isFinite(scale) ? Math.min(400, Math.max(100, scale)) : 100,
    rotate: normalizeRotate(rotate),
  };
}

export function resolveCatalogImagePosition(source) {
  const { posX, posY } = resolveCatalogImageTransform(source);
  return { posX, posY };
}

export function catalogImageObjectPosition(source) {
  const { posX, posY } = resolveCatalogImageTransform(source);
  return `${posX}% ${posY}%`;
}

/** cover+zoom — 캔버스/PPT와 동일 (칸 크기 1 기준) */
export function catalogCoverBox(imageAspect, scalePct, posX, posY) {
  const zoom = scalePct / 100;
  const aspect = imageAspect > 0 ? imageAspect : 1;
  const coverW = zoom * Math.max(aspect, 1);
  const coverH = zoom * Math.max(1 / aspect, 1);
  const overflowX = Math.max(0, coverW - 1);
  const overflowY = Math.max(0, coverH - 1);
  const left = overflowX > 0 ? -overflowX * (posX / 100) : (1 - coverW) / 2;
  const top = overflowY > 0 ? -overflowY * (posY / 100) : (1 - coverH) / 2;
  return { coverW, coverH, left, top, overflowX, overflowY };
}

/** 위치 조절 가능 여부 — 정사각·줌100%면 확대 필요 */
export function catalogImagePanRange(imageAspect, scalePct = 100) {
  const { overflowX, overflowY } = catalogCoverBox(imageAspect, scalePct, 50, 50);
  return {
    canPanX: overflowX > 0.001,
    canPanY: overflowY > 0.001,
    needsZoomForPan: overflowX <= 0.001 && overflowY <= 0.001,
  };
}

/** 회전 시 정사각 칸 밖으로 잘리지 않도록 스테이지 확대 */
export function catalogImageRotatePad(rotateDeg) {
  const r = Math.abs(normalizeRotate(rotateDeg));
  if (!r) return 1;
  const rad = (r * Math.PI) / 180;
  return Math.abs(Math.cos(rad)) + Math.abs(Math.sin(rad));
}

/** 회전용 바깥 래퍼 — overflow hidden 부모 안에서 회전 클리핑 완화 */
export function catalogImageStageStyle(source, extra = {}) {
  const { rotate } = resolveCatalogImageTransform(source);
  const pad = catalogImageRotatePad(rotate);
  return {
    position: 'relative',
    width: `${pad * 100}%`,
    height: `${pad * 100}%`,
    flexShrink: 0,
    overflow: 'hidden',
    transform: rotate ? `rotate(${rotate}deg)` : undefined,
    transformOrigin: 'center center',
    ...extra,
  };
}

/** img — 비율 기반 절대 배치 (캔버스·PPT와 동일). imageAspect 없으면 object-position 폴백 */
export function catalogImageStyle(source, imageAspect, extra = {}) {
  const { posX, posY, scale } = resolveCatalogImageTransform(source);
  if (!imageAspect || !Number.isFinite(imageAspect) || imageAspect <= 0) {
    const zoom = scale / 100;
    return {
      width: `${zoom * 100}%`,
      height: `${zoom * 100}%`,
      minWidth: '100%',
      minHeight: '100%',
      maxWidth: 'none',
      maxHeight: 'none',
      objectFit: 'cover',
      objectPosition: `${posX}% ${posY}%`,
      display: 'block',
      flexShrink: 0,
      ...extra,
    };
  }
  const { coverW, coverH, left, top } = catalogCoverBox(imageAspect, scale, posX, posY);
  return {
    position: 'absolute',
    width: `${coverW * 100}%`,
    height: `${coverH * 100}%`,
    left: `${left * 100}%`,
    top: `${top * 100}%`,
    objectFit: 'cover',
    display: 'block',
    maxWidth: 'none',
    maxHeight: 'none',
    ...extra,
  };
}

export function catalogImageFieldsFromRecord(img) {
  if (!img) {
    return {
      imageId: null,
      imageUrl: null,
      imagePosX: 50,
      imagePosY: 50,
      imageScale: 100,
      imageRotate: 0,
      imageAutoAdjusted: false,
      imageManualAdjusted: false,
    };
  }
  const t = resolveCatalogImageTransform(img);
  return {
    imageId: img.id,
    imageUrl: img.url,
    imagePosX: t.posX,
    imagePosY: t.posY,
    imageScale: t.scale,
    imageRotate: t.rotate,
    imageAutoAdjusted: !!img.autoAdjusted,
    imageManualAdjusted: !!img.manualAdjusted,
  };
}

/** 슬롯(라인) 수동 조정값 우선 — 동기화 시 덮어쓰기 방지 */
export function mergeLineImageFields(line, img) {
  const fromImg = img ? catalogImageFieldsFromRecord(img) : null;
  if (line?.imageManualAdjusted) {
    const t = resolveCatalogImageTransform(line);
    return {
      imageId: line.imageId || fromImg?.imageId || null,
      imageUrl: line.imageUrl || absCatalogUrl(fromImg?.imageUrl) || null,
      imagePosX: t.posX,
      imagePosY: t.posY,
      imageScale: t.scale,
      imageRotate: t.rotate,
      imageAutoAdjusted: !!line.imageAutoAdjusted,
      imageManualAdjusted: true,
    };
  }
  if (fromImg?.imageManualAdjusted) {
    return {
      ...fromImg,
      imageId: line?.imageId || fromImg.imageId,
      imageUrl: absCatalogUrl(fromImg.imageUrl || line?.imageUrl) || line?.imageUrl || null,
    };
  }
  if (fromImg) {
    return {
      ...fromImg,
      imageId: line?.imageId || fromImg.imageId,
      imageUrl: absCatalogUrl(fromImg.imageUrl || line?.imageUrl) || line?.imageUrl || null,
    };
  }
  const t = resolveCatalogImageTransform(line || {});
  return {
    imageId: line?.imageId ?? null,
    imageUrl: line?.imageUrl ?? null,
    imagePosX: t.posX,
    imagePosY: t.posY,
    imageScale: t.scale,
    imageRotate: t.rotate,
    imageAutoAdjusted: !!line?.imageAutoAdjusted,
    imageManualAdjusted: !!line?.imageManualAdjusted,
  };
}

/** PPT/보내기 — 정사각 canvas, CSS와 동일 cover+pan+rotate */
async function loadCatalogBitmap(url) {
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (res.ok) {
      const blob = await res.blob();
      if (blob?.size && typeof createImageBitmap === 'function') {
        return await createImageBitmap(blob);
      }
    }
  } catch {
    /* Image() fallback */
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('이미지 로드 실패'));
    img.src = url;
  });
}

export async function renderCatalogImageDataUri(url, source, size = 800) {
  const full = String(url || '').trim();
  if (!full) return null;
  const { posX, posY, scale, rotate } = resolveCatalogImageTransform(source);

  let bitmap;
  try {
    bitmap = await loadCatalogBitmap(full);
  } catch {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  const aspect = bitmap.width / bitmap.height;
  const { coverW, coverH, left: normLeft, top: normTop } = catalogCoverBox(aspect, scale, posX, posY);
  const drawW = size * coverW;
  const drawH = size * coverH;
  const boxLeft = normLeft * size;
  const boxTop = normTop * size;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, size, size);
  ctx.clip();
  ctx.translate(size / 2, size / 2);
  ctx.rotate((rotate * Math.PI) / 180);
  const pad = catalogImageRotatePad(rotate);
  ctx.scale(pad, pad);
  ctx.drawImage(bitmap, boxLeft - size / 2, boxTop - size / 2, drawW, drawH);
  ctx.restore();

  if (typeof bitmap.close === 'function') bitmap.close();

  return canvas.toDataURL('image/jpeg', 0.92);
}
