// components/work/PurposeFlowTrace.js
// 업무 목적 우선(Purpose-First) 실시간 트레이스 도면 — 부서 업무(/work/manuals)와 수입 원스톱(/import/pipeline) 공용.
// 최상단 「업무 핵심 목적 · PURPOSE」 콜아웃 → 모눈 캔버스 위 단계 카드(01 → 02 → …) + 직교 S-커브 배선.
//   완료 = 초록 실선 + 패킷 점 이동 / 실행 중 = 파란 점선이 흐름 / 대기 = 회색 점선.
//   배선은 카드 가장자리·독립 레인에만 놓이고, 레인 라벨은 선 위쪽 칸에 따로 놓여 선과 글자가 겹치지 않는다.
//   모션은 [AUTO 1x] 단추로 멈출 수 있고 prefers-reduced-motion 을 따른다. 단계 카드를 누르면 onSelectStep 으로 부모와 연동한다.
import { useEffect, useMemo, useRef, useState } from 'react';

export const TRACE_COLORS = Object.freeze({ done: '#059669', running: '#2563eb', wait: '#cbd5e1' });
export const TRACE_STATUS_LABEL = Object.freeze({ done: '완료', running: '실행 중', wait: '대기' });
export const TRACE_LOOP_MS = 2600;

const CARD_H = 148;
const PAD = 20;
const H_GAP = 52;
const LANE_H = 84; // 카드 줄 사이 간격(리턴 배선 + 라벨 레인)
const LANE_H_NARROW = 48; // 1열일 때는 곧게 내려가므로 짧게
const LABEL_TOP = 6; // 레인 맨 위에서 라벨 상자까지
const LABEL_H = 26;
const WIRE_AT = 0.68; // 레인 높이 중 배선이 지나는 위치(라벨 상자 아래쪽)
const CORNER = 14;

// 카드 배치·배선 좌표를 순수 계산 — 테스트가 라벨 · 배선 · 카드 겹침을 직접 검사한다.
export function layoutTrace(count, width) {
  const n = Math.max(0, Math.floor(count));
  const w = Math.max(280, Math.floor(width) || 0);
  const maxCols = w >= 1000 ? 4 : w >= 720 ? 3 : w >= 480 ? 2 : 1;
  const rows = Math.max(1, Math.ceil(n / maxCols));
  const cols = Math.max(1, Math.ceil(n / rows));
  const gap = cols === 1 ? 0 : H_GAP;
  const cardW = (w - PAD * 2 - gap * (cols - 1)) / cols;
  const lane = cols === 1 ? LANE_H_NARROW : LANE_H;
  const height = PAD * 2 + rows * CARD_H + (rows - 1) * lane;
  const cards = Array.from({ length: n }, (_, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    return { x: PAD + c * (cardW + gap), y: PAD + r * (CARD_H + lane), w: cardW, h: CARD_H, row: r, col: c };
  });
  const wires = [];
  for (let i = 0; i < n - 1; i += 1) {
    const a = cards[i];
    const b = cards[i + 1];
    if (a.row === b.row) {
      const y = a.y + CARD_H / 2;
      wires.push({ from: i, to: i + 1, kind: 'row', d: `M ${a.x + a.w} ${y} H ${b.x}`, start: [a.x + a.w, y], end: [b.x, y], label: null });
    } else if (cols === 1) {
      const x = a.x + a.w / 2;
      wires.push({ from: i, to: i + 1, kind: 'down', d: `M ${x} ${a.y + CARD_H} V ${b.y}`, start: [x, a.y + CARD_H], end: [x, b.y], label: null });
    } else {
      const xa = a.x + a.w / 2;
      const xb = b.x + b.w / 2;
      const y0 = a.y + CARD_H;
      const laneTop = y0;
      const ly = laneTop + lane * WIRE_AT;
      const dir = xb < xa ? -1 : 1;
      const r = CORNER;
      const d = `M ${xa} ${y0} V ${ly - r} Q ${xa} ${ly} ${xa + dir * r} ${ly} H ${xb - dir * r} Q ${xb} ${ly} ${xb} ${ly + r} V ${b.y}`;
      const left = Math.min(xa, xb) + r + 6;
      const right = Math.max(xa, xb) - r - 6;
      wires.push({
        from: i, to: i + 1, kind: 'return', d, start: [xa, y0], end: [xb, b.y], wireY: ly,
        label: { x: (xa + xb) / 2, top: laneTop + LABEL_TOP, h: LABEL_H, maxW: Math.max(0, right - left) },
      });
    }
  }
  return { cols, rows, cardW, height, lane, cards, wires, width: w };
}

