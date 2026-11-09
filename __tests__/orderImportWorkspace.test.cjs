const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const { groupImportPriceCustomers } = await import('../lib/orderImportWorkspace.js');
  const rows = [{custKey:491,custName:'원당 태광플라워',managerId:'a',managerName:'연습 A'}, {custKey:277,custName:'경원원예',managerId:'b',managerName:'연습 B'}, {custKey:456,custName:'미우',managerId:'a',managerName:'연습 A'}, {custKey:1,custName:'미지정',managerId:null}];
  const groups = groupImportPriceCustomers(rows);
  assert.equal(groups.length,3);assert.equal(groups[0].customers.length,2);assert.equal(groups[2].managerName,'담당자 미지정');assert.notEqual(groups[0].color,groups[1].color);assert.deepEqual(groupImportPriceCustomers([]),[]);assert.equal(groupImportPriceCustomers([...rows].reverse())[0].color,groups[0].color);
  const page=fs.readFileSync('pages/orders/import.js','utf8'),api=fs.readFileSync('pages/api/orders/import-parse.js','utf8');
  assert(!page.includes("setRegisterMode('orderPrice')"));assert(!api.includes('if (!matchedCustomer && requestedCustKey > 0)'));assert(page.includes('changeCustomer(null)'));assert(!page.includes("{ v: 'priceOnly'"));
  console.log('orderImportWorkspace PASS: stable manager groups, unassigned, no stale customer fallback, order-only upload default');
})().catch(e=>{console.error(e);process.exitCode=1});
