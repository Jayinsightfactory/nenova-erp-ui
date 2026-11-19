// components/pm/PmPurposeTraceBoard.js
// /pm 목적 우선(Purpose-First) 배너 + 실시간 PM 파이프라인 트레이스 모션 도면(2026-11-19 사장님 지정 레퍼런스).
//   - 맨 위 「핵심 목적 · PURPOSE」: 왜 이 화면/선택 과제가 있는지(WHY) · 해결 대상 손실/병목 · 완료 기준(DONE) · 담당 · 기대 효과.
//   - 모눈 그리드 캔버스 위 6단계 직교 배선 카드: 완료(에메랄드 실선 + 이동 패킷) / 실행 중(로열블루 흐르는 점선) / 대기(슬레이트).
//   - 03 → 04 리턴 버스 선과 버스 배지는 서로 다른 레인에 둔다(선-글자 겹침 0건, data-bus-clear 로 실측 확인).
// 색은 rgb(...) 또는 var(--pm-*) 만(hex 금지: __tests__/pmNoHexColor.test.js), 버튼은 ./ui 키트만(__tests__/pmUiKit.test.js).
// 글꼴은 Pretendard → 맑은 고딕 고정(공용 지침 §7.4 한글 서체). 읽기 전용 — 데이터는 /api/pm/office 의 tasks 를 그대로 해석만 한다.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, SelectCard, ToggleChip } from './ui';

const useIsoLayout = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export const TRACE_TICK_MS = 2600;

export const TRACE_STEPS = [
  { no: '01', key: 'signal', surface: 'Surface 1 · 현장 수집', title: '현장 신호·오류 포착', purpose: '직원 화면·카톡·작업 로그의 오류 신호를 한 줄 원장으로 모은다', rule: 'dedup_key 중복 제거 · 원문 보존' },
  { no: '02', key: 'hermes', surface: 'Surface 2 · 원인 조사', title: 'Hermes · 조사관 원인 해부', purpose: '증상이 아니라 원인(데이터·코드·절차)을 짚어 재발 학습으로 남긴다', rule: '재현 1회 이상 · 근거 링크 필수' },
  { no: '03', key: 'worktree', surface: 'Surface 3 · 격리 수정', title: '격리 Worktree 코드 수정', purpose: '운영 화면을 건드리지 않고 별도 작업 공간에서만 고친다', rule: 'git worktree · 담당 파일만 수정' },
  { no: '04', key: 'guard', surface: 'Surface 4 · 회귀 가드', title: '계약·회귀 가드 검증', purpose: '같은 오류가 다른 화면에서 다시 나지 않게 자동 검사로 막는다', rule: 'test:pm · guard:erp-writes PASS' },
  { no: '05', key: 'approve', surface: 'Surface 5 · 결재', title: '사장님 결재 · PR 머지', purpose: '사장님이 목적과 결과를 확인한 뒤에만 운영 코드에 합친다', rule: 'PR 체크 PASS · squash merge' },
  { no: '06', key: 'deploy', surface: 'Surface 6 · 운영 반영', title: 'Cafe24 · 데스크톱 반영', purpose: '현장 직원 화면에 실제로 반영되어 오류가 사라진 것까지 확인한다', rule: '반영 후 화면 재확인 · 오류 0건' },
];

export const TRACE_BUS_LABEL = '격리 수정본 → 회귀 가드 인계 버스';

const STATE_LABEL = { done: '완료', run: '실행 중', wait: '대기' };

// 과제 상태 문자열 → 현재 실행 중인 단계 번호(0~5). 6 = 전 단계 완료.
const STAGE_RULES = [
  [6, /done|완료|merged|resolved|closed|해결/i],
  [5, /배포|deploy|release|cafe24|반영/i],
  [4, /승인|approv|decision|결재|review|merge/i],
  [3, /검증|verif|check|test|가드|guard/i],
  [2, /수정|fix|patch|worktree|dev|구현/i],
  [1, /조사|investig|todo|plan|escalat|오류|error|err|fail|원인/i],
];
export function traceStageOfTask(task) {
  if (!task) return 0;
  const s = `${task.state || ''}`;
  for (const [stage, re] of STAGE_RULES) if (re.test(s)) return stage;
  return 0;
}

