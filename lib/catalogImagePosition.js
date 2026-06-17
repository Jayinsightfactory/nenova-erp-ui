// 카탈로그 이미지 — 위치 + 확대(자르기) + 회전

export function normalizeRotate(deg) {
  const v = Number(deg);
  if (!Number.isFinite(v)) return 0;
  let r = Math.round(v) % 360;
  if (r > 180) r -= 360;
  if (r < -180) r += 360;
  return r;
}

export function resolveCatalogImageTransform(source) {
  const posX = Number(source?.imagePosX ?? source?.posX ?? 50);
  const posY = Number(source?.imagePosY ?? source?.posY ?? 50);
  const scale = Number(source?.imageScale ?? source?.scale ?? 100);
  const rotate = Number(source?.imageRotate ?? source?.rotate ?? 0);
  return {
    posX: Number.isFinite(posX) ? Math.min(100, Math.max(0, posX)) : 50,
    posY: Number.isFinite(posY) ? Math.min(100, Math.max(0, posY)) : 50,
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

export function catalogImageStyle(source, extra = {}) {
  const { posX, posY, scale, rotate } = resolveCatalogImageTransform(source);
  const zoom = scale / 100;
  const transforms = [];
  if (rotate) transforms.push(`rotate(${rotate}deg)`);
  return {
    width: `${zoom * 100}%`,
    height: `${zoom * 100}%`,
    maxWidth: 'none',
    maxHeight: 'none',
    objectFit: 'contain',
    objectPosition: `${posX}% ${posY}%`,
    transform: transforms.length ? transforms.join(' ') : undefined,
    transformOrigin: 'center center',
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

/** PPT/내보내기 — 정사각 canvas에 crop + 회전 반영 */
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

  const fitScale = Math.min(size / bitmap.width, size / bitmap.height);
  const zoom = scale / 100;
  const drawW = bitmap.width * fitScale * zoom;
  const drawH = bitmap.height * fitScale * zoom;
  const x = (size - drawW) * (posX / 100);
  const y = (size - drawH) * (posY / 100);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, size, size);
  ctx.clip();
  ctx.translate(x + drawW / 2, y + drawH / 2);
  ctx.rotate((rotate * Math.PI) / 180);
  ctx.drawImage(bitmap, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();

  if (typeof bitmap.close === 'function') bitmap.close();

  return canvas.toDataURL('image/jpeg', 0.92);
}
