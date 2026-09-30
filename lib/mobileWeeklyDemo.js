'use strict';
// Fictional fixtures only. No ERP query or operational report input is accepted.
const FIXTURES = {
  '2026-39': [['지방 도매',50000000,41000000],['수도권 도매',20000000,15000000],['호텔',54800000,45000000]],
  '2026-38': [['지방 도매',46000000,38000000],['수도권 도매',19000000,15000000],['호텔',51000000,42000000]],
};
function weeklyDemo(period) {
  if (!Object.hasOwn(FIXTURES,period)) return null;
  const items=FIXTURES[period].map(([name,revenue,cost])=>({name,revenue,cost,profit:revenue-cost,margin:revenue?(revenue-cost)/revenue:0}));
  const revenue=items.reduce((n,r)=>n+r.revenue,0),cost=items.reduce((n,r)=>n+r.cost,0);
  return {period,sample:true,revenue,cost,profit:revenue-cost,margin:revenue?(revenue-cost)/revenue:0,items};
}
function weeklyDemoWorkbook(ExcelJS,period) {
  const report=weeklyDemo(period);
  if(!report) throw new Error('예시 자료가 없는 차수입니다.');
  const workbook=new ExcelJS.Workbook();
  workbook.creator='NENOVA 예시';
  workbook.calcProperties.fullCalcOnLoad=true;
  const sheet=workbook.addWorksheet('주차별 매출이익 예시');
  sheet.columns=[{width:24},{width:21},{width:21},{width:21},{width:16}];
  sheet.mergeCells('A1:E1'); sheet.getCell('A1').value=`[예시] ${period} 주차별 매출·이익보고서`;
  sheet.mergeCells('A2:E2'); sheet.getCell('A2').value='실제 경영자료 아님 · 가상 데이터 · 단위: 원 · 영업 의사결정에 사용하지 마세요.';
  sheet.addRow([]); sheet.addRow(['구분','매출액','매입 및 비용','이익','이익률']);
  report.items.forEach((item,index)=>{
    const r=index+5;
    sheet.addRow([item.name,item.revenue,item.cost,{formula:`B${r}-C${r}`,result:item.profit},{formula:`IFERROR(D${r}/B${r},0)`,result:item.margin}]);
  });
  sheet.addRow(['합계',{formula:'SUM(B5:B7)',result:report.revenue},{formula:'SUM(C5:C7)',result:report.cost},{formula:'B8-C8',result:report.profit},{formula:'IFERROR(D8/B8,0)',result:report.margin}]);
  sheet.mergeCells('A10:E10'); sheet.getCell('A10').value='계산 기준: 이익 = 매출액 - 매입 및 비용 / 이익률 = 이익 ÷ 매출액';
  sheet.eachRow((row,r)=>{
    row.height=r===1?32:r===2?34:26;
    row.eachCell(cell=>{cell.font={name:'맑은 고딕',size:11,color:{argb:'FF182C40'}};cell.alignment={vertical:'middle',wrapText:r===2||r===10};});
    if([1,4,8].includes(r)){row.eachCell(cell=>{cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:r===8?'FFE8F3EE':'FF173D53'}};cell.font={name:'맑은 고딕',size:r===1?16:11,bold:true,color:{argb:r===8?'FF286749':'FFFFFFFF'}};});}
  });
  for(let r=5;r<=8;r++) {for(let c=2;c<=4;c++) sheet.getCell(r,c).numFmt='#,##0;[Red](#,##0);"-"';sheet.getCell(r,5).numFmt='0.0%';}
  sheet.views=[{state:'frozen',ySplit:4}];
  sheet.pageSetup={paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:1,printArea:'A1:E10'};
  sheet.headerFooter={oddFooter:'예시 자료 · 실제 경영자료 아님 | &P / &N'};
  return workbook;
}
module.exports={weeklyDemo,weeklyDemoWorkbook};
