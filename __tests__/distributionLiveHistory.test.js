'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { normalizeScope, parseMessages, pairRequests, toFacts, loadLiveHistoryFacts } = require('../lib/distributionLiveHistory');
const balance = require('../lib/distributionRequestBalance');

const scope = normalizeScope({ year: 2026, week: '37-01', from: '2026-09-10', to: '2026-09-11' });
const facts = toFacts({
  customers: [{ CustKey: 11, CustName: '라움' }],
  products: [{ ProdKey: 22, ProdName: '화이트', DisplayName: 'White', OutUnit: '단', BunchOf1Box: 10, SteamOf1Box: 100 }],
  orderRows: [{ eventId: 1, year: '2026', week: '37-01', custKey: 11, prodKey: 22, custName: '라움', prodName: '화이트', unit: '단', before: '3', after: '23', changeLocal: '2026-09-10T10:00:00.000' }],
  shipmentRows: [{ eventId: 2, year: '2026', week: '37-01', custKey: 11, prodKey: 22, custName: '라움', prodName: '화이트', unit: '단', before: 1, after: 21, changeLocal: '2026-09-10T10:01:00.000', shipmentDate: '2026-09-11', shipmentDateCount: 1 }],
});
const aliases = { customers: { '라움별칭': { custKey: 11 } }, products: { '화이트별칭': { prodKey: 22 } } };
const items = pairRequests(parseMessages([{ identity: 'm1', message: '라움별칭\n화이트별칭 2박스 추가', created_at: '2026-09-10T09:00:00+09:00', timestamp_approximate: false }], facts, aliases, scope), facts, scope);
assert.equal(items[0].status, 'ORDER_AND_DISTRIBUTION');
assert.equal(items[0].requests[0].qty, 20);
assert.equal(items[0].requests[0].orderEvents[0].before, 3);
assert.equal(items[0].requests[0].shipmentEvents[0].after, 21);
assert.equal(items[0].requests[0].matchState, 'MATCHING_HISTORY');

const priorYear = toFacts({ customers: facts.customers, products: facts.products, orderRows: [{ ...facts.orderEvents[0], year: '2025', changeAt: '2026-09-10T10:00:00+09:00' }] });
const crossYear = pairRequests(parseMessages([{ identity: 'm2', message: '라움 화이트 2박스 추가', created_at: '2026-09-10T09:00:00+09:00' }], priorYear, {}, scope), priorYear, scope);
assert.equal(crossYear[0].requests[0].status, 'NO_LIVE_EVIDENCE');

const noDate = pairRequests(parseMessages([{ identity: 'm3', message: '라움 화이트 2박스 추가', timestamp_approximate: false }], facts, {}, scope), facts, scope);
assert.equal(noDate[0].requests[0].status, 'AMBIGUOUS');
assert.match(noDate[0].requests[0].reason, /작성 시각/);
const deleted = parseMessages([{ identity: 'm4', message: '라움 화이트 2박스 삭제', created_at: '2026-09-10T09:00:00+09:00' }], facts, {}, scope);
assert.equal(deleted[0].requests[0].status, 'AMBIGUOUS');
assert.match(deleted[0].requests[0].reason, /삭제/);
assert.throws(() => normalizeScope({ year: 2026, week: '37-01', from: '2026-09-01', to: '2026-09-09' }), /최대 7일/);

