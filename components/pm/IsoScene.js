// components/pm/IsoScene.js
// /pm 사무실 "2.5D 아이소메트릭 장면" — Gemini 시안(theme-mockups A~J)의 배치를 SVG 로 직접 그린다(시안 그림을 배경으로 깔지 않음).
//   가운데 대각선 복도 = 업무 9단계 스테이션(발주→이익), 양옆 = 부서 구역 책상 + 치비 캐릭터, 위 구석 = AI 연구실 로봇.
//   직원 책상 → 지금 작업 스테이션 곡선(연결선 토큰 --pm-link) + 선 위 라벨 칩("콜롬비아 입고작업 중 · 14:20").
//   장면 위 글자는 짧게(이름·라벨칩), 자세한 건 호버/클릭 팝오버. 색은 전부 var(--pm-*) 토큰(lib/pmThemes.js).
//   테마별 장식 세트: theme.scene = clay(B) · neon(C) · hanok(D) · beach(I) · common(나머지).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Avatar, TokenBadge, usePmTheme } from './PmTheme';
import { Button } from './ui';
import { SHIRTS, STAGE_COLOR } from '../../lib/pmThemes';
import { STAGES, linkTaskText } from '../../lib/pmStages';

export const ISO_W = 1120;
export const ISO_H = 680;
const OX = 560; const OY = 86; const HW = 26; const HH = 13; const ZU = 26; // 타일 반폭·반높이·높이 1칸(px)
const N = 20; // 바닥 20×20 타일
const P = (x, y, z = 0) => [OX + (x - y) * HW, OY + (x + y) * HH - z * ZU];
const pts = (...ps) => ps.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
const CIRCLED = ['', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];
export const STATUS_LABEL = { working: '작업중', idle: '대기', off: '꺼짐', error: '오류' };
const arr = (x) => (Array.isArray(x) ? x : []);
function hashColor(s) { let h = 0; for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return SHIRTS[h % SHIRTS.length]; }
export function ago(iso, now) {
  const t = Date.parse(iso || ''); if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}초 전`; if (s < 3600) return `${Math.floor(s / 60)}분 전`; if (s < 86400) return `${Math.floor(s / 3600)}시간 전`; return `${Math.floor(s / 86400)}일 전`;
}

// 구역(타일 좌표). 복도 x 8.6~11.4. 위쪽(x 작음)=연구실·영업지원·영업부, 아래쪽=경영지원·현장팀·수입부.
const CORR = { x0: 8.6, x1: 11.4, y0: 0.6, y1: 19.6 };
export const ZONES = [
  { key: 'lab', label: 'AI 연구실', x0: 0.6, x1: 7.0, y0: 0.8, y1: 5.4, color: 'var(--pm-accent2)' },
  { key: '영업지원', label: '영업지원', x0: 0.6, x1: 7.0, y0: 6.0, y1: 11.0, color: 'var(--pm-dept-2)' },
  { key: '영업부', label: '영업부', x0: 0.6, x1: 7.0, y0: 11.6, y1: 19.2, color: 'var(--pm-dept-3)' },
  { key: '경영지원', label: '경영지원', x0: 12.8, x1: 19.4, y0: 0.8, y1: 6.2, color: 'var(--pm-dept-1)' },
  { key: '현장팀', label: '현장팀', x0: 12.8, x1: 19.4, y0: 6.8, y1: 11.8, color: 'var(--pm-off-ink)' },
  { key: '수입부', label: '수입부', x0: 12.8, x1: 19.4, y0: 12.4, y1: 19.2, color: 'var(--pm-dept-4)' },
];
const stationY = (no) => 18.2 - (no - 1) * 2.1;

function seatsIn(z, n, cols) {
  if (!n) return [];
  const c = Math.min(cols, n); const rows = Math.ceil(n / c);
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const r = Math.floor(i / c); const k = i % c;
    out.push({ x: z.x0 + ((k + 0.5) * (z.x1 - z.x0)) / c, y: z.y0 + 0.6 + ((r + 0.5) * (z.y1 - z.y0 - 0.6)) / rows });
  }
  return out;
}

// 상자(바닥 중심 cx,cy · 크기 w×d · 높이 h · 바닥 z0) → 윗면·왼앞면·오른앞면
function Box({ cx, cy, w, d, h, z0 = 0, top, left, right, stroke, className, sw = 1 }) {
  const x0 = cx - w / 2; const x1 = cx + w / 2; const y0 = cy - d / 2; const y1 = cy + d / 2; const zt = z0 + h;
  return (
    <g className={className} stroke={stroke || 'none'} strokeWidth={sw} strokeLinejoin="round">
      <polygon points={pts(P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, zt), P(x0, y1, zt))} fill={left} />
      <polygon points={pts(P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, zt), P(x1, y0, zt))} fill={right} />
      <polygon points={pts(P(x0, y0, zt), P(x1, y0, zt), P(x1, y1, zt), P(x0, y1, zt))} fill={top} />
    </g>
  );
}
const rect = (x0, y0, x1, y1, z = 0) => pts(P(x0, y0, z), P(x1, y0, z), P(x1, y1, z), P(x0, y1, z));

// ── 장식 소품 ─────────────────────────────
function Plant({ x, y, s = 1, flower }) {
  const [px, py] = P(x, y, 0.35 * s);
  return (
    <g className="iso-plant" aria-hidden>
      <Box cx={x} cy={y} w={0.42 * s} d={0.42 * s} h={0.35 * s} top="var(--pm-iso-pot)" left="var(--pm-iso-pot)" right="var(--pm-iso-pot)" />
      <polygon points={pts(P(x - 0.21 * s, y + 0.21 * s, 0), P(x + 0.21 * s, y + 0.21 * s, 0), P(x + 0.21 * s, y + 0.21 * s, 0.35 * s), P(x - 0.21 * s, y + 0.21 * s, 0.35 * s))} fill="var(--pm-ink)" opacity=".12" />
      <circle cx={px - 7 * s} cy={py - 10 * s} r={8 * s} fill="var(--pm-iso-leaf2)" />
      <circle cx={px + 6 * s} cy={py - 12 * s} r={8.5 * s} fill="var(--pm-iso-leaf)" />
      <circle cx={px} cy={py - 22 * s} r={9 * s} fill="var(--pm-iso-leaf)" />
      {flower && <><circle cx={px - 4 * s} cy={py - 22 * s} r={3 * s} fill="var(--pm-iso-extra)" /><circle cx={px + 7 * s} cy={py - 15 * s} r={3 * s} fill="var(--pm-iso-extra2)" /></>}
    </g>
  );
}
function Palm({ x, y }) {
  const [bx, by] = P(x, y); const tx = bx + 10; const ty = by - 78;
  return (
    <g aria-hidden>
      <ellipse cx={bx} cy={by} rx="16" ry="6" fill="var(--pm-ink)" opacity=".12" />
      <path d={`M${bx},${by} Q${bx - 6},${by - 40} ${tx},${ty}`} stroke="var(--pm-iso-desk-side)" strokeWidth="6" fill="none" strokeLinecap="round" />
      {[-150, -110, -60, -20, 25].map((a, i) => {
        const r = (a * Math.PI) / 180; const ex = tx + Math.cos(r) * 34; const ey = ty + Math.sin(r) * 20 + 14;
        return <path key={i} d={`M${tx},${ty} Q${(tx + ex) / 2},${ty - 16} ${ex},${ey}`} stroke={i % 2 ? 'var(--pm-iso-leaf2)' : 'var(--pm-iso-leaf)'} strokeWidth="7" fill="none" strokeLinecap="round" />;
      })}
    </g>
  );
}
function Umbrella({ x, y }) {
  const [bx, by] = P(x, y);
  return (
    <g aria-hidden>
      <line x1={bx} y1={by} x2={bx} y2={by - 46} stroke="var(--pm-iso-desk-side)" strokeWidth="2.5" />
      <path d={`M${bx - 26},${by - 40} Q${bx},${by - 70} ${bx + 26},${by - 40} Z`} fill="var(--pm-iso-extra)" />
      <path d={`M${bx - 9},${by - 43} Q${bx},${by - 70} ${bx + 9},${by - 43} Z`} fill="var(--pm-iso-extra2)" />
    </g>
  );
}
function Lantern({ x, y, z = 1.6 }) {
  const [lx, ly] = P(x, y, z);
  return (
    <g aria-hidden>
      <circle cx={lx} cy={ly} r="11" fill="var(--pm-iso-glow)" opacity=".18" />
      <rect x={lx - 5} y={ly - 7} width="10" height="14" rx="4" fill="var(--pm-iso-glow)" />
      <line x1={lx} y1={ly - 7} x2={lx} y2={ly - 14} stroke="var(--pm-iso-wall-side)" strokeWidth="1.5" />
    </g>
  );
}
function Shelf({ x, y }) {
  return (
    <g aria-hidden>
      <Box cx={x} cy={y} w={0.5} d={1.4} h={1.5} top="var(--pm-iso-desk)" left="var(--pm-iso-desk-side)" right="var(--pm-iso-desk)" />
      {[0.4, 0.8, 1.2].map((z) => <polyline key={z} points={pts(P(x + 0.25, y - 0.7, z), P(x + 0.25, y + 0.7, z))} stroke="var(--pm-iso-desk-side)" strokeWidth="2" fill="none" />)}
      {[0.5, 0.9].map((z, i) => <rect key={z} x={P(x + 0.25, y, z)[0] - 8} y={P(x + 0.25, y, z)[1] - 14} width="6" height="12" fill={i ? 'var(--pm-iso-extra)' : 'var(--pm-accent)'} />)}
    </g>
  );
}

// 벽(뒤 두 면) — 테마별 모양
const WALL_H = 2.4;
function Walls({ kind }) {
  if (kind === 'beach') {
    // 해변: 벽 대신 왼쪽 바다·오른쪽 모래 둔덕
    const sea = pts(P(0, -1.5), P(0, N + 1), [0, OY + (N + 1) * HH + 80], [0, 0], [OX - 60, 0]);
    return (
      <g aria-hidden>
        <polygon points={sea} fill="var(--pm-iso-wall)" />
        {[2, 6, 10, 14, 18].map((y) => { const [wx, wy] = P(-0.8, y); return <path key={y} d={`M${wx - 40},${wy} q10,-6 20,0 t20,0 t20,0`} stroke="var(--pm-iso-extra2)" strokeWidth="2" fill="none" opacity=".8" />; })}
        <polygon points={pts(P(0, 0), P(N, 0), P(N, -1.2), P(0, -1.2))} fill="var(--pm-iso-floor-a)" />
      </g>
    );
  }
  const L = pts(P(0, 0), P(0, N), P(0, N, WALL_H), P(0, 0, WALL_H));
  const R = pts(P(0, 0), P(N, 0), P(N, 0, WALL_H), P(0, 0, WALL_H));
  const win = (axis, a, b, z0, z1) => (axis === 'L' ? pts(P(0, a, z0), P(0, b, z0), P(0, b, z1), P(0, a, z1)) : pts(P(a, 0, z0), P(b, 0, z0), P(b, 0, z1), P(a, 0, z1)));
  return (
    <g aria-hidden>
      <polygon points={L} fill="var(--pm-iso-wall-side)" />
      <polygon points={R} fill="var(--pm-iso-wall)" />
      {kind === 'hanok' && (<>
        {/* 창호(격자 한지문) + 기둥 + 기와 처마 */}
        {[2, 7, 12, 16].map((a) => <g key={`l${a}`}><polygon points={win('L', a, a + 2.6, 0.3, 1.9)} fill="var(--pm-iso-wall)" stroke="var(--pm-iso-wall-side)" strokeWidth="1" />
          {[0.65, 1.3].map((k) => <polyline key={k} points={pts(P(0, a + k, 0.3), P(0, a + k, 1.9))} stroke="var(--pm-iso-desk-side)" strokeWidth="1.2" />)}
          {[0.85, 1.4].map((z) => <polyline key={z} points={pts(P(0, a, z), P(0, a + 2.6, z))} stroke="var(--pm-iso-desk-side)" strokeWidth="1.2" />)}</g>)}
        {[2, 7, 12, 16].map((a) => <g key={`r${a}`}><polygon points={win('R', a, a + 2.6, 0.3, 1.9)} fill="var(--pm-iso-wall)" stroke="var(--pm-iso-desk-side)" strokeWidth="1.5" />
          {[0.65, 1.3, 1.95].map((k) => <polyline key={k} points={pts(P(a + k, 0, 0.3), P(a + k, 0, 1.9))} stroke="var(--pm-iso-desk-side)" strokeWidth="1.2" />)}
          {[0.85, 1.4].map((z) => <polyline key={z} points={pts(P(a, 0, z), P(a + 2.6, 0, z))} stroke="var(--pm-iso-desk-side)" strokeWidth="1.2" />)}</g>)}
        {[0, 5, 10, 15, 20].map((a) => <polyline key={`p${a}`} points={pts(P(a, 0, 0), P(a, 0, WALL_H))} stroke="var(--pm-iso-desk-side)" strokeWidth="5" />)}
        <polygon points={pts(P(-0.6, -0.6, WALL_H + 0.1), P(N + 0.4, -0.6, WALL_H + 0.1), P(N + 0.4, -0.2, WALL_H + 0.55), P(-0.2, -0.2, WALL_H + 0.55))} fill="var(--pm-iso-extra)" />
        <polygon points={pts(P(-0.6, -0.6, WALL_H + 0.1), P(-0.6, N + 0.4, WALL_H + 0.1), P(-0.2, N + 0.4, WALL_H + 0.55), P(-0.2, -0.2, WALL_H + 0.55))} fill="var(--pm-iso-extra)" opacity=".85" />
        {Array.from({ length: 21 }, (_, i) => <polyline key={`g${i}`} points={pts(P(i - 0.4, -0.6, WALL_H + 0.1), P(i - 0.1, -0.2, WALL_H + 0.55))} stroke="var(--pm-iso-floor-b)" strokeWidth="1" opacity=".55" />)}
        {Array.from({ length: 21 }, (_, i) => <polyline key={`h${i}`} points={pts(P(-0.6, i - 0.4, WALL_H + 0.1), P(-0.2, i - 0.1, WALL_H + 0.55))} stroke="var(--pm-iso-floor-b)" strokeWidth="1" opacity=".45" />)}
      </>)}
      {kind === 'neon' && (<>
        {[3, 9, 15].map((a) => <g key={a}><polygon points={win('R', a, a + 3.4, 0.6, 2.1)} fill="var(--pm-screen)" stroke="var(--pm-iso-glow)" strokeWidth="1.5" />
          {[0.9, 1.7, 2.5].map((k, i) => <polygon key={k} points={win('R', a + k - 0.25, a + k + 0.15, 0.6, 0.95 + i * 0.35)} fill="var(--pm-iso-wall-side)" />)}</g>)}
        {[3, 10].map((a) => <polygon key={a} points={win('L', a, a + 3.4, 0.6, 2.1)} fill="var(--pm-screen)" stroke="var(--pm-iso-extra)" strokeWidth="1.5" />)}
        <polyline points={pts(P(0, N, 0.12), P(0, 0, 0.12), P(N, 0, 0.12))} stroke="var(--pm-iso-glow)" strokeWidth="2" fill="none" className="iso-neon" />
        <polyline points={pts(P(0, N, WALL_H), P(0, 0, WALL_H), P(N, 0, WALL_H))} stroke="var(--pm-iso-extra)" strokeWidth="2" fill="none" className="iso-neon" />
      </>)}
      {kind === 'clay' && (<>
        {[4, 13].map((a) => <path key={a} d={`M${P(a, 0, 0.5)[0]},${P(a, 0, 0.5)[1]} L${P(a, 0, 1.5)[0]},${P(a, 0, 1.5)[1]} Q${P(a + 1.6, 0, 2.5)[0]},${P(a + 1.6, 0, 2.5)[1] - 6} ${P(a + 3.2, 0, 1.5)[0]},${P(a + 3.2, 0, 1.5)[1]} L${P(a + 3.2, 0, 0.5)[0]},${P(a + 3.2, 0, 0.5)[1]} Z`} fill="var(--pm-iso-lab)" stroke="var(--pm-iso-wall-side)" strokeWidth="3" />)}
        {[6, 14].map((a) => <polygon key={a} points={win('L', a, a + 2.4, 0.9, 1.9)} fill="var(--pm-iso-lab)" stroke="var(--pm-iso-wall)" strokeWidth="3" />)}
      </>)}
      {kind === 'common' && (<>
        {[3, 9, 15].map((a) => <polygon key={a} points={win('R', a, a + 3, 0.8, 2.0)} fill="var(--pm-iso-lab)" stroke="var(--pm-iso-wall-side)" strokeWidth="2" />)}
        {[5, 13].map((a) => <polygon key={a} points={win('L', a, a + 3, 0.8, 2.0)} fill="var(--pm-iso-lab)" stroke="var(--pm-iso-wall)" strokeWidth="2" />)}
      </>)}
    </g>
  );
}

function Floor({ kind }) {
  const tiles = [];
  for (let i = 0; i < N; i += 2) for (let j = 0; j < N; j += 2) tiles.push(<polygon key={`${i}-${j}`} points={rect(i, j, i + 2, j + 2)} fill={(i + j) % 4 ? 'var(--pm-iso-floor-a)' : 'var(--pm-iso-floor-b)'} />);
  return (
    <g aria-hidden>
      <polygon points={rect(0, 0, N, N)} fill="var(--pm-iso-floor-b)" />
      {kind !== 'beach' && kind !== 'hanok' && tiles}
      {kind === 'hanok' && Array.from({ length: 40 }, (_, i) => <polyline key={i} points={pts(P(0, i * 0.5), P(N, i * 0.5))} stroke="var(--pm-iso-floor-a)" strokeWidth="3" />)}
      {kind === 'beach' && Array.from({ length: 70 }, (_, i) => { const x = (i * 7.3) % N; const y = (i * 11.7) % N; const [a, b] = P(x, y); return <circle key={i} cx={a} cy={b} r="1.4" fill="var(--pm-iso-desk-side)" opacity=".35" />; })}
      {kind === 'neon' && Array.from({ length: 11 }, (_, i) => <g key={i} opacity=".18"><polyline points={pts(P(i * 2, 0), P(i * 2, N))} stroke="var(--pm-iso-glow)" /><polyline points={pts(P(0, i * 2), P(N, i * 2))} stroke="var(--pm-iso-glow)" /></g>)}
      <polygon points={rect(0, 0, N, N)} fill="none" stroke="var(--pm-line)" strokeWidth="2" />
      {kind !== 'beach' && <polygon points={pts(P(0, N), P(N, N), P(N, N, -0.35), P(0, N, -0.35))} fill="var(--pm-iso-wall-side)" />}
      {kind !== 'beach' && <polygon points={pts(P(N, 0), P(N, N), P(N, N, -0.35), P(N, 0, -0.35))} fill="var(--pm-iso-wall)" />}
    </g>
  );
}

function Corridor({ kind }) {
  const { x0, x1, y0, y1 } = CORR;
  return (
    <g aria-hidden>
      {kind === 'beach' && <polygon points={pts(P(x0, y1), P(x1, y1), P(x1, y1, -0.3), P(x0, y1, -0.3))} fill="var(--pm-iso-path-edge)" />}
      <polygon points={rect(x0, y0, x1, y1, kind === 'beach' ? 0.05 : 0)} fill="var(--pm-iso-path)" stroke="var(--pm-iso-path-edge)" strokeWidth={kind === 'neon' ? 2.5 : 2} className={kind === 'neon' ? 'iso-neon' : ''} />
      {kind === 'beach' && Array.from({ length: Math.floor((y1 - y0) / 0.45) }, (_, i) => <polyline key={i} points={pts(P(x0, y0 + i * 0.45, 0.05), P(x1, y0 + i * 0.45, 0.05))} stroke="var(--pm-iso-path-edge)" strokeWidth="1.5" />)}
      {kind === 'hanok' && <polyline points={pts(P(x0 + 0.3, y1), P(x0 + 0.3, y0))} stroke="var(--pm-iso-path-edge)" strokeWidth="1" strokeDasharray="6 6" />}
      {kind === 'clay' && <polygon points={rect(x0 + 0.45, y0 + 0.3, x1 - 0.45, y1 - 0.3)} fill="none" stroke="var(--pm-iso-floor-b)" strokeWidth="3" strokeDasharray="1 12" strokeLinecap="round" />}
    </g>
  );
}

function Decor({ kind }) {
  if (kind === 'beach') return (
    <g>
      <Palm x={0.4} y={5.7} /><Palm x={0.3} y={11.3} /><Palm x={19.6} y={6.5} /><Palm x={19.5} y={12.1} /><Palm x={8.1} y={0.2} />
      <Umbrella x={8.1} y={5.8} /><Umbrella x={11.9} y={15.6} /><Umbrella x={12.2} y={4.2} />
    </g>
  );
  if (kind === 'hanok') return (
    <g>
      <Plant x={0.4} y={5.7} /><Plant x={19.6} y={12.1} /><Plant x={0.4} y={11.3} s={1.1} />
      {[3, 7, 11, 15, 19].map((y) => <Lantern key={y} x={CORR.x0 - 0.15} y={y} />)}
      {[5, 9, 13, 17].map((y) => <Lantern key={y} x={CORR.x1 + 0.15} y={y} z={1.4} />)}
    </g>
  );
  if (kind === 'neon') return (
    <g>
      <Plant x={0.4} y={5.7} /><Plant x={19.6} y={6.5} /><Plant x={19.6} y={12.1} flower />
      <Shelf x={0.4} y={8.4} /><Shelf x={0.4} y={15.4} />
    </g>
  );
  return (
    <g>
      <Plant x={0.4} y={5.7} flower={kind === 'clay'} /><Plant x={0.4} y={11.3} s={1.15} /><Plant x={19.6} y={6.5} flower={kind === 'clay'} />
      <Plant x={19.6} y={12.1} /><Plant x={8.1} y={0.2} s={0.9} flower={kind === 'clay'} /><Plant x={11.9} y={19.9} s={0.9} />
      <Shelf x={0.4} y={8.4} /><Shelf x={0.4} y={15.4} />
    </g>
  );
}

function Station({ no, kind, on, onClick, onHover }) {
  const y = stationY(no); const x = 10; const c = STAGE_COLOR[no];
  const w = 1.5; const d = 1.1; const h = 0.95;
  const x0 = x - w / 2; const x1 = x + w / 2; const y0 = y - d / 2; const y1 = y + d / 2;
  const roof = kind === 'hanok' || kind === 'beach';
  const rf = kind === 'hanok' ? 'var(--pm-iso-extra)' : 'var(--pm-iso-path-edge)';
  return (
    <g className={`iso-st ${on ? 'on' : ''}`} data-stage={no} role="button" tabIndex={0} aria-label={`${no}단계 ${STAGES[no - 1].label} 스테이션`}
      onClick={onClick} onMouseEnter={onHover} onFocus={onHover} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}>
      <polygon points={rect(x0 - 0.2, y0 - 0.2, x1 + 0.2, y1 + 0.2)} fill={c} opacity={on ? 0.45 : 0.18} />
      <Box cx={x} cy={y} w={w} d={d} h={h} top="var(--pm-iso-station)" left="var(--pm-iso-station-side)" right="var(--pm-iso-station)" stroke="var(--pm-iso-station-side)" sw={1} />
      <polygon points={pts(P(x0, y1, 0.55), P(x1, y1, 0.55), P(x1, y1, 0.75), P(x0, y1, 0.75))} fill={c} />
      <polygon points={pts(P(x1, y0, 0.55), P(x1, y1, 0.55), P(x1, y1, 0.75), P(x1, y0, 0.75))} fill={c} opacity=".8" />
      {/* 스테이션 위 소품: 단말기/박스 */}
      <Box cx={x - 0.2} cy={y - 0.15} w={0.5} d={0.4} h={0.35} z0={h} top="var(--pm-iso-extra2)" left="var(--pm-iso-desk-side)" right="var(--pm-iso-desk)" />
      <Box cx={x + 0.35} cy={y - 0.25} w={0.12} d={0.5} h={0.5} z0={h} top="var(--pm-monitor)" left="var(--pm-monitor)" right={kind === 'neon' ? 'var(--pm-iso-glow)' : 'var(--pm-screen-on)'} />
      {roof && (<>
        <polygon points={pts(P(x0 - 0.35, y1 + 0.35, h + 0.95), P(x1 + 0.35, y1 + 0.35, h + 0.95), P(x1 - 0.1, y, h + 1.55), P(x0 + 0.1, y, h + 1.55))} fill={rf} />
        <polygon points={pts(P(x1 + 0.35, y0 - 0.35, h + 0.95), P(x1 + 0.35, y1 + 0.35, h + 0.95), P(x1 - 0.1, y, h + 1.55))} fill={rf} opacity=".78" />
        <polyline points={pts(P(x0 - 0.35, y1 + 0.35, h + 0.95), P(x1 + 0.35, y1 + 0.35, h + 0.95), P(x1 + 0.35, y0 - 0.35, h + 0.95))} stroke={kind === 'hanok' ? 'var(--pm-iso-floor-b)' : 'var(--pm-iso-desk-side)'} strokeWidth="2" fill="none" />
        {[x0, x1].map((px) => <polyline key={px} points={pts(P(px, y1, h), P(px, y1, h + 0.95))} stroke="var(--pm-iso-desk-side)" strokeWidth="3" />)}
        <polyline points={pts(P(x1, y0, h), P(x1, y0, h + 0.95))} stroke="var(--pm-iso-desk-side)" strokeWidth="3" />
      </>)}
      {kind === 'neon' && <polygon points={rect(x0, y0, x1, y1, h)} fill="none" stroke={c} strokeWidth="2" className="iso-neon" />}
    </g>
  );
}

function Desk({ x, y, status, robot, kind, empty }) {
  const on = status === 'working';
  if (robot) return (
    <g aria-hidden>
      <Box cx={x} cy={y + 0.25} w={0.8} d={0.5} h={0.4} top="var(--pm-iso-station)" left="var(--pm-iso-station-side)" right="var(--pm-iso-station)" stroke="var(--pm-iso-station-side)" />
      <circle cx={P(x + 0.4, y + 0.25, 0.25)[0]} cy={P(x + 0.4, y + 0.25, 0.25)[1]} r="2.5" fill={on ? 'var(--pm-ok)' : status === 'error' ? 'var(--pm-err)' : 'var(--pm-off-bg)'} />
    </g>
  );
  return (
    <g aria-hidden opacity={empty ? 0.5 : 1}>
      <polygon points={rect(x - 0.75, y - 0.55, x + 0.75, y + 0.65)} fill="var(--pm-ink)" opacity=".07" />
      <Box cx={x} cy={y + 0.15} w={1.3} d={0.75} h={0.45} top="var(--pm-iso-desk)" left="var(--pm-iso-desk-side)" right="var(--pm-iso-desk)" stroke="var(--pm-iso-desk-side)" sw={0.8} />
      <Box cx={x + 0.3} cy={y - 0.05} w={0.1} d={0.55} h={0.4} z0={0.45} top="var(--pm-monitor)" left="var(--pm-monitor)" right="var(--pm-monitor)" />
      <polygon points={pts(P(x + 0.35, y - 0.29, 0.5), P(x + 0.35, y + 0.19, 0.5), P(x + 0.35, y + 0.19, 0.8), P(x + 0.35, y - 0.29, 0.8))} fill={on ? (kind === 'neon' ? 'var(--pm-iso-glow)' : 'var(--pm-screen-on)') : 'var(--pm-screen)'} />
      <Box cx={x - 0.35} cy={y + 0.3} w={0.25} d={0.25} h={0.2} z0={0.45} top="var(--pm-iso-extra)" left="var(--pm-iso-pot)" right="var(--pm-iso-extra)" />
    </g>
  );
}

export function Chibi({ name, robot, status, avatar, size = 46 }) {
  const st = STATUS_LABEL[status] ? status : 'off';
  if (avatar && !robot) return <Avatar cfg={avatar} state={st} size={size} className="iso-av" />;
  if (robot) return (
    <svg className={`iso-chibi pmc-${st}`} width={size * 0.8} height={size * 0.8} viewBox="0 0 40 40" aria-hidden>
      <line x1="20" y1="4" x2="20" y2="10" stroke="var(--pm-muted)" strokeWidth="2" /><circle cx="20" cy="4" r="3" fill={st === 'working' ? 'var(--pm-ok)' : st === 'error' ? 'var(--pm-err)' : 'var(--pm-idle)'} />
      <rect x="8" y="10" width="24" height="17" rx="6" fill="var(--pm-robot)" stroke="var(--pm-muted)" />
      <rect x="12" y="14" width="16" height="8" rx="3" fill="var(--pm-screen)" />
      <circle cx="16.5" cy="18" r="1.8" fill="var(--pm-screen-on)" /><circle cx="23.5" cy="18" r="1.8" fill="var(--pm-screen-on)" />
      <rect x="12" y="27" width="16" height="10" rx="4" fill="var(--pm-robot)" stroke="var(--pm-muted)" />
    </svg>
  );
  return (
    <svg className={`iso-chibi pmc-${st}`} width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <rect x="11" y="24" width="18" height="14" rx="7" fill={hashColor(name)} />
      <circle cx="20" cy="16" r="10" fill="var(--pm-skin)" />
      <path d="M10,15 Q11,5 20,5 Q29,5 30,15 Q26,9 20,10 Q14,9 10,15 Z" fill="var(--pm-hair)" />
      <circle cx="16.5" cy="17" r="1.4" fill="var(--pm-hair)" /><circle cx="23.5" cy="17" r="1.4" fill="var(--pm-hair)" />
    </svg>
  );
}

// 장면 위 누름 요소(위치 지정 span) — 키보드 Enter/Space 지원
export function Hot({ onClick, children, ...rest }) {
  return <span role="button" tabIndex={0} onClick={onClick} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(e); } }} {...rest}>{children}</span>;
}

// 칩 겹침 피하기: 앞서 놓인 칩과 겹치면 아래로 밀기
export function placeChips(items, obstacles = []) {
  const placed = obstacles.map((o) => ({ ...o }));
  return items.map((it) => {
    const w = Math.min(170, 28 + it.text.length * 10); const h = 20;
    let { x, y } = it;
    for (let k = 0; k < 8; k += 1) {
      const hit = placed.some((p) => Math.abs(p.x - x) < (p.w + w) / 2 + 4 && Math.abs(p.y - y) < ((p.h || h) + h) / 2 + 2);
      if (!hit) break;
      y += k % 2 ? -(h + 3) * (k + 1) : (h + 3) * (k + 1);
    }
    placed.push({ x, y, w, h });
    return { ...it, x, y, w };
  });
}

export function chipLabel(l) {
  if (l.label && l.text) return l.hm ? `${l.text} · ${l.hm}` : l.text;
  const t = `${linkTaskText(l)}작업 중`;
  return l.hm ? `${t} · ${l.hm}` : t;
}

export function ScenePopBody({ pop, close, stageInfo, now, selStage, onPickStage, onOpenPerson, isAdmin, myStaff }) {
  if (!pop) return null;
  if (pop.kind === 'station') {
    const s = STAGES[pop.no - 1]; const i = stageInfo(pop.no);
    return (<>
      <b style={{ color: STAGE_COLOR[pop.no] }}>{CIRCLED[pop.no]} {s.label}</b>
      <div className="muted">이번 주 {i.h == null ? '–' : `${i.h}h`} (추정)</div>
      <div>{i.nowNames.length ? `지금: ${i.nowNames.join(', ')}` : '지금 작업자 없음'}</div>
      <Button size="sm" onClick={() => { onPickStage(selStage === pop.no ? null : pop.no); close(); }}>담당자 보기</Button>
    </>);
  }
  if (pop.kind === 'agent') {
    const a = pop.a; const st = STATUS_LABEL[a.status] ? a.status : 'off';
    return (<>
      <b>{a.name || a.id}</b>{a.role && <div className="muted">{a.role}</div>}
      <span className={`chip chip-${st}`}>{STATUS_LABEL[st]}{a.lastAt ? ` · ${ago(a.lastAt, now)}` : ''}</span>
      {a.activity && <div className="iso-clamp">{a.activity}</div>}
      {a.today?.done != null && <div className="muted">오늘 {a.today.done}건</div>}
    </>);
  }
  const x = pop.x0; const st = STATUS_LABEL[x.status] ? x.status : 'off';
  const act = x.workLabel || arr(x.recent).find((r) => r?.label)?.label || (x.app ? `${x.app} 사용 중` : '');
  const mine = myStaff && myStaff === x.name;
  return (<>
    <b>{x.name}</b> <TokenBadge name={x.name} />
    <div className="muted">{x.dept || ''}{x.app ? ` · ${x.app}` : ''}</div>
    <span className={`chip chip-${st}`}>{STATUS_LABEL[st]}{x.lastAt ? ` · ${ago(x.lastAt, now)}` : ''}</span>
    {act && <div className="iso-clamp">{act}</div>}
    <div className="iso-pbtn">
      <Button size="sm" variant="primary" onClick={() => { close(); onOpenPerson(x.name); }}>상세</Button>
      {(mine || isAdmin) && <Button size="sm" onClick={() => { close(); onOpenPerson(x.name, 'look'); }}>꾸미기</Button>}
    </div>
  </>);
}

export default function IsoScene({ theme, agents, rooms, links, corridor, now, selStage, onPickStage, onOpenPerson, reduced, isAdmin, myStaff }) {
  const { avatars } = usePmTheme();
  const kind = theme?.scene || 'common';
  const hostRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [pop, setPop] = useState(null); // { kind, key, x, y, pinned }
  useLayoutEffect(() => {
    const el = hostRef.current; if (!el) return undefined;
    const f = () => setScale(Math.min(1, Math.max(0.3, el.clientWidth / ISO_W)));
    f();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(f) : null;
    if (ro) ro.observe(el);
    return () => ro && ro.disconnect();
  }, []);
  useEffect(() => {
    if (!pop?.pinned) return undefined;
    const esc = (e) => { if (e.key === 'Escape') setPop(null); };
    window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc);
  }, [pop]);

  // 자리 배치: 부서 구역별 책상, 연구실 로봇
  const seats = useMemo(() => {
    const out = [];
    const zoneOf = (k) => ZONES.find((z) => z.key === k) || ZONES.find((z) => z.key === '현장팀');
    const byZone = {};
    for (const r of arr(rooms)) for (const s of r.seats) { const z = zoneOf(r.dept); (byZone[z.key] = byZone[z.key] || []).push(s); }
    if (!byZone['현장팀']) byZone['현장팀'] = [{ empty: true, name: '현장팀', ext: true }, { empty: true, name: '현장팀', ext: true }];
    for (const z of ZONES) {
      if (z.key === 'lab') continue;
      const list = byZone[z.key] || [];
      seatsIn(z, list.length, 2).forEach((p, i) => out.push({ ...p, zone: z.key, person: list[i] }));
    }
    const ag = arr(agents);
    seatsIn(ZONES[0], ag.length, ag.length > 8 ? 5 : ag.length > 4 ? 4 : 3).forEach((p, i) => out.push({ ...p, zone: 'lab', agent: ag[i] }));
    return out.sort((a, b) => a.x + a.y - (b.x + b.y));
  }, [agents, rooms]);

  const deskOf = useMemo(() => new Map(seats.filter((s) => s.person && !s.person.empty).map((s) => [s.person.name, s])), [seats]);
  const lines = useMemo(() => {
    const out = [];
    for (const l of arr(links)) {
      const s = deskOf.get(l.name); if (!s || !l.stage) continue;
      const a = P(s.x, s.y, 0.5); const b = P(10, stationY(l.stage), 1.0);
      const c = [(a[0] + b[0]) / 2, Math.min(a[1], b[1]) - 46];
      const m = [(a[0] + 2 * c[0] + b[0]) / 4, (a[1] + 2 * c[1] + b[1]) / 4];
      out.push({ ...l, d: `M${a[0].toFixed(1)},${a[1].toFixed(1)} Q${c[0].toFixed(1)},${c[1].toFixed(1)} ${b[0].toFixed(1)},${b[1].toFixed(1)}`, m });
    }
    return out;
  }, [links, deskOf]);
  const roofed = kind === 'hanok' || kind === 'beach';
  const chips = useMemo(() => {
    const obs = STAGES.map((st) => { const [sx, sy] = P(10, stationY(st.no), roofed ? 2.6 : 1.7); return { x: sx, y: sy - 11, w: 34 + st.label.length * 13, h: 24 }; });
    for (const se of seats) if (se.person && !se.person.empty) { const [nx, ny] = P(se.x, se.y + 0.55, 0); obs.push({ x: nx, y: ny + 9, w: 24 + se.person.name.length * 12, h: 20 }); }
    return placeChips(lines.filter((l) => l.kind === 'current').map((l) => ({ key: `${l.name}:${l.stage}`, name: l.name, x: l.m[0], y: l.m[1], text: chipLabel(l), l })), obs);
  }, [lines, seats, roofed]);

  const stageInfo = (no) => {
    const st = corridor?.stages?.find((x) => x.no === no);
    const nowNames = [...new Set(arr(links).filter((l) => l.stage === no && l.kind !== 'today').map((l) => l.name))];
    return { h: st?.h, nowNames };
  };
  const hover = (p) => setPop((cur) => (cur?.pinned ? cur : p));
  const leave = () => setPop((cur) => (cur?.pinned ? cur : null));
  const pin = (p) => setPop((cur) => (cur?.pinned && cur.key === p.key ? null : { ...p, pinned: true }));

  const popBody = () => <ScenePopBody pop={pop} close={() => setPop(null)} stageInfo={stageInfo} now={now} selStage={selStage} onPickStage={onPickStage} onOpenPerson={onOpenPerson} isAdmin={isAdmin} myStaff={myStaff} />;

  return (
    <div className="iso-host" ref={hostRef} data-scene={kind} style={{ height: ISO_H * scale }} onClick={(e) => { if (e.target === e.currentTarget) setPop(null); }}>
      <div className="iso-stage" style={{ width: ISO_W, height: ISO_H, transform: `scale(${scale})` }}>
        <svg className="iso-svg" width={ISO_W} height={ISO_H} viewBox={`0 0 ${ISO_W} ${ISO_H}`} role="img" aria-label="PM 사무실 아이소메트릭 장면" onClick={() => setPop(null)}>
          <Walls kind={kind} />
          <Floor kind={kind} />
          {ZONES.map((z) => (
            <polygon key={z.key} points={rect(z.x0, z.y0, z.x1, z.y1)} fill={z.key === 'lab' ? 'var(--pm-iso-lab)' : 'var(--pm-iso-zone)'} stroke={z.color} strokeWidth="2" strokeDasharray={z.key === '현장팀' ? '6 5' : undefined} strokeOpacity=".7" />
          ))}
          {/* 연구실 유리 칸막이 */}
          <polygon points={pts(P(ZONES[0].x0, ZONES[0].y1), P(ZONES[0].x1, ZONES[0].y1), P(ZONES[0].x1, ZONES[0].y1, 1.1), P(ZONES[0].x0, ZONES[0].y1, 1.1))} fill="var(--pm-iso-glow)" opacity=".12" stroke="var(--pm-iso-glow)" strokeOpacity=".5" />
          <polygon points={pts(P(ZONES[0].x1, ZONES[0].y0), P(ZONES[0].x1, ZONES[0].y1), P(ZONES[0].x1, ZONES[0].y1, 1.1), P(ZONES[0].x1, ZONES[0].y0, 1.1))} fill="var(--pm-iso-glow)" opacity=".1" stroke="var(--pm-iso-glow)" strokeOpacity=".5" />
          <Corridor kind={kind} />
          <Decor kind={kind} />
          {STAGES.map((s) => (
            <Station key={s.no} no={s.no} kind={kind} on={selStage === s.no}
              onClick={(e) => { e?.stopPropagation?.(); const [px, py] = P(10, stationY(s.no), 2.4); pin({ kind: 'station', key: `st${s.no}`, no: s.no, x: px, y: py }); }}
              onHover={() => { const [px, py] = P(10, stationY(s.no), 2.4); hover({ kind: 'station', key: `st${s.no}`, no: s.no, x: px, y: py }); }} />
          ))}
          {seats.map((s, i) => <Desk key={i} x={s.x} y={s.y} kind={kind} robot={!!s.agent} empty={s.person?.empty} status={s.agent ? s.agent.status : s.person?.status} />)}
          <g className="iso-lines" role="group" aria-label="직원→지금 작업 단계 연결선">
            {lines.map((l, i) => {
              const cur = l.kind === 'current'; const id = `isol-${i}`;
              return (
                <g key={id} className={`iso-ln ${cur ? 'cur' : 'rec'}`} data-flow={`${l.name}:${l.stage}:${l.kind}`}>
                  {kind === 'neon' && cur && <path d={l.d} fill="none" stroke="var(--pm-link)" strokeWidth="7" strokeOpacity=".22" strokeLinecap="round" />}
                  <path id={id} d={l.d} fill="none" stroke={cur ? 'var(--pm-link)' : STAGE_COLOR[l.stage]} strokeWidth={cur ? 2.6 : 1.4} strokeOpacity={cur ? 0.9 : 0.35} strokeDasharray={cur ? undefined : '4 5'} strokeLinecap="round" />
                  {cur && !reduced && <circle r="3.5" fill="var(--pm-link)" stroke="var(--pm-surface)" strokeWidth="1"><animateMotion dur="2.6s" repeatCount="indefinite"><mpath href={`#${id}`} /></animateMotion></circle>}
                </g>
              );
            })}
          </g>
        </svg>

        {/* HTML 겹: 구역 명패 · 스테이션 이름 · 캐릭터 · 이름표 · 라벨칩 · 팝오버 (겹침 0 — 고정폭·말줄임) */}
        {ZONES.map((z) => {
          const lower = z.x0 > CORR.x1; const [zx, zy] = lower ? P(z.x1 - 0.3, z.y0 + 0.9, 0) : P(z.x0 + 0.9, z.y1 - 0.3, 0);
          const n = z.key === 'lab' ? arr(agents).length : seats.filter((s) => s.zone === z.key && s.person && !s.person.empty).length;
          return <div key={z.key} className="iso-zl" style={{ left: zx, top: zy, '--zc': z.color }}>{z.label}{z.key === '현장팀' && !n ? ' · PC 없음' : <small> {n}</small>}</div>;
        })}
        {STAGES.map((s) => {
          const [sx, sy] = P(10, stationY(s.no), kind === 'hanok' || kind === 'beach' ? 2.6 : 1.7);
          const h = corridor?.stages?.find((x) => x.no === s.no)?.h;
          return (
            <Hot key={s.no} className={`iso-sl ${selStage === s.no ? 'on' : ''}`} style={{ left: sx, top: sy, '--sc': STAGE_COLOR[s.no] }}
              onClick={() => pin({ kind: 'station', key: `st${s.no}`, no: s.no, x: sx, y: sy - 18 })} onMouseEnter={() => hover({ kind: 'station', key: `st${s.no}`, no: s.no, x: sx, y: sy - 18 })} onMouseLeave={leave}>
              <i>{s.no}</i>{s.label}{h != null && h > 0 ? <small>{h}h</small> : null}
            </Hot>
          );
        })}
        {seats.map((s, i) => {
          const robot = !!s.agent; const x = s.agent || s.person;
          if (!x || x.empty) {
            if (!x?.ext) return null;
            const [ex, ey] = P(s.x, s.y, 0.6);
            return <div key={i} className="iso-nm ext" style={{ left: ex, top: ey + 6 }}>빈 자리</div>;
          }
          const [cx, cy] = robot ? P(s.x, s.y - 0.15, 0.4) : P(s.x - 0.25, s.y - 0.35, 0.45);
          const st = STATUS_LABEL[x.status] ? x.status : 'off';
          const key = robot ? `a:${x.id || x.name}` : `p:${x.name}`;
          const pp = robot ? { kind: 'agent', key, a: x, x: cx, y: cy - 52 } : { kind: 'staff', key, x0: x, x: cx, y: cy - 58 };
          const [nx, ny] = P(s.x, s.y + 0.55, 0);
          return (
            <div key={key} className="iso-who" data-desk={robot ? undefined : x.name}>
              <Hot className={`iso-ch st-${st}`} style={{ left: cx, top: cy }} aria-label={`${x.name || x.id} ${STATUS_LABEL[st]}`}
                onMouseEnter={() => hover(pp)} onMouseLeave={leave} onFocus={() => hover(pp)} onClick={(e) => { e.stopPropagation(); pin(pp); }}>
                <Chibi name={x.name} robot={robot} status={st} avatar={robot ? null : avatars[x.name]} size={robot ? 40 : 46} />
                {st === 'idle' && <span className="iso-z" aria-hidden>z</span>}
                {st === 'error' && <span className="iso-bang" aria-hidden>!</span>}
              </Hot>
              {!robot && <div className={`iso-nm st-${st}`} style={{ left: nx, top: ny }} title={x.name || x.id}><i aria-hidden />{x.name || x.id}</div>}
            </div>
          );
        })}
        {chips.map((c) => (
          <Hot key={c.key} className="iso-chip" data-chip={c.key} style={{ left: c.x, top: c.y, maxWidth: 170 }} title={`${c.name} · ${c.text}`}
            onClick={() => onOpenPerson(c.name, 'time')}>{c.text}</Hot>
        ))}
        {pop && (
          <div className={`iso-pop ${pop.pinned ? 'pinned' : ''}`} role={pop.pinned ? 'dialog' : 'tooltip'} style={{ left: Math.min(ISO_W - 120, Math.max(120, pop.x)), top: pop.y }}
            onMouseEnter={() => pop && !pop.pinned && setPop({ ...pop, pinned: true })} onClick={(e) => e.stopPropagation()}>
            {popBody()}
          </div>
        )}
      </div>
    </div>
  );
}

