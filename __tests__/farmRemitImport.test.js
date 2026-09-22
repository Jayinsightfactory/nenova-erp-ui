// __tests__/farmRemitImport.test.js — 송금신청 엑셀 파서·농장 매칭 (DB 불필요). 실파일 구조(2026-09-21 해외건별송금신청) 그대로 재현.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const src = fs.readFileSync(path.join(process.cwd(), 'lib/farmRemitImport.js'), 'utf8').replace(/^import .*$/mg, '').replace(/^export /mg, '');
const mod = new Function('fs', 'path', src + '\nreturn { parseRemitRequestWorkbook, buildFarmMatcher, normName, REMIT_FILE_RE };')(fs, path);

const ws = XLSX.utils.aoa_to_sheet([
  ['해외건별송금신청'],
  ['No', '거래접수번호', '작성일', '송금통화', '송금기준', '송금금액', '받는 은행', '받는 분 계좌번호', '받는 분', '지급은행BIC', '송금구분', '송금예정일자'],
  ['1', '20260921CPB001', '2026-09-21', 'USD', '외화기준', '2,114.00', 'BANK OF AMERICA', '898', 'FLORA CONCEPT', 'BOFAUS6S', '해외건별송금신청', ''],
  ['2', '20260921CPB002', '2026-09-21', 'USD', '외화기준', '3,182.40', 'HELM BANK', '104', 'MONIKA FARMS SAS', '', '해외건별송금신청', '2026-09-22'],
  ['3', '20260921CPB003', '2026-09-21', 'AUD', '외화기준', '36,945.00', 'ANZ', '1', 'PREMIUM GREENS AUSTRALA PTY LTD', '', '해외건별송금신청', ''],
  ['', '', '', '', '', '', '', '', '', '', '', ''],
]);
const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '해외건별송금신청20260921');
const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
const rows = mod.parseRemitRequestWorkbook(buf, XLSX);
assert.strictEqual(rows.length, 3, '빈 행 제외 3건');
assert.deepStrictEqual([rows[0].receiptNo, rows[0].currency, rows[0].amount, rows[0].payee, rows[0].date], ['20260921CPB001', 'USD', 2114, 'FLORA CONCEPT', '2026-09-21']);
assert.strictEqual(rows[1].plannedDate, '2026-09-22'); assert.strictEqual(rows[2].currency, 'AUD'); assert.strictEqual(rows[2].amount, 36945);
assert.ok(mod.REMIT_FILE_RE.test('해외건별송금신청20260921.xlsx') && !mod.REMIT_FILE_RE.test('송금정보번호조회20260921.xlsx'));

// 농장 매칭: paynames 사전(임시 파일) + 원장 농장명
const tmp = path.join(require('os').tmpdir(), 'paynames-test.json');
fs.writeFileSync(tmp, JSON.stringify({ 'The Elite Flowers': 'flora concept llc', 'Monika Farms': 'MONIKA FARMS SAS', 'Premium Greens': 'PREMIUM GREENS AUSTRALIA PTY LTD' }));
const match = mod.buildFarmMatcher(['Monika Farms', 'Premium Greens', 'VUELVEN S.A.S.', 'Flores Aurora SAS'], tmp);
assert.strictEqual(match('FLORA CONCEPT').farm, 'The Elite Flowers', 'paynames 역방향(법정형태어 제거)');
assert.strictEqual(match('MONIKA FARMS SAS').farm, 'Monika Farms');
assert.strictEqual(match('VUELVEN S.A.S').farm, 'VUELVEN S.A.S.', '원장 농장명 정규화 일치');
assert.strictEqual(match('PREMIUM GREENS AUSTRALA PTY LTD').farm, 'Premium Greens', '오타 있어도 토큰 매칭');
assert.strictEqual(match('RAINFOREST GROUP INC').farm, '', '모르는 법인은 미매칭');
assert.strictEqual(mod.normName('C.I.FLORES DE FUNZA S.A.S'), 'DE FUNZA');
console.log('farmRemitImport tests passed: 파서(헤더 자동탐지·통화·예정일) · 농장 매칭(paynames/정규화/토큰/미매칭)');
