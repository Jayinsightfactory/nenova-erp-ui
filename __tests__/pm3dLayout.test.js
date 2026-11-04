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
    assert.ok(Math.abs(a.x - b.x) >= 1.3 || Math.abs(a.z - b.z) >= 1.3, `책상 겹침 ${a.name}/${b.name}`);
  }
  for (const d of desks) assert.ok(Math.abs(d.z) >= 3, '책상이 스테이션 복도를 침범');
  const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => L.stationPos(n).x);
  assert.ok(xs.every((x, i) => i === 0 || x > xs[i - 1]));
  const lk = L.look3d({ items: { outfit: 'outfit.aloha', hat: 'hat.straw', deskL: 'desk.mug', pet: 'pet.cat' }, skin: 1, hairColor: 2 }, '홍길동');
  assert.deepStrictEqual([lk.top, lk.bottom, lk.hat, lk.pet, lk.props.length], ['#ff9a3c', '#3ab0c8', 'hat_straw', true, 1]);
  assert.strictEqual(L.look3d(null, 'a').hat, '');
  assert.strictEqual(L.animOf({ status: 'off' }).clip, 'doze');
  assert.strictEqual(L.animOf({ status: 'working' }).clip, 'sit_type');
  assert.strictEqual(L.shouldFallback({ firstFrameMs: 3500, fps: 60 }), 'slow-first-frame');
  assert.strictEqual(L.shouldFallback({ firstFrameMs: 200, fps: 12 }), 'low-fps');
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
  for (const m of ['floor_b', 'floor_i', 'wall', 'desk', 'chair', 'monitor', 'robot', 'plant', 'mug', 'parcel', 'palm', 'parasol', 'boardwalk', 'hut', 'sea', ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `station_${n}`)]) assert.ok(names.has(m), `kit 모듈 없음: ${m}`);
  const ch = gl('char.glb'); const clips = ch.animations.map((x) => x.name);
  for (const c of ['idle', 'sit_type', 'walk', 'doze', 'dance']) assert.ok(clips.includes(c), `클립 없음: ${c}`);
  for (const h of ['hat_cap', 'hat_straw', 'hat_party']) assert.ok(ch.nodes.some((n) => n.name === h), `모자 없음: ${h}`);
  // 휠 확대 금지(사장님 지시)
  const src = fs.readFileSync(path.join(process.cwd(), 'components/pm3d/Scene3D.js'), 'utf8');
  assert.ok(!/['"]wheel['"]/.test(src), '3D 장면에 휠 핸들러 금지');
  console.log(`pm3dLayout OK (assets ${(total / 1024).toFixed(0)}KB)`);
})().catch((e) => { console.error(e); process.exit(1); });
