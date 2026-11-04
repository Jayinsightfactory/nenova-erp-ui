// scripts/pm3d/apply_shop_renders.mjs — public/pm/shop/<key>.webp 렌더가 있으면 상점 manifest 의 src 를 그 렌더로 교체.
//   렌더가 없는 품목은 기존 그림 유지(혼용 허용). 실행: node scripts/pm3d/apply_shop_renders.mjs
import fs from 'fs';
import path from 'path';

const root = process.cwd();
const mf = path.join(root, 'public/pm-themes/manifest.json');
const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
const has = (k) => fs.existsSync(path.join(root, 'public/pm/shop', `${k}.webp`));
let swapped = 0; const kept = [];
for (const c of m.characters) {
  if (has(`char.${c.id}`)) { c.src = `/pm/shop/char.${c.id}.webp`; swapped++; } else kept.push(`char.${c.id}`);
}
for (const it of m.items) {
  if (has(it.id)) { it.src = `/pm/shop/${it.id}.webp`; if (it.icon) it.icon = `/pm/shop/${it.id}.webp`; swapped++; }
  else if (it.category === 'outfit' && has(`layer.${it.id}`)) { it.src = `/pm/shop/layer.${it.id}.webp`; if (it.icon) it.icon = `/pm/shop/layer.${it.id}.webp`; swapped++; }
  else kept.push(it.id);
}
fs.writeFileSync(mf, JSON.stringify(m, null, 1));
console.log('swapped', swapped, '| 기존 그림 유지:', kept.join(' '));
