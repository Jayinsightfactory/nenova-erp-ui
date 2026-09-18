import assert from 'node:assert/strict';
import { buildFreightPreview, FREIGHT_ROUNDING, isFreightRow, roundBoxes } from '../lib/estimateFreightPolicy.js';

assert.equal(isFreightRow({ ProdName: '현지상차운임' }), true);
assert.equal(isFreightRow({ ProdName: 'CARNATION Novia' }), false);
assert.equal(roundBoxes(4.5, FREIGHT_ROUNDING.CEIL), 5);
assert.equal(roundBoxes(4.5, FREIGHT_ROUNDING.FLOOR), 4);
assert.equal(roundBoxes(4.5, FREIGHT_ROUNDING.EXACT), 4.5);
const result = buildFreightPreview([
  { ProdName: 'Rose', Quantity: 4, Unit: '박스', BoxQty: 4, OrderWeek: '37-01', CountryFlower: '콜롬비아 장미' },
  { ProdName: 'Rose bunch', Quantity: 5, Unit: '단', BoxQty: 0.5, OrderWeek: '37-02', CountryFlower: '콜롬비아 장미' },
  { ProdName: '현지상차운임', Quantity: 4, Unit: '박스', Cost: 2000, OrderWeek: '37-01' },
], { rounding: FREIGHT_ROUNDING.CEIL, loadingUnitPrice: 2000, transportUnitPrice: 1500 });
assert.equal(result.totalRawBoxes, 4.5);
assert.equal(result.totalBoxes, 5);
assert.equal(result.existing.length, 1);
assert.equal(result.totalLoadingAmount, 10000);
console.log('estimateFreightPolicy.test.js: all tests passed');

