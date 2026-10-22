import assert from 'node:assert/strict';
import { parseEcountAoa } from '../lib/ecountLedger/xlsx.js';
import { normalizeHeaders, quoteIdent, computeRowHash, isSubtotalValues, sanitizeColumnName, assertPrgId } from '../lib/ecountLedger/core.js';
import { prepareRows } from '../lib/ecountLedger/loader.js';

// 헤더 탐지: 제목 행 건너뛰기, 합계 행에서 screenTotal
{
  const aoa = [
    ['판매현황 2026/06/01 ~ 2026/06/30', '', '', ''],
    [''],
    ['일자', '거래처명', '수량', '합계'],
    ['2026/06/02 -1', '주광농원', '160', '112,000'],
    ['2026/06/02 -2', '다른농원', '10', '5,000'],
    ['합계', '', '170', '117,000'],
  ];
  const r = parseEcountAoa(aoa);
  assert.deepEqual(r.headers, ['일자', '거래처명', '수량', '합계']);
  assert.equal(r.rows.length, 3);
  assert.equal(r.screenTotal, 117000);
  assert.equal(prepareRows('E040207', r.headers, r.rows).items.filter((i) => i.isSubtotal).length, 1);
}

// 병합 2단 헤더 → 상위_하위
{
  const aoa = [
    ['거래처명', '매출', '', '잔액'],
    ['', '수량', '금액', ''],
    ['A상사', '1', '1,000', '500'],
  ];
  const r = parseEcountAoa(aoa);
  assert.deepEqual(r.headers, ['거래처명', '매출_수량', '매출_금액', '잔액']);
  assert.deepEqual(r.rows[0], ['A상사', '1', '1,000', '500']);
}

// 헤더 없음
assert.deepEqual(parseEcountAoa([['1', '2'], ['3', '4']]).headers, []);

// 열 이름: 빈/중복/고정열 충돌/대괄호/제어문자
{
  const n = normalizeHeaders(['일자', '', '일자', 'RowKey', 'a]b;c', '비고\n내용']);
  assert.deepEqual(n, ['일자', '열2', '일자_2', 'RowKey_2', 'a_b_c', '비고 내용']);
  for (const x of n) assert.ok(!/[\[\];'\u0000-\u001f]/.test(x));
  assert.equal(quoteIdent('a]b'), '[a]]b]');
  assert.throws(() => quoteIdent(''), /식별자/);
  assert.equal(sanitizeColumnName('  합계 (원)  '), '합계 (원)');
  assert.throws(() => assertPrgId('E04;DROP'), /PrgId/);
}

// RowHash 안정성: 열 순서·빈 열 추가·공백 정규화에 불변, 값/PrgId 변화엔 민감
{
  const a = computeRowHash('E040207', ['일자', '합계'], ['2026/06/02', '1,000']);
  assert.equal(a.length, 64);
  assert.equal(a, computeRowHash('E040207', ['합계', '일자'], ['1,000', '2026/06/02']));
  assert.equal(a, computeRowHash('E040207', ['일자', '합계', '비고'], [' 2026/06/02 ', '1,000', '']));
  assert.notEqual(a, computeRowHash('E040207', ['일자', '합계'], ['2026/06/02', '1,001']));
  assert.notEqual(a, computeRowHash('E040214', ['일자', '합계'], ['2026/06/02', '1,000']));
}

// 합계행 판정
assert.equal(isSubtotalValues(['합계', '', '1']), true);
assert.equal(isSubtotalValues(['00134 / 박성수 계', '1']), true);
assert.equal(isSubtotalValues(['2026/06/02', '주광농원', '1']), false);
assert.equal(isSubtotalValues(['', '']), false);

// prepareRows: 객체 행·긴 값 절단·빈 행 제외·__isSubtotal
{
  const p = prepareRows('E040207', ['custName', 'memo'], [{ custName: 'A', memo: 'x'.repeat(500) }, { custName: '', memo: '' }, { custName: 'B', memo: '', __isSubtotal: true }]);
  assert.equal(p.items.length, 2);
  assert.equal(p.truncated, 1);
  assert.equal(p.items[0].values[1].length, 400);
  assert.equal(p.items[1].isSubtotal, true);
}

console.log('ecount ledger xlsx tests passed');
