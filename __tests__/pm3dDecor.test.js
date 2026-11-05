// __tests__/pm3dDecor.test.js — /pm 3D 해변 배경 밀도(lib/pm3dDecor) 검증
// 핵심 보증: 오두막 3~4채·야자수 군락·산포물이 주행로(둘레 링+복도)·좌석·책상·스테이션·허브와 교차 0 · 결정적
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');

(async () => {
  const td = fs.mkdtempSync(path.join(os.tmpdir(), 'pm3ddecor-'));
  for (const n of ['pm3dLayout', 'pm3dGrid', 'pmThemes', 'pm3dRide', 'pm3dHub', 'pmMounts', 'pm3dDecor']) {
    fs.writeFileSync(path.join(td, `${n}.mjs`), fs.readFileSync(path.join(process.cwd(), `lib/${n}.js`), 'utf8')
      .replace("'./pmThemes.js'", "'./pmThemes.mjs'").replace("'./pm3dGrid.js'", "'./pm3dGrid.mjs'").replace("'./pm3dLayout.js'", "'./pm3dLayout.mjs'")
      .replace("'./pm3dRide.js'", "'./pm3dRide.mjs'").replace("'./pm3dHub.js'", "'./pm3dHub.mjs'"));
  }
  const L = await import(pathToFileURL(path.join(td, 'pm3dLayout.mjs')).href);
  const RD = await import(pathToFileURL(path.join(td, 'pm3dRide.mjs')).href);
  const HB = await import(pathToFileURL(path.join(td, 'pm3dHub.mjs')).href);
  const DC = await import(pathToFileURL(path.join(td, 'pm3dDecor.mjs')).href);
  fs.rmSync(td, { recursive: true, force: true });

  // 대표 사무실 구성(부서 4·직원 10) — 실제 /pm 과 같은 layoutDesks 경로
  const rooms = [
    { dept: '영업부', seats: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] },
    { dept: '영업지원', seats: [{ name: 'd' }, { name: 'e' }, { name: 'f' }] },
    { dept: '수입부', seats: [{ name: 'g' }, { name: 'h' }] },
    { dept: '경영지원', seats: [{ name: 'i' }, { name: 'j' }] },
  ];
  const { desks } = L.layoutDesks(rooms);
  const { hx, hz } = L.floorBounds(desks, 1.5); // 해변 테마 mapScale=1.5
  const D = DC.beachDecor({ hx, hz, desks });

  // 1) 밀도: 오두막 3~4채 · 야자수 6그루 이상 · 산포물 12개 이상
  assert.ok(D.huts.length >= 3 && D.huts.length <= 4, `오두막 ${D.huts.length}채(3~4)`);
  assert.ok(D.palms.length >= 6, `야자수 ${D.palms.length}그루(≥6)`);
  assert.ok(D.scatter.length >= 12, `산포물 ${D.scatter.length}개(≥12)`);

  // 2) 교차 0: 모든 장식이 둘레 링·복도·좌석·책상·스테이션·허브에서 최소 이격 이상
  const seats = desks.map(L.seatWorld);
  const stations = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(L.stationPos);
  const all = [...D.huts, ...D.palms, ...D.scatter];
  const C = DC.DECOR_CLEAR;
  for (const p of all) {
    assert.ok(DC.ringDistance(hx, hz, p.x, p.z) >= C.ring - 1e-9, `링 교차 (${p.x.toFixed(1)},${p.z.toFixed(1)})`);
    for (const s of seats) assert.ok(Math.hypot(p.x - s.x, p.z - s.z) >= C.seat - 1e-9, `좌석 교차 (${p.x.toFixed(1)},${p.z.toFixed(1)})`);
    for (const d of desks) assert.ok(Math.hypot(p.x - d.x, p.z - d.z) >= C.desk - 1e-9, `책상 교차`);
    for (const s of stations) assert.ok(Math.hypot(p.x - s.x, p.z - s.z) >= C.station - 1e-9, `스테이션 교차`);
    assert.ok(Math.hypot(p.x - HB.HUB_POS.x, p.z - HB.HUB_POS.z) >= C.hub - 1e-9, `허브 교차`);
    assert.ok(Math.abs(p.x) <= hx && Math.abs(p.z) <= hz, '바닥 밖');
  }
  // 복도(자리↔스테이션 z=±CORRIDOR_Z) 교차 0 — 책상·스테이션 x 범위에서
  const xs = [...desks.map((d) => d.x), ...stations.map((s) => s.x)];
  const corr = [Math.min(...xs) - 1.2, Math.max(...xs) + 1.2];
  for (const p of all) for (const sz of [-1, 1]) {
    const cx = Math.min(Math.max(p.x, corr[0]), corr[1]);
    assert.ok(Math.hypot(p.x - cx, p.z - sz * RD.CORRIDOR_Z) >= C.ring - 1e-9, `복도 교차 (${p.x.toFixed(1)},${p.z.toFixed(1)})`);
  }
  // 둘레 링 경로 샘플링으로도 재확인(ringPoint 실경로)
  for (let t = 0; t < 1; t += 0.01) {
    const q = RD.ringPoint(hx, hz, t);
    for (const p of all) assert.ok(Math.hypot(p.x - q.x, p.z - q.z) >= C.ring - 0.05, `링 경로 교차 t=${t.toFixed(2)}`);
  }

  // 3) 결정적(같은 입력 → 같은 배치)
  assert.deepStrictEqual(DC.beachDecor({ hx, hz, desks }), D);

  // 4) 장식끼리 겹침 없음
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    assert.ok(Math.hypot(all[i].x - all[j].x, all[i].z - all[j].z) >= C.item - 1e-9, '장식끼리 겹침');
  }

  console.log(`pm3dDecor OK — 오두막 ${D.huts.length} · 야자수 ${D.palms.length} · 산포 ${D.scatter.length}`);
})().catch((e) => { console.error(e); process.exit(1); });
