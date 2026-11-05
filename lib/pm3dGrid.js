// lib/pm3dGrid.js — /pm 3D(베타) "무한 확장 섬 세계" 격자 배치 엔진(순수 함수, 테스트: __tests__/pm3dGrid.test.js)
// 규칙(확정 기획):
//   · 섬 1개 = 24×24 칸(칸 = CELL m). 직원이 늘면 섬을 동서남북 인접 자리에 추가하고 나무다리(2칸 폭)로 잇는다.
//   · 직원 자리 = 파라솔+책상, 기본 2×2칸(평수 3×3 가능). 칸 단위 이동·4방향 바라보기(facing).
//   · 두 물체가 같은 칸을 쓰지 못한다(점유 충돌 검사). 걷기 가능 = 섬 땅(모래·보드워크·광장)·다리 중 비점유 칸.
//   · 1호 섬 중앙 = 광장(스테이션 1~9·수정구 허브가 서는 곳, 광장 전체를 한 덩어리로 예약). 시설 존은 부지 예약 칸만.
// 좌표: 전역 칸 (X, Z). 1호 섬은 X,Z ∈ [-12, 11] → 칸 경계 0 이 월드 원점. 칸 (X,Z) 의 월드 범위 = [X·CELL, (X+1)·CELL).
//   다른 모듈(pm3dLayout/Ride/Hub)과 같은 월드 미터, 카메라는 (+x,+z) 쪽.

export const CELL = 1.2;          // 칸 크기(m). 자리 2칸 = 2.4m = 기존 책상 간격(DESK_DX)과 같음
export const ISLAND_N = 24;       // 섬 한 변 칸 수
export const ISLAND_GAP = 4;      // 섬 사이 바다 칸 수(= 다리 길이)
export const PITCH = ISLAND_N + ISLAND_GAP;
export const HALF = ISLAND_N / 2;
export const BRIDGE_W = 2;        // 다리 폭(칸)
export const SEAT_SIZE = 2;       // 기본 자리 크기(2×2)
export const SEAT_SIZES = Object.freeze([2, 3]);
export const MAX_ISLANDS = 25;

// 1호 섬(허브 섬) 로컬 칸 구역(c=열 0..23 서→동, r=행 0..23 북→남)
export const PLAZA = Object.freeze({ c0: 2, r0: 10, c1: 21, r1: 13 });   // 광장(z ∈ [-2.4, 2.4], 스테이션 줄 z=0·복도 z=±2 포함)
export const FACILITIES = Object.freeze([
  Object.freeze({ kind: 'pool', label: '수영장', c0: 16, r0: 1, c1: 21, r1: 5 }),
  Object.freeze({ kind: 'kart', label: '카트트랙', c0: 16, r0: 18, c1: 21, r1: 22 }),
  Object.freeze({ kind: 'airfield', label: '비행장', c0: 2, r0: 18, c1: 9, r1: 22 }),
]);
// 2×2 자리 줄(행 시작). 허브 섬은 광장에 가까운 줄부터 북·남 번갈아, 일반 섬은 3행 주기(사이 행 = 통로).
export const HUB_BANDS = Object.freeze([7, 15, 4, 18, 2, 20]);
export const BANDS = Object.freeze([2, 5, 8, 11, 14, 17, 20]);
const HUB_WALK_ROWS = [6, 9, 14, 17];
const WALK_ROWS = [4, 7, 10, 13, 16, 19];
const LOT_MIN = 2; const LOT_MAX = ISLAND_N - 3; // 자리 가능 열/행 2..21 (0=해변 끝, 1=둘레 보드워크)

