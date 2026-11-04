// components/pm/SkillFx.js — /pm 장면 스킬 이펙트 오버레이(SVG, 새 라이브러리 없음). 정의·판정 = lib/pmSkills(엔진 독립).
//   BgScene 의 연결선 SVG 안에 <SkillFx lines dances avatars reduced /> 한 줄로 붙는다. 선이 새로 생기면(작업 시작·전환) 기본공격,
//   같은 작업 연속 N분 = 스킬, 오늘 목표·요청 배포·성장 승급 = 궁극기. 쿨다운·동시 상한은 nextCasts 가 처리.
//   reduced-motion: 발사체 없이 스테이션 정적 하이라이트만. 색은 var(--pm-*) 토큰(팔레트 데이터).
import { useEffect, useRef, useState } from 'react';
import { castSpec, nextCasts, pickSkill } from '../../lib/pmSkills';

const arr = (x) => (Array.isArray(x) ? x : []);
const f1 = (v) => Number(v).toFixed(1);

export function trailPath(trail, a, b, d) {
  if (!a || !b) return d || '';
  if (trail === 'curve' && d) return d;
  if (trail === 'bounce') {
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const h = Math.max(20, Math.abs(b[0] - a[0]) * 0.25);
    return `M${f1(a[0])},${f1(a[1])} Q${f1((a[0] + m[0]) / 2)},${f1(Math.min(a[1], m[1]) - h)} ${f1(m[0])},${f1(m[1])} Q${f1((m[0] + b[0]) / 2)},${f1(Math.min(m[1], b[1]) - h * 0.6)} ${f1(b[0])},${f1(b[1])}`;
  }
  return `M${f1(a[0])},${f1(a[1])} L${f1(b[0])},${f1(b[1])}`;
}

// 한 번의 시전 그림(상점 미리보기에서도 재사용). spec = castSpec 결과
export function FxCast({ spec, a, b, d, uid }) {
  const id = `fx-${uid}`;
  const dur = `${spec.durMs / 1000}s`;
  const c0 = spec.colors[0]; const c1 = spec.colors[1] || c0;
  if (spec.reduced) return <circle cx={b[0]} cy={b[1]} r="16" className="fx-hl" style={{ stroke: c0 }} />;
  const n = Math.max(1, spec.count);
  return (
    <g className={`fx fx-${spec.tier}`} data-fx={spec.id}>
      <path id={id} d={trailPath(spec.trail, a, b, d)} className="fx-trail" style={{ stroke: c1 }} />
      {Array.from({ length: n }, (_, i) => (
        <text key={i} className="fx-proj" fontSize={spec.tier === 'ult' ? 22 : 16} textAnchor="middle" dominantBaseline="central">
          {spec.emoji}
          <animateMotion dur={dur} begin={`${(i * 0.12).toFixed(2)}s`} fill="freeze" rotate={spec.projectile === 'paperPlane' ? 'auto' : undefined}><mpath href={`#${id}`} /></animateMotion>
          <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.85;1" dur={dur} begin={`${(i * 0.12).toFixed(2)}s`} fill="freeze" />
        </text>
      ))}
      <circle cx={b[0]} cy={b[1]} r="4" className="fx-hit" style={{ fill: c0, stroke: c1 }}>
        <animate attributeName="r" values={`4;${spec.tier === 'ult' ? 46 : 26}`} dur="0.6s" begin={`${(spec.durMs * 0.7) / 1000}s`} fill="freeze" />
        <animate attributeName="opacity" values="0;0.75;0" dur="0.6s" begin={`${(spec.durMs * 0.7) / 1000}s`} fill="freeze" />
      </circle>
    </g>
  );
}

export default function SkillFx({ lines, dances, avatars, reduced }) {
  const st = useRef(null);
  const [live, setLive] = useState([]);
  const seq = useRef(0);
  const run = () => {
    const now = Date.now();
    const cur = arr(lines).filter((l) => l.kind === 'current');
    const { casts, state } = nextCasts(st.current, { lines: cur, dances: dances || {} }, now);
    st.current = state;
    if (!casts.length) return;
    const add = casts.map((c) => {
      const l = cur.find((x) => x.name === c.name);
      if (!l || !l.a || !l.b) return null;
      const items = (avatars?.[c.name]?.view || avatars?.[c.name])?.items || {};
      const spec = castSpec(pickSkill(c.tier, c.stage || l.stage, items), { ...c, stage: c.stage || l.stage }, reduced);
      return { key: ++seq.current, spec, a: l.a, b: l.b, d: l.d, until: now + spec.durMs + 700 };
    }).filter(Boolean);
    setLive((v) => [...v.filter((x) => x.until > now), ...add]);
  };
  useEffect(run, [lines, dances]); // eslint-disable-line react-hooks/exhaustive-deps
  const runRef = useRef(run); runRef.current = run;
  useEffect(() => { const t = setInterval(() => runRef.current(), 30000); return () => clearInterval(t); }, []); // 연속 작업 스킬 판정
  useEffect(() => {
    if (!live.length) return undefined;
    const t = setTimeout(() => setLive((v) => v.filter((x) => x.until > Date.now())), 1000);
    return () => clearTimeout(t);
  }, [live]);
  return <g className="fx-layer" aria-hidden>{live.map((x) => <FxCast key={x.key} uid={x.key} spec={x.spec} a={x.a} b={x.b} d={x.d} />)}</g>;
}

export const FX_CSS = `
.pm .fx-trail { fill: none; stroke-width: 2; stroke-linecap: round; stroke-dasharray: 3 7; opacity: .5; }
.pm .fx-ult .fx-trail { stroke-width: 3.5; opacity: .7; }
.pm .fx-proj { pointer-events: none; filter: drop-shadow(0 2px 2px color-mix(in srgb, var(--pm-ink) 30%, transparent)); }
.pm .fx-hit { opacity: 0; stroke-width: 2; }
.pm .fx-hl { fill: none; stroke-width: 3; opacity: .8; }
.pm .fxi { font-size: 34px; line-height: 52px; width: 52px; height: 52px; display: inline-block; text-align: center; }
.pm .fxi.big { font-size: 72px; width: auto; height: auto; line-height: 1; }
.pm .fxprev svg { width: 100%; height: 100%; }
.pm .fx-st { fill: color-mix(in srgb, var(--pm-stage-3) 30%, var(--pm-surface)); stroke: var(--pm-stage-3); stroke-width: 2; }
.pm .bg-mount { position: absolute; transform: translate(-50%, -100%) scale(var(--iz, 1)); font-size: 16px; line-height: 1; pointer-events: none; filter: drop-shadow(0 1px 1px color-mix(in srgb, var(--pm-ink) 30%, transparent)); }
`;
