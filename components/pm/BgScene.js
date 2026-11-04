// components/pm/BgScene.js
// /pm 사무실 "배경 일러스트 장면" — Gemini 로 만든 글자·사람 없는 테마 배경(public/pm/scene-bg/{id}.webp)을 깔고
//   그 위에 실시간 요소만 HTML/SVG 로 겹친다: 9단계 스테이션 칩 · 직원 캐릭터 · 이름표 · 직원→작업 스테이션 곡선 + 라벨칩 · 연구실 로봇.
//   좌표는 lib/pmSceneMaps.json(배경 기준 %). 배경이 없는 테마는 IsoScene(SVG) 로 폴백(pages/pm.js).
//   색은 전부 var(--pm-*) 토큰. 글자는 px 고정(장면 확대/축소와 무관하게 읽힘), 캐릭터 크기만 장면 폭 비례(cqw).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { usePmTheme } from './PmTheme';
import { Chibi, Hot, STATUS_LABEL, ScenePopBody, chipLabel, placeChips } from './IsoScene';
import { STAGE_COLOR } from '../../lib/pmThemes';
import { STAGES } from '../../lib/pmStages';
import { sceneMapFor, seatPoints } from '../../lib/pmSceneMap';

const SW = 1600; // 장면 좌표계 폭(px) — 높이는 SW / aspect
const arr = (x) => (Array.isArray(x) ? x : []);
const DEPTS = ['영업지원', '영업부', '수입부', '경영지원', '현장팀'];

