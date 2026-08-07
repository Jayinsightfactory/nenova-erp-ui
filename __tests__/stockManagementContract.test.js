import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  calculateStockPosition,
  normalizeStockHistoryRow,
  rankSubstituteCandidates,
  STOCK_HISTORY_SQL,
  STOCK_POSITION_SQL,
} from '../lib/stockManagement.js';

assert.deepEqual(calculateStockPosition({ confirmedStock: 100, pendingAllocation: 25 }), {
  confirmedStock: 100, pendingAllocation: 25, expectedStock: 75,
});
assert.equal(normalizeStockHistoryRow({ Source: 'WAREHOUSE', Quantity: 12 }).delta, 12);
assert.equal(normalizeStockHistoryRow({ Source: 'SHIPMENT_CONFIRMED', Quantity: 7 }).delta, -7);
assert.equal(normalizeStockHistoryRow({ Source: 'SHIPMENT_PENDING', Quantity: 4 }).affectsConfirmedStock, false);
assert.equal(normalizeStockHistoryRow({ Source: 'MANUAL_ADJUSTMENT', BeforeValue: 10, AfterValue: 13 }).delta, 3);
assert.throws(() => normalizeStockHistoryRow({ Source: 'AUTO_UNKNOWN', Quantity: 10 }));

const candidates = rankSubstituteCandidates([
  { ProdKey: 2, CountryFlower: '콜롬비아장미', OutUnit: 'BOX', ConfirmedStock: 15, PendingAllocation: 2 },
  { ProdKey: 3, CountryFlower: '콜롬비아장미', OutUnit: 'BOX', ConfirmedStock: 20, PendingAllocation: 20 },
  { ProdKey: 4, CountryFlower: '네덜란드장미', OutUnit: 'BOX', ConfirmedStock: 50, PendingAllocation: 0 },
], { prodKey: 1, countryFlower: '콜롬비아장미', outUnit: 'BOX' });
assert.deepEqual(candidates.map((x) => x.ProdKey), [2]);

assert.match(STOCK_POSITION_SQL, /sm\.OrderYear=@year AND sm\.OrderWeek=@week/);
assert.match(STOCK_POSITION_SQL, /ISNULL\(sd\.isFix,0\)<>1/);
assert.match(STOCK_HISTORY_SQL, /sh\.AfterValue/);
assert.match(STOCK_HISTORY_SQL, /NOT IN \(N'입고', N'출고'\)/);

const api = fs.readFileSync('pages/api/stock/index.js', 'utf8');
assert.match(api, /type === 'management'/);
assert.match(api, /type === 'substitutes'/);
assert.match(api, /type === 'moyiWeek'/);
assert.match(api, /requireOrderYear/);
assert.match(api, /signedDelta/);
assert.match(api, /NEGATIVE_AFTER_VALUE/);
assert.doesNotMatch(api, /ProductStock\s+SET|UPDATE\s+ProductStock/i);

console.log('stock management contract tests passed');
