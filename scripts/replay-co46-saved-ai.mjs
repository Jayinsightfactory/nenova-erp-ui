// Offline replay only. No network/provider/ERP connection.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {mergePackingChunks} from '../lib/importPackingPdfChunks.js';
import {parsePackingResponse} from '../lib/importPackingResponse.js';
import {resolveInvoiceHeader} from '../lib/invoiceReceiptAutoFill.js';
import {receiptSourceDate} from '../lib/packingReceiptDatePolicy.js';
import {invoiceDateYear} from '../lib/invoiceReceiptYear.js';
const root=process.env.NENOVA_CO46_SAVED_ROOT;
assert.ok(root,'NENOVA_CO46_SAVED_ROOT required');
const chunks=Array.from({length:6},(_,i)=>JSON.parse(fs.readFileSync(path.join(root,'fresh-ai',`segment-${i+1}.parsed.json`),'utf8')));
const merged=mergePackingChunks(chunks,16);
const {result,wasTruncated}=parsePackingResponse(merged,'CO');assert.equal(wasTruncated,false);
const farms=JSON.parse(fs.readFileSync(path.join(root,'master-catalog.json'),'utf8')).farms;
const lines=result.invoices.flatMap(i=>i.products);
assert.equal(result.invoices.length,16);assert.equal(lines.length,46);
assert.equal(lines.reduce((n,l)=>n+l.pcs,0),662);
assert.equal(lines.reduce((n,l)=>n+l.total_stems,0),19960);
assert.ok(Math.abs(lines.reduce((n,l)=>n+l.t_price,0)-13366.76)<.001);
for(const i of result.invoices){
 assert.equal(receiptSourceDate(i),'2026-11-06',`adapter date ${i.invoice}`);
 assert.equal(invoiceDateYear(i),'2026',`adapter year ${i.invoice}`);
 const r=resolveInvoiceHeader({orderYear:'2026',reviewedMetadata:{awb:i.awb},rawMetadata:{supplier:i.supplier,invoiceDate:i.date,rawDate:i.raw_date}},farms);
 assert.ok(r.farm,`farm ${i.invoice}`);assert.equal(r.inputDate,'2026-11-06');assert.equal(r.transportMode,'AIR');assert.deepEqual(r.issues,[]);
 for(const line of i.products)assert.ok(Number.isFinite(line.bunch_st)&&line.bunch_st>0);
}
fs.mkdirSync('.verify',{recursive:true});
fs.writeFileSync('.verify/co46-saved-merged.json',JSON.stringify(merged));
console.log('OFFLINE_SAVED_AI_PASS invoices=16 rows=46 boxes=662 stems=19960 goodsUSD=13366.76 headers=16 paidCalls=0');