// 바라보는 방향: three.js rotation.y(정면 +Z 기준)
export const FACINGS = Object.freeze(['S', 'E', 'N', 'W']);
export const FACING_YAW = Object.freeze({ S: 0, E: Math.PI / 2, N: Math.PI, W: -Math.PI / 2 });
const FACING_VEC = { S: [0, 1], E: [1, 0], N: [0, -1], W: [-1, 0] };
const CAM = [Math.SQRT1_2, Math.SQRT1_2]; // 장면→카메라(pm3dLayout.CAM_DIR 와 같음)
export function rotateFacing(f, turns = 1) {
  const i = FACINGS.indexOf(f); if (i < 0) return 'S';
  return FACINGS[(((i + turns) % 4) + 4) % 4];
}
export function camVisible(f) { const v = FACING_VEC[f]; return !!v && v[0] * CAM[0] + v[1] * CAM[1] > 0; }

export const key = (X, Z) => `${X},${Z}`;
export function cellCenter(X, Z) { return { x: (X + 0.5) * CELL, z: (Z + 0.5) * CELL }; }
export function worldToCell(x, z) { return { X: Math.floor(x / CELL), Z: Math.floor(z / CELL) }; }

// ── 섬 배치 순서: 1호(0,0) → 맨해튼 거리 1의 동·서·남·북 → 거리 2 … (항상 기존 섬과 동서남북으로 붙음, 나선 아님) ──
export function islandSlots(n) {
  const out = [];
  for (let d = 0; out.length < n; d++) {
    const ring = [];
    for (let gx = -d; gx <= d; gx++) for (const gz of new Set([d - Math.abs(gx), Math.abs(gx) - d])) ring.push({ gx: gx + 0, gz: gz + 0 });
    const card = (p) => (p.gz === 0 ? (p.gx > 0 ? 0 : 1) : p.gx === 0 ? (p.gz > 0 ? 2 : 3) : 4);
    ring.sort((a, b) => card(a) - card(b) || Math.abs(a.gz) - Math.abs(b.gz) || b.gx - a.gx || b.gz - a.gz);
    for (const p of ring) if (out.length < n) out.push(p);
  }
  return out.map((p, id) => {
    let parent = -1;
    if (id > 0) {
      const d = Math.abs(p.gx) + Math.abs(p.gz);
      parent = out.findIndex((q) => Math.abs(q.gx - p.gx) + Math.abs(q.gz - p.gz) === 1 && Math.abs(q.gx) + Math.abs(q.gz) === d - 1);
    }
    return { id, gx: p.gx + 0, gz: p.gz + 0, parent, X0: p.gx * PITCH - HALF, Z0: p.gz * PITCH - HALF };
  });
}

function inRect(c, r, R) { return c >= R.c0 && c <= R.c1 && r >= R.r0 && r <= R.r1; }

// 섬 n 개짜리 빈 세계(바닥 칸·다리·구역). 반환 객체는 이후 place/move 가 점유(occ)를 갱신한다.
export function makeWorld(nIslands = 1) {
  const islands = islandSlots(Math.max(1, Math.min(MAX_ISLANDS, nIslands | 0)));
  const cells = new Map();
  for (const isl of islands) {
    const hub = isl.id === 0;
    for (let r = 0; r < ISLAND_N; r++) for (let c = 0; c < ISLAND_N; c++) {
      const edge = Math.min(c, r, ISLAND_N - 1 - c, ISLAND_N - 1 - r);
      let kind = edge === 0 ? 'beach' : edge === 1 ? 'boardwalk' : 'sand';
      let zone = null;
      if (hub) {
        if (inRect(c, r, PLAZA)) kind = 'plaza';
        else if (edge >= 1 && HUB_WALK_ROWS.includes(r)) kind = r === 9 || r === 14 ? 'boardwalk' : 'path';
        const f = FACILITIES.find((F) => inRect(c, r, F)); if (f && kind !== 'boardwalk') zone = f.kind;
      } else if (edge >= 2 && WALK_ROWS.includes(r)) kind = 'path';
      const X = isl.X0 + c; const Z = isl.Z0 + r;
      cells.set(key(X, Z), { X, Z, island: isl.id, c, r, kind, zone });
    }
  }
  const bridges = [];
  for (const isl of islands) {
    if (isl.parent < 0) continue;
    const p = islands[isl.parent];
    const dx = isl.gx - p.gx; const dz = isl.gz - p.gz;
    const list = [];
    for (let g = 1; g <= ISLAND_GAP; g++) for (let w = 0; w < BRIDGE_W; w++) {
      const off = HALF - BRIDGE_W / 2 + w;
      const X = dx ? (dx > 0 ? p.X0 + ISLAND_N - 1 + g : p.X0 - g) : p.X0 + off;
      const Z = dz ? (dz > 0 ? p.Z0 + ISLAND_N - 1 + g : p.Z0 - g) : p.Z0 + off;
      cells.set(key(X, Z), { X, Z, island: -1, c: -1, r: -1, kind: 'bridge', zone: null, axis: dx ? 'x' : 'z' });
      list.push({ X, Z });
    }
    bridges.push({ from: p.id, to: isl.id, axis: dx ? 'x' : 'z', cells: list });
  }
  return { islands, cells, bridges, occ: new Map(), seats: [] };
}