export function traceStepStates(running) {
  const r = Math.max(0, Math.min(TRACE_STEPS.length, Number(running) || 0));
  return TRACE_STEPS.map((_, i) => (i < r ? 'done' : i === r ? 'run' : 'wait'));
}

// 선 상태: 둘 다 완료 = done, 실행 중 카드로 들어가는 선 = run, 나머지 = wait
export function traceEdgeState(i, running) {
  if (i + 1 < running) return 'done';
  if (i + 1 === running) return 'run';
  return 'wait';
}

const LOSS_BY_STAGE = [
  '신호가 흩어져 같은 오류를 여러 번 신고·재작업',
  '원인 미확인 상태로 임시 조치만 반복',
  '수정 지연으로 현장 우회 작업이 계속됨',
  '검증 전 반영 시 다른 화면 회귀 위험',
  '결재 대기로 완성된 수정이 현장에 나가지 못함',
  '반영 확인 전까지 직원 화면에 오류가 남음',
  '해결 완료 — 재발 여부만 확인',
];
const DONE_BY_STAGE = [
  '오류 신호가 원장 한 줄로 등록되고 담당이 정해짐',
  '원인 1줄과 근거가 남고 재발 학습 카드가 생김',
  '격리 작업 공간에서 담당 파일만 고쳐 PR 이 올라감',
  'test:pm · 회귀 가드 전수 PASS',
  '사장님 결재 후 PR 머지 완료',
  '현장 화면 재확인 · 같은 오류 0건',
  '같은 오류 재발 0건 유지',
];
const EFFECT_BY_STAGE = [
  '같은 오류 중복 신고 제거 · 대응 시작 시각 단축',
  '임시 조치 대신 원인 제거 · 재발 방지',
  '운영 화면 무중단 수정',
  '다른 화면 회귀 사고 사전 차단',
  '사장님은 목적·결과만 보고 결재',
  '직원 재작업·전산 불일치 해소',
  '재발 없는 상태 유지',
];

export const PM_GLOBAL_PURPOSE = {
  scope: 'global',
  heading: 'PM 진행·오류 관제 전체',
  why: '현장 오류를 사장님이 직접 쫓지 않아도, 포착부터 운영 반영까지 한 화면에서 끝까지 닫는다',
  loss: '오류 방치로 생기는 직원 재작업 · 전산 불일치 · 결재 지연',
  done: '열린 오류 0건 · 사장님 확인 대기 0건 · 모든 수정은 검증 후 반영',
  agent: 'PM 에이전트 · Hermes 조사관 · 검증 담당',
  effect: '사장님은 결재만 · 오류는 원인까지 닫힘',
};

const txt = (v) => (typeof v === 'string' ? v.trim() : '');

// 선택 과제의 목적. 피드가 purpose/why/loss/done/effect 를 주면 그대로, 없으면 상태·메시지·조치로 만든다.
export function taskPurpose(task) {
  if (!task) return PM_GLOBAL_PURPOSE;
  const stage = traceStageOfTask(task);
  const msg = txt(task.msg);
  const decision = txt(task.decision);
  const days = Number(task.days);
  const why = txt(task.purpose) || txt(task.why) || (msg ? `「${msg}」 문제를 원인부터 고쳐 같은 오류가 다시 나지 않게 한다` : `${task.key || '이 과제'}를 원인부터 닫아 같은 오류가 다시 나지 않게 한다`);
  const lossBase = txt(task.loss) || LOSS_BY_STAGE[stage];
  const loss = Number.isFinite(days) && days > 0 ? `${days}일째 열려 있음 · ${lossBase}` : lossBase;
  const done = txt(task.done) || (decision ? `${decision} → 검증 PASS 후 운영 반영` : DONE_BY_STAGE[stage]);
  return {
    scope: 'task',
    heading: `선택 과제 · ${task.key || '작업'}`,
    why,
    loss,
    done,
    agent: txt(task.owner) || txt(task.agent) || '배정 전',
    effect: txt(task.effect) || EFFECT_BY_STAGE[stage],
    stage,
  };
}

