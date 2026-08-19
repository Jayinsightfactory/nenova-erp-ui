// 견적서 출력 EXE parity 계약 테스트
// 실행: node __tests__/estimatePrintContract.test.js

import assert from 'node:assert/strict';
import fs from 'node:fs';
import XLSX from 'xlsx-js-style';
import { sqlEstimateGetPrintDetail } from '../lib/exeEstimateViewSql.js';
import { buildEstimatePrintWorksheet } from '../lib/estimatePrintExcel.js';
import { prepareEstimatePrintRows } from '../lib/estimatePrintPrepare.js';
import { sortEstimateShipmentsForList, sortEstimateShipmentsForPrint } from '../lib/estimatePrintOrder.js';

const exeRows = [
  {
    _exePrint: true,
    ProdKey: 10,
    ProdName: 'ROSE / Moon Light 50cm',
    EstimateType: '정상출고',
    Quantity: 12,
    UnitQuantity: '12단',
    Cost: 11000,
    Amount: 120000,
    Vat: 12000,
    Descr: '출고 메모',
    GroupNo: 2,
    GroupName: '콜롬비아 장미',
  },
  {
    _exePrint: true,
    ProdKey: 10,
    ProdName: 'ROSE / Moon Light 50cm',
    EstimateType: '정상출고',
    Quantity: 8,
    UnitQuantity: '8단',
    Cost: 12000,
    Amount: 87273,
    Vat: 8727,
    Descr: '다른 단가',
    GroupNo: 2,
    GroupName: '콜롬비아 장미',
  },
  {
    _exePrint: true,
    ProdKey: 20,
    ProdName: '[불량차감] CARNATION Novia',
    EstimateType: '불량차감',
    Quantity: -1,
    UnitQuantity: '-1단',
    Cost: 5000,
    Amount: -4545,
    Vat: -455,
    Descr: '수입부 메모',
    GroupNo: 4,
    GroupName: '카네이션',
  },
];

const prepared = prepareEstimatePrintRows(exeRows, { printFormat: 'estimate' });
assert.equal(prepared.exePrintParity, true);
assert.equal(prepared.rows.length, 3, 'EXE가 반환한 같은 품목·다른 단가 및 차감행을 다시 합치지 않는다.');
assert.deepEqual(prepared.rows.map((row) => row.ProdName), exeRows.map((row) => row.ProdName));
assert.equal(prepared.rows[0].UnitQuantity, '12단');
assert.equal(prepared.descLabel(prepared.rows[2]), '', '불량차감 적요는 인쇄 기본 미표시다.');
assert.equal(prepared.rows[0].Descr, '출고 메모', '정상출고 적요 원문은 보존한다.');
assert.equal(
  prepareEstimatePrintRows(exeRows, { printFormat: 'estimate', showDeductionDescr: true }).descLabel(exeRows[2]),
  '수입부 메모',
  '불량차감 적요 표시 옵션을 켠 경우에만 원문을 출력한다.',
);
assert.equal(prepared.totals.total, 223000, 'Amount+Vat를 EXE처럼 합산한다.');

const worksheet = buildEstimatePrintWorksheet({
  custName: '테스트 거래처',
  week: '30',
  printDate: '2026-08-05',
  printFormat: 'estimate',
  rows: exeRows,
  bigoLabel: '30차 종합견적서',
});
const aoa = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
const header = aoa.find((row) => row.includes('품목명[규격]'));
assert.deepEqual(header, ['순번', '품목명[규격]', '수량', '단가', '공급가액', '부가세', '적요']);
assert.equal(aoa.some((row) => row.includes('단위')), false, '일반 견적서에 EXE에 없는 별도 단위 열을 만들지 않는다.');
assert.equal(aoa.some((row) => row.includes('박스')), false, '일반 견적서에 EXE에 없는 별도 박스 열을 만들지 않는다.');
assert.equal(aoa.some((row) => String(row).includes('수입부 메모')), false, '엑셀 인쇄도 불량차감 적요를 기본 숨긴다.');

