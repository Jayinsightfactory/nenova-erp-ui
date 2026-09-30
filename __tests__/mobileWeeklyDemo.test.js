const assert=require('node:assert/strict');
const ExcelJS=require('exceljs');
const {weeklyDemo,weeklyDemoWorkbook}=require('../lib/mobileWeeklyDemo');
const {previewReports}=require('../lib/mobileExecutiveReportPreview');
(async()=>{
  assert.equal(weeklyDemo('2025-39'),null);
  assert.equal(weeklyDemo('39'),null);
  assert.equal(weeklyDemo('__proto__'),null);
  assert.throws(()=>weeklyDemoWorkbook(ExcelJS,'2025-39'));
  for(const period of ['2026-39','2026-38']){
    const report=weeklyDemo(period);
    assert.equal(report.profit,report.revenue-report.cost);
    assert.equal(report.profit,report.items.reduce((n,x)=>n+x.profit,0));
    assert.equal(previewReports(period)[0].profit,report.profit);
    const workbook=weeklyDemoWorkbook(ExcelJS,period);
    const roundtrip=new ExcelJS.Workbook();await roundtrip.xlsx.load(await workbook.xlsx.writeBuffer());
    const sheet=roundtrip.worksheets[0];
    assert.match(sheet.getCell('A1').value,/예시/);
    assert.ok(sheet.getCell('A1').value.includes(period));
    assert.equal(sheet.getCell('B8').value.result,report.revenue);
    assert.equal(sheet.getCell('C8').value.result,report.cost);
    assert.equal(sheet.getCell('D8').value.result,report.profit);
    assert.equal(sheet.getCell('D8').value.formula,'B8-C8');
    assert.equal(sheet.getCell('E8').value.result,report.margin);
    assert.equal(sheet.getCell('B5').type,ExcelJS.ValueType.Number);
    assert.equal(sheet.views[0].ySplit,4);
    assert.equal(sheet.pageSetup.printArea,'A1:E10');
    for(let row=5;row<=7;row++)assert.equal(sheet.getCell(`D${row}`).value.result,sheet.getCell(`B${row}`).value-sheet.getCell(`C${row}`).value);
  }
  assert.notEqual(weeklyDemo('2026-39').revenue,weeklyDemo('2026-38').revenue);
  const a=weeklyDemo('2026-39');a.items[0].revenue=0;
  assert.equal(weeklyDemo('2026-39').revenue,124800000);
  console.log('Weekly demo: period isolation, consistent UI totals, numeric XLSX roundtrip and formulas passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
