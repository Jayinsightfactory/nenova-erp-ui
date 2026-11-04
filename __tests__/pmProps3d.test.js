// __tests__/pmProps3d.test.js — 착용 소품·종족 부속 "3D 실재" 보증(사장님 지시: 손그림·임시 종족 0)
//   1) char.glb 에 전용 메시 실재: 모자 16(hat_*) · 안경 6(gls_*) · 손 10(hnd_*) · 배지 7(bdg_*) · 종족 9(race_*)
//      — lib/pm3dLayout.wearMesh / PM3D.RACES.mesh 와 이름 일치(Scene3D 는 이름 일치로 보이기/숨기기)
//   2) kit.glb 에 책장 4종 모듈(shelf_*) 실재 — lib/pm3dLayout.shelfModel 과 일치
//   3) look3d 경유가 끊기지 않음: items.{hat,glasses,hand,badge,shelf} → L.{hat,glasses,hand,badge,shelf}
//   4) 종족 temp(임시 표기) 0 — 전 종족 전용 메시로 승격됨
//   5) char.glb 애니메이션 클립 유지(재빌드 회귀 방지: idle/sit_type/walk/doze/cheer/wave/dance)
// 실행: node __tests__/pmProps3d.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');

function glbJson(file) {
  const d = fs.readFileSync(file);
  assert.strictEqual(d.readUInt32LE(0), 0x46546c67, 'glb magic');
  const len = d.readUInt32LE(12);
  return JSON.parse(d.slice(20, 20 + len).toString('utf8'));
}

(async () => {
  const root = process.cwd();
  const td = fs.mkdtempSync(path.join(os.tmpdir(), 'pmprops3d-'));
  for (const n of ['pmThemes', 'pm3dLayout']) {
    fs.writeFileSync(path.join(td, `${n}.mjs`), fs.readFileSync(path.join(root, `lib/${n}.js`), 'utf8')
      .replace("'./pmThemes.js'", "'./pmThemes.mjs'"));
  }
  const T = await import(pathToFileURL(path.join(td, 'pmThemes.mjs')).href);
  const L = await import(pathToFileURL(path.join(td, 'pm3dLayout.mjs')).href);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/pm-themes/manifest.json'), 'utf8'));

  // char.glb 노드 이름(스키닝 메시 포함)
  const cj = glbJson(path.join(root, 'public/pm3d/char.glb'));
  const charNodes = new Set((cj.nodes || []).map((n) => n.name));

  const need = { hat: 16, glasses: 6, hand: 10, badge: 7 };
  const seen = { hat: 0, glasses: 0, hand: 0, badge: 0 };
  const missing = [];
  for (const it of manifest.items) {
    if (['hat', 'glasses', 'hand', 'badge'].includes(it.category)) {
      const mesh = L.wearMesh(it.category, it.id);
      assert.ok(mesh, `wearMesh 매핑 없음: ${it.id}`);
      if (!charNodes.has(mesh)) missing.push(`${it.id} → ${mesh}`);
      seen[it.category]++;
      // 저장값 → look3d 경유
      const slotKey = it.category;
      const look = L.look3d({ items: { [slotKey]: it.id } }, 'x');
      assert.strictEqual(look[slotKey === 'hat' ? 'hat' : slotKey], mesh, `look3d 경유 끊김: ${it.id}`);
    }
  }
  assert.deepStrictEqual(missing, [], `char.glb 에 착용 메시 없음:\n${missing.join('\n')}`);
  for (const [k, n] of Object.entries(need)) assert.strictEqual(seen[k], n, `${k} 품목 수 ${seen[k]} ≠ ${n}`);

  // 종족: 전용 메시 + temp 0
  for (const c of manifest.characters) {
    const race = T.PM3D.RACES[c.id];
    assert.ok(race, `RACES 에 없음: ${c.id}`);
    assert.ok(!race.temp, `종족 ${c.id} 가 아직 임시(temp)`);
    if (c.id === 'human') continue;
    assert.ok(race.mesh && charNodes.has(race.mesh), `char.glb 에 종족 부속 메시 없음: ${c.id} → ${race.mesh}`);
  }

  // kit.glb: 책장 4종 모듈
  const kj = glbJson(path.join(root, 'public/pm3d/kit.glb'));
  const kitNodes = new Set((kj.nodes || []).map((n) => n.name));
  for (const it of manifest.items.filter((x) => x.category === 'shelf')) {
    const model = L.shelfModel(it.id);
    assert.ok(model && kitNodes.has(model), `kit.glb 에 책장 모듈 없음: ${it.id} → ${model}`);
    assert.strictEqual(L.look3d({ items: { shelf: it.id } }, 'x').shelf, model, `look3d.shelf 경유 끊김: ${it.id}`);
  }

  // 애니메이션 클립 유지(재빌드 회귀)
  const anims = new Set((cj.animations || []).map((a) => a.name));
  for (const a of ['idle', 'sit_type', 'walk', 'doze', 'cheer', 'wave', 'dance']) {
    assert.ok(anims.has(a), `char.glb 애니메이션 유실: ${a} (보유: ${[...anims].join(', ')})`);
  }

  // glb 총용량 상한 8MB(사장님 상한)
  const total = ['char.glb', 'kit.glb', 'mounts.glb', 'fx.glb'].reduce((s, f) => s + fs.statSync(path.join(root, 'public/pm3d', f)).size, 0);
  assert.ok(total <= 8 * 1024 * 1024, `pm3d glb 총용량 ${(total / 1048576).toFixed(2)}MB > 8MB`);
  console.log(`pmProps3d OK — 착용 39 + 종족 9 + 책장 4 · glb 총 ${(total / 1048576).toFixed(2)}MB`);
})().catch((e) => { console.error(e); process.exit(1); });
