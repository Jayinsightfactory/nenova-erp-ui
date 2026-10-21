'use strict';
// ECOUNT workbench Excel export: safe projection rows → xlsx workbook, browser download injected (no Blob/document in node).
const test=require('node:test');
const assert=require('node:assert/strict');
const XLSX=require('xlsx');
const lib=require('../lib/ecountExcelExport.cjs');
const pageActions=require('../lib/ecountPageActions.cjs');

const columns=[{key:'sourceDateLabel',label:'일자-No.'},{key:'protected-1',label:'거래처명'},{key:'qty',label:'수량'},{key:'total',label:'합계'}];
const rows=[['2026-10-20-1','','3','12000.50'],['2026-10-21-2','','-2',''],['합계',null,'1','12000.50']];
const now=new Date(2026,9,21,14,5);
function readBack(workbook){return XLSX.read(XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}),{type:'buffer'});}

test('workbook has data sheet with header + rows and a guide sheet with the safe projection notice',()=>{
  const read=readBack(lib.buildWorkbook({title:'판매현황',columns,rows},{now}));
  assert.deepEqual(read.SheetNames,[lib.DATA_SHEET,lib.GUIDE_SHEET]);
  const data=XLSX.utils.sheet_to_json(read.Sheets[lib.DATA_SHEET],{header:1,defval:null});
  assert.equal(data.length,rows.length+1);
  assert.deepEqual(data[0],columns.map(c=>c.label));
  assert.equal(data[0].length,columns.length);
  const guide=XLSX.utils.sheet_to_json(read.Sheets[lib.GUIDE_SHEET],{header:1});
  assert.equal(guide[0][0],lib.GUIDE_NOTICE);
  assert.equal(lib.GUIDE_NOTICE,'네노바웹 안전 투영 — 원본 ECOUNT 엑셀과 열·서식 동일성 미검증');
  assert.deepEqual(guide[1],['화면','판매현황']);
});

test('numeric strings become numeric cells, other strings stay text, null and empty string stay blank',()=>{
  const sheet=readBack(lib.buildWorkbook({title:'판매현황',columns,rows},{now})).Sheets[lib.DATA_SHEET];
  assert.equal(sheet.A2.t,'s');assert.equal(sheet.A2.v,'2026-10-20-1');
  assert.equal(sheet.C2.t,'n');assert.equal(sheet.C2.v,3);
  assert.equal(sheet.D2.t,'n');assert.equal(sheet.D2.v,12000.5);
  assert.equal(sheet.C3.t,'n');assert.equal(sheet.C3.v,-2);
  assert.equal(sheet.B2,undefined);assert.equal(sheet.D3,undefined);assert.equal(sheet.B4,undefined);
  assert.equal(sheet.A4.t,'s');assert.equal(sheet.A4.v,'합계');
  assert.equal(lib.cellValue('007'),7);assert.equal(lib.cellValue('1.0.1'),'1.0.1');assert.equal(lib.cellValue('=SUM(A1)'),'=SUM(A1)');
  assert.equal(lib.cellValue(''),null);assert.equal(lib.cellValue(null),null);assert.equal(lib.cellValue(undefined),null);
  assert.equal(sheet.A1.t,'s');
});

test('object rows map by column key and key header mode writes keys instead of labels',()=>{
  const objectRows=[{sourceDateLabel:'2026-01-01-1','protected-1':'',qty:'4',total:'10'}];
  const label=XLSX.utils.sheet_to_json(readBack(lib.buildWorkbook({title:'x',columns,rows:objectRows},{now})).Sheets[lib.DATA_SHEET],{header:1,defval:null});
  assert.deepEqual(label[0],['일자-No.','거래처명','수량','합계']);assert.deepEqual(label[1],['2026-01-01-1',null,4,10]);
  const key=XLSX.utils.sheet_to_json(readBack(lib.buildWorkbook({title:'x',columns,rows:objectRows},{headerMode:'key',now})).Sheets[lib.DATA_SHEET],{header:1,defval:null});
  assert.deepEqual(key[0],['sourceDateLabel','protected-1','qty','total']);
  assert.throws(()=>lib.buildWorkbook({title:'x',columns,rows:objectRows},{headerMode:'csv'}),/INVALID_HEADER_MODE/);
});

