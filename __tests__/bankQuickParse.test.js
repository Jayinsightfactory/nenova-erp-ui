import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import { parseBankXlsx } from '../lib/bankQuick/xlsx.js';
import { monthChunks, maskAccountNo, parseAmount, parseDateTime, parseTxnTable, withHashes, computeRowHash, isDate } from '../lib/bankQuick/core.js';

// 마스킹: 앞3·뒤4 만 노출
const m = maskAccountNo('3021234567891');
assert.equal(m, '302******7891');
assert.ok(!m.includes('1234'));
assert.equal(maskAccountNo(''), '');

assert.equal(parseAmount('1,234,000원'), 1234000);
assert.equal(parseAmount('-5,000'), -5000);
assert.equal(parseAmount(''), null);
assert.deepEqual(parseDateTime('2026/11/03 13:05:22'), { date: '2026-11-03', time: '13:05:22' });
assert.deepEqual(parseDateTime('2026.11.03'), { date: '2026-11-03', time: null });
assert.equal(parseDateTime('abc'), null);
assert.ok(isDate('2026-11-03') && !isDate('2026-13-45') && !isDate('x'));

// 출금/입금 분리열
const t1 = parseTxnTable(
  ['거래일시', '출금금액', '입금금액', '거래후잔액', '거래내용', '거래기록사항', '거래점'],
  [
    ['2026-11-02 09:00:00', '', '1,000,000', '5,000,000', '전자금융', '(주)샘플화훼', '본점'],
    ['2026-11-02 10:00:00', '300,000', '', '4,700,000', 'CD출금', '', '지점'],
    ['합계', '', '', '', '', '', ''],
  ],
);
assert.equal(t1.txns.length, 2);
assert.equal(t1.skipped.length, 1);
assert.equal(t1.txns[0].type, 'deposit');
assert.equal(t1.txns[0].amount, 1000000);
assert.equal(t1.txns[0].balance, 5000000);
assert.equal(t1.txns[1].type, 'withdrawal');
assert.equal(t1.txns[0].raw['거래기록사항'], '(주)샘플화훼');

// 구분+금액 열
const t2 = parseTxnTable(['거래일자', '구분', '금액', '잔액'], [['20261103', '입금', '2,000', '9,000'], ['20261103', '출금', '1,000', '8,000']]);
assert.deepEqual(t2.txns.map((x) => x.type), ['deposit', 'withdrawal']);

// 하나은행 기업뱅킹 IBSheet 그리드 컬럼
const H = ['거래일시', '적요', '메모', '의뢰인/수취인', '입금', '출금', '거래후잔액', '구분', '거래점', '거래일련번호', '상세일련번호', '거래일자', '거래시각', '거래금액', '잔액변동구분코드', '금액유형코드', '압축기장여부', '원화코드'];
const th = parseTxnTable(H, [
  ['2026-11-02 09:00:00', '전자금융', '', '샘플화훼', '1,000,000', '0', '5,000,000', '입금', '본점', '1', '1', '20261102', '090000', '1000000', '1', '', 'N', 'KRW'],
  ['2026-11-02 10:00:00', 'CD', '', '', '0', '300,000', '4,700,000', '출금', '지점', '2', '1', '20261102', '100000', '300000', '2', '', 'N', 'KRW'],
]);
assert.deepEqual(th.txns.map((x) => [x.type, x.amount, x.balance]), [['deposit', 1000000, 5000000], ['withdrawal', 300000, 4700000]]);
assert.equal(th.txns[0].counterparty, '샘플화훼');
assert.equal(th.txns[0].raw['거래일련번호'], '1');

// 월 분할 + 하나은행 엑셀 → bank.Txn 매핑
assert.deepEqual(monthChunks('2024-01-15', '2024-03-10'), [['2024-01-15', '2024-01-31'], ['2024-02-01', '2024-02-29'], ['2024-03-01', '2024-03-10']]);
assert.deepEqual(monthChunks('2026-11-03', '2026-11-03'), [['2026-11-03', '2026-11-03']]);
const XH = ['거래일시', '적요', '메모', '의뢰인/수취인', '입금', '출금', '거래후잔액', '구분', '거래점', '거래일련번호', '상세일련번호', '거래일자', '거래시각', '거래금액'];
const aoa = [['거래내역조회'], ['조회기간 : 2024-01-01 ~ 2024-01-31'], XH,
  ['2024-01-02 09:10', '전자금융', '', '샘플화훼', '1,000,000', '', '5,000,000', '입금', '본점', 'S1', 'D1', '20240102', '0910', '1000000'],
  ['2024-01-03 11:00', 'CD', '', '', '', '250,000', '4,750,000', '출금', '지점', 'S2', 'D1', '20240103', '1100', '250000'],
  ['', '', '', '', '', '', '', '', '', '', '', '', '', '']];
const xb = XLSX.write((() => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Sheet1'); return wb; })(), { type: 'buffer', bookType: 'xlsx' });
const px = parseBankXlsx(xb);
assert.deepEqual(px.headers, XH);
assert.equal(px.rows.length, 2);
const tx = parseTxnTable(px.headers, px.rows);
assert.deepEqual(tx.txns.map((x) => [x.txnDate, x.txnTime, x.type, x.amount, x.balance]), [['2024-01-02', '09:10:00', 'deposit', 1000000, 5000000], ['2024-01-03', '11:00:00', 'withdrawal', 250000, 4750000]]);
assert.equal(tx.txns[0].raw['거래일련번호'], 'S1');
assert.ok(/^384\*+4104$/.test(maskAccountNo('384-890024-54104')) && !maskAccountNo('384-890024-54104').includes('890024'));
// 화면 그리드(DOM 폴백) 12열 헤더
const g = parseTxnTable(['', 'No', '', '거래일시', '적요', '의뢰인/수취인', '통화', '입금', '출금', '잔액', '구분', '거래점'], [['', '1', '', '2024-01-02 09:10', '전자금융', '샘플화훼', 'KRW', '1,000,000', '0', '5,000,000', '입금', '본점']]);
assert.equal(g.txns.length, 1);
assert.equal(g.txns[0].type, 'deposit');

// 해시: 결정적·계좌별 상이·동일행 순번 구분
const a = withHashes(1, [t1.txns[0], t1.txns[0], t1.txns[1]]);
assert.equal(new Set(a.map((x) => x.hash)).size, 3);
assert.equal(a[0].hash, withHashes(1, [t1.txns[0]])[0].hash);
assert.notEqual(computeRowHash(1, t1.txns[0]), computeRowHash(2, t1.txns[0]));
assert.match(a[0].hash, /^[0-9a-f]{64}$/);

// 계좌번호 원문이 RawJson 후보에 새지 않음(헤더에 없는 값은 raw 에 없다)
assert.ok(!JSON.stringify(a).includes('3021234567891'));

console.log('bankQuick parse tests passed');
