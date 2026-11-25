import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIncomingDetailRows, incomingColumnWidth, incomingCostLabel, incomingFreightPolicy, incomingMasterCosts, incomingQuantityWidth, incomingRowKind, needsReceiptCostLedgerSync } from '../lib/incomingLedgerLayout.js';
import { resolveDocumentDetailFreight } from '../lib/invoiceReceiptWriter.js';
import { readLatestArrivalResponse } from '../lib/latestArrivalResponse.js';
const format=value=>Number(value||0).toLocaleString('ko-KR');

test('incoming widths honor search minimum and grow for actual numbers, subtotal and box suggestion', ()=>{
  assert.equal(incomingColumnWidth(['47-02.A'],{min:132}),132);
  assert.equal(incomingColumnWidth(['최대값'.repeat(30)],{max:280}),280);
  const rows=[{n:992},{n:999},{n:9973}];
  const width=incomingQuantityWidth(rows,'n',format,{label:'송이'});
  assert.equal(width,incomingColumnWidth(['11,964','송이']));
  assert(incomingQuantityWidth([{n:null}],'n',format,{label:'박스',suggestion:()=> '1,234 참고'})>incomingQuantityWidth([{n:1}],'n',format,{label:'박스'}));
  assert.equal(incomingRowKind({ProdKey:2182}),'freight');
  assert.equal(incomingRowKind({ProdKey:3100}),'weight');
  assert.equal(incomingRowKind({IsWeightRow:true}),'weight');
  assert.equal(incomingRowKind({ProdKey:2201}),'goods');
});

test('HTML, login redirects, and invalid JSON produce a stable readable cost status',async()=>{
  const html=new Response('<html>gateway</html>',{status:502,headers:{'Content-Type':'text/html'}});
  await assert.rejects(()=>readLatestArrivalResponse(html),{message:'최신 원가를 불러오지 못했습니다.'});
  const invalid=new Response('<html>',{status:200,headers:{'Content-Type':'application/json'}});
  await assert.rejects(()=>readLatestArrivalResponse(invalid),{message:'최신 원가를 불러오지 못했습니다.'});
  const auth=new Response('<!-- login -->',{status:401,headers:{'Content-Type':'text/html'}});
  await assert.rejects(()=>readLatestArrivalResponse(auth),{message:'로그인을 확인한 뒤 최신 원가를 다시 조회하세요.'});
  const valid=Response.json({success:true,references:{'1|':[{cost:42}]}});
  assert.deepEqual(await readLatestArrivalResponse(valid),{'1|':[{cost:42}]});
});

