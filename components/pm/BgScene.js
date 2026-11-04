// components/pm/BgScene.js
// /pm 사무실 "배경 일러스트 장면" — Gemini 로 만든 글자·사람 없는 테마 배경(public/pm/scene-bg/{id}.webp)을 깔고
//   그 위에 실시간 요소만 HTML/SVG 로 겹친다: 9단계 스테이션 칩 · 직원 캐릭터 · 이름표 · 직원→작업 스테이션 곡선 + 라벨칩 · 연구실 로봇.
//   좌표는 lib/pmSceneMaps.json(배경 기준 %), 배치·충돌회피는 lib/pmSceneLayout.js. 배경 없는 테마/로드 실패는 IsoScene(SVG) 폴백.
//   클릭: 이름표·라벨칩은 pointer-events:none, 캐릭터(넉넉한 원형 히트영역)가 최상위에서 받는다.
//   확대·축소: +/−/맞춤 버튼만(휠·핀치 없음 — 휠은 페이지 스크롤), 확대 상태에서 드래그 이동, 장면 포커스 시 키보드(+ − 0 화살표). 글자는 배율 역보정.
//   캐릭터 그림은 Chibi/Avatar(props 인터페이스)만 사용 — 내부는 캐릭터 담당 브랜치 소관.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { usePmTheme } from './PmTheme';
import { Chibi, Hot, STATUS_LABEL, ScenePopBody, chipLabel } from './IsoScene';
import { Button } from './ui';
import { STAGE_COLOR } from '../../lib/pmThemes';
import { STAGES } from '../../lib/pmStages';
import { sceneMapFor } from '../../lib/pmSceneMap';
import { DEPTS, SW, frontMaskClip, frontMaskRect, frontDir, hipOf, layoutScene } from '../../lib/pmSceneLayout';
import { ZOOM_MIN, ZOOM_MAX, clampView, zoomViewAt, shouldCloseOnUp } from '../../lib/pmZoom';
import { sceneAvatar, themeKit, themeOutfits } from '../../lib/pmThemeKit';
import { DeskDecor, SeatedCharacter, usePmLayers } from './Character';
import { PM_DESK_ISO_SCALE, isoDeskTop } from '../../lib/pmDeskSlots';
import { useGrow } from './grow/Grow';
import SkillFx, { FX_CSS } from './SkillFx';
import { mountById } from '../../lib/pmMounts';

const arr = (x) => (Array.isArray(x) ? x : []);