// 섬 로컬 사각 → 전역 칸 목록
function footprint(X, Z, size) { const out = []; for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) out.push({ X: X + i, Z: Z + j }); return out; }
export function seatCells(seat) { return footprint(seat.X, seat.Z, seat.size); }

export function occupantAt(world, X, Z) { return world.occ.get(key(X, Z)) || null; }
export function isLand(world, X, Z) { return world.cells.has(key(X, Z)); }
export function isWalkable(world, X, Z) {
  const c = world.cells.get(key(X, Z));
  return !!c && !world.occ.has(key(X, Z)); // 모래·해변·보드워크·통로·광장·다리 + 예약 부지 모두 걷기 가능(비점유일 때)
}
// 점유 충돌 검사: cells 가 모두 땅이고 비어 있어야(자기 자신 ignoreId 제외)
export function canOccupy(world, cells, ignoreId = null) {
  for (const { X, Z } of cells) {
    if (!world.cells.has(key(X, Z))) return false;
    const o = world.occ.get(key(X, Z));
    if (o && o !== ignoreId) return false;
  }
  return true;
}
export function occupy(world, cells, id) {
  if (!canOccupy(world, cells, id)) throw new Error(`칸 점유 충돌: ${id}`);
  for (const { X, Z } of cells) world.occ.set(key(X, Z), id);
}
export function release(world, id) { for (const [k, v] of world.occ) if (v === id) world.occ.delete(k); }

// 자리를 놓을 수 있는 땅인지(자리 가능 구역: 섬 안쪽 2..21, 광장·보드워크·다리·시설 예약 제외)
function lotOk(world, cells, size) {
  for (const { X, Z } of cells) {
    const c = world.cells.get(key(X, Z));
    if (!c || c.island < 0) return false;
    if (c.c < LOT_MIN || c.c > LOT_MAX || c.r < LOT_MIN || c.r > LOT_MAX) return false;
    if (c.kind === 'plaza' || c.kind === 'boardwalk' || c.zone) return false;
    if (c.kind === 'path' && size <= SEAT_SIZE) return false; // 통로 행은 3×3(평수 확장)만 덮을 수 있음 — 그때도 경로 검사 필수
  }
  return true;
}

