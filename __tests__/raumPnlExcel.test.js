const assert = require('node:assert/strict');

async function main() {
  const { buildRaumPnlWorkbook } = await import('../lib/raumPnlExcel.js');
  const ExcelJS = (await import('exceljs')).default;
  const buffer = await buildRaumPnlWorkbook([{
    master: { OrderYear: '2026', MajorWeek: '29', QuoteDate: '2026-07-20', NenovaPct: 80 },
    items: [
      { name: '수국 화이트', unit: '박스', qty: 2, price: 1000, costPrice: 600, byBranch: { 강남: 2 }, remark: '', consigned: true },
      { name: '장미 로다스', unit: '단', qty: 3, price: 2000, costPrice: null, byBranch: { 건대: 3 }, remark: '', consigned: true },
    ],
  }]);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const week = wb.getWorksheet('29차');
  assert.ok(week, '차수 시트가 생성되어야 한다.');
  // 지점 2개 기준: C:D 지점, E 수량, F 매입단가, G 매입액, H 매출액 전 단계...
  assert.match(String(week.getCell('G3').value.formula), /IF\(F3<>"",E3\*F3,0\)/, '입력된 매입단가만 매입액에 반영되어야 한다.');
  assert.match(String(week.getCell('G4').value.formula), /IF\(F4<>"",E4\*F4,0\)/, '미입력 매입단가도 나중에 입력 가능한 수식이어야 한다.');
  assert.match(String(week.getCell('J4').value.formula), /IF\(F4<>"",I4-G4,0\)/, '매입단가 미입력 행은 이익으로 과대계상되면 안 된다.');
  const summary = wb.getWorksheet('결산');
  assert.equal(summary.getCell('C3').value.result, 1200);
  assert.equal(summary.getCell('D3').value.result, 8000);
  assert.equal(summary.getCell('E3').value.result, 800, '입력된 사입 매입단가 행만 이익에 반영되어야 한다.');
  console.log('Raum P&L Excel policy tests passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
