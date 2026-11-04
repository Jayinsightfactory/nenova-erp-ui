// lib/pmStaffRequests.js
// /pm "직원 요청" 게시판 — 직원이 오류·요청사항을 쓰면 사장님 PC PM 루프(nenova-pm/pm-staff.js)가 가져가 분류·답변·수정(PR)한다.
//   저장: data/runtime/pm-staff-requests.json (웹 전용 파일, git 미추적, MSSQL 무관) + 스크린샷 data/runtime/pm-staff-shots/<id>.jpg|png
//   직원(로그인 누구나): 작성·열람. 수정은 작성자 본인과 관리자(isOrbitReportViewer)만.
//   PM(ORBIT_DRIVE_INGEST_TOKEN): 상태·진행 로그·답변·PR·중복묶음 갱신(/api/pm/requests?kind=staff, /api/pm/requests/ack kind=staff).
//   상태 흐름: received(접수) → triaged(분류됨) → working(처리중) → pr(PR 올라감) → deployed(배포됨)
//              또는 answered(답변완료) / needs-human(사람 확인 필요) / rejected(반려)
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { STAFF_REQ_CATEGORIES, STAFF_REQ_STATUSES, statusLabel } from './pmStaffReqLabels';

export { STAFF_REQ_CATEGORIES, STAFF_REQ_STATUSES, STAFF_REQ_DONE, statusLabel, categoryLabel } from './pmStaffReqLabels';

export const STAFF_REQ_MAX = 1000;
export const STAFF_REQ_DAILY_LIMIT = 20; // 한 사람 하루 작성 상한
export const STAFF_SHOT_MAX_BYTES = 700 * 1024;
const CAT = new Set(STAFF_REQ_CATEGORIES.map(([k]) => k));
const ST = new Set(STAFF_REQ_STATUSES.map(([k]) => k));
const runtimeDir = () => path.join(process.cwd(), 'data', 'runtime');
export const staffReqPath = () => path.join(runtimeDir(), 'pm-staff-requests.json');
export const staffShotDir = () => path.join(runtimeDir(), 'pm-staff-shots');

export function readStaffRequests(file = staffReqPath()) {
  try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(d?.requests) ? d.requests : []; } catch { return []; }
}
function writeStaffRequests(list, file = staffReqPath()) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ requests: list.slice(-STAFF_REQ_MAX) }, null, 1));
  fs.renameSync(tmp, file);
}
const clip = (v, n = 200) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, n);
const uid = (u) => clip(u?.userId ?? u?.UserID ?? '', 40);

// 관련 화면 URL: 같은 사이트 경로만(외부 링크·javascript: 차단)
export function cleanPageUrl(v) {
  const s = clip(v, 300);
  if (!s) return '';
  try { const u = new URL(s, 'http://x.local'); return /^https?:$/.test(u.protocol) ? (u.pathname + u.search).slice(0, 300) : ''; } catch { return ''; }
}

// data:image/(jpeg|png);base64,... → Buffer (매직바이트 확인). 실패 시 null
export function decodeShot(dataUrl) {
  const m = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > STAFF_SHOT_MAX_BYTES) return null;
  const jpg = buf[0] === 0xff && buf[1] === 0xd8, png = buf[0] === 0x89 && buf[1] === 0x50;
  if ((m[1] === 'jpeg' && !jpg) || (m[1] === 'png' && !png)) return null;
  return { buf, ext: m[1] === 'jpeg' ? 'jpg' : 'png' };
}

export function addStaffRequest(body, user, { file = staffReqPath(), shotDir = staffShotDir(), now = new Date() } = {}) {
  const by = uid(user);
  if (!by) return { ok: false, status: 401, error: '로그인 필요' };
  const category = clip(body?.category, 20);
  const title = clip(body?.title, 120);
  const text = clip(body?.body, 4000);
  if (!CAT.has(category)) return { ok: false, status: 400, error: '분류를 고르세요' };
  if (!title) return { ok: false, status: 400, error: '제목을 쓰세요' };
  const list = readStaffRequests(file);
  const day = now.toISOString().slice(0, 10);
  if (list.filter((r) => r.by === by && String(r.at).slice(0, 10) === day).length >= STAFF_REQ_DAILY_LIMIT) {
    return { ok: false, status: 429, error: `하루 ${STAFF_REQ_DAILY_LIMIT}건까지 쓸 수 있습니다` };
  }
  let shot = null;
  if (body?.shot) { shot = decodeShot(body.shot); if (!shot) return { ok: false, status: 400, error: '스크린샷은 700KB 이하 JPG/PNG' }; }
  const id = crypto.randomBytes(6).toString('hex');
  const at = now.toISOString();
  const r = {
    id, at, updatedAt: at, by, byName: clip(user?.userName ?? user?.UserName ?? by, 40),
    category, title, body: text, pageUrl: cleanPageUrl(body?.pageUrl), shot: shot ? `${id}.${shot.ext}` : '',
    status: 'received', log: [{ at, by: 'system', text: '접수됨 — PM 이 곧 분류합니다' }],
  };
  if (shot) { fs.mkdirSync(shotDir, { recursive: true }); fs.writeFileSync(path.join(shotDir, r.shot), shot.buf); }
  list.push(r);
  writeStaffRequests(list, file);
  return { ok: true, request: r };
}

