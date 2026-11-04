// __tests__/pm3dRide.test.js — /pm 3D 탈것 주행 경로(lib/pm3dRide) 검증
// 핵심 보증: 자리↔스테이션 주행 폴리라인이 책상·다른 좌석·스테이션 바운딩과 교차 0 (사장님 지시)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');

(async () => {
  const td = fs.mkdtempSync(path.join(os.tmpdir(), 'pm3dride-'));
  for (const n of ['pm3dLayout', 'pmThemes', 'pm3dRide']) {
    fs.writeFileSync(path.join(td, `${n}.mjs`), fs.readFileSync(path.join(process.cwd(), `lib/${n}.js`), 'utf8')
      .replace("'./pmThemes.js'", "'./pmThemes.mjs'").replace("'./pm3dLayout.js'", "'./pm3dLayout.mjs'"));
  }
  const L = await import(pathToFileURL(path.join(td, 'pm3dLayout.mjs')).href);
  const RD = await import(pathToFileURL(path.join(td, 'pm3dRide.mjs')).href);
  const TH = await import(pathToFileURL(path.join(td, 'pmThemes.mjs')).href);
  fs.rmSync(td, { recursive: true, force: true });

  // 실제 부서 구성으로 배치
  const rooms = [['영업지원', 3], ['수입부', 2], ['영업부', 3], ['경영지원', 1]].map(([dept, n]) => ({ dept, seats: Array.from({ length: n }, (_, i) => ({ name: `${dept}${i}` })) }));
  const { desks } = L.layoutDesks(rooms);
  const lay = TH.PM3D.THEMES.I.layout;
  assert.ok(lay && lay.mapScale === 1.5 && lay.ring, '해변 테마 layout 데이터(mapSize 1.5·ring) 없음');
  const { hx, hz } = L.floorBounds(desks, lay.mapScale);
  const base = L.floorBounds(desks);
  assert.ok(hx >= base.hx * 1.4 && hz >= base.hz * 1.4, '맵 1.5배 확장 안 됨');

  // 모든 자리 × 모든 스테이션: 경로가 (자기 책상 제외) 책상·스테이션·다른 좌석과 교차 0
  let checked = 0;
  for (const d of desks) {
    for (let no = 1; no <= 9; no++) {
      const pts = RD.ridePath(d, no, { hx, hz });
      assert.ok(pts.length >= 3 && RD.pathLength(pts) > 1, '경로 생성 실패');
      const rects = [];
      for (const o of desks) if (o !== d) rects.push(RD.deskRect(o));
      for (let s = 1; s <= 9; s++) if (s !== no) rects.push(RD.stationRect(s));
      for (const o of desks) if (o !== d) { const w = L.seatWorld(o); rects.push({ cx: w.x, cz: w.z, hw: 0.3, hd: 0.3 }); }
      assert.ok(!RD.pathIntersects(pts, rects), `경로 교차: ${d.dept} (${d.x.toFixed(1)},${d.z.toFixed(1)}) → st${no}`);
      checked++;
    }
  }
  // 둘레 순환로: 링 위 어떤 점도 책상·스테이션과 겹치지 않고, 바닥 안에 있다
  for (let i = 0; i < 200; i++) {
    const p = RD.ringPoint(hx, hz, i / 200);
    assert.ok(Math.abs(p.x) <= hx && Math.abs(p.z) <= hz, '링이 바닥 밖');
    for (const o of desks) { const r = RD.deskRect(o); assert.ok(Math.abs(p.x - r.cx) > r.hw || Math.abs(p.z - r.cz) > r.hd, '링이 책상 통과'); }
    for (let s = 1; s <= 9; s++) { const r = RD.stationRect(s); assert.ok(Math.abs(p.x - r.cx) > r.hw || Math.abs(p.z - r.cz) > r.hd, '링이 스테이션 통과'); }
  }
  assert.strictEqual(RD.RIDE_MAX_CONCURRENT, 3, '동시 주행 상한 3');
  // 에셋: mounts.glb 모듈 15종 + 스프라이트/썸네일 39… 중 탈것 15×2
  const dir = path.join(process.cwd(), 'public');
  const b = fs.readFileSync(path.join(dir, 'pm3d/mounts.glb'));
  const j = JSON.parse(b.slice(20, 20 + b.readUInt32LE(12)).toString());
  const names = new Set(j.nodes.map((n) => n.name));
  const ids = ['kickboard', 'flower-cart', 'roller', 'bike', 'forklift', 'balloon', 'cloud', 'duck', 'turtle', 'magic-carpet', 'unicorn', 'gama', 'surfboard', 'hoverboard', 'sled'];
  for (const id of ids) {
    assert.ok(names.has('mount_' + id.replace(/-/g, '_')), `mounts.glb 모듈 없음: ${id}`);
    assert.ok(fs.existsSync(path.join(dir, 'pm/mounts', id + '.png')), `2D 스프라이트 없음: ${id}`);
    assert.ok(fs.existsSync(path.join(dir, 'pm/mounts/thumb', id + '.webp')), `썸네일 없음: ${id}`);
  }
  // Scene3D 연동: reduced 정지·동시 상한·park
  const src = fs.readFileSync(path.join(process.cwd(), 'components/pm3d/Scene3D.js'), 'utf8');
  assert.ok(/RIDE_MAX_CONCURRENT/.test(src) && /mountPose/.test(src) && /ridePath/.test(src), 'Scene3D 탈것 연동 누락');
  assert.ok(/reduced/.test(src.slice(src.indexOf('cruise'))), '크루징 reduced 처리 누락');
  console.log(`pm3dRide OK (경로 ${checked}건 교차 0 · 탈것 ${ids.length}종)`);
})().catch((e) => { console.error(e); process.exit(1); });