// 춤 자동 재생 이벤트: 정원(개인 성장) 단계 승급 · 직원 요청 '배포됨' · 오늘 목표(하루 상한) 달성. 첫 로드는 기준만 잡고 춤추지 않음.
export function danceEvents(prev, growV, requests) {
  const out = {}; const next = { stage: {}, cap: {}, req: {} };
  for (const g of arr(growV?.people)) {
    next.stage[g.name] = g.stage; const capHit = (g.today?.points || 0) >= (g.today?.cap || 60); next.cap[g.name] = capHit;
    if (prev && prev.stage[g.name] != null && g.stage > prev.stage[g.name]) out[g.name] = 'cheer';
    else if (prev && capHit && prev.cap[g.name] === false) out[g.name] = 'jump';
  }
  for (const r of arr(requests)) {
    next.req[r.id] = r.status;
    if (prev && prev.req[r.id] && prev.req[r.id] !== 'deployed' && r.status === 'deployed' && r.byName) out[r.byName] = 'spin';
  }
  return { out, next };
}
function useSceneDances(growV) {
  const [dances, setDances] = useState({});
  const [reqs, setReqs] = useState(null);
  const prev = useRef(null);
  useEffect(() => {
    let alive = true;
    const load = () => fetch('/api/pm/staff-requests', { cache: 'no-store' }).then((r) => r.json()).then((j) => { if (alive && j.success) setReqs(j.requests || []); }).catch(() => {});
    load(); const t = setInterval(load, 60000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  useEffect(() => {
    if (!growV) return undefined;
    const { out, next } = danceEvents(prev.current, growV, reqs);
    prev.current = next;
    if (!Object.keys(out).length) return undefined;
    setDances(out);
    const t = setTimeout(() => setDances({}), 2800);
    return () => clearTimeout(t);
  }, [growV, reqs]);
  return dances;
}
const ZMIN = ZOOM_MIN; const ZMAX = ZOOM_MAX;

export default function BgScene({ themeId, agents, rooms, links, corridor, now, selStage, onPickStage, onOpenPerson, reduced, isAdmin, myStaff, fallback = null }) {
  const { avatars, manifest } = usePmTheme();
  const kit = useMemo(() => themeKit(manifest, themeId), [manifest, themeId]);
  const tOutfits = useMemo(() => themeOutfits(manifest, themeId), [manifest, themeId]);
  const { view: growV } = useGrow() || {};
  const growPeople = useMemo(() => Object.fromEntries(arr(growV?.people).map((g) => [g.name, g])), [growV]);
  const vibes = growV?.vibes || {};
  const dances = useSceneDances(growV);
  const L2 = usePmLayers();
  const map = sceneMapFor(themeId);
  const hostRef = useRef(null);
  const imgRef = useRef(null);
  const [hostW, setHostW] = useState(1200);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pop, setPop] = useState(null);
  const [zv, setZv] = useState({ z: 1, x: 0, y: 0 });
  useLayoutEffect(() => {
    const el = hostRef.current; if (!el) return undefined;
    const f = () => setHostW(el.clientWidth || 1200);
    f();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(f) : null;
    if (ro) ro.observe(el);
    return () => ro && ro.disconnect();
  }, []);
  useEffect(() => {
    setFailed(false); setZv({ z: 1, x: 0, y: 0 });
    const im = imgRef.current; // SSR 로 이미 받은 이미지는 onLoad 가 hydration 전에 끝나 있을 수 있음
    setLoaded(!!(im && im.complete && im.naturalWidth > 0));
    if (im && im.complete && im.naturalWidth === 0 && im.src) setFailed(true);
  }, [themeId]);
  useEffect(() => {
    if (!pop?.pinned) return undefined;
    const esc = (e) => { if (e.key === 'Escape') setPop(null); };
    window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc);
  }, [pop]);

  const hostH = hostW / map.aspect;
  const clampV = (v) => clampView(v, hostW, hostH);
  const zoomAt = (factor, cx = hostW / 2, cy = hostH / 2) => setZv((v) => zoomViewAt(v, factor, hostW, hostH, cx, cy));
  const fit = () => setZv({ z: 1, x: 0, y: 0 });
    // 휠은 페이지 스크롤 그대로(장면 배율 불변). 배율은 +/−/맞춤 버튼·키보드(장면 포커스 시)로만.
  const ptrs = useRef(new Map()); const drag = useRef(null);
  const onPointerDown = (e) => {
    if (e.target.closest && e.target.closest('[role="button"],button,.iso-pop')) return;
    ptrs.current.set(e.pointerId, [e.clientX, e.clientY]);
    drag.current = { x: e.clientX, y: e.clientY, v: zv, d0: null, moved: false };
  };
  const onPointerMove = (e) => {
    const D = drag.current; if (!D || !ptrs.current.has(e.pointerId)) return;
    ptrs.current.set(e.pointerId, [e.clientX, e.clientY]);
    const dx = e.clientX - D.x; const dy = e.clientY - D.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) D.moved = true;
    if (D.v.z > 1 && D.moved) setZv(clampV({ ...D.v, x: D.v.x + dx, y: D.v.y + dy }));
  };
  const onPointerUp = (e) => {
    ptrs.current.delete(e.pointerId);
    if (!ptrs.current.size) { const d0 = drag.current; drag.current = null; if (shouldCloseOnUp(d0)) setPop((cur) => (cur?.pinned ? null : cur)); }
  };
  const onKey = (e) => {
    if (e.target !== e.currentTarget) return;
    const step = 40;
    const act = {
      '+': () => zoomAt(1.25), '=': () => zoomAt(1.25), '-': () => zoomAt(0.8), 0: fit,
      ArrowLeft: () => setZv((v) => clampV({ ...v, x: v.x + step })), ArrowRight: () => setZv((v) => clampV({ ...v, x: v.x - step })),
      ArrowUp: () => setZv((v) => clampV({ ...v, y: v.y + step })), ArrowDown: () => setZv((v) => clampV({ ...v, y: v.y - step })),
    }[e.key];
    if (act && (zv.z > 1 || !e.key.startsWith('Arrow'))) { e.preventDefault(); act(); }
  };

  // 글자는 배율 역보정 → 충돌 계산은 "화면 폭 × 배율" 기준
  const L = useMemo(() => layoutScene({ map, rooms, agents, links, hostW: hostW * zv.z, labelOf: chipLabel }), [map, rooms, agents, links, hostW, zv.z]);
  const { SH, k } = L;
  const maskClip = frontMaskClip(map);

  const stageInfo = (no) => {
    const st = corridor?.stages?.find((x) => x.no === no);
    const nowNames = [...new Set(arr(links).filter((l) => l.stage === no && l.kind !== 'today').map((l) => l.name))];
    return { h: st?.h, nowNames };
  };
  const hover = (p) => setPop((cur) => (cur?.pinned ? cur : p));
  const leave = () => setPop((cur) => (cur?.pinned ? cur : null));
  const pin = (p) => setPop((cur) => (cur?.pinned && cur.key === p.key ? null : { ...p, pinned: true }));
  const pct = (x, y) => ({ left: `${(x / SW) * 100}%`, top: `${(y / SH) * 100}%` });
  const at = (p) => [(p[0] * SW) / 100, (p[1] * SH) / 100];
  const popLeft = pop ? Math.min(SW - 130 * k, Math.max(130 * k, pop.x)) : 0;

  const lab = map.lab;
  const fieldEmpty = !L.seats.some((s) => s.dept === '현장팀');
  const zoneLabels = DEPTS.map((d) => {
    const P = map.seats[d] || []; if (!P.length) return null;
    const n = L.seats.filter((s) => s.dept === d).length;
    const top = P.reduce((m, p) => (p[1] < m[1] ? p : m), P[0]);
    return { d, n, x: top[0], y: Math.max(3, top[1] - 13) };
  }).filter(Boolean);

  if (failed && fallback) return fallback;
  return (
    <div className="bg-wrap">
      <div className={`bg-host ${zv.z > 1 ? 'zoomed' : ''}`} ref={hostRef} data-scene-bg={themeId} style={{ aspectRatio: `${map.aspect}` }} tabIndex={0}
        aria-label="사무실 장면 — + − 확대·축소, 0 맞춤, 확대 시 화살표로 이동" onKeyDown={onKey}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <div className="bg-zoom" style={{ transform: `translate(${zv.x}px, ${zv.y}px) scale(${zv.z})`, '--iz': 1 / zv.z }}>
          <div className="bg-lq" style={{ backgroundImage: `url(/pm/scene-bg/${map.src}-lq.webp)` }} aria-hidden />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={imgRef} className={`bg-img ${loaded ? 'on' : ''}`} src={`/pm/scene-bg/${map.src}.webp`} alt="" aria-hidden onLoad={() => setLoaded(true)} onError={() => setFailed(true)} draggable={false} />
          <svg className="bg-svg" viewBox={`0 0 ${SW} ${SH}`} role="group" aria-label="직원→지금 작업 단계 연결선">
            <rect className="bg-lab" x={(lab[0] * SW) / 100} y={(lab[1] * SH) / 100} width={((lab[2] - lab[0]) * SW) / 100} height={((lab[3] - lab[1]) * SH) / 100} rx="18" />
            {L.lines.map((l, i) => {
              const cur = l.kind === 'current'; const id = `bgl-${i}`;
              return (
                <g key={id} className={`bg-ln ${cur ? 'cur' : 'rec'}`} data-flow={`${l.name}:${l.stage}:${l.kind}`}>
                  {cur && <path d={l.d} className="bg-glow" />}
                  <path id={id} d={l.d} className={cur ? 'bg-cur' : 'bg-rec'} style={cur ? undefined : { stroke: STAGE_COLOR[l.stage] }} />
                  {cur && !reduced && <circle r="5" className="bg-dot"><animateMotion dur="2.8s" repeatCount="indefinite"><mpath href={`#${id}`} /></animateMotion></circle>}
                </g>
              );
            })}
            <SkillFx lines={L.lines} dances={dances} avatars={avatars} reduced={reduced} />
          </svg>

          <div className="bg-zl lab" style={{ left: `${(lab[0] + lab[2]) / 2}%`, top: `${lab[1] + 2}%` }}>AI 연구실 <small>{arr(agents).length}</small></div>
          {zoneLabels.map((z) => (
            <div key={z.d} className="bg-zl" style={{ left: `${z.x}%`, top: `${z.y}%` }}>{z.d}{z.d === '현장팀' && fieldEmpty ? <small> · PC 없음</small> : <small> {z.n}</small>}</div>
          ))}

          {L.stations.map((st) => {
            const s = STAGES[st.no - 1];
            const h = corridor?.stages?.find((q) => q.no === s.no)?.h;
            const pp = { kind: 'station', key: `st${s.no}`, no: s.no, x: st.x, y: st.y - 18 * k };
            return (
              <Hot key={s.no} className={`bg-sl ${selStage === s.no ? 'on' : ''}`} data-stage={s.no} style={{ ...pct(st.x, st.y), '--sc': STAGE_COLOR[s.no] }} aria-label={`${s.no}단계 ${s.label} 스테이션`}
                onClick={(e) => { e.stopPropagation(); pin(pp); }} onMouseEnter={() => hover(pp)} onFocus={() => hover(pp)} onMouseLeave={leave}>
                <i>{s.no}</i>{s.label}{h != null && h > 0 ? <small>{h}h</small> : null}
              </Hot>
            );
          })}

          {L.seats.map(({ tag, person: x }) => {
            const st = STATUS_LABEL[x.status] ? x.status : 'off';
            return <div key={`t:${x.name}`} className={`iso-nm bg-nm st-${st}`} data-tag={x.name} style={pct(tag.x, tag.y)} aria-hidden><i />{x.name}</div>;
          })}
          {L.chips.map((c) => (
            <div key={c.key} className="iso-chip bg-chip" data-chip={c.key} style={{ ...pct(c.x, c.y), maxWidth: 180 }} aria-hidden>{c.text}</div>
          ))}

          {L.robots.map(({ a, p }) => {
            const [x, y] = at(p); const st = STATUS_LABEL[a.status] ? a.status : 'off'; const key = `a:${a.id || a.name}`;
            const pp = { kind: 'agent', key, a, x, y: y - 50 * k };
            return (
              <Hot key={key} className={`bg-ch bot st-${st}`} style={pct(x, y)} aria-label={`${a.name || a.id} ${STATUS_LABEL[st]}`} title={a.name || a.id}
                onMouseEnter={() => hover(pp)} onMouseLeave={leave} onFocus={() => hover(pp)} onClick={(e) => { e.stopPropagation(); pin(pp); }}>
                <Chibi name={a.name} robot status={st} size={40} />
                {st === 'error' && <span className="iso-bang" aria-hidden>!</span>}
              </Hot>
            );
          })}
          {/* 앉은 캐릭터 + 자리 꾸밈(캐릭터 v2). z: 러그·의자 < 캐릭터(하반신 숨김) < 책상 스킨·상판 < 펫. 앞쪽(y 큰) 자리가 위 */}
          {/* 앉은 캐릭터(캐릭터 v2) + 책상 앞판 마스크(배경 그림을 같은 자리에서 다시 잘라 덮음 → 하반신이 배경 책상 뒤로).
              책상 스킨·러그·의자는 3/4 스프라이트 준비 전까지 장면에서 숨김(상점·직원상세에만). 상판 소품·펫만 작은 아이콘. */}
          {L.seats.map(({ p, person: x }) => {
            const [hx, hy] = hipOf(map, p).map((v, i) => (v / 100) * (i ? hostH : hostW)); const sc = (L.ds * hostW) / SW;
            const [m0, m1, m2, m3] = frontMaskRect(map, p).map((v, i) => (v / 100) * (i % 2 ? hostH : hostW));
            const st = STATUS_LABEL[x.status] ? x.status : 'off';
            const z = 20 + Math.round(p[1] * 4);
            const seat = { x: hx, y: hy, dir: frontDir(map.dir), scale: sc, z };
            const cfg = sceneAvatar(avatars[x.name], x.name, kit, tOutfits);
            const g = growPeople[x.name]; const v = vibes[x.name] || {};
            const ownDesk = (avatars[x.name]?.view || avatars[x.name])?.items?.desk || '';
            const isoOn = L2?.iso && (ownDesk || (avatars[x.name] && (cfg.items.deskM || cfg.items.deskL || cfg.items.deskR || cfg.items.pet)));
            const dt = isoDeskTop([m0, m1, m2, m3]); const isoSc = ((PM_DESK_ISO_SCALE[themeId] || 0.8) * hostW) / SW;
            const isoCfg = { ...cfg, items: { ...cfg.items, desk: ownDesk && L2?.iso?.items?.[ownDesk] ? ownDesk : '' } };
            return (
              <div key={`s:${x.name}`} className={`bg-seat st-${st}`} data-seat={x.name} aria-hidden>
                <SeatedCharacter cfg={cfg} seat={seat} hideBelowHip={false} state={st} stage={g?.stage || 1} vibe={st === 'off' ? 'doze' : (v.vibe || '')} emote={st === 'off' ? 'zzz' : (v.emote || '')} dance={dances[x.name] || ''} />
                {loaded && !isoCfg.items.desk && <i className="bg-mask" style={{ left: m0, top: m1, width: m2 - m0, height: m3 - m1, zIndex: z + 2, backgroundImage: `url(/pm/scene-bg/${map.src}.webp)`, backgroundSize: `${hostW}px ${hostH}px`, backgroundPosition: `${-m0}px ${-m1}px`, clipPath: maskClip }} />}
                {(() => { const m = st !== 'off' && mountById((avatars[x.name]?.view || avatars[x.name])?.items?.mount); return m ? <i className="bg-mount" title={m.name} style={{ left: hx + 34 * sc, top: hy + 10 * sc, zIndex: z + 3 }}>{m.emoji}</i> : null; })()}
                {isoOn && dt && <DeskDecor view="iso" cfg={isoCfg} anchor={{ x: dt[0], y: dt[1] }} scale={isoSc} dir={map.deskDir === 'right' ? 'right' : 'left'} z={z} showDesk={!!isoCfg.items.desk} />}
              </div>
            );
          })}
          {L.seats.map(({ p, person: x }) => {
            const [cx, cy] = at(p); const st = STATUS_LABEL[x.status] ? x.status : 'off'; const key = `p:${x.name}`;
            const pp = { kind: 'staff', key, x0: x, x: at(hipOf(map, p))[0], y: at(hipOf(map, p))[1] - 125 * L.ds };
            const hp = at(hipOf(map, p)); const hb = { left: `${(hp[0] / SW) * 100}%`, top: `${((hp[1] - 55 * L.ds) / SH) * 100}%`, width: `${(120 * L.ds / SW) * 100}%`, height: `${(130 * L.ds / SH) * 100}%` };
            return (
              <Hot key={key} className={`bg-hit st-${st}`} data-desk={x.name} style={hb} aria-label={`${x.name} ${STATUS_LABEL[st]} 자세히`}
                onMouseEnter={() => hover(pp)} onMouseLeave={leave} onFocus={() => hover(pp)} onClick={(e) => { e.stopPropagation(); pin(pp); }} />
            );
          })}

          {pop && (
            <div className={`iso-pop ${pop.pinned ? 'pinned' : ''}`} role={pop.pinned ? 'dialog' : 'tooltip'} style={pct(popLeft, Math.max(150 * k, pop.y))}
              onMouseEnter={() => pop && !pop.pinned && setPop({ ...pop, pinned: true })} onClick={(e) => e.stopPropagation()}>
              <ScenePopBody pop={pop} close={() => setPop(null)} stageInfo={stageInfo} now={now} selStage={selStage} onPickStage={onPickStage} onOpenPerson={onOpenPerson} isAdmin={isAdmin} myStaff={myStaff} />
            </div>
          )}
        </div>
      </div>
      <div className="bg-legend" aria-label="상태 범례"><span><i className="w" />작업중</span><span><i className="d" />대기(z)</span><span><i className="o" />PC 꺼짐(흐린 색)</span></div>
      <div className="bg-zbar" role="group" aria-label="장면 확대·축소">
        <Button size="sm" aria-label="확대" onClick={() => zoomAt(1.25)} disabled={zv.z >= ZMAX}>+</Button>
        <Button size="sm" aria-label="축소" onClick={() => zoomAt(0.8)} disabled={zv.z <= ZMIN}>−</Button>
        <Button size="sm" onClick={fit} disabled={zv.z === 1}>맞춤</Button>
        <small aria-live="polite">{Math.round(zv.z * 100)}%</small>
      </div>
    </div>
  );
}

