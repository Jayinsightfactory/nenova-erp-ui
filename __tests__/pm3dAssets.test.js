// __tests__/pm3dAssets.test.js — /pm 3D 블렌더 glb 애셋: 37종 존재·용량, 격자 스케일 정합(1칸=4.0 → CELL),
//   자리 구도(카메라 가까운 순 책상→캐릭터→파라솔) + 파라솔 덮개가 어떤 캐릭터도 가리지 않는지(아이소 카메라 광선 검사).
// 실행: node __tests__/pm3dAssets.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');
(async () => {
  const td = fs.mkdtempSync(path.join(os.tmpdir(), 'pm3da-'));
  const fix = (s) => s.replace("'./pmThemes.js'", "'./pmThemes.mjs'").replace("'./pm3dGrid.js'", "'./pm3dGrid.mjs'");
  for (const n of ['pm3dAssets', 'pm3dLayout', 'pm3dGrid', 'pmThemes']) fs.writeFileSync(path.join(td, `${n}.mjs`), fix(fs.readFileSync(path.join(process.cwd(), `lib/${n}.js`), 'utf8')));
  const A = await import(pathToFileURL(path.join(td, 'pm3dAssets.mjs')).href);
  const L = await import(pathToFileURL(path.join(td, 'pm3dLayout.mjs')).href);
  const G = await import(pathToFileURL(path.join(td, 'pm3dGrid.mjs')).href);
  fs.rmSync(td, { recursive: true, force: true });

  // 1) 애셋 34종 존재 · 합계 4MB 이하 · glb 헤더
  assert.strictEqual(A.ALL_ASSETS.length, 37); // 2026-11-05 소품 3종 추가(서핑보드·불가사리·조약돌)
  let total = 0;
  for (const n of A.ALL_ASSETS) {
    const f = path.join(process.cwd(), 'public', A.assetUrl(n));
    assert.ok(fs.existsSync(f), `애셋 없음: ${n}`);
    const b = fs.readFileSync(f); total += b.length;
    assert.strictEqual(b.slice(0, 4).toString(), 'glTF', `glb 아님: ${n}`);
  }
  assert.ok(total < 4 * 1024 * 1024, `glb 합계 ${total}B > 4MB`);
  console.log(`glb 34종 합계 ${(total / 1024 / 1024).toFixed(2)}MB`);

  // 2) 스케일 정합: 애셋 4.0 타일 = 웹 1칸, 자리 유닛 4.0 = 자리 2칸
  assert.ok(Math.abs(4.0 * A.ASSET_SCALE - G.CELL) < 1e-9, '타일 스케일');
  assert.ok(Math.abs(4.0 * A.seatUnitScale(2) - 2 * G.CELL) < 1e-9, '자리 유닛 스케일(2×2)');
  assert.ok(Math.abs(4.0 * A.seatUnitScale(3) - 3 * G.CELL) < 1e-9, '자리 유닛 스케일(3×3)');
  // 타일 실측(glb 접근자 min/max): 바닥 4.0×4.0 → 1.2m
  {
    const b = fs.readFileSync(path.join(process.cwd(), 'public', A.assetUrl('tile_sand')));
    const j = JSON.parse(b.slice(20, 20 + b.readUInt32LE(12)).toString());
    const base = j.nodes.find((n) => n.name === 'tile_base'); const acc = j.accessors[j.meshes[base.mesh].primitives[0].attributes.POSITION];
    assert.ok(Math.abs((acc.max[0] - acc.min[0]) * A.ASSET_SCALE - G.CELL) < 1e-6, '모래 타일 실측 폭 ≠ CELL');
  }
  // 유닛 노드 분할: 파라솔 4 · 숨김(방석의자·바닥) · 나머지 책상
  {
    const b = fs.readFileSync(path.join(process.cwd(), 'public', A.assetUrl('unit_parasol_pink')));
    const j = JSON.parse(b.slice(20, 20 + b.readUInt32LE(12)).toString());
    const parts = j.nodes.map((n) => A.unitPartOf(n.name));
    assert.strictEqual(parts.filter((p) => p === 'parasol').length, 4, '파라솔 노드 4개');
    for (const n of ['desk_top', 'mon_screen', 'keyboard']) assert.strictEqual(A.unitPartOf(n), 'desk');
    const can = j.nodes.find((n) => n.name === 'canopy');
    assert.ok(Math.abs(can.translation[0] - A.UNIT_GEOM.canopy.x) < 0.01 && Math.abs(can.translation[2] - A.UNIT_GEOM.canopy.z) < 0.01, '덮개 실측 중심');
  }

  // 3) 구도 + 가림 검사: 실제 배치(소·중·대 인원, 4방향 facing 섞음)
  const CHAR_TOP = L.CHAR_STAND_H * L.CHAR_SCALE + 0.1; // 앉은 머리끝 상한(서기 높이 기준 + 여유) — 보수적
  const deskCam = 0.0; // 책상 = 자리 그룹 원점, 캐릭터 = 로컬 -SEAT_OFF
  const cases = [5, 14, 30, 60];
  for (const n of cases) for (const mixed of [false, true]) {
    const FAC = ['S', 'E', 'N', 'W'];
    const rooms = [{ dept: 'a', seats: Array.from({ length: n }, (_, i) => ({ name: `p${i}`, facing: mixed ? FAC[i % 4] : undefined })) }];
    const { desks } = L.layoutDesks(rooms);
    const chars = desks.map((d) => ({ ...L.seatWorld(d), headTop: CHAR_TOP }));
    const plan = A.planParasols(chars.map((c, i) => ({ ...c, size: desks[i].size })));
    const cans = plan.filter(Boolean); const dropped = plan.length - cans.length;
    assert.ok(dropped <= Math.ceil(desks.length * 0.15), `파라솔 생략 ${dropped}건 과다`);
    const bad = A.occlusions(chars, cans);
    assert.deepStrictEqual(bad, [], `파라솔 가림 ${bad.length}건(인원 ${n}, 방향섞음 ${mixed})`);
    for (let i = 0; i < desks.length; i++) {
      const d = desks[i]; const c = chars[i]; const cn = plan[i]; if (!cn) continue;
      // 파라솔은 언제나 캐릭터보다 카메라에서 멀다(뒤)
      assert.ok(A.camDepth(cn.x, cn.z) < A.camDepth(c.x, c.z) - cn.r, `파라솔이 캐릭터 앞: ${d.name}`);
      // 카메라를 보는 자리(기본)는 책상이 캐릭터보다 앞 → 책상 → 캐릭터 → 파라솔
      if (G.camVisible(d.facing)) assert.ok(A.camDepth(d.x, d.z) + deskCam > A.camDepth(c.x, c.z), `책상이 캐릭터 뒤: ${d.name}`);
      // 덮개 밑면 > 머리끝(머리 위로 덮개가 내려오지 않음)
      assert.ok(cn.y0 > CHAR_TOP, `덮개 밑면 ${cn.y0} ≤ 머리 ${CHAR_TOP}`);
    }
    console.log(`구도 검사 인원 ${n}${mixed ? '(4방향)' : ''}: 자리 ${desks.length} · 파라솔 가림 0건 · 생략 ${dropped}`);
  }
  // 음성 대조: 파라솔을 캐릭터 앞(카메라 쪽)에 두면 검사가 실제로 잡는다
  {
    const c = { x: 0, z: 0, headTop: CHAR_TOP }; const cn = A.parasolSpot(0, 0);
    const front = { ...cn, x: -cn.x * 0.3, z: -cn.z * 0.3 };
    assert.strictEqual(A.occlusions([c], [front]).length, 1, '앞에 둔 파라솔을 못 잡음');
  }
  // 로컬↔월드 왕복
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const l = A.worldToLocal(1.3, -0.4, yaw); const w = A.localToWorld(l.x, l.z, yaw);
    assert.ok(Math.abs(w.x - 1.3) < 1e-9 && Math.abs(w.z + 0.4) < 1e-9, '좌표 변환 왕복');
    // three.js rotation.y: 로컬 (0,0,1) → 월드 (sin, cos)
    const f = A.localToWorld(0, 1, yaw); assert.ok(Math.abs(f.x - Math.sin(yaw)) < 1e-9 && Math.abs(f.z - Math.cos(yaw)) < 1e-9);
  }
  // 해안·보드워크 선택
  assert.strictEqual(A.coastPick([[1, 0]]).asset, 'tile_coast_a');
  assert.strictEqual(A.coastPick([[1, 0], [0, -1]]).asset, 'tile_coast_b');
  assert.strictEqual(A.boardwalkPick({ n: 1, s: 1 }).asset, 'tile_boardwalk_straight');
  assert.strictEqual(A.boardwalkPick({ n: 1, e: 1 }).asset, 'tile_boardwalk_corner');
  assert.strictEqual(A.unitForIndex(7), 'unit_parasol_coral');
  console.log('pm3dAssets OK');
})().catch((e) => { console.error(e); process.exit(1); });
