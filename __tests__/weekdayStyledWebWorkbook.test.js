import assert from 'node:assert/strict';
import JSZip from 'jszip';
import XLSX from 'xlsx';
import {buildWeekdayStyledWebWorkbook} from '../lib/weekdayStyledWebWorkbook.js';

const zip=new JSZip();
zip.file('xl/workbook.xml','<workbook><sheets><sheet name="주광 카장수알 38-39차 발주 수량" sheetId="1" r:id="rId1"/></sheets></workbook>');
zip.file('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>');
zip.file('xl/worksheets/sheet1.xml','<worksheet><cols><col min="1" max="1" width="14.875"/><col min="2" max="2" width="40.625"/><col min="3" max="16" width="14.25"/></cols><sheetData>'+[1,2,3,27,28].map(r=>`<row r="${r}" ht="${r===2?42:21}">${Array.from({length:16},(_,c)=>`<c r="${String.fromCharCode(65+c)}${r}" s="${r===2?1:r===27?2:0}" t="inlineStr"><is><t>OLD PRIVATE NAME</t></is></c>`).join('')}</row>`).join('')+'</sheetData><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>');
const styleBytes='<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf/><xf><alignment wrapText="1"/></xf><xf><alignment horizontal="center"/></xf></cellXfs></styleSheet>';
zip.file('xl/styles.xml',styleBytes); zip.file('xl/sharedStrings.xml','OLD PRIVATE NAME'); zip.file('xl/worksheets/sheet2.xml','OLD PRIVATE OTHER SHEET');
const bytes=await zip.generateAsync({type:'uint8array'});
const model={title:'주광 2026/41 웹 작업',columns:[{key:'sun',label:'일요일 10-11'},{key:'total',label:'41-01 합계'},{key:'remain',label:'41-01 잔량'}],rows:[
  {category:'카네이션',name:'New & Rose <name>',unit:'박스',values:{sun:3,total:3,remain:2}},
  {category:'카네이션',name:'신규 품목',unit:'박스',values:{sun:0,total:0,remain:-1}},
  {category:'카네이션',name:'단 단위',unit:'단',values:{sun:50,total:50,remain:0}},
  {category:'장미',name:'Unknown quantity',unit:'단',values:{sun:null,total:0,remain:null}}
]};
const result=await buildWeekdayStyledWebWorkbook(bytes,model);
const out=await JSZip.loadAsync(result);
assert.equal(await out.file('xl/styles.xml').async('string'),styleBytes,'reference format asset remains byte equivalent');
assert.equal(out.file('xl/sharedStrings.xml'),null); assert.equal(out.file('xl/worksheets/sheet2.xml'),null);
for(const file of Object.values(out.files).filter(f=>!f.dir)) assert.ok(!(await file.async('string')).includes('OLD PRIVATE'),'no original content survives');
const workbook=XLSX.read(result,{type:'array',cellStyles:true});
assert.deepEqual(workbook.SheetNames,['주광 발주내역']);
const sheet=workbook.Sheets[workbook.SheetNames[0]];
assert.equal(sheet.B3.v,'New & Rose <name>'); assert.equal(sheet.D3.v,3); assert.equal(sheet.F3.v,2);
assert.equal(sheet.D4.v,0); assert.equal(sheet.F4.v,-1); assert.equal(sheet.D6.v,3); assert.equal(sheet.D7.v,50,'unit subtotal separate');
assert.equal(sheet.D10?.v,undefined,'unknown remains blank');
assert.equal(sheet['!cols'][1].width,40.625); assert.equal(sheet['!rows'][1].hpt,42);
assert.deepEqual(sheet['!merges'][1],{s:{c:0,r:1},e:{c:0,r:6}});
const xml=await out.file('xl/worksheets/sheet1.xml').async('string');
assert.ok(xml.includes('r="D2" s="1"')); assert.ok(xml.includes('r="D6" s="2"'));
await assert.rejects(()=>buildWeekdayStyledWebWorkbook(bytes,{...model,columns:[{key:'x'},{key:'x'}]}),/중복/);
await assert.rejects(()=>buildWeekdayStyledWebWorkbook(bytes,{...model,rows:[{name:'invalid',values:{sun:NaN}}]}),/잘못된 숫자/);
const many=await buildWeekdayStyledWebWorkbook(bytes,{...model,rows:Array.from({length:100},(_,i)=>({category:i<80?'카네이션':'기타',name:`품목 ${i}`,unit:'박스',values:{sun:i,total:i,remain:0}}))});
const dynamic=XLSX.read(many,{type:'array'}).Sheets['주광 발주내역'];
assert.equal(dynamic.B82.v,'품목 79'); assert.equal(dynamic.B105.v,'품목 99');
const longNames=await buildWeekdayStyledWebWorkbook(bytes,{...model,rows:[{category:'카네이션',name:'Ecuador Carnation / Medium Champion White (60cm)',unit:'박스',values:{sun:3,total:3,remain:2}}]});
const longSheet=XLSX.read(longNames,{type:'array',cellStyles:true}).Sheets['주광 발주내역'];
assert.ok(longSheet['!rows'][2].hpt>=42,'wrapped full product names have enough row height');
console.log('weekdayStyledWebWorkbook: full current names, quantities, dynamic groups, native cell styles, zero/null/negative and no stale source data passed');
