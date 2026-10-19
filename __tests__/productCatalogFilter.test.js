import assert from 'node:assert/strict';
import { matchesProductFlowers, productFlowerCounts, matchesProductCountry, productCountryCounts, groupProductsByCountryFlower } from '../lib/productCatalogFilter.js';
import { versionCatalogImageResponse } from '../lib/catalogImageVersion.js';
import './productCatalogUi.test.cjs';

const products = [{ProdKey:447, FlowerName:'카네이션'}, {ProdKey:2, FlowerName:'장미'}, {ProdKey:3, FlowerName:null}];
for (const year of [2025, 2026]) {
  const rows = products.map(p => ({...p, OrderYear:year, OrderWeek:'42-01'}));
  const before = JSON.stringify(rows);
  assert.equal(rows.filter(p => matchesProductFlowers(p, [])).length, 3);
  assert.deepEqual(rows.filter(p => matchesProductFlowers(p, ['카네이션'])).map(p=>p.ProdKey), [447]);
  assert.equal(rows.filter(p => matchesProductFlowers(p, ['장미','카네이션'])).length, 2);
  assert.equal(rows.filter(p => matchesProductFlowers(p, ['미지정'])).length, 1);
  assert.equal(rows.filter(p => matchesProductFlowers(p, ['없는 품종'])).length, 0);
  assert.equal(JSON.stringify(rows), before);
}
assert.deepEqual(productFlowerCounts([]), []);
assert.equal(new Map(productFlowerCounts(products)).get('카네이션'), 1);
for (const year of [2025,2026]) {
  const rows=[{ProdKey:1,CounName:'중국',FlowerName:'장미'},{ProdKey:2,CounName:'콜롬비아',FlowerName:'장미'},{ProdKey:3,CounName:'네덜란드',FlowerName:'튤립'},{ProdKey:4,CounName:null,FlowerName:null},{ProdKey:5,CounName:'중국',FlowerName:'장미'}].map(p=>({...p,OrderYear:year,OrderWeek:'42-01'}));
  const before=JSON.stringify(rows);
  assert.equal(rows.filter(p=>matchesProductCountry(p,null)).length,5);
  assert.deepEqual(rows.filter(p=>matchesProductCountry(p,'중국')).map(p=>p.ProdKey),[1,5]);
  assert.equal(rows.filter(p=>matchesProductCountry(p,'미지정')).length,1);
  assert.equal(rows.filter(p=>matchesProductCountry(p,'없음')).length,0);
  assert.equal(rows.filter(p=>matchesProductCountry(p,'')).length,0);
  assert.equal(new Map(productCountryCounts(rows)).get('중국'),2);
  const groups=groupProductsByCountryFlower(rows);
  assert.equal(groups.length,4);
  assert.deepEqual(groups.find(g=>g.country==='중국').products.map(p=>p.ProdKey),[1,5]);
  assert.equal(groups.flatMap(g=>g.products).length,rows.length);
  assert.equal(new Set(groups.flatMap(g=>g.products).map(p=>p.ProdKey)).size,5);
  assert.equal(JSON.stringify(rows),before);
}
console.log('Product flower filters: all, multiple, missing, stale, cross-year preservation passed');
const original = { id:'same-photo', prodKey:447, url:'/uploads/catalog/photo.jpg', updatedAt:'2026-10-19T01:00:00Z' };
const response = versionCatalogImageResponse({images:[original],byProdKey:{447:[original]}});
assert.equal(response.images[0].url, response.byProdKey[447][0].url);
assert.equal(response.images[0].id, original.id);
assert.equal(original.url, '/uploads/catalog/photo.jpg');
assert.deepEqual(versionCatalogImageResponse(response), response);
assert.notEqual(versionCatalogImageResponse({images:[{...original,updatedAt:'2026-10-19T02:00:00Z'}]}).images[0].url,response.images[0].url);
