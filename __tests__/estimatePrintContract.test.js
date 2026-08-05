// 견적서 출력 EXE parity 계약 테스트
// 실행: node __tests__/estimatePrintContract.test.js

import assert from 'node:assert/strict';
import fs from 'node:fs';
import XLSX from 'xlsx-js-style';
import { sqlEstimateGetPrintDetail } from '../lib/exeEstimateViewSql.js';
import { buildEstimatePrintWorksheet } from '../lib/estimatePrintExcel.js';
import { prepareEstimatePrintRows } from '../lib/estimatePrintPrepare.js';

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
assert.equal(prepared.descLabel(prepared.rows[2]), '수입부 메모', 'ReportEstimate 적요 원문을 보존한다.');
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

const sql = sqlEstimateGetPrintDetail({ orderYearWeek: '202630', custKey: 42, weekDayIn: '2,3' });
assert.match(sql, /FROM ViewShipment vs/);
assert.match(sql, /JOIN ViewOrder vo/);
assert.match(sql, /vs\.DetailFix = 1/);
assert.match(sql, /sdd\.EstQuantity > 0/);
assert.match(sql, /GROUP BY vs\.ProdKey, sdd\.Cost/);
assert.match(sql, /FROM Estimate e/);
assert.match(sql, /ProductSortLookup/);
assert.match(sql, /pd\.WeekDay IN \(2,3\)/);

const pageSource = fs.readFileSync(new URL('../pages/estimate.js', import.meta.url), 'utf8');
assert.match(pageSource, /printDetail:\s*'1'/);
assert.match(pageSource, /weekDays:\s*\[\.\.\.activeWD\]/);
assert.match(pageSource, /'견 적 서'/);
assert.match(pageSource, /UnitQuantity/);
assert.match(pageSource, /setActiveWD\(new Set\(WEEKDAYS\)\)/, '업체 선택 시 전체 출고요일을 기본 활성화한다.');

console.log('estimate print contract tests passed');
