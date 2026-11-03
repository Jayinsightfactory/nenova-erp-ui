// __tests__/pmWallet.test.js — /pm 지갑·상점: 적립=성장점수 공용, 잔액 검증 구매, 중복·무료·테마 해금, 장착 잠금, 지난 날 적립 내역
// 실행: node __tests__/pmWallet.test.js (임시 파일만 사용, MSSQL 불필요)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmw-'));
const cjs = (f, exp) => fs.readFileSync(path.join(process.cwd(), 'lib', f), 'utf8')
  .replace(/^import (\w+) from '(\w+)';/gm, "const $1 = require('$2');")
  .replace(/^import \{([^}]+)\} from '\.\/pmGrow';/m, "const {$1} = require('./pmGrow.cjs');")
  .replace(/^export (const|function) /gm, '$1 ') + `\nmodule.exports = { ${exp} };`;
fs.writeFileSync(path.join(dir, 'pmGrow.cjs'), cjs('pmGrow.js', 'advanceGrow, kstDay, DAILY_CAP, EXCLUDED, RATE_WORK_PER_H, RATE_ACTIVE_PER_H'));
fs.writeFileSync(path.join(dir, 'pmWallet.cjs'), cjs('pmWallet.js', 'buy, walletOf, readShop, catalog, themeUnlocks, lockedOf, THEME_UNLOCK_MULT'));
const g = require(path.join(dir, 'pmGrow.cjs'));
const w = require(path.join(dir, 'pmWallet.cjs'));

const manifest = {
  characters: [{ id: 'human', name: '사람', price: 0 }, { id: 'cat', name: '고양이', price: 30 }],
  items: [{ id: 'hat.crown', name: '왕관', price: 240 }, { id: 'hat.cap', name: '야구모자', price: 30 }],
  themes: [{ id: 'office', price: 0 }, { id: 'harbor', price: 90 }],
};
const T0 = Date.parse('2026-11-02T01:00:00Z');
const office = (at) => ({ staff: [{ name: '설연주', dept: '경영지원', status: 'working', lastAt: new Date(at).toISOString(), workLabel: '발주작업 중' }] });
let st = null;
for (let i = 0; i <= 6 * 60; i++) st = g.advanceGrow(st, office(T0 + i * 60000), T0 + i * 60000); // 6h working → 하루 상한 60
assert.strictEqual(Math.round(st.people['설연주'].points), 60, '적립은 성장 점수 그대로(상한 60)');
const t2 = T0 + 24 * 3600000; // 다음 날
st = g.advanceGrow(st, office(t2), t2);
assert.strictEqual(st.people['설연주'].history.length, 1, '지난 날 적립이 내역에 남음');

const file = path.join(dir, 'shop.json');
const ctx = { growState: st, manifest, file };
let r = w.buy({ name: '설연주', id: 'hat.crown', by: 'nenovaSS3' }, ctx);
assert.strictEqual(r.status, 409, '잔액 부족이면 거절');
r = w.buy({ name: '설연주', id: 'hat.cap', by: 'nenovaSS3' }, ctx);
assert.ok(r.ok && r.wallet.balance === 30 && r.wallet.spent === 30, '구매 후 잔액 = 적립 − 구매');
r = w.buy({ name: '설연주', id: 'hat.cap', by: 'nenovaSS3' }, ctx);
assert.ok(r.ok && r.duplicate && r.wallet.balance === 30, '이미 산 것은 다시 차감 안 함');
assert.ok(w.buy({ name: '설연주', id: 'char.human' }, ctx).duplicate, '무료는 차감 없음');
assert.strictEqual(w.buy({ name: '설연주', id: 'theme.harbor' }, ctx).status, 400, '테마는 개인 구매 불가(팀 해금)');
assert.strictEqual(w.buy({ name: '손지윤', id: 'hat.cap' }, ctx).status, 400, '제외 인원');
assert.strictEqual(w.buy({ name: '없는사람', id: 'hat.cap' }, ctx).status, 404);
const shop = w.readShop(file);
assert.deepStrictEqual(w.lockedOf('설연주', { char: 'cat', items: { hat: 'hat.cap' } }, manifest, shop), ['char.cat'], '산 모자는 장착 가능, 안 산 고양이는 잠김');
const th = w.themeUnlocks(manifest, st);
assert.ok(th.find((t) => t.id === 'office').unlocked && !th.find((t) => t.id === 'harbor').unlocked, `팀 적립 ${Math.floor(st.people['설연주'].points)} < 90×${w.THEME_UNLOCK_MULT}`);
console.log('pmWallet ok');
