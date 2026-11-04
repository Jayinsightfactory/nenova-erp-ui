// __tests__/pmSceneSeated.test.js — 장면 앉은 캐릭터 연결 검사: 테마 기본 세트(본인 장착 우선)·춤 이벤트·캐릭터-의자 정렬(seat→desk 왕복).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');
(async () => {
  const load = async (rel) => { const f = path.join(os.tmpdir(), `t-${process.pid}-${path.basename(rel)}.mjs`); fs.writeFileSync(f, fs.readFileSync(path.join(process.cwd(), rel), 'utf8')); const m = await import(pathToFileURL(f).href); fs.unlinkSync(f); return m; };
  const { themeKit, withThemeKit, sceneAvatar, hashLook } = await load('lib/pmThemeKit.js');
  const { deskPlacement, PM_DESK_SLOTS } = await load('lib/pmDeskSlots.js');
  const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'pm-themes', 'manifest.json'), 'utf8'));
  const layers = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'pm-char', 'layers.json'), 'utf8'));
  for (const id of 'ABCDEFGHIJ') {
    const kit = themeKit(manifest, id);
    assert.ok(kit.desk && layers.desk.items[kit.desk], `테마 ${id} 기본 책상 스킨 있음(${kit.desk})`);
    assert.ok(kit.outfit && layers.items[kit.outfit], `테마 ${id} 기본 의상 있음`);
  }
  const kit = themeKit(manifest, 'B');
  const mine = withThemeKit({ items: { outfit: 'outfit.suit', desk: '' } }, kit);
  assert.strictEqual(mine.items.outfit, 'outfit.suit', '본인 장착 의상 우선');
  assert.strictEqual(mine.items.desk, kit.desk, '빈 슬롯은 테마 기본');
  // 캐릭터-의자 정렬: 장면이 주는 엉덩이 점(seat) → 책상 앵커 → 다시 seat 슬롯 = 오차 0
  for (const sc of [0.3, 0.42, 0.55]) {
    const anchor = [400, 300]; const seat = { x: anchor[0], y: anchor[1] + PM_DESK_SLOTS.seat.at[1] * sc };
    const P = deskPlacement([seat.x - PM_DESK_SLOTS.seat.at[0] * sc, seat.y - PM_DESK_SLOTS.seat.at[1] * sc], sc);
    assert.ok(Math.hypot(P.slots.seat.x - seat.x, P.slots.seat.y - seat.y) < 1e-6, `정렬 오차 0 (scale ${sc})`);
    assert.ok(P.slots.desk.y > P.slots.seat.y, '책상 앞면이 엉덩이보다 앞(아래)');
  }
  const src = fs.readFileSync(path.join(process.cwd(), 'components', 'pm', 'BgScene.js'), 'utf8');
  const { danceEvents } = await (async () => {
    const body = src.slice(src.indexOf('export function danceEvents'), src.indexOf('function useSceneDances'));
    const f = path.join(os.tmpdir(), `t-${process.pid}-dance.mjs`); fs.writeFileSync(f, 'const arr = (x) => (Array.isArray(x) ? x : []);\n' + body);
    const m = await import(pathToFileURL(f).href); fs.unlinkSync(f); return m;
  })();
  const g1 = { people: [{ name: '설연주', stage: 1, today: { points: 50, cap: 60 } }, { name: '강명훈', stage: 2, today: { points: 10, cap: 60 } }] };
  const r1 = [{ id: 'x', status: 'pr', byName: '강현우' }];
  const a = danceEvents(null, g1, r1); assert.deepStrictEqual(a.out, {}, '첫 로드는 춤 없음');
  const g2 = { people: [{ name: '설연주', stage: 1, today: { points: 60, cap: 60 } }, { name: '강명훈', stage: 3, today: { points: 10, cap: 60 } }] };
  const b = danceEvents(a.next, g2, [{ id: 'x', status: 'deployed', byName: '강현우' }]);
  assert.deepStrictEqual(b.out, { 설연주: 'jump', 강명훈: 'cheer', 강현우: 'spin' }, '목표 달성·승급·배포됨 춤');
  assert.ok(/SeatedCharacter/.test(src) && /bg-mask/.test(src), '장면이 SeatedCharacter + 책상 앞판 마스크 사용');
  assert.ok(!/<DeskDecor/.test(src), '장면에서 정면 책상 스킨·러그(DeskDecor) 숨김');
  // 기본 외형 다양화: 12명 이름 → 서로 다른 조합 다수, 같은 이름은 늘 같음
  const names = ['강명훈', '설연주', '임재용', '강현우', '김도준', '김원영', '박성수', '정재훈', '조현욱', '송준호', '김원빈', '김지니'];
  const looks = names.map((n) => JSON.stringify(hashLook(n, ['outfit.aloha'])));
  assert.ok(new Set(looks).size === names.length, '직원마다 다른 외형');
  assert.deepStrictEqual(hashLook('설연주', ['outfit.aloha']), hashLook('설연주', ['outfit.aloha']), '같은 사람은 같은 외형');
  const sv = sceneAvatar(null, '설연주', themeKit(manifest, 'I'), ['outfit.aloha']);
  assert.ok(!sv.items.desk && !sv.items.rug && !sv.items.chair, '장면 아바타에 책상 스킨·러그·의자 없음');
  const own = sceneAvatar({ hair: 'bob', items: { outfit: 'outfit.suit', desk: 'desk.neon' } }, '설연주', themeKit(manifest, 'I'), []);
  assert.ok(own.items.outfit === 'outfit.suit' && !own.items.desk, '꾸미기 저장한 직원은 본인 의상, 책상 스킨은 장면에서 숨김');
  console.log('pmSceneSeated ok (테마 기본 세트 10종 · 장착 우선 · 정렬 오차 0 · 춤 이벤트 3종)');
})().catch((e) => { console.error(e.message); process.exit(1); });