// 허브(광장) 시작 칸 → 걷기 가능 칸 BFS. 반환: 도달 칸 집합 + 이전 칸 맵
export function plazaCells(world) {
  const out = [];
  for (const c of world.cells.values()) if (c.kind === 'plaza') out.push(c);
  return out;
}
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export function reachFromHub(world) {
  const seen = new Map(); const q = [];
  for (const c of plazaCells(world)) if (isWalkable(world, c.X, c.Z)) { seen.set(key(c.X, c.Z), null); q.push(c); }
  for (let i = 0; i < q.length; i++) {
    const { X, Z } = q[i];
    for (const [dx, dz] of N4) {
      const k = key(X + dx, Z + dz);
      if (seen.has(k) || !isWalkable(world, X + dx, Z + dz)) continue;
      seen.set(k, key(X, Z)); q.push({ X: X + dx, Z: Z + dz });
    }
  }
  return seen;
}
// 자리 둘레(4방향 이웃) 중 걷기 가능 칸
export function seatAccess(world, seat) {
  const own = new Set(seatCells(seat).map((c) => key(c.X, c.Z)));
  const out = [];
  for (const { X, Z } of seatCells(seat)) for (const [dx, dz] of N4) {
    const k = key(X + dx, Z + dz);
    if (!own.has(k) && isWalkable(world, X + dx, Z + dz) && !out.some((o) => o.k === k)) out.push({ X: X + dx, Z: Z + dz, k });
  }
  return out;
}
export function allSeatsReachable(world) {
  const seen = reachFromHub(world);
  return world.seats.every((s) => seatAccess(world, s).some((a) => seen.has(a.k)));
}

// 자리 월드 좌표/방향
export function seatCenter(seat) { return { x: (seat.X + seat.size / 2) * CELL, z: (seat.Z + seat.size / 2) * CELL }; }
// 기본 facing: 광장(1호 섬 중앙) 쪽. 1호 섬은 광장이 줄의 남/북에 있으니 z축, 다른 섬은 섬 중심→광장의 주축.
//   단 카메라에서 뒤통수가 보이는 방향(N·W)이면 카메라 정면(S)으로 — 기존 "뒤통수 금지" 규칙 유지.
export function defaultFacing(seat, world) {
  const isl = world ? world.islands[seat.island] : null;
  const c = isl && isl.id > 0 ? { x: (isl.X0 + HALF) * CELL, z: (isl.Z0 + HALF) * CELL } : seatCenter(seat);
  const f = isl && isl.id > 0 && Math.abs(c.x) > Math.abs(c.z) ? (c.x > 0 ? 'W' : 'E') : (c.z > 0 ? 'N' : 'S');
  return camVisible(f) ? f : 'S';
}
function seatOut(seat) {
  const { x, z } = seatCenter(seat);
  return { ...seat, x, z, yaw: FACING_YAW[seat.facing] };
}

function candidateAnchors(world, size) {
  const out = [];
  for (const isl of world.islands) {
    const hub = isl.id === 0;
    if (size === SEAT_SIZE) {
      for (const r of hub ? HUB_BANDS : BANDS) for (let c = LOT_MIN; c + size - 1 <= LOT_MAX; c += size) out.push({ X: isl.X0 + c, Z: isl.Z0 + r, lattice: true });
    } else {
      const rows = []; for (let r = LOT_MIN; r + size - 1 <= LOT_MAX; r++) rows.push(r);
      rows.sort((a, b) => Math.abs(a + size / 2 - HALF) - Math.abs(b + size / 2 - HALF) || a - b);
      for (const r of rows) for (let c = LOT_MIN; c + size - 1 <= LOT_MAX; c++) out.push({ X: isl.X0 + c, Z: isl.Z0 + r, lattice: false });
    }
  }
  return out;
}

// 자리 1개 배치(첫 빈 후보). 실패 시 null. 2×2 격자 줄 자리는 구조상 통로에 붙어 있어 경로 검사를 생략, 그 외는 BFS 검증.
export function placeSeat(world, req) {
  const size = SEAT_SIZES.includes(req.size) ? req.size : SEAT_SIZE;
  for (const a of candidateAnchors(world, size)) {
    const cells = footprint(a.X, a.Z, size);
    if (!lotOk(world, cells, size) || !canOccupy(world, cells)) continue;
    const seat = { id: req.id, dept: req.dept || '', size, X: a.X, Z: a.Z, island: world.cells.get(key(a.X, a.Z)).island, facing: 'S' };
    seat.facing = FACINGS.includes(req.facing) ? req.facing : defaultFacing(seat, world);
    occupy(world, cells, seat.id); world.seats.push(seat);
    if (size !== SEAT_SIZE) world.hasBig = true;
    if ((!a.lattice || world.hasBig) && !allSeatsReachable(world)) { release(world, seat.id); world.seats.pop(); continue; }
    return seatOut(seat);
  }
  return null;
}

