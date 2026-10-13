import assert from 'node:assert/strict';
import JSZip from 'jszip';
import XLSX from 'xlsx';
import {buildWeekdayStyledWebWorkbook} from '../lib/weekdayStyledWebWorkbook.js';

const zip=new JSZip();
zip.file('xl/workbook.xml','<workbook><sheets><sheet name="주광 카장수알 38-39차 발주 수량" sheetId="1" r:id="rId1"/></sheets></workbook>');
zip.file('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>');
zip.file('xl/worksheets/sheet1.xml','<worksheet><cols><col min="1" max="1" width="14.875"/><col min="2" max="2" width="40.625"/><col min="3" max="16" width="14.25"/></cols><sheetData>'+[1,2,3,27,28].map(r=>`<row r="${r}" ht="${r===2?42:21}">${Array.from({length:16},(_,c)=>`<c r="${String.fromCharCode(65+c)}${r}" s="${r===2?1:r===27?2:0}" t="inlineStr"><is><t>OLD PRIVATE NAME</t></is></c>`).join('')}</row>`).join('')+'</sheetData><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>');
const styleBytes='<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.000"/></numFmts><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf numFmtId="164" fontId="0" borderId="0" fillId="1" applyFill="0"/><xf fontId="0" borderId="0" applyAlignment="1"><alignment wrapText="1"/></xf><xf fontId="0" borderId="0"><alignment horizontal="center"/></xf></cellXfs></styleSheet>';
zip.file('xl/styles.xml',styleBytes); zip.file('xl/sharedStrings.xml','OLD PRIVATE NAME'); zip.file('xl/worksheets/sheet2.xml','OLD PRIVATE OTHER SHEET');
const bytes=await zip.generateAsync({type:'uint8array'});
const model={title:'주광 2026/41 웹 작업',columns:[{key:'sun',kind:'day',label:'일요일 10-11'},{key:'total',kind:'sum01',label:'41-01 합계'},{key:'remain',kind:'remaining01',label:'41-01 잔량'}],rows:[
  {category:'카네이션',name:'New & Rose <name>',unit:'박스',values:{sun:3,total:3,remain:2}},
  {category:'카네이션',name:'신규 품목',unit:'박스',values:{sun:0,total:0,remain:-1}},
  {category:'카네이션',name:'단 단위',unit:'단',values:{sun:50,total:50,remain:0}},
  {category:'장미',name:'Unknown quantity',unit:'단',values:{sun:null,total:0,remain:null}}
]};
const result=await buildWeekdayStyledWebWorkbook(bytes,model);
const out=await JSZip.loadAsync(result);
const outputStyles=await out.file('xl/styles.xml').async('string');
const nodes=(xml,section,tag)=>xml.match(new RegExp(`<${section}\\b[^>]*>([\\s\\S]*?)<\\/${section}>`))[1]
  .match(new RegExp(`<${tag}\\b[^>]*?(?:\\/>|>[\\s\\S]*?<\\/${tag}>)`,'g'))||[];
const originals=nodes(styleBytes,'cellXfs','xf'),outputXfs=nodes(outputStyles,'cellXfs','xf');
assert.deepEqual(outputXfs.slice(0,originals.length),originals,'original self-closing and paired XFs remain exact');
assert.deepEqual(nodes(outputStyles,'fills','fill').slice(0,2),nodes(styleBytes,'fills','fill'),'original fills remain exact');
for(const section of ['numFmts','fonts','borders','cellStyleXfs']) assert.equal(
  outputStyles.match(new RegExp(`<${section}\\b[\\s\\S]*?<\\/${section}>`))[0],
  styleBytes.match(new RegExp(`<${section}\\b[\\s\\S]*?<\\/${section}>`))[0],`${section} unchanged`);
