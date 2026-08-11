const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const { sortCustomerProducts, quantitiesMatch, buildForwardOrderWeeks } = await import('../lib/myCustomerOrderEntry.js');
  const rows = sortCustomerProducts([{ProdKey:1,FlowerName:'장미',UsageCount:2,ProdName:'B'},{ProdKey:2,FlowerName:'수국',UsageCount:7,ProdName:'A'},{ProdKey:3,FlowerName:'장미',UsageCount:8,ProdName:'A'}]);
  assert.deepEqual(rows.map(x=>x.ProdKey), [3,1,2]);
  assert.equal(quantitiesMatch(2,2.00001), true); assert.equal(quantitiesMatch(2,3), false);
  const choices = buildForwardOrderWeeks(new Date(2026, 7, 11));
  assert.deepEqual(choices.slice(0,4), [
    {year:'2026',week:'34-01',label:'34-1'}, {year:'2026',week:'34-02',label:'34-2'},
    {year:'2026',week:'35-01',label:'35-1'}, {year:'2026',week:'35-02',label:'35-2'}
  ]);
  const api=fs.readFileSync('pages/api/orders/index.js','utf8'), own=fs.readFileSync('pages/api/orders/my-customers.js','utf8'), page=fs.readFileSync('pages/orders/my-customers.js','utf8'), menu=fs.readFileSync('components/Layout.js','utf8');
  assert.match(menu,/\/orders\/my-customers/); assert.match(page,/\/api\/products\/search/); assert.match(page,/expectedCurrentQty/);
  assert.match(page,/aria-pressed/); assert.doesNotMatch(page,/api\/orders\/weeks/);
  assert.match(api,/my-customer/); assert.match(api,/WITH \(UPDLOCK, HOLDLOCK\)/); assert.match(api,/OrderYear = @year/);
  assert.match(own,/xom\.OrderYear=@year AND xom\.OrderWeek=@week/); assert.doesNotMatch(page,/components\/Layout/);
  assert.match(own,/FROM Customer c/); assert.match(own,/ManagerName/); assert.doesNotMatch(own,/본인 담당 업체만 조회/);
  assert.match(api,/activeCustomer/); assert.doesNotMatch(api,/본인 담당 업체의 주문만 등록/);
  assert.match(own,/recent\.LastOrderDtm DESC/); assert.match(page,/visibleCustomers/); assert.match(page,/slice\(0, 30\)/);
  assert.doesNotMatch(own,/SUM\(CASE WHEN p\.OutUnit/); assert.match(own,/SUM\(ISNULL\(xod\.BoxQuantity,0\)\)/);
  assert.match(page,/scrollIntoView/); assert.match(page,/업체명·담당자 검색/);
  console.log('my customer order entry tests passed');
})().catch(e=>{console.error(e);process.exitCode=1});
