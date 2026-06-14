// 브라우저 — 업로드 전 이미지 리사이즈 (서버 용량 절약)

export async function resizeImageFile(file, { maxSize = 1200, quality = 0.85 } = {}) {
  if (!file?.type?.startsWith('image/')) throw new Error('이미지 파일만 업로드할 수 있습니다.');
  if (typeof createImageBitmap !== 'function') {
    return file;
  }

  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bmp.width, bmp.height, 1));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  if (typeof bmp.close === 'function') bmp.close();

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('이미지 변환 실패'))), 'image/jpeg', quality);
  });

  const base = (file.name || 'image').replace(/\.[^.]+$/, '');
  return new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
}

export async function uploadCatalogImage(file, prodKey) {
  const body = new FormData();
  body.append('file', file);
  body.append('prodKey', String(prodKey));

  const res = await fetch('/api/catalog/images', {
    method: 'POST',
    credentials: 'include',
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '업로드 실패');
  return data.image;
}

export async function replaceCatalogImage(id, file) {
  const body = new FormData();
  body.append('file', file);

  const res = await fetch(`/api/catalog/images/${id}`, {
    method: 'PUT',
    credentials: 'include',
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '교체 실패');
  return data.image;
}

export async function setCatalogPrimary(id) {
  const res = await fetch(`/api/catalog/images/${id}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isPrimary: true }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '대표 지정 실패');
  return data.image;
}

export async function deleteCatalogImage(id) {
  const res = await fetch(`/api/catalog/images/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '삭제 실패');
  return data;
}