// 전체 보기: 사장님 확인이 먼저 필요한 순서(승인 → 3일째 → 조사 → 검증 → 기타)의 첫 과제가 지금 실행 중인 단계.
export function overallRunning(tasks) {
  const open = (Array.isArray(tasks) ? tasks : []).filter((t) => traceStageOfTask(t) < 6);
  if (!open.length) return { running: TRACE_STEPS.length, counts: TRACE_STEPS.map(() => 0) };
  const counts = TRACE_STEPS.map(() => 0);
  for (const t of open) counts[Math.min(5, traceStageOfTask(t))] += 1;
  const order = [4, 3, 1, 2, 5, 0];
  const running = order.find((i) => counts[i] > 0);
  return { running: running ?? 0, counts };
}

export function PmPurposeBanner({ task, tasks = [], unresolvedCount = 0, onClear }) {
  const p = taskPurpose(task);
  const openCount = (Array.isArray(tasks) ? tasks : []).filter((t) => traceStageOfTask(t) < 6).length;
  return (
    <section className="pmpb" data-testid="pm-purpose-banner" data-scope={p.scope} aria-label="핵심 목적">
      <div className="pmpb-k">
        <span className="pmpb-tag">핵심 목적 · PURPOSE</span>
        <span className="pmpb-heading">{p.heading}</span>
        {p.scope === 'global' ? (
          <span className="pmpb-meta tnum">열린 과제 {openCount}건 · 사장님 확인 대기 {unresolvedCount}건</span>
        ) : (
          <span className="pmpb-meta tnum">현재 {TRACE_STEPS[Math.min(5, p.stage)].no} {TRACE_STEPS[Math.min(5, p.stage)].title}{p.stage >= 6 ? ' · 전 단계 완료' : ''}</span>
        )}
        {p.scope === 'task' && onClear && <Button size="sm" className="pmpb-clear" onClick={onClear}>전체 목적 보기</Button>}
      </div>
      <p className="pmpb-why" data-testid="pm-purpose-why"><span className="pmpb-lab">왜 · WHY</span>{p.why}</p>
      <dl className="pmpb-grid">
        <div className="pmpb-cell loss"><dt>해결 대상 손실 · 병목</dt><dd data-testid="pm-purpose-loss">{p.loss}</dd></div>
        <div className="pmpb-cell done"><dt>완료 기준 · DONE</dt><dd data-testid="pm-purpose-done">{p.done}</dd></div>
        <div className="pmpb-cell"><dt>담당 에이전트</dt><dd data-testid="pm-purpose-agent">{p.agent}</dd></div>
        <div className="pmpb-cell"><dt>기대 효과</dt><dd data-testid="pm-purpose-effect">{p.effect}</dd></div>
      </dl>
    </section>
  );
}

const r1 = (n) => Math.round(n * 10) / 10;

