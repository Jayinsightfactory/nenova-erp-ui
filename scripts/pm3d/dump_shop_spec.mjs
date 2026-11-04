// scripts/pm3d/dump_shop_spec.mjs — 상점 렌더 스펙 덤프(한 곳 규칙: lib/pmThemes.PM3D.RACES · lib/pm3dLayout.look3d)
//   3D 장면과 상점 렌더가 같은 조합 규칙을 쓰도록, 웹 lib 를 그대로 import 해 Blender 가 읽을 JSON 으로 내린다.
// 실행: node scripts/pm3d/dump_shop_spec.mjs  → scripts/pm3d/shop_spec.json
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

const root = process.cwd();
const td = fs.mkdtempSync(path.join(os.tmpdir(), 'pmshopspec-'));
for (const n of ['pmThemes', 'pm3dLayout', 'pmMounts']) {
  fs.writeFileSync(path.join(td, `${n}.mjs`), fs.readFileSync(path.join(root, `lib/${n}.js`), 'utf8')
    .replace("'./pmThemes.js'", "'./pmThemes.mjs'"));
}
const T = await import(pathToFileURL(path.join(td, 'pmThemes.mjs')).href);
const L = await import(pathToFileURL(path.join(td, 'pm3dLayout.mjs')).href);
const M = await import(pathToFileURL(path.join(td, 'pmMounts.mjs')).href);
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/pm-themes/manifest.json'), 'utf8'));
const { OUTFIT_COLORS, DESK_SKINS, ui } = T.PM3D;

// lib/pm3dLayout.js 내부 hash 와 같은 식(책상 틴트·상판 소품 선택이 3D 장면과 같게)
const hash = (s) => { let h = 0; for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };

const characters = manifest.characters.map((c) => {
  const k = L.look3d({ char: c.id, items: {} }, 'preview'); // 'preview' 고정 — 종족 간 옷색 동일
  return { key: `char.${c.id}`, id: c.id, skin: k.skin, hair: k.hair, top: k.top, bottom: k.bottom, hideHair: k.hideHair, attach: k.attach, temp: k.raceTemp };
});
const items = [];
for (const it of manifest.items) {
  if (it.category === 'outfit') {
    const oc = OUTFIT_COLORS[it.id];
    if (oc) items.push({ key: it.id, kind: 'outfit', top: oc[0], bottom: oc[1], temp: false });
  } else if (it.category === 'hat') {
    items.push({ key: it.id, kind: 'hat', mesh: L.hatMesh(it.id), temp: true }); // 16종 → 리그 모자 3종 매핑(임시)
  } else if (it.category === 'desk') {
    items.push({ key: it.id, kind: 'kit', model: 'desk_k1', tint: DESK_SKINS[hash(it.id) % DESK_SKINS.length], temp: false }); // look3d 와 같은 틴트
  } else if (it.category === 'chair') {
    items.push({ key: it.id, kind: 'kit', model: hash(it.id) % 2 ? 'chair_k2' : 'chair_k1', tint: DESK_SKINS[hash(it.id) % DESK_SKINS.length], temp: true });
  } else if (it.category === 'rug') {
    items.push({ key: it.id, kind: 'kit', model: 'rug_k', tint: DESK_SKINS[hash(it.id) % DESK_SKINS.length], temp: true });
  } else if (it.category === 'deskTop') {
    items.push({ key: it.id, kind: 'kit', model: hash(it.id) % 2 ? 'mug' : 'plant_k2', temp: false }); // look3d props 와 같은 선택
  } else if (it.category === 'pet') {
    items.push({ key: it.id, kind: 'pet', tint: ui.pet, temp: true }); // 3D 펫은 공용 구체
  }
  // glasses / hand / badge / shelf: 3D 모델 없음 → 기존 그림 유지(보고 목록)
}
// 모자 레이어(미리보기 겹침용 — 종족 베이스와 같은 카메라)
const hatLayers = [...new Set(items.filter((x) => x.kind === 'hat').map((x) => x.mesh))];
const out = { generated: new Date().toISOString().slice(0, 10), characters, items, hatLayers, mounts: M.MOUNTS.map((m) => m.id) };
fs.writeFileSync(path.join(root, 'scripts/pm3d/shop_spec.json'), JSON.stringify(out, null, 1));
console.log('shop_spec.json: chars', characters.length, 'items', items.length, 'hatLayers', hatLayers.length);
