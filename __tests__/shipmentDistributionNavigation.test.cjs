const test=require('node:test'),assert=require('node:assert/strict');
test('explicit family navigation uses UI country and flower, preserving full catalog on empty filter',async()=>{
 const {distributionFamilyMatches:match}=await import('../lib/shipmentDistributionNavigation.js');
 const rose={CounName:'네덜란드',FlowerName:'장미',CountryFlower:'네덜란드'};
 const tulip={...rose,FlowerName:'튤립'};
 assert(match(rose,''));assert(match(tulip,''));assert(match(rose,'네덜란드::장미'));
 assert(!match(tulip,'네덜란드::장미'));assert(!match(rose,'콜롬비아::장미'));
 for(const bad of ['네덜란드','네덜란드::','::장미','네덜란드::장미::추가'])assert(!match(rose,bad));
});
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

test('same-week previous/current-year family choices preserve the separate payload and original quantities',async()=>{
 const {distributionFamilyMatches:match}=await import('../lib/shipmentDistributionNavigation.js');
 const payloads=[{year:'2025',week:'46-01',rows:[{ProdKey:1,CounName:'콜롬비아',FlowerName:'수국',OutQuantity:99},{ProdKey:2,CounName:'콜롬비아',FlowerName:'장미',OutQuantity:88}]},{year:'2026',week:'46-01',rows:[{ProdKey:1,CounName:'콜롬비아',FlowerName:'수국',OutQuantity:7},{ProdKey:2,CounName:'콜롬비아',FlowerName:'장미',OutQuantity:5}]}];
 const before=JSON.stringify(payloads);
 assert.deepEqual(payloads.map(p=>[p.year,p.rows.filter(r=>match(r,'콜롬비아::수국')).map(r=>r.OutQuantity)]),[['2025',[99]],['2026',[7]]]);
 assert.equal(JSON.stringify(payloads),before);
});
