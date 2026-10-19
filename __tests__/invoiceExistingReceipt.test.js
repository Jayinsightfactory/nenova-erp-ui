import test from 'node:test';
import assert from 'node:assert/strict';
import { planExistingReceiptLink } from '../lib/invoiceExistingReceipt.js';

function fixture() {
 const header={WarehouseKey:7662,OrderYear:'2026',OrderWeek:'41-02',FarmName:'Holex',InvoiceNo:'1214205',InputDate:'2026-10-09',isDeleted:0};
 const document={orderYear:'2026',orderWeek:'41-02',invoiceYear:'2026',invoiceNo:'1214205',reviewedMetadata:{country:'NL'},rawMetadata:{freight:10,handling:2},
 lines:[3,7].map((n,i)=>({lineId:`line${i}`,lineNo:i+1,prodKey:100,currency:'EUR',priceUnit:'송이',stemQuantity:n,unitPrice:2,lineAmount:n*2,reviewed:{confirmed:true}}))};
 const details=[{WdetailKey:1,ProdKey:100,ProdName:'Aisha',SteamQuantity:10,UPrice:2,TPrice:20},
 {WdetailKey:2,ProdKey:3100,ProdName:'Gross weight',SteamQuantity:20,UPrice:0,TPrice:0},
 {WdetailKey:3,ProdKey:2182,ProdName:'운송료',SteamQuantity:1,UPrice:12,TPrice:12}];
 return {document,header,details};
}
test('preserves split source rows without multiplying existing receipt quantities',()=>{
 const f=fixture(), before=JSON.stringify(f); const p=planExistingReceiptLink(f.document,f.header,f.details,'Holex');
 assert.equal(p.goodsCount,1); assert.equal(p.sourceCount,2); assert.equal(p.stemQuantity,10);
 assert.deepEqual(p.lineMappings.map(x=>x.outQuantity),[3,7]); assert.deepEqual(p.excludedDetailKeys,[2,3]);
 assert.equal(JSON.stringify(f),before);
});
test('farm trailing whitespace follows SQL text equality without altering stored header',()=>{
 const f=fixture();assert.equal(planExistingReceiptLink(f.document,f.header,f.details,'Holex ').goodsCount,1);
 assert.equal(f.header.FarmName,'Holex');
});
for(const [label,change] of [
 ['prior year',f=>f.header.OrderYear='2025'],['different week',f=>f.header.OrderWeek='42-01'],
 ['invoice year',f=>f.header.InputDate='2025-10-09'],['farm',f=>f.header.FarmName='Other'],
 ['invoice',f=>f.header.InvoiceNo='OTHER'],['deleted',f=>f.header.isDeleted=1],
 ['wrong quantity',f=>f.details[0].SteamQuantity=11],['wrong amount',f=>f.details[0].TPrice=21],
 ['wrong freight',f=>f.details[2].TPrice=13],['unreviewed',f=>f.document.lines[0].reviewed.confirmed=false],
 ['currency',f=>f.document.lines[0].currency='USD'],['unit',f=>f.document.lines[0].priceUnit='단'],
 ['duplicate native',f=>f.details.push({...f.details[0],WdetailKey:4})],
 ['extra native',f=>f.details.push({...f.details[0],ProdKey:101,WdetailKey:4})],
]) test(`rejects ${label}`,()=>{const f=fixture();change(f);assert.throws(()=>planExistingReceiptLink(f.document,f.header,f.details,'Holex'),{code:'EXISTING_RECEIPT_MISMATCH'});});
