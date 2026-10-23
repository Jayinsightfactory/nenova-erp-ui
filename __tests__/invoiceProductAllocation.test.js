import test from 'node:test';
import assert from 'node:assert/strict';
import { allocationIssues, applyInvoiceAllocation, needsInvoiceAllocation } from '../lib/invoiceProductAllocation.js';
import { adaptPackingReceipts } from '../lib/importPackingReceiptAdapter.js';
import { upsertPackingErpMatch } from '../lib/importPackingErpMatches.js';
import { makeProductResolver } from '../lib/importPacking.js';
import { validateInvoiceReceiptLines } from '../lib/invoiceReceiptValidation.js';
import { packingReceiptMatchState } from '../lib/packingReceiptMatchState.js';
const products=[{ProdKey:2997,ProdName:'Wolly Bush Green Tip',country:'AU',CounName:'호주',selectable:true,isDeleted:0,OutUnit:'단',EstUnit:'단'},
  {ProdKey:2998,ProdName:'Wolly Bush Red Tip',country:'AU',CounName:'호주',selectable:true,isDeleted:0,OutUnit:'단',EstUnit:'단'}];
async function fixture(year='2026',hash='a'){
  return (await adaptPackingReceipts({country:'AU',fileName:`${year} 41-1.xlsx`,sourceHash:hash.repeat(64),products,reviewConfirmed:true,
    invoices:[{invoice:'40927',date:`${year}/10/01`,currency:'USD',products:[{description:'Woolly bush 5',pcs:7,total_bunch:210,total_stems:1050,u_price:8.5,t_price:1785}]}],excels:[{products:[]}]}))[0];
}
function split(doc){const base=doc.lines[0];return [{...base,prodKey:2997,boxQuantity:5,bunchQuantity:150,stemQuantity:750,lineAmount:1275},
  {...base,lineId:'b7d3e870-13cc-4cbd-a823-50a57b1ea414',prodKey:2998,boxQuantity:2,bunchQuantity:60,stemQuantity:300,lineAmount:510}];}
test('AU spelling variants always need file allocation; other countries unaffected',()=>{
  for(const name of ['Woolly bush 5','Wolly Bush Red Tip','Wooly bush'])assert.equal(needsInvoiceAllocation('AU',name),true);
  assert.equal(needsInvoiceAllocation('US','Woolly bush'),false);
  assert.throws(()=>upsertPackingErpMatch(null,{country:'AU',description:'Woolly bush 5',prodKey:2997},products),/파일별/);
  const resolve=makeProductResolver('AU',{byCountry:{AU:[{name:products[0].ProdName}]}},{'woolly bush 5':products[0].ProdName},{pending:[],noMatches:[]});
  assert.equal(resolve({description:'Woolly bush 5'},0).unmatched,true);
});
test('fresh file never inherits approval; split preserves all four totals and original',async()=>{
  const doc=await fixture();const original=JSON.stringify(doc);
  assert.ok(allocationIssues(doc).length);
  const next=applyInvoiceAllocation(doc,doc.lines[0].lineId,split(doc),products);
  assert.deepEqual(allocationIssues(next,products),[]);assert.equal(JSON.stringify(doc),original);
  assert.equal(next.lines.length,2);assert.equal(next.lines[1].lineNo,2);
  assert.ok(allocationIssues(await fixture('2025','b')).length);
  assert.ok(allocationIssues(await fixture('2026','c')).length);
});
test('missing/negative/changed totals and invalid country rejected, explicit zero preserved',async()=>{
  const doc=await fixture(),id=doc.lines[0].lineId;
  for(const field of ['boxQuantity','bunchQuantity','stemQuantity','lineAmount']){
    for(const value of [null,-1,999]){const rows=split(doc);rows[0][field]=value;assert.throws(()=>applyInvoiceAllocation(doc,id,rows,products));}
  }
  const wrong=split(doc);wrong[0].prodKey=5;assert.throws(()=>applyInvoiceAllocation(doc,id,wrong,products),/전산 품목/);
  const zero=split(doc);for(const field of ['boxQuantity','bunchQuantity','stemQuantity','lineAmount']){zero[0][field]=doc.lines[0][field];zero[1][field]=0;}
  assert.equal(applyInvoiceAllocation(doc,id,zero,products).lines[1].lineAmount,0);
});
test('server validation rejects later quantity edits and removed allocation evidence',async()=>{
  const doc=await fixture();const next=applyInvoiceAllocation(doc,doc.lines[0].lineId,split(doc),products);
  next.lines[0].bunchQuantity=149;
  assert.ok(validateInvoiceReceiptLines(next,products).issues.some(i=>i.code==='PRODUCT_ALLOCATION_REQUIRED'));
  delete next.rawMetadata.allocationSources;
  assert.ok(validateInvoiceReceiptLines(next,products).issues.some(i=>i.code==='PRODUCT_ALLOCATION_REQUIRED'));
});
test('split document remains valid for header status without pretending generated rows changed',async()=>{
  const doc=await fixture();
  const next=applyInvoiceAllocation(doc,doc.lines[0].lineId,split(doc),products);
  const invoices=[{invoice:'40927',date:'2026/10/01',currency:'USD',products:[{description:'Woolly bush 5',pcs:7,total_bunch:210,total_stems:1050,u_price:8.5,t_price:1785}]}];
  const excels=[{sourceInvoiceIdentity:doc.rawMetadata.sourceInvoiceIdentity,products:[]}],file={name:'test.xlsx'};
  const snapshot={file,excels,invoices,country:'AU',sourceHash:doc.sourceHash,records:[{document:next}]};
  const status=packingReceiptMatchState({snapshot,file,excels,invoices,country:'AU',products});
  assert.equal(status.valid,true);assert.equal(status.documentTotal,2);assert.equal(status.documentPending,0);
  assert.equal(status.allocationPending,0);assert.equal(status.overlayComplete,false);
  next.lines[0].stemQuantity=749;
  assert.ok(packingReceiptMatchState({snapshot,file,excels,invoices,country:'AU',products}).allocationPending>0);
});
