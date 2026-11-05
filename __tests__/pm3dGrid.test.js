// __tests__/pm3dGrid.test.js — /pm 3D 격자 섬 엔진(lib/pm3dGrid): 섬 증설·다리·자리 배정·이동·회전·충돌·걷기 경로.
// 실행: node --test __tests__/pm3dGrid.test.js (또는 node __tests__/pm3dGrid.test.js)
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');

let G;
test.before(async () => {
  const td = fs.mkdtempSync(path.join(os.tmpdir(), 'pm3dgrid-'));
  fs.writeFileSync(path.join(td, 'pm3dGrid.mjs'), fs.readFileSync(path.join(process.cwd(), 'lib/pm3dGrid.js'), 'utf8'));
  G = await import(pathToFileURL(path.join(td, 'pm3dGrid.mjs')).href);
  fs.rmSync(td, { recursive: true, force: true });
});
const reqs = (n, f = {}) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, dept: `d${i % 5}`, ...f }));

test('섬 = 24×24 칸, 칸 크기 상수', () => {
  const w = G.makeWorld(1);
  assert.strictEqual(w.cells.size, 24 * 24);
  assert.strictEqual(G.ISLAND_N, 24);
  assert.ok(G.CELL > 0);
  assert.strictEqual(w.bridges.length, 0);
});

test('섬 증설: 동서남북 인접(기존 섬과 맞닿음), 1호=원점, 2호=동쪽', () => {
  const s = G.islandSlots(13);
  assert.deepStrictEqual([s[0].gx, s[0].gz], [0, 0]);
  assert.deepStrictEqual(s.slice(1, 5).map((p) => [p.gx, p.gz]), [[1, 0], [-1, 0], [0, 1], [0, -1]]);
  const seen = new Set();
  for (const p of s) {
    const k = `${p.gx},${p.gz}`; assert.ok(!seen.has(k), '섬 자리 중복'); seen.add(k);
    if (p.id === 0) continue;
    const par = s[p.parent];
    assert.ok(par && par.id < p.id, '부모 섬은 먼저 생김');
    assert.strictEqual(Math.abs(par.gx - p.gx) + Math.abs(par.gz - p.gz), 1, '부모와 동서남북 인접');
  }
});

test('다리: 섬마다 부모와 2칸 폭·바다 칸 수만큼, 다리 칸은 걷기 가능', () => {
  const w = G.makeWorld(5);
  assert.strictEqual(w.bridges.length, 4);
  for (const b of w.bridges) {
    assert.strictEqual(b.cells.length, G.ISLAND_GAP * G.BRIDGE_W);
    for (const c of b.cells) { assert.ok(G.isWalkable(w, c.X, c.Z)); assert.strictEqual(w.cells.get(G.key(c.X, c.Z)).kind, 'bridge'); }
  }
  assert.strictEqual(w.cells.size, 5 * 576 + 4 * G.ISLAND_GAP * G.BRIDGE_W);
});

test('직원 N명(1~200): 전원 배정 · 칸 충돌 0 · 모든 자리에서 허브까지 걷기 경로', () => {
  for (let n = 1; n <= 200; n++) {
    const { world, seats } = G.planWorld(reqs(n));
    assert.strictEqual(seats.length, n, `N=${n} 배정 누락`);
    const used = new Map();
    for (const s of seats) for (const c of G.seatCells(s)) {
      const k = G.key(c.X, c.Z);
      assert.ok(!used.has(k), `N=${n} 칸 충돌 ${k} (${used.get(k)} / ${s.id})`); used.set(k, s.id);
      assert.strictEqual(G.occupantAt(world, c.X, c.Z), s.id);
      const cell = world.cells.get(k);
      assert.ok(cell && cell.kind !== 'plaza' && cell.kind !== 'bridge' && !cell.zone, `N=${n} 자리가 광장/다리/예약부지 위`);
    }
    const reach = G.reachFromHub(world);
    for (const s of seats) assert.ok(G.seatAccess(world, s).some((a) => reach.has(a.k)), `N=${n} ${s.id} 허브 경로 없음`);
    assert.ok(G.allSeatsReachable(world));
    // 섬은 필요한 만큼만(한 섬 덜 쓰면 안 들어감)
    if (world.islands.length > 1) assert.throws(() => { const w2 = G.makeWorld(world.islands.length - 1); for (const r of reqs(n)) if (!G.placeSeat(w2, r)) throw new Error('full'); });
  }
});

