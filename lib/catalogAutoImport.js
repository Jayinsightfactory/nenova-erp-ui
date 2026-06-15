// 카달로그_통합본.pptx — 서버에 있으면 자동 import (매번 수동 업로드 불필요)

import fs from 'fs';
import path from 'path';
import { BULK_IMPORT_DIR } from './catalogImageImport';
import { groupByProdKey, listImages } from './catalogImages';
import { importCatalogSourceBuffer } from './catalogSourceImport';

const META_PATH = path.join(process.cwd(), 'data', 'catalog-source-meta.json');
const INTEGRATED_PPTX_RE = /통합본|integrated/i;

export function findIntegratedPptx() {
  if (!fs.existsSync(BULK_IMPORT_DIR)) return null;
  const files = fs.readdirSync(BULK_IMPORT_DIR, { withFileTypes: true })
    .filter(e => e.isFile() && e.name.toLowerCase().endsWith('.pptx') && INTEGRATED_PPTX_RE.test(e.name))
    .map(e => path.join(BULK_IMPORT_DIR, e.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b), 'ko'));
  return files[0] || null;
}

function loadMeta() {
  try {
    return JSON.parse(fs.readFileSync(META_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function saveMeta(meta) {
  fs.mkdirSync(path.dirname(META_PATH), { recursive: true });
  fs.writeFileSync(META_PATH, JSON.stringify(meta, null, 2), 'utf8');
}

function registeredProductCount() {
  return Object.keys(groupByProdKey(listImages())).length;
}

/** 통합본 자동 import 필요 여부 */
export function needsIntegratedImport() {
  const src = findIntegratedPptx();
  if (!src) return { needed: false, reason: 'no_integrated_file', sourcePath: null };

  const stat = fs.statSync(src);
  const registered = registeredProductCount();
  const meta = loadMeta();
  const sameFile = meta?.sourceFile === path.basename(src);
  const sameMtime = meta?.sourceMtime === stat.mtimeMs;

  if (registered === 0) {
    return { needed: true, reason: 'no_images', sourcePath: src, registered };
  }
  if (!sameFile || !sameMtime) {
    return { needed: true, reason: 'source_updated', sourcePath: src, registered };
  }
  return { needed: false, reason: 'already_imported', sourcePath: src, registered };
}

/** 서버 통합본 → ERP 이미지 (최초 1회 또는 파일 갱신 시) */
export async function ensureIntegratedCatalogImages(products, uploadedBy = null) {
  const check = needsIntegratedImport();
  if (!check.needed) {
    return {
      ran: false,
      reason: check.reason,
      registered: check.registered ?? registeredProductCount(),
      sourceFile: check.sourcePath ? path.basename(check.sourcePath) : null,
    };
  }

  const src = check.sourcePath;
  const stat = fs.statSync(src);
  const buf = fs.readFileSync(src);
  const result = await importCatalogSourceBuffer(buf, path.basename(src), products, uploadedBy);

  saveMeta({
    sourceFile: path.basename(src),
    sourceMtime: stat.mtimeMs,
    sourceSize: stat.size,
    lastImportAt: new Date().toISOString(),
    extracted: result.extracted,
    matchedCount: result.matchedCount,
    extractEngine: result.extractEngine || null,
  });

  return {
    ran: true,
    reason: check.reason,
    sourceFile: path.basename(src),
    registered: registeredProductCount(),
    ...result,
    message: `통합본 자동 등록 ${result.matchedCount}건 (추출 ${result.extracted}건)`,
  };
}
