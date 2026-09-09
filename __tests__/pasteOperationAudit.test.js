const assert = require('node:assert/strict');
async function main() {
  const { actionLogPayload } = await import('../lib/pasteOperationAudit.js');
  const entries = Array.from({length: 116}, (_, i) => ({type:i % 2 ? 'ADD' : 'CANCEL', custKey:13, prodKey:i+1, custName:'라움', prodName:'품목 '+i, qty:0.5, unit:'단', editGuard:{leaseToken:'SECRET'}}));
  const raw = actionLogPayload('SHIPMENT_ADJUST_BATCH', {year:'2026',week:'36-01',entries, token:'SECRET'}, {committedCount:116,verified:true});
  assert.ok(raw.length > 4000);
  assert.equal(raw.includes('SECRET'),false);
  const data = JSON.parse(raw);
  assert.equal(data.entries.length,116); assert.equal(data.entries[115].qty,0.5);
  assert.equal(data.year,'2026'); assert.equal(data.preflightOnly,false);
  assert.equal(JSON.parse(actionLogPayload('SHIPMENT_ADJUST_BATCH',{year:'2025',week:'36-01',entries,preflightOnly:true},{committedCount:0})).committedCount,0);
  assert.equal(JSON.parse(actionLogPayload('SHIPMENT_ADJUST_BATCH',{},null)).committedCount,null);
  assert.equal(actionLogPayload('OTHER',{a:'x'.repeat(5000)},null).length,4000);
  assert.equal(actionLogPayload('ERP_EDIT_TAKEOVER',{year:'2026',editGuard:{token:'SECRET'}},{}).includes('SECRET'),false);
  console.log('pasteOperationAudit tests passed');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
