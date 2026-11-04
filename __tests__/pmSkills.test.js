// __tests__/pmSkills.test.js — /pm 스킬·탈것: 카탈로그 수·트리거·쿨다운·동시표시 상한·상점 등록·구매/장착·자유이용권·단계 해금·색 토큰
// 실행: node __tests__/pmSkills.test.js (임시 파일만, MSSQL 불필요)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmsk-'));
const cjs = (f, exp) => fs.readFileSync(path.join(process.cwd(), 'lib', f), 'utf8')
  .replace(/^import (\w+) from '(\w+)';/gm, "const $1 = require('$2');")
  .replace(/^import \{([^}]+)\} from '\.\/(\w+)';/gm, "const {$1} = require('./$2.cjs');")
  .replace(/^export (const|function) /gm, '$1 ') + `\nmodule.exports = { ${exp} };`;
fs.writeFileSync(path.join(dir, 'pmSkills.cjs'), cjs('pmSkills.js', 'BASE_SKILLS, SHOP_SKILLS, FX_RULES, FX_RARITY, nextCasts, pickSkill, castSpec, skillShopItems, fxColor, skillById'));
fs.writeFileSync(path.join(dir, 'pmMounts.cjs'), cjs('pmMounts.js', 'MOUNTS, mountShopItems, mountById, mountPose'));
fs.writeFileSync(path.join(dir, 'pmFxShop.cjs'), cjs('pmFxShop.js', 'withFx, fxStageLocked'));
fs.writeFileSync(path.join(dir, 'pmGrow.cjs'), cjs('pmGrow.js', 'advanceGrow, kstDay, DAILY_CAP, EXCLUDED, RATE_WORK_PER_H, RATE_ACTIVE_PER_H'));
fs.writeFileSync(path.join(dir, 'pmWallet.cjs'), cjs('pmWallet.js', 'buy, walletOf, catalog, lockedOf'));
fs.writeFileSync(path.join(dir, 'pmFreePass.cjs'), cjs('pmFreePass.js', 'passOf, effectiveCfg, DEFAULT_PASS'));
fs.writeFileSync(path.join(dir, 'pmAvatars.cjs'), cjs('pmAvatars.js', 'cleanAvatar'));
const S = require(path.join(dir, 'pmSkills.cjs'));
const M = require(path.join(dir, 'pmMounts.cjs'));
const X = require(path.join(dir, 'pmFxShop.cjs'));
const W = require(path.join(dir, 'pmWallet.cjs'));
const P = require(path.join(dir, 'pmFreePass.cjs'));
const A = require(path.join(dir, 'pmAvatars.cjs'));

