// 카탈로그 작업 저장 — 서버 JSON

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

const DRAFTS_DIR = path.join(process.cwd(), 'data', 'catalog-drafts');

function ensureDir() {
  if (!fs.existsSync(DRAFTS_DIR)) fs.mkdirSync(DRAFTS_DIR, { recursive: true });
}

function draftPath(id) {
  return path.join(DRAFTS_DIR, `${id}.json`);
}

function readDraftFile(id) {
  const p = draftPath(id);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function listCatalogDrafts() {
  ensureDir();
  const files = fs.readdirSync(DRAFTS_DIR).filter(f => f.endsWith('.json'));
  const items = files.map(f => {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(DRAFTS_DIR, f), 'utf8'));
      return summarizeDraft(d);
    } catch {
      return null;
    }
  }).filter(Boolean);
  items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return items;
}

export function getCatalogDraft(id) {
  if (!id) return null;
  return readDraftFile(String(id));
}

export function saveCatalogDraft({ id, name, payload, savedBy }) {
  ensureDir();
  const draftId = id || randomUUID();
  const now = new Date().toISOString();
  const existing = readDraftFile(draftId);
  const data = {
    id: draftId,
    name: String(name || payload?.catalogTitle || '카탈로그').trim() || '카탈로그',
    updatedAt: now,
    createdAt: existing?.createdAt || now,
    savedBy: savedBy || existing?.savedBy || null,
    payload: payload || {},
  };
  fs.writeFileSync(draftPath(draftId), JSON.stringify(data, null, 2), 'utf8');
  return summarizeDraft(data);
}

export function deleteCatalogDraft(id) {
  const p = draftPath(String(id));
  if (fs.existsSync(p)) fs.unlinkSync(p);
  return { id: String(id), deleted: true };
}

export function summarizeDraft(draft) {
  const p = draft?.payload || {};
  return {
    id: draft.id,
    name: draft.name,
    updatedAt: draft.updatedAt,
    createdAt: draft.createdAt,
    savedBy: draft.savedBy || null,
    catalogTitle: p.catalogTitle || draft.name,
    lineCount: p.lines?.length || 0,
    slideCount: p.composerSlides?.length || 0,
    custName: p.custName || null,
    perPage: p.perPage || 8,
  };
}
