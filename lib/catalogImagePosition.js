// 카탈로그 이미지 — 위치 + 확대(자르기)

export function resolveCatalogImageTransform(source) {
  const posX = Number(source?.imagePosX ?? source?.posX ?? 50);
  const posY = Number(source?.imagePosY ?? source?.posY ?? 50);
  const scale = Number(source?.imageScale ?? source?.scale ?? 100);
  return {
    posX: Number.isFinite(posX) ? Math.min(100, Math.max(0, posX)) : 50,
    posY: Number.isFinite(posY) ? Math.min(100, Math.max(0, posY)) : 50,
    scale: Number.isFinite(scale) ? Math.min(400, Math.max(100, scale)) : 100,
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

export function catalogImageStyle(source, extra = {}) {
  const { posX, posY, scale } = resolveCatalogImageTransform(source);
  const zoom = scale / 100;
  if (zoom <= 1.001) {
    return {
      width: '100%',
      height: '100%',
      objectFit: 'contain',
      objectPosition: `${posX}% ${posY}%`,
      ...extra,
    };
  }
  return {
    width: `${zoom * 100}%`,
    height: `${zoom * 100}%`,
    maxWidth: 'none',
    maxHeight: 'none',
    objectFit: 'cover',
    objectPosition: `${posX}% ${posY}%`,
    ...extra,
  };
}

export function catalogImageFieldsFromRecord(img) {
  if (!img) {
    return { imageId: null, imageUrl: null, imagePosX: 50, imagePosY: 50, imageScale: 100 };
  }
  const t = resolveCatalogImageTransform(img);
  return {
    imageId: img.id,
    imageUrl: img.url,
    imagePosX: t.posX,
    imagePosY: t.posY,
    imageScale: t.scale,
  };
}

/** PPT/내보내기 — 정사각 캔vas에 crop 반영 */
export async function renderCatalogImageDataUri(url, source, size = 800) {
  const full = String(url || '').trim();
  if (!full) return null;
  const { posX, posY, scale } = resolveCatalogImageTransform(source);

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

  const fitScale = Math.min(size / bitmap.width, size / bitmap.height);
  const zoom = Math.max(1, scale / 100);
  const drawW = bitmap.width * fitScale * zoom;
  const drawH = bitmap.height * fitScale * zoom;
  const x = (size - drawW) * (posX / 100);
  const y = (size - drawH) * (posY / 100);
  ctx.drawImage(bitmap, x, y, drawW, drawH);
  if (typeof bitmap.close === 'function') bitmap.close();

  return canvas.toDataURL('image/jpeg', 0.92);
}
