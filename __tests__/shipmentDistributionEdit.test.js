import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveShipmentDistributionEditPolicy } from '../lib/shipmentDistributionEditPolicy.js';

assert.deepEqual(
  resolveShipmentDistributionEditPolicy({ hasDetail: false, oldQty: 0, newQty: 0, farmCount: 0 }),
  { allowed: true, action: 'noop', before: 0, after: 0 }
);
assert.equal(resolveShipmentDistributionEditPolicy({ hasDetail: true, oldQty: 5, newQty: 0, farmCount: 0 }).action, 'delete');
assert.equal(resolveShipmentDistributionEditPolicy({ hasDetail: true, oldQty: 5, newQty: 7, farmCount: 0 }).action, 'update');
assert.equal(resolveShipmentDistributionEditPolicy({ hasDetail: false, oldQty: 0, newQty: 7, farmCount: 0 }).action, 'insert');
assert.equal(resolveShipmentDistributionEditPolicy({ hasDetail: true, oldQty: 5, newQty: 7, farmCount: 1 }).allowed, false);
assert.equal(resolveShipmentDistributionEditPolicy({ hasDetail: true, oldQty: 5, newQty: 5, farmCount: 1 }).allowed, true);

const page = fs.readFileSync('pages/shipment/distribute.js', 'utf8');
const orderPaste = fs.readFileSync('pages/orders/paste.js', 'utf8');
const api = fs.readFileSync('pages/api/shipment/distribute.js', 'utf8');

assert.match(page, /body: JSON\.stringify\(\{ week, year: selectedOrderYear, entries \}\)/);
assert.doesNotMatch(page, /if \(qty <= 0\) continue/);
assert.match(orderPaste, /entries: targets\.map/);
assert.doesNotMatch(orderPaste, /for \(const t of targets\)[\s\S]{0,500}fetch\('\/api\/shipment\/distribute'/);
assert.match(api, /if \(Array\.isArray\(req\.body\?\.entries\)\) return saveDistributeBatch/);
assert.match(api, /const results = await withTransaction/);
assert.match(api, /ShipmentDetail WITH \(UPDLOCK, HOLDLOCK\)/);
assert.match(api, /ShipmentFarm WITH \(UPDLOCK, HOLDLOCK\)/);
assert.match(api, /if \(!shipmentKey && entry\.outQty <= 0\)/);
assert.match(api, /DELETE FROM ShipmentDate WHERE SdetailKey=@dk/);
assert.match(api, /DELETE FROM ShipmentDetail WHERE SdetailKey=@dk/);
assert.doesNotMatch(api, /DELETE FROM OrderDetail/);
assert.doesNotMatch(api, /UPDATE OrderDetail/);
assert.doesNotMatch(api, /\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+)?(?:Estimate|StockMaster|StockHistory|WebProfitReport)\b/i);

console.log('shipmentDistributionEdit: all tests passed');