export default function BgScene({ themeId, agents, rooms, links, corridor, now, selStage, onPickStage, onOpenPerson, reduced, isAdmin, myStaff, fallback = null }) {
  const { avatars } = usePmTheme();
  const map = sceneMapFor(themeId);
  const SH = Math.round(SW / map.aspect);
  const hostRef = useRef(null);
  const [hostW, setHostW] = useState(1200);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pop, setPop] = useState(null);
  useLayoutEffect(() => {
    const el = hostRef.current; if (!el) return undefined;
    const f = () => setHostW(el.clientWidth || 1200);
    f();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(f) : null;
    if (ro) ro.observe(el);
    return () => ro && ro.disconnect();
  }, []);
  useEffect(() => { setLoaded(false); setFailed(false); }, [themeId]);
  useEffect(() => {
    if (!pop?.pinned) return undefined;
    const esc = (e) => { if (e.key === 'Escape') setPop(null); };
    window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc);
  }, [pop]);

  const k = SW / Math.max(320, hostW); // 화면 px → 장면 좌표
  const px = (p) => [(p[0] * SW) / 100, (p[1] * SH) / 100];

  // 부서별 자리 배정
  const seats = useMemo(() => {
    const byDept = {};
    for (const r of arr(rooms)) {
      const d = DEPTS.includes(r.dept) ? r.dept : '현장팀';
      for (const s of r.seats) if (!s.empty) (byDept[d] = byDept[d] || []).push(s);
    }
    const out = [];
    for (const d of DEPTS) {
      const list = byDept[d] || [];
      seatPoints(map, d, list.length).forEach((p, i) => out.push({ p, dept: d, person: list[i] }));
    }
    return out.sort((a, b) => a.p[1] - b.p[1]);
  }, [rooms, map]);
  const robots = useMemo(() => arr(agents).map((a, i) => {
    const R = map.robots; const base = R[i % R.length]; const lap = Math.floor(i / R.length);
    return { a, p: [base[0] + lap * 2.5, base[1] + lap * 2] };
  }), [agents, map]);
  const deskOf = useMemo(() => new Map(seats.map((s) => [s.person.name, s])), [seats]);

  const lines = useMemo(() => {
    const out = [];
    for (const l of arr(links)) {
      const s = deskOf.get(l.name); const st = map.stations[(l.stage || 0) - 1];
      if (!s || !st) continue;
      const a = px([s.p[0], s.p[1] - 4]); const b = px(st);
      const c = [(a[0] + b[0]) / 2, Math.min(a[1], b[1]) - 70];
      const m = [(a[0] + 2 * c[0] + b[0]) / 4, (a[1] + 2 * c[1] + b[1]) / 4];
      out.push({ ...l, d: `M${a[0].toFixed(1)},${a[1].toFixed(1)} Q${c[0].toFixed(1)},${c[1].toFixed(1)} ${b[0].toFixed(1)},${b[1].toFixed(1)}`, m });
    }
    return out;
  }, [links, deskOf, map, SH]); // eslint-disable-line react-hooks/exhaustive-deps

  const chips = useMemo(() => {
    const obs = STAGES.map((st, i) => { const [x, y] = px(map.stations[i]); return { x, y, w: (40 + st.label.length * 13) * k, h: 26 * k }; });
    for (const s of seats) { const [x, y] = px(s.p); obs.push({ x, y: y + 12 * k, w: (28 + s.person.name.length * 12) * k, h: 20 * k }); }
    const items = lines.filter((l) => l.kind === 'current').map((l) => ({ key: `${l.name}:${l.stage}`, name: l.name, x: l.m[0], y: l.m[1], text: chipLabel(l), l }));
    // placeChips 는 화면 px 기준 폭을 쓰므로 장면 좌표↔화면 px 를 오가며 배치
    const placed = placeChips(items.map((it) => ({ ...it, x: it.x / k, y: it.y / k })), obs.map((o) => ({ x: o.x / k, y: o.y / k, w: o.w / k, h: o.h / k })));
    return placed.map((c) => ({ ...c, x: c.x * k, y: c.y * k }));
  }, [lines, seats, map, k, SH]); // eslint-disable-line react-hooks/exhaustive-deps

  const stageInfo = (no) => {
    const st = corridor?.stages?.find((x) => x.no === no);
    const nowNames = [...new Set(arr(links).filter((l) => l.stage === no && l.kind !== 'today').map((l) => l.name))];
    return { h: st?.h, nowNames };
  };
  const hover = (p) => setPop((cur) => (cur?.pinned ? cur : p));
  const leave = () => setPop((cur) => (cur?.pinned ? cur : null));
  const pin = (p) => setPop((cur) => (cur?.pinned && cur.key === p.key ? null : { ...p, pinned: true }));
  const pct = (x, y) => ({ left: `${(x / SW) * 100}%`, top: `${(y / SH) * 100}%` });
  const popLeft = pop ? Math.min(SW - 130 * k, Math.max(130 * k, pop.x)) : 0;

  const lab = map.lab;
  const fieldEmpty = !seats.some((s) => s.dept === '현장팀');
  const zoneLabels = DEPTS.map((d) => {
    const P = map.seats[d] || []; if (!P.length) return null;
    const n = seats.filter((s) => s.dept === d).length;
    const top = P.reduce((m, p) => (p[1] < m[1] ? p : m), P[0]);
    return { d, n, x: top[0], y: Math.max(3, top[1] - 11) };
  }).filter(Boolean);

  if (failed && fallback) return fallback;
  return (
    <div className="bg-host" ref={hostRef} data-scene-bg={themeId} style={{ aspectRatio: `${map.aspect}` }} onClick={(e) => { if (e.target === e.currentTarget) setPop(null); }}>
      <div className="bg-lq" style={{ backgroundImage: `url(/pm/scene-bg/${map.src}-lq.webp)` }} aria-hidden />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={`bg-img ${loaded ? 'on' : ''}`} src={`/pm/scene-bg/${map.src}.webp`} alt="" aria-hidden onLoad={() => setLoaded(true)} onError={() => setFailed(true)} draggable={false} onClick={() => setPop(null)} />
      <svg className="bg-svg" viewBox={`0 0 ${SW} ${SH}`} role="group" aria-label="직원→지금 작업 단계 연결선" onClick={() => setPop(null)}>
        <rect className="bg-lab" x={(lab[0] * SW) / 100} y={(lab[1] * SH) / 100} width={((lab[2] - lab[0]) * SW) / 100} height={((lab[3] - lab[1]) * SH) / 100} rx="18" />
        {lines.map((l, i) => {
          const cur = l.kind === 'current'; const id = `bgl-${i}`;
          return (
            <g key={id} className={`bg-ln ${cur ? 'cur' : 'rec'}`} data-flow={`${l.name}:${l.stage}:${l.kind}`}>
              {cur && <path d={l.d} className="bg-glow" />}
              <path id={id} d={l.d} className={cur ? 'bg-cur' : 'bg-rec'} style={cur ? undefined : { stroke: STAGE_COLOR[l.stage] }} />
              {cur && !reduced && <circle r="5" className="bg-dot"><animateMotion dur="2.8s" repeatCount="indefinite"><mpath href={`#${id}`} /></animateMotion></circle>}
            </g>
          );
        })}
      </svg>

      <div className="bg-zl lab" style={{ left: `${(lab[0] + lab[2]) / 2}%`, top: `${lab[1] + 2}%` }}>AI 연구실 <small>{arr(agents).length}</small></div>
      {zoneLabels.map((z) => (
        <div key={z.d} className="bg-zl" style={{ left: `${z.x}%`, top: `${z.y}%` }}>{z.d}{z.d === '현장팀' && fieldEmpty ? <small> · PC 없음</small> : <small> {z.n}</small>}</div>
      ))}

      {STAGES.map((s, i) => {
        const [x, y] = px(map.stations[i]);
        const h = corridor?.stages?.find((q) => q.no === s.no)?.h;
        const pp = { kind: 'station', key: `st${s.no}`, no: s.no, x, y: y - 18 * k };
        return (
          <Hot key={s.no} className={`bg-sl ${selStage === s.no ? 'on' : ''}`} data-stage={s.no} style={{ ...pct(x, y), '--sc': STAGE_COLOR[s.no] }} aria-label={`${s.no}단계 ${s.label} 스테이션`}
            onClick={(e) => { e.stopPropagation(); pin(pp); }} onMouseEnter={() => hover(pp)} onFocus={() => hover(pp)} onMouseLeave={leave}>
            <i>{s.no}</i>{s.label}{h != null && h > 0 ? <small>{h}h</small> : null}
          </Hot>
        );
      })}

      {robots.map(({ a, p }) => {
        const [x, y] = px(p); const st = STATUS_LABEL[a.status] ? a.status : 'off'; const key = `a:${a.id || a.name}`;
        const pp = { kind: 'agent', key, a, x, y: y - 50 * k };
        return (
          <Hot key={key} className={`bg-ch bot st-${st}`} style={pct(x, y)} aria-label={`${a.name || a.id} ${STATUS_LABEL[st]}`} title={a.name || a.id}
            onMouseEnter={() => hover(pp)} onMouseLeave={leave} onFocus={() => hover(pp)} onClick={(e) => { e.stopPropagation(); pin(pp); }}>
            <Chibi name={a.name} robot status={st} size={40} />
            {st === 'error' && <span className="iso-bang" aria-hidden>!</span>}
          </Hot>
        );
      })}

      {seats.map(({ p, person: x }) => {
        const [cx, cy] = px(p); const st = STATUS_LABEL[x.status] ? x.status : 'off'; const key = `p:${x.name}`;
        const pp = { kind: 'staff', key, x0: x, x: cx, y: cy - 70 * k };
        return (
          <div key={key} className="iso-who" data-desk={x.name}>
            <Hot className={`bg-ch st-${st}`} style={pct(cx, cy)} aria-label={`${x.name} ${STATUS_LABEL[st]}`}
              onMouseEnter={() => hover(pp)} onMouseLeave={leave} onFocus={() => hover(pp)} onClick={(e) => { e.stopPropagation(); pin(pp); }}>
              <Chibi name={x.name} status={st} avatar={avatars[x.name]} size={46} />
              {st === 'idle' && <span className="iso-z" aria-hidden>z</span>}
              {st === 'error' && <span className="iso-bang" aria-hidden>!</span>}
            </Hot>
            <div className={`iso-nm bg-nm st-${st}`} style={pct(cx, cy)} title={x.name}><i aria-hidden />{x.name}</div>
          </div>
        );
      })}

      {chips.map((c) => (
        <Hot key={c.key} className="iso-chip" data-chip={c.key} style={{ ...pct(c.x, c.y), maxWidth: 180 }} title={`${c.name} · ${c.text}`}
          onClick={() => onOpenPerson(c.name, 'time')}>{c.text}</Hot>
      ))}

      {pop && (
        <div className={`iso-pop ${pop.pinned ? 'pinned' : ''}`} role={pop.pinned ? 'dialog' : 'tooltip'} style={pct(popLeft, Math.max(150 * k, pop.y))}
          onMouseEnter={() => pop && !pop.pinned && setPop({ ...pop, pinned: true })} onClick={(e) => e.stopPropagation()}>
          <ScenePopBody pop={pop} close={() => setPop(null)} stageInfo={stageInfo} now={now} selStage={selStage} onPickStage={onPickStage} onOpenPerson={onOpenPerson} isAdmin={isAdmin} myStaff={myStaff} />
        </div>
      )}
    </div>
  );
}

