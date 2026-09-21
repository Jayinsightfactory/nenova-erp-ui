import test from 'node:test';
import './estimateFreightAtomic.test.js';
import assert from 'node:assert/strict';
import { freightEvidenceRows, freightPriceEvidence, freightPriceSuggestion, freightCategoryFromEvidence } from '../lib/estimateFreightEvidence.js';

test('Youngnam approved defaults override historical prices only for named customer and freight; edits including zero survive', () => {
  const products=[{ProdKey:1,ProdName:'태국 운송료',OutUnit:'박스'},{ProdKey:2,ProdName:'현지상차운임',OutUnit:'박스'},{ProdKey:3,ProdName:'SERVICE FEE',OutUnit:'박스'}];
  const history=[{ProdKey:1,OrderWeek:'37-01',Cost:3000,Quantity:2}];
  const suggest=(customer,key=1)=>freightPriceSuggestion(history,key,'38-01',customer,products);
  assert.equal(suggest({CustName:'(주)영남꽃소재'}).cost,1500);
  assert.equal(suggest({CustName:'영남꽃소재'},2).cost,2000);
  assert.equal(suggest({CustName:'부산 서부꽃집'}).cost,3000);
  assert.equal(suggest({CustName:'인터넷공판장 (영남가빈)'}).cost,3000);
  assert.equal(suggest(undefined).cost,3000);
  assert.equal(suggest({CustName:'영남꽃소재'},3).cost,'');
  for (const cost of [0,'',1750]) assert.equal({...suggest({CustName:'영남꽃소재'}),cost}.cost,cost);
});

test('customer freight evidence excludes cross year, customer, deductions and future weeks', () => {
  const row={OrderYear:'2026',OrderWeek:'36-01',CustKey:12,ProdKey:1,ProdName:'태국 운송료',Quantity:3,Cost:3000,Unit:'박스',EstimateType:'정상출고'};
  const rows=[row,{...row,OrderYear:'2025'},{...row,CustKey:13},{...row,Quantity:-1},{...row,EstimateKey:99},{...row,Descr:'단가차감'},{...row,OrderWeek:'38-01'}];
  assert.deepEqual(freightEvidenceRows(rows,{year:2026,custKey:12,parentWeek:37}),[row]);
  assert.equal(freightPriceEvidence([row],1,'37-01').cost,3000);
  assert.equal(freightPriceEvidence([{...row,Cost:1000}],1,'37-01').cost,1000);
  assert.equal(freightPriceEvidence([],1,'37-01').cost,'');
  assert.equal(freightPriceEvidence([row,{...row,Cost:2000}],1,'37-01').cost,'');
  assert.equal(freightPriceEvidence([row,{...row,OrderWeek:'36-02',Cost:1500}],1,'37-02').cost,1500);
  assert.equal(freightCategoryFromEvidence({CounName:'태국',FlowerName:'덴파레'},[row]),'태국 운송료');
  assert.equal(freightCategoryFromEvidence({CounName:'태국',FlowerName:'덴파레'},[]),'덴파레 운송료');
});
import { freightRowBoxes, freightSourceRows, buildFreightDraftRows, validateFreightDraft, additionalCycleWeek, groupFreightSources, freightDraftGroupIndex } from '../lib/estimateFreightDraft.js';
import { mapExeDetailRowToWebItem, sqlEstimateGetDetail } from '../lib/exeEstimateViewSql.js';
import { combineCarnationFreight, cumulativeFreightRows } from '../lib/estimateFreightDraft.js';

