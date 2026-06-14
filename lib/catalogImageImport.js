// 카탈로그 이미지 — 파일명 → 품목 매칭 + 일괄 등록

import fs from 'fs';
import path from 'path';
import {
  addImageRecord,
  ensureCatalogDirs,
  listImages,
  newImageId,
  pickExt,
  publicUrl,
  relPathFor,
  CATALOG_ROOT,
} from './catalogImages';
import { buildProductMatcher } from './catalogProductMatch';

export const BULK_IMPORT_DIR = path.join(CATALOG_ROOT, '_bulk_import');

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);

export { buildProductMatcher } from './catalogProductMatch';

function saveImageBuffer(buffer, prodKey, originalName, mime = '') {
  const ext = pickExt(originalName, mime);
  const imageId = newImageId();
  const rel = relPathFor(prodKey, imageId, ext);
  const dir = ensureCatalogDirs(prodKey);
  const dest = path.join(dir, `${imageId}${ext}`);
  fs.writeFileSync(dest, buffer);
  const stat = fs.statSync(dest);
  return { rel, url: publicUrl(rel), imageId, fileSize: stat.size };
}

export function importBufferForProduct(buffer, prodKey, originalName, mime, uploadedBy) {
  const existing = listImages({ prodKey });
  if (existing.length > 0) {
    return { skipped: true, prodKey, reason: 'already_has_image' };
  }
  const saved = saveImageBuffer(buffer, prodKey, originalName, mime);
  const image = addImageRecord({
    id: saved.imageId,
    prodKey,
    relPath: saved.rel,
    url: saved.url,
    fileSize: saved.fileSize,
    uploadedBy,
  });
  return { skipped: false, prodKey, image };
}

export function importMatchedFile(filePath, prod, uploadedBy) {
  const buffer = fs.readFileSync(filePath);
  const name = path.basename(filePath);
  return importBufferForProduct(buffer, prod.ProdKey, name, '', uploadedBy);
}

export function listBulkImportFiles() {
  if (!fs.existsSync(BULK_IMPORT_DIR)) return [];
  const out = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (IMAGE_EXT.has(path.extname(ent.name).toLowerCase())) out.push(full);
    }
  };
  walk(BULK_IMPORT_DIR);
  return out;
}

export function runBulkImport(products, files, { uploadedBy, fromScan = false } = {}) {
  const { matchFilename } = buildProductMatcher(products);
  const matched = [];
  const skipped = [];
  const unmatched = [];

  for (const item of files) {
    const filePath = typeof item === 'string' ? item : item.filepath;
    const originalName = typeof item === 'string' ? path.basename(item) : (item.originalFilename || path.basename(filePath));
    if (!filePath || !fs.existsSync(filePath)) continue;

    const ext = path.extname(originalName || filePath).toLowerCase();
    if (!IMAGE_EXT.has(ext)) {
      unmatched.push({ file: originalName, reason: 'unsupported_ext' });
      continue;
    }

    const prod = matchFilename(originalName || filePath);
    if (!prod) {
      unmatched.push({ file: originalName, reason: 'no_product_match' });
      continue;
    }

    try {
      const result = importMatchedFile(filePath, prod, uploadedBy);
      if (result.skipped) {
        skipped.push({ file: originalName, prodKey: prod.ProdKey, prodName: prod.DisplayName || prod.ProdName });
      } else {
        matched.push({ file: originalName, prodKey: prod.ProdKey, prodName: prod.DisplayName || prod.ProdName });
      }
      if (fromScan) {
        try { fs.unlinkSync(filePath); } catch { /* keep file */ }
      }
    } catch (e) {
      unmatched.push({ file: originalName, reason: e.message });
    }
  }

  return { matched, skipped, unmatched, matchedCount: matched.length };
}
