// 서버 전용 — 카탈로그 품목 이미지 인덱스 + 파일 경로

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export const CATALOG_ROOT = path.join(process.cwd(), 'public', 'uploads', 'catalog');
export const PRODUCTS_ROOT = path.join(CATALOG_ROOT, 'products');
export const INDEX_PATH = path.join(process.cwd(), 'data', 'catalog-images.json');

const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);

export function newImageId() {
  return crypto.randomUUID();
}

export function ensureCatalogDirs(prodKey) {
  const dir = path.join(PRODUCTS_ROOT, String(prodKey || '_misc'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function loadIndex() {
  try {
    const raw = fs.readFileSync(INDEX_PATH, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data.images) ? data : { images: [] };
  } catch {
    return { images: [] };
  }
}

export function saveIndex(data) {
  fs.mkdirSync(path.dirname(INDEX_PATH), { recursive: true });
  fs.writeFileSync(INDEX_PATH, JSON.stringify(data, null, 2), 'utf8');
}

export function relPathFor(prodKey, imageId, ext = '.jpg') {
  return `products/${prodKey}/${imageId}${ext}`;
}

export function publicUrl(relPath) {
  return `/uploads/catalog/${relPath.replace(/\\/g, '/')}`;
}

export function absPathFromRel(relPath) {
  const full = path.join(CATALOG_ROOT, relPath);
  const normalized = path.resolve(full);
  if (!normalized.startsWith(path.resolve(CATALOG_ROOT))) {
    throw new Error('invalid path');
  }
  return normalized;
}

export function listImages({ prodKey, prodKeys } = {}) {
  const { images } = loadIndex();
  let list = images.filter(i => !i.deleted);
  if (prodKey) {
    list = list.filter(i => String(i.prodKey) === String(prodKey));
  } else if (prodKeys?.length) {
    const set = new Set(prodKeys.map(String));
    list = list.filter(i => set.has(String(i.prodKey)));
  }
  list.sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  });
  return list;
}

export function groupByProdKey(images) {
  const map = {};
  for (const img of images) {
    const k = String(img.prodKey);
    if (!map[k]) map[k] = [];
    map[k].push(img);
  }
  return map;
}

export function pickPrimary(images) {
  if (!images?.length) return null;
  return images.find(i => i.isPrimary) || images[0];
}

export function addImageRecord({ id, prodKey, relPath, url, fileSize, uploadedBy }) {
  const data = loadIndex();
  const imageId = id || newImageId();
  const pk = Number(prodKey) || prodKey;
  const siblings = data.images.filter(i => !i.deleted && String(i.prodKey) === String(pk));
  const record = {
    id: imageId,
    prodKey: pk,
    relPath,
    url,
    isPrimary: siblings.length === 0,
    fileSize: fileSize || 0,
    createdAt: new Date().toISOString(),
    uploadedBy: uploadedBy || null,
  };
  data.images.push(record);
  saveIndex(data);
  return record;
}

export function updateImagePosition(id, { posX, posY, scale, rotate, autoAdjusted, manualAdjusted }) {
  const data = loadIndex();
  const idx = data.images.findIndex(i => i.id === id && !i.deleted);
  if (idx < 0) return null;
  const nextX = Math.min(180, Math.max(-80, Number(posX)));
  const nextY = Math.min(180, Math.max(-80, Number(posY)));
  const nextScale = Math.min(400, Math.max(100, Number(scale ?? data.images[idx].scale ?? 100)));
  let nextRotate = Number(rotate ?? data.images[idx].rotate ?? 0);
  if (!Number.isFinite(nextRotate)) nextRotate = 0;
  nextRotate = Math.round(nextRotate) % 360;
  if (nextRotate > 180) nextRotate -= 360;
  const prev = data.images[idx];
  let nextAuto = prev.autoAdjusted ?? false;
  let nextManual = prev.manualAdjusted ?? false;
  if (manualAdjusted !== undefined) {
    nextManual = !!manualAdjusted;
    if (nextManual) nextAuto = false;
  }
  if (autoAdjusted !== undefined) {
    nextAuto = !!autoAdjusted;
    if (nextAuto) nextManual = false;
  }
  data.images[idx] = {
    ...prev,
    posX: Number.isFinite(nextX) ? nextX : 50,
    posY: Number.isFinite(nextY) ? nextY : 50,
    scale: Number.isFinite(nextScale) ? nextScale : 100,
    rotate: nextRotate,
    autoAdjusted: nextAuto,
    manualAdjusted: nextManual,
    updatedAt: new Date().toISOString(),
  };
  saveIndex(data);
  return data.images[idx];
}

export function setPrimaryImage(id) {
  const data = loadIndex();
  const target = data.images.find(i => i.id === id && !i.deleted);
  if (!target) return null;
  for (const img of data.images) {
    if (!img.deleted && String(img.prodKey) === String(target.prodKey)) {
      img.isPrimary = img.id === id;
    }
  }
  saveIndex(data);
  return target;
}

export function replaceImageFile(id, { relPath, url, fileSize }) {
  const data = loadIndex();
  const idx = data.images.findIndex(i => i.id === id && !i.deleted);
  if (idx < 0) return null;
  const old = data.images[idx];
  try {
    if (old.relPath && old.relPath !== relPath) {
      fs.unlinkSync(absPathFromRel(old.relPath));
    }
  } catch { /* ignore */ }
  data.images[idx] = {
    ...old,
    relPath,
    url,
    fileSize: fileSize || old.fileSize,
    updatedAt: new Date().toISOString(),
  };
  saveIndex(data);
  return data.images[idx];
}

export function deleteImageRecord(id, { hard = true } = {}) {
  const data = loadIndex();
  const idx = data.images.findIndex(i => i.id === id && !i.deleted);
  if (idx < 0) return null;
  const rec = data.images[idx];
  if (hard) {
    try { fs.unlinkSync(absPathFromRel(rec.relPath)); } catch { /* ignore */ }
    data.images.splice(idx, 1);
    const siblings = data.images.filter(i => !i.deleted && String(i.prodKey) === String(rec.prodKey));
    if (siblings.length && !siblings.some(s => s.isPrimary)) {
      siblings[0].isPrimary = true;
    }
  } else {
    data.images[idx].deleted = true;
    data.images[idx].deletedAt = new Date().toISOString();
  }
  saveIndex(data);
  return rec;
}

export function pickExt(originalName, mime) {
  const ext = (path.extname(originalName || '') || '').toLowerCase();
  if (ALLOWED_EXT.has(ext)) return ext === '.jpeg' ? '.jpg' : ext;
  if (mime === 'image/png') return '.png';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/gif') return '.gif';
  if (mime === 'image/bmp' || mime === 'image/x-ms-bmp') return '.bmp';
  return '.jpg';
}
