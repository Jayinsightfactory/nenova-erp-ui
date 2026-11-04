// __tests__/pmShopArt.test.js — 상점 그림 = 3D 모델 렌더 보증(scripts/pm3d/render_shop.py)
//   1) manifest 의 모든 src/icon 파일이 실재(깨진 카드 0)
//   2) 종족 10종: 렌더 실재 + 기본(human)과 시각적으로 구분(색 또는 부속 차이 — KayKit 교체 회귀 방지)
//   3) 렌더 총용량 ≤ 6MB(사장님 상한), 미리보기 레이어(옷 13·모자 3) 실재
// 실행: node __tests__/pmShopArt.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');

(async () => {
  const root = process.cwd();
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/pm-themes/manifest.json'), 'utf8'));
  const missing = [];
  const chk = (p) => { if (p && p.startsWith('/') && !fs.existsSync(path.join(root, 'public', p))) missing.push(p); };
  for (const c of manifest.characters) chk(c.src);
  for (const it of manifest.items) { chk(it.src); chk(it.icon); }
  assert.deepStrictEqual(missing, [], `상점 카드 그림 파일 없음:\n${missing.join('\n')}`);

  // 종족: 렌더 실재 + 기본과 구분(look3d 색/부속/머리 차이) — PM3D.RACES 한 표 기준
  const td = fs.mkdtempSync(path.join(os.tmpdir(), 'pmshopart-'));
  for (const n of ['pmThemes', 'pm3dLayout']) {
    fs.writeFileSync(path.join(td, `${n}.mjs`), fs.readFileSync(path.join(root, `lib/${n}.js`), 'utf8')
      .replace("'./pmThemes.js'", "'./pmThemes.mjs'"));
  }
  const L = await import(pathToFileURL(path.join(td, 'pm3dLayout.mjs')).href);
  const base = L.look3d({ char: 'human', items: {} }, 'x');
  assert.ok(base.hair, 'human 머리색 누락(hash >>> 회귀)');
  for (const c of manifest.characters) {
    assert.ok(fs.existsSync(path.join(root, 'public/pm/shop', `char.${c.id}.webp`)), `종족 렌더 없음: char.${c.id}.webp`);
    if (c.id === 'human') continue;
    const k = L.look3d({ char: c.id, items: {} }, 'x');
    const distinct = k.skin !== base.skin || k.hair !== base.hair || k.hideHair !== base.hideHair || !!k.raceMesh;
    assert.ok(distinct, `종족 ${c.id} 가 기본 모습과 시각적으로 구분되지 않음(PM3D.RACES 확인)`);
    assert.ok(k.raceMesh && /^race_/.test(k.raceMesh), `종족 ${c.id} 전용 부속 메시 없음(PM3D.RACES.mesh)`);
    assert.strictEqual(k.char, c.id, `look3d 가 종족 ${c.id} 를 전달하지 않음`);
  }
  // 미리보기 레이어(같은 카메라 겹침): 옷 + 착용 소품(모자·안경·손·배지) 전용 메시 레이어 전부 실재
  const layerFiles = ['layer.outfit.knit'];
  for (const it of manifest.items) {
    if (['hat', 'glasses', 'hand', 'badge'].includes(it.category)) {
      const mesh = L.wearMesh(it.category, it.id);
      assert.ok(mesh, `wearMesh 매핑 없음: ${it.id}`);
      layerFiles.push(`layer.${mesh}`);
      assert.ok(fs.existsSync(path.join(root, 'public/pm/shop', `${it.id}.webp`)), `착용 소품 카드 렌더 없음: ${it.id}.webp`);
    }
    if (it.category === 'shelf') assert.ok(fs.existsSync(path.join(root, 'public/pm/shop', `${it.id}.webp`)), `책장 카드 렌더 없음: ${it.id}.webp`);
  }
  for (const f of layerFiles) {
    assert.ok(fs.existsSync(path.join(root, 'public/pm/shop', `${f}.webp`)), `미리보기 레이어 없음: ${f}.webp`);
  }
  // 총용량 상한
  const dir = path.join(root, 'public/pm/shop');
  const total = fs.readdirSync(dir).reduce((s, f) => s + fs.statSync(path.join(dir, f)).size, 0);
  assert.ok(total <= 6 * 1024 * 1024, `상점 렌더 총용량 ${(total / 1048576).toFixed(2)}MB > 6MB`);
  console.log(`pmShopArt OK — 렌더 ${fs.readdirSync(dir).length}개, 총 ${(total / 1048576).toFixed(2)}MB`);
})().catch((e) => { console.error(e); process.exit(1); });
