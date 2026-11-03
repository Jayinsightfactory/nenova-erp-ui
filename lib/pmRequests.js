// lib/pmRequests.js
// /pm "시험 실행 만들기" 요청 큐 — data/runtime/pm-requests.json (웹 전용 파일, git 미추적, MSSQL 무관).
//   UI(관리자)가 POST /api/pm/request 로 넣고, 사장님 PC PM 루프가 GET /api/pm/requests 로 가져가 POST /api/pm/requests/ack 로 상태를 돌려준다.
//   같은 사람+업무가 queued/processing 이면 새로 넣지 않고 기존 건을 돌려준다(중복 방지). 최근 500건만 보관.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export const PM_REQUEST_MAX = 500;
export const PM_REQUEST_TYPES = Object.freeze(['dry-run']);
export const PM_ACK_STATUSES = Object.freeze(['processing', 'done', 'failed']);
const ACTIVE = new Set(['queued', 'processing']);

export const pmRequestsPath = () => path.join(process.cwd(), 'data', 'runtime', 'pm-requests.json');

export function readRequests(file = pmRequestsPath()) {
  try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(d?.requests) ? d.requests : []; } catch { return []; }
}

function writeRequests(list, file = pmRequestsPath()) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ requests: list.slice(-PM_REQUEST_MAX) }, null, 1));
  fs.renameSync(tmp, file);
}

const clip = (v, n = 200) => String(v ?? '').trim().slice(0, n);

export function addRequest(body, by, { file = pmRequestsPath(), now = new Date() } = {}) {
  const type = clip(body?.type, 20);
  const person = clip(body?.person, 40);
  const dataName = clip(body?.dataName, 40) || person;
  const workflow = clip(body?.workflow);
  if (!PM_REQUEST_TYPES.includes(type)) return { ok: false, status: 400, error: 'type 은 ' + PM_REQUEST_TYPES.join('|') };
  if (!person || !workflow) return { ok: false, status: 400, error: 'person·workflow 필요' };
  const list = readRequests(file);
  const dup = list.find((r) => r.type === type && r.person === person && r.workflow === workflow && ACTIVE.has(r.status));
  if (dup) return { ok: true, duplicate: true, request: dup };
  const request = { id: crypto.randomBytes(6).toString('hex'), at: now.toISOString(), by: clip(by, 40), type, person, dataName, workflow, status: 'queued' };
  list.push(request);
  writeRequests(list, file);
  return { ok: true, duplicate: false, request };
}

export function listRequests({ status, person } = {}, { file = pmRequestsPath() } = {}) {
  return readRequests(file).filter((r) => (!status || r.status === status) && (!person || r.person === person));
}

function cleanResult(r) {
  if (!r || typeof r !== 'object') return null;
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const out = { mode: clip(r.mode, 30), clicks: num(r.clicks), steps: num(r.steps), humanStops: num(r.humanStops), reason: clip(r.reason, 300), message: clip(r.message, 500) };
  if (r.draftId != null && r.draftId !== '') out.draftId = clip(r.draftId, 40);
  return out;
}

export function ackRequest(body, { file = pmRequestsPath(), now = new Date() } = {}) {
  const id = clip(body?.id, 40);
  const status = clip(body?.status, 20);
  if (!id) return { ok: false, status: 400, error: 'id 필요' };
  if (!PM_ACK_STATUSES.includes(status)) return { ok: false, status: 400, error: 'status 는 ' + PM_ACK_STATUSES.join('|') };
  const list = readRequests(file);
  const r = list.find((x) => x.id === id);
  if (!r) return { ok: false, status: 404, error: '요청 없음' };
  r.status = status;
  r.updatedAt = now.toISOString();
  const res = cleanResult(body?.result);
  if (res) r.result = res;
  writeRequests(list, file);
  return { ok: true, request: r };
}

// feature-data-ingest 와 같은 서버 전용 토큰(ORBIT_DRIVE_INGEST_TOKEN) 검사
export function ingestTokenOk(req) {
  const want = process.env.ORBIT_DRIVE_INGEST_TOKEN || '';
  if (!want) return { ok: false, status: 503, error: 'ORBIT_DRIVE_INGEST_TOKEN 서버 미설정' };
  const got = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim() || String(req.headers['x-orbit-ingest-token'] || '').trim();
  if (!got) return { ok: false, status: 401, error: '토큰 없음' };
  const a = Buffer.from(got), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? { ok: true } : { ok: false, status: 401, error: '토큰 불일치' };
}
