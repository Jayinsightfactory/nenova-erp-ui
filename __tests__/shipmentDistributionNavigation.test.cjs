const test=require('node:test'),assert=require('node:assert/strict');
test('favorite families and SKUs precede nonfavorites without hiding them',async()=>{
 const {distributionNavigationGroups,favoriteDistributionRows}=await import('../lib/shipmentDistributionNavigation.js');
 const rows=[{ProdKey:1,ProdName:'A',CounName:'CO',FlowerName:'Rose'},{ProdKey:2,ProdName:'Z',CounName:'CO',FlowerName:'Hydrangea'},{ProdKey:3,ProdName:'A',CounName:'CO',FlowerName:'Hydrangea'},{ProdKey:4,ProdName:'B',CounName:'CO',FlowerName:'Other'}];
 const groups=distributionNavigationGroups(rows,[{groupKey:'CO::Hydrangea'}],new Set([2,4]));
 assert.deepEqual(groups.map(g=>g.flower),['Hydrangea','Other','Rose']);
 assert.deepEqual(groups[0].rows.map(p=>p.ProdKey),[2,3]);assert.equal(groups.flatMap(g=>g.rows).length,4);
 assert.deepEqual(favoriteDistributionRows(rows,new Set()).map(p=>p.ProdKey),[1,3,4,2]);
});
test('actual date index distinguishes undated and multi-day customer-product facts',async()=>{
 const {buildDistributionDateLookup}=await import('../lib/shipmentDistributionNavigation.js');
 const d=buildDistributionDateLookup([{CustKey:1,ProdKey:1,ShipmentDate:'2026-11-05'},{CustKey:1,ProdKey:1,ShipmentDate:'2026-11-06'},{CustKey:2,ProdKey:1,ShipmentDate:null}]);
 assert.deepEqual(d.dates,['2026-11-05','2026-11-06']);assert(d.matches('',99,99));assert(d.matches('undated',1,2));assert(d.matches('undated',99,99));
 assert(!d.matches('undated',1,1));assert(d.matches('2026-11-06',1,1));assert(!d.matches('2026-11-06',1,2));assert(d.matches('2026-11-05',null,1));
});
