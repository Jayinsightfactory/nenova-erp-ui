import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import JSZip from 'jszip';
import {invoiceCostExportFixture} from './invoiceReceiptCostExport.test.js';
import {createInvoiceCostWorkbook} from '../lib/invoiceReceiptCostExport.js';
import {RESTORED_COST_LAYOUTS} from '../lib/invoiceCostOriginalRestoration.js';
import {INVOICE_COST_EXPORT_PROFILES} from '../lib/invoiceCostExportProfiles.js';
const XLSX=createRequire(import.meta.url)('xlsx');
for(const[id,p]of Object.entries(RESTORED_COST_LAYOUTS))test(`${id} original calculation restores sales/formulas/summary without historic input`,async()=>{
 const profile=INVOICE_COST_EXPORT_PROFILES[id],f=invoiceCostExportFixture(7,profile.formulaId),before=JSON.stringify(f);
 const bytes=await createInvoiceCostWorkbook(f),book=XLSX.read(bytes,{cellFormula:true,cellNF:true}),s=book.Sheets['원본 양식 계산'];
 assert.equal(JSON.stringify(f),before);assert.ok(s);assert.equal(s[p.fx].v,f.snapshot.input.exchangeRateKRW);
 const header=profile.headerRow??p.first-1,last=p.first+6,summary=header-1;
 assert.match(s[`${p.input}${header}`].v,/매주 확인/);
 assert.match(s[`${p.margin}${p.first}`].z,/%/,'profit ratio must be percentage');
 assert.match(s[`${p.margin}${summary}`].z,/%/,'summary ratio must be percentage');
 assert.doesNotMatch(s[`${p.sales}${p.first}`].z,/%/,'sales total is money, never percentage');
 assert.equal(s[`${p.unitCost}${p.first}`].z,'#,##0.00','KRW must not inherit a foreign-currency symbol or text format');
 assert.equal(s[`${p.sales}${summary}`].z,'#,##0');
 for(const r of [p.first,p.first+3,last]){
  if(id==='CN_SEA_ORIGINAL_V1')assert.equal(s[`${p.input}${r}`]?.v,'');
  else assert.equal(typeof s[`${p.input}${r}`]?.v,'number');
  assert.match(s[`${p.sale}${r}`].f,new RegExp(`ISNUMBER\\(${p.input}${r}\\)`));
  assert.match(s[`${p.profit}${r}`].f,/ISNUMBER/);assert.match(s[`${p.margin}${r}`].f,/=0/);
  assert.ok(s[`${p.sales}${r}`].f);assert.ok(s[`${p.profits}${r}`].f);assert.ok(s[`${p.unitCost}${r}`].f);
 }
 assert.match(s[`${p.sales}${summary}`].f,new RegExp(`${p.sales}${p.first}:${p.sales}${last}`));
 assert.equal(s.AB6.v,f.revision.totalCostKRW);
 if(id==='CN_SEA_ORIGINAL_V1'){
  assert.equal(s.AB7.v,'입력 필요');assert.equal(s.AB8.v,'입력 필요');
  assert.equal(s[`${p.unitCost}${p.first}`].v,'입력 필요');assert.match(s[`AD${p.first}`].f,/ISNUMBER/);
 }else{assert.ok(Math.abs(s.AB7.v-s.AB6.v)<.01);assert.ok(Math.abs(s.AB8.v)<.01);}
 const zip=await JSZip.loadAsync(bytes);assert.match(await zip.file('xl/workbook.xml').async('string'),/activeTab="2"/);
 for(const file of ['sheet1.xml','sheet2.xml'])assert.doesNotMatch(await zip.file(`xl/worksheets/${file}`).async('string'),/tabSelected="1"/);
 assert.doesNotMatch(await zip.file('xl/worksheets/sheet3.xml').async('string'),/#REF!|<externalLink/);
 if(header>18)assert.match(await zip.file('xl/worksheets/sheet3.xml').async('string'),new RegExp(`ySplit="3" topLeftCell="B${header}"`),'long layouts must not freeze the data out of the viewport');
 if(id==='TH_ORIGINAL_V1')assert.doesNotMatch(s.P15.z,/%/,'legacy first-row percent style must not format currency');
 if(id==='TH_ORIGINAL_V1'){
  assert.equal(s.J10.v,f.snapshot.input.costGroups.reduce((n,g)=>n+g.boxQuantity,0));
  assert.equal(s.K10.v,f.snapshot.input.costGroups.reduce((n,g)=>n+g.quantity,0));
  for(const [i,group] of f.snapshot.input.costGroups.entries()){
   const cell=s[`L${7+i}`];
   assert.equal(cell.z,'0%','every packing group ratio is a percentage, never inherited currency');
   assert.equal(cell.v,group.boxQuantity/s.J10.v);
  }
 }
 if(id==='CO_ORIGINAL_V1')assert.match(s.K7.f,/SUMPRODUCT/);
 if(id!=='NL_ORIGINAL_V1'){
  const compact=profile.priceBasis&&id!=='EC_ORIGINAL_V1',us=id==='US_ORIGINAL_V1',th=id==='TH_ORIGINAL_V1';
  const valueCol=compact?(us?'M':'N'):th?'N':'P',firstFee=compact?5:6;
  if(id==='CN_SEA_ORIGINAL_V1'){
   assert.equal(s[`${valueCol}${firstFee}`].f,'$AB$5');
   assert.equal(s[`${valueCol}${firstFee+2}`].v,'내역 미보유');
   assert.equal(s.E28.f,'SUM(C20:C27,E20:E27)');
  }else{
   // Verified originals use current weight and count, not the old aggregate placeholder.
   const rate=id==='NZ_ORIGINAL_V1'?375:id==='CO_ORIGINAL_V1'?370:460;
   const weightRef=compact?`${p.fx[0]}7`:'C8';
   assert.equal(s[`${valueCol}${firstFee}`].f,`${weightRef}*${rate}`);
   assert.equal(s[`${valueCol}${firstFee}`].v,s[weightRef].v*rate);
   assert.equal(s[`${valueCol}${firstFee+2}`].v,id==='EC_ORIGINAL_V1'?36000:7*10000);
   assert.match(s.AB11.f,/\$AB\$5-/,'reference difference stays explicit');
   if(th){
    assert.match(s.R4.v,/40차.*현재 단가 아님/);
    assert.equal(s.P6.f,'SUMPRODUCT(S6:S10,T6:T10)+SUMPRODUCT(V6:V7,W6:W7)');
    assert.equal(s.T8.v,'원본 미기재');
   }
  }
  assert.equal(s.AB5.v,f.revision.lines.reduce((sum,line)=>sum+(line.componentAmounts.customsKRW??0),0),'applied customs never overwritten by reference defaults');
  assert.ok(s[`${valueCol}${firstFee+4}`].f);
  if(!compact)assert.ok(s[`${th?'I':id==='CN_SEA_ORIGINAL_V1'?'I':'H'}${p.first}`].f,'CNF intermediate formula');
 }
});

test('NZ source has E quantity and M cost, unlike US D/L layout',()=>{
 const p=RESTORED_COST_LAYOUTS.NZ_ORIGINAL_V1;
 assert.deepEqual([p.qty,p.factor,p.unitCost,p.sale,p.input,p.profit,p.margin,p.sales,p.profits],['E','L','M','N','O','Q','R','S','T']);
});
test('NL current template defaults recalculate and prior-year identity is preserved',async()=>{
 const f=invoiceCostExportFixture(3,'NL_AMOUNT_V1');f.document.orderYear='2025';
 const s=XLSX.read(await createInvoiceCostWorkbook(f),{cellFormula:true}).Sheets['원본 양식 계산'];
 assert.equal(s.C5.v,'2025/41-02');assert.equal(s.C9.v,3);assert.equal(s.C10.f,'SUM(E15:E17)');
 assert.equal(s.D6.f,'SUMPRODUCT(E15:E17,F15:F17)');assert.equal(s.C6.f,'D6+C11');
 assert.equal(s.O15.f,'M15*N15');assert.equal(s.Q15.f,'IF(ISNUMBER(R15),R15/1.1,"")');
 assert.equal(s.V13.f,'IF(COUNT(V15:V17)=3,SUM(V15:V17),"입력 필요")');
 assert.equal(s.Q6.v,'내역 미보유');assert.equal(s.Q10.v,f.snapshot.input.customsTotalKRW);
});