assert.equal(out.file('xl/sharedStrings.xml'),null); assert.equal(out.file('xl/worksheets/sheet2.xml'),null);
for(const file of Object.values(out.files).filter(f=>!f.dir)) assert.ok(!(await file.async('string')).includes('OLD PRIVATE'),'no original content survives');
const workbook=XLSX.read(result,{type:'array',cellStyles:true});
assert.deepEqual(workbook.SheetNames,['주광 발주내역']);
const sheet=workbook.Sheets[workbook.SheetNames[0]];
assert.equal(sheet.B3.v,'New & Rose <name>'); assert.equal(sheet.D3.v,3); assert.equal(sheet.F3.v,2);
assert.equal(sheet.D4?.v,undefined,'zero quantity is a styled blank'); assert.equal(sheet.F4.v,-1); assert.equal(sheet.D6.v,3); assert.equal(sheet.D7.v,50,'unit subtotal separate');
assert.equal(sheet.D10?.v,undefined,'unknown remains blank');
assert.equal(sheet.E10?.v,undefined,'zero stays blank');
assert.equal(sheet.E11?.v,undefined,'zero subtotal stays blank');
assert.equal(sheet['!cols'][1].width,40.625); assert.equal(sheet['!rows'][1].hpt,42);
assert.deepEqual(sheet['!merges'][1],{s:{c:0,r:1},e:{c:0,r:6}});
const xml=await out.file('xl/worksheets/sheet1.xml').async('string');
assert.ok(xml.includes('r="D2" s="1"'),'ordinary day header keeps original style');
const styleAt=(sheet,address)=>sheet.match(new RegExp(`<c\\b[^>]*\\br="${address}"[^>]*\\bs="(\\d+)"`))?.[1];
const colorAt=(sheet,styles,address)=>{
  const xf=nodes(styles,'cellXfs','xf')[Number(styleAt(sheet,address))];
  const fillId=Number(xf.match(/\bfillId="(\d+)"/)?.[1]||0);
  return nodes(styles,'fills','fill')[fillId].match(/\bfgColor rgb="([A-F0-9]+)"/)?.[1];
};
for(const row of [2,3,4,10]) {
  assert.equal(colorAt(xml,outputStyles,`E${row}`),'FFE7F0FF','sum header/body/zero/unknown styled');
  assert.equal(colorAt(xml,outputStyles,`F${row}`),'FFE6F4EA','balance header/body/negative/unknown styled');
}
for(const row of [6,7,11]) for(const column of ['A','B','C','D','E','F'])
  assert.equal(colorAt(xml,outputStyles,`${column}${row}`),'FFC9DDF3','subtotal row color takes precedence including blanks');
assert.equal(styleAt(xml,'E3'),styleAt(xml,'E4'),'same base style/role is cached');
await assert.rejects(()=>buildWeekdayStyledWebWorkbook(bytes,{...model,columns:[{key:'x'},{key:'x'}]}),/중복/);
await assert.rejects(()=>buildWeekdayStyledWebWorkbook(bytes,{...model,rows:[{name:'invalid',values:{sun:NaN}}]}),/잘못된 숫자/);
const many=await buildWeekdayStyledWebWorkbook(bytes,{...model,rows:Array.from({length:100},(_,i)=>({category:i<80?'카네이션':'기타',name:`품목 ${i}`,unit:'박스',values:{sun:i,total:i,remain:0}}))});
const dynamic=XLSX.read(many,{type:'array'}).Sheets['주광 발주내역'];
assert.equal(dynamic.B82.v,'품목 79'); assert.equal(dynamic.B105.v,'품목 99');
const longNames=await buildWeekdayStyledWebWorkbook(bytes,{...model,rows:[{category:'카네이션',name:'Ecuador Carnation / Medium Champion White (60cm)',unit:'박스',values:{sun:3,total:3,remain:2}}]});
const longSheet=XLSX.read(longNames,{type:'array',cellStyles:true}).Sheets['주광 발주내역'];
assert.ok(longSheet['!rows'][2].hpt>=42,'wrapped full product names have enough row height');
const kinds=['day','wilson','initial01','dayTotal','sum01','sum02','total','remaining01','remaining02','remaining','change','futureRole',
  'day','sum01','remaining','change','total','remaining01','dayTotal','change'];
const wideColumns=kinds.map((kind,index)=>({key:`wide${index}`,kind,label:`column ${index}`}));
const wide=await buildWeekdayStyledWebWorkbook(bytes,{columns:wideColumns,rows:[
  {category:'장미',name:'양식 보존',unit:'단',values:Object.fromEntries(wideColumns.map((column,index)=>[column.key,index%3===0?0:index%3===1?null:-index]))}]});
const wideZip=await JSZip.loadAsync(wide),wideXml=await wideZip.file('xl/worksheets/sheet1.xml').async('string'),wideStyles=await wideZip.file('xl/styles.xml').async('string');
const col=index=>{let name='';for(let value=index+1;value;value=Math.floor((value-1)/26))name=String.fromCharCode(65+(value-1)%26)+name;return name;};
const expectedColors={dayTotal:'FFE7F0FF',sum01:'FFE7F0FF',sum02:'FFE7F0FF',total:'FFE7F0FF',
  remaining01:'FFE6F4EA',remaining02:'FFE6F4EA',remaining:'FFE6F4EA',change:'FFFFF2CC',initial01:'FFFFF2CC',initial02:'FFFFF2CC'};
