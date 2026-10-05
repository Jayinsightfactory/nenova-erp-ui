import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { matchChinaHfCode, normalizeHfMapping, parseChinaHfWorkbook, validateChinaHfWorkbookArchive } from '../lib/chinaHfCodes.js';

const mapping = normalizeHfMapping({
  sourceFile: 'base.xlsx', sourceSheet: 'Sheet', rows: [
    { prodKey: 10, prodCode: '0007', prodName: 'Exact Flower', country: '중국', hfCode: 'HF001', reviewStatus: 'Match', sourceRow: 2 },
    { prodKey: 11, prodCode: '0008', prodName: 'Check Flower', country: '중국', hfCode: 'HF002', reviewStatus: 'Check', sourceRow: 3 },
    { prodKey: 12, prodCode: '0009', prodName: 'No Match Flower', country: '중국', hfCode: 'HF003', reviewStatus: 'No match', sourceRow: 4 },
    { prodKey: 13, prodCode: '0010', prodName: 'Duplicate HF A', country: '중국', hfCode: 'SHARED', sourceRow: 5 },
    { prodKey: 14, prodCode: '0011', prodName: 'Duplicate HF B', country: '중국', hfCode: 'SHARED', sourceRow: 6 },
    { prodKey: 15, prodCode: '0012', prodName: 'Blank HF', country: '중국', hfCode: '', reviewStatus: 'No match', sourceRow: 7 },
    { prodKey: 16, prodCode: '0013', prodName: 'Conflicted HF', country: '중국', hfCode: 'HF-A', sourceRow: 8 },
    { prodKey: 16, prodCode: '0013', prodName: 'Conflicted HF', country: '중국', hfCode: 'HF-B', sourceRow: 9 },
    { prodKey: null, prodCode: '', prodName: 'Name Only', country: '중국', hfCode: 'NAME-HF', sourceRow: 10 },
    { prodKey: 17, prodCode: '0014', prodName: 'Exact Flower', country: '중국', hfCode: 'OTHER', sourceRow: 11 },
  ],
});
const catalog = mapping.rows.filter(row => row.prodKey != null).map(({ prodKey, prodCode, prodName, country }) => ({ prodKey, prodCode, prodName, country, flower: '', unit: '단' }));

