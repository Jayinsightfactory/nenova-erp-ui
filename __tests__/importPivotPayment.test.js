const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const {
    PAYMENT_DAYS, normalizePaymentDay, paymentDayLabel,
    farmMatchesPaymentDay, summarizePaymentDay,
  } = await import('../lib/importPivotPayment.js');

  assert.deepEqual(PAYMENT_DAYS, [5, 15, 25, 30]);
  assert.equal(normalizePaymentDay('15'), 15);
  assert.equal(normalizePaymentDay('10'), null);
  assert.equal(paymentDayLabel(25), '25일');
  assert.equal(normalizePaymentDay('30'), 30);
  assert.equal(paymentDayLabel(30), '30일');
  assert.equal(paymentDayLabel(null), '미설정');

  const paymentDays = { '농장A': 5, '농장B': 15 };
  assert.equal(farmMatchesPaymentDay('농장A', paymentDays, 5), true);
  assert.equal(farmMatchesPaymentDay('농장A', paymentDays, 15), false);
  assert.equal(farmMatchesPaymentDay('농장C', paymentDays, 5), false);
  assert.equal(farmMatchesPaymentDay('농장C', paymentDays, ''), true);

  const summary = summarizePaymentDay([
    { name: '농장A', total: 100 },
    { name: '농장B', total: 25.5 },
    { name: '농장C', total: 7 },
  ], paymentDays);
  assert.equal(summary[5], 100);
  assert.equal(summary[15], 25.5);
  assert.equal(summary[25], 0);
  assert.equal(summary[30], 0);
  assert.equal(summary.unassigned, 7);

  const page = fs.readFileSync(path.join(__dirname, '..', 'pages', 'stats', 'pivot-import.js'), 'utf8');
  const settingsPage = fs.readFileSync(path.join(__dirname, '..', 'pages', 'stats', 'pivot-import-farm-settings.js'), 'utf8');
  const api = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'stats', 'pivot-import.js'), 'utf8');
  assert.match(page, /load\(\{ latest: true \}\)/, '메뉴 진입 시 최신 입고 차수를 자동 조회해야 합니다.');
  assert.match(page, /pivot-import-farm-settings/, '결제일 설정은 별도 페이지로 연결되어야 합니다.');
  assert.match(page, /JSON\.stringify\(activeFarmNames\(\)\)/, '선택 농장만 정산서/엑셀에 전달해야 합니다.');
  assert.match(settingsPage, /type: 'farmPaymentDay'/, '별도 설정 페이지가 농장별 결제일을 저장해야 합니다.');
  assert.match(settingsPage, /type: 'farmPaymentDayBatch'/, '별도 설정 페이지에 일괄 저장 payload가 있어야 합니다.');
  assert.match(settingsPage, /일괄저장/, '별도 설정 페이지에 일괄저장 버튼이 있어야 합니다.');
  assert.match(settingsPage, /<details>/, '농장 결제일 설정 영역은 기본 접힘이어야 합니다.');
  assert.doesNotMatch(settingsPage, /<details\s+open/, '농장 결제일 설정 영역이 기본 펼침이면 안 됩니다.');
  assert.match(api, /WebImportFarmPaymentDay/, '농장별 결제일 웹 테이블을 사용해야 합니다.');
  assert.match(api, /farmSettings === '1'/, '별도 설정 페이지용 전체 농장 조회 분기가 있어야 합니다.');
  assert.match(api, /farmPaymentDayBatch/, 'API가 농장 결제일 일괄 저장을 지원해야 합니다.');
  assert.match(api, /const detailRows = selectedFarmNames[\s\S]*?for \(const d of detailRows\)/, '정산서 그룹 생성도 선택 농장 필터를 적용해야 합니다.');
  assert.match(api, /buildSettlementExcel\(r, payDate, selectedFarmNames\)/, '정산서 엑셀 생성에 농장 필터를 전달해야 합니다.');
  assert.doesNotMatch(api, /async function loadFarmPaymentDays\(\) \{\s*await ensureFarmPaymentTable\(\)/, 'GET 결제일 조회가 DDL ensure를 실행하면 안 됩니다.');
  assert.doesNotMatch(api, /async function loadAdjustments\(r\) \{\s*await ensureAdjTable\(\)/, 'GET 수기항목 조회가 DDL ensure를 실행하면 안 됩니다.');
  assert.doesNotMatch(api, /async function loadFwdInvoices\(r\) \{\s*await ensureFwdTable\(\)/, 'GET 포워더 조회가 DDL ensure를 실행하면 안 됩니다.');

  const migration = fs.readFileSync(path.join(__dirname, '..', 'docs', 'migrations', '2026-08-03_web_import_farm_payment_day.sql'), 'utf8');
  assert.match(migration, /CREATE TABLE dbo\.WebImportFarmPaymentDay/, '결제일 테이블은 migration에서 생성해야 합니다.');
  assert.match(migration, /CREATE TABLE dbo\.WebImportPivotAdj/, '수기항목 테이블은 migration에서 생성해야 합니다.');
  assert.match(migration, /CREATE TABLE dbo\.WebForwarderInvoice/, '포워더 테이블은 migration에서 생성해야 합니다.');

  console.log('Import pivot payment tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