const sql = sqlEstimateGetPrintDetail({ orderYearWeek: '202630', custKey: 42, weekDayIn: '2,3' });
assert.match(sql, /FROM ViewShipment vs/);
assert.match(sql, /JOIN ViewOrder vo/);
assert.match(sql, /vs\.DetailFix = 1/);
assert.match(sql, /sdd\.EstQuantity > 0/);
assert.match(sql, /GROUP BY vs\.ProdKey, sdd\.Cost/);
assert.match(sql, /FROM Estimate e/);
assert.match(sql, /LEFT JOIN CodeInfo ci/);
assert.match(sql, /COALESCE\(NULLIF\(ci\.Descr2/);
assert.doesNotMatch(sql, /JOIN PeriodDay pd ON e\.EstimateDtm = pd\.BaseYmd/,
  'Estimate 등록행은 PeriodDay 일시 일치 실패로 인쇄에서 누락되지 않는다.');
assert.match(sql, /ProductSortLookup/);
assert.match(sql, /pd\.WeekDay IN \(2,3\)/);

const pageSource = fs.readFileSync(new URL('../pages/estimate.js', import.meta.url), 'utf8');
assert.match(pageSource, /showDeductionDescr:\s*false/, '인쇄 표시 옵션은 미표시가 기본값이다.');
assert.match(pageSource, /불량차감 적요 표시/);
assert.match(pageSource, /const descr = descLabel\(r\)/, 'EXE 인쇄도 descLabel로 불량차감 적요를 숨긴다.');
assert.match(pageSource, /printDetail:\s*'1'/);
assert.match(pageSource, /weekDays:\s*\[\.\.\.activeWD\]/);
assert.match(pageSource, /'견 적 서'/);
assert.match(pageSource, /UnitQuantity/);
assert.match(pageSource, /setActiveWD\(new Set\(WEEKDAYS\)\)/, '업체 선택 시 전체 출고요일을 기본 활성화한다.');
assert.match(pageSource, /useState\('ko'\)/, '거래처 검색은 한글 입력이 기본이다.');
assert.match(pageSource, /editHangulSearchBuffer/, '영문 키보드는 안전한 두벌식 한글 편집 경로를 사용한다.');
assert.match(pageSource, /한글입력/, '거래처 검색 입력 모드를 표시한다.');
assert.match(pageSource, /영문입력/, '영문 거래처명과 코드 검색으로 전환할 수 있다.');
assert.match(pageSource, /showDeductionDescr:\s*false/, '인쇄 불량차감 적요는 미표시가 기본값이다.');
assert.match(pageSource, /불량차감 적요 표시/, '인쇄 다이얼로그에 불량차감 적요 표시 체크가 있다.');
assert.doesNotMatch(pageSource, /_exePrint \? \(r\.Descr/, 'EXE 인쇄도 descLabel을 경유해 불량차감 적요 옵션을 따른다.');
assert.equal((pageSource.match(/sortEstimateShipmentsForPrint\(/g) || []).length >= 2, true,
  '견적서 인쇄와 동일양식 Excel 모두 같은 담당자 정렬 함수를 사용한다.');

const managerOrdered = sortEstimateShipmentsForPrint([
  { CustKey: 31, CustName: '영남꽃소재', Manager: '정재훈' },
  { CustKey: 13, CustName: '(주)미카엘플라워', Manager: '박성수' },
  { CustKey: 533, CustName: '주광농원', Manager: '김원영' },
  { CustKey: 318, CustName: '꽃샘원예', Manager: '조현욱' },
  { CustKey: 999, CustName: '미지정업체', Manager: '' },
  { CustKey: 280, CustName: '경향농원', Manager: '박성수' },
]);
assert.deepEqual(managerOrdered.map((row) => `${row.Manager || '미지정'}:${row.CustName}`), [
  '김원영:주광농원',
  '박성수:(주)미카엘플라워',
  '박성수:경향농원',
  '정재훈:영남꽃소재',
  '조현욱:꽃샘원예',
  '미지정:미지정업체',
]);

const salesOrdered = sortEstimateShipmentsForList([
  { CustKey: 31, CustName: '영남꽃소재', Manager: '정재훈', totalAmount: 150000 },
  { CustKey: 13, CustName: '미카엘플라워', Manager: '박성수', totalAmount: 900000 },
  { CustKey: 280, CustName: '경향농원', Manager: '박성수', totalAmount: 150000 },
]);
assert.deepEqual(salesOrdered.map((row) => row.CustKey), [13, 280, 31],
  '좌측 업체 목록은 매출 내림차순, 동률은 업체명순이어야 한다.');
// 좌측 목록은 렌더 직전에 매출순 정렬을 적용하고, 담당자별 출력 모달과 같은
// 후보 집합(visibleShipments = 최근 차수 필터 적용본)을 봐야 한다.
assert.match(pageSource, /displayShips = sortEstimateShipmentsForList\(visibleShipments\)/,
  '좌측 업체 목록은 visibleShipments를 매출순 정렬해 렌더링해야 한다.');
assert.match(pageSource, /filterRecentParentWeeks\(shipments, recentOnly\)/,
  '최근 차수 필터는 공용 헬퍼로 계산해 모달과 공유해야 한다.');
assert.match(pageSource, /총 합계금액 ▼/, '좌측 목록 헤더에서 매출 내림차순임을 표시해야 한다.');

console.log('estimate print contract tests passed');