const stripFill=xf=>xf.replace(/\s+(?:fillId|applyFill)="[^"]*"/g,'');
for(const [index,kind] of kinds.entries()) {
  const column=col(index+3),color=expectedColors[kind];
  for(const row of [2,3]) {
    const base=row===2?1:0;
    if(color) {
      assert.equal(colorAt(wideXml,wideStyles,`${column}${row}`),color,`role ${kind} beyond original width ${column}`);
      const styled=nodes(wideStyles,'cellXfs','xf')[Number(styleAt(wideXml,`${column}${row}`))];
      assert.equal(stripFill(styled),stripFill(originals[base]),'only fill attributes change on cloned XF');
    } else assert.equal(styleAt(wideXml,`${column}${row}`),String(base),'unknown/ordinary role preserves exact original style');
  }
  assert.equal(colorAt(wideXml,wideStyles,`${column}4`),'FFC9DDF3','subtotal overrides all column roles');
}
assert.equal(nodes(wideStyles,'cellXfs','xf').length,12,'clones are cached by base style and role, not per cell');
assert.equal(nodes(wideStyles,'fills','fill').length,7,'five semantic role fills appended once');
assert.equal(Number(wideStyles.match(/<cellXfs[^>]*count="(\d+)"/)?.[1]),12,'XF count follows appended nodes');
assert.equal(Number(wideStyles.match(/<fills[^>]*count="(\d+)"/)?.[1]),7,'fill count follows appended nodes');
const groupedColumns=[{key:'base',kind:'initial01',label:'41-1 물량표 기준'},
  ...['day','wilson','dayTotal'].map((kind,index)=>({key:kind,kind,label:`10/11\n${kind}`,groupKey:'2026|41-1',groupLabel:'41-1'})),
  {key:'balance',kind:'remaining01',label:'41-1 잔량'},
  {key:'next',kind:'day',label:'10/12\n월',groupKey:'2026|41-2',groupLabel:'41-2'}];
const grouped=await buildWeekdayStyledWebWorkbook(bytes,{columns:groupedColumns,rows:[
  {category:'카네이션',name:'브루트',unit:'박스',values:{base:5,day:2,wilson:1,dayTotal:3,balance:2,next:0}},
  {category:'수국',name:'화이트',unit:'단',values:{base:0,day:0,wilson:0,dayTotal:0,balance:0,next:0}}]});
const groupedZip=await JSZip.loadAsync(grouped),groupedXml=await groupedZip.file('xl/worksheets/sheet1.xml').async('string');
const groupedStyles=await groupedZip.file('xl/styles.xml').async('string'),groupedBook=await groupedZip.file('xl/workbook.xml').async('string');
assert.match(groupedXml,/<mergeCell ref="E2:G2"/,'day, Wilson and day total share one subweek header');
assert.match(groupedXml,/<mergeCell ref="D2:D3"/);assert.match(groupedXml,/<mergeCell ref="H2:H3"/);
assert.match(groupedXml,/<mergeCell ref="E7:G7"/,'category header repeats both rows');
assert.match(groupedXml,/ySplit="3" topLeftCell="D4"/);
assert.match(groupedBook,/name="_xlnm.Print_Titles"[^>]*>[^<]*!\$1:\$3</);
assert.match(groupedBook,/name="_xlnm.Print_Area"[^>]*>[^<]*!\$A\$1:\$I\$11</);
const groupedSheet=XLSX.read(grouped,{type:'array'}).Sheets['주광 발주내역'];
assert.equal(groupedSheet.E2.v,'41-1');assert.equal(groupedSheet.E3.v,'10/11\nday');
assert.equal(groupedSheet.E4.v,2);assert.equal(groupedSheet.F4.v,1);assert.equal(groupedSheet.G4.v,3);
assert.equal(groupedSheet.I4?.v,undefined,'zero remains blank under grouped header');
assert.equal(colorAt(groupedXml,groupedStyles,'D4'),'FFFFF2CC');
assert.equal(colorAt(groupedXml,groupedStyles,'G4'),'FFE7F0FF');
assert.equal(colorAt(groupedXml,groupedStyles,'H4'),'FFE6F4EA');
console.log('weekdayStyledWebWorkbook: full current names, quantities, dynamic groups, native cell styles, zero/null/negative and no stale source data passed');
