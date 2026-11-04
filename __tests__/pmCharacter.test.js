// __tests__/pmCharacter.test.js — /pm 캐릭터 v2: 레이어 에셋 완결성·정합 보고서·자리 좌표·작업 분위기 규칙·자유이용권·물주기
// 실행: node __tests__/pmCharacter.test.js (임시 파일만, MSSQL 불필요)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = process.cwd();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmch-'));
const cjs = (f, exp) => fs.readFileSync(path.join(root, 'lib', f), 'utf8')
  .replace(/^import (\w+) from '(\w+)';/gm, "const $1 = require('$2');")
  .replace(/^export (const|function) /gm, '$1 ') + `\nmodule.exports = { ${exp} };`;
const load = (f, exp) => { const p = path.join(dir, f.replace('.js', '.cjs')); fs.writeFileSync(p, cjs(f, exp)); return require(p); };
const mood = load('pmMood.js', 'trackActivity, vibeOf, todayWorkMinutes, trackAll, vibesView, water, VIBES, FOCUS_MIN');
const fp = load('pmFreePass.js', 'passOf, grantPass, effectiveCfg, readPasses, DEFAULT_PASS');
const ds = load('pmDeskSlots.js', 'PM_DESK_SLOTS, PM_DESK_ANCHOR, PM_CHAR_FEET, PM_CHAR_HIP, deskPlacement, sortDesks');

// 1) 레이어 에셋: layers.json 의 모든 파일이 있고, 상점 노출 품목은 전부 레이어가 있다
const L = JSON.parse(fs.readFileSync(path.join(root, 'public', 'pm-char', 'layers.json'), 'utf8'));
const files = [];
const walk = (v) => { if (typeof v === 'string' && v.startsWith('/pm-char/')) files.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
walk(L);
for (const f of files) assert.ok(fs.existsSync(path.join(root, 'public', f)), `없는 레이어 파일 ${f}`);
assert.ok(files.length > 300, `레이어 파일 수 ${files.length}`);
assert.deepStrictEqual(L.order, ['kindBack', 'hairBack', 'body', 'bottom', 'top', 'badge', 'face', 'hairFront', 'kindFront', 'glasses', 'hat', 'hand'], '레이어 순서(뒤→앞)');
const M = JSON.parse(fs.readFileSync(path.join(root, 'public', 'pm-themes', 'manifest.json'), 'utf8'));
for (const it of M.items.filter((x) => !x.hidden)) {
  const has = L.items[it.id] || L.desk.items[it.id];
  assert.ok(has, `레이어 없는 상점 품목 ${it.id}`);
  if (L.items[it.id]) for (const [layer, per] of Object.entries(L.items[it.id].layers)) if (!per['*']) for (const b of ['slim', 'std', 'round']) assert.ok(per[b], `${it.id} ${layer} 체형 ${b} 없음`);
}
// 예전 품목 id 는 전부 남아 있음(구매 기록 호환)
for (const id of ['hat.straw', 'hat.crown', 'outfit.hanbok', 'desk.vase', 'desk.trophy', 'pet.kitten', 'badge.mvp', 'glasses.visor']) assert.ok(M.items.some((x) => x.id === id), `옛 품목 ${id} 유지`);
for (const c of M.characters) assert.ok(L.kinds[c.id], `캐릭터 종류 ${c.id} 레이어`);
// 10개 테마 각각 옷·모자·손소품·책상 1개 이상
for (const t of 'ABCDEFGHIJ') for (const cat of ['outfit', 'hat', 'hand', 'desk']) assert.ok(M.items.some((x) => x.theme === t && x.category === cat && !x.hidden), `테마 ${t} ${cat}`);

// 2) 정합 보고서(블렌더 렌더 후 scripts/pm-char/post.py 가 픽셀 검사) — 앵커 오차 ≤2px, 슬롯 밖 0, 순서 위반 0
const R = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'pm-char', 'fit-report.json'), 'utf8'));
assert.ok(R.anchorMaxErr <= 2, `앵커 오차 ${R.anchorMaxErr}`);
assert.strictEqual(R.outOfSlot, 0, '슬롯 밖 픽셀');
assert.strictEqual(R.orderViolations, 0, '레이어 순서 위반(얼굴 가림)');
assert.ok(R.checked >= 170);

