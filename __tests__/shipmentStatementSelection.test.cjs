const {test}=require('node:test'),assert=require('node:assert/strict'),s=require('../lib/shipmentStatementSelection.cjs');
test('main-week buttons are exactly selected ±2; clamp without crossing business year',()=>{
 assert.deepEqual(s.nearbyWeeks(45),[43,44,45,46,47]);assert.deepEqual(s.nearbyWeeks(1),[1,2,3]);assert.deepEqual(s.nearbyWeeks(53),[51,52,53]);
 for(const value of [undefined,null,'',0,false,true,-1,54,1.5,'45-01'])assert.deepEqual(s.nearbyWeeks(value),[]);
});
test('favorite customer identity is numeric key, never stored display name; malformed records ignored',()=>{
 const records=[{FavoriteKey:1,FilterData:'{"custKey":7}'},{FavoriteKey:2,FilterData:'{"custKey":"7"}'},{FavoriteKey:3,FilterData:'broken'},{FavoriteKey:4,FilterData:'{"custKey":0}'},{FavoriteKey:0,FilterData:'{"custKey":8}'},{FavoriteKey:5,FilterData:'{"custKey":-1}'}];
 assert.deepEqual([...s.customerFavoriteKeys(records)],[[7,[1,2]]]);assert.equal(s.FAVORITE_PAGE,'shipment-statement-customers');
});
test('favorite-first ordering stays inside selected manager and current-year/week live customer scope',()=>{
 const customers=[{CustKey:7,CustName:'나업체',Manager:'담당A'},{CustKey:8,CustName:'가업체',Manager:'담당A'},{CustKey:9,CustName:'다업체',Manager:'담당B'}];
 const fav=new Map([[7,[1]],[9,[2]],[99,[3]]]);assert.deepEqual(s.visibleCustomers(customers,'담당A','',fav).map(c=>c.CustKey),[7,8]);
 assert.deepEqual(s.visibleCustomers(customers,'담당B','',fav).map(c=>c.CustKey),[9]);assert.deepEqual(s.visibleCustomers(customers,'담당A','가업',fav).map(c=>c.CustKey),[8]);
 assert.deepEqual(s.visibleCustomers([], '', '',fav),[]);assert.deepEqual(customers.map(c=>c.CustKey),[7,8,9]);
});
test('zero, empty favorite list and stale manager remain explicit, no invented current customer',()=>{
 const c=[{CustKey:8,CustName:'B',Manager:'A'},{CustKey:7,CustName:'A',Manager:'A'}];assert.deepEqual(s.visibleCustomers(c,'','',new Map()).map(c=>c.CustKey),[7,8]);assert.deepEqual(s.visibleCustomers(c,'removed','',new Map()),[]);
});
