// 주차별 매출이익 보고서 다운로드의 원본 시트 보존 및 화면표시 시트 디자인 회귀 검사
const assert = require('assert');
const XLSX = require('xlsx-js-style');

(async () => {
  const { buildProfitReportXlsx } = await import('../lib/profitReportExcel.js');
  const sample = { C: 100000, D: 1, H: 5000, J: 25000, K: 0.25, Q: 40 };
  const buffer = buildProfitReportXlsx({
    major: 35,
    rows: [{ category: '콜롬비아 수국', confirmed: true, calc: sample }],
    confirmedTotals: sample,
    visibleCols: ['C', 'D', 'H', 'J', 'K', 'Q'],
  });
  const workbook = XLSX.read(buffer, { cellStyles: true, cellNF: true });
  const original = workbook.Sheets['주차별 매출이익 보고서'];
  const display = workbook.Sheets['화면표시(선택컬럼)'];

  assert.deepStrictEqual(workbook.SheetNames, ['주차별 매출이익 보고서', '화면표시(선택컬럼)']);
  assert.strictEqual(original.B1.v, '주차별 매출이익 보고서-35차', '원본 엑셀 템플릿 시트를 보존한다');
  assert.strictEqual(display.A1.v, '주차별 매출이익 보고서-35차');
  assert.strictEqual(display.A4.v, '품명');
  assert.strictEqual(display.B4.v, '매출액');
  assert.strictEqual(display['!autofilter'].ref, 'A4:G21');
  assert.strictEqual(display['!merges'].length, 2, '제목과 안내행을 선택 열 전체에 병합한다');
  assert.strictEqual(display.A1.s.fgColor.rgb, '17365D', '제목은 보고서 남색 띠를 사용한다');
  assert.strictEqual(display.A4.s.fgColor.rgb, '1F4E78', '열 제목은 보고서 파란색을 사용한다');
  assert.strictEqual(display.B5.s.fgColor.rgb, 'F4F8FC', '본문에는 읽기 쉬운 교차 행 색상을 적용한다');
  assert.strictEqual(display.D6.v, '', '값이 없는 셀도 빈칸으로 유지한다');
  assert.strictEqual(display.D6.s.fgColor.rgb, 'FFFFFF', '값이 없는 셀에서도 표 디자인이 끊기지 않는다');
  assert.strictEqual(display.A21.v, '합계');
  assert.strictEqual(display.A21.s.fgColor.rgb, 'DDEBF7', '합계행을 별도 색상으로 강조한다');
  assert.match(display.B21.z, /₩/, '합계 금액은 원본 엑셀과 같은 원화 형식이다');
  assert.strictEqual(display.C5.z, '0.00%', '비율 열은 백분율 형식이다');
  assert.ok(display['!cols'][0].wch >= 23, '품명 열은 전체 이름을 읽을 수 있는 너비다');
  assert.ok(display['!rows'][3].hpt >= 32, '열 제목은 줄바꿈을 고려한 높이다');
  console.log('profitReportExcelDesign.test.js: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