export const canEditStaffRequest = (r, user, isAdmin) => !!r && (isAdmin || (uid(user) !== '' && r.by === uid(user)));

// 작성자/관리자 수정: 제목·내용·분류. 관리자는 상태도(반려·재접수 등) 바꿀 수 있다.
export function editStaffRequest(id, patch, user, isAdmin, { file = staffReqPath(), now = new Date() } = {}) {
  const list = readStaffRequests(file);
  const r = list.find((x) => x.id === clip(id, 40));
  if (!r) return { ok: false, status: 404, error: '글 없음' };
  if (!canEditStaffRequest(r, user, isAdmin)) return { ok: false, status: 403, error: '작성자와 관리자만 수정할 수 있습니다' };
  const changed = [];
  if (patch?.title !== undefined) { const t = clip(patch.title, 120); if (!t) return { ok: false, status: 400, error: '제목을 쓰세요' }; if (t !== r.title) { r.title = t; changed.push('제목'); } }
  if (patch?.body !== undefined) { const b = clip(patch.body, 4000); if (b !== r.body) { r.body = b; changed.push('내용'); } }
  if (patch?.category !== undefined) { const c = clip(patch.category, 20); if (!CAT.has(c)) return { ok: false, status: 400, error: '분류 오류' }; if (c !== r.category) { r.category = c; changed.push('분류'); } }
  if (patch?.status !== undefined) {
    if (!isAdmin) return { ok: false, status: 403, error: '상태 변경은 관리자만' };
    const s = clip(patch.status, 20);
    if (!ST.has(s)) return { ok: false, status: 400, error: '상태 오류' };
    if (s !== r.status) { r.status = s; changed.push(`상태→${statusLabel(s)}`); }
  }
  if (patch?.comment !== undefined && clip(patch.comment, 1000)) changed.push('댓글');
  if (!changed.length) return { ok: true, request: r };
  const at = now.toISOString();
  r.updatedAt = at;
  r.log = [...(r.log || []), { at, by: uid(user), text: clip(patch?.comment, 1000) || `${changed.join('·')} 수정` }].slice(-50);
  // 내용이 바뀌면 PM 이 다시 본다(답변·보류 건 재분류). 진행 중 PR 은 건드리지 않음.
  if ((changed.includes('내용') || changed.includes('제목') || changed.includes('댓글')) && ['answered', 'needs-human', 'triaged'].includes(r.status) && patch?.status === undefined) {
    r.status = 'received'; r.reopened = (r.reopened || 0) + 1;
  }
  writeStaffRequests(list, file);
  return { ok: true, request: r };
}

// 목록(화면용) — 최신 먼저. 스크린샷은 파일명 대신 유무만.
export function listStaffRequests({ status, since } = {}, { file = staffReqPath() } = {}) {
  return readStaffRequests(file)
    .filter((r) => (!status || r.status === status) && (!since || String(r.updatedAt || r.at) > since))
    .sort((a, b) => (String(b.at) > String(a.at) ? 1 : -1));
}

export function staffShotFile(id, { file = staffReqPath(), shotDir = staffShotDir() } = {}) {
  const r = readStaffRequests(file).find((x) => x.id === clip(id, 40));
  if (!r || !r.shot || !/^[0-9a-f]{12}\.(jpg|png)$/.test(r.shot)) return null;
  const p = path.join(shotDir, r.shot);
  return fs.existsSync(p) ? { path: p, type: r.shot.endsWith('.png') ? 'image/png' : 'image/jpeg' } : null;
}

// PM 루프 갱신(토큰): {id, status?, log?, answer?, pr?, dupOf?, route?}
export function pmUpdateStaffRequest(body, { file = staffReqPath(), now = new Date() } = {}) {
  const list = readStaffRequests(file);
  const r = list.find((x) => x.id === clip(body?.id, 40));
  if (!r) return { ok: false, status: 404, error: '글 없음' };
  const at = now.toISOString();
  if (body?.status !== undefined) {
    const s = clip(body.status, 20);
    if (!ST.has(s)) return { ok: false, status: 400, error: '상태 오류' };
    r.status = s;
  }
  if (body?.answer !== undefined) r.answer = clip(body.answer, 4000);
  if (body?.pr !== undefined) { const pr = clip(body.pr, 200); r.pr = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(pr) ? pr : ''; }
  if (body?.dupOf !== undefined) r.dupOf = clip(body.dupOf, 40);
  if (body?.route !== undefined) r.route = clip(body.route, 40);
  if (body?.log) r.log = [...(r.log || []), { at, by: 'pm', text: clip(body.log, 1000) }].slice(-50);
  r.updatedAt = at;
  writeStaffRequests(list, file);
  return { ok: true, request: r };
}
