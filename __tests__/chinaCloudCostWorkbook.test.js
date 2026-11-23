import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import XLSX from 'xlsx';
import {CLOUD_COST_FORMULA,CLOUD_CUSTOMS_DEFAULTS,isCloudInvoice,matchCloudCategory,cloudCustomsTotal} from '../lib/chinaCloudCost.js';
import {previewInvoiceCost,INVOICE_COST_FORMULAS} from '../lib/invoiceReceiptCost.js';
import {INVOICE_COST_EXPORT_PROFILES} from '../lib/invoiceCostExportProfiles.js';
import {createInvoicePreviewCostWorkbook} from '../lib/invoiceReceiptCostExport.js';
function fixture(){
 const lines=[['ROSE CHINA White',30,20],['ORCHID CHINA White',80,23],['Cancelled',0,0]].map(([name,q,p],i)=>({lineId:randomUUID(),lineNo:i+1,originalName:name,prodKey:i+1,bunchQuantity:q,outQuantity:q,outUnit:'BUNCH',unitPrice:p,lineAmount:q*p,currency:'CNY'}));
 const document={documentId:randomUUID(),revision:1,orderYear:'2026',orderWeek:'46-02',invoiceNo:'TEST_ONLY',sourceHash:'a'.repeat(64),receiptStatus:'INVOICE_PREVIEW',costStatus:'PREVIEW_ONLY',reviewedMetadata:{country:'CN',transportMode:'AIR',farmName:'CLOUD',inputDate:'2026-11-11',gw:1896},lines,receiptLines:lines};
 const input={...CLOUD_COST_FORMULA,...CLOUD_CUSTOMS_DEFAULTS,cloudCustomsMode:'FORMULA',formulaApplicabilityConfirmed:true,formulaEffectiveDate:'2026-11-11',nativeCurrency:'CNY',freightCurrency:'CNY',freightAmount:24087,exchangeRateKRW:210,exchangeRateType:'TEST_ONLY',exchangeRateDate:'2026-11-11',costSourceId:'TEST_ONLY',allocationScope:'SINGLE_INVOICE',allocationShareNumerator:1,allocationShareDenominator:1,lineInputs:lines.map(l=>({lineId:l.lineId,categoryCode:matchCloudCategory(l.originalName)}))};
 return {document,input};
}
test('generated export profiles have explicit dedicated coverage rather than silently escaping template tests',()=>{
 assert.deepEqual(Object.values(INVOICE_COST_EXPORT_PROFILES).filter(p=>p.generated).map(p=>p.formulaId),['CN_CLOUD_CBM_V1']);
});
test('CLOUD export routes through validated preview and retains live category, GW, FX, freight, permit and sales formulas',async()=>{
 const f=fixture(),p=previewInvoiceCost({...f.document,costInput:f.input},f.document.lines);assert.equal(p.status,'APPROVED',JSON.stringify(p.issues));
 const bytes=await createInvoicePreviewCostWorkbook(f),book=XLSX.read(bytes,{type:'buffer',cellFormula:true}),main=book.Sheets['CLOUD 원가'],cat=book.Sheets['품종 기준'];
 assert.match(main.A1.v,/미승인 계산본.*원장 변경 없음/);assert.match(main.A2.v,/TEST_ONLY 시험값/);
 f.input.expenseBasis='ESTIMATED';const estimated=XLSX.read(await createInvoicePreviewCostWorkbook(f)).Sheets['CLOUD 원가'];assert.match(estimated.A2.v,/추정 통관비 포함.*실제 청구액 아님/);
 assert.ok(Math.abs(main.C8.v-p.totals.totalCostKRW)<1e-6);
 assert.equal(main.C6.v,1360160);assert.match(main.C6.f,/C4\*V3/);assert.match(main.C6.f,/COUNTIF/);
 assert.match(main.S13.f,/\$J\$3/);assert.match(main.G13.f,/S13/);assert.match(main.L13.f,/I13\+J13\+K13/);
 assert.match(main.Q12.f,/N12\*D12/);assert.match(main.R12.f,/O12\*D12/);assert.match(main.C9.f,/SUM\(Q/);
 assert.equal(main.B12.v,'ROSE');assert.equal(main.L14.v,0);assert.equal(main.M14.v,0);
 assert.match(cat.I4.f,/SUMIF/);assert.match(cat.K4.f,/SUM\(\$J\$4:\$J\$24\)/);
 assert.ok(main.Q12.v>0&&main.R12.v>0);assert.ok(main.C9.v>0);assert.ok(bytes.length>2000);
});
test('changing category affects freight and tariff, changing GW affects customs, explicit zero permit remains zero',()=>{
 const f=fixture(),a=previewInvoiceCost({...f.document,costInput:f.input},f.document.lines);
 f.input.lineInputs[0].categoryCode=4;const b=previewInvoiceCost({...f.document,costInput:f.input},f.document.lines);
 assert.notEqual(a.lines[0].costPerUnitKRW,b.lines[0].costPerUnitKRW);
 const before=cloudCustomsTotal(f.document,f.document.lines,f.input);f.document.reviewedMetadata.gw+=10;
 assert.equal(cloudCustomsTotal(f.document,f.document.lines,f.input)-before,4600);
 f.input.cloudOrchidPermitNative=0;const c=previewInvoiceCost({...f.document,costInput:f.input},f.document.lines);assert.equal(c.lines[1].componentAmounts.permitKRW,0);
});
test('new CLOUD calculation rejects the legacy formula; verified historical export can reproduce it without changing HUBFRESH',()=>{
 const f=fixture();f.document.reviewedMetadata.cw=1896;
 const old={...f.input,...INVOICE_COST_FORMULAS.CN_AIR_WEIGHT_CBM_V1,customsTotalKRW:100000,
  lineInputs:f.document.lines.map((l,i)=>({lineId:l.lineId,grossWeightKg:i===0?900:i===1?996:0,tariffRate:0,otherCostPerUnitKRW:0}))};
 const blocked=previewInvoiceCost({...f.document,costInput:old},f.document.lines);assert.ok(blocked.issues.some(i=>i.code==='CLOUD_FORMULA_REQUIRED'));
 const historical=previewInvoiceCost({...f.document,costInput:old},f.document.lines,{historicalApprovedFormula:true});assert.equal(historical.status,'APPROVED',JSON.stringify(historical.issues));
 f.document.reviewedMetadata.farmName='HUBFRESH';assert.equal(previewInvoiceCost({...f.document,costInput:old},f.document.lines).status,'APPROVED');
});
test('form picks CLOUD only for CLOUD, auto-matches and retains saved category edits or explicit cleared values',()=>{
 const source=readFileSync(new URL('../components/import-tools/InvoiceReceiptCostReview.js',import.meta.url),'utf8');
 const helpers=source.slice(source.indexOf('const EMPTY_FORM'),source.indexOf('function Field('));
 const ui=new Function('INVOICE_COST_FORMULAS','isCloudInvoice','matchCloudCategory','CLOUD_CUSTOMS_DEFAULTS',`${helpers};return {initialForm,applicableFormulaId};`)(INVOICE_COST_FORMULAS,isCloudInvoice,matchCloudCategory,CLOUD_CUSTOMS_DEFAULTS);
 const f=fixture(),form=ui.initialForm(f.document,f.document.lines);assert.equal(form.formulaId,'CN_CLOUD_CBM_V1');assert.equal(form.lineInputs[0].categoryCode,1);
 f.document.reviewedMetadata.invoiceCostInput={lineInputs:[{lineId:f.document.lines[0].lineId,categoryCode:4},{lineId:f.document.lines[1].lineId,categoryCode:''}]};
 const edited=ui.initialForm(f.document,f.document.lines);assert.equal(edited.lineInputs[0].categoryCode,4);assert.equal(edited.lineInputs[1].categoryCode,'');
 f.document.reviewedMetadata.farmName='HUBFRESH';assert.equal(ui.applicableFormulaId(f.document),'CN_AIR_WEIGHT_CBM_V1');
 const require=createRequire(import.meta.url);require('next/dist/compiled/babel/core').transformSync(source,{filename:'InvoiceReceiptCostReview.js',presets:[require('next/dist/compiled/babel/preset-react')],configFile:false,babelrc:false});
});
