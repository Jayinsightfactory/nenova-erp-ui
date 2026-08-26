import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  RECENT_CUSTOMER_SQL,
  RECENT_PRODUCT_SQL,
  filterPricingCustomers,
  toggleVisiblePricingCustomers,
  filterPricingProducts,
  selectAllPricingProducts,
  selectRecentPricingProducts,
  toggleVisiblePricingProducts,
  visiblePricingProducts,
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

const products = [
  { ProdKey: 11, ProdName: 'Moon Light', FlowerName: '카네이션', CounName: '콜롬비아', HasRecentTrade: true },
  { ProdKey: 22, ProdName: 'White', FlowerName: '수국', CounName: '에콰도르', HasRecentTrade: 0 },
  { ProdKey: 33, ProdName: 'Red Naomi', FlowerName: '장미', CounName: '콜롬비아', HasRecentTrade: '1' },
];
const recentProductKeys = selectRecentPricingProducts(products);
assert.deepEqual(recentProductKeys, new Set([11, 33]), '기본 조회는 최근 거래 품목만 선택한다');
const flagRows = [true, 1, '1', false, 0, '0', undefined].map((flag, i) => ({ ProdKey: i + 1, HasRecentTrade: flag }));
assert.deepEqual(selectRecentPricingProducts(flagRows), new Set([1, 2, 3]));
assert.deepEqual(filterPricingProducts(products, '   ', { recentOnly: true }).map(p => p.ProdKey), [11, 33]);
assert.deepEqual(visiblePricingProducts(products, new Set([22])).map(p => p.ProdKey), [22], '검색으로 선택한 과거 품목은 표에서 보존한다');
const allProductKeys = selectAllPricingProducts(products);
assert.deepEqual(allProductKeys, new Set([11, 22, 33]), '명시 검색은 반환된 전체 품목을 선택한다');
assert.deepEqual(toggleVisiblePricingProducts(allProductKeys, [products[1]]), new Set([11, 33]), '개별 해제는 해당 품목만 제외한다');
assert.deepEqual(toggleVisiblePricingProducts(new Set(), []), new Set(), '빈 선택/빈 표시 대상은 안전하게 처리한다');
assert.deepEqual(toggleVisiblePricingProducts(new Set([99]), products), new Set([99, 11, 22, 33]));
assert.deepEqual(toggleVisiblePricingProducts(new Set([99, 11, 22, 33]), products), new Set([99]), '필터 밖 선택은 전체 해제에도 유지한다');
assert.deepEqual(allProductKeys, new Set([11, 22, 33]), '개별 해제가 원래 Set을 변경하지 않는다');
assert.deepEqual(filterPricingProducts(products, 'white').map(p => p.ProdKey), [22]);
assert.deepEqual(filterPricingProducts(products, '', { recentOnly: true }).map(p => p.ProdKey), [11, 33]);
assert.deepEqual(filterPricingProducts(products, 'white', { recentOnly: true }), [], '최근 기본 필터는 과거 품목을 숨긴다');
const deselected = new Set([11, 33]);
assert.deepEqual(visiblePricingProducts(products, deselected, { search: '콜롬비아' }).map(p => p.ProdKey), [11, 33]);
assert.deepEqual(visiblePricingProducts(products, new Set(), {}).map(p => p.ProdKey), [], '선택 품목이 없으면 bulk 대상도 없다');
assert.deepEqual(visiblePricingProducts(products, new Set([11, 22, 33]), { hideNoCost: true, hasCostMap: { 11: true, 22: false, 33: true } }).map(p => p.ProdKey), [11, 33]);
assert.deepEqual(visiblePricingProducts(products, new Set([11, 22, 33]), { search: '콜롬비아', hideNoCost: true, hasCostMap: { 11: true, 22: true, 33: false } }).map(p => p.ProdKey), [11], '검색/단가숨김/선택의 교집합만 bulk 대상이다');

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

assert.match(RECENT_PRODUCT_SQL, /JOIN\s+OrderDetail\s+od\s+ON\s+od\.OrderMasterKey\s*=\s*om\.OrderMasterKey/i);
assert.match(RECENT_PRODUCT_SQL, /JOIN\s+ShipmentDetail\s+sd\s+ON\s+sd\.ShipmentKey\s*=\s*sm\.ShipmentKey/i);
assert.match(RECENT_PRODUCT_SQL, /od\.OutQuantity[^\n]*>\s*0/i);
assert.match(RECENT_PRODUCT_SQL, /sd\.OutQuantity[^\n]*>\s*0/i);
assert.doesNotMatch(RECENT_PRODUCT_SQL, /sd\.isDeleted/i);
assert.match(RECENT_PRODUCT_SQL, /MAX\(TradeDtm\)\s+AS\s+LastTradeDtm/i);
assert.match(RECENT_PRODUCT_SQL, /DATEADD\(day,\s*-89/i);
assert.match(RECENT_PRODUCT_SQL, /DATEADD\(day,\s*1/i);
assert.match(RECENT_PRODUCT_SQL, /DATEADD\(hour,\s*9,\s*SYSUTCDATETIME\(\)\)/i);

// The pricing save path remains separate from customer recency selection.
const pricingApi = fs.readFileSync(new URL('../pages/api/master/pricing-matrix.js', import.meta.url), 'utf8');
const saveStart = pricingApi.indexOf('async function saveMatrix');
assert.ok(saveStart >= 0, 'saveMatrix must remain present');
assert.equal((pricingApi.match(/query\(RECENT_PRODUCT_SQL\)/g) || []).length, 2, 'normal and EXE branches share identical recent SQL');
const saveBody = pricingApi.slice(saveStart);
assert.doesNotMatch(saveBody, /RECENT_CUSTOMER_SQL|filterPricingCustomers|toggleVisiblePricingCustomers/);
const pricingPage = fs.readFileSync(new URL('../pages/master/pricing.js', import.meta.url), 'utf8');
const bulkBody = pricingPage.slice(pricingPage.indexOf('const handleInlineBulk'), pricingPage.indexOf('// ── 품목별 단가'));
assert.match(bulkBody, /sortedProducts\.forEach/);
assert.doesNotMatch(bulkBody, /\bproducts\.forEach/);

console.log('pricing customer selection tests passed');
