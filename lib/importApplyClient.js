export const IMPORT_UNKNOWN_CODES = new Set(['IMPORT_PROGRESS_LOST', 'IMPORT_COMMITTED_REVIEW_REQUIRED',
  'IMPORT_PROGRESS_AUTH', 'IMPORT_WATCH_CANCELLED', 'IMPORT_PROGRESS_SCOPE']);
const failure = (message, code = 'IMPORT_PROGRESS_LOST') => Object.assign(new Error(message), { code });

export async function waitForImportResult({ jobId, fetchFn = fetch, now = Date.now,
  delay = ms => new Promise(resolve => setTimeout(resolve, ms)), onProgress = () => {},
  isCurrent = () => true, year, week }) {
  let deadline = now() + 12 * 60 * 1000;
  let lastUpdatedAt = 0, missing = 0;
  while (now() < deadline) {
    await delay(1200);
    if (!isCurrent()) throw failure('결과 조회를 중지했습니다. 같은 작업번호로 이어서 확인할 수 있습니다.', 'IMPORT_WATCH_CANCELLED');
    try {
      const response = await fetchFn(`/api/shipment/distribute-import-apply-progress?jobId=${encodeURIComponent(jobId)}`,
        { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if ([401, 403].includes(response.status)) throw failure('로그인 후 같은 작업의 결과를 다시 확인하세요. 재적용하지 않았습니다.', 'IMPORT_PROGRESS_AUTH');
      if (!response.ok) continue;
      const { progress } = await response.json();
      if (!isCurrent()) throw failure('조회 화면이 닫혔습니다.', 'IMPORT_WATCH_CANCELLED');
      if (!progress) {
        if (++missing >= 10) throw failure('서버에서 작업 정보를 찾지 못했습니다. 작업번호는 보관했습니다. 결과 다시 확인 또는 업로드 이력에서 확인하세요.');
        continue;
      }
      missing = 0;
      if ((year && progress.year && String(year) !== progress.year) || (week && progress.week && week !== progress.week)) {
        throw failure('작업의 연도·차수가 일치하지 않습니다. 업로드 이력을 확인하세요.', 'IMPORT_PROGRESS_SCOPE');
      }
      const updatedAt = Number(progress.updatedAt);
      if (Number.isFinite(updatedAt) && updatedAt > lastUpdatedAt) {
        lastUpdatedAt = updatedAt;
        deadline = now() + 12 * 60 * 1000;
      }
      onProgress(progress);
      if (!progress.finished) continue;
      if (progress.result) return progress.result;
      if (progress.failed) return { success: false, code: progress.error?.code || 'IMPORT_APPLY_FAILED',
        error: progress.error?.message || '적용 작업이 실패했습니다.' };
    } catch (error) {
      if (IMPORT_UNKNOWN_CODES.has(error.code)) throw error;
      // Temporary GET failures never trigger another POST.
    }
  }
  throw failure('12분 동안 새 진행 정보를 받지 못했습니다. 실패로 확정하지 않았으며 작업번호를 보관했습니다. 결과 다시 확인으로 이어서 조회하세요.');
}

export async function importPendingKey(userId, cryptoApi = globalThis.crypto) {
  if (!userId) throw new Error('로그인 정보를 확인할 수 없습니다. 다시 로그인하세요.');
  const digest = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(String(userId)));
  return `nenova.importApply.pending.v1.${Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')}`;
}
export function readPendingImport(storage, key) {
  const text = storage.getItem(key);
  if (!text) return null;
  const job = JSON.parse(text);
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(job.jobId) || !/^\d{4}$/.test(job.year) || !/^\d{2}-\d{2}$/.test(job.week)) {
    throw new Error('보관된 작업번호를 읽지 못했습니다. 새 적용 전에 업로드 이력을 확인하세요.');
  }
  return job;
}
export function savePendingImport(storage, key, job) {
  const prior = readPendingImport(storage, key);
  if (prior && prior.jobId !== job.jobId) throw new Error('결과 확인이 끝나지 않은 작업이 있습니다. 이전 작업 결과부터 확인하세요.');
  storage.setItem(key, JSON.stringify({ jobId: job.jobId, year: String(job.year), week: job.week }));
}
export function clearPendingImport(storage, key, jobId) {
  if (readPendingImport(storage, key)?.jobId === jobId) storage.removeItem(key);
}
