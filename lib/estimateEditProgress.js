// Client-only progress state for the confirmed-estimate edit cycle.
// AppLog has no operation id, so server entries are supporting evidence only;
// the browser's own stages are the authoritative progress display.

export const ESTIMATE_EDIT_LOG_POLL_MS = 3000;

function normalizedWeeks(weeks = []) {
  return [...new Set((weeks || []).map((week) => String(week || '').trim()).filter((week) => /^\d{2}-\d{2}$/.test(week)))].sort();
}

function logKey(log) {
  return [log?.CreateDtm, log?.Step, log?.Detail, log?.IsError ? '1' : '0'].join('|');
}

function logTime(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!match) return Number.NaN;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > maxDay || hour > 23 || minute > 59 || second > 59) return Number.NaN;
  const time = new Date(`${text.replace(' ', 'T')}+09:00`).getTime();
  return Number.isFinite(time) ? time : Number.NaN;
}

export function createEstimateEditProgress({ operationId, orderYear, weeks = [], userId = '', pollServerLogs = false, startedAt = Date.now(), title = '자동 확정차수 편집 준비 중' } = {}) {
  return {
    operationId: String(operationId || ''),
    orderYear: String(orderYear || ''),
    weeks: normalizedWeeks(weeks),
    userId: String(userId || '').trim(),
    pollServerLogs: pollServerLogs === true,
    startedAt: Number(startedAt) || Date.now(),
    completedAt: 0,
    running: true,
    stages: [{ at: Number(startedAt) || Date.now(), kind: 'start', status: 'running', label: title }],
    serverLogs: [],
    pollError: '',
    pollFailures: 0,
    lastPolledAt: 0,
  };
}

export function appendEstimateEditProgress(progress, operationId, stage = {}) {
  if (!progress || progress.operationId !== String(operationId || '')) return progress;
  const at = Number(stage.at) || Date.now();
  return {
    ...progress,
    stages: [...progress.stages, {
      at,
      kind: stage.kind || 'stage',
      status: stage.status || 'running',
      label: String(stage.label || ''),
    }],
  };
}

export function setEstimateEditProgressWeeks(progress, operationId, weeks = []) {
  if (!progress || progress.operationId !== String(operationId || '')) return progress;
  return { ...progress, weeks: normalizedWeeks(weeks) };
}

export function finishEstimateEditProgress(progress, operationId, { ok, label, at = Date.now() } = {}) {
  if (!progress || progress.operationId !== String(operationId || '')) return progress;
  const completedAt = Number(at) || Date.now();
  return {
    ...appendEstimateEditProgress(progress, operationId, {
      at: completedAt,
      kind: 'result',
      status: ok ? 'done' : 'error',
      label: label || (ok ? '자동 확정차수 편집 완료' : '자동 확정차수 편집 실패'),
    }),
    running: false,
    completedAt,
  };
}

export function filterEstimateEditServerLogs(logs, { orderYear, weeks, startedAt, completedAt, userId } = {}) {
  const year = String(orderYear || '').trim();
  const scopedWeeks = normalizedWeeks(weeks);
  const from = Number(startedAt);
  const until = Number(completedAt) || 0;
  const expectedUser = String(userId || '').trim();
  if (!year || scopedWeeks.length === 0 || !Number.isFinite(from) || from <= 0) return [];

  return (logs || []).flatMap((log) => {
    const step = String(log?.Step || '');
    const detail = String(log?.Detail || '');
    const timestamp = logTime(log?.CreateDtm);
    const inScope = scopedWeeks.some((week) => detail.includes(`${year}/${week}`));
    if (!inScope || !Number.isFinite(timestamp) || timestamp < from || (until > 0 && timestamp > until)) return [];
    if (!/^(unfix_|fix_|stock_calc|reconcile_)/.test(step)) return [];

    // Only some AppLog rows contain uid. A mismatched uid is excluded; a row
    // with no uid remains a same-week reference, never proof of ownership.
    const loggedUser = detail.match(/(?:^|\s)uid=([^\s]+)/i)?.[1] || '';
    if (expectedUser && loggedUser && loggedUser !== expectedUser) return [];
    return [{
      ...log,
      correlation: expectedUser && loggedUser === expectedUser ? 'user-match' : 'week-reference',
    }];
  }).sort((a, b) => logTime(a?.CreateDtm) - logTime(b?.CreateDtm));
}

export function mergeEstimateEditServerLogs(progress, operationId, logs, now = Date.now()) {
  if (!progress || !progress.running || progress.operationId !== String(operationId || '')) return progress;
  const filtered = filterEstimateEditServerLogs(logs, progress);
  const known = new Set(progress.serverLogs.map(logKey));
  const merged = [...progress.serverLogs];
  for (const log of filtered) {
    if (!known.has(logKey(log))) merged.push(log);
  }
  merged.sort((a, b) => logTime(a?.CreateDtm) - logTime(b?.CreateDtm));
  return {
    ...progress,
    serverLogs: merged,
    pollError: '',
    pollFailures: 0,
    lastPolledAt: Number(now) || Date.now(),
  };
}

export function recordEstimateEditPollFailure(progress, operationId, error, now = Date.now()) {
  if (!progress || !progress.running || progress.operationId !== String(operationId || '')) return progress;
  return {
    ...progress,
    pollError: String(error?.message || error || '서버 진행 로그를 조회하지 못했습니다.'),
    pollFailures: Number(progress.pollFailures || 0) + 1,
    lastPolledAt: Number(now) || Date.now(),
  };
}

export function nextEstimateEditPollDelay(pollFailures = 0) {
  return Math.min(15000, ESTIMATE_EDIT_LOG_POLL_MS * (2 ** Math.min(2, Math.max(0, Number(pollFailures) || 0))));
}

export function formatEstimateEditElapsed(progress, now = Date.now()) {
  if (!progress?.startedAt) return '00:00';
  const end = progress.completedAt || now;
  const seconds = Math.max(0, Math.floor((Number(end) - Number(progress.startedAt)) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function formatEstimateEditNotice(progress) {
  if (!progress || progress.pollServerLogs) return '';
  if (progress.running) return '확정 상태를 유지해 저장 중입니다.';
  const last = progress.stages?.at(-1);
  return last?.status === 'done'
    ? '확정 상태를 유지해 저장했습니다.'
    : '저장 결과를 확인하세요.';
}

export function describeDateQuantitySaveResult(data = {}) {
  const direction = String(data?.direction || '').trim().toLowerCase();
  const stockMode = String(data?.stockMode || '').trim().toLowerCase();
  const availability = Array.isArray(data?.stockValidation?.availability) ? data.stockValidation.availability : [];
  const labels = [];
  if (direction === 'increase') labels.push('수량 증가');
  else if (direction === 'decrease') labels.push('수량 감소');
  else if (direction === 'mixed') labels.push('수량 증가·감소 함께 반영');
  else if (direction === 'noop') labels.push('수량 변경 없음');
  if (stockMode === 'fixed-direct') labels.push('변경 품목 재고 반영');
  else if (stockMode === 'unfixed-no-stock') labels.push('미확정 분배만 반영');
  if (availability.length > 0) labels.push('증가분 재고 검증 통과');
  else labels.push('수량 증가 없음 · 부족재고 검사 생략');
  return labels;
}