test('approved carnation 30+31 combines once into 01 and preserves other freight scopes', () => {
  const sources=[{sourceKey:'a',OrderWeek:'38-01',outDate:'2026-09-19',boxes:30},{sourceKey:'b',OrderWeek:'38-02',outDate:'2026-09-20',boxes:31}];
  const rows=sources.map(row=>({name:'카네이션 운송료',key:row.sourceKey,weekShort:row.OrderWeek,shipmentDate:row.outDate,sourceKeys:[row.sourceKey],rawBoxes:row.boxes,prodKey:1}));
  const loading={...rows[1],name:'현지상차운임'};
  const result=combineCarnationFreight([...rows,loading],sources,38,'CEIL');
  assert.equal(result.length,2); assert.equal(result[0].qty,61); assert.equal(result[0].weekShort,'38-01');
  assert.equal(result[0].shipmentDate,'2026-09-19'); assert.deepEqual(result[0].sourceKeys,['a','b']);
  assert.equal(result[1],loading);
  assert.equal(freightDraftGroupIndex([{rows:sources}],result[0]),0);
  const options={year:2026,parentWeek:38,custKey:12,products:[{ProdKey:1,ProdName:'카네이션 운송료',OutUnit:'박스'}]};
  assert.equal(validateFreightDraft([{...result[0],cost:3000}],options)[0].week,'2026-38-01');
  assert.throws(()=>validateFreightDraft([{...result[0],cost:3000}],{...options,existing:[{ProdKey:1,OrderWeek:'38-02'}]}),/기존 운임/);
  const missing=combineCarnationFreight(rows.slice(1),sources.slice(1),38,'CEIL')[0];
  assert.throws(()=>validateFreightDraft([{...missing,cost:3000}],options),/출고일/);
  const ambiguous=combineCarnationFreight([...rows,{...rows[0],shipmentDate:'2026-09-21'}],sources,38,'CEIL')[0];
  assert.ok(ambiguous.scopeError);
  const unrelated=combineCarnationFreight(rows,[...sources,{...sources[0],outDate:'2026-09-21'}],38,'CEIL')[0];
  assert.equal(unrelated.shipmentDate,'2026-09-19'); assert.equal(unrelated.scopeError,'');
  assert.equal(combineCarnationFreight(rows,sources,38,'CEIL',false),rows);
  assert.equal(combineCarnationFreight(rows.map(r=>({...r,rawBoxes:0.4})),sources,38,'CEIL')[0].qty,1);
});

test('running boxes follow visual order, exclusions and unknown quantities', () => {
  const rows=[{sourceKey:'a',boxes:1},{sourceKey:'b',boxes:2},{sourceKey:'c',boxes:null},{sourceKey:'d',boxes:3}];
  assert.deepEqual(cumulativeFreightRows(rows).map(r=>[r.cumulativeBoxes,r.cumulativeUnknown]),[[1,0],[3,0],[3,1],[6,1]]);
  assert.deepEqual(cumulativeFreightRows(rows,{b:true,c:true}).map(r=>r.cumulativeBoxes),[1,1,1,4]);
});

test('inline freight has one owner across shared country varieties; scope is unchanged', () => {
  const rows = [{CounName:'중국',FlowerName:'장미',OrderWeek:'37-01',outDate:'2026-09-13',boxes:2},
    {CounName:'중국',FlowerName:'기타',OrderWeek:'37-01',outDate:'2026-09-13',boxes:1}];
  const groups = groupFreightSources(rows);
  const drafts = buildFreightDraftRows(rows,[], 'CEIL');
  assert.deepEqual(drafts.map(d=>freightDraftGroupIndex(groups,d)),[-1,0]);
  assert.equal(drafts[1].qty,3);
  assert.equal(freightDraftGroupIndex(groups,{...drafts[1],weekShort:'37-02'}),-1);
  assert.equal(freightDraftGroupIndex(groups,{...drafts[1],shipmentDate:'2025-09-13'}),-1);
});

test('display groups preserve original subweeks and separate countries; exclusion and unknown subtotals', () => {
  const rows = [
    {sourceKey:'a',CounName:'콜롬비아',FlowerName:'장미',boxes:2,OrderWeek:'37-01'},
    {sourceKey:'b',CounName:'중국',FlowerName:'장미',boxes:3,OrderWeek:'37-01'},
    {sourceKey:'c',CounName:'콜롬비아',FlowerName:'장미',boxes:1,OrderWeek:'37-02'},
    {sourceKey:'d',CounName:'콜롬비아',FlowerName:'장미',boxes:null},
  ];
  const result = groupFreightSources(rows,{a:true});
  assert.deepEqual(result.map(g=>[g.label,g.boxes,g.unknown]),[['콜롬비아 · 장미',1,1],['중국 · 장미',3,0]]);
  assert.equal(result[0].rows[0],rows[0]);
  assert.equal(result[0].rows[1].OrderWeek,'37-02');
  assert.equal(groupFreightSources(rows,{d:true})[0].unknown,0);
  assert.equal(groupFreightSources(rows)[0].boxes,3);
  assert.deepEqual(groupFreightSources([]),[]);
});

