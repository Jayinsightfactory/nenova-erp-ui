// __tests__/pmAvatars.test.js — /pm 캐릭터 꾸미기 저장: 저장·검증·삭제
// 실행: node __tests__/pmAvatars.test.js (임시 파일만 사용, MSSQL 불필요)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const src = fs.readFileSync(path.join(process.cwd(), 'lib', 'pmAvatars.js'), 'utf8')
  .replace(/^import (\w+) from '(\w+)';/gm, "const $1 = require('$2');")
  .replace(/^export (const|function) /gm, '$1 ')
  + '\nmodule.exports = { saveAvatar, readAvatars, cleanAvatar };';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmav-'));
fs.writeFileSync(path.join(dir, 'pmAvatars.cjs'), src);
const { saveAvatar, readAvatars, cleanAvatar } = require(path.join(dir, 'pmAvatars.cjs'));

const file = path.join(dir, 'a.json');
assert.deepStrictEqual(readAvatars(file), {});
let r = saveAvatar('강현우', { char: 'cat', items: { hat: 'hat.crown', pet: 'pet.bee' } }, 'nenovaSS3', { file });
assert.ok(r.ok);
assert.strictEqual(readAvatars(file)['강현우'].items.hat, 'hat.crown');
assert.strictEqual(cleanAvatar({ items: { hat: 'glasses.sun' } }), null, '슬롯-카테고리 불일치 거부');
assert.strictEqual(cleanAvatar({ char: '<script>' }), null, '이상한 id 거부');
assert.strictEqual(saveAvatar('', { char: 'cat' }, '', { file }).status, 400);
r = saveAvatar('강현우', { char: '', items: {} }, 'x', { file });
assert.ok(r.ok && !readAvatars(file)['강현우'], '빈 값=삭제');
// 테마 = 직원별 서버 저장(꾸미기와 독립)
r = saveAvatar('설연주', { themeOnly: true, theme: 'C' }, 'x', { file });
assert.ok(r.ok && readAvatars(file)['설연주'].theme === 'C', '테마만 저장');
r = saveAvatar('설연주', { char: 'cat', items: {} }, 'x', { file });
assert.strictEqual(readAvatars(file)['설연주'].theme, 'C', '꾸미기 저장해도 테마 유지');
assert.strictEqual(saveAvatar('설연주', { themeOnly: true, theme: 'zz' }, 'x', { file }).status, 400, '이상한 테마 거부');
console.log('pmAvatars ok');
