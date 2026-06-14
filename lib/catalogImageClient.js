// 브라우저 — 업로드 전 이미지 리사이즈 + API 호출

import { parseJsonResponse } from './parseJsonResponse';

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

async function catalogApiFetch(url, options = {}) {
  const res = await fetch(url, { credentials: 'include', ...options });
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('로그인이 필요합니다.');
  }
  const data = await parseJsonResponse(res);
  if (!res.ok) throw new Error(data.error || '요청 실패');
  return data;
}

export async function uploadCatalogImage(file, prodKey) {
  const body = new FormData();
  body.append('file', file);
  body.append('prodKey', String(prodKey));
  const data = await catalogApiFetch('/api/catalog/images', { method: 'POST', body });
  return data.image;
}

export async function replaceCatalogImage(id, file) {
  const body = new FormData();
  body.append('file', file);
  const data = await catalogApiFetch(`/api/catalog/images/${id}`, { method: 'PUT', body });
  return data.image;
}

export async function setCatalogPrimary(id) {
  const data = await catalogApiFetch(`/api/catalog/images/${id}?action=primary`, { method: 'PUT' });
  return data.image;
}

export async function deleteCatalogImage(id) {
  return catalogApiFetch(`/api/catalog/images/${id}`, { method: 'DELETE' });
}

export async function fetchCatalogImages(prodKey) {
  const qs = prodKey ? `?prodKey=${encodeURIComponent(prodKey)}` : '';
  return catalogApiFetch(`/api/catalog/images${qs}`);
}
