// lib/orderImportDraft.js — 업로드 주문등록 화면 임시 저장 (클라이언트)

const DRAFT_KEY = 'nenova_import_draft_v1';

export function loadImportDraft() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.items?.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveImportDraft(draft) {
  if (typeof window === 'undefined') return;
  try {
    if (!draft?.items?.length) {
      localStorage.removeItem(DRAFT_KEY);
      return;
    }
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      ...draft,
      savedAt: new Date().toISOString(),
    }));
  } catch { /* ignore quota */ }
}

export function clearImportDraft() {
  if (typeof window === 'undefined') return;
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
}
