// lib/pmStaff.js
// /pm 직원 상세 서랍 데이터 — 이미 서버에 있는 runtime 파일(lib/workFeatureData)에서 한 사람 몫만 잘라 요약한다.
// 읽기 전용·파일 전용(MSSQL 무관). 개인정보: 절차 요약만 내보내고 창 제목·키 입력·이미지·evidence id 는 내보내지 않는다.

// 화면 표시 이름 → 데이터 이름 별칭
export const NAME_ALIASES = Object.freeze({ '김지니': ['아드리아나'] });
export const EXEC_APPS = ['전산', '네노바웹', 'nenova', 'nenovaweb'];
export const PIPELINE = ['관찰', '절차 확정', '시험실행(dry-run)', '승인', '실행'];

export function nameCandidates(name) {
  const n = String(name || '').trim();
  return [n, ...(NAME_ALIASES[n] || [])].filter(Boolean);
}

export function findPerson(list, name) {
  const cands = nameCandidates(name);
  return (Array.isArray(list) ? list : []).find((p) => p && cands.includes(p.name)) || null;
}

// 빈도 문자열 → 주당 횟수 추정(순위 가중치용)
export function freqPerWeek(f) {
  const s = String(f || '');
  if (/매일|daily|하루|일일/i.test(s)) return 5;
  if (/차수/.test(s)) return 2;
  if (/주\s*\d|매주|weekly|주간/i.test(s)) { const m = s.match(/주\s*(\d+)/); return m ? Number(m[1]) : 1; }
  if (/월|monthly/i.test(s)) return 0.25;
  return 1;
}

const isExecApp = (app) => { const a = String(app || '').toLowerCase(); return EXEC_APPS.some((x) => a.includes(x.toLowerCase())); };
const pick = (o, keys) => { const r = {}; for (const k of keys) if (o && o[k] != null) r[k] = o[k]; return r; };

export function summarizeWorkflow(w) {
  const steps = Array.isArray(w?.stepsDetail) ? w.stepsDetail : [];
  const total = steps.length;
  const confirmed = steps.filter((s) => s?.confidence === 'confirmed').length;
  const erpVerified = steps.filter((s) => s?.sourceVerified?.basis === 'erp-verified').length;
  const executable = steps.filter((s) => isExecApp(s?.destination?.app)).length;
  const estimated = steps.filter((s) => s?.confidence && s.confidence !== 'confirmed').length;
  const ratio = total ? confirmed / total : 0;
  return {
    name: w?.name || '', stage: w?.stage || [], why: w?.why || '', trigger: w?.trigger || '', frequency: w?.frequency || '',
    tools: w?.tools || [], confidence: w?.confidence || '',
    readiness: { total, confirmed, erpVerified, executable, estimated, ratio: Math.round(ratio * 100) },
    pipelineStage: total && ratio >= 0.8 ? '절차 확정' : '관찰',
    steps: steps.map((s) => ({
      no: s?.no, text: s?.text || '', action: s?.action || '', example: s?.example || '',
      source: pick(s?.source, ['app', 'screen', 'field']), destination: s?.destination ? pick(s.destination, ['app', 'screen', 'field']) : null,
      basis: s?.sourceVerified?.basis || s?.confidence || '',
    })),
    observed: w?.observed && typeof w.observed === 'object' ? { days: Number(w.observed.days) || 0, weeks: Number(w.observed.weeks) || 0, perWeek: Number(w.observed.perWeek) || 0, basis: w.observed.basis || '' } : null,
    pitfalls: Array.isArray(w?.pitfalls) ? w.pitfalls : [],
    decisions: Array.isArray(w?.decisions) ? w.decisions : [],
  };
}

export function summarizeSim(it) {
  const before = Number(it?.before?.totalMinutes) || 0;
  const after = Number(it?.after?.totalMinutes) || 0;
  return {
    title: it?.title || '', menu: it?.menu || '', observed: it?.observed || '', proposal: it?.proposal || '',
    beforeMin: before, afterMin: after, savedPerCase: Math.max(0, before - after),
    perWeek: Number(it?.before?.perWeek) || 0, savingPerWeekMin: Number(it?.savingPerWeekMin) || 0,
    workflowRefs: Array.isArray(it?.workflowRefs) ? it.workflowRefs.map(String).filter(Boolean) : [],
    assumptions: Array.isArray(it?.assumptions) ? it.assumptions.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))) : (typeof it?.assumptions === 'string' ? [it.assumptions] : []),
  };
}

