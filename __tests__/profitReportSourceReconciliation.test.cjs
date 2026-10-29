const test=require('node:test');const assert=require('node:assert/strict');
const make=()=>({year:'2026',major:'39',report:{orderYear:'2026',major:'39',rows:[{category:'태국',calc:{Q:100}}],forwardingReconciliation:{sourceRows:[{orderYear:'2026',orderWeek:'39-01',warehouseKey:2,warehouseDetailKey:12,amount:20}],totalsByCurrency:{USD:{delta:0}},unmatchedRows:[],missingExpectedScopes:[]}},receiptRows:[{OrderYear:'2026',OrderWeek:'39-01',WarehouseKey:1,WdetailKey:11,Category:'태국',TPrice:100,IsStockable:true},{OrderYear:'2026',OrderWeek:'39-01',WarehouseKey:2,WdetailKey:12,TPrice:20,IsFreight:true}]});
test('positive exact scope/raw totals match, FX/customs not certified',async()=>{const{reconcileProfitReportSources:f}=await import('../lib/profitReportSourceReconciliation.mjs');const r=f(make());assert.equal(r.status,'matched');assert.equal(r.coverage.Q,true);assert.equal(r.coverage.R,false);assert.equal(r.coverage.H,false);});
for(const [name,mutate,code]of [
 ['cross year',a=>a.receiptRows[0].OrderYear='2025','SOURCE_CROSS_SCOPE'],
 ['cross week',a=>a.receiptRows[0].OrderWeek='38-01','SOURCE_CROSS_SCOPE'],
 ['null amount',a=>a.receiptRows[0].TPrice=null,'SOURCE_AMOUNT_MISSING'],
 ['duplicate raw key',a=>a.receiptRows.push({...a.receiptRows[0]}),'SOURCE_DUPLICATE_KEY'],
 ['missing freight source',a=>a.report.forwardingReconciliation.sourceRows=[],'SOURCE_FREIGHT_ROW_MISSING'],
 ['duplicate freight source',a=>a.report.forwardingReconciliation.sourceRows.push({...a.report.forwardingReconciliation.sourceRows[0]}),'SOURCE_FREIGHT_DUPLICATE'],
 ['stale purchase',a=>a.report.rows[0].calc.Q=90,'SOURCE_PURCHASE_DIFF'],
 ['stale freight',a=>a.report.forwardingReconciliation.sourceRows[0].amount=21,'SOURCE_FREIGHT_AMOUNT_DIFF'],
 ['freight unknown currency',a=>a.report.forwardingReconciliation.totalsByCurrency={UNKNOWN:{delta:0}},'SOURCE_FREIGHT_CURRENCY_DIFF'],
 ['freight currency absent',a=>delete a.report.forwardingReconciliation.totalsByCurrency,'SOURCE_FREIGHT_CURRENCY_MISSING'],
 ['expected freight missing',a=>a.report.forwardingReconciliation.missingExpectedScopes=[{category:'미국',orderWeek:'39-01'}],'SOURCE_FREIGHT_EXPECTED_MISSING'],
 ['scope not supplied',a=>delete a.report.orderYear,'SOURCE_SCOPE_MISSING'],
 ['query result absent',a=>delete a.receiptRows,'SOURCE_SCOPE_MISSING'],
 ['ledger absent',a=>delete a.report.forwardingReconciliation,'SOURCE_FREIGHT_EVIDENCE_MISSING'],
 ['receipt unit conflict',a=>Object.assign(a.receiptRows[0],{OutUnit:'박스',OutQuantity:8,BunchQuantity:120,BunchOf1Box:30}),'SOURCE_UNIT_CONFLICT'],
 ['positive adjustment uncosted',a=>a.adjustmentRows=[{OrderYear:'2026',OrderWeek:'39-01',Category:'태국',Quantity:1}],'SOURCE_POSITIVE_ADJUSTMENT_COST_UNVERIFIED'],
 ['adjustment missing quantity',a=>a.adjustmentRows=[{OrderYear:'2026',OrderWeek:'39-01',Category:'태국',Quantity:null}],'SOURCE_ADJUSTMENT_AMOUNT_MISSING'],
 ['adjustment cross year',a=>a.adjustmentRows=[{OrderYear:'2025',OrderWeek:'39-01',Category:'태국',Quantity:1}],'SOURCE_CROSS_SCOPE'],
])test(name,async()=>{const{reconcileProfitReportSources:f}=await import('../lib/profitReportSourceReconciliation.mjs');const a=make();mutate(a);const r=f(a);assert.equal(r.status,'incomplete');assert.ok(r.issues.some(x=>x.code===code));});
test('explicit zero is present, not null',async()=>{const{reconcileProfitReportSources:f}=await import('../lib/profitReportSourceReconciliation.mjs');const a=make();a.receiptRows[0].TPrice=0;a.report.rows[0].calc.Q=0;assert.equal(f(a).status,'matched');});
test('zero-padded and unpadded major scopes accepted',async()=>{const{reconcileProfitReportSources:f}=await import('../lib/profitReportSourceReconciliation.mjs');for(const week of ['09-01','9-01']){const a=make();a.major='9';a.report.major='09';a.receiptRows.forEach(r=>r.OrderWeek=week);a.report.forwardingReconciliation.sourceRows[0].orderWeek=week;assert.equal(f(a).status,'matched');assert.equal(f(a).coverage.currency,false);}});