// 배경 장면 CSS — 색은 전부 토큰. ISO_CSS(.iso-nm·.iso-chip·.iso-pop 등)와 함께 쓰인다.
export const BG_CSS = `${FX_CSS}
.pm .bg-wrap { position: relative; }
.pm .bg-host { position: relative; width: 100%; overflow: hidden; border-radius: calc(var(--pm-radius) + 4px); container-type: inline-size; background: var(--pm-surface2); touch-action: pan-y; outline: none; }
.pm .bg-host.zoomed { cursor: grab; touch-action: none; }
.pm .bg-host:focus-visible { outline: 3px solid var(--pm-accent2); outline-offset: 2px; }
.pm .bg-zoom { position: absolute; inset: 0; transform-origin: 0 0; }
.pm .bg-zbar { position: absolute; right: 10px; bottom: 10px; z-index: 20; display: flex; gap: 4px; align-items: center; padding: 4px 6px; border-radius: 999px; background: color-mix(in srgb, var(--pm-surface) 90%, transparent); border: 1px solid var(--pm-line); box-shadow: var(--pm-shadow); }
.pm .bg-zbar small { min-width: 38px; text-align: center; color: var(--pm-ink); }
.pm .bg-lq { position: absolute; inset: 0; background-size: cover; background-position: center; filter: blur(14px); transform: scale(1.06); }
.pm .bg-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; opacity: 0; transition: opacity .35s ease; user-select: none; -webkit-user-drag: none; }
.pm .bg-img.on { opacity: 1; }
.pm .bg-svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.pm .bg-svg path, .pm .bg-svg rect { vector-effect: non-scaling-stroke; }
.pm .bg-lab { fill: none; stroke: var(--pm-accent2); stroke-width: 1.5; stroke-dasharray: 6 6; opacity: .55; }
.pm .bg-cur { fill: none; stroke: var(--pm-link); stroke-width: 3; stroke-linecap: round; opacity: .95; stroke-dasharray: 10 8; animation: bgFlow 1.6s linear infinite; }
.pm .bg-glow { fill: none; stroke: var(--pm-surface); stroke-width: 7; stroke-linecap: round; opacity: .55; }
.pm .bg-rec { fill: none; stroke-width: 1.6; stroke-linecap: round; opacity: .45; stroke-dasharray: 4 6; }
.pm .bg-dot { fill: var(--pm-link); stroke: var(--pm-surface); stroke-width: 1.5; }
.pm .bg-zl { position: absolute; transform: translate(-50%, -50%) scale(var(--iz, 1)); white-space: nowrap; font-size: 11px; font-weight: 700; padding: 1px 9px; border-radius: 999px; background: color-mix(in srgb, var(--pm-plate) 88%, transparent); color: var(--pm-plate-ink); border: 1px solid var(--pm-line); box-shadow: var(--pm-shadow); pointer-events: none; opacity: .92; z-index: 2; }
.pm .bg-zl small { color: inherit; opacity: .7; }
.pm .bg-sl { position: absolute; transform: translate(-50%, -50%) scale(var(--iz, 1)); display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; font: inherit; font-size: 12px; font-weight: 800; padding: 2px 10px 2px 3px; border-radius: 999px; background: color-mix(in srgb, var(--sc) 16%, var(--pm-plate)); color: var(--pm-plate-ink); border: 1.5px solid color-mix(in srgb, var(--sc) 55%, var(--pm-plate)); box-shadow: 0 3px 8px color-mix(in srgb, var(--pm-ink) 14%, transparent), 0 1px 2px color-mix(in srgb, var(--pm-ink) 10%, transparent); cursor: pointer; z-index: 3; }
.pm .bg-sl i { font-style: normal; display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: var(--sc); color: var(--pm-accent-ink); font-size: 11px; }
.pm .bg-sl small { font-size: 10px; margin-left: 2px; color: inherit; opacity: .75; }
.pm .bg-sl.on, .pm .bg-sl:hover, .pm .bg-sl:focus-visible { background: var(--sc); color: var(--pm-accent-ink); outline: none; }
.pm .bg-host .iso-nm, .pm .bg-host .iso-chip, .pm .bg-zl { box-shadow: 0 3px 8px color-mix(in srgb, var(--pm-ink) 14%, transparent), 0 1px 2px color-mix(in srgb, var(--pm-ink) 10%, transparent); border-width: 1px; }
.pm .bg-host .iso-chip { background: color-mix(in srgb, var(--pm-link) 82%, var(--pm-surface)); }
.pm .bg-nm { transform: translate(-50%, -50%) scale(var(--iz, 1)); transform-origin: 50% 50%; z-index: 4; pointer-events: none; }
.pm .bg-chip { transform: translate(-50%, -50%) scale(var(--iz, 1)); pointer-events: none; cursor: default; z-index: 5; }
.pm .bg-ch { position: absolute; transform: translate(-50%, -100%); background: none; border: 0; padding: 0; cursor: pointer; line-height: 0; z-index: 8; filter: drop-shadow(0 2px 2px color-mix(in srgb, var(--pm-ink) 30%, transparent)); }
.pm .bg-ch::before { content: ''; position: absolute; left: 50%; top: 55%; width: 130%; aspect-ratio: 1; transform: translate(-50%, -50%); border-radius: 50%; }
.pm .bg-ch > svg, .pm .bg-ch > .iso-av { position: relative; width: clamp(30px, 4.6cqw, 72px) !important; height: clamp(30px, 4.6cqw, 72px) !important; }
.pm .bg-ch.bot > svg { width: clamp(26px, 3.6cqw, 56px) !important; height: clamp(26px, 3.6cqw, 56px) !important; }
.pm .bg-ch:hover > svg, .pm .bg-ch:hover > .iso-av { filter: drop-shadow(0 0 4px var(--pm-accent)); }
.pm .bg-ch:focus-visible { outline: 3px solid var(--pm-accent2); border-radius: 8px; }
.pm .bg-ch.st-off { filter: saturate(.45) drop-shadow(0 2px 2px color-mix(in srgb, var(--pm-ink) 25%, transparent)); }
.pm .bg-legend { position: absolute; left: 10px; bottom: 10px; z-index: 20; display: flex; gap: 10px; align-items: center; padding: 4px 10px; border-radius: 999px; font-size: 11px; color: var(--pm-ink); background: color-mix(in srgb, var(--pm-surface) 90%, transparent); border: 1px solid var(--pm-line); box-shadow: var(--pm-shadow); }
.pm .bg-legend i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; vertical-align: middle; }
.pm .bg-legend .w { background: var(--pm-ok); } .pm .bg-legend .d { background: var(--pm-idle); } .pm .bg-legend .o { background: var(--pm-off-ink); }
.pm .bg-ch.st-working > svg, .pm .bg-ch.st-working > .iso-av { animation: isoBob 1.6s ease-in-out infinite; }
.pm .bg-host .iso-pop { z-index: 12; transform: translate(-50%, -100%) scale(var(--iz, 1)); transform-origin: 50% 100%; }
.pm .bg-seat { position: absolute; inset: 0; pointer-events: none; }
.pm .bg-seat img { pointer-events: none; user-select: none; }
.pm .bg-mask { position: absolute; display: block; pointer-events: none; background-repeat: no-repeat; }
.pm .bg-ico { position: absolute; transform: translateX(-50%); object-fit: contain; filter: drop-shadow(0 1px 1px color-mix(in srgb, var(--pm-ink) 25%, transparent)); }
.pm .bg-rugband { position: absolute; transform: translate(-50%, -50%); border-radius: 50%; background: radial-gradient(closest-side, color-mix(in srgb, var(--pm-accent) 30%, transparent), transparent); pointer-events: none; }
.pm .bg-seat.st-off { filter: saturate(.55); }
.pm .bg-hit { position: absolute; transform: translate(-50%, -50%); border-radius: 50%; cursor: pointer; z-index: 900; outline: none; }
.pm .bg-hit:focus-visible { outline: 3px solid var(--pm-accent2); }
.pm .bg-host .bg-nm { z-index: 700; } .pm .bg-host .bg-chip { z-index: 750; } .pm .bg-host .bg-sl { z-index: 800; } .pm .bg-host .bg-zl { z-index: 650; }
.pm .bg-host .bg-ch.bot { z-index: 600; }
.pm .bg-host .iso-pop { z-index: 1000 !important; }
@keyframes bgFlow { to { stroke-dashoffset: -36; } }
@media (prefers-reduced-motion: reduce) { .pm .bg-cur, .pm .bg-ch > svg, .pm .bg-ch > .iso-av { animation: none !important; } .pm .bg-img { transition: none; } }
`;