export function resolveStepStatuses(steps, activeId) {
  const list = Array.isArray(steps) ? steps : [];
  const idx = list.findIndex((s) => s.id === activeId);
  const active = idx < 0 ? 0 : idx;
  return list.map((s, i) => {
    if (s.status === 'done' || s.status === 'running' || s.status === 'wait') return s.status;
    if (i < active) return 'done';
    if (i === active) return 'running';
    return 'wait';
  });
}

const pad2 = (n) => String(n).padStart(2, '0');

export default function PurposeFlowTrace({
  testId = 'purpose-flow-trace',
  title = '실시간 업무 트레이스 도면',
  purpose,
  steps = [],
  activeId,
  onSelectStep,
  busLabel = '다음 줄 단계로 이어짐',
  initialWidth = 1000, // 서버 렌더·측정 전 폭(브라우저에서는 곧바로 실제 폭으로 바뀜)
}) {
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(initialWidth);
  const [playing, setPlaying] = useState(true);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const measure = () => setWidth(Math.round(el.getBoundingClientRect().width) || 1000);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => { setReduced(mq.matches); if (mq.matches) setPlaying(false); };
    apply();
    mq.addEventListener?.('change', apply);
    return () => mq.removeEventListener?.('change', apply);
  }, []);

  const geo = useMemo(() => layoutTrace(steps.length, width), [steps.length, width]);
  const statuses = useMemo(() => resolveStepStatuses(steps, activeId), [steps, activeId]);
  const motion = playing && !reduced;

  return (
    <section className="pft" data-testid={testId} data-play={motion ? '1' : '0'} aria-label={title}>
      <style dangerouslySetInnerHTML={{ __html: css }} />{/* 따옴표가 &quot; 로 바뀌면 글꼴 지정이 깨지고 hydration 불일치가 나므로 원문 그대로 넣는다 */}
      {purpose && (
        <div className="pft-purpose" data-testid={`${testId}-purpose`}>
          <span className="pft-purpose-tag">{purpose.tag || '업무 핵심 목적 · PURPOSE'}</span>
          <p className="pft-purpose-head">{purpose.headline}</p>
          {(purpose.prevents || purpose.outcome) && (
            <dl className="pft-purpose-grid">
              {purpose.prevents && (<div><dt>막는 문제</dt><dd>{purpose.prevents}</dd></div>)}
              {purpose.outcome && (<div><dt>완료 결과물</dt><dd>{purpose.outcome}</dd></div>)}
            </dl>
          )}
        </div>
      )}

      <div className="pft-bar">
        <span className="pft-tab">{title}</span>
        <span className="pft-bar-right">
          <button
            type="button"
            className={`pft-auto${motion ? ' on' : ''}`}
            aria-pressed={motion}
            disabled={reduced}
            title={reduced ? '시스템 설정(동작 줄이기)에 따라 모션이 꺼져 있습니다' : undefined}
            onClick={() => setPlaying((v) => !v)}
            data-testid={`${testId}-auto`}
          >
            AUTO 1x
            <span className="pft-auto-state">{motion ? '모션 재생' : '정지'}</span>
          </button>
          <span className="pft-ms">{TRACE_LOOP_MS.toLocaleString('ko-KR')}ms</span>
        </span>
      </div>

      <div className="pft-canvas" ref={wrapRef} style={{ height: geo.height }}>
        <svg className="pft-svg" width={geo.width} height={geo.height} viewBox={`0 0 ${geo.width} ${geo.height}`} aria-hidden="true" focusable="false">
          <defs>
            <pattern id={`${testId}-grid`} width="24" height="24" patternUnits="userSpaceOnUse">
              <path d="M 24 0 H 0 V 24" fill="none" stroke="#e8eef6" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width={geo.width} height={geo.height} fill={`url(#${testId}-grid)`} />
          {geo.wires.map((wire) => {
            const st = statuses[wire.to];
            const color = TRACE_COLORS[st];
            return (
              <g key={`${wire.from}-${wire.to}`} data-wire={st} data-testid={`${testId}-wire-${wire.from + 1}-${wire.to + 1}`}>
                <path className={`pft-wire ${st}`} d={wire.d} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
                <circle cx={wire.start[0]} cy={wire.start[1]} r="4" fill={color} />
                <circle cx={wire.end[0]} cy={wire.end[1]} r="4" fill={color} />
                {st === 'done' && motion && (
                  <circle r="4.5" fill={TRACE_COLORS.done} stroke="#ffffff" strokeWidth="1.5">
                    <animateMotion dur={`${TRACE_LOOP_MS}ms`} repeatCount="indefinite" path={wire.d} />
                  </circle>
                )}
              </g>
            );
          })}
        </svg>

        {geo.wires.filter((w) => w.label).map((wire) => (
          <span
            key={`bus-${wire.from}`}
            className="pft-bus"
            data-testid={`${testId}-bus-${wire.from + 1}`}
            style={{ left: wire.label.x, top: wire.label.top, height: wire.label.h, maxWidth: wire.label.maxW }}
          >
            {`${pad2(wire.from + 1)} → ${pad2(wire.to + 1)} · ${busLabel}`}
          </span>
        ))}

        {steps.map((step, i) => {
          const g = geo.cards[i];
          const st = statuses[i];
          return (
            <button
              key={step.id}
              type="button"
              className={`pft-card ${st}`}
              style={{ left: g.x, top: g.y, width: g.w, height: g.h }}
              data-testid={`${testId}-step-${step.id}`}
              data-status={st}
              aria-current={st === 'running' ? 'step' : undefined}
              aria-label={`${pad2(i + 1)}단계 ${step.title}, ${TRACE_STATUS_LABEL[st]}`}
              onClick={() => onSelectStep?.(step, i)}
            >
              <span className="pft-card-top">
                <span className="pft-surface">{step.surface}</span>
                <span className={`pft-badge ${st}`}>{TRACE_STATUS_LABEL[st]}</span>
              </span>
              <strong className="pft-title">{`${pad2(i + 1)} ${step.title}`}</strong>
              <span className="pft-goal" title={step.goal}>{step.goal}</span>
              <span className="pft-token" title={step.token}>{step.token}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

const css = `
.pft{font-family:Pretendard,"Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR","Segoe UI",sans-serif;font-variant-numeric:tabular-nums;color:#0f172a;margin:0 0 12px;line-height:1.45}
.pft *{box-sizing:border-box}
.pft-purpose{background:#ffffff;border:1px solid #cbd5e1;border-left:6px solid #2563eb;border-radius:10px;padding:14px 18px 14px;margin-bottom:10px}
.pft-purpose-tag{display:inline-block;font-size:12px;font-weight:800;letter-spacing:.04em;color:#1d4ed8;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:2px 9px}
.pft-purpose-head{margin:8px 0 0;font-size:17px;font-weight:800;line-height:1.5;letter-spacing:-.01em;color:#0f172a;word-break:keep-all}
.pft-purpose-grid{margin:10px 0 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:8px 22px}
.pft-purpose-grid dt{font-size:12px;font-weight:800;color:#475569;margin:0}
.pft-purpose-grid dd{margin:1px 0 0;font-size:15px;font-weight:600;line-height:1.5;color:#1e293b;word-break:keep-all}
.pft-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;background:#ffffff;border:1px solid #cbd5e1;border-bottom:0;border-radius:10px 10px 0 0;padding:0 12px 0 6px}
.pft-tab{display:inline-flex;align-items:center;min-height:40px;padding:0 14px;font-size:14px;font-weight:800;color:#1d4ed8;border-bottom:2px solid #2563eb}
.pft-bar-right{display:inline-flex;align-items:center;gap:10px}
.pft-auto{display:inline-flex;align-items:center;gap:8px;min-height:30px;padding:0 10px;font:inherit;font-size:12px;font-weight:800;border-radius:6px;border:1px solid #cbd5e1;background:#f8fafc;color:#475569;cursor:pointer}
.pft-auto.on{border-color:#6ee7b7;background:#ecfdf5;color:#047857}
.pft-auto:disabled{cursor:default;opacity:.7}
.pft-auto:focus-visible,.pft-card:focus-visible{outline:3px solid #2457c5;outline-offset:2px}
.pft-auto-state{font-weight:700;font-size:12px}
.pft-ms{font-size:12px;font-weight:700;color:#475569}
.pft-canvas{position:relative;width:100%;background:#ffffff;border:1px solid #cbd5e1;border-radius:0 0 10px 10px;overflow:hidden}
.pft-svg{position:absolute;left:0;top:0;pointer-events:none;z-index:0}
.pft-wire.running{stroke-dasharray:7 6;animation:pft-flow .9s linear infinite}
.pft-wire.wait{stroke-dasharray:4 6}
.pft[data-play="0"] .pft-wire.running{animation:none}
@keyframes pft-flow{to{stroke-dashoffset:-26}}
.pft-bus{position:absolute;z-index:1;transform:translateX(-50%);display:inline-flex;align-items:center;justify-content:center;padding:0 12px;font-size:12px;font-weight:700;color:#334155;background:#ffffff;border:1px solid #cbd5e1;border-radius:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pft-card{position:absolute;z-index:2;display:flex;flex-direction:column;align-items:stretch;gap:5px;padding:10px 12px 10px 16px;text-align:left;font:inherit;color:#0f172a;background:#ffffff;border:2px solid #cbd5e1;border-radius:8px;cursor:pointer;overflow:hidden;transition:box-shadow .15s ease,border-color .15s ease}
.pft-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:#cbd5e1}
.pft-card:hover{box-shadow:0 2px 8px rgba(15,23,42,.14)}
.pft-card.done{border-color:#059669}
.pft-card.done::before{background:#059669}
.pft-card.running{border-color:#2563eb;background:#eff6ff;box-shadow:0 0 0 3px rgba(37,99,235,.14)}
.pft-card.running::before{background:#2563eb}
.pft-card-top{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}
.pft-surface{font-size:12px;font-weight:700;color:#475569;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.pft-badge{flex:none;font-size:12px;font-weight:800;line-height:1;padding:5px 10px;border-radius:5px;border:1px solid #cbd5e1;background:#f1f5f9;color:#475569}
.pft-badge.done{border-color:#059669;background:#ecfdf5;color:#047857}
.pft-badge.running{border-color:#2563eb;background:#ffffff;color:#1d4ed8}
.pft-title{font-size:14.5px;font-weight:800;line-height:1.35;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pft-goal{font-size:12.5px;font-weight:600;line-height:1.4;color:#334155;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pft-token{margin-top:auto;display:block;padding:6px 9px;font-family:Consolas,"Malgun Gothic","Segoe UI",monospace;font-size:12px;font-weight:600;color:#334155;background:#f8fafc;border:1px solid #e2e8f0;border-radius:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pft-card.running .pft-token{color:#1e40af;background:#ffffff;border-color:#bfdbfe}
@media (max-width:560px){.pft-purpose{padding:12px 14px}.pft-purpose-head{font-size:16px}.pft-purpose-grid dd{font-size:15px}}
@media (prefers-reduced-motion:reduce){.pft-wire.running{animation:none}.pft-card{transition:none}}
`;