// 카탈로그
assert.strictEqual(S.BASE_SKILLS.length, 9, '단계별 기본 9종');
assert.deepStrictEqual(S.BASE_SKILLS.map((s) => s.stage), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
assert.ok(S.SHOP_SKILLS.length >= 20, '구매형 20종 이상');
assert.ok(M.MOUNTS.length >= 10, '탈것 10종 이상');
const ids = [...S.BASE_SKILLS, ...S.SHOP_SKILLS].map((s) => s.id);
assert.strictEqual(new Set(ids).size, ids.length, '스킬 id 중복 없음');
for (const s of [...S.BASE_SKILLS, ...S.SHOP_SKILLS]) {
  assert.ok(S.FX_RARITY[s.rarity], `${s.id} 등급`);
  assert.ok(['line', 'curve', 'bounce'].includes(s.trail), `${s.id} 궤적`);
  for (const t of s.palette) assert.ok(/^[a-z][a-z0-9]*$/.test(t), `${s.id} 팔레트는 토큰 이름만`);
}
for (const x of [...S.skillShopItems(), ...M.mountShopItems()]) assert.ok(/^[a-z0-9.-]{1,40}$/.test(x.id), `id 규칙 ${x.id}`);
assert.strictEqual(S.fxColor('stage', 3), 'var(--pm-stage-3)');
assert.strictEqual(S.fxColor('accent2', 1), 'var(--pm-accent2)');
assert.strictEqual(S.fxColor('bad-token!', 1), 'var(--pm-link)', '이상한 토큰 거부');

// 트리거
const L = (name, stage) => ({ name, stage, kind: 'current' });
const t0 = 1800000000000;
let r = S.nextCasts(null, { lines: [L('설연주', 3)] }, t0);
assert.strictEqual(r.casts.length, 0, '첫 호출은 기준만');
r = S.nextCasts(r.state, { lines: [L('설연주', 3), L('강현우', 1)] }, t0 + 1000);
assert.deepStrictEqual(r.casts.map((c) => [c.name, c.tier, c.reason]), [['강현우', 'basic', 'start']], '작업 시작 = 기본공격');
r = S.nextCasts(r.state, { lines: [L('설연주', 3), L('강현우', 5)] }, t0 + 4000);
assert.strictEqual(r.casts.length, 0, '같은 사람 8초 간격(쿨다운)');
r = S.nextCasts(r.state, { lines: [L('설연주', 3), L('강현우', 2)] }, t0 + 12000);
assert.deepStrictEqual(r.casts.map((c) => [c.name, c.stage, c.reason]), [['강현우', 2, 'switch']], '전환 = 기본공격');
r = S.nextCasts(r.state, { lines: [L('설연주', 3), L('강현우', 2)] }, t0 + 20 * 60000 + 500);
assert.ok(r.casts.some((c) => c.name === '설연주' && c.tier === 'skill' && c.reason === 'combo20'), '같은 작업 연속 20분 = 스킬');
r = S.nextCasts(r.state, { lines: [L('설연주', 3)] }, t0 + 20 * 60000 + 900);
assert.ok(!r.casts.some((c) => c.tier === 'skill'), '스킬은 20분당 1회');
r = S.nextCasts(r.state, { lines: [L('설연주', 3)], dances: { 설연주: 'jump', 강현우: 'spin' } }, t0 + 20 * 60000 + 5000);
assert.deepStrictEqual(r.casts.map((c) => c.reason).sort(), ['deployed', 'goal'], '목표 달성·배포 = 궁극기(궁극기 간격 3초)');
// 동시 표시 상한 + 우선순위
const s2 = S.nextCasts(null, { lines: [] }, t0).state;
const many = ['a', 'b', 'c', 'd', 'e', 'f'].map((n, i) => L(n, (i % 9) + 1));
r = S.nextCasts(s2, { lines: many }, t0 + 1);
assert.strictEqual(r.casts.length, S.FX_RULES.maxConcurrent, '동시 상한');
r = S.nextCasts(r.state, { lines: many, dances: { f: 'cheer' } }, t0 + 100);
assert.deepStrictEqual(r.casts.map((c) => [c.name, c.tier]), [['f', 'ult']], '상한 가득이면 궁극기가 기본공격을 밀어냄');
assert.strictEqual(r.state.active.length, S.FX_RULES.maxConcurrent);
r = S.nextCasts(r.state, { lines: many }, t0 + 60000);
assert.strictEqual(r.state.active.length, 0, '지속시간 지나면 비워짐');

// 장착·재생 정의
assert.strictEqual(S.pickSkill('basic', 5, {}).id, 'est-bolt', '장착 없으면 단계 기본(견적=번개)');
assert.strictEqual(S.pickSkill('basic', 5, { skillBasic: 'skill.bubble' }).id, 'bubble');
assert.strictEqual(S.pickSkill('ult', 5, { skillUlt: 'skill.phoenix' }).id, 'phoenix');
const sp = S.castSpec(S.skillById('meteor'), { name: 'x', stage: 2, tier: 'ult' }, false);
assert.ok(sp.count > 0 && sp.colors.every((c) => c.startsWith('var(--pm-')));
const rd = S.castSpec(S.skillById('meteor'), { name: 'x', stage: 2, tier: 'ult' }, true);
assert.ok(rd.count === 0 && rd.hit === 'highlight', 'reduced-motion = 정적 하이라이트');
assert.strictEqual(M.mountPose('off'), 'hidden');
assert.strictEqual(M.mountPose('working', true), 'ride');

// 상점 등록·구매·장착 잠금
const mf = X.withFx({ characters: [], items: [], themes: [] });
const cat = W.catalog(mf);
assert.ok(cat.some((x) => x.id === 'skill.phoenix') && cat.some((x) => x.id === 'mount.kickboard'), '카탈로그에 스킬·탈것');
const grow = { version: 1, people: { 강현우: { points: 100, history: [], today: null } } };
const file = path.join(dir, 'shop.json');
let b = W.buy({ name: '강현우', id: 'skill.bubble' }, { growState: grow, manifest: mf, file });
assert.ok(b.ok && b.wallet.balance === 70, '스킬 구매(30)');
b = W.buy({ name: '강현우', id: 'mount.unicorn' }, { growState: grow, manifest: mf, file });
assert.strictEqual(b.status, 409, '잔액 부족');
const shop = JSON.parse(fs.readFileSync(file, 'utf8'));
const cfg = { char: '', items: { skillBasic: 'skill.bubble', mount: 'mount.kickboard' } };
assert.deepStrictEqual(W.lockedOf('강현우', cfg, mf, shop), ['mount.kickboard'], '안 산 탈것 잠김');
assert.ok(A.cleanAvatar(cfg), '장착 슬롯 저장 허용');
assert.strictEqual(A.cleanAvatar({ items: { mount: 'skill.bubble' } }), null, '슬롯-접두어 불일치 거부');
// 자유이용권(2026-11-04~11-10 전체 무료)
const passes = { default: { ...P.DEFAULT_PASS }, people: {} };
const on = P.passOf('강현우', passes, Date.parse('2026-11-10T12:00:00+09:00'));
const off = P.passOf('강현우', passes, Date.parse('2026-11-11T00:00:00+09:00'));
assert.ok(on.active && !off.active, '11/10까지 자유이용권');
assert.strictEqual(P.effectiveCfg(cfg, on, ['mount.kickboard']).items.mount, 'mount.kickboard', '이용권 중 장착 유지');
assert.strictEqual(P.effectiveCfg(cfg, off, ['mount.kickboard']).items.mount, undefined, '만료 후 안 산 탈것 해제');
// 성장 단계 해금
assert.deepStrictEqual(X.fxStageLocked({ skillUlt: 'skill.phoenix' }, 2, false), ['skill.phoenix'], '전설=4단계');
assert.deepStrictEqual(X.fxStageLocked({ skillUlt: 'skill.phoenix' }, 2, true), [], '이용권 중 단계 잠금 해제');
assert.deepStrictEqual(X.fxStageLocked({ skillUlt: 'skill.phoenix' }, 4, false), []);
console.log(`pmSkills ok (스킬 ${S.BASE_SKILLS.length}+${S.SHOP_SKILLS.length}, 탈것 ${M.MOUNTS.length})`);