// 요청 전원 배치. 자리가 모자라면 섬을 하나씩 늘려 처음부터 다시(결정적).
// reqs: [{ id, dept, size?, facing? }] → { world, seats:[{id,dept,size,X,Z,island,facing,x,z,yaw}] }
export function planWorld(reqs, { minIslands = 1 } = {}) {
  const list = (reqs || []).map((r, i) => ({ ...r, id: r.id != null ? String(r.id) : `seat${i}` }));
  for (let n = Math.max(1, minIslands); n <= MAX_ISLANDS; n++) {
    const world = makeWorld(n);
    const seats = [];
    let ok = true;
    for (const r of list) { const s = placeSeat(world, r); if (!s) { ok = false; break; } seats.push(s); }
    if (ok) return { world, seats };
  }
  throw new Error('섬 상한 초과');
}

// 자리 이동(칸 단위). 충돌·자리 불가 구역·경로 단절이면 { ok:false, reason } 이고 세계는 그대로.
export function moveSeat(world, id, X, Z) {
  const seat = world.seats.find((s) => s.id === id);
  if (!seat) return { ok: false, reason: 'no-seat' };
  const cells = footprint(X, Z, seat.size);
  if (!lotOk(world, cells, seat.size)) return { ok: false, reason: 'not-lot' };
  if (!canOccupy(world, cells, id)) return { ok: false, reason: 'collision' };
  const prev = { X: seat.X, Z: seat.Z, island: seat.island };
  release(world, id); occupy(world, cells, id);
  Object.assign(seat, { X, Z, island: world.cells.get(key(X, Z)).island });
  if (!allSeatsReachable(world)) {
    release(world, id); Object.assign(seat, prev); occupy(world, seatCells(seat), id);
    return { ok: false, reason: 'blocks-path' };
  }
  return { ok: true, seat: seatOut(seat) };
}
// 평수 변경(2↔3). 이동과 같은 검사.
export function resizeSeat(world, id, size) {
  const seat = world.seats.find((s) => s.id === id);
  if (!seat || !SEAT_SIZES.includes(size)) return { ok: false, reason: 'bad' };
  const prev = seat.size; seat.size = size;
  const cells = seatCells(seat);
  if (!lotOk(world, cells, size) || !canOccupy(world, cells, id)) { seat.size = prev; return { ok: false, reason: 'collision' }; }
  release(world, id); occupy(world, cells, id);
  if (!allSeatsReachable(world)) { release(world, id); seat.size = prev; occupy(world, seatCells(seat), id); return { ok: false, reason: 'blocks-path' }; }
  return { ok: true, seat: seatOut(seat) };
}
export function setFacing(world, id, facing) {
  const seat = world.seats.find((s) => s.id === id);
  if (!seat || !FACINGS.includes(facing)) return { ok: false, reason: 'bad' };
  seat.facing = facing;
  return { ok: true, seat: seatOut(seat) };
}
export function rotateSeat(world, id, turns = 1) {
  const seat = world.seats.find((s) => s.id === id);
  return seat ? setFacing(world, id, rotateFacing(seat.facing, turns)) : { ok: false, reason: 'no-seat' };
}