const source = fs.readFileSync(require.resolve('../pages/api/orders/distribution-live-history.js'), 'utf8');
assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|MERGE)\b|Anthropic|openai/i);
assert.match(source, /accountActive !== true/);
assert.match(source, /sameOrigin/);
assert.match(source, /erpAction: 'NONE'/);
assert.match(source, /FACT_CACHE_TTL_MS = 30000/);
assert.match(source, /FACT_CACHE_MAX = 24/);
assert.match(source, /request\.timeout = 8000/);
const liveSource = fs.readFileSync(require.resolve('../lib/distributionLiveHistory'), 'utf8');
assert.match(liveSource, /om\.OrderMasterKey=od\.OrderMasterKey/);
assert.doesNotMatch(liveSource, /om\.OrderKey=od\.OrderKey/);
assert.match(liveSource, /h\.ColumName=N'주문수량'/);
assert.match(liveSource, /TRY_CONVERT\(decimal\(28,6\),NULLIF/);
assert.match(liveSource, /CONVERT\(varchar\(10\),h\.ShipmentDtm,23\) AS shipmentDate/);
assert.doesNotMatch(liveSource, /sd\.isDeleted/);
assert.doesNotMatch(liveSource, /h\.isDeleted/);
const twoCustomers = toFacts({
  customers: [...facts.customers, { CustKey: 12, CustName: '꽃길' }], products: facts.products,
  orderRows: [
    { eventId: 31, year: '2026', week: '37-01', custKey: 11, prodKey: 22, unit: '단', before: 20, after: 10, changeLocal: '2026-09-10T10:00:00.000' },
    { eventId: 32, year: '2026', week: '37-01', custKey: 12, prodKey: 22, unit: '단', before: 10, after: 20, changeLocal: '2026-09-10T10:01:00.000' },
  ],
});
const sequential = parseMessages([{ identity: 'm6', message: '라움\n취소\n화이트 1박스\n꽃길\n추가\n화이트 1박스', created_at: '2026-09-10T09:00:00+09:00' }], twoCustomers, {}, scope);
assert.equal(sequential[0].requests.length, 2);
assert.deepEqual(sequential[0].requests.map(request => [request.custKey, request.action]), [[11, 'CANCEL'], [12, 'ADD']]);
const wrongWeek = parseMessages([{ identity: 'm7', message: '36-1\n라움 화이트 1박스 추가', created_at: '2026-09-10T09:00:00+09:00' }], facts, {}, scope);
assert.match(wrongWeek[0].requests[0].reason, /36-01/);
for (const [identity, message] of [
  ['m7-year', '2025-37-01\n라움\n화이트 1박스 추가'],
  ['m7-suffix', '36-1차\n라움\n화이트 1박스 추가'],
]) {
  const mismatch = parseMessages([{ identity, message, created_at: '2026-09-10T09:00:00+09:00' }], facts, {}, scope);
  assert.equal(mismatch[0].requests[0].status, 'AMBIGUOUS');
}
const currentSuffix = parseMessages([{ identity: 'm7-current', message: '37-1차\n라움\n화이트 1박스 추가', created_at: '2026-09-10T09:00:00+09:00' }], facts, {}, scope);
assert.equal(currentSuffix[0].requests[0].status, 'PENDING');
const nearMiss = parseMessages([{ identity: 'm7-near', message: '새라움플라워\n레드와인 1박스 추가', created_at: '2026-09-10T09:00:00+09:00' }], toFacts({ customers: [{ CustKey: 11, CustName: '라움' }], products: [{ ProdKey: 22, ProdName: '레드', OutUnit: '단', BunchOf1Box: 10, SteamOf1Box: 100 }] }), {}, scope);
assert.equal(nearMiss[0].requests[0].status, 'AMBIGUOUS');
const exactDirect = parseMessages([{ identity: 'm7-exact', message: '라움 화이트 2박스 추가', created_at: '2026-09-10T09:00:00+09:00' }], facts, {}, scope);
assert.equal(exactDirect[0].requests[0].status, 'PENDING');
const productionFacts = toFacts({
  customers: [{ CustKey: 1, CustName: '친구플라워' }, { CustKey: 2, CustName: '대구희경' }, { CustKey: 3, CustName: '그린' }, { CustKey: 4, CustName: '수연' }],
  products: [
    { ProdKey: 1411, ProdName: 'ROSE Lollipop White Blue 40cm', OutUnit: '단', BunchOf1Box: 10, SteamOf1Box: 100 },
    { ProdKey: 3086, ProdName: '미디오(연블루)', OutUnit: '단', BunchOf1Box: 10, SteamOf1Box: 100 },
    { ProdKey: 866, ProdName: 'Hydrangea Blue', OutUnit: '단', BunchOf1Box: 10, SteamOf1Box: 100 },
    { ProdKey: 2255, ProdName: '레몬잎 운송료', OutUnit: '박스', BunchOf1Box: 1, SteamOf1Box: 1 },
    { ProdKey: 502, ProdName: 'CARNATION Yukari Cherry', OutUnit: '단', BunchOf1Box: 10, SteamOf1Box: 100 },
    { ProdKey: 890, ProdName: 'Hydrangea GOLD PEACH', OutUnit: '단', BunchOf1Box: 10, SteamOf1Box: 100 },
  ],
});
const productionAliases = { products: {
  '콜롬비아 장미 롤리팝 화이트 블루': { prodKey: 1411 }, '블루': { prodKey: 3086 }, '레몬잎': { prodKey: 2255 },
  '유카리체리': { prodKey: 502 }, '콜롬비아 수국 피치': { prodKey: 890 }, '콜롬비아 수국 블루': { prodKey: 866 },
} };
const lollipop = parseMessages([{ identity: 'm-prod-1', message: '37-1 콜 장미 변경사항\n친구플라워\n롤리팝 화이트 블루 10단 취소\n대구희경\n롤리팝 화이트 블루 10단 추가', created_at: '2026-09-10T09:00:00+09:00' }], productionFacts, productionAliases, scope);
assert.deepEqual(lollipop[0].requests.map(request => [request.custKey, request.prodKey, request.action]), [[1, 1411, 'CANCEL'], [2, 1411, 'ADD']]);
const fee = parseMessages([{ identity: 'm-prod-2', message: '친구플라워\n레몬잎 1박스 추가', created_at: '2026-09-10T09:00:00+09:00' }], productionFacts, productionAliases, scope);
assert.equal(fee[0].requests[0].status, 'AMBIGUOUS'); assert.match(fee[0].requests[0].reason, /비물리 품목/);
const unknownCustomer = parseMessages([{ identity: 'm-prod-3', message: '그린\n유카리체리1박스취소\n청지\n유카리체리1박스추가', created_at: '2026-09-10T09:00:00+09:00' }], productionFacts, productionAliases, scope);
assert.equal(unknownCustomer[0].requests[0].custKey, 3);
assert.equal(unknownCustomer[0].requests[1].status, 'AMBIGUOUS');
const colombiaPeach = parseMessages([{ identity: 'm-prod-4', message: '37-1 콜 수국 변경사항\n수연\n피치1박스추가', created_at: '2026-09-10T09:00:00+09:00' }], productionFacts, productionAliases, scope);
assert.deepEqual(colombiaPeach[0].requests.map(request => [request.status, request.prodKey]), [['PENDING', 890]]);
const familyBlue = parseMessages([{ identity: 'm-prod-5', message: '37-1 콜 수국 변경사항\n수연\n블루1박스추가', created_at: '2026-09-10T09:00:00+09:00' }], productionFacts, productionAliases, scope);
assert.deepEqual(familyBlue[0].requests.map(request => [request.status, request.prodKey]), [['PENDING', 866]]);
const familyFacts = toFacts({ customers: facts.customers, products: [{ ProdKey: 22, ProdName: 'ERP-WHITE', OutUnit: '단', BunchOf1Box: 10, SteamOf1Box: 100 }] });
const family = parseMessages([{ identity: 'm8', message: '라움\n수국\n취소\n화이트 1박스', created_at: '2026-09-10T09:00:00+09:00' }], familyFacts, { products: { '수국 화이트': { prodKey: 22 } } }, scope);
assert.deepEqual(family[0].requests.map(request => [request.prodKey, request.action]), [[22, 'CANCEL']]);
const franklinAlias = { products: { '카네이션 돈셀': { prodKey: 22 } } };
const franklinResolved = parseMessages([{ identity: 'm10', message: '37-1 카네이션 변경사항\n라움\n돈셀 1박스 취소', created_at: '2026-09-10T09:00:00+09:00' }], familyFacts, franklinAlias, scope);
assert.deepEqual(franklinResolved[0].requests.map(request => [request.status, request.action, request.prodKey]), [['PENDING', 'CANCEL', 22]]);
for (const [identity, message] of [
  ['m11', '라움\n카네이션\n추가\n돈셀 1박스 유지'],
  ['m12', '라움\n카네이션\n추가\n돈셀 1박스 추가 취소'],
]) {
  const denied = parseMessages([{ identity, message, created_at: '2026-09-10T09:00:00+09:00' }], familyFacts, franklinAlias, scope);
  assert.equal(denied[0].requests[0].status, 'AMBIGUOUS');
  assert.notEqual(denied[0].requests[0].status, 'PENDING');
}
const dateOnly = parseMessages([{ identity: 'm9', message: '2026-09-11', created_at: '2026-09-10T09:00:00+09:00' }], facts, {}, scope);
assert.match(dateOnly[0].requests[0].reason, /출고일만/);
const mixed = pairRequests([{ sourceIdentity: 'mixed', requests: [
  { ...items[0].requests[0], id: 'mixed:1', status: 'PENDING', orderEvents: [], shipmentEvents: [] },
  { ...items[0].requests[0], id: 'mixed:2', prodKey: 999, status: 'PENDING', orderEvents: [], shipmentEvents: [] },
] }], facts, scope);
assert.equal(mixed[0].status, 'AMBIGUOUS');
const route = source
  .replace("import { getPool, sql } from '../../../lib/db';", 'const { getPool, sql } = deps.db;')
  .replace("import { withAuth } from '../../../lib/auth';", 'const { withAuth } = deps.auth;')
  .replace("import { loadMappings } from '../../../lib/parseMappings';", 'const { loadMappings } = deps.products;')
  .replace("import { loadCustomerMappings } from '../../../lib/customerMappings';", 'const { loadCustomerMappings } = deps.customers;')
  .replace("import { normalizeScope, parseMessages, pairRequests, loadLiveHistoryFacts } from '../../../lib/distributionLiveHistory';", 'const { normalizeScope, parseMessages, pairRequests, loadLiveHistoryFacts } = deps.live;')
  .replace("import { cloneParsedItems, loadDistributionRequestBalanceFacts, buildDistributionRequestBalanceComparison } from '../../../lib/distributionRequestBalance';", 'const { cloneParsedItems, loadDistributionRequestBalanceFacts, buildDistributionRequestBalanceComparison } = deps.balance;')
  .replace('export const config', 'const config')
  .replace('export default withAuth', 'module.exports = withAuth');
const compiledModule = { exports: null };
let routeFactCalls = 0;
let routeFailure = false;
let routeBalanceFailure = false;
const routeDbRequests = [];
vm.runInNewContext(route, { module: compiledModule, deps: {
  db: { getPool: async () => ({ request: () => {
    const request = { timeout: null, bindings: [], input(name, type, value) { this.bindings.push({ name, type, value }); return this; }, async query(statement) { routeDbRequests.push({ timeout: this.timeout, bindings: this.bindings, statement }); if (routeBalanceFailure && statement.includes('FROM StockMaster')) throw new Error('balance facts unavailable'); return { recordset: [] }; } };
    return request;
  } }), sql: {} }, auth: { withAuth: handler => handler },
  products: { loadMappings: () => aliases.products }, customers: { loadCustomerMappings: () => aliases.customers },
  live: { normalizeScope, parseMessages, pairRequests, loadLiveHistoryFacts: async (q, sqlArg, requestedScope) => { routeFactCalls += 1; await q('SELECT 1', { scopeYear: { type: sqlArg.NVarChar, value: requestedScope.year } }); if (routeFailure) throw new Error('mock failure'); return facts; } },
  balance,
}, URL, Date, JSON, String, Number, Array, Object, Set });
const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
compiledModule.exports({ method: 'POST', headers: { origin: 'https://board.example', host: 'board.example' }, user: { accountActive: true }, body: { year: 2026, week: '37-01', from: '2026-09-10', to: '2026-09-11', messages: [{ identity: 'm5', message: '라움 화이트 2박스 추가', created_at: '2026-09-10T09:00:00+09:00' }] } }, res).then(async () => {
  assert.equal(res.statusCode, 200); assert.equal(res.body.erpAction, 'NONE'); assert.equal(res.body.advisoryOnly, true);
  assert.equal(res.body.balanceComparison.products[0].actualDistributionTotal, 0);
  assert.equal(res.body.balanceComparison.products[0].snapshotStatus, 'UNKNOWN');
  assert.deepEqual(JSON.parse(JSON.stringify(res.body.balanceComparison.products[0].requests.map(row => row.sourceIdentity))), ['m5']);
  const cacheRequest = (overrides = {}) => ({ method: 'POST', headers: { origin: 'https://board.example', host: 'board.example' }, user: { accountActive: true }, body: { year: 2026, week: '37-01', from: '2026-09-10', to: '2026-09-11', messages: [{ identity: `cache-${Math.random()}`, message: '라움 화이트 2박스 추가', created_at: '2026-09-10T09:00:00+09:00' }], ...overrides } });
  const cacheResponse = () => ({ statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
  await Promise.all([compiledModule.exports(cacheRequest(), cacheResponse()), compiledModule.exports(cacheRequest(), cacheResponse())]);
  assert.equal(routeFactCalls, 1, 'same-scope concurrent requests must share one in-flight facts load');
  const liveQuery = routeDbRequests.find(call => call.statement === 'SELECT 1');
  assert.equal(liveQuery.timeout, 8000);
  assert.deepEqual(JSON.parse(JSON.stringify(liveQuery.bindings)), [{ name: 'scopeYear', value: '2026' }]);
  const snapshotQuery = routeDbRequests.find(call => call.statement.includes('JOIN ProductStock'));
  const distributionQuery = routeDbRequests.find(call => call.statement.includes('FROM ViewShipment'));
  assert.ok(snapshotQuery && distributionQuery, 'API must read snapshot and current distribution through its local mock DB adapter');
  assert.match(snapshotQuery.statement, /COUNT_BIG\(DISTINCT sm\.StockKey\)/);
  assert.match(distributionQuery.statement, /JOIN Product p ON p\.ProdKey=vs\.ProdKey/);
  assert.doesNotMatch(distributionQuery.statement, /ShipmentDate|vs\.OutUnit/);
  await compiledModule.exports(cacheRequest(), cacheResponse());
  assert.equal(routeFactCalls, 1, 'successful same-scope facts stay private for the TTL');
  await compiledModule.exports(cacheRequest({ week: '38-01' }), cacheResponse());
  assert.equal(routeFactCalls, 2, 'a different exact scope must not reuse facts');
  routeFailure = true;
  const failed = cacheResponse();
  await compiledModule.exports(cacheRequest({ week: '39-01' }), failed);
  assert.equal(failed.statusCode, 503); assert.equal(routeFactCalls, 3);
  routeFailure = false;
  const retried = cacheResponse();
  await compiledModule.exports(cacheRequest({ week: '39-01' }), retried);
  assert.equal(retried.statusCode, 200); assert.equal(routeFactCalls, 4, 'failed loads must not be cached');
  routeBalanceFailure = true;
  const historyOnly = cacheResponse();
  await compiledModule.exports(cacheRequest({ week: '40-01' }), historyOnly);
  assert.equal(historyOnly.statusCode, 200, 'balance facts failing alone must preserve live-history response');
  assert.equal(historyOnly.body.balanceComparison, undefined);
  assert.ok(historyOnly.body.items.length > 0);
  assert.ok(historyOnly.body.warnings.some(warning => /잔량 비교를 생략/.test(warning)));
  assert.equal(routeFactCalls, 5);
  routeBalanceFailure = false;
  const balanceRetried = cacheResponse();
  await compiledModule.exports(cacheRequest({ week: '40-01' }), balanceRetried);
  assert.equal(balanceRetried.statusCode, 200);
  assert.ok(balanceRetried.body.balanceComparison, 'partial balance failure must not be cached as a complete scope');
  assert.equal(routeFactCalls, 6);
  const sqlCalls = [];
  const adapterFacts = await loadLiveHistoryFacts(async (statement, params) => {
    sqlCalls.push({ statement, params });
    if (statement.includes('FROM Customer')) return { recordset: [{ CustKey: 11, CustName: '라움' }] };
    if (statement.includes('FROM Product')) return { recordset: [{ ProdKey: 22, ProdName: '화이트', OutUnit: '단', BunchOf1Box: 10, SteamOf1Box: 100 }] };
    if (statement.includes('FROM OrderHistory')) return { recordset: [{ eventId: 101, year: '2026', week: '37-01', custKey: 11, prodKey: 22, unit: '단', before: '3', after: '23', changeLocal: '2026-09-10T10:00:00.000' }] };
    if (statement.includes('FROM ShipmentHistory')) return { recordset: [{ eventId: 102, year: '2026', week: '37-01', custKey: 11, prodKey: 22, unit: '단', before: '1', after: '21', changeLocal: '2026-09-10T10:01:00.000', shipmentDate: '2026-09-11', shipmentDateCount: 2 }] };
    throw new Error('unexpected SQL');
  }, { NVarChar: 'NVARCHAR' }, scope);
  assert.equal(sqlCalls.length, 4);
  const historySql = sqlCalls.filter(call => /History/.test(call.statement));
  assert.equal(historySql.length, 2);
  for (const call of historySql) {
    assert.match(call.statement, /OrderYear=@year/);
    assert.match(call.statement, /OrderWeek=@week/);
    assert.match(call.statement, /ChangeDtm>=CONVERT\(datetime,@from,126\)/);
    assert.match(call.statement, /ChangeDtm<DATEADD\(day,1,CONVERT\(datetime,@to,126\)\)/);
    assert.doesNotMatch(call.statement, /\b(?:INSERT|UPDATE|DELETE|MERGE|EXEC)\b/i);
    assert.equal(call.params.year.value, '2026'); assert.equal(call.params.week.value, '37-01');
  }
  const orderSql = historySql.find(call => call.statement.includes('FROM OrderHistory')).statement;
  assert.match(orderSql, /om\.OrderMasterKey=od\.OrderMasterKey/);
  assert.match(orderSql, /h\.ColumName=N'주문수량'/);
  assert.doesNotMatch(orderSql, /h\.isDeleted/);
  const shipmentSql = historySql.find(call => call.statement.includes('FROM ShipmentHistory')).statement;
  assert.match(shipmentSql, /h\.ShipmentDtm/);
  assert.doesNotMatch(shipmentSql, /sd\.isDeleted/);
  assert.equal(adapterFacts.shipmentEvents[0].shipmentDate, '2026-09-11');
  assert.equal(adapterFacts.shipmentEvents[0].multiDate, true);
  const blocked = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await compiledModule.exports({ method: 'POST', headers: { host: 'board.example' }, user: { accountActive: true }, body: { year: 2026, week: '37-01', from: '2026-09-10', to: '2026-09-11', messages: [] } }, blocked);
  assert.equal(blocked.statusCode, 403);
  console.log('distribution live history tests passed');
}).catch(error => { console.error(error); process.exitCode = 1; });
