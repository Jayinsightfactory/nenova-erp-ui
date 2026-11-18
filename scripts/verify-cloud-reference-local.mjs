// Read-only original-workbook comparison. No DB, AI, HTTP or receipt writes.
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {writeFileSync,mkdirSync} from 'node:fs';
import {CLOUD_COST_FORMULA,matchCloudCategory} from '../lib/chinaCloudCost.js';
import {previewInvoiceCost} from '../lib/invoiceReceiptCost.js';
import {createInvoicePreviewCostWorkbook} from '../lib/invoiceReceiptCostExport.js';
const python='C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1116-1210-0_26.1116.1210.0_x64__3k8sg7r9htsxt/dependencies/python/python.exe';
const file=process.env.CLOUD_REFERENCE_FILE;
if(!file)throw Error('CLOUD_REFERENCE_FILE is required; no source substitution');
const source=JSON.parse(execFileSync(python,['-c',`import openpyxl,json,sys
w=openpyxl.load_workbook(sys.argv[1],data_only=True);s=w['46-2 CLOUD cbm ']
print(json.dumps({'fx':s['C7'].value,'gw':s['C8'].value,'cw':s['E8'].value,'freight':s['C11'].value,'customs':s['T10'].value,'rows':[{'name':s.cell(r,2).value,'quantity':s.cell(r,5).value,'price':s.cell(r,6).value,'expected':s.cell(r,17).value} for r in range(33,76)]},ensure_ascii=True))`,file],{encoding:'utf8'}));
const lines=source.rows.map((r,i)=>({lineId:randomUUID(),lineNo:i+1,originalName:r.name,prodKey:i+1,outUnit:'BUNCH',outQuantity:r.quantity,bunchQuantity:r.quantity,unitPrice:r.price,lineAmount:r.price*r.quantity,currency:'CNY'}));
const document={documentId:randomUUID(),revision:1,sourceHash:'a'.repeat(64),orderYear:'2026',orderWeek:'46-02',invoiceNo:'REFERENCE-ONLY',receiptStatus:'INVOICE_PREVIEW',costStatus:'PREVIEW_ONLY',reviewedMetadata:{country:'CN',transportMode:'AIR',farmName:'CLOUD',inputDate:'2026-11-11',gw:source.gw,cw:source.cw},lines,receiptLines:lines};
const input={...CLOUD_COST_FORMULA,formulaApplicabilityConfirmed:true,formulaEffectiveDate:'2026-11-11',nativeCurrency:'CNY',freightCurrency:'CNY',exchangeRateKRW:source.fx,exchangeRateType:'REFERENCE_TEST_ONLY',exchangeRateDate:'2026-11-11',freightAmount:source.freight,customsTotalKRW:source.customs,costSourceId:'REFERENCE_TEST_ONLY',allocationScope:'SINGLE_INVOICE',allocationShareNumerator:1,allocationShareDenominator:1,lineInputs:lines.map(l=>({lineId:l.lineId,categoryCode:matchCloudCategory(l.originalName)}))};
const preview=previewInvoiceCost({...document,costInput:input},lines);
if(preview.status!=='APPROVED')throw Error(JSON.stringify(preview.issues));
const differences=preview.lines.map((l,i)=>({row:i+33,difference:l.costPerUnitKRW-source.rows[i].expected})).filter(l=>Math.abs(l.difference)>1e-6);
console.log(JSON.stringify({sourceRows:lines.length,bunches:lines.reduce((s,l)=>s+l.bunchQuantity,0),differences,totalCost:preview.totals.totalCostKRW,phase:'original-workbook-numeric-comparison-only'}));
if(differences.length)throw Error('Original workbook comparison failed');
input.cloudCustomsMode='FORMULA';
const auto=previewInvoiceCost({...document,costInput:input},lines);
if(auto.status!=='APPROVED'||Math.abs(auto.totals.totalCostKRW-preview.totals.totalCostKRW)>1e-6)throw Error('Automatic customs differs from reference');
const output=await createInvoicePreviewCostWorkbook({document,input});
mkdirSync('private/cloud-reference',{recursive:true});writeFileSync('private/cloud-reference/TEST_ONLY-cloud-reference.xlsx',output);
console.log('Reference calculation workbook exported; not invoice/receipt E2E');
