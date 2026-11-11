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
test('drag ranges accumulate into earlier selections across filtered country-flower views',()=>{
 const rows=[{id:'n1',category:'NL',name:'문라이트',country:'네덜란드',flower:'튤립'},{id:'n2',category:'NL',name:'스위트',country:'네덜란드',flower:'튤립'},{id:'c1',category:'CO',name:'돈셀',country:'콜롬비아',flower:'카네이션'},{id:'c2',category:'CO',name:'코랄',country:'콜롬비아',flower:'카네이션'}];
 const first=s.visibleRows(rows,['NL'],'');assert.deepEqual(s.mergeRangeSelection(first,0,1,[]),['n1','n2']);
 const next=s.visibleRows(rows,s.toggleCategoryFilter(['NL'],'CO'),'');
 assert.deepEqual(next.map(r=>r.id),['n1','n2','c1','c2']);
 const accumulated=s.mergeRangeSelection(s.visibleRows(rows,['CO'],''),0,1,['n1','n2']);assert.deepEqual(accumulated,['n1','n2','c1','c2']);
 assert.deepEqual(s.visibleRows(rows,['NL'],'돈셀').map(r=>r.id),[]);
 assert.deepEqual(s.toggleCategoryFilter(['NL'],'CO'),['NL','CO']);assert.deepEqual(s.toggleCategoryFilter(['NL','CO'],'NL'),['CO']);
});