// 장면 CSS — 색은 전부 토큰. pages/pm.js 의 <style jsx global> 와 함께 쓰인다.
export const ISO_CSS = `
.pm .iso-host { position: relative; width: 100%; overflow: hidden; border-radius: calc(var(--pm-radius) + 4px); }
.pm .iso-stage { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.pm .iso-svg { position: absolute; inset: 0; display: block; }
.pm .iso-st { cursor: pointer; outline: none; } .pm .iso-st:focus-visible polygon:first-child { opacity: .6; }
.pm .iso-neon { filter: drop-shadow(0 0 4px var(--pm-iso-glow)); }
.pm .iso-zl { position: absolute; transform: translate(-50%, -50%); white-space: nowrap; font-size: 12px; font-weight: 700; padding: 2px 10px; border-radius: 999px; background: var(--pm-plate); color: var(--pm-plate-ink); border: 2px solid var(--zc); box-shadow: var(--pm-shadow); pointer-events: none; }
.pm .iso-zl small { color: inherit; opacity: .7; }
.pm .iso-sl { position: absolute; transform: translate(-50%, -100%); display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; font: inherit; font-size: 12px; font-weight: 700; padding: 2px 9px 2px 3px; border-radius: 999px; background: var(--pm-surface); color: var(--pm-ink); border: 2px solid var(--sc); box-shadow: var(--pm-shadow); cursor: pointer; }
.pm .iso-sl i { font-style: normal; display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: var(--sc); color: var(--pm-accent-ink); font-size: 11px; }
.pm .iso-sl small { font-size: 10px; margin-left: 2px; }
.pm .iso-sl.on, .pm .iso-sl:hover, .pm .iso-sl:focus-visible { background: var(--sc); color: var(--pm-accent-ink); outline: none; } .pm .iso-sl.on small, .pm .iso-sl:hover small { color: inherit; }
.pm .iso-ch { position: absolute; transform: translate(-50%, -100%); background: none; border: 0; padding: 0; cursor: pointer; line-height: 0; }
.pm .iso-ch:focus-visible { outline: 3px solid var(--pm-accent2); border-radius: 8px; }
.pm .iso-ch.st-off { filter: grayscale(.85) brightness(.85); opacity: .8; }
.pm .iso-ch.st-working .iso-chibi, .pm .iso-ch.st-working .iso-av { animation: isoBob 1.6s ease-in-out infinite; }
.pm .iso-z { position: absolute; right: -6px; top: -4px; font: 700 12px/1 var(--pm-font); color: var(--pm-muted); animation: isoZ 2.4s ease-in-out infinite; }
.pm .iso-bang { position: absolute; right: -4px; top: -6px; font: 900 14px/1 var(--pm-font); color: var(--pm-err); }
.pm .iso-nm { position: absolute; transform: translate(-50%, 0); max-width: 76px; display: flex; align-items: center; gap: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 11px; font-weight: 700; padding: 1px 7px; border-radius: 999px; background: var(--pm-surface); color: var(--pm-ink); border: 1px solid var(--pm-line); box-shadow: var(--pm-shadow); pointer-events: none; }
.pm .iso-nm i { flex: 0 0 6px; width: 6px; height: 6px; border-radius: 50%; background: var(--pm-off-ink); }
.pm .iso-nm.st-working i { background: var(--pm-ok); } .pm .iso-nm.st-idle i { background: var(--pm-idle); } .pm .iso-nm.st-error i { background: var(--pm-err); }
.pm .iso-nm.bot { max-width: 84px; font-size: 10px; display: block; text-overflow: ellipsis; } .pm .iso-nm.bot i { display: inline-block; margin-right: 3px; vertical-align: middle; }
.pm .iso-nm.ext { color: var(--pm-muted); border-style: dashed; font-weight: 400; }
.pm .iso-chip { position: absolute; transform: translate(-50%, -50%); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font: inherit; font-size: 11px; font-weight: 700; padding: 2px 9px; border-radius: 999px; background: var(--pm-link); color: var(--pm-accent-ink); border: 1px solid var(--pm-surface); box-shadow: var(--pm-shadow); cursor: pointer; z-index: 3; }
.pm .iso-chip:hover, .pm .iso-chip:focus-visible { outline: 2px solid var(--pm-accent2); }
.pm .iso-pop { position: absolute; z-index: 10; transform: translate(-50%, -100%); width: 220px; box-sizing: border-box; display: grid; gap: 5px; padding: 10px 12px; background: var(--pm-surface); color: var(--pm-ink); border: 2px solid var(--pm-line); border-radius: var(--pm-radius); box-shadow: var(--pm-shadow); font-size: 12px; overflow-wrap: anywhere; }
.pm .iso-pop.pinned { border-color: var(--pm-accent); }
.pm .iso-pop .chip { justify-self: start; }
.pm .iso-clamp { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.pm .iso-pbtn { display: flex; gap: 6px; }
@keyframes isoBob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-2px); } }
@keyframes isoZ { 0% { opacity: 0; transform: translateY(2px); } 50% { opacity: 1; } 100% { opacity: 0; transform: translateY(-6px); } }
@media (prefers-reduced-motion: reduce) { .pm .iso-ch .iso-chibi, .pm .iso-ch .iso-av, .pm .iso-z { animation: none !important; } }
`;