// 3) 자리 좌표 = layers.json 과 같은 값, 배치 계산
assert.deepStrictEqual(ds.PM_DESK_ANCHOR, L.desk.anchor);
assert.deepStrictEqual(ds.PM_CHAR_FEET, L.anchors.feet);
assert.deepStrictEqual(ds.PM_CHAR_HIP, L.sit.anchors.hip);
for (const it of Object.keys(L.items)) assert.ok(L.sit.items[it], `앉은 포즈 레이어 ${it}`);
for (const [k, s] of Object.entries(L.desk.slots)) { assert.deepStrictEqual(ds.PM_DESK_SLOTS[k].at, s.at, `슬롯 ${k}`); assert.strictEqual(ds.PM_DESK_SLOTS[k].z, s.z); }
const pl = ds.deskPlacement([500, 400], 0.5);
assert.deepStrictEqual(pl.canvasOrigin, [500 - 96, 400 - 147.3]);
assert.strictEqual(pl.slots.pet.x, 564);
assert.deepStrictEqual(ds.sortDesks([{ anchor: [0, 300] }, { anchor: [0, 100] }]).map((d) => d.anchor[1]), [100, 300], '뒤 자리 먼저');
const zs = Object.values(ds.PM_DESK_SLOTS).map((s) => s.z);
assert.ok(ds.PM_DESK_SLOTS.chair.z < ds.PM_DESK_SLOTS.seat.z && ds.PM_DESK_SLOTS.seat.z < ds.PM_DESK_SLOTS.desk.z && ds.PM_DESK_SLOTS.desk.z < ds.PM_DESK_SLOTS.deskM.z && Math.max(...zs) === ds.PM_DESK_SLOTS.pet.z);

// 4) 작업 분위기 규칙
const T = Date.parse('2026-11-04T01:00:00Z');
const W = (l) => ({ status: 'working', workLabel: l });
let a = null;
for (let i = 0; i <= 60; i++) a = mood.trackActivity(a, W('발주작업 중 (10:00)'), T + i * 60000);
assert.strictEqual(mood.vibeOf({ status: 'working', act: a, todayMin: 61 }, T + 60 * 60000), 'focus', '연속 60분=집중');
assert.strictEqual(mood.vibeOf({ status: 'working', act: a, todayMin: 400 }, T + 60 * 60000), 'blaze', '오늘 6h+=몰입');
let b = null;
['A', 'B', 'C', 'D', 'E'].forEach((l, i) => { b = mood.trackActivity(b, W(l), T + i * 5 * 60000); });
assert.strictEqual(b.switches.length, 4);
assert.strictEqual(mood.vibeOf({ status: 'working', act: b, todayMin: 30 }, T + 20 * 60000), 'busy', '30분에 전환 4회=바쁨');
assert.strictEqual(mood.vibeOf({ status: 'working', act: b, todayMin: 30 }, T + 55 * 60000), 'work', '창 밖 전환은 안 셈');
b = mood.trackActivity(b, { status: 'idle' }, T + 25 * 60000);
assert.strictEqual(b.workSince, null, '작업 끝나면 연속 시간 리셋');
const last = new Date(T).toISOString();
assert.strictEqual(mood.vibeOf({ status: 'idle', lastActiveAt: last }, T + 5 * 60000), 'idle');
assert.strictEqual(mood.vibeOf({ status: 'idle', lastActiveAt: last }, T + 16 * 60000), 'break', '15분 무활동=커피');
assert.strictEqual(mood.vibeOf({ status: 'idle', lastActiveAt: last }, T + 95 * 60000), 'doze');
assert.strictEqual(mood.todayWorkMinutes({ reasons: { 발주작업: 50, '활동(업무 미특정)': 99 } }), 50, '활동만은 업무시간 제외');
for (const v of Object.values(mood.VIBES)) assert.ok(!/벌|혼|지침|우울|피곤|경고/.test(v.label + v.note), '긍정·중립 문구만');
const st = { people: { 설연주: { status: 'working', points: 10, today: { day: '2026-11-04', reasons: {} } } } };
mood.trackAll(st, { staff: [{ name: '설연주', status: 'working', workLabel: 'x' }] }, T);
assert.strictEqual(st.people.설연주.points, 10, '포인트 불변');
assert.ok(st.people.설연주.act.workSince === T);
// 물주기: 하루 1번, 연속일
let c = mood.water({}, '강현우', '2026-11-04', 'x');
assert.strictEqual(c.entry.streak, 1);
assert.ok(mood.water(c.care, '강현우', '2026-11-04', 'x').already);
c = mood.water(c.care, '강현우', '2026-11-05', 'y'); assert.strictEqual(c.entry.streak, 2);
c = mood.water(c.care, '강현우', '2026-11-07', 'z'); assert.strictEqual(c.entry.streak, 1, '하루 건너뛰면 1부터');

