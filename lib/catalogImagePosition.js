// 카탈로그 이미지 object-position (꽃 중앙 맞춤)

export function resolveCatalogImagePosition(source) {
  const posX = Number(source?.imagePosX ?? source?.posX ?? 50);
  const posY = Number(source?.imagePosY ?? source?.posY ?? 50);
  return {
    posX: Number.isFinite(posX) ? Math.min(100, Math.max(0, posX)) : 50,
    posY: Number.isFinite(posY) ? Math.min(100, Math.max(0, posY)) : 50,
  };
}

export function catalogImageObjectPosition(source) {
  const { posX, posY } = resolveCatalogImagePosition(source);
  return `${posX}% ${posY}%`;
}

export function catalogImageStyle(source, extra = {}) {
  return {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    objectPosition: catalogImageObjectPosition(source),
    ...extra,
  };
}

export function catalogImageFieldsFromRecord(img) {
  if (!img) {
    return { imageId: null, imageUrl: null, imagePosX: 50, imagePosY: 50 };
  }
  const { posX, posY } = resolveCatalogImagePosition(img);
  return {
    imageId: img.id,
    imageUrl: img.url,
    imagePosX: posX,
    imagePosY: posY,
  };
}

/** PPT/내보내기 — object-fit:contain + object-position 과 동일한 정사각 캔버스 */
export async function renderCatalogImageDataUri(url, source, size = 800) {
  const full = String(url || '').trim();
  if (!full) return null;
  const { posX, posY } = resolveCatalogImagePosition(source);

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

  const scale = Math.min(size / bitmap.width, size / bitmap.height, 1);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  const freeX = size - w;
  const freeY = size - h;
  const x = freeX * (posX / 100);
  const y = freeY * (posY / 100);
  ctx.drawImage(bitmap, x, y, w, h);
  if (typeof bitmap.close === 'function') bitmap.close();

  return canvas.toDataURL('image/jpeg', 0.92);
}
