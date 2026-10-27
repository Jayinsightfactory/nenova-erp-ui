const test = require('node:test');
const assert = require('node:assert/strict');
const p = require('../lib/ecountCustomerLedgerPolicy.cjs');
const schedule = require('../lib/ecountLedgerSchedule.cjs');
const at = s => Date.parse(s + '+09:00');
test('KST weekdays have three collections before 09:00, 12:00 and 15:00', () => {
  let count = 0;
  for (let hour = 0; hour < 24; hour++) {
    const now = at(`2026-10-27T${String(hour).padStart(2, '0')}:00:00`);
    if (schedule.dueSlot(now) !== null) count++;
    assert.equal(schedule.dueSlot(now) !== null, [8,11,14].includes(hour));
  }
  assert.equal(count, 3);
  assert.equal(schedule.LABEL,'평일 08:00·11:00·14:00 자동 수집 · 사용자 요청 시 추가 (한국시간)');
});
test('weekends, duplicate slot and late wakeup do not collect or catch up', () => {
  assert.equal(schedule.dueSlot(at('2026-10-31T08:00:00')), null);
  assert.equal(schedule.dueSlot(at('2026-11-01T14:00:00')), null);
  const slot = at('2026-10-27T08:00:00');
  assert.equal(schedule.dueSlot(slot + 1000, slot), null);
  assert.equal(schedule.dueSlot(slot + 5 * 60000), null);
  assert.equal(schedule.dueSlot(slot + 4 * 60000), slot);
  assert.equal(schedule.dueSlot(at('2026-10-27T08:06:00')),null);
  assert.equal(schedule.dueSlot(NaN), null);
});
test('next collection is at 11 after 08 and at next weekday 08 after 14', () => {
  assert.equal(new Date(schedule.nextSlot(at('2026-10-27T08:00:00'))).toISOString(), '2026-10-27T02:00:00.000Z');
  assert.equal(new Date(schedule.nextSlot(at('2026-10-27T14:00:00'))).toISOString(), '2026-10-27T23:00:00.000Z');
  assert.equal(new Date(schedule.nextSlot(at('2026-10-30T14:00:00'))).toISOString(), '2026-11-01T23:00:00.000Z');
  assert.equal(new Date(schedule.nextSlot(at('2026-12-31T14:00:00'))).toISOString(), '2026-12-31T23:00:00.000Z');
  assert.notEqual(schedule.dueSlot(at('2025-10-27T08:00:00')), schedule.dueSlot(at('2026-10-27T08:00:00')));
});
test('manual refresh allowed only weekdays from 08:00 up to 18:00 KST',()=>{
  for(const [time,allowed] of [['2026-10-26T08:00:00',true],['2026-10-30T17:59:59',true],['2026-10-27T07:59:59',false],['2026-10-27T18:00:00',false],['2026-10-31T10:00:00',false]])
    assert.equal(schedule.isRefreshRequestAllowed(at(time)),allowed,time);
});
test('recent calendar month uses Korea date, clamps month end and leap day', () => {
  for (const [now, from, to] of [
    ['2026-10-27T09:00:00','2026-09-27','2026-10-27'],
    ['2026-03-31T09:00:00','2026-02-28','2026-03-31'],
    ['2024-03-31T09:00:00','2024-02-29','2024-03-31'],
    ['2027-01-01T00:00:00','2026-12-01','2027-01-01'],
  ]) assert.deepEqual(p.recentMonth(at(now)), { from, to });
});
const user = { userId:'sales-a', accountActive:true };
const customer = { custKey:1, managerUserId:'sales-a', active:true, codeMatchCount:1, ecountCode:'001' };
const snapshot = { program:'E040723', mode:'voucher', custKey:1, ecountCode:'001', periodFrom:'2026-09-27', periodTo:'2026-10-27', verified:true };
test('assigned customer and exact verified voucher scope allowed', () => {
  assert.equal(p.authorizeSnapshot(user, customer, snapshot, at('2026-10-27T09:00:00')).allowed, true);
});
test('other manager, unassigned, inactive and ambiguous mapping denied; no implicit admin bypass', () => {
  for (const change of [{managerUserId:'sales-b'},{managerUserId:''},{active:false},{codeMatchCount:0},{codeMatchCount:2},{ecountCode:''}]) {
    assert.equal(p.canReadCustomer(user, {...customer,...change}), false);
  }
  for (const change of [{userId:'sales-b',authority:1},{accountActive:false},{accountActive:undefined},{userId:''}]) assert.equal(p.canReadCustomer({...user,...change},customer),false);
  assert.equal(p.canReadCustomer(null,customer),false);
});
test('wrong report, customer, mode, prior year, date range and unverified source denied', () => {
  for (const change of [{program:'E040214'},{mode:'summary'},{custKey:2},{ecountCode:'002'},{periodFrom:'2025-09-27'},{periodTo:'2026-10-26'},{verified:false}]) {
    assert.equal(p.authorizeSnapshot(user,customer,{...snapshot,...change},at('2026-10-27T09:00:00')).allowed,false);
  }
});
test('freshness uses prior working slot on weekends, never fabricates success', () => {
  assert.equal(schedule.freshness('2026-10-30 18:01:00',at('2026-11-01T12:00:00')).stale,false);
  assert.equal(schedule.freshness('2026-10-30 13:01:00',at('2026-11-01T12:00:00')).stale,true);
  assert.equal(schedule.freshness(null,at('2026-10-27T12:00:00')).stale,true);
});
