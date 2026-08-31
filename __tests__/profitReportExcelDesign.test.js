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
    displaySheetFirst: true,
  });
  const workbook = XLSX.read(buffer, { cellStyles: true, cellNF: true });
  const original = workbook.Sheets['주차별 매출이익 보고서'];
  const display = workbook.Sheets['화면표시(선택컬럼)'];

  assert.deepStrictEqual(workbook.SheetNames, ['화면표시(선택컬럼)', '주차별 매출이익 보고서'], '다운로드를 열면 디자인 시트가 먼저 보인다');
  assert.strictEqual(original.B1.v, '주차별 매출이익 보고서-35차', '원본 엑셀 템플릿 시트를 보존한다');
  assert.strictEqual(original.B1.s.fgColor.rgb, '17365D', '원본 보고서 제목에도 파란 디자인을 적용한다');
  assert.strictEqual(original.B7.s.fgColor.rgb, '1F4E78', '원본 보고서 열 제목에도 파란 디자인을 적용한다');
  assert.strictEqual(original.B8.s.fgColor.rgb, 'FFFFFF', '원본 보고서 본문에도 교차 행 디자인을 적용한다');
  assert.strictEqual(original.B24.s.fgColor.rgb, 'DDEBF7', '원본 보고서 합계행도 강조한다');
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
  assert.strictEqual(workbook.Workbook.Sheets[0].name, '화면표시(선택컬럼)', '통합문서 메타데이터도 디자인 시트를 첫 시트로 지정한다');
  assert.strictEqual(workbook.Workbook.Views[0].activeTab ?? 0, 0, 'Excel 기본 활성 탭이 디자인 시트(0번)다');

  const unclassifiedBuffer = buildProfitReportXlsx({
    major: 35,
    note: '담당자 직접 입력 비고',
    rows: [
      { category: '콜롬비아 수국', confirmed: true, calc: sample },
      { category: '기타(미분류)', confirmed: true, calc: { ...sample, C: 777777 } },
    ],
    confirmedTotals: sample,
    audit: {
      issues: [
        { category: '기타(미분류)', severity: 'warning', columns: ['C'], message: '자동 미분류 원문' },
        { category: '콜롬비아 수국', severity: 'warning', columns: ['H'], message: '통관비 확인' },
      ],
    },
  });
  const unclassifiedWorkbook = XLSX.read(unclassifiedBuffer, { cellStyles: true, cellNF: true });
  const exportedNote = String(unclassifiedWorkbook.Sheets['주차별 매출이익 보고서'].B28?.v || '');
  assert.match(exportedNote, /담당자 직접 입력 비고/, '사용자가 직접 입력한 비고는 엑셀에 유지한다');
  assert.match(exportedNote, /통관비 확인/, '정상 카테고리의 자동검증은 엑셀에 유지한다');
  assert.doesNotMatch(exportedNote, /자동 미분류|기타\(미분류\)|777,777/, '자동 미분류 영역은 엑셀에 표시하지 않는다');
  console.log('profitReportExcelDesign.test.js: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
