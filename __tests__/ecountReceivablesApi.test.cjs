'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const api = fs.readFileSync('pages/api/ecount/receivables.js', 'utf8');
const ui = fs.readFileSync('pages/ecount/receivables.js', 'utf8');
const layout = fs.readFileSync('components/Layout.js', 'utf8');

assert.match(api, /Cache-Control', 'private, no-store'/);
assert.match(api, /isLedgerAdmin\(req\.user\)/);
assert.match(api, /attachCustomerAverages\(sourceRows, customers, customerMetrics/);
assert.match(api, /payload\.etcDiff/);
assert.match(api, /ShipmentMaster sm[\s\S]*ShipmentDetail sd/);
assert.match(api, /ISNULL\(sd\.isFix,0\)=1/);
assert.match(api, /sd\.ShipmentDtm >= @from AND sd\.ShipmentDtm < @to/);
assert.doesNotMatch(api, /\b(?:INSERT\s+INTO|UPDATE\s+dbo\.|DELETE\s+FROM|MERGE\s+dbo\.)/i,
  'ECOUNT receivables and average metrics are read-only');

for (const label of ['거래처명', '매출합계', '수금합계', '기타할인등차액', '잔액', '미회수월', '월평균 매출', '차수별 평균 매출']) {
  assert.ok(ui.includes(label), `missing table column: ${label}`);
}
assert.match(ui, /최근 12개월/);
assert.match(layout, /href: '\/ecount\/receivables', labelKey: '💳 ECOUNT 채권 요약'/);

const transformed = api
  .replace(/^import .*;\r?\n/gm, '')
  .replace('export default withAuth(async function handler(', 'module.exports = withAuth(async function handler(');
const moduleBox = { exports: {} };
const users = [
  { CustKey: 1, CustName: 'A', managerUserId: 'alice', managerMatchCount: 1 },
  { CustKey: 2, CustName: 'B', managerUserId: 'bob', managerMatchCount: 1 },
  { CustKey: 3, CustName: 'Duplicate', managerUserId: 'alice', managerMatchCount: 1 },
  { CustKey: 4, CustName: ' Duplicate ', managerUserId: 'bob', managerMatchCount: 1 },
];
const payload = (salesTotal, receiptTotal, etcDiff, balance, agingMonth) => JSON.stringify({ salesTotal, receiptTotal, etcDiff, balance, agingMonth });
const query = async (statement) => {
  if (statement.includes('TOP 1 SnapshotKey')) return { recordset: [{ SnapshotKey: 90, takenAt: '2026-10-28 08:00:00' }] };
  if (statement.includes('FROM dbo.Customer c')) return { recordset: users };
  if (statement.includes('WITH customerSales')) return { recordset: [
    { CustKey: 1, avgSalesMonthly: 1200, avgSalesCycle: 300, cycleCount: 4 },
    { CustKey: 2, avgSalesMonthly: 900, avgSalesCycle: 450, cycleCount: 2 },
  ] };
  if (statement.includes('SELECT CustName, Payload')) return { recordset: [
    { CustName: 'A', Payload: payload(1000, 800, 5, 205, '2개월') },
    { CustName: 'B', Payload: payload(2000, 1500, 10, 510, '4개월') },
    { CustName: 'Duplicate', Payload: payload(500, 200, 0, 300, '1개월') },
    { CustName: 'Unmapped', Payload: payload(700, 500, 3, 203, '3개월') },
  ] };
  assert.fail(`unexpected query: ${statement}`);
};
vm.runInNewContext(`const { query, sql, withAuth, isLedgerAdmin, averageSalesWindow, attachCustomerAverages } = deps;\n${transformed}`, {
  module: moduleBox, deps: {
    query, sql: { Int: 'int', Date: 'date' }, withAuth: (handler) => handler,
    isLedgerAdmin: require('../lib/ecountCustomerLedgerPolicy.cjs').isLedgerAdmin,
    ...require('../lib/ecountReceivablesPolicy.cjs'),
  }, Number, String, Date, Math, Map, JSON, process,
});
async function invoke(userId) {
  const res = { statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } };
  await moduleBox.exports({ method: 'GET', query: {}, user: { userId } }, res);
  return res;
}
(async () => {
  const owner = await invoke('alice');
  assert.equal(owner.statusCode, 200);
  assert.equal(owner.headers['Cache-Control'], 'private, no-store');
  assert.deepEqual(owner.body.rows.map((row) => row.name), ['A']);
  assert.equal(owner.body.rows[0].etcDiff, 5);
  assert.equal(owner.body.rows[0].avgSalesMonthly, 1200);
  assert.equal(owner.body.rows[0].avgSalesCycle, 300);
  const admin = await invoke('nenovaSS3');
  assert.equal(admin.body.rows.length, 4);
  assert.equal(admin.body.scope, 'all');
  assert.equal(admin.body.rows.find((row) => row.name === 'Duplicate').avgSalesMonthly, null);
  console.log('ecountReceivablesApi: mocked handler scope and display calculations passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
console.log('ecountReceivablesApi: read-only scope, averages and navigation passed');
