const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const { sortCustomerProducts, quantitiesMatch } = await import('../lib/myCustomerOrderEntry.js');
  const rows = sortCustomerProducts([{ProdKey:1,FlowerName:'장미',UsageCount:2,ProdName:'B'},{ProdKey:2,FlowerName:'수국',UsageCount:7,ProdName:'A'},{ProdKey:3,FlowerName:'장미',UsageCount:8,ProdName:'A'}]);
  assert.deepEqual(rows.map(x=>x.ProdKey), [3,1,2]);
  assert.equal(quantitiesMatch(2,2.00001), true); assert.equal(quantitiesMatch(2,3), false);
  const api=fs.readFileSync('pages/api/orders/index.js','utf8'), own=fs.readFileSync('pages/api/orders/my-customers.js','utf8'), page=fs.readFileSync('pages/orders/my-customers.js','utf8'), menu=fs.readFileSync('components/Layout.js','utf8');
  assert.match(menu,/\/orders\/my-customers/); assert.match(page,/\/api\/products\/search/); assert.match(page,/expectedCurrentQty/);
  assert.match(api,/my-customer/); assert.match(api,/WITH \(UPDLOCK, HOLDLOCK\)/); assert.match(api,/OrderYear = @year/);
  assert.match(own,/xom\.OrderYear=@year AND xom\.OrderWeek=@week/); assert.doesNotMatch(page,/components\/Layout/);
  console.log('my customer order entry tests passed');
})().catch(e=>{console.error(e);process.exitCode=1});
