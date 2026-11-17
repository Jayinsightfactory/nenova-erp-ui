const assert=require('node:assert/strict');
(async()=>{
 const {mixedFreightDeltas,applyMixedFreightView,assertFreightConservationForCache}=await import('../lib/profitMixedFreightView.js');
 assert.throws(()=>assertFreightConservationForCache({forwardingReconciliation:{unmatchedRows:[{amount:10}]}}),{code:'PROFIT_FREIGHT_UNMAPPED'});
 assert.throws(()=>assertFreightConservationForCache({forwardingReconciliation:{classificationDelta:1}}),{code:'PROFIT_FREIGHT_UNMAPPED'});
 assert.doesNotThrow(()=>assertFreightConservationForCache({forwardingReconciliation:{unmatchedRows:[],classificationDelta:0,totalsByCurrency:{USD:{delta:0}}}}));
 const old={orderYear:'2026',orderWeek:'42-01',warehouseKey:99,warehouseDetailKey:7,awb:'123-456',amount:100};
 const row={category:'콜롬비아 수국',manual:{},auto:{S:0},calc:{S:0,Q:100,R:10,G:1000,T:0,E:100,F:200,H:50,C:2000,I:950,J:1050,K:.525},inventoryValuation:{begin:{value:100},end:{method:'category_average',value:200,quantity:2,average:{purchaseQty:10,unitCost:100,totalCost:1000,forwardingForeign:0}}}};
 const payload={orderYear:'2026',major:'42',rows:[row],totals:{...row.calc},forwardingReconciliation:{unmatchedRows:[old]},colombiaAllocationEvidence:[{orderWeek:'42-01',erpWeight:{sources:[{awb:'123456',pooledWithHydrangea:true}]},boxQty:{'콜롬비아 수국':1},allocationRates:{BoxWeight_콜롬비아수국:5,BoxCBM_콜롬비아수국:7},weightBasis:'GW'}]};
 const before=JSON.stringify(payload),ledger={classifiedRows:[{...old,category:'콜롬비아 4품목'}]};
 const delta=mixedFreightDeltas(payload,ledger,{orderYear:'2026',major:42});assert.equal(delta[row.category].G,1000);assert.equal(delta[row.category].F,200);
 const out=applyMixedFreightView(payload,delta);assert.equal(out.rows[0].calc.J,250);assert.equal(out.rows[0].calc.F,400);assert.equal(out.totals.J,250);assert.equal(JSON.stringify(payload),before);
 assert.deepEqual(applyMixedFreightView(out,delta),out);
 const adjusted=structuredClone(payload);adjusted.rows[0].calc.J+=17;
 assert.equal(applyMixedFreightView(adjusted,delta).rows[0].calc.J,267,'preserve independent profit adjustment');
 const next=structuredClone(payload);next.rows[0].calc.E=200;next.rows[0].inventoryValuation.begin.value=200;
 const carry=applyMixedFreightView(next,{}, {[row.category]:{F:200,originalF:200}});assert.equal(carry.rows[0].calc.E,400);
 for(const change of [p=>p.rows[0].manual.S=0,p=>p.rows[0].manual.F=0,p=>p.rows[0].inventoryValuation.end.method='fifo']){
  const p=structuredClone(payload);change(p);assert.deepEqual(mixedFreightDeltas(p,ledger,{orderYear:'2026',major:42}),{});
 }
 assert.deepEqual(mixedFreightDeltas(payload,ledger,{orderYear:'2025',major:42}),{});
 assert.deepEqual(mixedFreightDeltas(payload,{classifiedRows:[{...ledger.classifiedRows[0],amount:101}]},{orderYear:'2026',major:42}),{});
 console.log('Mixed freight display: PASS (verified-source-only, amount conservation, opening carry, immutable/idempotent, manual zero/year guards)');
})().catch(e=>{console.error(e);process.exitCode=1});
