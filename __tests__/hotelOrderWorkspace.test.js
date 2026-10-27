import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHotelOrderRows, hotelRegistrationPlan, hotelConvert, uniqueHotelMappings } from '../lib/hotelOrderWorkspace.js';
const products = { 10: { ProdKey: 10, DisplayName: '수국', OutUnit: '송이', SteamOf1Box: 30, BunchOf1Box: 3, SteamOf1Bunch: 10 } };
const line = (qty, unit = '송이') => ({ prodKey: 10, inputName: '수국', qty, unit });
const scope = { year: '2026', week: '44-01', raum: 680, surplus: 690, customers: [{ CustKey: 680, CustName: '라움' }, { CustKey: 690, CustName: '호텔여분' }, { CustKey: 691, CustName: '은화' }] };
test('mixed units aggregate, full boxes and remainder conserve request quantity', () => {
  const m = buildHotelOrderRows([line(3, '박스'), line(15)], [line(3, '단')], products, { 10: { 691: 15 } });
  assert.deepEqual([m.rows[0].request, m.rows[0].purchase, m.rows[0].remaining, m.rows[0].surplus, m.rows[0].unassigned], [105, 30, 75, 60, 0]);
  const groups = hotelRegistrationPlan(m, scope);
  assert.deepEqual(groups.map(g => [g.custKey, g.items[0].qty]), [[680, 30], [690, 60], [691, 15]]);
  assert.equal(groups.reduce((s, g) => s + g.items[0].qty, 0), 105);
  assert.ok(groups.every(g => g.year === '2026' && g.week === '44-01'));
  const prior = hotelRegistrationPlan(m, { ...scope, year: '2025' });
  assert.ok(prior.every(g => g.year === '2025'));
});
test('exact box, zero balance, and fractional box boundaries', () => {
  assert.equal(buildHotelOrderRows([line(30)], [], products).rows[0].surplus, 30);
  const equal = buildHotelOrderRows([line(30)], [line(30)], products);
  assert.equal(equal.rows[0].unassigned, 0);
  assert.equal(hotelRegistrationPlan(equal, scope).length, 1);
  const fraction = buildHotelOrderRows([line(29.5)], [], products);
  assert.equal(fraction.rows[0].surplus, 0);
  assert.throws(() => hotelRegistrationPlan(fraction, scope), /분류필요/);
});
test('negative, missing, stale, invalid or overassigned inputs block registration', () => {
  for (const m of [
    buildHotelOrderRows([line(20)], [line(30)], products),
    buildHotelOrderRows([{ ...line(20), prodKey: null }], [], products),
    buildHotelOrderRows([line(20)], [], {}),
    buildHotelOrderRows([line(20, '')], [], products),
    buildHotelOrderRows([line(-1)], [], products),
    buildHotelOrderRows([line(Infinity)], [], products),
    buildHotelOrderRows([line(45)], [], products, { 10: { 691: 16 } }),
    buildHotelOrderRows([line(45)], [], products, { 10: { 691: -1 } }),
    buildHotelOrderRows([line(45)], [], { 10: { ...products[10], SteamOf1Box: 0, BunchOf1Box: 0 } }),
  ]) assert.throws(() => hotelRegistrationPlan(m, scope));
  const m = buildHotelOrderRows([line(45)], [], products, { 10: { 999: 15 } });
  assert.throws(() => hotelRegistrationPlan(m, scope), /업체/);
  assert.throws(() => hotelRegistrationPlan(m, { ...scope, year: '' }), /연도/);
  assert.throws(() => hotelConvert(1, '알수없음', '송이', products[10]), /단위/);
  assert.equal(hotelConvert(0, '송이', '송이', products[10]), 0);
});
test('saved mappings cannot resolve conflicting hotel names arbitrarily', () => {
  const x = uniqueHotelMappings([{ ItemName: '수국 화이트', ProdKey: 10 }, { ItemName: '수국화이트', ProdKey: 11 }, { ItemName: '장미', ProdKey: 12 }, { ItemName: '장미', ProdKey: 12 }]);
  assert.equal(x.groups.get(x.token('수국 화이트')).size, 2);
  assert.equal(x.groups.get(x.token('장미')).size, 1);
});
