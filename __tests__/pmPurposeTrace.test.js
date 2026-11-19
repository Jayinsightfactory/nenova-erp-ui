// __tests__/pmPurposeTrace.test.js — /pm 목적 우선 배너 + 실시간 PM 파이프라인 트레이스 모션 도면 계약
//   - 맨 위 data-testid="pm-purpose-banner": WHY · 해결 대상 손실/병목 · 완료 기준(DONE) · 담당 · 기대 효과, 과제 선택 시 그 과제 기준으로 바뀜
//   - data-testid="pm-live-trace-diagram": 6단계 카드(완료/실행 중/대기), 모눈 20px, 흐르는 점선(stroke-dashoffset)·reduced-motion, AUTO 1x
//   - 03→04 리턴 버스 선과 버스 배지 겹침 0(별도 레인 · 불투명 흰 배경), hex 0 · raw <button> 0 · 굴림체 폴백 0
// 실행: node __tests__/pmPurposeTrace.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { transformSync } = require('next/dist/build/swc');

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const REL = 'components/pm/PmPurposeTraceBoard.js';
const src = read(REL);
const page = read('pages/pm.js');

// 키트 대역(테스트 전용): 실제 키트와 같은 태그·속성 모양만 흉내 낸다.
const h = React.createElement;
const cx = (...a) => a.filter(Boolean).join(' ');
const uiStub = {
  Button: ({ variant = 'secondary', size = 'md', className, children, ...rest }) => h('button', { type: 'button', ...rest, className: cx('pmk', 'pmk-btn', `pmk-${variant}`, `pmk-${size}`, className) }, children),
  ToggleChip: ({ on, className, children, ...rest }) => h('button', { type: 'button', 'aria-pressed': !!on, ...rest, className: cx('pmk', 'pmk-chip', on && 'on', className) }, children),
  SelectCard: ({ on, pressed, expanded, className, children, ...rest }) => h('button', { type: 'button', ...rest, 'aria-pressed': pressed === undefined ? undefined : !!pressed, className: cx('pmk', 'pmk-card', on && 'on', className) }, children),
};

function compile(rel) {
  const filename = path.join(root, rel);
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const baseRequire = Module.createRequire(filename);
  mod.require = (id) => (id === './ui' ? uiStub : baseRequire(id));
  const { code } = transformSync(fs.readFileSync(filename, 'utf8'), {
    filename,
    jsc: { parser: { syntax: 'ecmascript', jsx: true }, target: 'es2022', transform: { react: { runtime: 'automatic' } } },
    module: { type: 'commonjs' },
  });
  mod._compile(code, filename);
  return mod.exports;
}

const M = compile(REL);
const { default: Board, PmPurposeBanner, TRACE_STEPS, TRACE_TICK_MS, TRACE_BUS_LABEL, traceStageOfTask, traceStepStates, traceEdgeState, taskPurpose, overallRunning, PM_GLOBAL_PURPOSE, PM_TRACE_CSS } = M;

// 1) 6단계 이름·순서(사장님 지정)
assert.deepEqual(TRACE_STEPS.map((s) => `${s.no} ${s.title}`), [
  '01 현장 신호·오류 포착',
  '02 Hermes · 조사관 원인 해부',
  '03 격리 Worktree 코드 수정',
  '04 계약·회귀 가드 검증',
  '05 사장님 결재 · PR 머지',
  '06 Cafe24 · 데스크톱 반영',
]);
for (const s of TRACE_STEPS) { assert.ok(s.purpose && s.purpose.length >= 10, `${s.no} 단계 목적 1줄`); assert.ok(s.rule, `${s.no} 검증 규칙 토큰`); }
assert.equal(TRACE_TICK_MS, 2600, 'AUTO 1x = 2,600ms');

// 2) 과제 상태 → 단계 해석
assert.equal(traceStageOfTask({ state: 'escalated' }), 1);
assert.equal(traceStageOfTask({ state: '조사예정' }), 1);
assert.equal(traceStageOfTask({ state: 'fixing in worktree' }), 2);
assert.equal(traceStageOfTask({ state: '검증중' }), 3);
assert.equal(traceStageOfTask({ state: '승인필요' }), 4);
assert.equal(traceStageOfTask({ state: 'deploy' }), 5);
assert.equal(traceStageOfTask({ state: 'done' }), 6);
assert.equal(traceStageOfTask({ state: '' }), 0);
assert.deepEqual(traceStepStates(2), ['done', 'done', 'run', 'wait', 'wait', 'wait']);
assert.deepEqual(traceStepStates(6), ['done', 'done', 'done', 'done', 'done', 'done']);
assert.equal(traceEdgeState(0, 3), 'done');
assert.equal(traceEdgeState(1, 3), 'done');
assert.equal(traceEdgeState(2, 3), 'run', '실행 중 카드로 들어가는 선 = 파란 점선');
assert.equal(traceEdgeState(3, 3), 'wait');