// 업무↔개선안 연결: workflowRefs(정확 일치) 우선. workflowRefs 가 하나도 없는 개선안에 한해서만 이름 포함 비교(추정 연결).
export function linkSim(wf, sims) {
  const n = String(wf.name || '');
  const exact = sims.find((s) => s.workflowRefs.length && s.workflowRefs.includes(n));
  if (exact) return { sim: exact, linkBasis: 'exact' };
  const fuzzy = sims.find((s) => !s.workflowRefs.length && s.title && n && (n.includes(s.title) || s.title.includes(n) || s.observed.includes(n)));
  return fuzzy ? { sim: fuzzy, linkBasis: 'estimated' } : { sim: null, linkBasis: null };
}

// 순위용 주당 횟수: 연결된 개선안 before.perWeek → observed.perWeek(근거 확인일 기반 하한) → 빈도 문구 어림
export function weeklyFreq(wf, sim) {
  if (sim && sim.perWeek > 0) return { perWeek: sim.perWeek, source: 'simulation', label: '개선안 추정', assumptions: sim.assumptions };
  if (wf.observed && wf.observed.perWeek > 0) return { perWeek: wf.observed.perWeek, source: 'observed', label: '근거 확인일(하한)', assumptions: [] };
  return { perWeek: freqPerWeek(wf.frequency), source: 'heuristic', label: '어림', assumptions: [] };
}

// 한 사람 슬라이스. workflows/simulations/proposals 는 파싱된 파일 객체, storySummary 는 {events,sessions,boards} 또는 null.
export function buildStaffSlice(name, { workflows, simulations, proposals, storySummary } = {}) {
  const wp = findPerson(workflows?.people, name);
  const sp = findPerson(simulations?.people, name);
  const pp = findPerson(proposals?.people, name);
  const wfs = (wp?.workflows || []).map(summarizeWorkflow);
  const sims = (sp?.items || []).map(summarizeSim);
  const totalSteps = wfs.reduce((a, w) => a + w.readiness.total, 0);
  const confSteps = wfs.reduce((a, w) => a + w.readiness.confirmed, 0);
  const savedPerWeek = sims.reduce((a, s) => a + s.savingPerWeekMin, 0);
  for (const w of wfs) {
    const { sim, linkBasis } = linkSim(w, sims);
    w.link = sim ? { title: sim.title, basis: linkBasis, savedPerCase: sim.savedPerCase } : null;
    w.freq = weeklyFreq(w, sim);
  }
  const candidates = wfs.map((w) => {
    const saved = w.link ? w.link.savedPerCase : 0;
    const score = (w.readiness.ratio / 100) * w.freq.perWeek * Math.max(saved, 1);
    return { name: w.name, ratio: w.readiness.ratio, frequency: w.frequency, perWeek: w.freq.perWeek, freqLabel: w.freq.label, savedPerCase: saved, linkBasis: w.link?.basis || null, score: Math.round(score * 100) / 100 };
  }).sort((a, b) => b.score - a.score).slice(0, 3);
  const hasData = !!(wp || sp || pp || storySummary);
  return {
    name, dataName: wp?.name || sp?.name || pp?.name || null, hasData,
    role: wp ? { dept: wp.dept || '', roleSummary: wp.roleSummary || '', weekRhythm: wp.weekRhythm || null, unknowns: wp.unknowns || [], dataStrength: wp.dataStrength || null } : null,
    summary: { workflowCount: wfs.length, confirmedRatio: totalSteps ? Math.round((confSteps / totalSteps) * 100) : 0, totalSteps, confSteps, savedPerWeekMin: savedPerWeek || null, candidates },
    workflows: wfs, simulations: sims,
    proposals: (pp?.proposals?.rows || []).map((r) => (typeof r === 'string' ? r : r?.proposal || r?.title || '')).filter(Boolean).slice(0, 20),
    story: storySummary || null,
    generatedAt: { workflows: workflows?.generatedAt || null, simulations: simulations?.generatedAt || null },
  };
}