test('incomingMasterCosts resolves header, detail 3100/3101/2182 and committed document freight without turning null into zero',()=>{
  const mixed=incomingMasterCosts({GrossWeight:100,DetailGrossWeight:99,ChargeableWeight:null,DetailChargeableWeight:125,
    DetailFreightAmount:null,DocFreightAmount:23168,DocFreightCurrency:'CNY'});
  assert.deepEqual(mixed,{gw:100,gwSource:'header',cw:125,cwSource:'detail',freight:23168,freightCurrency:'CNY',freightSource:'document'});
  assert.equal(incomingCostLabel(mixed.freight,mixed.freightCurrency),'23,168 CNY');
  assert.equal(incomingCostLabel(3333.97,'EUR'),'3,333.97 EUR');
  const zeros=incomingMasterCosts({GrossWeight:0,DetailGrossWeight:120,DetailFreightAmount:0,DocFreightAmount:500,DocFreightCurrency:'CNY'});
  assert.equal(zeros.gw,0);assert.equal(zeros.gwSource,'header');
  assert.equal(zeros.freight,0);assert.equal(zeros.freightSource,'detail');assert.equal(incomingCostLabel(zeros.freight),'0');
  const empty=incomingMasterCosts({DocFreightAmount:12.5,DocFreightCurrency:'AUD$'});
  assert.equal(empty.gw,null);assert.equal(incomingCostLabel(empty.gw),'');
  assert.equal(incomingCostLabel(empty.freight,empty.freightCurrency),'12.5');

  // 47-02 Cloudland 8249 & 8250: verified reference GW/CW + document CNY freight
  const c8249=incomingMasterCosts({WarehouseKey:8249,OrderYear:'2026',OrderWeek:'47-02',FarmName:'Cloudland',InvoiceNo:'2026YY-054',
    FileName:'47-2A CLOUD CI.xlsx',DocSourceHash:'fd136fbc2c0e33b58cf72a667a8197b2cb78eb00781b6809f13c0dfc79d2cb0b',DocFreightAmount:23168,DocFreightCurrency:'CNY'});
  assert.deepEqual([c8249.gw,c8249.cw,c8249.freight,c8249.freightCurrency],[1823,2452,23168,'CNY']);
  assert.equal(incomingMasterCosts({WarehouseKey:8249,OrderYear:'2025',OrderWeek:'47-02',FarmName:'Cloudland',InvoiceNo:'2026YY-054',FileName:'47-2A CLOUD CI.xlsx'}).gw,null);
  assert.equal(incomingMasterCosts({WarehouseKey:8249,OrderYear:'2026',OrderWeek:'47-02',FarmName:'Cloudland',InvoiceNo:'2026YY-054',FileName:'47-2A CLOUD CI.xlsx',DocSourceHash:'0'.repeat(64)}).gw,null);

  // 48-01 HUBFRESH 8259: verified sea GW/CW 2523.76, never manufactures estimated freight
  const c8259=incomingMasterCosts({WarehouseKey:8259,OrderYear:'2026',OrderWeek:'48-01',FarmName:'HUBFRESH',InvoiceNo:'XJ-2026-NN012',
    FileName:'C:\\path\\48-01_CN_CLD_XJ-2026-NN012.xlsx'});
  assert.deepEqual([c8259.gw,c8259.cw,c8259.freight],[2523.76,2523.76,null]);

  // 47-02 Holex 8247: freight 3333.97 EUR + docFee 50 EUR = 3383.97 EUR
  assert.equal(resolveDocumentDetailFreight({costInputs:{freight:{amount:3333.97,currency:'EUR'},docFee:{amount:50,currency:'EUR'}}}),3383.97);
  assert.equal(resolveDocumentDetailFreight({unclassifiedAdditionalCharges:{amount:23168,currency:'CNY'}}),23168);
  assert.equal(resolveDocumentDetailFreight({unclassifiedAdditionalCharges:{amount:0,currency:'USD'}}),null);

  // Sync predicate flags missing Detail rows, excludes C&F & forwarder-billed farm receipts, and respects native-cost-source-evidence
  assert.equal(needsReceiptCostLedgerSync({WarehouseKey:8247,OrderYear:'2026',OrderWeek:'47-02',GoodsCountry:'네덜란드',GrossWeight:1123.7,ChargeableWeight:1249,DocFreightAmount:3383.97,DocFreightCurrency:'EUR'}),true);
  assert.equal(needsReceiptCostLedgerSync({WarehouseKey:8260,OrderYear:'2026',OrderWeek:'48-01',GoodsCountry:'네덜란드',DetailGrossWeight:2784,DetailChargeableWeight:3364,DetailFreightAmount:30976}),false);
  assert.equal(needsReceiptCostLedgerSync({WarehouseKey:8160,OrderYear:'2026',OrderWeek:'46-02',GoodsCountry:'중국',GrossWeight:2543,ChargeableWeight:2543,OrphanGrossWeight:2543,OrphanChargeableWeight:2543,DetailFreightAmount:24087}),false);
  assert.equal(needsReceiptCostLedgerSync({WarehouseKey:8252,OrderYear:'2026',OrderWeek:'47-01',FarmName:'Premium Greens',GoodsCountry:'호주',GrossWeight:120}),false);
  assert.equal(needsReceiptCostLedgerSync({WarehouseKey:8248,OrderYear:'2026',OrderWeek:'47-01',FarmName:'NZ Blooms',GoodsCountry:'뉴질랜드'}),false);
  assert.equal(needsReceiptCostLedgerSync({WarehouseKey:8162,OrderYear:'2026',OrderWeek:'47-02',FarmName:'Balverde',GoodsCountry:'콜롬비아',GrossWeight:489.9}),false);
  assert.equal(needsReceiptCostLedgerSync({WarehouseKey:7345,OrderYear:'2026',OrderWeek:'38-01',FarmName:'Super Fresh',GoodsCountry:'태국',DocAction:'LINK_EXISTING_COST',DocGrossWeight:146,DocChargeableWeight:228.5}),false);
  assert.equal(needsReceiptCostLedgerSync({WarehouseKey:7474,OrderYear:'2026',OrderWeek:'39-01',FarmName:'EXCEL',GoodsCountry:'태국',OrphanGrossWeight:209,OrphanChargeableWeight:270.5,DetailFreightAmount:772.315}),true);

  // Freight policy badges: C&F vs forwarder-separate vs separate vs missing
  assert.equal(incomingFreightPolicy({FarmName:'Premium Greens',GoodsCountry:'호주'}).freightBadge,'품목단가 운임포함 (C&F)');
  assert.equal(incomingFreightPolicy({FarmName:'NZ Blooms',GoodsCountry:'뉴질랜드'}).freightBadge,'품목단가 운임포함 (C&F)');
  assert.equal(incomingFreightPolicy({FarmName:'Hood Canal',GoodsCountry:'미국'}).freightBadge,'품목단가 운임포함 (C&F)');
  assert.equal(incomingFreightPolicy({FarmName:'Royal Base',GoodsCountry:'베트남'}).freightBadge,'품목단가 운임포함 (C&F)');
  assert.equal(incomingFreightPolicy({FarmName:'Balverde',GoodsCountry:'콜롬비아'}).freightBadge,'포워더 별도정산');
  assert.equal(incomingFreightPolicy({FarmName:'Super Fresh',GoodsCountry:'태국'}).freightBadge,'포워더 별도정산');
  assert.equal(incomingFreightPolicy({FarmName:'Apollo',GoodsCountry:'콜롬비아'}).freightBadge,'운송료 미기재');
  assert.equal(incomingRowKind({ProdKey:2256,ProdName:'네덜란드 운송료'}),'freight');

  // Orphan weigth-typo rows recover GW/CW and detail bottom rows render consistently
  const c8160=incomingMasterCosts({WarehouseKey:8160,OrphanGrossWeight:2543,OrphanChargeableWeight:2543,DetailFreightAmount:24087});
  assert.deepEqual([c8160.gw,c8160.cw,c8160.freight],[2543,2543,24087]);
  const detail8249=buildIncomingDetailRows([{WdetailKey:1,ProdKey:2157,ProdName:'MISTY CHINA',BoxQuantity:2,BunchQuantity:20,SteamQuantity:200,단가:10,총액:200}],c8249);
  assert.deepEqual(detail8249.map(r=>[r.ProdKey,r.DisplayName||r.ProdName,r.SteamQuantity,r.총액]),[
    [2157,'MISTY CHINA',200,200],[2182,'운송료 (CNY)',1,23168],[3100,'Gross weight',1823,0],[3101,'Chargeable weight',2452,0],
  ]);
  const detail8259=buildIncomingDetailRows([
    {WdetailKey:1,ProdKey:2201,ProdName:'ROSE CHINA',BoxQuantity:1,BunchQuantity:10,SteamQuantity:100,단가:3,총액:30},
    {WdetailKey:2,ProdKey:null,BoxQuantity:1,BunchQuantity:1,SteamOf1Box:1,SteamOf1Bunch:1,SteamQuantity:0,OutQuantity:null,UPrice:0,TPrice:0},
    {WdetailKey:3,ProdKey:null,BoxQuantity:1,BunchQuantity:1,SteamOf1Box:1,SteamOf1Bunch:1,SteamQuantity:0,OutQuantity:null,UPrice:0,TPrice:0},
  ],c8259);
  assert.deepEqual(detail8259.map(r=>[r.ProdKey,r.ProdName,r.SteamQuantity]),[[2201,'ROSE CHINA',100],[3100,'Gross weight',2523.76],[3101,'Chargeable weight',2523.76]]);
});
