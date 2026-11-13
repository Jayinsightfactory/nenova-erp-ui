// 출고분배 확정 사이클(확정해제 → 저장 → 재확정) 실패 시 확정 상태 원복 검증.
// 클라이언트: lib/fixCycleClient 동작을 가짜 /api/shipment/fix 로 실행.
// 서버: 확정/해제 SP 호출이 품종별 withTransaction 안에서 실패 시 throw(=롤백)하는 구조를 소스 계약으로 고정.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Next 번들러처럼 확장자 없는 lib import(./parseJsonResponse)를 .js 로 해석한다.
require('node:module').register('data:text/javascript,' + encodeURIComponent(
  "export async function resolve(s, c, n) { try { return await n(s, c); } catch (e) { if (s.startsWith('.') && !/\\.m?js$/.test(s)) return n(s + '.js', c); throw e; } }"));
const load = () => import(pathToFileURL(path.join(__dirname, '../lib/fixCycleClient.js')).href);

// 가짜 확정 원장: 품목군별 isFix. unfix/fix 성공 시에만 상태가 바뀐다(실패 = 서버 트랜잭션 롤백 = 불변).
function fakeFixApi({ failOn } = {}) {
  const state = { '콜롬비아 알스트로': true, '미국더글라스': false, '미국레몬잎': false };
  const calls = [];
  global.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ action: body.action, cycleSource: body.cycleSource, force: body.force, orderYear: body.orderYear, distributionEditProdKeys: body.distributionEditProdKeys, countryFlowers: body.countryFlowers });
    const ok = failOn !== body.action;
    if (ok) for (const cf of body.countryFlowers) state[cf] = body.action === 'fix';
    const payload = ok ? { success: true } : { success: false, error: `${body.action} SP 실패(롤백)` };
    return { status: ok ? 200 : 500, text: async () => JSON.stringify(payload) };
  };
  return { state, calls };
}

const cycle = (runEditWithFixCycle, apply) => runEditWithFixCycle({
  weeks: ['2026-41-02'], orderYear: '2026', countryFlowers: ['콜롬비아 알스트로'], stockProdKeys: [2429],
  cycleSource: 'distribute-save', apply,
});

test('success: unfix → save → refix, 이력 출처 표시 전달, force=false·연도 명시', async () => {
  const { runEditWithFixCycle } = await load();
  const api = fakeFixApi();
  let savedWhileUnfixed = null;
  const r = await cycle(runEditWithFixCycle, async () => { savedWhileUnfixed = api.state['콜롬비아 알스트로'] === false; return 3; });
  assert.equal(r, 3);
  assert.equal(savedWhileUnfixed, true, 'save runs only after unfix');
  assert.deepEqual(api.calls.map(c => c.action), ['unfix', 'fix']);
  assert.ok(api.calls.every(c => c.cycleSource === 'distribute-save' && c.force === false && c.orderYear === '2026'));
  assert.equal(api.state['콜롬비아 알스트로'], true);
  assert.equal(api.state['미국더글라스'],false);assert.equal(api.state['미국레몬잎'],false);
  assert.ok(api.calls.every(c=>JSON.stringify(c.distributionEditProdKeys)==='[2429]'&&JSON.stringify(c.countryFlowers)==='["콜롬비아 알스트로"]'));
});

test('saved quantities are distinguished from refix failure',async()=>{
  const {runEditWithFixCycle}=await load();const api=fakeFixApi({failOn:'fix'});let saved=false;
  await assert.rejects(cycle(runEditWithFixCycle,async()=>{saved=true;}),e=>e.applyCommitted===true&&/fix SP/.test(e.message));
  assert.equal(saved,true);assert.equal(api.state['미국더글라스'],false);
});

test('save failure: 재확정까지 마친 뒤 저장 오류를 그대로 던짐 → 확정 상태 원래대로', async () => {
  const { runEditWithFixCycle } = await load();
  const api = fakeFixApi();
  await assert.rejects(cycle(runEditWithFixCycle, async () => { throw new Error('분배 저장 실패'); }), /분배 저장 실패/);
  assert.deepEqual(api.calls.map(c => c.action), ['unfix', 'fix']);
  assert.equal(api.state['콜롬비아 알스트로'], true);
});

test('unfix failure: 서버 롤백으로 확정 유지, 저장·재확정 호출 없음', async () => {
  const { runEditWithFixCycle } = await load();
  const api = fakeFixApi({ failOn: 'unfix' });
  let applied = false;
  await assert.rejects(cycle(runEditWithFixCycle, async () => { applied = true; }), /unfix SP 실패/);
  assert.equal(applied, false, 'nothing is written when unfix fails');
  assert.deepEqual(api.calls.map(c => c.action), ['unfix']);
  assert.equal(api.state['콜롬비아 알스트로'], true);
});

test('server contract: SP는 품종별 트랜잭션 안에서 실행, 실패 결과는 throw(롤백), isFix 직접 UPDATE 없음, 출처는 이력에만', () => {
  const fixApi = fs.readFileSync(path.join(__dirname, '../pages/api/shipment/fix.js'), 'utf8');
  const fn = fixApi.slice(fixApi.indexOf('async function runFixTargetProcedure'), fixApi.indexOf('async function advanceOptionalFixEditGuard'));
  assert.match(fn, /return withTransaction\(async \(tQ\) => \{/);
  assert.match(fn, /runShipmentProcedure\(name, shape, orderYear, orderWeek, uid, cf, tQ\)/);
  assert.match(fn, /row\.result !== 0[\s\S]*throw new Error/);
  // sd.isFix / sm.isFix 는 전산 SP(usp_ShipmentFix / usp_ShipmentFixCancel)만 바꾼다.
  assert.doesNotMatch(fixApi, /UPDATE\s+Shipment(Detail|Master)[\s\S]{0,80}SET[^;]{0,200}isFix\s*=/i);
  assert.match(fixApi, /logFix\('unfix_start'[^\n]*cycleSourceLabel\(req\)/);
  assert.match(fixApi, /logFix\('fix_start'[^\n]*cycleSourceLabel\(req\)/);
  const page = fs.readFileSync(path.join(__dirname, '../pages/shipment/distribute.js'), 'utf8');
  assert.match(page, /cycleSource: 'distribute-save'/);
  // 업체 탭 저장은 바뀐 행만 → 확정해제 범위도 바뀐 품목의 품목군만 (관계없는 품종의 다음차수 확정에 막히지 않음)
  const custSave = page.slice(page.indexOf('const handleSaveCustItems'), page.indexOf('const handleSave = async'));
  assert.match(custSave, /const changed = item\.pendingOrder \|\| qty !== Number\(item\.출고수량 \|\| 0\) \|\| cost !== Number\(item\.Cost \|\| 0\)/);
  assert.match(custSave, /return changed \? \[\{ custKey/);
  assert.match(custSave, /prodKeys: entries\.map\(entry => entry\.prodKey\)/);
});
