const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const {
    PAYMENT_DAYS, normalizePaymentDay, paymentDayLabel,
    farmMatchesPaymentDay, summarizePaymentDay,
  } = await import('../lib/importPivotPayment.js');

  assert.deepEqual(PAYMENT_DAYS, [5, 15, 25]);
  assert.equal(normalizePaymentDay('15'), 15);
  assert.equal(normalizePaymentDay('10'), null);
  assert.equal(paymentDayLabel(25), '25일');
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
  assert.equal(summary.unassigned, 7);

  const page = fs.readFileSync(path.join(__dirname, '..', 'pages', 'stats', 'pivot-import.js'), 'utf8');
  const settingsPage = fs.readFileSync(path.join(__dirname, '..', 'pages', 'stats', 'pivot-import-farm-settings.js'), 'utf8');
  const api = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'stats', 'pivot-import.js'), 'utf8');
  assert.match(page, /load\(\{ latest: true \}\)/, '메뉴 진입 시 최신 입고 차수를 자동 조회해야 합니다.');
  assert.match(page, /pivot-import-farm-settings/, '결제일 설정은 별도 페이지로 연결되어야 합니다.');
  assert.match(page, /JSON\.stringify\(activeFarmNames\(\)\)/, '선택 농장만 정산서/엑셀에 전달해야 합니다.');
  assert.match(settingsPage, /type: 'farmPaymentDay'/, '별도 설정 페이지가 농장별 결제일을 저장해야 합니다.');
  assert.match(settingsPage, /<details>/, '농장 결제일 설정 영역은 기본 접힘이어야 합니다.');
  assert.doesNotMatch(settingsPage, /<details\s+open/, '농장 결제일 설정 영역이 기본 펼침이면 안 됩니다.');
  assert.match(api, /WebImportFarmPaymentDay/, '농장별 결제일 웹 테이블을 사용해야 합니다.');
  assert.match(api, /farmSettings === '1'/, '별도 설정 페이지용 전체 농장 조회 분기가 있어야 합니다.');
  assert.match(api, /buildSettlementExcel\(r, payDate, selectedFarmNames\)/, '정산서 엑셀 생성에 농장 필터를 전달해야 합니다.');

  console.log('Import pivot payment tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