// 걷기 경로: 자리 → 월드 목표점(광장 안 스테이션 앞 등). 칸 중심 폴리라인(꺾이는 점만), 못 찾으면 null.
export function walkPath(world, seat, to) {
  const goal = worldToCell(to.x, to.z); const gk = key(goal.X, goal.Z);
  const start = seatAccess(world, seat);
  if (!start.length) return null;
  const prev = new Map(); const q = [];
  for (const a of start) { prev.set(a.k, null); q.push(a); }
  let hit = null;
  for (let i = 0; i < q.length && !hit; i++) {
    const { X, Z } = q[i];
    if (key(X, Z) === gk) { hit = q[i]; break; }
    for (const [dx, dz] of N4) {
      const k = key(X + dx, Z + dz);
      if (prev.has(k) || !(isWalkable(world, X + dx, Z + dz) || k === gk)) continue;
      prev.set(k, key(X, Z)); q.push({ X: X + dx, Z: Z + dz });
    }
  }
  if (!hit) return null;
  const cellsPath = [];
  for (let k = key(hit.X, hit.Z); k; k = prev.get(k)) { const [X, Z] = k.split(',').map(Number); cellsPath.unshift(cellCenter(X, Z)); }
  const c = seatCenter(seat);
  const pts = [{ x: c.x, z: c.z }, ...cellsPath, { x: to.x, z: to.z }];
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = out[out.length - 1]; const b = pts[i]; const n = pts[i + 1];
    if (Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.z - b.z) < 1e-9) continue;
    if (n && ((Math.abs(a.x - b.x) < 1e-9 && Math.abs(b.x - n.x) < 1e-9) || (Math.abs(a.z - b.z) < 1e-9 && Math.abs(b.z - n.z) < 1e-9))) continue; // 일직선 중간점 생략
    out.push(b);
  }
  return out;
}

// 렌더용 타일 목록(종류별) — Scene3D 가 InstancedMesh 로 그린다
export function tilesOf(world) {
  const t = { beach: [], sand: [], boardwalk: [], path: [], plaza: [], bridge: [], reserved: [] };
  for (const c of world.cells.values()) {
    const p = { ...cellCenter(c.X, c.Z), X: c.X, Z: c.Z };
    (t[c.kind] || t.sand).push(c.kind === 'bridge' ? { ...p, axis: c.axis } : p);
    if (c.zone) t.reserved.push({ ...p, zone: c.zone });
  }
  return t;
}
// 시설 예약 부지(1호 섬) 사각형(월드) — 연한 테두리 표시용
export function facilityRects(world) {
  const isl = world.islands[0];
  return FACILITIES.map((F) => ({
    kind: F.kind, label: F.label,
    x0: (isl.X0 + F.c0) * CELL, z0: (isl.Z0 + F.r0) * CELL, x1: (isl.X0 + F.c1 + 1) * CELL, z1: (isl.Z0 + F.r1 + 1) * CELL,
  }));
}
export function worldBounds(world) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const c of world.cells.values()) { x0 = Math.min(x0, c.X); z0 = Math.min(z0, c.Z); x1 = Math.max(x1, c.X + 1); z1 = Math.max(z1, c.Z + 1); }
  return { x0: x0 * CELL, z0: z0 * CELL, x1: x1 * CELL, z1: z1 * CELL };
}
// 비점유 장식 후보 칸(해변 끝단 beach, 다리 착지 칸 제외) — pm3dDecor.beachDecorGrid 가 사용
export function decorCells(world) {
  const nearBridge = new Set();
  for (const b of world.bridges) for (const { X, Z } of b.cells) for (const [dx, dz] of [...N4, [1, 1], [-1, -1], [1, -1], [-1, 1]]) nearBridge.add(key(X + dx, Z + dz));
  const out = [];
  for (const c of world.cells.values()) if (c.kind === 'beach' && !world.occ.has(key(c.X, c.Z)) && !nearBridge.has(key(c.X, c.Z))) out.push(c);
  return out.sort((a, b) => a.island - b.island || a.Z - b.Z || a.X - b.X);
}
// 1호 섬 둘레 보드워크(edge=1) 순환 링의 bounds(pm3dRide.ringPoint 의 hx/hz 로 넣으면 인셋 1m 와 맞음)
export const CRUISE_BOUNDS = Object.freeze({ hx: (HALF - 1.5) * CELL + 1, hz: (HALF - 1.5) * CELL + 1 });
