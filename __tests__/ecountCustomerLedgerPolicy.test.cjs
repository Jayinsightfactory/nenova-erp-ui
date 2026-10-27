const test = require('node:test');
const assert = require('node:assert/strict');
const p = require('../lib/ecountCustomerLedgerPolicy.cjs');
const schedule = require('../lib/ecountLedgerSchedule.cjs');
const at = s => Date.parse(s + '+09:00');
test('KST weekdays inclusive 09 through 18, ten slots', () => {
  let count = 0;
  for (let hour = 0; hour < 24; hour++) {
    const now = at(`2026-10-27T${String(hour).padStart(2, '0')}:00:00`);
    if (schedule.dueSlot(now) !== null) count++;
    assert.equal(schedule.dueSlot(now) !== null, hour >= 9 && hour <= 18);
  }
  assert.equal(count, 10);
});
test('weekends, duplicate slot and late wakeup do not collect', () => {
  assert.equal(schedule.dueSlot(at('2026-10-31T09:00:00')), null);
  assert.equal(schedule.dueSlot(at('2026-11-01T18:00:00')), null);
  const slot = at('2026-10-27T09:00:00');
  assert.equal(schedule.dueSlot(slot + 1000, slot), null);
  assert.equal(schedule.dueSlot(slot + 5 * 60000), null);
  assert.equal(schedule.dueSlot(slot + 4 * 60000), slot);
  assert.equal(schedule.dueSlot(NaN), null);
});
test('year and weekend boundaries preserve full dates', () => {
  assert.equal(new Date(schedule.nextSlot(at('2026-12-31T18:00:00'))).toISOString(), '2027-01-01T00:00:00.000Z');
  assert.equal(new Date(schedule.nextSlot(at('2026-10-30T18:00:00'))).toISOString(), '2026-11-02T00:00:00.000Z');
  assert.notEqual(schedule.dueSlot(at('2025-10-27T09:00:00')), schedule.dueSlot(at('2026-10-27T09:00:00')));
});
test('explicit first installation can initialize within business hours only, once',()=>{
  const now=at('2026-10-27T15:20:00');
  assert.equal(schedule.dueSlot(now,null,true),at('2026-10-27T15:00:00'));
  assert.equal(schedule.dueSlot(now,at('2026-10-27T15:00:00'),true),null);
  assert.equal(schedule.dueSlot(at('2026-10-27T19:00:00'),null,true),null);
  assert.equal(schedule.dueSlot(at('2026-10-27T18:20:00'),null,true),null);
  assert.equal(schedule.dueSlot(at('2026-10-31T10:20:00'),null,true),null);
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
  assert.equal(schedule.freshness('2026-10-30 17:01:00',at('2026-11-01T12:00:00')).stale,true);
  assert.equal(schedule.freshness(null,at('2026-10-27T12:00:00')).stale,true);
});
