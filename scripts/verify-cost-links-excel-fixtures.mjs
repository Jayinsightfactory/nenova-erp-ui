// Disposable fixtures only. Never reads or writes ERP data.
import fs from 'node:fs/promises';
import {invoiceCostExportFixture} from '../__tests__/invoiceReceiptCostExport.test.js';
import {createInvoiceCostWorkbook} from '../lib/invoiceReceiptCostExport.js';
import {RESTORED_COST_LAYOUTS} from '../lib/invoiceCostOriginalRestoration.js';
import {INVOICE_COST_EXPORT_PROFILES} from '../lib/invoiceCostExportProfiles.js';
import {appendCostWorkbookHistory} from '../lib/invoiceCostWorkbookHistory.js';
await fs.mkdir('.verify/excel', {recursive:true});
const cases=[];
const layouts={...RESTORED_COST_LAYOUTS,AU_ORIGINAL_V1:{first:13,qty:'E',factor:'L',unitCost:'M',input:'O',profits:'T',sales:'S',margin:'R',fx:'D6'},CO_42_1_ORIGINAL_V1:{first:15,qty:'E',factor:'N',unitCost:'O',input:'Q',profits:'V',sales:'U',margin:'T',fx:'C7'}};
for(const [id,p] of Object.entries(layouts)) {
 const f=invoiceCostExportFixture(7,INVOICE_COST_EXPORT_PROFILES[id].formulaId);
 if(id==='CN_SEA_ORIGINAL_V1')f.snapshot.input.lineInputs.forEach(line=>{line.boxCbm=.1;line.bunchesPerBox=10;});
 await fs.writeFile(`.verify/excel/${id}.xlsx`,await createInvoiceCostWorkbook(f));
 cases.push({id,...p,base:id==='TH_ORIGINAL_V1'?'G':id==='US_ORIGINAL_V1'?'E':'F',summary:(INVOICE_COST_EXPORT_PROFILES[id].headerRow??p.first-1)-1,goods:id==='AU_ORIGINAL_V1'?'D5':INVOICE_COST_EXPORT_PROFILES[id].priceBasis&&id!=='EC_ORIGINAL_V1'?`${p.fx[0]}5`:id==='CO_42_1_ORIGINAL_V1'?'C6':'D6'});
}
// Preserve an actual source workbook, including every old tab and cross-tab formula.
const original=process.env.COST_HISTORY_SOURCE;
if(original){
 const {default:JSZip}=await import('jszip');
 const f=invoiceCostExportFixture(7,'NL_AMOUNT_V1');f.document.orderWeek='44-01';
 const originalBytes=await fs.readFile(original),bytes=await appendCostWorkbookHistory(originalBytes,await createInvoiceCostWorkbook(f),{label:'44-01'});
 const old=await JSZip.loadAsync(originalBytes),next=await JSZip.loadAsync(bytes);
 let preserved=0;
 for(const name of Object.keys(old.files))if(name.startsWith('xl/worksheets/')&&!old.files[name].dir){
  const normalize=b=>b.toString('utf8').replace(/\s+tabSelected="[01]"/g,'');
  if(normalize(await old.files[name].async('nodebuffer'))!==normalize(await next.file(name).async('nodebuffer')))throw new Error('Historical worksheet changed: '+name);
  preserved++;
 }
 await fs.writeFile('.verify/excel/history-part-check.json',JSON.stringify({preservedWorksheetParts:preserved}));
 await fs.writeFile('.verify/excel/real-history.xlsx',bytes);
}
await fs.writeFile('.verify/excel/cases.json',JSON.stringify(cases));