// 3) 전체 보기: 사장님 확인(승인)이 가장 먼저
const tasks = [
  { key: 'fixture-review', state: 'escalated', msg: '연습 오류: 자료 확인 필요', decision: '원천 확인 후 다시 조회', owner: '연습담당', days: 2 },
  { key: 'approve-1', state: '승인필요', msg: '출고 단가 수정 결재' },
];
assert.equal(overallRunning(tasks).running, 4);
assert.deepEqual(overallRunning(tasks).counts, [0, 1, 0, 0, 1, 0]);
assert.equal(overallRunning([]).running, 6, '열린 과제 없으면 전 단계 완료');

// 4) 과제 목적: 피드 필드 우선, 없으면 메시지·조치·담당으로
const tp = taskPurpose(tasks[0]);
assert.equal(tp.scope, 'task');
assert.ok(tp.why.includes('연습 오류: 자료 확인 필요'), '선택 과제 WHY = 그 과제 메시지 기준');
assert.ok(tp.loss.startsWith('2일째 열려 있음'), '정체 일수 손실 표시');
assert.ok(tp.done.includes('원천 확인 후 다시 조회'), '완료 기준 = 조치 + 검증');
assert.equal(tp.agent, '연습담당');
assert.ok(tp.effect);
assert.equal(taskPurpose({ key: 'x', purpose: '직접 목적', done: '직접 완료', effect: '직접 효과' }).why, '직접 목적');
assert.equal(taskPurpose(null), PM_GLOBAL_PURPOSE);

// 5) 배너 렌더: 전체 → 과제 선택 시 동적 전환
const gHtml = renderToStaticMarkup(h(PmPurposeBanner, { task: null, tasks, unresolvedCount: 1 }));
assert.ok(gHtml.includes('data-testid="pm-purpose-banner"') && gHtml.includes('data-scope="global"'));
for (const t of ['핵심 목적 · PURPOSE', '왜 · WHY', '해결 대상 손실 · 병목', '완료 기준 · DONE', '담당 에이전트', '기대 효과', PM_GLOBAL_PURPOSE.why]) assert.ok(gHtml.includes(t), `배너 문구 ${t}`);
const tHtml = renderToStaticMarkup(h(PmPurposeBanner, { task: tasks[0], tasks, onClear: () => {} }));
assert.ok(tHtml.includes('data-scope="task"') && tHtml.includes('선택 과제 · fixture-review') && tHtml.includes('연습담당') && tHtml.includes('전체 목적 보기'));

