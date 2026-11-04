// lib/pmSceneLayout.js — 배경 장면(BgScene) 배치 계산(순수 함수, 클라이언트·테스트 공용).
//   자리 배정 · 연결선 · 라벨칩 충돌회피(겹치면 곡선 따라 밀기 → 그래도 겹치면 접기, 같은 스테이션 향하면 묶음 "+N").
//   모든 상자는 장면 좌표(px, 폭 SW=1600) 기준. 화면 폭 hostW 에서 글자 px 크기를 장면 좌표로 환산(k = SW / hostW).
import { seatPoints } from './pmSceneMap';

export const SW = 1600;
export const DEPTS = ['영업지원', '영업부', '수입부', '경영지원', '현장팀'];
const arr = (x) => (Array.isArray(x) ? x : []);

// 글자 상자 크기(화면 px) — CSS(.bg-sl/.iso-nm/.iso-chip)와 맞춘 추정치
export const textW = (s, per = 12, pad = 24) => pad + [...String(s || '')].reduce((n, c) => n + (c.charCodeAt(0) > 255 ? per : per * 0.6), 0);
export const charPx = (hostW) => Math.max(30, Math.min(72, hostW * 0.046));
const hit = (a, b, gap = 2) => Math.abs(a.x - b.x) * 2 < a.w + b.w + gap * 2 && Math.abs(a.y - b.y) * 2 < a.h + b.h + gap * 2;
export const boxesOverlap = hit;

function quad(a, c, b, t) { const u = 1 - t; return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]; }

export function layoutScene({ map, rooms, agents, links, hostW = 1200, labelOf = (l) => l.text || '' }) {
  const SH = Math.round(SW / map.aspect);
  const k = SW / Math.max(320, hostW);
  const px = (p) => [(p[0] * SW) / 100, (p[1] * SH) / 100];
  const cp = charPx(hostW) * k; // 캐릭터 한 변(장면 좌표)

  const byDept = {};
  for (const r of arr(rooms)) {
    const d = DEPTS.includes(r.dept) ? r.dept : '현장팀';
    for (const s of arr(r.seats)) if (s && !s.empty) (byDept[d] = byDept[d] || []).push(s);
  }
  const seats = [];
  for (const d of DEPTS) {
    const list = byDept[d] || [];
    seatPoints(map, d, list.length).forEach((p, i) => seats.push({ p, dept: d, i, person: list[i] }));
  }
  seats.sort((a, b) => a.p[1] - b.p[1]);
  const robots = arr(agents).map((a, i) => {
    const R = map.robots; const base = R[i % R.length]; const lap = Math.floor(i / R.length);
    return { a, p: [base[0] + lap * 2.5, base[1] + lap * 2] };
  });

  // 고정 상자: 캐릭터(히트영역) · 이름표 · 스테이션칩
  // 자리끼리 캐릭터·이름표가 겹치면 지도 좌표 근처로 비켜 앉힘(지도 좌표 = 기본값)
  const stations = map.stations.map((p, i) => { const [x, y] = px(p); return { kind: 'station', no: i + 1, x, y, w: textW('9 거래처전달', 12, 40) * k, h: 26 * k }; });
  const fixed = [...stations];
  const NUDGE = [[0, 0]];
  for (let r = 2; r <= 14; r += 2) for (let a = 0; a < 8; a += 1) NUDGE.push([Math.round(r * Math.cos((a * Math.PI) / 4) * 10) / 10, Math.round(r * 0.8 * Math.sin((a * Math.PI) / 4) * 10) / 10]);
  for (const s of seats) {
    const mk = (p) => {
      const [x, y] = px(p);
      return [{ kind: 'char', name: s.person.name, x, y: y - cp / 2, w: cp * 0.9, h: cp },
        { kind: 'tag', name: s.person.name, x, y: y + (3 + 9) * k, w: Math.min(76, textW(s.person.name, 11, 22)) * k, h: 18 * k }];
    };
    let best = null;
    for (const [dx, dy] of NUDGE) {
      const p = [Math.min(97, Math.max(3, s.p[0] + dx)), Math.min(96, Math.max(6, s.p[1] + dy))];
      const [b, t] = mk(p);
      if (!fixed.some((o) => hit(o, b, 0) || hit(o, t, 0))) { best = { p, b, t }; break; }
    }
    if (!best) { const [b, t] = mk(s.p); best = { p: s.p, b, t }; }
    s.p = best.p; s.box = best.b; s.tag = best.t;
    fixed.push(s.box, s.tag);
  }

  const deskOf = new Map(seats.map((s) => [s.person.name, s]));
  const lines = [];
  for (const l of arr(links)) {
    const s = deskOf.get(l.name); const st = map.stations[(l.stage || 0) - 1];
    if (!s || !st) continue;
    const a = px([s.p[0], s.p[1]]); a[1] -= cp * 0.55;
    const b = px(st);
    const c = [(a[0] + b[0]) / 2, Math.min(a[1], b[1]) - 70];
    lines.push({ ...l, a, b, c, d: `M${a[0].toFixed(1)},${a[1].toFixed(1)} Q${c[0].toFixed(1)},${c[1].toFixed(1)} ${b[0].toFixed(1)},${b[1].toFixed(1)}` });
  }

  // 라벨칩: 지금 작업(current)만. 같은 스테이션 → 첫 사람 칩 + "+N"
  const groups = new Map();
  for (const l of lines.filter((x) => x.kind === 'current')) { const g = groups.get(l.stage) || []; g.push(l); groups.set(l.stage, g); }
  const chips = []; const placed = [...fixed];
  for (const [stage, g] of groups) {
    const lead = g[0]; const more = g.length - 1;
    const text = `${labelOf(lead)}${more > 0 ? ` +${more}` : ''}`;
    const w = Math.min(180, textW(text, 11, 20)) * k; const h = 20 * k;
    let spot = null;
    const ts = [0.5, 0.4, 0.6, 0.3, 0.7, 0.25, 0.75];
    for (const t of ts) {
      const m = quad(lead.a, lead.c, lead.b, t);
      for (const dy of [0, -24, 24, -48, 48]) {
        const box = { kind: 'chip', x: m[0], y: m[1] + dy * k, w, h };
        if (box.x - w / 2 < 0 || box.x + w / 2 > SW || box.y - h / 2 < 0 || box.y + h / 2 > SH) continue;
        if (!placed.some((o) => hit(o, box)) ) { spot = box; break; }
      }
      if (spot) break;
    }
    if (!spot) continue; // 둘 곳 없으면 접기(연결선·호버 팝오버로 확인)
    placed.push(spot);
    chips.push({ ...spot, key: `${lead.name}:${stage}`, name: lead.name, names: g.map((x) => x.name), text, stage });
  }
  return { SH, k, cp, seats, robots, lines, chips, stations };
}

// 책상 앵커(캐릭터 에이전트가 책상 소품·펫을 "책상 기준 상대좌표"로 얹을 때 쓰는 기준). 좌표 = 배경 %.
//   floor = 캐릭터 발(바닥) 기준점 = seats 좌표, desk = 책상 상판 기준점 = floor + map.deskOffset, facing = 캐릭터가 바라보는 방향(nw/ne/sw/se).
export function deskAnchor(map, dept, i) {
  const pts = seatPoints(map, dept, i + 1); const floor = pts[i];
  if (!floor) return null;
  const off = map.deskOffset || [2.5, -6];
  const facing = map.facing || 'ne';
  return { floor, desk: [floor[0] + off[0], floor[1] + off[1]], facing, seatAnchor: { x: floor[0], y: floor[1], dir: facing, scale: map.charScale || 1, z: floor[1] } };
}
