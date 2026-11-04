// __tests__/pm3dHub.test.js — /pm 3D 중앙 허브 "회사 심장"(lib/pm3dHub) 검증
// 핵심 보증: 허브 위치가 주행로(자리→스테이션·둘레 링)·좌석·스테이션·책상과 교차 0 · 알갱이 상한 12 · 주차 자세/오프셋
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');

(async () => {
  const td = fs.mkdtempSync(path.join(os.tmpdir(), 'pm3dhub-'));
  for (const n of ['pm3dLayout', 'pmThemes', 'pm3dRide', 'pm3dHub', 'pmMounts']) {
    fs.writeFileSync(path.join(td, `${n}.mjs`), fs.readFileSync(path.join(process.cwd(), `lib/${n}.js`), 'utf8')
      .replace("'./pmThemes.js'", "'./pmThemes.mjs'").replace("'./pm3dLayout.js'", "'./pm3dLayout.mjs'"));
  }
  const L = await import(pathToFileURL(path.join(td, 'pm3dLayout.mjs')).href);
  const RD = await import(pathToFileURL(path.join(td, 'pm3dRide.mjs')).href);
  const TH = await import(pathToFileURL(path.join(td, 'pmThemes.mjs')).href);
  const HB = await import(pathToFileURL(path.join(td, 'pm3dHub.mjs')).href);
  const MT = await import(pathToFileURL(path.join(td, 'pmMounts.mjs')).href);
  fs.rmSync(td, { recursive: true, force: true });

  // 실제 부서 구성 배치(해변 테마 1.5배 맵)
  const rooms = [['영업지원', 3], ['수입부', 2], ['영업부', 3], ['경영지원', 1]].map(([dept, n]) => ({ dept, seats: Array.from({ length: n }, (_, i) => ({ name: `${dept}${i}` })) }));
  const { desks } = L.layoutDesks(rooms);
  const { hx, hz } = L.floorBounds(desks, TH.PM3D.THEMES.I.layout.mapScale);

  // 1) 허브 ↔ 스테이션·책상·좌석 교차 0
  const hub = HB.hubRect(0.05);
  const overlap = (a, b) => Math.abs(a.cx - b.cx) < a.hw + b.hw && Math.abs(a.cz - b.cz) < a.hd + b.hd;
  for (let s = 1; s <= 9; s++) assert.ok(!overlap(hub, RD.stationRect(s)), `허브가 스테이션 ${s}와 겹침`);
  for (const d of desks) {
    assert.ok(!overlap(hub, RD.deskRect(d)), `허브가 책상(${d.x},${d.z})과 겹침`);
    const w = L.seatWorld(d);
    assert.ok(!overlap(hub, { cx: w.x, cz: w.z, hw: 0.3, hd: 0.3 }), `허브가 좌석(${w.x},${w.z})과 겹침`);
  }
  // 2) 허브 ↔ 모든 자리×스테이션 주행 폴리라인 교차 0
  for (const d of desks) for (let no = 1; no <= 9; no++) {
    const pts = RD.ridePath(d, no, { hx, hz });
    assert.ok(!RD.pathIntersects(pts, [hub]), `허브가 주행로와 교차: (${d.x.toFixed(1)},${d.z.toFixed(1)})→st${no}`);
  }
  // 둘레 순환 링과도 교차 0 + 허브는 바닥 안
  for (let i = 0; i < 400; i++) {
    const p = RD.ringPoint(hx, hz, i / 400);
    assert.ok(Math.abs(p.x - hub.cx) > hub.hw || Math.abs(p.z - hub.cz) > hub.hd, '허브가 둘레 링과 겹침');
  }
  assert.ok(Math.abs(HB.HUB_POS.x) < hx - 1 && Math.abs(HB.HUB_POS.z) < hz - 1, '허브가 바닥 밖');
  // 도보 도착점(카메라 쪽 z=+0.78)과 반대쪽
  assert.ok(HB.HUB_POS.z < 0, '허브는 도보 도착점 반대쪽(-z)이어야 함');
  // 수정구 높이: 캐릭터 정수리(2.2) 위 · 아치 mid(3.6) 아래 — 관통 없음
  assert.ok(HB.HUB_ORB_Y > L.CHAR_TOP && HB.HUB_ORB_Y < L.ARC_Y.mid, '수정구 높이 범위 밖');

  // 3) 알갱이 상한·개수(2~3)·맥박
  assert.strictEqual(HB.FLOW_MAX, 12, '동시 알갱이 상한 12');
  for (let seed = 0; seed < 8; seed++) {
    const n = HB.flowSpawnCount(0, seed);
    assert.ok(n >= 2 && n <= 3, `이벤트당 알갱이 2~3개 (got ${n})`);
  }
  assert.strictEqual(HB.flowSpawnCount(12, 1), 0, '상한 도달 시 0개');
  assert.strictEqual(HB.flowSpawnCount(11, 1), 1, '상한 직전엔 남은 수만');
  assert.strictEqual(HB.pulseScale(-1), 1); assert.strictEqual(HB.pulseScale(HB.PULSE_MS), 1);
  const peak = HB.pulseScale(HB.PULSE_MS / 2);
  assert.ok(Math.abs(peak - 1.15) < 1e-9, `맥박 피크 1.15배 (got ${peak})`);
  // 심장 박동: 최근 1분 빈도만큼 강해지되 상한 있음
  const now = Date.now();
  const calm = HB.heartbeat([], now);
  const busy = HB.heartbeat(Array.from({ length: 10 }, () => now - 1000), now);
  const over = HB.heartbeat(Array.from({ length: 50 }, () => now - 1000), now);
  assert.ok(calm.bob === HB.BOB_BASE && calm.glow === HB.GLOW_BASE, '무활동 기본값');
  assert.ok(busy.bob > calm.bob && busy.glow > calm.glow, '바쁘면 강해짐');
  assert.ok(over.bob <= HB.BOB_MAX && over.glow <= HB.GLOW_MAX, '과장 금지(상한)');
  assert.strictEqual(HB.pruneArrivals([now - 70000, now - 1000], now).length, 1, '1분 창 밖 제거');
  // 허브 색 = pmThemes 토큰(하드코딩 금지 가드와 합)
  for (const k of ['crystal', 'glow', 'pedestal', 'pedestalTop', 'particle', 'ring']) assert.ok(TH.PM3D.HUB[k], `PM3D.HUB.${k} 토큰 없음`);

  // 4) 탈것 주차 자세: 보드류=기대 세움 · 동물/탈것류=엎드림 · 비행류=부유, 오프셋은 좌석(0,-0.9)과 1m 이상·책상 사각 밖
  const kinds = { surfboard: 'lean', kickboard: 'lean', roller: 'lean', turtle: 'crouch', duck: 'crouch', unicorn: 'crouch', 'flower-cart': 'crouch', balloon: 'float', cloud: 'float', 'magic-carpet': 'float', hoverboard: 'float' };
  for (const [id, kind] of Object.entries(kinds)) {
    const pp = HB.parkPose(MT.mountById(id));
    assert.strictEqual(pp.kind, kind, `${id} 주차 자세 ${kind} (got ${pp.kind})`);
    if (kind === 'float') assert.ok(pp.y > 0 && pp.hover > 0, `${id} 부유값`);
    if (kind === 'lean') assert.ok(Math.abs(pp.rotZ) > 0.2, `${id} 기울기`);
    if (kind === 'crouch') assert.ok(pp.sy < 1, `${id} 엎드림(높이 눌림)`);
    const seat = { x: 0, z: -0.62 * 1.45 };
    assert.ok(Math.hypot(pp.x - seat.x, pp.z - seat.z) >= 1.0, `${id} 주차가 좌석 1m 안`); // 좌석-책상 1m 검사와 충돌 없음
  }
  assert.strictEqual(HB.parkPose(null), null);
  // 주차 지점이 이웃 책상(간격 DESK_DX=2.4)과 겹치지 않음: |x|=1.15 + 책상 반폭 0.87 < 2.4
  assert.ok(Math.abs(HB.PARK_X) + 0.87 < L.DESK_DX, '주차가 옆 책상 사각 침범');

  console.log(`pm3dHub ok (허브 (${HB.HUB_POS.x},${HB.HUB_POS.z}) 교차 0 · 경로 ${desks.length * 9}개 · 주차 ${Object.keys(kinds).length}종)`);
})().catch((e) => { console.error(e); process.exit(1); });
