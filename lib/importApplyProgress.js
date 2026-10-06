// 출고분배 엑셀 적용 — 실시간 진행상황 인메모리 스토어.
// 적용은 서버 단일 트랜잭션이라 응답 전까지 클라이언트가 깜깜이인데,
// 트랜잭션 안에서 여기에 진행상황을 기록하고 클라이언트가 폴링해 로그를 본다.
// pm2 단일 인스턴스 전제(현 배포 구조). 30분 지난 항목은 자동 정리.
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
    if (now - (v.updatedAt || 0) > TTL_MS) store.delete(k);
  }
}

export function initApplyProgress(jobId, total, owner = '') {
  if (!jobId) return false;
  prune();
  const prior = store.get(String(jobId));
  if (prior && (owner || prior.owner)) return false;
  store.set(String(jobId), {
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
  });
  return true;
}

/** patch: { done, total, stage, current, log } — 있는 필드만 갱신 */
export function progressStep(jobId, patch = {}) {
  const p = jobId ? store.get(String(jobId)) : null;
  if (!p || p.finished) return;
  if (patch.done != null) p.done = Number(patch.done);
  if (patch.total != null) p.total = Number(patch.total);
  if (patch.stage) p.stage = String(patch.stage);
  if (patch.current != null) p.current = String(patch.current);
  if (patch.log) appendLog(p, patch.log);
  p.updatedAt = Date.now();
}

export function finishApplyProgress(jobId, { failed = false, log, result = null, error = null } = {}) {
  const p = jobId ? store.get(String(jobId)) : null;
  if (!p) return;
  p.finished = true;
  p.failed = !!failed;
  if (result) p.result = result;
  if (error) p.error = error;
  if (log) appendLog(p, log);
  p.updatedAt = Date.now();
}

export function getApplyProgress(jobId, owner = '') {
  prune();
  const progress = jobId ? (store.get(String(jobId)) || null) : null;
  if (progress?.owner && progress.owner !== String(owner || '')) return null;
  return progress;
}

export function hasApplyProgress(jobId) {
  prune();
  return !!jobId && store.has(String(jobId));
}
