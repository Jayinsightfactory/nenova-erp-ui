// 카탈로그 이미지 — cover(채우기) + 위치 + 확대 + 회전

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
  const { scale, rotate } = resolveCatalogImageTransform(source);
  const zoom = scale / 100;
  const pad = catalogImageRotatePad(rotate);
  const sizePct = zoom * pad * 100;
  return {
    width: `${sizePct}%`,
    height: `${sizePct}%`,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transform: rotate ? `rotate(${rotate}deg)` : undefined,
    transformOrigin: 'center center',
    ...extra,
  };
}

/** img — cover(채우기) 기본, scale 100% = 칸 가득 */
export function catalogImageStyle(source, extra = {}) {
  const { posX, posY } = resolveCatalogImageTransform(source);
  return {
    width: '100%',
    height: '100%',
    maxWidth: 'none',
    maxHeight: 'none',
    objectFit: 'cover',
    objectPosition: `${posX}% ${posY}%`,
    display: 'block',
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

/** PPT/보내기 — 정사각 canvas, CSS와 동일 cover+pan+rotate */
export async function renderCatalogImageDataUri(url, source, size = 800) {
  const full = String(url || '').trim();
  if (!full) return null;
  const { posX, posY, scale, rotate } = resolveCatalogImageTransform(source);

  const res = await fetch(full, { credentials: 'include' });
  if (!res.ok) return null;
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
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