const matched = matchChinaHfCode({ prodKey: 10, prodCode: '0007', prodName: 'Exact Flower' }, mapping);
assert.deepEqual(matched, { hfCode: 'HF001', status: 'matched', label: '일치', reviewStatus: 'Match', sourceRow: 2 });
assert.equal(matchChinaHfCode({ prodKey: 999, prodCode: '0007' }, mapping).status, 'conflict', '번호와 코드 모순은 충돌');
assert.equal(matchChinaHfCode({ prodKey: 999, prodCode: '0000', prodName: 'Exact Flower' }, mapping).status, 'conflict', '잘못된 식별자가 있는 source 이름행은 fallback 금지');
const codeFallback = normalizeHfMapping({ rows: [{ prodKey: null, prodCode: '0007', prodName: '', country: '중국', hfCode: 'CODE-FALLBACK', sourceRow: 12 }] });
assert.equal(matchChinaHfCode({ prodKey: 10, prodCode: '0007', prodName: 'Exact Flower' }, codeFallback, catalog).hfCode, 'CODE-FALLBACK', '전체 ERP 품목은 키가 있어도 사전 행에 ProdKey가 없으면 유일 코드 fallback');
assert.equal(matchChinaHfCode({ prodCode: '0000', prodName: 'Exact Flower' }, mapping, catalog).status, 'conflict', '키가 있는 source 이름행을 코드 누락 시 이름 fallback하지 않음');
const nameFallback = normalizeHfMapping({ rows: [{ prodKey: null, prodCode: '', prodName: 'Name Only', country: '', hfCode: 'NAME-HF', sourceRow: 10 }] });
assert.equal(matchChinaHfCode({ prodKey: 100, prodCode: 'NAME-CODE', prodName: 'Name Only' }, nameFallback, [...catalog, { prodKey: 100, prodCode: 'NAME-CODE', prodName: 'Name Only' }]).hfCode, 'NAME-HF', 'API 품목에 키·코드가 있어도 사전행 둘 다 누락이면 전체 catalog의 유일한 정확 이름 fallback');
assert.equal(matchChinaHfCode({ prodName: 'Name Onli' }, mapping, catalog).status, 'missing', '이름 유사검색 금지');
assert.equal(matchChinaHfCode({ prodKey: 10, prodCode: '0007' }, codeFallback).status, 'conflict', '전체 품목 catalog 없이는 코드 fallback 금지');
assert.equal(matchChinaHfCode({ prodKey: 100, prodCode: 'NAME-CODE', prodName: 'Name Only' }, nameFallback).status, 'conflict', '전체 품목 catalog 없이는 이름 fallback 금지');
assert.equal(matchChinaHfCode({ prodKey: 10, prodCode: '0007' }, codeFallback, [...catalog, { prodKey: 99, prodCode: '0007', prodName: 'Off-cycle duplicate' }]).status, 'conflict', '표시 차수 밖 전체 catalog 중복 코드도 검출');
assert.equal(matchChinaHfCode({ prodKey: 100, prodCode: 'NAME-CODE', prodName: 'Name Only' }, nameFallback, [...catalog, { prodKey: 100, prodCode: 'NAME-CODE', prodName: 'Name Only' }, { prodKey: 99, prodCode: 'X', prodName: 'Name Only' }]).status, 'conflict', '표시 차수 밖 전체 catalog 중복 이름도 검출');
assert.equal(matchChinaHfCode({ prodKey: 10, prodCode: '0007' }, { rows: [codeFallback.rows[0], { ...codeFallback.rows[0], sourceRow: 20 }] }, catalog).status, 'conflict', '사전의 중복 코드도 고유 fallback을 막음');
assert.equal(matchChinaHfCode({ prodKey: 16, prodCode: '0013' }, mapping).status, 'conflict', '동일 품목에 서로 다른 HF 코드는 충돌');
assert.equal(matchChinaHfCode({ prodKey: 13, prodCode: '0010' }, mapping).hfCode, 'SHARED', '다른 품목의 동일 HF 코드는 허용');
assert.equal(matchChinaHfCode({ prodKey: 14, prodCode: '0011' }, mapping).hfCode, 'SHARED');
assert.deepEqual(matchChinaHfCode({ prodKey: 11, prodCode: '0008' }, mapping), { hfCode: 'HF002', status: 'review', label: '검토 (Check)', reviewStatus: 'Check', sourceRow: 3 });
assert.deepEqual(matchChinaHfCode({ prodKey: 12, prodCode: '0009' }, mapping), { hfCode: 'HF003', status: 'review', label: '검토 (No match)', reviewStatus: 'No match', sourceRow: 4 }, 'HF가 있어도 No match 이유를 검토 상태에 보존');
assert.deepEqual(matchChinaHfCode({ prodKey: 15, prodCode: '0012' }, mapping), { hfCode: '', status: 'missing', label: '미매칭 (No match)', reviewStatus: 'No match', sourceRow: 7 }, '빈 HF를 후보/다른 행에서 채우지 않으면서 원본 검토상태 표시');
assert.equal(matchChinaHfCode({ prodKey: 10, prodCode: '0007', country: '콜롬비아' }, mapping).status, 'missing', '비중국 품목키는 사전 키가 같아도 미매칭');
assert.equal(matchChinaHfCode({ prodKey: 10, prodCode: '0007', country: '중국' }, mapping).status, 'matched');
assert.equal(matchChinaHfCode({ prodKey: 31, prodCode: 'FOREIGN' }, { rows: [{ prodKey: 31, prodCode: 'FOREIGN', prodName: 'foreign', country: '콜롬비아', hfCode: 'HF-FOREIGN', sourceRow: 1 }] }).status, 'missing', '외국 국가가 명시된 사전 행은 중국에 매칭되지 않음');
assert.equal(matchChinaHfCode({ prodKey: 10, prodCode: '0007' }, { rows: [mapping.rows[0], { ...mapping.rows[0], prodCode: 'DIFFERENT', sourceRow: 20 }] }).status, 'conflict', '동일 ProdKey/HF의 다른 source code도 충돌');
const keyOnlySource = normalizeHfMapping({ rows: [{ prodKey: 10, prodCode: '', prodName: 'Exact Flower', country: '중국', hfCode: 'KEY-ONLY', sourceRow: 2 }] });
assert.equal(matchChinaHfCode({ prodKey: 10, prodCode: '0007', prodName: 'Exact Flower' }, keyOnlySource).status, 'conflict', 'ProdKey가 일치해도 source ProdCode가 비어 있으면 양쪽 검증 실패');
const sameHfMixedReviews = [
  { prodKey: 40, prodCode: '0040', prodName: 'Same HF', hfCode: 'HF040', reviewStatus: 'Match', sourceRow: 10 },
  { prodKey: 40, prodCode: '0040', prodName: 'Same HF', hfCode: 'HF040', reviewStatus: 'No match', sourceRow: 11 },
  { prodKey: 40, prodCode: '0040', prodName: 'Same HF', hfCode: 'HF040', reviewStatus: 'Check', sourceRow: 12 },
];
const reviewForward = matchChinaHfCode({ prodKey: 40, prodCode: '0040' }, { rows: sameHfMixedReviews });
const reviewReverse = matchChinaHfCode({ prodKey: 40, prodCode: '0040' }, { rows: [...sameHfMixedReviews].reverse() });
assert.deepEqual(reviewForward, reviewReverse, '동일 HF의 중복행은 순서와 무관하게 같은 경고를 선택');
assert.deepEqual(reviewForward, { hfCode: 'HF040', status: 'review', label: '검토 (No match)', reviewStatus: 'No match', sourceRow: 11 }, '중복 리뷰 우선순위는 No match > Check > Match');
const blankMixedReviews = sameHfMixedReviews.map(row => ({ ...row, hfCode: '' }));
assert.deepEqual(
  matchChinaHfCode({ prodKey: 40, prodCode: '0040' }, { rows: blankMixedReviews }),
  matchChinaHfCode({ prodKey: 40, prodCode: '0040' }, { rows: [...blankMixedReviews].reverse() }),
  'HF 빈값 중복행에도 입력 순서와 무관하게 가장 강한 경고 적용',
);
assert.equal(matchChinaHfCode({ prodKey: 100, prodCode: '1000' }, mapping).status, 'missing');
assert.throws(() => normalizeHfMapping({ rows: [{ prodKey: -1 }] }), /품목번호/);
assert.throws(() => normalizeHfMapping({ rows: new Array(10_001).fill({}) }), /10000/);

