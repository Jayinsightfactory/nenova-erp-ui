'use strict';
// Main-process-only bridge. The shell never chooses a URL or an authenticated owner.
const { ORIGIN } = require('./policy.cjs');
const ROUTE = '/api/desktop/home-workspace';
const ACTIONS = new Set(['create', 'update', 'complete', 'archive', 'restore', 'stop', 'read']);
const fail = message => { throw new Error(message); };
function dateValue(value) {
  if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2}$|^2100-\d{2}-\d{2}$/.test(value)) return fail('업무 날짜를 확인하세요.');
  const time = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(time.getTime()) || time.toISOString().slice(0, 10) !== value) return fail('업무 날짜를 확인하세요.');
  return value;
}
function requestOptions(payload, owner) {
  if (!owner || typeof owner !== 'string' || owner.length > 128) return fail('로그인을 다시 확인하세요.');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return fail('잘못된 업무 요청입니다.');
  const method = payload.method;
  if (!['GET', 'POST'].includes(method)) return fail('지원하지 않는 업무 요청입니다.');
  const url = new URL(ROUTE, ORIGIN);
  const options = { method, credentials: 'include', cache: 'no-store', redirect: 'error', headers: { Origin: ORIGIN } };
  if (method === 'GET') {
    url.searchParams.set('expectedOwnerId', owner);
    if (payload.date !== undefined) url.searchParams.set('date', dateValue(payload.date));
    for (const key of ['offset', 'limit']) if (payload[key] !== undefined) {
      if (!Number.isSafeInteger(payload[key]) || payload[key] < (key === 'limit' ? 1 : 0) || payload[key] > (key === 'limit' ? 500 : 10_000_000)) return fail('목록 범위를 확인하세요.');
      url.searchParams.set(key, String(payload[key]));
    }
  } else {
    const command = payload.command;
    if (!command || typeof command !== 'object' || Array.isArray(command) || !ACTIONS.has(command.action)) return fail('지원하지 않는 업무 변경입니다.');
    if (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 0 || typeof command.requestId !== 'string' || !/^[\w-]{8,100}$/.test(command.requestId)) return fail('업무 버전과 요청 번호를 확인하세요.');
    // Explicit allowlist discards URL, owner, prototype and arbitrary command fields.
    const body = { action: command.action, expectedRevision: command.expectedRevision, requestId: command.requestId, expectedOwnerId: owner };
    if (command.date !== undefined) body.date = dateValue(command.date);
    if (command.startDate !== undefined) body.startDate = dateValue(command.startDate);
    for (const [key, max] of [['taskId', 100], ['title', 300], ['sourceKey', 400]]) if (command[key] !== undefined) {
      if (typeof command[key] !== 'string' || command[key].length > max || /[\u0000-\u001f\u007f]/.test(command[key])) return fail('업무 입력을 확인하세요.');
      body[key] = command[key];
    }
    if (command.weekdays !== undefined) {
      if (!Array.isArray(command.weekdays) || command.weekdays.length > 7 || command.weekdays.some(n => !Number.isInteger(n) || n < 0 || n > 6)) return fail('반복 요일을 확인하세요.');
      body.weekdays = [...new Set(command.weekdays)];
    }
    if (command.done !== undefined) { if (typeof command.done !== 'boolean') return fail('완료 상태를 확인하세요.'); body.done = command.done; }
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  return { url: url.href, options };
}
async function homeWorkspaceRequest({ payload, owner, fetch, isCurrent, onUnauthorized }) {
  const request = requestOptions(payload, owner);
  request.options.signal = AbortSignal.timeout(15000);
  const response = await fetch(request.url, request.options);
  if (!isCurrent()) return fail('계정이 변경되었습니다. 업무를 다시 불러오세요.');
  if (response.status === 401) {
    onUnauthorized();
    return fail('로그인을 다시 확인하세요.');
  }
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > 2 * 1024 * 1024) return fail('업무 응답이 너무 큽니다.');
  const raw = await response.text();
  if (!isCurrent()) return fail('계정이 변경되었습니다. 업무를 다시 불러오세요.');
  if (raw.length > 2 * 1024 * 1024) return fail('업무 응답이 너무 큽니다.');
  let data;
  try { data = JSON.parse(raw); } catch { return fail('업무 응답을 읽지 못했습니다. 다시 시도하세요.'); }
  if (response.status === 403 && ['ACCOUNT_CHANGED', 'ACCOUNT_INACTIVE'].includes(data?.code)) {
    onUnauthorized();
    return fail('로그인 계정이 변경되었거나 사용할 수 없습니다.');
  }
  if (!response.ok || data?.success !== true) return { success: false, status: response.status, code: typeof data?.code === 'string' ? data.code.slice(0, 80) : '', error: typeof data?.error === 'string' ? data.error.slice(0, 300) : '업무를 저장하지 못했습니다.' };
  if (data.schemaVersion !== 1 || data.ownerId !== owner || !Number.isSafeInteger(data.revision) || !Array.isArray(data.tasks) || data.tasks.length > 500 || !Array.isArray(data.guidance) || !Array.isArray(data.feedback) || data.guidance.length > 100 || data.feedback.length > 100) return fail('업무 계정과 응답 형식을 확인하세요.');
  return data;
}
module.exports = { requestOptions, homeWorkspaceRequest };
