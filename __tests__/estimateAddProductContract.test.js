const fs = require('fs');
const assert = require('assert');

const context = fs.readFileSync('pages/api/estimate/add-product-context.js', 'utf8');
const modal = fs.readFileSync('components/estimate/OrderRegisterDistributeModal.js', 'utf8');
const adjust = fs.readFileSync('pages/api/shipment/adjust.js', 'utf8');

assert.match(context, /OrderYear=@yr AND OrderWeek=@wk AND CustKey=@ck/);
assert.match(context, /MISSING_SUBWEEK_02/);
assert.match(context, /sp\.OutUnit=tp\.OutUnit/);
assert.match(context, /sp\.CounName/);
assert.match(context, /sp\.FlowerName/);
assert.match(context, /CASE WHEN sm\.CustKey=@ck THEN 0 ELSE 1 END/);
assert.match(modal, /-02/);
assert.match(modal, /mode: 'PIVOT_DISTRIBUTION'/);
assert.match(modal, /VAT포함 단가/);
assert.match(adjust, /requestedUnitCost > 0/);

const total = 11000;
const amount = Math.round(total / 1.1);
const vat = Math.round(total / 11);
assert.strictEqual(amount + vat, total, 'VAT 포함 단가 분리 합계');
console.log('estimateAddProductContract tests passed');
