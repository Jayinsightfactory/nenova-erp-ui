import test from 'node:test';
import assert from 'node:assert/strict';
import { planExistingReceiptLink, loadExistingReceiptHeader } from '../lib/invoiceExistingReceipt.js';

const types = { Int: 'int', NVarChar: 'nvarchar' };
test('native receipt without Farm master can be selected and fully reconciled without writes', async () => {
 const f=chinaFixture(); f.document.farmKey=null;
 const calls=[];
 const result=await loadExistingReceiptHeader({types,document:f.document,locked:true,queryFn:async(sql,params)=>{
  calls.push(sql); assert.match(sql,/OrderYear=@year AND OrderWeek=@week/);
  assert.match(sql,/InvoiceNo=@invoice/); assert.match(sql,/YEAR\(InputDate\)=TRY_CONVERT\(int,@invoiceYear\) AND isDeleted=0/);
  assert.match(sql,/WITH \(UPDLOCK,HOLDLOCK\)/); assert.doesNotMatch(sql,/FarmName=@farmName/);
  assert.equal(params.year.value,'2026'); assert.equal(params.invoiceYear.value,'2026');
  return {recordset:[f.header]};
 }});
 assert.equal(calls.length,1); assert.equal(result.farmName,'Holex');
 assert.equal(planExistingReceiptLink(f.document,result.header,f.details,result.farmName).quantity,10);
});
for (const count of [0,2]) test(`missing Farm never selects arbitrarily from ${count} receipts`, async()=>{
 const f=fixture();
 await assert.rejects(loadExistingReceiptHeader({types,document:f.document,queryFn:async()=>({recordset:Array.from({length:count},()=>f.header)})}),{code:'EXISTING_RECEIPT_MISMATCH'});
});
for (const farmKey of [0,123]) test(`explicit invalid Farm ${farmKey} cannot silently fall back to another receipt`,async()=>{
 const f=fixture();f.document.farmKey=farmKey;let calls=0;
 await assert.rejects(loadExistingReceiptHeader({types,document:f.document,queryFn:async sql=>{
  calls++; assert.match(sql,/existing-cost:farm/);return {recordset:[]};
 }}),{code:'EXISTING_RECEIPT_MISMATCH'});assert.equal(calls,1);
});
test('explicit Farm remains a mandatory narrowing filter',async()=>{
 const f=fixture();f.document.farmKey=123;
 const result=await loadExistingReceiptHeader({types,document:f.document,queryFn:async(sql,params)=>{
  if(sql.includes('existing-cost:farm')) return {recordset:[{FarmName:'Holex'}]};
  assert.match(sql,/AND FarmName=@farmName/);assert.equal(params.farmName.value,'Holex');
  return {recordset:[f.header]};
 }});assert.equal(result.farmName,'Holex');
});

function chinaFixture() {
 const f=fixture();
 f.document.reviewedMetadata.country='CN';
 f.document.rawMetadata={additionalCosts:[{amount:10},{amount:2}]};
 f.document.lines.forEach(line=>{line.currency='CNY';line.priceUnit='단';line.bunchQuantity=line.stemQuantity;line.stemQuantity*=10;});
 f.details[0].BunchQuantity=10;
 f.details.push({WdetailKey:4,ProdKey:null,ProdName:null,OutQuantity:null,EstQuantity:null,SteamQuantity:20,UPrice:0,TPrice:0});
 return f;
}
test('CN keeps source stems distinct and links price-basis bunches without modifying native rows',()=>{
 const f=chinaFixture(),before=JSON.stringify(f),p=planExistingReceiptLink(f.document,f.header,f.details,'Holex');
 assert.equal(p.quantity,10);assert.equal(p.quantityUnit,'단');assert.equal(p.stemQuantity,100);
 assert.deepEqual(p.lineMappings.map(x=>[x.outQuantity,x.unit,x.stemQuantity]),[[3,'단',30],[7,'단',70]]);
 assert.deepEqual(p.excludedDetailKeys,[2,3,4]);assert.equal(JSON.stringify(f),before);
});
for(const [label,change] of [
 ['prior year',f=>f.header.OrderYear='2025'],['bunch mismatch',f=>f.details[0].BunchQuantity=100],
 ['missing fees',f=>delete f.document.rawMetadata.additionalCosts],['wrong fees',f=>f.document.rawMetadata.additionalCosts[0].amount=11],
 ['unassigned financial row',f=>f.details[3].TPrice=10],['unassigned stock row',f=>f.details[3].OutQuantity=1],
 ['wrong currency',f=>f.document.lines[0].currency='EUR'],['wrong unit',f=>f.document.lines[0].priceUnit='송이'],
]) test(`CN rejects ${label}`,()=>{const f=chinaFixture();change(f);assert.throws(()=>planExistingReceiptLink(f.document,f.header,f.details,'Holex'),{code:'EXISTING_RECEIPT_MISMATCH'});});

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
