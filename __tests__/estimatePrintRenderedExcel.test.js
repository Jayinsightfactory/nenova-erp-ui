import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildEstimateRenderedWorksheet, serializeEstimatePrintWorkbook, uniqueEstimateSheetName } from '../lib/estimatePrintRenderedExcel.js';
import { buildEstimatePrintWorkbook } from '../lib/estimatePrintExcel.js';
import ExcelJS from 'exceljs';
import { buildEstimateHtml } from '../lib/estimatePrintHtml.js';

test('printed cells retain supplier, quantity box notation, negative VAT and repeated headers in XLSX',async()=>{
  const cells=[
    {x:0,y:0,w:360,h:30,text:'견 적 서',fontSize:16,bold:true,underline:true,align:'center'},
    {x:0,y:30,w:180,h:20,text:'사업자등록번호',fontSize:9},
    {x:180,y:30,w:180,h:20,text:'TEST-ONLY',fontSize:8},
    {x:0,y:50,w:180,h:22,text:'수량',fontSize:9,bold:true,border:true},
    {x:180,y:50,w:180,h:22,text:'부가세',fontSize:9,bold:true,border:true},
    {x:0,y:72,w:180,h:30,text:'120단(2)',fontSize:8,border:true},
    {x:180,y:72,w:180,h:30,text:'-1,200',fontSize:8,align:'right',border:true},
  ];
  const sheet=buildEstimateRenderedWorksheet({cells,images:[],head:{top:50,bottom:72}});
  const bytes=await serializeEstimatePrintWorkbook(buildEstimatePrintWorkbook([{name:'2025_47',worksheet:sheet},{name:'2026_47',worksheet:sheet}]));
  const reopened=new ExcelJS.Workbook();await reopened.xlsx.load(bytes);
  assert.equal(reopened.worksheets.length,2,'same week in separate years remains two documents');
  for(const ws of reopened.worksheets){
    assert.equal(ws.getCell('A1').value,'견 적 서');
    assert.equal(ws.getCell('A1').font.underline,true);
    assert.equal(ws.getCell('A2').value,'사업자등록번호');
    assert.equal(ws.getCell('B2').value,'TEST-ONLY');
    assert.equal(ws.getCell('A4').value,'120단(2)');
    assert.equal(ws.getCell('B4').value,-1200);
    assert.equal(ws.getCell('B4').numFmt,'#,##0');
    assert.equal(ws.pageSetup.paperSize,9);
    assert.equal(ws.pageSetup.fitToWidth,1);
    assert.equal(ws.pageSetup.fitToHeight,0,'long tables must not shrink to one page');
    assert.equal(ws.pageSetup.printTitlesRow,'3:3');
    assert.equal(ws.pageSetup.printArea,'A1:B4');
    assert.ok(Math.abs(ws.pageSetup.margins.left-15/25.4)<1e-8);
    assert.equal(ws.getRow(4).height,22.5);
  }
});

test('empty print measurement fails instead of downloading a blank workbook',()=>{
  assert.throws(()=>buildEstimateRenderedWorksheet({cells:[],images:[]}),/출력할 셀/);
});

test('a multi-page statement has one document total instead of repeating its grand total',()=>{
  const html=buildEstimateHtml({custName:'연습 업체',rows:[],printFormat:'statement',printDate:'2026-11-24'});
  assert.ok(html.includes('.item-table tfoot { display:table-row-group; break-inside:avoid; }'));
  assert.equal((html.match(/<tfoot>/g)||[]).length,1);
});

test('long customer and split-group sheet names remain distinct without losing the numeric suffix',()=>{
  const base='연습 업체 이름과 품목군 이름이 긴 경우를 확인합니다'.repeat(2);
  const first=uniqueEstimateSheetName(base),second=uniqueEstimateSheetName(base,[first]),third=uniqueEstimateSheetName(base,[first,second]);
  assert.equal(first.length,31);assert.equal(second.length,31);assert.equal(third.length,31);
  assert.ok(second.endsWith('_2'));assert.ok(third.endsWith('_3'));
  assert.equal(uniqueEstimateSheetName('REPORT',['report']),'REPORT_2','Excel sheet names are case insensitive');
});

test('localized display separators do not change the numeric amount or turn text into a number',()=>{
  const ws=buildEstimateRenderedWorksheet({images:[],head:null,cells:[
    {x:0,y:0,w:100,h:20,text:'12.345',align:'right',fontSize:9,isNumeric:true,numericValue:12345},
    {x:0,y:20,w:100,h:20,text:'12,34',align:'right',fontSize:9,isNumeric:true,numericValue:12.34},
    {x:0,y:40,w:100,h:20,text:'001234',align:'right',fontSize:9,isNumeric:false,numericValue:null},
  ]});
  assert.equal(ws.A1.v,12345);assert.equal(ws.A1.t,'n');
  assert.equal(ws.A2.v,12.34);assert.equal(ws.A2.t,'n');
  assert.equal(ws.A3.v,'001234');assert.equal(ws.A3.t,'s');
});