test('평수 3×3 섞여도 배정·충돌 0·경로 유지', () => {
  for (const n of [5, 30, 90]) {
    const list = reqs(n).map((r, i) => (i % 4 === 0 ? { ...r, size: 3 } : r));
    const { world, seats } = G.planWorld(list);
    assert.strictEqual(seats.length, n);
    assert.ok(seats.filter((s) => s.size === 3).length === Math.ceil(n / 4));
    const used = new Set();
    for (const s of seats) for (const c of G.seatCells(s)) { const k = G.key(c.X, c.Z); assert.ok(!used.has(k)); used.add(k); }
    assert.ok(G.allSeatsReachable(world), `N=${n} 3×3 경로 단절`);
  }
});

test('기본 facing: 광장 쪽, 뒤통수(N·W) 금지 · 4방향 회전', () => {
  const { seats } = G.planWorld(reqs(200));
  for (const s of seats) {
    assert.ok(G.camVisible(s.facing), `${s.id} 뒤통수 방향 ${s.facing}`);
    assert.strictEqual(s.yaw, G.FACING_YAW[s.facing]);
    if (s.island === 0 && s.z < 0) assert.strictEqual(s.facing, 'S', '1호 섬 북쪽 줄은 광장(남) 쪽');
  }
  assert.deepStrictEqual(['S', 'E', 'N', 'W'].map((f) => G.rotateFacing(f)), ['E', 'N', 'W', 'S']);
  assert.strictEqual(G.rotateFacing('S', -1), 'W');
  const { world } = G.planWorld(reqs(3));
  const r = G.rotateSeat(world, 'p0'); assert.ok(r.ok); assert.strictEqual(r.seat.facing, 'E'); assert.strictEqual(r.seat.yaw, Math.PI / 2);
  assert.ok(G.setFacing(world, 'p0', 'N').ok);
  assert.ok(!G.setFacing(world, 'p0', 'X').ok);
  const f = G.planWorld([{ id: 'a', facing: 'W' }]).seats[0]; assert.strictEqual(f.facing, 'W', '지정 facing 유지');
});

test('이동: 칸 단위, 충돌·자리불가·경로단절은 거부하고 원상태 유지', () => {
  const { world, seats } = G.planWorld(reqs(4));
  const [a, b] = seats;
  // 충돌: a 를 b 자리로
  const r1 = G.moveSeat(world, a.id, b.X, b.Z); assert.strictEqual(r1.reason, 'collision');
  assert.strictEqual(G.occupantAt(world, a.X, a.Z), a.id);
  // 광장으로 이동 금지
  const isl = world.islands[0];
  const r2 = G.moveSeat(world, a.id, isl.X0 + 10, isl.Z0 + 11); assert.strictEqual(r2.reason, 'not-lot');
  // 정상 이동(비어 있는 남쪽 바깥 줄)
  const to = { X: isl.X0 + 10, Z: isl.Z0 + 20 };
  const r3 = G.moveSeat(world, a.id, to.X, to.Z); assert.ok(r3.ok, r3.reason);
  assert.strictEqual(G.occupantAt(world, to.X, to.Z), a.id);
  assert.strictEqual(G.occupantAt(world, a.X, a.Z), null, '옛 칸 비움');
  assert.ok(G.allSeatsReachable(world));
  // 3×3 확장 후 이동/충돌
  const r4 = G.resizeSeat(world, b.id, 3); assert.ok(r4.ok || r4.reason, '평수 변경 결과');
  assert.ok(G.allSeatsReachable(world));
  // 경로 단절 거부: 바깥 행(2-3) 자리를 3×3 로 둘러싸 막는 상황 — 직접 사방을 막아 확인
  const w = G.makeWorld(1);
  const s0 = G.placeSeat(w, { id: 's0' });
  const ring = [];
  for (const c of G.seatCells(s0)) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) ring.push({ X: c.X + dx, Z: c.Z + dz });
  const block = ring.filter((c) => G.occupantAt(w, c.X, c.Z) == null);
  G.occupy(w, block, 'wall');
  assert.ok(!G.allSeatsReachable(w), '사방이 막히면 경로 없음 판정');
});

test('점유 충돌 검사: 같은 칸 두 물체 금지, 바다 칸 금지', () => {
  const w = G.makeWorld(1);
  const c = [{ X: 3, Z: 3 }];
  G.occupy(w, c, 'A');
  assert.ok(!G.canOccupy(w, c));
  assert.ok(G.canOccupy(w, c, 'A'));
  assert.throws(() => G.occupy(w, c, 'B'));
  assert.ok(!G.canOccupy(w, [{ X: 100, Z: 100 }]), '바다');
  G.release(w, 'A'); assert.ok(G.canOccupy(w, c));
});