test('file name is <screen>_<YYYYMMDD>.xlsx with unsafe characters replaced and local date (no ISO shift)',()=>{
  assert.equal(lib.exportFileName('판매현황',now),'판매현황_20261021.xlsx');
  assert.equal(lib.exportFileName('매출(세금)계산서조회(재고)',now),'매출(세금)계산서조회(재고)_20261021.xlsx');
  assert.equal(lib.exportFileName('창고/재고:현황*?',now),'창고_재고_현황__20261021.xlsx');
  assert.equal(lib.exportFileName('',now),'ECOUNT_20261021.xlsx');
  assert.equal(lib.exportFileName('연말',new Date(2026,11,31,23,30)),'연말_20261231.xlsx');
  assert.equal(lib.exportFileName('연초',new Date(2027,0,1,0,10)),'연초_20270101.xlsx');
});

test('exportExcel uses the injected download with bytes + file name and refuses zero rows',()=>{
  const calls=[];
  const result=lib.exportExcel({title:'수금현황',columns,rows},{now,download:(bytes,fileName)=>calls.push({bytes,fileName})});
  assert.deepEqual(result,{fileName:'수금현황_20261021.xlsx',rowCount:3,columnCount:4,headerMode:'label'});
  assert.equal(calls.length,1);assert.equal(calls[0].fileName,'수금현황_20261021.xlsx');
  const read=XLSX.read(Buffer.from(calls[0].bytes),{type:'buffer'});
  assert.deepEqual(read.SheetNames,['데이터','안내']);
  assert.throws(()=>lib.exportExcel({title:'수금현황',columns,rows:[]},{now,download:()=>calls.push('never')}),/NO_ROWS/);
  assert.equal(calls.length,1);
  assert.throws(()=>lib.exportExcel({title:'x',columns:[],rows},{now,download:()=>{}}),/INVALID_COLUMNS/);
  assert.throws(()=>lib.exportExcel({title:'x',columns,rows:[1]},{now,download:()=>{}}),/INVALID_ROW/);
});

test('buttons stay disabled with a reason unless the table is loaded with at least one row',()=>{
  assert.deepEqual(lib.exportAvailability({dataState:'loaded',rowCount:2}),{ready:true,reason:null});
  assert.equal(lib.exportAvailability({dataState:'loaded',rowCount:0}).ready,false);
  assert.equal(lib.exportAvailability({dataState:'loaded',rowCount:0}).reason,lib.REASONS.empty);
  for(const dataState of ['loading','unavailable','uncollected',undefined]){
    const availability=lib.exportAvailability({dataState,rowCount:5});
    assert.equal(availability.ready,false);assert.ok(availability.reason);
  }
  assert.equal(lib.exportAvailability({dataState:'loaded',rowCount:5,supported:false}).reason,lib.REASONS.unsupported);
});

test('buildExportModel rows from ecountPageActions feed the workbook unchanged (safe projection, blanks for protected columns)',()=>{
  const projection=pageActions.buildExportModel({dataset:'receipt',title:'수금현황',columns:[{key:'sourceDateLabel',label:'일자'},{key:'protected-1',label:'거래처명'},{key:'amount',label:'금액'}],rows:[{refDate:'2026-12-31',amount:'123456789012345.12345678'},{refDate:'2027-01-01',amount:'5'}]});
  const sheet=readBack(lib.buildWorkbook(projection,{now})).Sheets[lib.DATA_SHEET];
  assert.equal(sheet.A2.v,'2026-12-31');assert.equal(sheet.B2,undefined);assert.equal(sheet.C3.t,'n');assert.equal(sheet.C3.v,5);
  assert.equal(sheet.C2.t,'n');
});