// 6) 도면 렌더: 카드 6장 · 상태 배지 · 목적 · 검증 토큰 · AUTO · 버스 레인 · 모눈 20px
const bHtml = renderToStaticMarkup(h(Board, { tasks, task: tasks[0], reduced: false }));
assert.ok(bHtml.includes('data-testid="pm-live-trace-diagram"'));
assert.equal((bHtml.match(/data-trace-step="/g) || []).length, 6, '단계 카드 6장');
assert.deepEqual([...bHtml.matchAll(/data-state="(\w+)"/g)].map((m) => m[1]), ['done', 'run', 'wait', 'wait', 'wait', 'wait'], 'escalated 과제 = 02 실행 중');
for (const t of ['완료', '실행 중', '대기', 'AUTO 1x · 재생', '2,600ms', TRACE_BUS_LABEL, 'data-trace-bus="true"', 'data-testid="pm-trace-step-detail"', 'width="20" height="20"', '단계 목적', '검증 규칙']) assert.ok(bHtml.includes(t), `도면 요소 ${t}`);
for (const s of TRACE_STEPS) { assert.ok(bHtml.includes(s.purpose), `${s.no} 목적 표시`); assert.ok(bHtml.includes(s.rule), `${s.no} 검증 토큰 표시`); }
const allDone = renderToStaticMarkup(h(Board, { tasks: [], task: null }));
assert.equal((allDone.match(/data-state="done"/g) || []).length, 6);

// 7) 디자인 계약(레퍼런스 이미지): 색 · 좌측 4px 바 · 흐르는 점선 · reduced-motion · 레인 분리 · 글꼴
for (const c of ['rgb(5, 150, 105)', 'rgb(37, 99, 235)', 'rgb(239, 246, 255)', 'rgb(203, 213, 225)']) assert.ok(PM_TRACE_CSS.includes(c), `색 ${c}`);
assert.ok(/border-left: 4px solid/.test(PM_TRACE_CSS), '좌측 4px 상태 바');
assert.ok(/\.pmtr-edge\.e-run \{[^}]*stroke-dasharray[^}]*animation: pmtr-flow/.test(PM_TRACE_CSS), '실행 중 선 = 흐르는 점선');
assert.ok(/@keyframes pmtr-flow \{ to \{ stroke-dashoffset:/.test(PM_TRACE_CSS), 'stroke-dashoffset 애니메이션');
assert.ok(/@media \(prefers-reduced-motion: reduce\) \{\s*\.pm \.pmtr-edge\.e-run \{ animation: none; \}/.test(PM_TRACE_CSS), 'reduced-motion 시 점선 정지');
assert.ok(/st === 'done' && !reduced/.test(src), 'reduced-motion 시 패킷 점 없음');
assert.ok(/\.pmtr-grid \{[^}]*grid-template-rows: auto 64px auto/.test(PM_TRACE_CSS), '03→04 버스 전용 레인(64px)');
assert.ok(/\.pmtr-bus \{[^}]*background: rgb\(255, 255, 255\)/.test(PM_TRACE_CSS), '버스 배지 불투명 흰 배경');
assert.ok(/\.pmtr-lane \{[^}]*align-items: flex-end/.test(PM_TRACE_CSS), '버스 배지는 레인 아래쪽, 선은 위쪽');
assert.ok(/bus\.top - 10/.test(src) && /data-bus-clear/.test(src), '선이 배지에 닿으면 레인 위로 비키고 data-bus-clear 로 실측');
assert.ok(/\.pmpb-why \{[^}]*font-size: 17px; font-weight: 800/.test(PM_TRACE_CSS), '목적 WHY 17px 굵게');
assert.ok(/\.pmpb-cell dd \{[^}]*font-size: 15px; font-weight: 700/.test(PM_TRACE_CSS), '손실·완료 기준 15px 굵게');
assert.ok(/\.pmtr-title \{[^}]*font-size: 14\.5px/.test(PM_TRACE_CSS) && /\.pmtr-purpose \{[^}]*font-size: 13px/.test(PM_TRACE_CSS) && /\.pmtr-rule \{[^}]*font-size: 13px/.test(PM_TRACE_CSS), '카드 글자 13~14.5px');
assert.ok(PM_TRACE_CSS.includes("Pretendard") && PM_TRACE_CSS.includes("'Malgun Gothic'"), 'Pretendard / 맑은 고딕');
assert.ok(!/gulim|굴림|batang|돋움|dotum/i.test(src), '굴림체 계열 폴백 금지');
assert.ok(!/(^|[^&\w$])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/m.test(src), 'hex 색 금지');
assert.ok(!/<button[\s>]/.test(src), 'raw <button> 금지 — ./ui 키트만');
assert.ok(!/linear-gradient|radial-gradient/.test(src), '그라디언트 없이 SVG 패턴 모눈');
assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(src), '장식 이모지 0');

// 8) /pm 장착: 맨 위 배너(헤더 바로 아래) + 일반 관제에서 도면 + 업무 대장 선택 연동
assert.ok(page.includes("from '../components/pm/PmPurposeTraceBoard'"));
const iHeader = page.indexOf('</header>');
const iBanner = page.indexOf('<PmPurposeBanner');
const iGuide = page.indexOf('<ControlGuide />');
const iKpi = page.indexOf('className="kpi-strip"');
assert.ok(iHeader > 0 && iHeader < iBanner && iBanner < iGuide && iBanner < iKpi, '목적 배너가 헤더 바로 아래, 다른 패널보다 먼저');
assert.ok(/!gameEnabled && <PmPurposeTraceBoard tasks=\{tasks\} task=\{selectedTask\} reduced=\{reduced\} \/>/.test(page), '일반 관제에서 도면 + reduced-motion 전달');
assert.ok(/<PmPurposeBanner task=\{selectedTask\}/.test(page), '배너가 선택 과제와 연동');
assert.equal((page.match(/onSelect=\{setSelTaskKey\}/g) || []).length, 2, '두 업무 대장 모두 과제 선택 연동');
assert.ok(/<SelectCard key=\{\(t\.key \|\| ''\) \+ i\} className=\{`ledger-row/.test(page), '업무 대장 줄 = 키트 SelectCard');

// 9) 가이드 영상 원본 목록에 새 컴포넌트 포함(바뀌면 재촬영 강제)
const guides = JSON.parse(read('config/workflow-guides.json'));
const wf = guides.workflows.find((w) => w.id === 'pm-control');
assert.ok(wf.sourceFiles.includes(REL), 'pm-control 가이드 sourceFiles 에 도면 컴포넌트');
for (const s of ['purpose', 'trace', 'task']) assert.ok(wf.requiredScenarios.includes(s), `가이드 시나리오 ${s}`);
assert.ok(read('scripts/pm-control-smoke.cjs').includes(REL), '녹화 스크립트 sourceFiles 동기화');

console.log('pmPurposeTrace ok (배너 전체/과제 전환 · 6단계 완료/실행 중/대기 · 흐르는 점선+reduced-motion · 버스 레인 분리 · hex 0 · raw button 0)');
