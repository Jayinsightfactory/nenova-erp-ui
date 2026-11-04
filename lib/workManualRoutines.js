// lib/workManualRoutines.js — 부서별 "신입 루틴" 매뉴얼(하루·주간·월간·메일·부서간 넘김·현장팀 카톡).
//   데이터: work-feature-manual-routines.json (사장님 PC nenova-work-features/build-manual-routines.js 가 주 1회 생성·업로드,
//           data/runtime 최신본 우선 → 없으면 저장소 스냅샷). 숫자는 전부 생성기가 계산(LLM 산수 없음).
//   직원 확인: data/work-manuals/_state.json 의 routineConfirm[itemId] — 생성기가 다시 돌아도 덮어쓰지 않는다.
//   MSSQL 무관(파일만).
import fs from 'fs';
import { featureFilePath } from './workFeatureData';
import { loadState, saveRoutineConfirmState } from './workManuals';

export const CONFIDENCE_LABEL = Object.freeze({ high: '높음', medium: '보통', low: '낮음', estimate: '추정' });

export function loadRoutineData() {
  const p = featureFilePath('manual-routines');
  if (!p) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

// 신뢰도는 생성기 계산값을 그대로 쓰되, 근거 0 이면 무조건 '추정'(빈 근거로 '높음' 금지)
export function normalizeConfidence(item) {
  const ev = item?.evidence || {};
  const n = Number(ev.count ?? ev.days ?? item?.days ?? item?.messages ?? 0);
  if (!n) return 'estimate';
  return CONFIDENCE_LABEL[item?.confidence] ? item.confidence : 'estimate';
}

function eachItem(data, fn) {
  for (const d of data?.departments || []) for (const p of d.people || []) for (const k of ['daily', 'weekly', 'monthly', 'mail']) for (const it of p[k] || []) fn(it);
}

// 확인 상태를 합쳐 화면용으로 돌려준다
export function routinesForView(data, confirms = {}) {
  if (!data) return null;
  const copy = JSON.parse(JSON.stringify(data));
  eachItem(copy, (it) => {
    it.confidence = normalizeConfidence(it);
    const c = confirms[it.id];
    if (c) it.confirm = { by: c.by, at: c.at, note: c.note || '', status: c.status };
  });
  return copy;
}

export function getRoutines() {
  const data = loadRoutineData();
  return routinesForView(data, loadState().routineConfirm || {});
}

export function routineItemExists(data, id) {
  let hit = false;
  eachItem(data, (it) => { if (it.id === id) hit = true; });
  return hit;
}

// 직원 확인/메모 저장 — status: confirmed | wrong | clear
export function confirmRoutineItem(user, id, { status, note } = {}) {
  const key = String(id || '').slice(0, 160);
  if (!key) return { ok: false, status: 400, error: 'id 없음' };
  const data = loadRoutineData();
  if (!routineItemExists(data, key)) return { ok: false, status: 404, error: '루틴 항목을 찾을 수 없습니다.' };
  if (!['confirmed', 'wrong', 'clear'].includes(status)) return { ok: false, status: 400, error: 'status 는 confirmed|wrong|clear' };
  const entry = status === 'clear' ? null : { status, note: String(note || '').slice(0, 300), by: user?.userName || user?.userId || '', at: new Date().toISOString() };
  saveRoutineConfirmState(key, entry);
  return { ok: true, id: key, confirm: entry };
}
