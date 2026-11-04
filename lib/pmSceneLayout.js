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

// 앉는 엉덩이 점(%) = 자리점 + sitOffset(기본 = deskOffset 보다 0.8% 위 = 책상 상판 뒤쪽)
export function hipOf(map, p) {
  const o = map.sitOffset || [(map.deskOffset || [2.5, -6])[0], (map.deskOffset || [2.5, -6])[1] - 0.8];
  return [p[0] + o[0], p[1] + o[1]];
}
// 책상 앞판 가림 마스크(%): 엉덩이 아래로 배경 그림을 다시 잘라 덮어 하반신을 책상 뒤로 숨긴다. frontMask = { w, h, dy }
export function maskPolyOf(map) {
  if (Array.isArray(map.maskPoly) && map.maskPoly.length >= 3) return map.maskPoly;
  const m = map.frontMask || {}; const w = m.w ?? 8; const h = m.h ?? 6; const dy = m.dy ?? 0.3;
  return [[-w / 2, dy], [w / 2, dy], [w / 2, dy + h], [-w / 2, dy + h]];
}
// 앞판 마스크 바깥 사각형(%) + 그 안 폴리곤(사각형 기준 %, CSS clip-path 용)
export function frontMaskRect(map, p) {
  const [hx, hy] = hipOf(map, p); const P = maskPolyOf(map);
  const xs = P.map((q) => q[0]); const ys = P.map((q) => q[1]);
  return [hx + Math.min(...xs), hy + Math.min(...ys), hx + Math.max(...xs), hy + Math.max(...ys)];
}
export function frontMaskClip(map) {
  const P = maskPolyOf(map); const xs = P.map((q) => q[0]); const ys = P.map((q) => q[1]);
  const x0 = Math.min(...xs); const y0 = Math.min(...ys); const w = Math.max(...xs) - x0 || 1; const h = Math.max(...ys) - y0 || 1;
  return `polygon(${P.map((q) => `${(((q[0] - x0) / w) * 100).toFixed(1)}% ${(((q[1] - y0) / h) * 100).toFixed(1)}%`).join(', ')})`;
}

