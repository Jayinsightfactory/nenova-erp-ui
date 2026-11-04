// lib/workLivePipelines.js — /work/manuals "라이브 매뉴얼": 작업 라벨(예 '콜롬비아 인보이스 작업')을 관찰된 단계 경로로 풀어 캡처 슬라이드로 재생.
//   데이터: work-feature-live-pipelines.json (사장님 PC nenova-work-features/build-live-pipelines.js 가 주 1회 생성·업로드,
//           data/runtime 최신본 우선 → 없으면 저장소 스냅샷). 단계·소요·근거 수는 전부 생성기 계산값(LLM 산수 없음).
//   캡처: 생성기가 OCR 로 '안전 단어'만 남기고 전체 블러한 썸네일(data URI). 목록 응답에는 이미지 없음, 작업 1건 상세에서만.
//   직원 확인(맞아요/틀려요): data/work-manuals/_state.json routineConfirm['live:<taskId>'] — 재생성이 덮어쓰지 않는다. MSSQL 무관(파일만).
import fs from 'fs';
import { featureFilePath } from './workFeatureData';
import { loadState, saveRoutineConfirmState } from './workManuals';

const KEY = (id) => `live:${id}`;

export function loadLiveData() {
  const p = featureFilePath('live-pipelines');
  if (!p || !fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

// 근거(세션) 0 이면 생성기 값과 무관하게 '추정'
export function liveConfidence(t) {
  const n = Number(t?.evidence?.sessions || 0);
  if (!n) return 'estimate';
  return ['high', 'medium', 'low', 'estimate'].includes(t?.confidence) ? t.confidence : 'estimate';
}

function confirmOf(confirms, id) {
  const c = confirms[KEY(id)];
  return c ? { status: c.status, by: c.by, at: c.at, note: c.note || '' } : null;
}

// 목록: 이미지 빼고 단계 요약만(캡처 수·첫 캡처 유무)
export function listLivePipelines(data = loadLiveData(), confirms = loadState().routineConfirm || {}) {
  if (!data) return null;
  return {
    generatedAt: data.generatedAt, period: data.period, stats: data.stats,
    tasks: (data.tasks || []).map((t) => ({
      id: t.id, task: t.task, label: t.label, dept: t.dept, place: t.place, people: (t.people || []).length,
      evidence: t.evidence, confidence: liveConfidence(t), estimated: true, handoff: t.handoff || null, totalSec: t.totalSec,
      captures: (t.steps || []).reduce((a, s) => a + (s.captures || []).length, 0),
      steps: (t.steps || []).map((s) => ({ i: s.i, title: s.title, tool: s.tool, avgSec: s.avgSec, support: s.support })),
      confirm: confirmOf(confirms, t.id),
    })),
  };
}

export function getLivePipeline(id, data = loadLiveData(), confirms = loadState().routineConfirm || {}) {
  const t = (data?.tasks || []).find((x) => x.id === id);
  if (!t) return null;
  const { people, ...rest } = t; // 직원 이름 목록은 화면에 내보내지 않음(관측 직원 수만)
  return { ...rest, people: (people || []).length, confidence: liveConfidence(t), estimated: true, confirm: confirmOf(confirms, t.id) };
}

export function confirmLivePipeline(user, id, { status, note } = {}) {
  const key = String(id || '').slice(0, 120);
  if (!key) return { ok: false, status: 400, error: 'id 없음' };
  if (!getLivePipeline(key)) return { ok: false, status: 404, error: '라이브 매뉴얼 작업을 찾을 수 없습니다.' };
  if (!['confirmed', 'wrong', 'clear'].includes(status)) return { ok: false, status: 400, error: 'status 는 confirmed|wrong|clear' };
  const entry = status === 'clear' ? null : { status, note: String(note || '').slice(0, 300), by: user?.userName || user?.userId || '', at: new Date().toISOString() };
  saveRoutineConfirmState(KEY(key), entry);
  return { ok: true, id: key, confirm: entry };
}
