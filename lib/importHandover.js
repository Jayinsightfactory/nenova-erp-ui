// lib/importHandover.js — 수입부 인수인계 업무표(하루·주·월) + 새 기준 매뉴얼.
//   데이터: data/import-handover.json (저장소 파일, 사람이 근거를 대조해 쓴 것 — 자동 생성 아님). MSSQL 무관(파일만 읽음).
//   매뉴얼 한 편의 기준(6항목): ①왜·언제 ②준비 자료 ③단계 1,2,3…(무엇을 보고·무엇을 넣고·왜) ④끝났는지 확인 ⑤자주 틀리는 곳 ⑥다음 일.
//   영상이 있으면 영상 목차 번호·제목이 글 단계 번호·제목과 같아야 한다(validateImportHandover 가 검사).
//   주어는 업무 절차다. 사람 이름은 "이 절차를 실제로 하던 사람"으로만 쓰고 평가 문구는 넣지 않는다.
import fs from 'fs';
import path from 'path';

export const EVIDENCE_STATUS = Object.freeze({ confirmed: '확정', estimated: '추정' });
export const SCHEDULE_KINDS = Object.freeze(['daily', 'weekly', 'monthly']);
// 직원이 보는 문구에 쓰지 않는 말(업무 지원·인수인계 목적의 화면).
export const BANNED_WORDS = Object.freeze(['감시', '추적', '모니터링', '근태', '성실', '야근', '피로', '게으']);

const FILE = () => path.join(process.cwd(), 'data', 'import-handover.json');

export function loadImportEducation() {
  try { return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'import-education.json'), 'utf8')); } catch { return null; }
}

export function loadImportHandover() {
  try { return JSON.parse(fs.readFileSync(FILE(), 'utf8')); } catch { return null; }
}

const text = (v) => typeof v === 'string' && v.trim().length > 0;
const list = (v) => Array.isArray(v) && v.length > 0;

// 문제 목록을 돌려준다(빈 배열이면 통과). guides = config/workflow-guides.json 의 workflows.
export function validateImportHandover(data, guides = []) {
  const out = [];
  if (!data || data.version !== 1) return ['version 1 필요'];
  const manuals = Array.isArray(data.manuals) ? data.manuals : [];
  const ids = new Set();
  for (const m of manuals) {
    const at = `매뉴얼 ${m.id || '(id 없음)'}`;
    if (!/^[a-z0-9-]+$/.test(String(m.id || '')) || ids.has(m.id)) out.push(`${at}: id 누락/중복`);
    ids.add(m.id);
    if (!text(m.title)) out.push(`${at}: 제목`);
    if (!text(m.why) || !text(m.when)) out.push(`${at}: ①왜·언제`);
    if (!list(m.prepare)) out.push(`${at}: ②준비 자료`);
    if (!list(m.steps)) out.push(`${at}: ③단계`);
    (m.steps || []).forEach((s, i) => {
      if (s.no !== i + 1) out.push(`${at}: 단계 번호는 1부터 차례로(${i + 1}번째가 ${s.no})`);
      if (!text(s.title) || !text(s.look) || !text(s.input) || !text(s.why)) out.push(`${at}: ${i + 1}단계에 제목·무엇을 보고·무엇을 넣고·왜 가 모두 필요`);
    });
    if (!list(m.doneCheck)) out.push(`${at}: ④끝났는지 확인`);
    if (!list(m.pitfalls) || m.pitfalls.some((p) => !text(p.mistake) || !text(p.fix))) out.push(`${at}: ⑤자주 틀리는 곳(실수·처리)`);
    if (!text(m.next)) out.push(`${at}: ⑥다음 일`);
    if (!EVIDENCE_STATUS[m.status]) out.push(`${at}: 확정/추정 표시`);
    if (!list(m.evidence)) out.push(`${at}: 근거`);
    if (m.video) {
      const wf = guides.find((w) => w.id === m.video.workflowId);
      const g = wf?.guides?.find((x) => x.id === m.video.guideId);
      if (!g) out.push(`${at}: 영상 등록 없음(${m.video.workflowId}/${m.video.guideId})`);
      else {
        const want = (m.steps || []).map((s) => `${s.no}. ${s.title}`);
        const got = (g.chapters || []).map((c) => c.title);
        if (want.length !== got.length || want.some((t, i) => t !== got[i])) out.push(`${at}: 영상 목차와 글 단계의 번호·제목이 다름`);
      }
    }
  }
  for (const kind of SCHEDULE_KINDS) {
    for (const r of data.schedule?.[kind] || []) {
      const at = `업무표 ${kind}/${r.id || '(id 없음)'}`;
      if (!text(r.id) || !text(r.when) || !text(r.title)) out.push(`${at}: id·시점·하는 일`);
      if (!EVIDENCE_STATUS[r.status]) out.push(`${at}: 확정/추정 표시`);
      if (!Array.isArray(r.evidence)) out.push(`${at}: 근거 배열`);
      else if (r.status === 'confirmed' && !r.evidence.some((e) => Number(e.count) > 0)) out.push(`${at}: 확정이면 근거 건수가 있어야 함`);
      if (r.manualId && !ids.has(r.manualId)) out.push(`${at}: 없는 매뉴얼 ${r.manualId}`);
    }
  }
  // 국가별 주간 업무표: 칸이 한 단어(입고·발주·메일)로 끝나면 안 된다 — 작업 순서·화면·시간·넘기는 곳이 있어야 한다.
  for (const c of data.countryCalendar || []) {
    if (!text(c.country) || !text(c.partner) || !list(c.cells)) out.push(`국가별 주간 ${c.country || '(나라 없음)'}: 나라·상대·칸`);
    for (const x of c.cells || []) {
      const at = `국가별 주간 ${c.country}/${x.weekday}`;
      if (!text(x.weekday) || !text(x.title) || x.title.trim().length < 8) out.push(`${at}: 무슨 일인지 한 단어가 아니라 문장으로`);
      if (!Array.isArray(x.steps) || x.steps.length < 3) out.push(`${at}: 작업 순서 3단계 이상`);
      if (!list(x.screens) || !text(x.time) || !text(x.handoff)) out.push(`${at}: 화면·걸리는 시간·넘기는 곳(모르면 「확인 필요」)`);
      if (!EVIDENCE_STATUS[x.status] || !list(x.evidence)) out.push(`${at}: 확정/추정과 근거`);
      if (x.status === 'confirmed' && (x.evidence || []).filter((e) => Number(e.count) > 0).length < 2) out.push(`${at}: 확정이면 근거 두 가지 이상`);
      if (x.manualId && !ids.has(x.manualId)) out.push(`${at}: 없는 매뉴얼 ${x.manualId}`);
    }
  }
  const all = JSON.stringify(data);
  for (const w of BANNED_WORDS) if (all.includes(w)) out.push(`쓰지 않는 말: ${w}`);
  return out;
}

// 화면용: 업무표 줄에 매뉴얼 유무·영상 유무를 붙여 준다.
export function importHandoverForView() {
  const data = loadImportHandover();
  if (!data) return null;
  const byId = new Map((data.manuals || []).map((m) => [m.id, m]));
  const schedule = {};
  for (const kind of SCHEDULE_KINDS) {
    schedule[kind] = (data.schedule?.[kind] || []).map((r) => {
      const m = r.manualId ? byId.get(r.manualId) : null;
      return { ...r, manualTitle: m?.title || null, hasVideo: !!m?.video };
    });
  }
  return { ...data, schedule, education: loadImportEducation() };
}
