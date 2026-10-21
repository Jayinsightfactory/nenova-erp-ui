'use strict';
// Browser-side xlsx download of the ECOUNT workbench safe projection (buildExportModel output).
// No ECOUNT/ERP reads or writes: input is the rows already shown on screen, output is a Blob download.
const XLSX=require('xlsx');
const NUMERIC=/^-?\d+(\.\d+)?$/;
const DATA_SHEET='데이터';
const GUIDE_SHEET='안내';
const GUIDE_NOTICE='네노바웹 안전 투영 — 원본 ECOUNT 엑셀과 열·서식 동일성 미검증';
const MAX_ROWS=20000;
const MAX_COLUMNS=50;
const REASONS={
  loading:'작업 자료를 불러오는 중입니다.',
  unavailable:'작업 자료를 불러오지 못해 Excel로 내보낼 수 없습니다.',
  uncollected:'작업 자료가 아직 수집되지 않아 Excel로 내보낼 수 없습니다.',
  empty:'내보낼 행이 없습니다. 조회 결과가 있을 때만 Excel로 내보낼 수 있습니다.',
  unsupported:'이 화면의 표 구조는 아직 Excel 투영을 지원하지 않습니다.',
};
function fail(code){throw new Error(code);}
// Numeric strings become numeric cells; other strings stay text; null/'' become empty cells.
function cellValue(value){
  if(value==null||value==='')return null;
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  if(typeof value==='bigint')return Number(value);
  if(typeof value==='boolean')return value?'true':'false';
  const text=String(value);
  if(NUMERIC.test(text)){const number=Number(text);if(Number.isFinite(number))return number;}
  return text;
}
function validateModel(model){
  if(!model||typeof model!=='object')fail('INVALID_EXPORT_MODEL');
  const {title='',columns,rows}=model;
  if(typeof title!=='string'||title.length>120)fail('INVALID_TITLE');
  if(!Array.isArray(columns)||!columns.length||columns.length>MAX_COLUMNS||!columns.every(c=>c&&typeof c.key==='string'&&typeof c.label==='string'))fail('INVALID_COLUMNS');
  if(!Array.isArray(rows)||rows.length>MAX_ROWS)fail('INVALID_ROWS');
  for(const row of rows)if(!row||typeof row!=='object')fail('INVALID_ROW');
}
function headerText(column,headerMode){return headerMode==='key'?column.key:column.label;}
function pad(value){return String(value).padStart(2,'0');}
// Local calendar date; never toISOString (timezone shift can move the day).
function stampDate(date){return `${date.getFullYear()}${pad(date.getMonth()+1)}${pad(date.getDate())}`;}
function stampDateTime(date){return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;}
function exportFileName(title,date=new Date()){
  const safe=String(title??'').replace(/[\\/:*?"<>|\u0000-\u001f]+/g,'_').replace(/\s+/g,' ').trim().slice(0,80)||'ECOUNT';
  return `${safe}_${stampDate(date)}.xlsx`;
}
// headerMode 'label' = Excel(표시형식) column labels, 'key' = Excel(데이터) column keys.
function buildWorkbook({title='',columns,rows},{headerMode='label',now=new Date()}={}){
  validateModel({title,columns,rows});
  if(!['label','key'].includes(headerMode))fail('INVALID_HEADER_MODE');
  const header=columns.map(column=>headerText(column,headerMode));
  const body=rows.map(row=>columns.map((column,index)=>cellValue(Array.isArray(row)?row[index]:row[column.key])));
  const data=XLSX.utils.aoa_to_sheet([header,...body]);
  data['!cols']=columns.map(column=>({wch:Math.min(40,Math.max(10,headerText(column,headerMode).length*2))}));
  const guide=XLSX.utils.aoa_to_sheet([[GUIDE_NOTICE],['화면',title],['열 모드',headerMode==='key'?'Excel(데이터): 키 열':'Excel(표시형식): 라벨 열'],['행 수',rows.length],['생성',stampDateTime(now)],['원본 쓰기','없음 (화면 표시 행의 투영만 저장)']]);
  guide['!cols']=[{wch:12},{wch:70}];
  const workbook=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook,data,DATA_SHEET);
  XLSX.utils.book_append_sheet(workbook,guide,GUIDE_SHEET);
  return workbook;
}
function workbookBytes(workbook){return XLSX.write(workbook,{type:'array',bookType:'xlsx'});}
// Whether the Excel buttons may run; mirrors the table's dataState so a placeholder reason stays visible.
function exportAvailability({dataState,rowCount,supported=true}={}){
  if(!supported)return {ready:false,reason:REASONS.unsupported};
  if(dataState!=='loaded')return {ready:false,reason:REASONS[dataState]||REASONS.uncollected};
  if(!Number.isInteger(rowCount)||rowCount<=0)return {ready:false,reason:REASONS.empty};
  return {ready:true,reason:null};
}
function browserDownload(bytes,fileName){
  const blob=new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const url=URL.createObjectURL(blob);
  const anchor=document.createElement('a');
  anchor.href=url;anchor.download=fileName;anchor.rel='noopener';anchor.style.display='none';
  document.body.appendChild(anchor);anchor.click();anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
// download(bytes,fileName) is injectable so node tests never touch Blob/document.
function exportExcel(model,{headerMode='label',now=new Date(),download=browserDownload}={}){
  validateModel(model);
  if(!model.rows.length)fail('NO_ROWS');
  const workbook=buildWorkbook(model,{headerMode,now});
  const fileName=exportFileName(model.title,now);
  download(workbookBytes(workbook),fileName);
  return {fileName,rowCount:model.rows.length,columnCount:model.columns.length,headerMode};
}
module.exports={DATA_SHEET,GUIDE_SHEET,GUIDE_NOTICE,REASONS,cellValue,exportFileName,buildWorkbook,workbookBytes,exportAvailability,exportExcel,browserDownload};
