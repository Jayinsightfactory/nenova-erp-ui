// 좌우 실시간 연결선: 왼쪽 원문 강조 상자 오른쪽 끝 ↔ 오른쪽 활성 입력칸 왼쪽 끝.
// 화면 고정 SVG(pointer-events: none). 글자는 SVG에 그리지 않아 선과 글자가 겹치지 않는다.
// 스크롤·창 크기·확대 변경은 scroll/resize/ResizeObserver → requestAnimationFrame 한 번으로 따라간다.
import { useEffect, useRef, useState } from 'react';
import { connectorPath, CONNECTOR_COLORS } from '../../lib/visualInboundWorkbench.js';
import styles from '../../styles/VisualInboundVerifyWorkbench.module.css';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export default function VisualInboundLeaderLine({ rootRef, fromRef, fromPaneRef, toPaneRef, toKey, tone = 'checking', revision = 0 }) {
  const [geometry, setGeometry] = useState(null);
  const frame = useRef(0);
  const last = useRef('');

  useEffect(() => {
    const root = rootRef?.current;
    if (!root) return undefined;
    const measure = () => {
      frame.current = 0;
      const from = fromRef?.current;
      const to = toKey ? root.querySelector(`[data-field-key="${CSS.escape(toKey)}"]`) : null;
      const leftPane = fromPaneRef?.current;
      const rightPane = toPaneRef?.current;
      if (!from || !to || !leftPane || !rightPane || !from.isConnected) {
        if (last.current !== '') { last.current = ''; setGeometry(null); }
        return;
      }
      const a = from.getBoundingClientRect();
      const b = to.getBoundingClientRect();
      const lp = leftPane.getBoundingClientRect();
      const rp = rightPane.getBoundingClientRect();
      const fromVisible = a.bottom > lp.top && a.top < lp.bottom && a.right > lp.left && a.left < lp.right;
      const toVisible = b.bottom > rp.top && b.top < rp.bottom;
      const start = { x: clamp(a.right, lp.left + 4, lp.right - 2), y: clamp(a.top + a.height / 2, lp.top + 6, lp.bottom - 6) };
      const end = { x: clamp(b.left, rp.left + 2, rp.right), y: clamp(b.top + b.height / 2, rp.top + 6, rp.bottom - 6) };
      const next = { start, end, partial: !fromVisible || !toVisible };
      const key = `${Math.round(start.x)},${Math.round(start.y)},${Math.round(end.x)},${Math.round(end.y)},${next.partial}`;
      if (key !== last.current) { last.current = key; setGeometry(next); }
    };
    const schedule = () => { if (!frame.current) frame.current = requestAnimationFrame(measure); };
    schedule();
    window.addEventListener('resize', schedule);
    root.addEventListener('scroll', schedule, true);
    let observer;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(schedule);
      for (const el of [fromPaneRef?.current, toPaneRef?.current, fromRef?.current].filter(Boolean)) observer.observe(el);
    }
    const settle = setTimeout(schedule, 450);
    return () => {
      window.removeEventListener('resize', schedule);
      root.removeEventListener('scroll', schedule, true);
      observer?.disconnect();
      clearTimeout(settle);
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [rootRef, fromRef, fromPaneRef, toPaneRef, toKey, revision]);

  if (!geometry) return null;
  const color = CONNECTOR_COLORS[tone] || CONNECTOR_COLORS.checking;
  return (
    <svg className={styles.leaderLayer} aria-hidden="true" focusable="false" data-testid="leader-line" data-tone={tone}>
      <g data-layer="wires">
        <path d={connectorPath(geometry.start, geometry.end)} fill="none" stroke="#ffffff" strokeWidth="6" strokeLinecap="round" opacity="0.9" />
        <path d={connectorPath(geometry.start, geometry.end)} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round"
          strokeDasharray={geometry.partial ? '6 5' : undefined} className={styles.leaderPath} />
        <circle cx={geometry.start.x} cy={geometry.start.y} r="5" fill={color} stroke="#ffffff" strokeWidth="2" />
        <circle cx={geometry.end.x} cy={geometry.end.y} r="5" fill={color} stroke="#ffffff" strokeWidth="2" />
      </g>
    </svg>
  );
}