// 직교 배선: 같은 줄이면 오른쪽 가운데 → 왼쪽 가운데, 줄이 바뀌면 아래 → 레인 → 다음 카드 위(둥근 모서리).
function orthoPath(a, b, bus) {
  const sameRow = Math.abs(a.top - b.top) < 6 && b.left >= a.right - 1;
  if (sameRow) {
    const y = r1(a.top + Math.min(a.height, b.height) / 2);
    return { d: `M${r1(a.right)},${y} L${r1(b.left)},${y}`, lane: null, clear: true };
  }
  const stacked = Math.abs(b.left - a.left) < 6;
  const sx = r1(stacked ? a.left + 22 : a.left + a.width / 2);
  const tx = r1(stacked ? b.left + 22 : b.left + b.width / 2);
  const gap = b.top - a.bottom;
  let laneY = a.bottom + Math.max(8, Math.min(16, gap / 3));
  if (bus && laneY + 4 >= bus.top && laneY - 4 <= bus.bottom) laneY = Math.max(a.bottom + 4, bus.top - 10);
  laneY = r1(laneY);
  const hitsBus = (x) => bus && x >= bus.left - 4 && x <= bus.right + 4 && bus.bottom > a.bottom && bus.top < b.top;
  const laneHits = bus && laneY >= bus.top - 2 && laneY <= bus.bottom + 2 && Math.max(sx, tx) >= bus.left && Math.min(sx, tx) <= bus.right;
  const clear = !laneHits && !hitsBus(sx) && !hitsBus(tx);
  if (Math.abs(sx - tx) < 1) return { d: `M${sx},${r1(a.bottom)} L${tx},${r1(b.top)}`, lane: null, clear };
  const rad = Math.max(0, Math.min(10, (laneY - a.bottom) - 1, Math.abs(sx - tx) / 2));
  const dir = tx < sx ? -1 : 1;
  const d = [
    `M${sx},${r1(a.bottom)}`,
    `L${sx},${r1(laneY - rad)}`,
    `Q${sx},${laneY} ${r1(sx + dir * rad)},${laneY}`,
    `L${r1(tx - dir * rad)},${laneY}`,
    `Q${tx},${laneY} ${tx},${r1(laneY + rad)}`,
    `L${tx},${r1(b.top)}`,
  ].join(' ');
  return { d, lane: laneY, clear };
}