export function layoutScene({ map, rooms, agents, links, hostW = 1200, labelOf = (l) => l.text || '' }) {
  const SH = Math.round(SW / map.aspect);
  const k = SW / Math.max(320, hostW);
  const px = (p) => [(p[0] * SW) / 100, (p[1] * SH) / 100];
  const cp = charPx(hostW) * k; // (구) 서있는 캐릭터 한 변(장면 좌표)
  const ds = map.deskScale || 0.3; // 자리 세트 배율(장면 좌표 px / 384 캔버스 px)
  const SEAT_UP = 68.3; // 책상 앵커 → 엉덩이(lib/pmDeskSlots seat.at)

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
  // 로봇: 연구실 사각형 안 2줄(많으면 3줄) 격자 — 겹침 없이
  const ag = arr(agents); const lab = map.lab;
  const rows = ag.length > 12 ? 3 : ag.length > 4 ? 2 : 1; const cols = Math.max(1, Math.ceil(ag.length / rows));
  const robots = ag.map((a, i) => {
    const r = Math.floor(i / cols); const c = i % cols; const inRow = Math.min(cols, ag.length - r * cols);
    const x = lab[0] + ((lab[2] - lab[0]) * (c + 0.5 + (cols - inRow) / 2)) / cols;
    const y = lab[1] + ((lab[3] - lab[1]) * (r + 0.75)) / (rows + 0.25);
    return { a, p: [x, y] };
  });

  // 고정 상자: 캐릭터(히트영역) · 이름표 · 스테이션칩
  // 자리끼리 캐릭터·이름표가 겹치면 지도 좌표 근처로 비켜 앉힘(지도 좌표 = 기본값)
  const stations = map.stations.map((p, i) => { const [x, y] = px(p); return { kind: 'station', no: i + 1, x, y, w: textW('9 거래처전달', 12, 40) * k, h: 26 * k }; });
  // 1) 캐릭터: 지도 자리(책상)에 그대로 앉힌다. 스테이션·다른 캐릭터와 겹칠 때만 3% 안에서 비켜 앉음
  const NUDGE = [[0, 0]];
  for (const r of [1, 2, 3]) for (let a = 0; a < 8; a += 1) NUDGE.push([Math.round(r * Math.cos((a * Math.PI) / 4) * 10) / 10, Math.round(r * 0.8 * Math.sin((a * Math.PI) / 4) * 10) / 10]);
  const maskBottom = Math.max(...maskPolyOf(map).map((q) => q[1]));
  const charBox = (p) => { const [x, y] = px(hipOf(map, p)); return { kind: 'char', name: '', x, y: y - 55 * ds, w: 80 * ds, h: 110 * ds }; };
  const chars = [];
  for (const s of seats) {
    let best = null;
    for (const [dx, dy] of NUDGE) {
      const p = [Math.min(97, Math.max(3, s.p[0] + dx)), Math.min(96, Math.max(6, s.p[1] + dy))];
      const b = charBox(p);
      if (!stations.some((o) => hit(o, b, 0)) && !chars.some((o) => hit(o, b, -6 * ds))) { best = { p, b }; break; }
    }
    if (!best) best = { p: s.p, b: charBox(s.p) };
    s.p = best.p; s.box = { ...best.b, name: s.person.name }; chars.push(s.box);
  }
  // 2) 이름표: 책상 아래 → 아래 왼/오 → 머리 위 → 옆 순으로 빈 곳
  const fixed = [...stations, ...chars];
  for (const s of seats) {
    const [hx, hy] = px(hipOf(map, s.p)); const mb = px([0, maskBottom])[1];
    const w = Math.min(76, textW(s.person.name, 11, 22)) * k; const h = 18 * k;
    const cands = [[0, mb + 10 * k], [-w * 0.7, mb + 10 * k], [w * 0.7, mb + 10 * k], [0, mb + 30 * k], [0, -120 * ds - 12 * k], [-(45 * ds + w / 2 + 4 * k), -20 * ds], [45 * ds + w / 2 + 4 * k, -20 * ds], [0, -120 * ds - 32 * k]];
    for (let r = 20; r <= 120; r += 14) for (let a = 0; a < 12; a += 1) cands.push([r * k * Math.cos((a * Math.PI) / 6) * 1.6, mb + r * k * Math.sin((a * Math.PI) / 6)]);
    let tag = null;
    for (const [dx, dy] of cands) { const t = { kind: 'tag', name: s.person.name, x: hx + dx, y: hy + dy, w, h }; if (!fixed.some((o) => hit(o, t, 0))) { tag = t; break; } }
    if (!tag) tag = { kind: 'tag', name: s.person.name, x: hx, y: hy + mb + 10 * k, w, h, forced: true };
    s.tag = tag; fixed.push(tag);
  }

  const deskOf = new Map(seats.map((s) => [s.person.name, s]));
  const lines = [];
  for (const l of arr(links)) {
    const s = deskOf.get(l.name); const st = map.stations[(l.stage || 0) - 1];
    if (!s || !st) continue;
    const a = px(hipOf(map, s.p)); a[1] -= 60 * ds;
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
  return { SH, k, cp, ds, seats, robots, lines, chips, stations };
}

// 책상 앵커(캐릭터 에이전트가 책상 소품·펫을 "책상 기준 상대좌표"로 얹을 때 쓰는 기준). 좌표 = 배경 %.
// 뒷모습 금지(사장님): 장면 캐릭터는 항상 정면 3/4(얼굴 보임). 방향은 좌/우 반전만 — nw/ne/back/up 등은 좌우로 접는다.
export function frontDir(dir) { const d = String(dir || '').toLowerCase(); return d === 'right' || d.endsWith('e') ? 'right' : 'left'; }
//   floor = 캐릭터 발(바닥) 기준점 = seats 좌표, desk = 책상 상판 기준점 = floor + map.deskOffset, facing = 캐릭터가 바라보는 방향(nw/ne/sw/se).
export function deskAnchor(map, dept, i) {
  const pts = seatPoints(map, dept, i + 1); const floor = pts[i];
  if (!floor) return null;
  const off = map.deskOffset || [2.5, -6];
  const facing = map.facing || 'ne';
  return { floor, desk: [floor[0] + off[0], floor[1] + off[1]], facing, seatAnchor: { x: floor[0], y: floor[1], dir: frontDir(facing), scale: map.charScale || 1, z: floor[1] } };
}
