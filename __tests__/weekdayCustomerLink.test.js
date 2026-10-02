import assert from 'node:assert/strict';
import fs from 'node:fs';
import { weekdayDetailCustomerMatchesMaster, WEEKDAY_DETAIL_CUSTOMER_MATCH_SQL } from '../lib/weekdayCustomerLink.js';

assert.equal(WEEKDAY_DETAIL_CUSTOMER_MATCH_SQL,
  '(sm.CustKey>0 AND (sd.CustKey IS NULL OR (sd.CustKey>0 AND sd.CustKey=sm.CustKey)))');
for (const [detailKey, masterKey] of [[null, 7], [7, 7], ['7', 7], [7, '7']]) {
  assert.equal(weekdayDetailCustomerMatchesMaster(detailKey, masterKey), true, `${detailKey} matches ${masterKey}`);
}
for (const [detailKey, masterKey] of [
  [undefined, 7], [0, 7], ['0', 7], [8, 7], ['8', 7], [null, 0], [null, undefined],
  [true, 1], [1.5, 1.5], ['  ', 7],
]) assert.equal(weekdayDetailCustomerMatchesMaster(detailKey, masterKey), false, `${detailKey} must not match ${masterKey}`);

for (const file of [
  '../lib/weekdayInitialBaselineSql.js', '../pages/api/estimate/weekday-carryover.js',
  '../pages/api/estimate/weekday-note.js', '../pages/api/estimate/weekday-products.js',
  '../lib/weekdayConfirmation.js',
]) {
  const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  assert.ok(source.includes('WEEKDAY_DETAIL_CUSTOMER_MATCH_SQL'), `${file} references the shared SQL predicate`);
}
const print = fs.readFileSync(new URL('../lib/weekdayEstimatePrint.js', import.meta.url), 'utf8');
assert.ok(print.includes('weekdayDetailCustomerMatchesMaster('), 'print eligibility uses the shared JS predicate');
const compare = fs.readFileSync(new URL('../pages/api/estimate/weekday-compare.js', import.meta.url), 'utf8');
assert.ok(compare.includes('weekdayDetailCustomerMatchesMaster('), 'compare warnings use the shared JS predicate');
assert.match(compare, /JOIN ShipmentDetail sd ON sd\.ShipmentKey = sm\.ShipmentKey\s+JOIN Product/,
  'compare reads parent-scoped raw details so invalid non-NULL links remain visible as errors');
assert.doesNotMatch(compare, /JOIN ShipmentDetail sd ON sd\.ShipmentKey = sm\.ShipmentKey AND \$\{WEEKDAY_DETAIL_CUSTOMER_MATCH_SQL\}/,
  'compare must not filter near-miss details away');

console.log('weekday customer link: exact key or native NULL only');