// 배경 장면 CSS — 색은 전부 토큰. ISO_CSS(.iso-nm·.iso-chip·.iso-pop 등)와 함께 쓰인다.
export const BG_CSS = `
.pm .bg-host { position: relative; width: 100%; overflow: hidden; border-radius: calc(var(--pm-radius) + 4px); container-type: inline-size; background: var(--pm-surface2); }
.pm .bg-lq { position: absolute; inset: 0; background-size: cover; background-position: center; filter: blur(14px); transform: scale(1.06); }
.pm .bg-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; opacity: 0; transition: opacity .35s ease; user-select: none; }
.pm .bg-img.on { opacity: 1; }
.pm .bg-svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.pm .bg-svg path, .pm .bg-svg rect { vector-effect: non-scaling-stroke; }
.pm .bg-lab { fill: none; stroke: var(--pm-accent2); stroke-width: 1.5; stroke-dasharray: 6 6; opacity: .55; }
.pm .bg-cur { fill: none; stroke: var(--pm-link); stroke-width: 3; stroke-linecap: round; opacity: .95; stroke-dasharray: 10 8; animation: bgFlow 1.6s linear infinite; }
.pm .bg-glow { fill: none; stroke: var(--pm-surface); stroke-width: 7; stroke-linecap: round; opacity: .55; }
.pm .bg-rec { fill: none; stroke-width: 1.6; stroke-linecap: round; opacity: .45; stroke-dasharray: 4 6; }
.pm .bg-dot { fill: var(--pm-link); stroke: var(--pm-surface); stroke-width: 1.5; }
.pm .bg-zl { position: absolute; transform: translate(-50%, -50%); white-space: nowrap; font-size: 11px; font-weight: 700; padding: 1px 9px; border-radius: 999px; background: color-mix(in srgb, var(--pm-plate) 88%, transparent); color: var(--pm-plate-ink); border: 1px solid var(--pm-line); box-shadow: var(--pm-shadow); pointer-events: none; opacity: .92; }
.pm .bg-zl small { color: inherit; opacity: .7; }
.pm .bg-sl { position: absolute; transform: translate(-50%, -50%); display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; font: inherit; font-size: 12px; font-weight: 800; padding: 2px 10px 2px 3px; border-radius: 999px; background: var(--pm-plate); color: var(--pm-plate-ink); border: 2px solid var(--sc); box-shadow: var(--pm-shadow); cursor: pointer; z-index: 2; }
.pm .bg-sl i { font-style: normal; display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: var(--sc); color: var(--pm-accent-ink); font-size: 11px; }
.pm .bg-sl small { font-size: 10px; margin-left: 2px; color: inherit; opacity: .75; }
.pm .bg-sl.on, .pm .bg-sl:hover, .pm .bg-sl:focus-visible { background: var(--sc); color: var(--pm-accent-ink); outline: none; }
.pm .bg-ch { position: absolute; transform: translate(-50%, -100%); background: none; border: 0; padding: 0; cursor: pointer; line-height: 0; z-index: 1; filter: drop-shadow(0 2px 2px color-mix(in srgb, var(--pm-ink) 30%, transparent)); }
.pm .bg-ch > svg, .pm .bg-ch > .iso-av { width: clamp(30px, 4.6cqw, 72px) !important; height: clamp(30px, 4.6cqw, 72px) !important; }
.pm .bg-ch.bot > svg { width: clamp(26px, 3.6cqw, 56px) !important; height: clamp(26px, 3.6cqw, 56px) !important; }
.pm .bg-ch:focus-visible { outline: 3px solid var(--pm-accent2); border-radius: 8px; }
.pm .bg-ch.st-off { filter: grayscale(.85) brightness(.9); opacity: .85; }
.pm .bg-ch.st-working > svg, .pm .bg-ch.st-working > .iso-av { animation: isoBob 1.6s ease-in-out infinite; }
.pm .bg-nm { transform: translate(-50%, 3px); z-index: 1; }
.pm .bg-host .iso-chip { z-index: 3; }
.pm .bg-host .iso-pop { z-index: 10; }
@keyframes bgFlow { to { stroke-dashoffset: -36; } }
@media (prefers-reduced-motion: reduce) { .pm .bg-cur, .pm .bg-ch > svg, .pm .bg-ch > .iso-av { animation: none !important; } .pm .bg-img { transition: none; } }
`;
