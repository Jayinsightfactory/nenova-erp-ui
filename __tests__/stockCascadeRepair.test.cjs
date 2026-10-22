const {test}=require('node:test');const assert=require('node:assert/strict');
const helper=import('../lib/stockCascadeRepair.mjs');
function fixture(){return {
  masters:[{StockKey:1,OrderYear:'2025',OrderWeek:'19-01',OrderYearWeek:'20251901'},
    {StockKey:2,OrderYear:'2026',OrderWeek:'18-02',OrderYearWeek:'20261802'},
    {StockKey:3,OrderYear:'2026',OrderWeek:'19-01',OrderYearWeek:'20261901'},
    {StockKey:4,OrderYear:'2027',OrderWeek:'01-01',OrderYearWeek:'20270101'}],
  stocks:[{StockKey:1,ProdKey:3074,Stock:99},{StockKey:2,ProdKey:3074,Stock:352},{StockKey:3,ProdKey:3074,Stock:520},{StockKey:4,ProdKey:3074,Stock:520}],
  products:[{ProdKey:3074,Stock:8,isDeleted:0}],incoming:[{OrderYear:'2026',OrderWeek:'19-01',ProdKey:3074,OutQuantity:688}],
  outgoing:[{OrderYear:'2026',OrderWeek:'19-01',ProdKey:3074,OutQuantity:352}],
  adjustments:[{OrderYear:'2026',OrderWeek:'19-01',ProdKey:3074,BeforeValue:0,AfterValue:12,TypeMatches:1}],
  protected:{orders:'unchanged',reports:'unchanged'},procedureHash:'unchanged',
};}
const scope={year:'2026',startWeek:'19-01',prodKeys:[3074]};
test('deleted fixed shipment 180 restores 700 and carries across year; prior year protected',async()=>{
  const {planStockCascadeRepair,verifyStockCascadeRepair}=await helper;const before=fixture(),plan=planStockCascadeRepair(before,scope);
  assert.deepEqual(plan.expected.map(r=>r.after),[700,700]);
  const after=structuredClone(before);after.stocks[2].Stock=700;after.stocks[3].Stock=700;
  assert.equal(verifyStockCascadeRepair(before,after,plan).changedSnapshots,2);
  after.stocks[0].Stock=700;assert.throws(()=>verifyStockCascadeRepair(before,after,plan),/READBACK/);
});
test('Netherlands +188 history persists and flows forward, no duplicate adjustment',async()=>{
  const {planStockCascadeRepair}=await helper;const state=fixture();state.stocks[1].Stock=188;state.incoming=[];state.outgoing=[];state.adjustments=[];
  assert.deepEqual(planStockCascadeRepair(state,scope).expected.map(r=>r.after),[188,188]);
});
for(const field of ['products','adjustments','protected','procedureHash'])test(`repair preserves ${field}`,async()=>{
  const {planStockCascadeRepair,verifyStockCascadeRepair}=await helper;const before=fixture(),after=structuredClone(before);
  after[field]=null;assert.throws(()=>verifyStockCascadeRepair(before,after,planStockCascadeRepair(before,scope)),/PROTECTED_CHANGED/);
});
for(const [name,mutate,pattern] of [
  ['missing row',s=>s.stocks.pop(),/STOCK_MISSING/],
  ['duplicate master',s=>s.masters.push({...s.masters[2],StockKey:5}),/MASTER_AMBIGUOUS/],
  ['history mapping',s=>s.adjustments[0].TypeMatches=2,/HISTORY_AMBIGUOUS/],
  ['new negative',s=>s.outgoing[0].OutQuantity=2000,/NEW_NEGATIVE/],
  ['legacy unreviewed',s=>{s.masters[3].OrderWeek='34-02A';s.masters[3].OrderYearWeek='20273402A';},/LEGACY_REVIEW/],
])test(name,async()=>{const {planStockCascadeRepair}=await helper;const state=fixture();mutate(state);assert.throws(()=>planStockCascadeRepair(state,scope),pattern);});
test('acknowledged empty legacy node participates, movement blocks replay',async()=>{
  const {planStockCascadeRepair}=await helper;const state=fixture();state.masters[3].OrderWeek='34-02A';state.masters[3].OrderYearWeek='20273402A';
  const explicit={...scope,nativeLegacyPeriods:['2027/34-02A']};assert.equal(planStockCascadeRepair(state,explicit).expected[1].after,700);
  state.outgoing.push({OrderYear:'2027',OrderWeek:'34-02A',ProdKey:3074,OutQuantity:1});assert.throws(()=>planStockCascadeRepair(state,explicit),/LEGACY_MOVEMENT/);
});
