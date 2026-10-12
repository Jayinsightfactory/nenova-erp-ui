const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const root = path.resolve(__dirname, '..');
  const snapshot = await import('../lib/profitReportSnapshot.js');
  const calc = await import('../lib/profitReportCalc.js');
  const registry = snapshot.readProfitReportSnapshotRegistry();

  const record28 = snapshot.findSnapshotRecord(registry, '2026', '28');
  assert.equal(record28.state, 'CONFIRMED');
  assert.equal(snapshot.findSnapshotRecord(registry, '2025', '28'), null, '다른 연도의 같은 차수로 fallback하면 안 된다.');
  assert.equal(snapshot.findBundledConfirmedSnapshot('2026', '27'), null, '부분검증 27차를 확정본으로 반환하면 안 된다.');

  const materialized = snapshot.materializeBundledSnapshot(record28);
  assert.equal(materialized.snapshot.immutable, true);
  assert.equal(materialized.snapshot.recalculationAllowed, false);
  const domestic = materialized.rows.find(row => row.category === '국내');
  assert.equal(calc.computeProfitRow(domestic).C, 619546);
  const totals = calc.computeProfitTotals(materialized.rows.map(row => ({ ...row, calc: calc.computeProfitRow(row) })));
  for (const key of ['C', 'E', 'F', 'G', 'H', 'I', 'J']) {
    assert.ok(Math.abs(Number(totals[key]) - Number(record28.totals[key])) < 0.01, `${key} 확정 합계가 고정돼야 한다.`);
  }

  const synthetic = {
    rows: [{ category: '태국', variant: 'normal', auto: { N: 100, L: 0, O: 0, Q: 1, R: 1000, S: 0, H: 0, E: 0, F: 0 }, manual: {}, stock: {} }],
    note: '고정', audit: { status: 'ready', errorCount: 0, warningCount: 0, issues: [] },
  };
  const frozen = snapshot.freezeLiveReportData(synthetic, { confirmedBy: 'tester', confirmedAt: '2026-08-13T00:00:00.000Z' });
  synthetic.rows[0].auto.N = 999999;
  assert.equal(calc.computeProfitRow(frozen.rows[0]).C, 100, '확정 뒤 현재 원장 변경을 재계산에 섞으면 안 된다.');

  const source = fs.readFileSync(path.join(root, 'lib/profitReportSnapshot.js'), 'utf8');
  const customsSource = fs.readFileSync(path.join(root, 'lib/customsForwarding.js'), 'utf8');
  const api = fs.readFileSync(path.join(root, 'pages/api/sales/profit-report.js'), 'utf8');
  const customsApi = fs.readFileSync(path.join(root, 'pages/api/sales/customs-clearance.js'), 'utf8');
  const forwardingApi = fs.readFileSync(path.join(root, 'pages/api/sales/forwarding-clearance.js'), 'utf8');
  const page = fs.readFileSync(path.join(root, 'pages/sales/profit-report.js'), 'utf8');
  const migration = fs.readFileSync(path.join(root, 'docs/migrations/2026-08-13_web_profit_report_snapshot.sql'), 'utf8');
  const rateMigration = fs.readFileSync(path.join(root, 'docs/migrations/2026-08-13_web_customs_rate_history.sql'), 'utf8');
  assert.doesNotMatch(source, /CREATE\s+TABLE/i, 'snapshot 런타임 코드에 DDL이 있으면 안 된다.');
  assert.doesNotMatch(source, /ensureSnapshotTable/);
  assert.match(source, /PROFIT_REPORT_SNAPSHOT_MIGRATION_REQUIRED/);
  assert.match(migration, /CREATE TABLE dbo\.WebProfitReportSnapshot/);
  assert.ok(api.indexOf('loadConfirmedProfitReportSnapshot(orderYear, major)') < api.indexOf('salesByCategory(major, orderYear)'),
    '확정본은 현재 ERP 원천 조회보다 먼저 선택해야 한다.');
  assert.match(api, /await assertProfitReportMutable\(orderYear, major\);[\s\S]*stockPriceRows/);
  assert.match(customsApi, /await assertProfitReportMutable\(orderYear, major\);[\s\S]*saveRateConfig/);
  assert.match(forwardingApi, /await assertProfitReportMutable\(orderYear, major\);[\s\S]*saveForwardingWeekly/);
  const rateHistorySection = customsSource.slice(customsSource.indexOf('export async function getRateConfig'), customsSource.indexOf('export async function saveRateConfig'));
  assert.doesNotMatch(rateHistorySection, /CREATE\s+TABLE/i, '단가 이력 GET 경로에서 신규 이력 테이블을 만들면 안 된다.');
  assert.match(rateHistorySection, /CUSTOMS_RATE_HISTORY_MIGRATION_REQUIRED/);
  assert.match(rateMigration, /CREATE TABLE dbo\.WebCustomsRateHistory/);
  assert.match(page, /snapshotImmutable/);
  assert.match(page, /readOnly=\{snapshotImmutable\}/);
  assert.match(page, /!snapshotImmutable && data &&/);

  const states = Object.fromEntries(registry.weeks.map(row => [row.majorWeek, row.state]));
  for (const major of ['22', '23', '24', '25', '26']) assert.equal(states[major], 'UNVERIFIED');
  assert.equal(states['27'], 'PARTIAL_VERIFIED');
  assert.equal(states['28'], 'CONFIRMED');

  console.log('profit report confirmed snapshot tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
