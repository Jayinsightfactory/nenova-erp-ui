const test = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../lib/profitCustomerMargin.mjs');
const product={ProdKey:1,EstUnit:'단',OutUnit:'박스',BunchOf1Box:15,SteamOf1Box:300,SteamOf1Bunch:20};
const period=(major,props={})=>({year:'2026',major,snapshotExists:true,unitKnown:true,endQuantity:0,receiptQuantity:0,receiptAmount:0,receiptComplete:true,shipQuantity:0,adjustmentQuantity:0,hasPositiveAdjustment:false,...props});
test('explicit year and actual major required; no arrays, subweeks, blank or ISO default',async()=>{
  const {parseMarginScope}=await load(); assert.deepEqual(parseMarginScope('2026','3'),{year:'2026',major:'03'});
  for(const pair of [[undefined,'39'],['2026',['39']],['2026','39-01'],['2026','54'],['2026',''],[['2026'],'39']]) assert.throws(()=>parseMarginScope(...pair));
});
test('same product weighted opening and receipts; adjustments do not become customer COGS',async()=>{
  const {reconstructProductCost}=await load();
  const p=[period(36),period(37,{receiptQuantity:100,receiptAmount:1000,endQuantity:40,shipQuantity:60}),
    period(38,{receiptQuantity:60,receiptAmount:1200,endQuantity:30,shipQuantity:60,adjustmentQuantity:-10})];
  const result=reconstructProductCost({product,periods:p,targetMajor:38});
  assert.equal(result.openingAmount,400);assert.equal(result.unitCost,16);assert.equal(result.receiptAmount,1200);assert.equal(result.status,'VERIFIED');
});
test('missing whole snapshot is NOT zero; real product-absent snapshot can anchor zero',async()=>{
  const {reconstructProductCost}=await load();
  const current=period(38,{receiptQuantity:10,receiptAmount:100,shipQuantity:5,endQuantity:5});
  assert.equal(reconstructProductCost({product,periods:[period(37,{snapshotExists:false,endQuantity:null}),current],targetMajor:38}).unitCost,null);
  assert.equal(reconstructProductCost({product,periods:[period(37),current],targetMajor:38}).unitCost,10);
  assert.equal(reconstructProductCost({product,periods:[period(37,{endQuantity:null}),current],targetMajor:38}).unitCost,null);
});
test('SQL NULL money and VAT are not free sales; explicit zero remains valid',async()=>{
  const {marginMetrics}=await load();const base={kind:'N',prodKey:1,unit:'단',quantity:10,physicalQuantity:10,unitCost:2,vat:0};
  const unknown=marginMetrics([{...base,amount:null,amountMissing:true}]);assert.equal(unknown.netSales,null);assert.equal(unknown.avgNetPrice,null);assert.equal(unknown.marginAmount,null);assert.equal(unknown.coverage.missingAmountRows,1);
  const vat=marginMetrics([{...base,amount:100,vat:null,vatMissing:true}]);assert.equal(vat.avgGrossPrice,null);assert.equal(vat.marginAmount,null);
  const zero=marginMetrics([{...base,amount:0}]);assert.equal(zero.avgNetPrice,0);assert.equal(zero.marginAmount,-20);
});
test('partial receipt, positive adjustment, negative balance, discontinuity or unit conflict cannot be valued',async()=>{
  const {reconstructProductCost}=await load();
  const base=period(38,{receiptQuantity:10,receiptAmount:100,shipQuantity:5,endQuantity:5});
  for(const change of [{receiptComplete:false},{hasPositiveAdjustment:true},{endQuantity:-1},{endQuantity:6},{unitKnown:false},{duplicateStock:true}]) {
    const result=reconstructProductCost({product,periods:[period(37),{...base,...change}],targetMajor:38});assert.equal(result.unitCost,null,JSON.stringify(change));
  }
  assert.equal(reconstructProductCost({product,periods:[period(36),base],targetMajor:38}).unitCost,null);
});
test('receipt evidence must cover exact distinct source IDs and all physical quantity',async()=>{
  const {completeReceiptCoverage}=await load();
  const c={inputRowCount:2,pricedRowCount:2,quantity:30,fullQuantity:30,pricedQuantity:30,units:['박스'],lineKeys:[101,102],allLineKeys:[101,102]};
  assert.equal(completeReceiptCoverage({receiptCoverage:c},[101,102],30),true);
  for(const change of [{lineKeys:[101,101]},{pricedQuantity:20},{fullQuantity:40},{pricedRowCount:1},{units:['박스','단']},{allLineKeys:[101,103]}]) assert.equal(completeReceiptCoverage({receiptCoverage:{...c,...change}},[101,102],30),false);
});
test('future period and other product cannot provide old cost; explicit zero cost remains valid',async()=>{
  const {reconstructProductCost}=await load();
  const rows=[period(37),period(38,{receiptQuantity:10,receiptAmount:0,shipQuantity:5,endQuantity:5}),period(39,{receiptQuantity:100,receiptAmount:10000})];
  assert.equal(reconstructProductCost({product,periods:rows,targetMajor:38}).unitCost,0);
});
test('previous-year same week zero snapshot cannot anchor this year',async()=>{
  const {reconstructProductCost}=await load();
  const rows=[period(37,{year:'2025'}),period(38,{receiptQuantity:10,receiptAmount:100,shipQuantity:5,endQuantity:5})];
  assert.equal(reconstructProductCost({product,periods:rows,targetMajor:38}).unitCost,null);
});
test('a later zero snapshot resets unknown historical value; estimated provenance carries',async()=>{
  const {reconstructProductCost}=await load();
  const rows=[period(35,{endQuantity:20}),period(36),period(37,{receiptQuantity:10,receiptAmount:100,endQuantity:5,shipQuantity:5,estimated:true}),period(38,{shipQuantity:2,endQuantity:3})];
  const r=reconstructProductCost({product,periods:rows,targetMajor:38});assert.equal(r.unitCost,10);assert.equal(r.status,'ESTIMATED');
});
test('physical units convert per product; no mixed global box conversion',async()=>{
  const {marginUnitFactor}=await load();assert.equal(marginUnitFactor(product,'박스','단'),15);assert.equal(marginUnitFactor({...product,BunchOf1Box:10},'박스','단'),10);
  assert.equal(marginUnitFactor({},'박스','단'),null);assert.equal(marginUnitFactor(product,'KG','단'),null);
});
test('VAT-free net margin, VAT-inclusive comparison ASP, physical vs invoice quantities separate',async()=>{
  const {marginMetrics}=await load();const rows=[{kind:'N',prodKey:1,unit:'단',quantity:10,physicalQuantity:9.95,amount:1000,vat:100,unitCost:50},{kind:'L',amount:-20},{kind:'O',amount:10}];
  const r=marginMetrics(rows);assert.equal(r.avgGrossPrice,110);assert.equal(r.avgNetPrice,100);assert.equal(r.costAmount,497.49999999999994);assert.equal(r.netSales,990);assert.ok(r.warnings.some(x=>x.includes('실제 소모')));
});
test('unknown cost and exceptional rows remain explicit, never priced-only margin',async()=>{
  const {marginMetrics}=await load();const r=marginMetrics([{kind:'N',prodKey:1,unit:'단',quantity:10,physicalQuantity:10,amount:1000,unitCost:50},{kind:'N',prodKey:2,unit:'단',quantity:10,physicalQuantity:10,amount:2000,unitCost:null},{kind:'N',prodKey:3,unit:'단',quantity:0,physicalQuantity:0,amount:-50}]);
  assert.equal(r.costAmount,null);assert.equal(r.marginAmount,null);assert.equal(r.knownCostAmount,500);assert.deepEqual(r.coverage.unknownProducts,[2]);assert.equal(r.coverage.exceptionalSales,-50);assert.equal(r.netSales,2950);
});
test('positive quantity with negative sales is excluded from positive selling ASP denominator',async()=>{
 const {marginMetrics}=await load();const common={kind:'N',unit:'단',prodKey:1,quantity:10,physicalQuantity:10,unitCost:1};
 const r=marginMetrics([{...common,amount:100},{...common,amount:-10}]);assert.equal(r.avgNetPrice,10);assert.equal(r.positiveQuantity,10);assert.equal(r.quantity,20);assert.equal(r.coverage.exceptionalSales,-10);assert.equal(r.marginAmount,null);
});
test('all categories/customers retained and units partitioned; customer share uses EstQuantity',async()=>{
  const {buildCustomerMarginGroups}=await load();
  const base={category:'콜롬비아 카네이션',country:'콜롬비아',flower:'카네이션',kind:'N',unit:'단',amount:100,vat:10,physicalQuantity:1,quantity:1};
  const rows=Array.from({length:350},(_,i)=>({...base,prodKey:i+1,custKey:i+1,custName:String(i)}));
  rows.push({...base,prodKey:900,custKey:1,unit:'박스'});
  const groups=buildCustomerMarginGroups({currentRows:rows,previousRows:[],currentCosts:{1:{unitCost:10}},decompose:()=>({})});
  assert.equal(groups.length,2);assert.equal(groups[0].customers.length,350);assert.equal(groups[0].customers[0].current.quantityShare,1/350);
});
