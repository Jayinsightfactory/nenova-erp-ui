import fs from 'node:fs/promises';
import {invoiceCostExportFixture} from '../__tests__/invoiceReceiptCostExport.test.js';
import {createInvoiceCostWorkbook,createNativeCostWorkbook} from '../lib/invoiceReceiptCostExport.js';
import {INVOICE_COST_EXPORT_PROFILES} from '../lib/invoiceCostExportProfiles.js';
import {readNativeCostSource,calculateNativeCost} from '../lib/nativeReceiptCost.js';
import {nlNativeCostDefaults} from '../lib/nlNativeCostDefaults.js';
import sql from 'mssql';
const out=new URL(process.env.COST_VERIFY_OUTPUT||'../outputs/cost-restoration-1102-final/',import.meta.url);await fs.mkdir(out,{recursive:true});
for(const p of Object.values(INVOICE_COST_EXPORT_PROFILES)){
 const f=invoiceCostExportFixture(3,p.formulaId);f.snapshot.input.exchangeRateType='TEST_ONLY';
 if(p.id==='CN_SEA_ORIGINAL_V1'&&process.env.COST_VERIFY_SOURCE_CBM==='1'){
  // Positive reference replay, distinct from the missing-CBM negative fixture.
  for(let i=0;i<f.document.lines.length;i++){
   f.document.lines[i].originalName='Ammi CHINA 아미초';
   f.snapshot.input.lineInputs[i].bunchesPerBox=10;
  }
 }
 const bytes=await createInvoiceCostWorkbook(f);await fs.writeFile(new URL(`${p.id}_TEST_ONLY.xlsx`,out),bytes);
}
// This is a private, previously SELECT-only snapshot; no connection to MSSQL.
if(process.env.NL_READONLY_SNAPSHOT){
 const rows=JSON.parse(await fs.readFile(process.env.NL_READONLY_SNAPSHOT,'utf8'));
 const source=await readNativeCostSource({types:sql,input:{orderYear:'2026',orderWeek:'43-02',warehouseKey:7814},queryFn:async()=>({recordset:rows})});
 const automatic=nlNativeCostDefaults(source,{currency:'EUR',rate:1509.8,marketRate:1494.8,adjustmentKRW:15,requestedAt:'2026-11-02T00:52:00Z',rateType:'TEST_ONLY',source:'TEST_ONLY previous verified quote',sourceUrl:'https://finance.yahoo.com/quote/EURKRW=X/'});
 const f=calculateNativeCost(source,{sourceHash:source.sourceHash,metadata:automatic.metadata,input:automatic.input});
 if(f.preview.status!=='APPROVED')throw Error('NL fixture failed');
 await fs.writeFile(new URL('NL_43-02_Holex_복원검증.xlsx',out),await createNativeCostWorkbook(f));
}
console.log('RESTORATION_FILES_READY',out.pathname);
