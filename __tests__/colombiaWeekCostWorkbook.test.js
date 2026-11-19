import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import XLSX from 'xlsx-js-style';
import {calculateColombiaWeekCost} from '../lib/colombiaWeekCost.js';
import {createColombiaWeekCostWorkbook} from '../lib/colombiaWeekCostWorkbook.js';
const scope={country:'CO',orderYear:'2026',orderWeek:'46-02'};
function fixture(){
 const awbs=['01441369974','16017338005'].map((awb,i)=>{const lineId=`TEST_ONLY-line-${i}`,member={...scope,documentId:`native-${i+1}`,warehouseKey:i+1,revision:1,sourceHash:'a'.repeat(64),awb,currency:'USD',farmName:`TEST_ONLY farm${i}`,invoiceNo:`TEST_ONLY invoice${i}`,rows:[{lineId,originalName:`TEST_ONLY product${i}`,prodKey:i+1,actualQuantity:100,stemQuantity:100,unit:'STEM',unitPrice:1,lineAmount:100,currency:'USD',boxQuantity:1}],lineInputs:[{lineId,groupId:i?'HYDRANGEA':'ROSE',tariffRate:0,stemsPerBunch:10}]};return{awb,manifest:{...scope,awb,currency:'USD',members:[{documentId:member.documentId,revision:1,sourceHash:member.sourceHash}]},members:[member],input:{gw:100,cw:120,freightCurrency:'USD',freightAmount:(i+1)*100,exchangeRate:1400,exchangeRateType:'TEST_ONLY'}};});
 const customsPools=[{sourceId:'TEST_ONLY common customs',awbs:awbs.map(a=>a.awb),amountKRW:1000,confirmed:true}];
 const calculation=calculateColombiaWeekCost({scope,awbs,customsPools});
 const prepared={scope,issues:[],documents:awbs.flatMap(a=>a.members.map(m=>({...m,reviewedMetadata:{country:'CO',transportMode:'AIR',farmName:m.farmName,inputDate:'2026-11-19'},receiptLines:m.rows,lines:m.rows})))};
 return{prepared,calculation};
}
test('one combined original-layout sheet only, all rows and AWB-local live formulas; caches match core',async()=>{
 const f=fixture(),bytes=await createColombiaWeekCostWorkbook(f),w=XLSX.read(bytes,{type:'buffer'});
 assert.deepEqual(w.SheetNames,['2026 46-02']);const sheet=w.Sheets[w.SheetNames[0]];
 assert.match(sheet.B1.v,/TEST_ONLY/);assert.equal(sheet.E15.v,100);assert.equal(sheet.E16.v,100);
 assert.equal(sheet.M15.v,2805);assert.equal(sheet.M16.v,4205);assert.equal(sheet.AL12.v,701000);
 assert.equal(sheet.G15.f,'IF(E15=0,0,$AX$200)');assert.equal(sheet.G16.f,'IF(E16=0,0,$AX$201)');
 assert.equal(sheet.J15.f,'H15*$AS$2');assert.equal(sheet.J16.f,'H16*$AS$3');
 assert.equal(sheet.AT2.v,500);assert.equal(sheet.AT3.v,500);assert.equal(sheet.P10.v,1000);
 assert.equal(sheet.AX200.v,1);assert.equal(sheet.AX201.v,2);assert.equal(sheet.AZ200.v,5);
 assert.equal(sheet.M7.v,1);assert.equal(sheet.M11.v,2);assert.equal(sheet.U7.v,5);assert.equal(sheet.U11.v,5);
 const zip=await JSZip.loadAsync(bytes);assert.equal(Object.keys(zip.files).filter(n=>/^xl\/worksheets\/sheet\d+\.xml$/.test(n)).length,1);
 const xml=await zip.file('xl/workbook.xml').async('string');assert.match(xml,/fullCalcOnLoad="1"/);assert.doesNotMatch(xml,/summary|AWB 시트|원본수식 비교/);
});
test('single AWB retains existing visible GW/CW/freight/FX input dependency, and missing stem factors block export',async()=>{
 const f=fixture();f.calculation.results.pop();f.calculation.lines.pop();f.calculation.weights.pop();f.calculation.awbCount=1;f.prepared.documents.pop();
 f.calculation.customsSources[0].awbs.pop();f.calculation.customsSources[0].amountKRW=500;f.calculation.totals.customsKRW=500;
 const w=XLSX.read(await createColombiaWeekCostWorkbook(f),{type:'buffer'}),s=w.Sheets[w.SheetNames[0]];
 assert.equal(s.AP2.f,'$C$8');assert.equal(s.AQ2.f,'$E$8');assert.equal(s.AR2.f,'$C$11');assert.equal(s.AS2.f,'$C$7');
 f.calculation.results[0].result.lineInputs[0].stemsPerBunch=null;await assert.rejects(createColombiaWeekCostWorkbook(f),/단당 송이수/);
});
