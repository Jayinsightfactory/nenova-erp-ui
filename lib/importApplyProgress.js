import path from 'node:path';
import journalModule from './importProgressJournal.cjs';
// Detailed rows remain in memory; private aggregate results survive reloads/workers.
const directory = process.env.IMPORT_APPLY_PROGRESS_DIR ||
  (process.env.NODE_ENV === 'production' ? path.join(process.cwd(), 'data/runtime/import-apply-jobs') : null);
const journal = directory ? journalModule.createImportProgressJournal({ directory }) : null;
if (!global._importApplyProgress) global._importApplyProgress = new Map();
const store = global._importApplyProgress;
const TTL_MS = 30 * 60 * 1000;
// Dutch replacement plans may contain thousands of rows; keep every row-level
// apply event available to the owner's progress poll for the full job lifetime.
const MAX_LOGS = 12000;

function appendLog(progress, log) {
  progress.logs.push(String(log));
  if (progress.logs.length > MAX_LOGS) progress.logs.splice(0, progress.logs.length - MAX_LOGS);
}

function prune() {
  const now = Date.now();
  for (const [k, v] of store) {
    if (v.finished && now - (v.updatedAt || 0) > TTL_MS) store.delete(k);
  }
}

export function initApplyProgress(jobId, total, owner = '', scope = {}) {
  if (!jobId) return false;
  prune();
  const prior = store.get(String(jobId));
  if (prior && (owner || prior.owner)) return false;
  const progress = {
    owner: String(owner || ''),
    total: Number(total) || 0,
    done: 0,
    stage: '준비',
    current: '',
    logs: [],
    finished: false,
    failed: false,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    year: String(scope.year || ''), week: String(scope.week || ''),
  };
  if (journal && !journal.create(jobId, owner, progress)) return false;
  store.set(String(jobId), progress);
  return true;
}

/** patch: { done, total, stage, current, log } — 있는 필드만 갱신 */
export function progressStep(jobId, patch = {}) {
  const p = jobId ? store.get(String(jobId)) : null;
  if (!p || p.finished) return;
  if (patch.done != null) p.done = Number(patch.done);
  if (patch.total != null) p.total = Number(patch.total);
  const stageChanged = patch.stage && patch.stage !== p.stage;
  if (patch.stage) p.stage = String(patch.stage);
  if (patch.auditKey) p.auditKey = Number(patch.auditKey);
  if (patch.year) p.year = String(patch.year);
  if (patch.week) p.week = String(patch.week);
  if (patch.current != null) p.current = String(patch.current);
  if (patch.log) appendLog(p, patch.log);
  p.updatedAt = Date.now();
  if (journal && (patch.auditKey || stageChanged || p.updatedAt - (p.persistedAt || 0) >= 1000)) {
    try { journal.save(jobId, p.owner, p); p.persistedAt = p.updatedAt; }
    catch (error) {
      // Binding the audit key must succeed BEFORE the first ERP write.
      if (patch.auditKey) throw error;
      console.error('[importApplyProgress] progress journal unavailable');
    }
  }
}

export function finishApplyProgress(jobId, { failed = false, log, result = null, error = null } = {}) {
  const p = jobId ? store.get(String(jobId)) : null;
  if (!p || p.finished) return;
  p.finished = true;
  p.failed = !!failed;
  if (result) p.result = result;
  if (error) p.error = error;
  if (log) appendLog(p, log);
  p.updatedAt = Date.now();
  if (journal) {
    try { journal.save(jobId, p.owner, p); }
    catch { console.error('[importApplyProgress] terminal journal unavailable; use audit recovery'); }
  }
}

export function getApplyProgress(jobId, owner = '') {
  prune();
  const progress = jobId ? (store.get(String(jobId)) || null) : null;
  if (progress?.owner && progress.owner !== String(owner || '')) return null;
  if (progress) return { ...progress, workerAlive: !progress.finished };
  return jobId && journal ? journal.get(jobId, owner) : null;
}

export function hasApplyProgress(jobId) {
  prune();
  return !!jobId && (store.has(String(jobId)) || !!journal?.has(jobId));
}
