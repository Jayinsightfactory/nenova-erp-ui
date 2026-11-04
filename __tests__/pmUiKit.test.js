// __tests__/pmUiKit.test.js — /pm 버튼 일관성 가드: pages/pm.js·components/pm/* 에서 raw <button 금지(키트 components/pm/ui.js 만 허용)
// 실행: node __tests__/pmUiKit.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const KIT = path.join('components', 'pm', 'ui.js');
const files = [path.join('pages', 'pm.js'), ...fs.readdirSync(path.join(root, 'components', 'pm')).filter((f) => /\.jsx?$/.test(f)).map((f) => path.join('components', 'pm', f))];
const bad = [];
for (const f of files) {
  if (f === KIT) continue;
  fs.readFileSync(path.join(root, f), 'utf8').split('\n').forEach((line, i) => {
    if (/<button[\s>]/.test(line)) bad.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`);
  });
}
assert.deepStrictEqual(bad, [], `raw <button> 사용 금지 — components/pm/ui.js 의 Button/IconButton/LinkButton/ToggleChip/PersonChip/SelectCard/Tabs 를 쓰세요:\n${bad.join('\n')}`);
const kit = fs.readFileSync(path.join(root, KIT), 'utf8');
for (const name of ['Button', 'IconButton', 'LinkButton', 'ToggleChip', 'PersonChip', 'SelectCard', 'Tabs', 'Panel', 'Badge', 'PmUiStyles']) {
  assert.ok(kit.includes(`export function ${name}(`), `키트에 ${name} 없음`);
}
assert.ok(/--pmk-h: 44px/.test(kit), '모바일 터치 높이 44px 토큰');
console.log(`pmUiKit ok (${files.length - 1}개 파일, raw <button> 0)`);