export default function PmPurposeTraceBoard({ tasks = [], task = null, reduced = false }) {
  const hostRef = useRef(null);
  const [auto, setAuto] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [focusStep, setFocusStep] = useState(null);
  const [geo, setGeo] = useState({ w: 0, h: 0, edges: [], busClear: true });
  const live = task ? { running: traceStageOfTask(task), counts: null } : overallRunning(tasks);
  const running = cursor == null ? live.running : cursor;
  const states = traceStepStates(running);
  const taskKey = task ? `${task.key || ''}|${task.state || ''}` : '';

  // 과제가 바뀌면 재생 위치를 실시간 상태로 되돌린다.
  useEffect(() => { setCursor(null); setAuto(false); setFocusStep(null); }, [taskKey]);

  // AUTO 1x: 2,600ms 마다 한 단계씩 진행(완료까지 간 뒤 처음부터).
  useEffect(() => {
    if (!auto) return undefined;
    const t = setInterval(() => setCursor((c) => ((c == null ? -1 : c) + 1) % (TRACE_STEPS.length + 1)), TRACE_TICK_MS);
    return () => clearInterval(t);
  }, [auto]);

  useIsoLayout(() => {
    const host = hostRef.current; if (!host) return undefined;
    const calc = () => {
      const hb = host.getBoundingClientRect();
      const rel = (el) => { const r = el.getBoundingClientRect(); return { left: r.left - hb.left, top: r.top - hb.top, right: r.right - hb.left, bottom: r.bottom - hb.top, width: r.width, height: r.height }; };
      const cards = TRACE_STEPS.map((_, i) => host.querySelector(`[data-trace-step="${i}"]`));
      if (cards.some((c) => !c)) return;
      const rects = cards.map(rel);
      const busEl = host.querySelector('[data-trace-bus]');
      const bus = busEl ? rel(busEl) : null;
      const edges = [];
      let busClear = true;
      for (let i = 0; i < rects.length - 1; i += 1) {
        const p = orthoPath(rects[i], rects[i + 1], bus);
        if (!p.clear) busClear = false;
        edges.push({ i, ...p });
      }
      setGeo({ w: r1(hb.width), h: r1(hb.height), edges, busClear });
    };
    calc();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(calc) : null;
    if (ro) ro.observe(host);
    window.addEventListener('resize', calc);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', calc); };
  }, [taskKey]);

  const pick = (i) => { setAuto(false); setCursor(i); setFocusStep(i); };
  const toggleAuto = () => { setFocusStep(null); if (!auto) setCursor(0); setAuto(!auto); };
  const shownStep = focusStep != null ? focusStep : Math.min(TRACE_STEPS.length - 1, running);
  const shown = TRACE_STEPS[shownStep];

  return (
    <section className="pmtr" data-testid="pm-live-trace-diagram" data-running={running} data-mode={cursor == null ? 'live' : 'replay'} aria-label="실시간 PM 파이프라인 트레이스 도면">
      <div className="pmtr-bar">
        <div className="pmtr-tabs" role="presentation">
          <span className="pmtr-tab on">실시간 PM 파이프라인 트레이스 도면</span>
          <span className="pmtr-sub">{task ? `선택 과제 ${task.key || '작업'} 기준` : '열린 과제 전체 기준'} · 초록 완료 · 파랑 실행 중 · 회색 대기</span>
        </div>
        <div className="pmtr-ctl">
          {cursor != null && <Button size="sm" variant="ghost" className="pmtr-live" onClick={() => { setAuto(false); setCursor(null); setFocusStep(null); }}>실시간 상태로</Button>}
          <ToggleChip on={auto} className="pmtr-auto" data-testid="pm-trace-auto" onClick={toggleAuto}>{auto ? 'AUTO 1x · 정지' : 'AUTO 1x · 재생'}</ToggleChip>
          <span className="pmtr-ms tnum">2,600ms</span>
        </div>
      </div>
      <div className="pmtr-canvas" ref={hostRef} data-bus-clear={geo.busClear ? 'true' : 'false'}>
        <svg className="pmtr-wires" width="100%" height="100%" viewBox={geo.w ? `0 0 ${geo.w} ${geo.h}` : undefined} aria-hidden="true">
          <defs>
            <pattern id="pmtr-grid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M20 0H0V20" fill="none" stroke="rgb(226, 232, 240)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect x="0" y="0" width="100%" height="100%" fill="url(#pmtr-grid)" />
          {geo.edges.map((e) => {
            const st = traceEdgeState(e.i, running);
            const id = `pmtr-edge-${e.i}`;
            return (
              <g key={`${id}:${e.d}`} className={`pmtr-edge-g e-${st}`} data-edge={e.i} data-edge-state={st}>
                <path id={id} d={e.d} className={`pmtr-edge e-${st}`} fill="none" />
                {st === 'done' && !reduced && (
                  <circle r="4" className="pmtr-packet">
                    <animateMotion dur="2.2s" repeatCount="indefinite" calcMode="linear"><mpath href={`#${id}`} /></animateMotion>
                  </circle>
                )}
                {st === 'run' && <circle r="4.5" className="pmtr-dot-run" cx={e.d.split(' ')[0].slice(1).split(',')[0]} cy={e.d.split(' ')[0].split(',')[1]} />}
              </g>
            );
          })}
        </svg>
        <div className="pmtr-grid">
          {TRACE_STEPS.map((s, i) => {
            const st = states[i];
            const n = live.counts ? live.counts[i] : 0;
            return (
              <SelectCard key={s.key} className={`pmtr-card pmtr-c${i} st-${st}`} on={focusStep === i} pressed={focusStep === i}
                data-trace-step={i} data-state={st} onClick={() => pick(i)}
                aria-label={`${s.no} ${s.title} · ${STATE_LABEL[st]} · 목적: ${s.purpose}`}>
                <span className="pmtr-head">
                  <span className="pmtr-surface">{s.surface}</span>
                  <span className={`pmtr-badge b-${st}`}>{STATE_LABEL[st]}</span>
                </span>
                <span className="pmtr-title"><span className="pmtr-no tnum">{s.no}</span> {s.title}</span>
                <span className="pmtr-purpose"><b>목적</b>{s.purpose}</span>
                <span className="pmtr-rule">{s.rule}</span>
                {n > 0 && <span className="pmtr-count tnum">열린 과제 {n}건</span>}
              </SelectCard>
            );
          })}
          <div className="pmtr-lane" aria-hidden="true">
            <span className="pmtr-bus" data-trace-bus="true" title="03 격리 수정본을 04 회귀 가드로 넘기는 인계 구간 · 변경 파일만 검증">{TRACE_BUS_LABEL}</span>
          </div>
        </div>
      </div>
      <div className="pmtr-detail" data-testid="pm-trace-step-detail" role="status">
        <span className={`pmtr-badge b-${states[shownStep]}`}>{STATE_LABEL[states[shownStep]]}</span>
        <b className="tnum">{shown.no} {shown.title}</b>
        <span><span className="pmtr-dl">단계 목적</span>{shown.purpose}</span>
        <span><span className="pmtr-dl">검증 규칙</span><code className="pmtr-code">{shown.rule}</code></span>
        {running >= TRACE_STEPS.length && <span className="pmtr-alldone">전 단계 완료</span>}
      </div>
    </section>
  );
}

const FONT = "Pretendard, 'Pretendard Variable', 'Malgun Gothic', '맑은 고딕', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";
const MONO = "'Cascadia Mono', Consolas, 'D2Coding', Pretendard, 'Malgun Gothic', '맑은 고딕', sans-serif";

export const PM_TRACE_CSS = `
.pm .pmpb, .pm .pmtr { font-family: ${FONT}; color: rgb(15, 23, 42); }
.pm .pmpb { margin: 0 0 12px; padding: 14px 16px 12px; background: rgb(255, 255, 255); border: 1px solid rgb(203, 213, 225); border-left: 5px solid rgb(37, 99, 235); border-radius: 8px; }
.pm .pmpb[data-scope="task"] { border-left-color: rgb(5, 150, 105); background: rgb(248, 252, 250); }
.pm .pmpb-k { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; margin-bottom: 6px; }
.pm .pmpb-tag { display: inline-flex; align-items: center; padding: 3px 9px; border-radius: 4px; background: rgb(37, 99, 235); color: rgb(255, 255, 255); font-size: 12.5px; font-weight: 800; letter-spacing: .02em; }
.pm .pmpb[data-scope="task"] .pmpb-tag { background: rgb(5, 150, 105); }
.pm .pmpb-heading { font-size: 14px; font-weight: 700; color: rgb(30, 41, 59); }
.pm .pmpb-meta { font-size: 12.5px; color: rgb(71, 85, 105); }
.pm .pmpb-clear { margin-left: auto; }
.pm .pmpb-why { margin: 0 0 10px; font-size: 17px; font-weight: 800; line-height: 1.45; letter-spacing: -0.01em; color: rgb(15, 23, 42); word-break: keep-all; }
.pm .pmpb-lab { display: inline-block; margin-right: 8px; font-size: 12px; font-weight: 800; color: rgb(37, 99, 235); vertical-align: 2px; }
.pm .pmpb[data-scope="task"] .pmpb-lab { color: rgb(4, 120, 87); }
.pm .pmpb-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0; margin: 0; border-top: 1px solid rgb(226, 232, 240); }
.pm .pmpb-cell { padding: 8px 12px 2px 0; min-width: 0; }
.pm .pmpb-cell + .pmpb-cell { padding-left: 12px; border-left: 1px solid rgb(226, 232, 240); }
.pm .pmpb-cell dt { font-size: 12px; font-weight: 700; color: rgb(100, 116, 139); margin-bottom: 3px; }
.pm .pmpb-cell dd { margin: 0; font-size: 15px; font-weight: 700; line-height: 1.45; color: rgb(15, 23, 42); word-break: keep-all; }
.pm .pmpb-cell.loss dd { color: rgb(185, 28, 28); }
.pm .pmpb-cell.done dd { color: rgb(4, 120, 87); }

.pm .pmtr { margin: 0 0 12px; background: rgb(255, 255, 255); border: 1px solid rgb(226, 232, 240); border-radius: 8px; overflow: hidden; }
.pm .pmtr-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 0 12px; border-bottom: 1px solid rgb(226, 232, 240); }
.pm .pmtr-tabs { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; min-width: 0; }
.pm .pmtr-tab { display: inline-block; padding: 11px 2px 9px; font-size: 14.5px; font-weight: 800; color: rgb(15, 23, 42); border-bottom: 2px solid rgb(37, 99, 235); }
.pm .pmtr-sub { font-size: 12.5px; color: rgb(100, 116, 139); }
.pm .pmtr-ctl { display: flex; align-items: center; gap: 6px; margin-left: auto; padding: 6px 0; }
.pm .pmtr .pmtr-auto { margin: 0; font-weight: 700; border: 1px solid rgb(5, 150, 105); background: rgb(236, 253, 245); color: rgb(4, 120, 87); font-family: ${MONO}; }
.pm .pmtr .pmtr-auto.on { background: rgb(5, 150, 105); color: rgb(255, 255, 255); }
.pm .pmtr-ms { font-size: 12.5px; color: rgb(71, 85, 105); font-family: ${MONO}; }
.pm .pmtr-canvas { position: relative; padding: 18px 20px; background: rgb(255, 255, 255); }
.pm .pmtr-wires { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 0; overflow: visible; }
.pm .pmtr-edge { stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
.pm .pmtr-edge.e-done { stroke: rgb(5, 150, 105); }
.pm .pmtr-edge.e-run { stroke: rgb(37, 99, 235); stroke-dasharray: 7 6; animation: pmtr-flow .9s linear infinite; }
.pm .pmtr-edge.e-wait { stroke: rgb(203, 213, 225); stroke-dasharray: 3 5; }
.pm .pmtr-packet { fill: rgb(5, 150, 105); stroke: rgb(255, 255, 255); stroke-width: 1.5; }
.pm .pmtr-dot-run { fill: rgb(37, 99, 235); stroke: rgb(255, 255, 255); stroke-width: 1.5; }
@keyframes pmtr-flow { to { stroke-dashoffset: -26; } }
.pm .pmtr-grid { position: relative; z-index: 1; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); grid-template-rows: auto 64px auto; column-gap: 56px; row-gap: 0; }
.pm .pmtr-c0 { grid-row: 1; grid-column: 1; } .pm .pmtr-c1 { grid-row: 1; grid-column: 2; } .pm .pmtr-c2 { grid-row: 1; grid-column: 3; }
.pm .pmtr-c3 { grid-row: 3; grid-column: 1; } .pm .pmtr-c4 { grid-row: 3; grid-column: 2; } .pm .pmtr-c5 { grid-row: 3; grid-column: 3; }
.pm .pmtr-lane { grid-row: 2; grid-column: 2; display: flex; align-items: flex-end; justify-content: center; padding-bottom: 8px; min-width: 0; }
.pm .pmtr-bus { display: inline-block; max-width: 100%; padding: 4px 10px; background: rgb(255, 255, 255); border: 1px solid rgb(203, 213, 225); border-radius: 4px; font-size: 12.5px; font-weight: 600; color: rgb(51, 65, 85); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: ${MONO}; }
.pm .pmtr .pmtr-card { display: grid; align-content: start; gap: 7px; width: 100%; min-width: 0; padding: 10px 12px 11px; text-align: left; background: rgb(255, 255, 255); border: 1.5px solid rgb(203, 213, 225); border-left: 4px solid rgb(203, 213, 225); border-radius: 6px; font-family: ${FONT}; color: rgb(15, 23, 42); }
.pm .pmtr .pmtr-card:hover { background: rgb(248, 250, 252); }
.pm .pmtr .pmtr-card.st-done { border-color: rgb(5, 150, 105); border-left-color: rgb(5, 150, 105); }
.pm .pmtr .pmtr-card.st-run { border-color: rgb(37, 99, 235); border-left-color: rgb(37, 99, 235); background: rgb(239, 246, 255); border-width: 2px 2px 2px 4px; }
.pm .pmtr .pmtr-card.st-wait { border-color: rgb(203, 213, 225); border-left-color: rgb(203, 213, 225); }
.pm .pmtr .pmtr-card.on { outline: 2px solid rgb(245, 158, 11); outline-offset: 2px; }
.pm .pmtr-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; }
.pm .pmtr-surface { font-size: 12px; color: rgb(71, 85, 105); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pm .pmtr-badge { flex: 0 0 auto; display: inline-flex; align-items: center; padding: 2px 10px; border-radius: 4px; border: 1px solid; font-size: 12px; font-weight: 800; white-space: nowrap; }
.pm .pmtr-badge.b-done { color: rgb(4, 120, 87); background: rgb(236, 253, 245); border-color: rgb(5, 150, 105); }
.pm .pmtr-badge.b-run { color: rgb(29, 78, 216); background: rgb(219, 234, 254); border-color: rgb(37, 99, 235); }
.pm .pmtr-badge.b-wait { color: rgb(100, 116, 139); background: rgb(248, 250, 252); border-color: rgb(203, 213, 225); }
.pm .pmtr-title { display: block; font-size: 14.5px; font-weight: 800; line-height: 1.35; letter-spacing: -0.01em; word-break: keep-all; }
.pm .pmtr-no { font-family: ${MONO}; }
.pm .pmtr-purpose { display: block; font-size: 13px; line-height: 1.45; color: rgb(30, 41, 59); word-break: keep-all; }
.pm .pmtr-purpose b { display: inline-block; margin-right: 6px; padding: 0 5px; border-radius: 3px; background: rgb(241, 245, 249); color: rgb(51, 65, 85); font-size: 12px; }
.pm .pmtr .st-run .pmtr-purpose b { background: rgb(219, 234, 254); color: rgb(29, 78, 216); }
.pm .pmtr .st-done .pmtr-purpose b { background: rgb(236, 253, 245); color: rgb(4, 120, 87); }
.pm .pmtr-rule { display: block; padding: 6px 9px; border: 1px solid rgb(226, 232, 240); border-radius: 4px; background: rgb(248, 250, 252); font-family: ${MONO}; font-size: 13px; color: rgb(51, 65, 85); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pm .pmtr .st-run .pmtr-rule { color: rgb(29, 78, 216); background: rgb(255, 255, 255); }
.pm .pmtr-count { font-size: 12.5px; font-weight: 700; color: rgb(29, 78, 216); }
.pm .pmtr-detail { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; padding: 9px 14px; border-top: 1px solid rgb(226, 232, 240); background: rgb(248, 250, 252); font-size: 13.5px; line-height: 1.5; }
.pm .pmtr-detail b { font-size: 14.5px; }
.pm .pmtr-dl { margin-right: 6px; font-size: 12px; font-weight: 700; color: rgb(100, 116, 139); }
.pm .pmtr-code { padding: 1px 7px; border: 1px solid rgb(226, 232, 240); border-radius: 4px; background: rgb(255, 255, 255); font-family: ${MONO}; font-size: 13px; }
.pm .pmtr-alldone { font-weight: 800; color: rgb(4, 120, 87); }
@media (prefers-reduced-motion: reduce) {
  .pm .pmtr-edge.e-run { animation: none; }
}
@media (max-width: 980px) {
  .pm .pmpb-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .pm .pmpb-cell:nth-child(3) { padding-left: 0; border-left: 0; }
  .pm .pmtr-grid { column-gap: 36px; }
}
@media (max-width: 760px) {
  .pm .pmpb-why { font-size: 16px; }
  .pm .pmpb-grid { grid-template-columns: minmax(0, 1fr); }
  .pm .pmpb-cell + .pmpb-cell { padding-left: 0; border-left: 0; border-top: 1px solid rgb(226, 232, 240); }
  .pm .pmtr-canvas { padding: 14px 12px; }
  .pm .pmtr-grid { grid-template-columns: minmax(0, 1fr); grid-template-rows: none; row-gap: 26px; }
  .pm .pmtr-c0 { grid-row: 1; grid-column: 1; } .pm .pmtr-c1 { grid-row: 2; grid-column: 1; } .pm .pmtr-c2 { grid-row: 3; grid-column: 1; }
  .pm .pmtr-lane { grid-row: 4; grid-column: 1; justify-content: flex-start; padding: 0 0 0 48px; margin: -10px 0; }
  .pm .pmtr-c3 { grid-row: 5; grid-column: 1; } .pm .pmtr-c4 { grid-row: 6; grid-column: 1; } .pm .pmtr-c5 { grid-row: 7; grid-column: 1; }
  .pm .pmtr-bus { white-space: normal; }
}
`;