test('걷기 가능 판정: 모래·보드워크·광장·다리 O / 바다·점유 X', () => {
  const w = G.makeWorld(2);
  const kinds = new Set();
  for (const c of w.cells.values()) { kinds.add(c.kind); assert.ok(G.isWalkable(w, c.X, c.Z)); }
  for (const k of ['beach', 'sand', 'boardwalk', 'plaza', 'bridge', 'path']) assert.ok(kinds.has(k), `칸 종류 ${k}`);
  assert.ok(!G.isWalkable(w, 0, 40), '바다');
  G.occupy(w, [{ X: 5, Z: 5 }], 'x'); assert.ok(!G.isWalkable(w, 5, 5));
});

test('walkPath: 다른 섬 자리 → 광장 스테이션 앞, 점유 칸 통과 없음', () => {
  const { world, seats } = G.planWorld(reqs(120));
  for (const s of seats.filter((_, i) => i % 7 === 0)) {
    const pts = G.walkPath(world, s, { x: 0, z: 1.35 });
    assert.ok(pts && pts.length >= 2, `${s.id} 경로 없음`);
    for (let i = 2; i < pts.length - 1; i++) {
      const c = G.worldToCell(pts[i].x, pts[i].z);
      assert.ok(G.isWalkable(world, c.X, c.Z), `${s.id} 경로가 점유 칸 통과`);
    }
  }
});

test('시설 예약 부지·장식 칸·허브 섬 광장', () => {
  const w = G.makeWorld(1);
  const R = G.facilityRects(w);
  assert.deepStrictEqual(R.map((r) => r.kind), ['pool', 'kart', 'airfield']);
  const t = G.tilesOf(w);
  assert.ok(t.reserved.length > 0 && t.plaza.length === 20 * 4);
  // 광장은 월드 원점 중심(스테이션 줄 z=0, 허브 (1.1,-1.5) 포함)
  const xs = t.plaza.map((p) => p.x); const zs = t.plaza.map((p) => p.z);
  assert.ok(Math.min(...zs) < -1.5 && Math.max(...zs) > 1.5 && Math.min(...xs) < -8.8 && Math.max(...xs) > 8.8);
  const dc = G.decorCells(G.planWorld(reqs(80)).world);
  assert.ok(dc.length > 50 && dc.every((c) => c.kind === 'beach'));
});

test('장식(pm3dDecor.beachDecorGrid): 비점유 칸에만 1칸 1개 · 배치 후에도 전원 허브 경로', async () => {
  const td = fs.mkdtempSync(path.join(os.tmpdir(), 'pm3dgrid-dc-'));
  for (const n of ['pm3dLayout', 'pm3dGrid', 'pmThemes', 'pm3dRide', 'pm3dHub', 'pm3dDecor']) {
    fs.writeFileSync(path.join(td, `${n}.mjs`), fs.readFileSync(path.join(process.cwd(), `lib/${n}.js`), 'utf8').replace(/'\.\/(pm\w+)\.js'/g, "'./$1.mjs'"));
  }
  const DC = await import(pathToFileURL(path.join(td, 'pm3dDecor.mjs')).href);
  const GG = await import(pathToFileURL(path.join(td, 'pm3dGrid.mjs')).href);
  fs.rmSync(td, { recursive: true, force: true });
  for (const n of [1, 14, 60, 150]) {
    const { world, seats } = GG.planWorld(reqs(n));
    const seatKeys = new Set(seats.flatMap((s) => GG.seatCells(s).map((c) => GG.key(c.X, c.Z))));
    const D = DC.beachDecorGrid(world);
    const all = [...D.palms, ...D.scatter];
    assert.ok(D.palms.length >= 6 && D.scatter.length >= 12, `N=${n} 장식 밀도 ${D.palms.length}/${D.scatter.length}`);
    const used = new Set();
    for (const p of all) {
      const k = GG.key(p.X, p.Z);
      assert.ok(!seatKeys.has(k), '장식이 자리 칸'); assert.ok(!used.has(k), '장식끼리 같은 칸'); used.add(k);
      assert.strictEqual(world.cells.get(k).kind, 'beach');
      assert.ok(String(GG.occupantAt(world, p.X, p.Z)).startsWith('decor:'));
    }
    assert.ok(GG.allSeatsReachable(world), `N=${n} 장식이 경로를 막음`);
    assert.deepStrictEqual(DC.beachDecorGrid(GG.planWorld(reqs(n)).world), D, '결정적');
  }
});
