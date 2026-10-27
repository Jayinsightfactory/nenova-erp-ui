import test from 'node:test';
import assert from 'node:assert/strict';
import { allocationIssues, applyInvoiceAllocation, needsInvoiceAllocation } from '../lib/invoiceProductAllocation.js';
import { adaptPackingReceipts } from '../lib/importPackingReceiptAdapter.js';
import { upsertPackingErpMatch } from '../lib/importPackingErpMatches.js';
import { makeProductResolver } from '../lib/importPacking.js';
import { validateInvoiceReceiptLines } from '../lib/invoiceReceiptValidation.js';
import { packingReceiptMatchState } from '../lib/packingReceiptMatchState.js';
import { buildPackingMatchPreview } from '../lib/importPackingMatchPreview.js';
import { packingSourceKey } from '../lib/importPacking.js';
import { makePackingSourceReview, applyPackingSourceReview } from '../lib/importPackingSourceReview.js';
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

test('44-01 AU saved nine matches reuse while two Woolly source rows keep independent quantities', async () => {
  // Product table only, transcribed from the supplied invoice/stored extraction.
  // No customer, account, credentials or live DB connection in this replay.
  const data = [
    ['Barker bush x 5 (5 stems/bunch)',251,'Banker Bush',20,500,5,14.5],
    ['Emu feather™ (10 stems/bunch)',717,'Emu Feather',2,200,10,4.05],
    ['Emu grass x 10 (10 stems/bunch)',823,'Emu Grass',2,100,10,7],
    ['Koala fern™ 80cm (10 stems/bunch)',719,'Koala Fern',5,250,10,4.8],
    ['Leptospermum (10 stems/bunch)',2999,'Copper Glow',4,120,10,8.5],
    ['Sea Star fern™ (10 stems/bunch)',721,'Fern Sea Star',1,50,10,6.65],
    ['Steel grass (Premium) 120cm (x50) (50 stems/bunch)',824,'Steel Grass',2,240,50,3.5],
    ['Stenocarpus (80cm) x 10st (10 stems/bunch)',1742,'Stenocarpus',13,325,10,11.25],
    ['Umbrella fern (10 stems/bunch)',723,'Fern Umbrella',6,300,10,6.95],
  ];
  const catalog = [...data.map(([,ProdKey,ProdName]) => ({ProdKey,ProdName,country:'AU',CounName:'호주',selectable:true})),...products];
  const entries = data.map(([description,prodKey,prodName]) => ({country:'AU',description,sourceKey:packingSourceKey(description),prodKey,prodName}));
  const rows = data.map(([description,,,pcs,total_bunch,bunch_st,u_price]) => ({description,pcs,total_bunch,bunch_st,u_price,t_price:total_bunch*u_price}));
  rows.push({description:'Woolly bush (5 stems/bunch)',pcs:6,total_bunch:180,bunch_st:5,u_price:8.5,t_price:1530},
    {description:'Woolly bush (5 stems/bunch)',pcs:4,total_bunch:120,bunch_st:5,u_price:8.5,t_price:1020});
  const raw = {invoice:'41002',date:'2026/10/26',currency:'AUD',products:rows,pdfSourceHash:'d'.repeat(64)};
  const review = makePackingSourceReview(raw,'AU');
  review.pdf = {rendered:true,page:1};
  review.rows = review.rows.map(row=>({...row,confirmed:true,reason:'TEST_ONLY 상품표 대조 fixture'}));
  const invoice = applyPackingSourceReview(raw,review,'AU','2026-10-27T00:00:00.000Z');
  const preview = buildPackingMatchPreview({invoices:[invoice],country:'AU',erpMatches:{products:catalog,value:{version:1,entries}}});
  assert.deepEqual(preview[0].products.map(p=>p.matchReview.status),[...Array(9).fill('MANUAL'),'ALLOCATION','ALLOCATION']);
  const [doc] = await adaptPackingReceipts({country:'AU',fileName:'44-01 호주 CI.pdf',sourceHash:'d'.repeat(64),products:catalog,
    reviewConfirmed:true,invoices:[invoice],excels:preview});
  let classified = doc;
  for (const [index,prodKey] of [[9,2997],[10,2998]]) {
    const line = classified.lines[index];
    classified = applyInvoiceAllocation(classified,line.lineId,[{...line,prodKey}],catalog);
  }
  assert.deepEqual(allocationIssues(classified,catalog),[]);
  assert.deepEqual(classified.lines.slice(9).map(l=>[l.prodKey,l.boxQuantity,l.bunchQuantity,l.stemQuantity,l.lineAmount]),
    [[2997,6,180,900,1530],[2998,4,120,600,1020]]);
  assert.equal(classified.lines.reduce((n,l)=>n+l.boxQuantity,0),65);
  assert.equal(classified.lines.reduce((n,l)=>n+l.lineAmount,0),20443.75);
});
