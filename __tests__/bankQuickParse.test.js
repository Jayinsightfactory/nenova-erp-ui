import assert from 'node:assert/strict';
import { maskAccountNo, parseAmount, parseDateTime, parseTxnTable, withHashes, computeRowHash, isDate } from '../lib/bankQuick/core.js';

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

// 해시: 결정적·계좌별 상이·동일행 순번 구분
const a = withHashes(1, [t1.txns[0], t1.txns[0], t1.txns[1]]);
assert.equal(new Set(a.map((x) => x.hash)).size, 3);
assert.equal(a[0].hash, withHashes(1, [t1.txns[0]])[0].hash);
assert.notEqual(computeRowHash(1, t1.txns[0]), computeRowHash(2, t1.txns[0]));
assert.match(a[0].hash, /^[0-9a-f]{64}$/);

// 계좌번호 원문이 RawJson 후보에 새지 않음(헤더에 없는 값은 raw 에 없다)
assert.ok(!JSON.stringify(a).includes('3021234567891'));

console.log('bankQuick parse tests passed');