// 5) 자유이용권: 기본 = 전 직원 11/04 부터 7일
const P = { default: { ...fp.DEFAULT_PASS }, people: {} };
const kst = (s) => Date.parse(s + '+09:00');
let p = fp.passOf('누구나', P, kst('2026-11-04T09:00:00'));
assert.ok(p.active && p.daysLeft === 7 && p.end === '2026-11-10', JSON.stringify(p));
assert.strictEqual(fp.passOf('누구나', P, kst('2026-11-10T23:00:00')).daysLeft, 1);
p = fp.passOf('누구나', P, kst('2026-11-11T00:00:00'));
assert.ok(!p.active && p.expired, '8일째 만료');
const cfg = { char: 'fox', items: { hat: 'hat.crown', outfit: 'outfit.knit', pet: 'pet.puppy' } };
assert.deepStrictEqual(fp.effectiveCfg(cfg, { active: true }, ['hat.crown']).items, cfg.items, '이용권 중엔 그대로');
const e = fp.effectiveCfg(cfg, p, ['hat.crown', 'char.fox']);
assert.deepStrictEqual(e.items, { outfit: 'outfit.knit', pet: 'pet.puppy' }, '만료: 안 산 것만 해제');
assert.strictEqual(e.char, 'human', '만료: 안 산 캐릭터는 기본');
assert.strictEqual(cfg.items.hat, 'hat.crown', '저장 데이터 보존');
let g = fp.grantPass(P, '강현우', { start: '2026-11-20', days: 3, by: 'admin' });
assert.ok(g.ok && fp.passOf('강현우', g.passes, kst('2026-11-21T10:00:00')).active && !fp.passOf('설연주', g.passes, kst('2026-11-21T10:00:00')).active, '개인 재지급');
g = fp.grantPass(g.passes, '*', { start: '2026-12-01', days: 7 });
assert.ok(g.ok && Object.keys(g.passes.people).length === 0 && g.passes.default.start === '2026-12-01', '전체 재지급');
assert.strictEqual(fp.grantPass(P, 'x', { start: '11/04', days: 7 }).status, 400);
assert.strictEqual(fp.grantPass(P, 'x', { start: '2026-11-04', days: 99 }).status, 400);

// 6) 장면용 아이소 세트: 책상10·상판16·펫10(2프레임), 앵커 = pmDeskSlots, 정합 보고서
const ds2 = (() => { const p2 = path.join(dir, 'pmDeskSlotsIso.cjs'); fs.writeFileSync(p2, cjs('pmDeskSlots.js', 'PM_DESK_ISO, isoPlacement, isoDeskTop, PM_DESK_ISO_SCALE')); return require(p2); })();
assert.ok(L.iso, 'layers.iso');
assert.strictEqual(Object.values(L.iso.items).filter((x) => x.slot === 'desk').length, 10);
assert.strictEqual(Object.values(L.iso.items).filter((x) => x.slot === 'deskTop').length, 16);
assert.strictEqual(Object.values(L.iso.items).filter((x) => x.slot === 'pet' && x.frames === 2).length, 10);
for (const it of Object.values(L.iso.items)) assert.ok(fs.existsSync(path.join(root, 'public', it.src)), it.src);
assert.deepStrictEqual(ds2.PM_DESK_ISO.anchors, L.iso.anchors, '아이소 앵커 = layers.json');
const RI = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'pm-char', 'fit-report-iso.json'), 'utf8'));
assert.strictEqual(RI.outOfSlot, 0, '아이소 슬롯 밖 0');
assert.strictEqual(RI.anchorOnPixel, 26, '책상 상판 앵커·소품 바닥 ±2px');
const ip = ds2.isoPlacement([1000, 500], 0.5, { dir: 'right' });
assert.ok(ip.flip && ip.size === 192 && ip.left === 1000 - (384 - L.iso.anchors.top[0]) * 0.5);
assert.deepStrictEqual(ds2.isoDeskTop([20, 18, 28, 24]), [24, 21]);
assert.strictEqual(Object.keys(ds2.PM_DESK_ISO_SCALE).join(''), 'ABCDEFGHIJ');
console.log('pmCharacter ok', files.length, 'layer files');