const source = new ExcelJS.Workbook();
const sourceSheet = source.addWorksheet('HF map');
sourceSheet.addRow(['ProdKey', 'Product Code', 'Product Name', 'Country', 'HF CODE', 'Review Status']);
sourceSheet.addRow([21, '000021', 'A flower', '중국', '001234', 'Check']);
sourceSheet.addRow([22, '000022', 'B flower', '중국', '', 'No match']);
const sourceBytes = new Uint8Array(await source.xlsx.writeBuffer());
const parsed = await parseChinaHfWorkbook(sourceBytes.buffer, 'mapping.xlsx');
assert.equal(parsed.sourceSheet, 'HF map');
assert.equal(parsed.rows[0].prodCode, '000021', 'leading zero is retained');
assert.equal(parsed.rows[0].hfCode, '001234', 'HF code is retained as text');
assert.equal(parsed.rows[0].reviewStatus, 'Check');
assert.equal(parsed.rows[1].hfCode, '');
const numericCodes = new ExcelJS.Workbook();
const numericSheet = numericCodes.addWorksheet('Numeric codes');
numericSheet.addRow(['ProdKey', 'Product Code', 'Product Name', 'Country', 'HF CODE']);
numericSheet.addRow([301, 21, 'Padded product code', '중국', 1234]);
numericSheet.getCell('B2').numFmt = '000000';
numericSheet.getCell('E2').numFmt = '000000';
numericSheet.addRow([302, 22, 'General numeric code', '중국', 0]);
numericSheet.addRow([306, 23, 'Text and zero numeric masks', '중국', 1234]);
numericSheet.getCell('B3').numFmt = '@';
numericSheet.getCell('E3').numFmt = '0';
const numericBytes = new Uint8Array(await numericCodes.xlsx.writeBuffer());
const numericParsed = await parseChinaHfWorkbook(numericBytes.buffer, 'numeric-codes.xlsx');
assert.equal(numericParsed.rows[0].prodCode, '000021');
assert.equal(numericParsed.rows[0].hfCode, '001234');
assert.equal(numericParsed.rows[1].prodCode, '22');
assert.equal(numericParsed.rows[1].hfCode, '0');
assert.equal(numericParsed.rows[2].prodCode, '23', '@ mask preserves safe integer text');
assert.equal(numericParsed.rows[2].hfCode, '1234', 'single-zero mask preserves safe integer text');
const formulaCodes = new ExcelJS.Workbook();
const formulaSheet = formulaCodes.addWorksheet('Cached formula');
formulaSheet.addRow(['ProdKey', 'Product Code', 'Product Name', 'Country', 'HF CODE']);
formulaSheet.addRow([303, { formula: '21', result: 21 }, 'Cached code', '중국', { formula: '1234', result: 1234 }]);
formulaSheet.getCell('B2').numFmt = '000000';
formulaSheet.getCell('E2').numFmt = '000000';
const formulaBytes = new Uint8Array(await formulaCodes.xlsx.writeBuffer());
const formulaParsed = await parseChinaHfWorkbook(formulaBytes.buffer, 'cached-formula.xlsx');
assert.equal(formulaParsed.rows[0].prodCode, '000021', '수식을 실행하지 않고 저장된 숫자 결과와 표시 마스크만 사용');
assert.equal(formulaParsed.rows[0].hfCode, '001234');
const unsupportedCodes = new ExcelJS.Workbook();
const unsupportedSheet = unsupportedCodes.addWorksheet('Unsupported format');
unsupportedSheet.addRow(['ProdKey', 'Product Code', 'Product Name', 'Country', 'HF CODE']);
unsupportedSheet.addRow([304, 21, 'Unsupported numeric mask', '중국', 1234]);
unsupportedSheet.getCell('B2').numFmt = '#,##0';
const unsupportedBytes = new Uint8Array(await unsupportedCodes.xlsx.writeBuffer());
await assert.rejects(() => parseChinaHfWorkbook(unsupportedBytes.buffer, 'unsupported-format.xlsx'), /숫자 서식.*안전하게 변환/);
const fractionCodes = new ExcelJS.Workbook();
const fractionSheet = fractionCodes.addWorksheet('Fraction code');
fractionSheet.addRow(['ProdKey', 'Product Code', 'Product Name', 'Country', 'HF CODE']);
fractionSheet.addRow([305, 21.5, 'Fraction code', '중국', 'HF305']);
const fractionBytes = new Uint8Array(await fractionCodes.xlsx.writeBuffer());
await assert.rejects(() => parseChinaHfWorkbook(fractionBytes.buffer, 'fraction-code.xlsx'), /안전한 정수/);
const unsafeCodes = new ExcelJS.Workbook();
const unsafeSheet = unsafeCodes.addWorksheet('Unsafe integer code');
unsafeSheet.addRow(['ProdKey', 'Product Code', 'Product Name', 'Country', 'HF CODE']);
unsafeSheet.addRow([307, 9007199254740992, 'Unsafe integer code', '중국', 'HF307']);
const unsafeBytes = new Uint8Array(await unsafeCodes.xlsx.writeBuffer());
await assert.rejects(() => parseChinaHfWorkbook(unsafeBytes.buffer, 'unsafe-code.xlsx'), /안전한 정수/);
const withBlankRows = new ExcelJS.Workbook();
const blankRowsSheet = withBlankRows.addWorksheet('Input');
blankRowsSheet.addRows([
  ['ProdKey', 'Product Code', 'Product Name', 'Country', 'HF CODE', 'Review Status'],
  [null, null, null, null, null, null],
  [null, null, null, null, null, 'No match'],
  [23, '000023', 'Valid empty-HF product', '중국', '', 'No match'],
]);
const blankRowsBytes = new Uint8Array(await withBlankRows.xlsx.writeBuffer());
const blankRowsParsed = await parseChinaHfWorkbook(blankRowsBytes.buffer, 'blank-rows.xlsx');
assert.equal(blankRowsParsed.rows.length, 1, '빈 행과 상태만 있는 행은 사전 품목행으로 오인하지 않음');
assert.equal(blankRowsParsed.rows[0].prodKey, 23, 'HF가 비어도 실제 식별정보가 있는 행은 유지');
const splitReviewBook = new ExcelJS.Workbook();
const primarySheet = splitReviewBook.addWorksheet('Sheet');
primarySheet.addRows([
  ['품목번호', '품목코드', '품목명', '국가', 'HF CODE', 'Closest catalogue code', 'Review Status'],
  [201, '0201', 'Supplement conflict', '중국', 'HF201', '', ''],
  [202, '0202', 'Primary wins', '중국', 'HF202', '', 'Match'],
  [203, '0203', 'Closest is not HF', '중국', '', 'CLOSEST-203', ''],
  [204, '0204', 'Supplement check', '중국', 'HF204', '', ''],
  [205, '0205', 'Supplement no match', '중국', 'HF205', '', ''],
]);
const reviewSheet = splitReviewBook.addWorksheet('HF match review');
reviewSheet.addRows([
  ['품목번호', 'Status'],
  [201, 'Check'],
  [201, 'No match'],
  [202, 'No match'],
  [203, 'Check'],
  [204, 'Check'],
  [205, 'No match'],
  ['합계', 'footer'],
]);
const splitReviewBytes = new Uint8Array(await splitReviewBook.xlsx.writeBuffer());
const splitReviewMapping = await parseChinaHfWorkbook(splitReviewBytes.buffer, 'split-review.xlsx');
const byKey = key => splitReviewMapping.rows.find(row => row.prodKey === key);
assert.equal(byKey(201).hfCode, 'HF201');
assert.equal(byKey(201).reviewStatus, 'review정보충돌', '서로 다른 보조 상태는 충돌 표식으로 보존');
assert.deepEqual(matchChinaHfCode({ prodKey: 201, prodCode: '0201', country: '중국' }, splitReviewMapping), {
  hfCode: 'HF201', status: 'review', label: '검토 (review정보충돌)', reviewStatus: 'review정보충돌', sourceRow: 2,
});
assert.equal(byKey(202).reviewStatus, 'Match', '기본 시트의 명시 상태가 보조 No match보다 우선');
assert.equal(matchChinaHfCode({ prodKey: 202, prodCode: '0202' }, splitReviewMapping).status, 'matched');
assert.equal(byKey(204).reviewStatus, 'Check', '기본 상태가 비면 보조 시트 상태를 적용');
assert.equal(matchChinaHfCode({ prodKey: 204, prodCode: '0204' }, splitReviewMapping).status, 'review');
assert.equal(byKey(205).reviewStatus, 'No match');
assert.equal(matchChinaHfCode({ prodKey: 205, prodCode: '0205' }, splitReviewMapping).status, 'review');
assert.equal(byKey(203).hfCode, '', 'Closest catalogue code는 확정 HF CODE로 대입하지 않음');
assert.equal(byKey(203).reviewStatus, 'Check');
assert.equal(matchChinaHfCode({ prodKey: 203, prodCode: '0203' }, splitReviewMapping).status, 'missing');
assert.equal(splitReviewMapping.rows.length, 5, '유효하지 않은 review-sheet footer ID는 버림');
assert.deepEqual(splitReviewMapping.rows.reduce((counts, row) => {
  const status = row.reviewStatus.toLocaleLowerCase();
  if (status === 'check') counts.check += 1;
  if (status === 'no match') counts.noMatch += 1;
  if (status === 'review정보충돌') counts.conflict += 1;
  return counts;
}, { check: 0, noMatch: 0, conflict: 0 }), { check: 2, noMatch: 1, conflict: 1 }, '업로드 후 Check/No match 검토 건수 및 상태충돌 수 보존');
await assert.rejects(() => parseChinaHfWorkbook(sourceBytes.buffer, 'mapping.xls'), /\.xlsx/);
const noExplicitHf = new ExcelJS.Workbook();
noExplicitHf.addWorksheet('x').addRows([['Code', 'Closest catalogue code'], ['0001', 'HF999']]);
const noHfBytes = new Uint8Array(await noExplicitHf.xlsx.writeBuffer());
await assert.rejects(() => parseChinaHfWorkbook(noHfBytes.buffer, 'no-hf.xlsx'), /명시적인 HF CODE/);

assert.throws(() => validateChinaHfWorkbookArchive(new Uint8Array(5 * 1024 * 1024 + 1)), /5MiB/);
const oversizedExpanded = sourceBytes.slice();
const expandedView = new DataView(oversizedExpanded.buffer);
let centralEntry = -1;
for (let i = 0; i < oversizedExpanded.length - 46; i += 1) {
  if (expandedView.getUint32(i, true) === 0x02014b50) { centralEntry = i; break; }
}
assert.ok(centralEntry >= 0);
expandedView.setUint32(centralEntry + 24, 65 * 1024 * 1024, true);
assert.throws(() => validateChinaHfWorkbookArchive(oversizedExpanded), /64MiB/);
assert.throws(() => validateChinaHfWorkbookArchive(new Uint8Array(30)), /중앙 디렉터리/);
console.log('chinaHfCodes tests passed');
