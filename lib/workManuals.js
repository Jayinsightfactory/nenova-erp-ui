// lib/workManuals.js
// 직원 업무 매뉴얼 — 웹 전용 파일 저장소 (MSSQL 안 건드림).
//  - 초안(seed): data/work-manuals/*.draft.json  (AI가 관찰 기록에서 뽑은 절차, git 추적)
//  - 수정·확인·배치: data/work-manuals/_state.json (런타임, gitignore — 배포가 덮어쓰지 않음)
// 열람 규칙: 사장님(nenovaSS3)은 전체, 직원은 본인 매뉴얼만. 사람 평가 문구는 저장하지 않는다(업무 절차만).

import fs from 'fs';
import path from 'path';
import { isOrbitReportViewer } from './orbitReportAccess';

const DIR = path.join(process.cwd(), 'data', 'work-manuals');
const STATE_FILE = path.join(DIR, '_state.json');

// 2026-09-11 사장님 지정 부서표
export const DEPARTMENTS = Object.freeze([
  { id: 'sales-support', name: '영업지원', members: ['설연주', '강현우', '임재용'] },
  { id: 'import', name: '수입부', members: ['가브리엘', '김원빈'] },
  { id: 'sales', name: '영업부', members: ['박성수', '정재훈', '조현욱'] },
  { id: 'management', name: '경영지원', members: ['강명훈'] },
]);

export function isManualAdmin(user) {
  return isOrbitReportViewer(user);
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function loadSeeds() {
  let files = [];
  try { files = fs.readdirSync(DIR).filter((f) => f.endsWith('.draft.json')); } catch { return []; }
  return files.map((f) => readJson(path.join(DIR, f), null)).filter((m) => m && m.id && m.owner);
}

export function loadState() {
  const s = readJson(STATE_FILE, {});
  return { manuals: s.manuals || {}, layouts: s.layouts || {} };
}

function saveState(state) {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, STATE_FILE);
}

// 초안 위에 직원/사장님 수정본을 덮어 합친 전체 목록
export function allManuals() {
  const { manuals } = loadState();
  const byId = new Map(loadSeeds().map((m) => [m.id, m]));
  for (const [id, edited] of Object.entries(manuals)) byId.set(id, { ...(byId.get(id) || {}), ...edited });
  return [...byId.values()];
}

export function canView(user, manual) {
  if (!user || !manual) return false;
  return isManualAdmin(user) || String(user.userName || '').trim() === manual.owner;
}

export function visibleManuals(user) {
  return allManuals().filter((m) => canView(user, m));
}

function cleanSteps(steps) {
  return (Array.isArray(steps) ? steps : [])
    .map((s) => ({
      title: String(s?.title || '').trim().slice(0, 80),
      detail: String(s?.detail || '').trim().slice(0, 1000),
      app: String(s?.app || '').trim().slice(0, 60),
      check: String(s?.check || '').trim().slice(0, 300),
    }))
    .filter((s) => s.title)
    .map((s, i) => ({ no: i + 1, ...s }));
}

// 직원 확인/수정 저장. confirm=true 면 '확인됨'으로 올림.
export function saveManualEdit(user, id, { steps, summary, confirm }) {
  const current = allManuals().find((m) => m.id === id);
  if (!current) return { ok: false, status: 404, error: '매뉴얼을 찾을 수 없습니다.' };
  if (!canView(user, current)) return { ok: false, status: 403, error: '본인 매뉴얼만 고칠 수 있습니다.' };
  const state = loadState();
  const next = {
    ...(state.manuals[id] || {}),
    steps: cleanSteps(steps ?? current.steps),
    summary: String(summary ?? current.summary ?? '').slice(0, 300),
    status: confirm ? 'confirmed' : (current.status === 'confirmed' ? 'confirmed' : 'edited'),
    updatedAt: new Date().toISOString(),
    updatedBy: user.userName || user.userId,
  };
  if (confirm) { next.confirmedAt = next.updatedAt; next.confirmedBy = next.updatedBy; }
  state.manuals[id] = next;
  saveState(state);
  return { ok: true, manual: { ...current, ...next } };
}

// 아이콘 배치 순서 — 사람마다 따로 저장 (내 배치가 남의 화면을 바꾸지 않음)
export function getLayout(user) {
  return loadState().layouts[user?.userId] || {};
}

export function saveLayout(user, key, order) {
  if (!user?.userId || !/^[\w-]{1,40}$/.test(String(key))) return false;
  const state = loadState();
  const mine = state.layouts[user.userId] || {};
  mine[key] = (Array.isArray(order) ? order : []).map(String).slice(0, 200);
  state.layouts[user.userId] = mine;
  saveState(state);
  return true;
}
