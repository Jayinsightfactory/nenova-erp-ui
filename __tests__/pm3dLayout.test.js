// __tests__/pm3dLayout.test.js — /pm 3D(베타): 책상 배치 겹침 없음·스테이션 9개·외형 매핑·저사양 폴백·라벨 겹침 회피·에셋 용량.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');
(async () => {
  const td = fs.mkdtempSync(path.join(os.tmpdir(), 'pm3d-'));
  for (const n of ['pm3dLayout', 'pmThemes']) fs.writeFileSync(path.join(td, `${n}.mjs`), fs.readFileSync(path.join(process.cwd(), `lib/${n}.js`), 'utf8').replace("'./pmThemes.js'", "'./pmThemes.mjs'"));
  const L = await import(pathToFileURL(path.join(td, 'pm3dLayout.mjs')).href); fs.rmSync(td, { recursive: true, force: true });
  const rooms = [['영업지원', 3], ['수입부', 2], ['영업부', 3], ['경영지원', 1], ['미배치', 5]].map(([dept, n]) => ({ dept, seats: Array.from({ length: n }, (_, i) => ({ name: `${dept}${i}`, status: i % 2 ? 'off' : 'working' })) }));
  const { desks } = L.layoutDesks(rooms);
  assert.strictEqual(desks.length, 14);
  for (let i = 0; i < desks.length; i++) for (let j = i + 1; j < desks.length; j++) {
    const a = desks[i]; const b = desks[j];
    assert.ok(Math.abs(a.x - b.x) >= 1.9 || Math.abs(a.z - b.z) >= 1.9, `책상 겹침 ${a.name}/${b.name}`);
  }
  for (const d of desks) assert.ok(Math.abs(d.z) >= 3, '책상이 스테이션 복도를 침범');
  // 뒤통수 금지: 모든 좌석 방향 · 카메라 방향 내적 > 0.3
  for (const d of desks) assert.ok(L.facingDot(d.yaw) > 0.3, `좌석이 카메라 반대쪽: ${d.name} dot=${L.facingDot(d.yaw).toFixed(2)}`);
  for (let i = 0; i < 30; i++) assert.ok(L.facingDot(L.seatYaw(i)) > 0.99, '일자 라인: 전원 카메라 정면');
  // 일자 라인: z 값은 줄(±3.2, ±5.5) 위에만
  for (const d of desks) assert.ok([4, 6.6].includes(Math.abs(+d.z.toFixed(1))), `책상이 줄 밖: ${d.name} z=${d.z}`);
  const st1 = L.deskStyle('영업지원', '', ['#a', '#b']); assert.ok(L.DESK_MODELS.includes(st1.model) && st1.color);
  assert.strictEqual(L.deskStyle('x', '#own', ['#a']).color, '#own');
  // 연결선 아치-캐릭터 바운딩 교차 0: 모든 좌석→모든 스테이션 아치를 샘플링,
  // 다른 좌석 반경 0.45m 안에서는 높이가 머리(2.2m)보다 위여야 한다.
  {
    const seats = desks.map((d) => L.seatWorld(d));
    for (const d of desks) {
      const s0 = L.seatWorld(d);
      for (let st2 = 1; st2 <= 9; st2++) {
        const sp = L.stationPos(st2);
        for (let k = 0; k <= 40; k++) {
          const t = k / 40;
          const x = s0.x + (sp.x - s0.x) * t; const z = s0.z + (sp.z - s0.z) * t; const y = L.arcY(t);
          for (const o of seats) {
            if (o === s0 && t < 0.02) continue;
            const dd = Math.hypot(x - o.x, z - o.z);
            if (dd < 0.45) assert.ok(y > L.CHAR_TOP, `연결선이 캐릭터 관통: t=${t} y=${y.toFixed(2)}`);
          }
        }
      }
    }
  }
  // 비율: 1440x720 화면 100% 기본 배율에서 캐릭터 90~110px, 9 스테이션 전부 보임
  const { hx, hz } = L.floorBounds(desks);
  const fit = L.sceneFit(hx, hz);
  const px = L.charPixelHeight(720, fit);
  assert.ok(px >= 90 && px <= 110, `캐릭터 화면 높이 ${px.toFixed(0)}px (목표 90~110)`);
  assert.ok((fit / L.DEFAULT_ZOOM) * 2 >= L.stationPos(9).x + 0.4, '기본 배율에서 9 스테이션 전부 보임(1440 화면)');
  const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => L.stationPos(n).x);
  assert.ok(xs.every((x, i) => i === 0 || x > xs[i - 1]));
  const lk = L.look3d({ items: { outfit: 'outfit.aloha', hat: 'hat.straw', deskL: 'desk.mug', pet: 'pet.cat' }, skin: 1, hairColor: 2 }, '홍길동');
  assert.deepStrictEqual([lk.top, lk.bottom, lk.hat, lk.pet, lk.props.length], ['#ff9a3c', '#3ab0c8', 'hat_straw', true, 1]);
  assert.strictEqual(L.look3d(null, 'a').hat, '');
  assert.strictEqual(L.animOf({ status: 'off' }).clip, 'doze');
  assert.strictEqual(L.animOf({ status: 'working' }).clip, 'sit_type');
  assert.strictEqual(L.shouldFallback({ firstFrameMs: 3500, fps: 60 }), 'slow-first-frame');
  assert.strictEqual(L.shouldFallback({ firstFrameMs: 200, fps: 9 }), 'low-fps');
  assert.strictEqual(L.shouldFallback({ firstFrameMs: 200, fps: 12 }), '');
  assert.deepStrictEqual([L.MIN_FPS, L.FPS_WARMUP_MS, L.FPS_WINDOW_MS, L.FPS_CAP, L.FPS_IDLE, L.MAX_DPR], [10, 3000, 5000, 24, 8, 1.5]);
  assert.strictEqual(L.shouldFallback({ firstFrameMs: 200, fps: 55 }), '');
  const out = L.declutter([{ key: 'a', x: 100, y: 50, w: 60, h: 18 }, { key: 'b', x: 110, y: 55, w: 60, h: 18 }, { key: 'c', x: 400, y: 52, w: 60, h: 18 }]);
  const a = out.find((o) => o.key === 'a'); const b = out.find((o) => o.key === 'b');
  assert.ok(b.y >= a.y + a.h, '라벨 겹침'); assert.strictEqual(out.find((o) => o.key === 'c').y, 52);
  // 에셋: 존재·첫 로드 합계 8MB 이하·필수 모듈·클립
  const dir = path.join(process.cwd(), 'public/pm3d');
  const files = ['kit.glb', 'char.glb', 'draco/draco_decoder.wasm', 'draco/draco_wasm_wrapper.js'];
  const total = files.reduce((s, x) => s + fs.statSync(path.join(dir, x)).size, 0);
  assert.ok(total < 8 * 1024 * 1024, `3D 첫 로드 ${total}B > 8MB`);
  const gl = (n) => { const b = fs.readFileSync(path.join(dir, n)); return JSON.parse(b.slice(20, 20 + b.readUInt32LE(12)).toString()); };
  const kit = gl('kit.glb'); const names = new Set(kit.nodes.map((n) => n.name));
  for (const m of ['floor_b', 'floor_i', 'wall', 'desk', 'desk_b', 'desk_c', 'chair', 'desk_k1', 'desk_k2', 'desk_k3', 'chair_k1', 'chair_k2', 'plant_k1', 'plant_k2', 'lamp_k', 'rug_k', 'shell', 'starfish', 'monitor', 'robot', 'plant', 'mug', 'parcel', 'palm', 'parasol', 'boardwalk', 'hut', 'sea', ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `station_${n}`)]) assert.ok(names.has(m), `kit 모듈 없음: ${m}`);
  const ch = gl('char.glb'); const clips = ch.animations.map((x) => x.name);
  for (const c of ['idle', 'sit_type', 'walk', 'doze', 'dance']) assert.ok(clips.includes(c), `클립 없음: ${c}`);
  for (const h of ['hat_cap', 'hat_straw', 'hat_party']) assert.ok(ch.nodes.some((n) => n.name === h), `모자 없음: ${h}`);
  // 휠 확대 금지(사장님 지시)
  const src = fs.readFileSync(path.join(process.cwd(), 'components/pm3d/Scene3D.js'), 'utf8');
  assert.ok(!/['"]wheel['"]/.test(src), '3D 장면에 휠 핸들러 금지');
  assert.ok(/data-k=\{'w:' \+ p\.name\}/.test(src) && !/\{p\.name\}\{l\?\.text/.test(src), '이름·작업 칩 분리');
  assert.ok(/MAX_DPR/.test(src) && /FPS_CAP/.test(src) && /IntersectionObserver/.test(src), '3D 프레임 상한·화면밖 정지');
  assert.ok(!/d\.face/.test(src), '옛 좌석 방향(face) 사용 금지');
  console.log(`pm3dLayout OK (assets ${(total / 1024).toFixed(0)}KB)`);
})().catch((e) => { console.error(e); process.exit(1); });