test('real EXE detail mapper preserves date quantity and conversion for freight preview', () => {
  const row = mapExeDetailRowToWebItem({ Sort:0, DetailKey:1, ProdKey:2, OrderWeek:'37-01', DateShipQty:2,
    EstQuantity:30, Unit:'단', OutUnit:'박스', BunchOf1Box:15, SteamOf1Box:300 });
  assert.equal(freightRowBoxes(row),2);
  assert.equal(freightRowBoxes({...row,DateShipQty:null}),null);
  assert.equal(freightRowBoxes({...row,DateShipQty:undefined}),null);
  assert.equal(freightRowBoxes({...row,DateShipQty:0}),0);
  assert.equal(freightRowBoxes({...row,DateShipQty:'bad'}),null);
  assert.match(sqlEstimateGetDetail({}), /sd\.ShipmentQuantity AS DateShipQty/);
  const current = freightSourceRows([row,{...row,OrderYear:'2025'}],'2026','37');
  assert.deepEqual(current.map(r=>r.boxes),[2,null]);
});

test('date rows count only that date, not repeated detail totals', () => {
  const base = { SdateKey: 1, DateShipQty: 2, Quantity: 30, Unit: '단', OutUnit: '박스', BoxQty: 8 };
  assert.equal(freightRowBoxes(base), 2);
  assert.equal(freightRowBoxes({ ...base, SdateKey: 2, DateShipQty: 6 }), 6);
  assert.equal(freightRowBoxes({ ...base, OutUnit:'단', DateShipQty:5, BunchOf1Box:15 }), 1/3);
  assert.equal(freightRowBoxes({ ...base, OutUnit:'송이', DateShipQty:30, SteamOf1Box:300, BunchOf1Box:15 }), .1);
  assert.equal(freightRowBoxes({ ...base, OutUnit:'단', BunchOf1Box:0 }), null);
});
test('excludes deductions and existing freight; rejects prior year and other weeks', () => {
  const row = { ProdName:'Rose', OrderWeek:'37-01', Unit:'박스', Quantity:4 };
  const sources = freightSourceRows([row,{...row,EstimateKey:1},{...row,ProdName:'장미 운송료'}, {...row,OrderYear:'2025'},{...row,OrderWeek:'38-01'}], '2026','37');
  assert.equal(sources.length,3);
  assert.deepEqual(sources.map(r=>r.boxes),[4,null,null]);
});
test('source date and subweek preserved; country transport groups round together', () => {
  const sources = [{ boxes:1.2, OrderWeek:'37-01',outDate:'2026-09-13',CounName:'중국',FlowerName:'장미'}, {boxes:.8,OrderWeek:'37-01',outDate:'2026-09-13',CounName:'중국',FlowerName:'기타'}, {boxes:3,OrderWeek:'37-02',outDate:'2026-09-17',CounName:'중국',FlowerName:'장미'}];
  const rows=buildFreightDraftRows(sources,[], 'CEIL');
  assert.deepEqual(rows.map(r=>[r.weekShort,r.name,r.qty]),[['37-01','현지상차운임',2],['37-01','중국 운송료',2],['37-02','현지상차운임',3],['37-02','중국 운송료',3]]);
});
test('validated draft uses selected year/week, positive cost and freight product', () => {
  const options={year:'2026',parentWeek:'37',custKey:12,products:[{ProdKey:1,ProdName:'현지상차운임',OutUnit:'박스'}]};
  const row={weekShort:'37-01',shipmentDate:'2026-09-13',prodKey:1,qty:5,cost:2000};
  assert.equal(validateFreightDraft([row],options)[0].week,'2026-37-01');
  assert.throws(()=>validateFreightDraft([{...row,weekShort:'36-01'}],options));
  assert.throws(()=>validateFreightDraft([{...row,cost:0}],options));
  assert.throws(()=>validateFreightDraft([row,row],options));
  assert.equal(additionalCycleWeek({week:'2026-37-01'},'2026','37'),'37-01');
  assert.equal(additionalCycleWeek({week:'2026-37-02'},'2026','37'),'37-02');
  assert.throws(()=>additionalCycleWeek({week:'2025-37-01'},'2026','37'));
});
