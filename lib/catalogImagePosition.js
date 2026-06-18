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
  const sizePct = pad * 100;
  return {
    width: `${sizePct}%`,
    height: `${sizePct}%`,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    transform: rotate ? `rotate(${rotate}deg)` : undefined,
    transformOrigin: 'center center',
    ...extra,
  };
}

/** img — cover + 확대(scale) + object-position(가로/세로) */
export function catalogImageStyle(source, extra = {}) {
  const { posX, posY, scale } = resolveCatalogImageTransform(source);
  const zoom = scale / 100;
  const sizePct = zoom * 100;
  return {
    width: `${sizePct}%`,
    height: `${sizePct}%`,
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

  const coverScale = Math.max(size / bitmap.width, size / bitmap.height);
  const zoom = scale / 100;
  const drawW = bitmap.width * coverScale * zoom;
  const drawH = bitmap.height * coverScale * zoom;
  const overflowX = drawW - size;
  const overflowY = drawH - size;
  const pad = catalogImageRotatePad(rotate);
  const boxLeft = overflowX > 0 ? -overflowX * (posX / 100) : (size - drawW) / 2;
  const boxTop = overflowY > 0 ? -overflowY * (posY / 100) : (size - drawH) / 2;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, size, size);
  ctx.clip();
  ctx.translate(size / 2, size / 2);
  ctx.rotate((rotate * Math.PI) / 180);
  ctx.scale(pad, pad);
  ctx.drawImage(bitmap, boxLeft - size / 2, boxTop - size / 2, drawW, drawH);
  ctx.restore();

  if (typeof bitmap.close === 'function') bitmap.close();

  return canvas.toDataURL('image/jpeg', 0.92);
}
