// __tests__/pmNoHexColor.test.js — /pm 색 하드코딩 가드: 색은 lib/pmThemes.js 토큰(var(--pm-*))만.
//   pages/pm.js · components/pm/** · lib/pm*.js 에서 #hex 색 금지(lib/pmThemes.js 만 허용). 10종 테마 토큰 완결성도 검사.
// 실행: node __tests__/pmNoHexColor.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const walk = (d) => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.jsx?$/.test(e.name) ? [path.join(d, e.name)] : []));
const files = [path.join('pages', 'pm.js'), ...walk(path.join('components', 'pm')), ...fs.readdirSync(path.join(root, 'lib')).filter((f) => /^pm.*\.js$/.test(f)).map((f) => path.join('lib', f))];
const ALLOW = path.join('lib', 'pmThemes.js');
const HEX = /(^|[^&\w$])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/;
const bad = [];
for (const f of files) {
  if (f === ALLOW) continue;
  fs.readFileSync(path.join(root, f), 'utf8').split('\n').forEach((line, i) => { if (HEX.test(line)) bad.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`); });
}
assert.deepStrictEqual(bad, [], `하드코딩 색(#hex) 금지 — lib/pmThemes.js 토큰을 var(--pm-*) 로 쓰세요:\n${bad.join('\n')}`);

// 테마 10종 · 같은 토큰 키 · 썸네일/텍스처 파일 존재(각 500KB 이하)
const src = fs.readFileSync(path.join(root, ALLOW), 'utf8');
const ids = [...src.matchAll(/\{ id: '([A-Z])', name: '/g)].map((m) => m[1]);
assert.deepStrictEqual(ids, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'], '테마 10종 A~J');
assert.ok(/PM_DEFAULT_THEME = 'I'/.test(src), '기본 테마 = I(해변) — 2026-11-04 사장님 확정');
assert.ok(/PM_THEMES_VISIBLE = \['I'\]/.test(src), '노출 테마 = I 하나(나머지 보존·숨김)');
const NEED = ['bg', 'surface', 'surface2', 'ink', 'muted', 'accent', 'accentInk', 'accent2', 'line', 'header', 'headerInk', 'hall', 'hallInk', 'plate', 'plateInk', 'link', 'radius', 'shadow', 'font'];
for (const block of src.split(/\n  \{ id: '/).slice(1)) {
  const id = block[0];
  for (const k of NEED) assert.ok(new RegExp(`[{ ]${k}: `).test(block), `테마 ${id} 토큰 ${k} 없음`);
  for (const kind of ['thumb', 'bg']) {
    const f = path.join(root, 'public', 'pm', 'themes', `${id}-${kind}.jpg`);
    assert.ok(fs.existsSync(f), `${f} 없음`);
    assert.ok(fs.statSync(f).size <= 500 * 1024, `${f} 500KB 초과`);
  }
}
console.log(`pmNoHexColor ok (${files.length - 1}개 파일 hex 0, 테마 ${ids.length}종)`);
