import assert from 'node:assert/strict';
import { matchesProductFlowers, productFlowerCounts } from '../lib/productCatalogFilter.js';
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
console.log('Product flower filters: all, multiple, missing, stale, cross-year preservation passed');
const original = { id:'same-photo', prodKey:447, url:'/uploads/catalog/photo.jpg', updatedAt:'2026-10-19T01:00:00Z' };
const response = versionCatalogImageResponse({images:[original],byProdKey:{447:[original]}});
assert.equal(response.images[0].url, response.byProdKey[447][0].url);
assert.equal(response.images[0].id, original.id);
assert.equal(original.url, '/uploads/catalog/photo.jpg');
assert.deepEqual(versionCatalogImageResponse(response), response);
assert.notEqual(versionCatalogImageResponse({images:[{...original,updatedAt:'2026-10-19T02:00:00Z'}]}).images[0].url,response.images[0].url);
