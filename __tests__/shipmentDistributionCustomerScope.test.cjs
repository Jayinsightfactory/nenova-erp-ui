require('./shipmentDistributionNavigation.test.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
test('country-only read scope differs from native flower scope',async()=>{
 const {distributionReadProductWhere}=await import('../lib/shipmentDistributionCustomerScope.js');
 const {distributionSelectionMatches,distributionPairFilterMatches}=await import('../lib/shipmentDistributionWorkspace.js');
 for(const year of ['2025','2026']){
  assert.equal(distributionReadProductWhere('태국::').params.pgCountry.value,'태국');assert(!distributionReadProductWhere('태국::').clause.includes('FlowerName'));
  assert(distributionSelectionMatches({CounName:'태국',FlowerName:'레드불'},'태국::'));
  assert(!distributionSelectionMatches({CounName:'미국',FlowerName:'레드불'},'태국::'));
  assert(!distributionSelectionMatches({CounName:'태국',FlowerName:'덴드륨'},'태국::레드불'));
  assert(distributionPairFilterMatches({CounName:'태국',FlowerName:'레드불'},'태국'));
 }
});
