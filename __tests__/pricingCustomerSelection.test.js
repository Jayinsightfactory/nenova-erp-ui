import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  RECENT_CUSTOMER_SQL,
  filterPricingCustomers,
  toggleVisiblePricingCustomers,
} from '../lib/pricingCustomerSelection.js';

const customers = [
  { CustKey: 1, CustName: '최근 화훼', Manager: '김담당', HasRecentTrade: true, LastTradeDtm: '2026-08-20' },
  { CustKey: 2, CustName: '오래된 화훼', Manager: '이담당', HasRecentTrade: 0, LastTradeDtm: '2025-01-01' },
  { CustKey: 3, CustName: '미지정 플라워', Manager: '박담당', HasRecentTrade: '0' },
  { CustKey: 4, CustName: '거짓 플라워', Manager: '최담당', HasRecentTrade: false },
];

// No search means the recent-trade default list. Only the explicit positive
// representations are eligible; false-y values must not be coerced to recent.
assert.deepEqual(filterPricingCustomers(customers, undefined).map((c) => c.CustKey), [1]);
assert.deepEqual(filterPricingCustomers(customers, '   ').map((c) => c.CustKey), [1]);

// An explicit search is an intentional override, including old customers and
// manager names, and matching is case-insensitive/trimmed.
assert.deepEqual(filterPricingCustomers(customers, ' 오래된 ').map((c) => c.CustKey), [2]);
assert.deepEqual(filterPricingCustomers(customers, ' 이담당 ').map((c) => c.CustKey), [2]);
assert.deepEqual(filterPricingCustomers(customers, '담당').map((c) => c.CustKey), [1, 2, 3, 4]);

// Filtering and selection are pure from the caller's perspective.
const originalRows = customers.slice();
const originalSelected = new Set([99, 2]);
const visible = [customers[0], customers[1]];
const selectedAfter = toggleVisiblePricingCustomers(originalSelected, visible);
assert.deepEqual(customers, originalRows);
assert.deepEqual(originalSelected, new Set([99, 2]));
assert.notStrictEqual(selectedAfter, originalSelected);

// Select-all affects only visible rows and preserves hidden selections. A
// second click deselects visible rows; no visible rows means no removal.
assert.deepEqual(selectedAfter, new Set([99, 2, 1]));
const deselectedVisible = toggleVisiblePricingCustomers(selectedAfter, visible);
assert.deepEqual(deselectedVisible, new Set([99]));
assert.deepEqual(toggleVisiblePricingCustomers(new Set([7]), []), new Set([7]));

// The SQL contract is the EXE-compatible read scope: active positive order
// details joined through their order master plus active positive shipments,
// aggregated per customer with KST calendar bounds.
assert.match(RECENT_CUSTOMER_SQL, /JOIN\s+OrderDetail\s+od\s+ON\s+od\.OrderMasterKey\s*=\s*om\.OrderMasterKey/i);
assert.match(RECENT_CUSTOMER_SQL, /JOIN\s+ShipmentDetail\s+sd\s+ON\s+sd\.ShipmentKey\s*=\s*sm\.ShipmentKey/i);
assert.match(RECENT_CUSTOMER_SQL, /om\.isDeleted/i);
assert.match(RECENT_CUSTOMER_SQL, /od\.isDeleted/i);
assert.match(RECENT_CUSTOMER_SQL, /sm\.isDeleted/i);
assert.doesNotMatch(RECENT_CUSTOMER_SQL, /sd\.isDeleted/i, 'ShipmentDetail has no isDeleted column');
assert.match(RECENT_CUSTOMER_SQL, /od\.OutQuantity[^\n]*>\s*0/i);
assert.match(RECENT_CUSTOMER_SQL, /sd\.OutQuantity[^\n]*>\s*0/i);
assert.match(RECENT_CUSTOMER_SQL, /MAX\(TradeDtm\)\s+AS\s+LastTradeDtm/i);
assert.match(RECENT_CUSTOMER_SQL, /DATEADD\(hour,\s*9,\s*SYSUTCDATETIME\(\)\)/i);
assert.match(RECENT_CUSTOMER_SQL, /DATEADD\(day,\s*-89/i);
assert.match(RECENT_CUSTOMER_SQL, /DATEADD\(day,\s*1/i);
assert.match(RECENT_CUSTOMER_SQL, /SYSUTCDATETIME\(\)/i);
assert.match(RECENT_CUSTOMER_SQL, /ORDER BY[\s\S]*LastTradeDtm\s+DESC[\s\S]*CustName,\s*c\.CustKey ASC\s*$/i);
assert.match(RECENT_CUSTOMER_SQL, /c\.CustKey\s*(ASC|DESC)/i, 'ties need a deterministic key order');
assert.doesNotMatch(RECENT_CUSTOMER_SQL, /om\.CustKey\s*=\s*sm\.CustKey|om\.OrderWeek\s*=\s*sm\.OrderWeek/i);

// The pricing save path remains separate from customer recency selection.
const pricingApi = fs.readFileSync(new URL('../pages/api/master/pricing-matrix.js', import.meta.url), 'utf8');
const saveStart = pricingApi.indexOf('async function saveMatrix');
assert.ok(saveStart >= 0, 'saveMatrix must remain present');
const saveBody = pricingApi.slice(saveStart);
assert.doesNotMatch(saveBody, /RECENT_CUSTOMER_SQL|filterPricingCustomers|toggleVisiblePricingCustomers/);

console.log('pricing customer selection tests passed');
