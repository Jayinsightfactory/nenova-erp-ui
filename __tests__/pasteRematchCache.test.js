/**
 * 붙여넣기 저장 매칭 — 재분석 시 Claude 결과보다 우선
 */
import { lookupSavedProductMapping } from '../lib/pasteLocalMapping.js';
import { applyPasteCustomerMappings, pasteCustomerMappingKey } from '../lib/pasteCustomerMapping.js';
import fs from 'node:fs';

let pass = 0;
let fail = 0;
const assert = (label, cond) => {
  if (cond) pass++;
  else { fail++; console.log(`  ✗ ${label}`); }
};

const cache = {
  '문라이트 핑크': { prodKey: 101, prodName: 'Moonlight Pink', displayName: '문라이트 핑크' },
};
const products = [{ ProdKey: 101, ProdName: 'Moonlight Pink', DisplayName: '문라이트 핑크', CounName: '콜롬비아', FlowerName: '장미' }];

const claudeWrong = {
  inputName: '문라이트 핑크',
  prodKey: 999,
  prodName: 'Wrong',
  fallbackSuspect: true,
};

const hit = lookupSavedProductMapping(claudeWrong.inputName, cache, products);
assert('saved mapping found', hit.ok === true);
assert('saved prodKey', Number(hit.prod?.ProdKey) === 101);

const customers = [
  { CustKey: 10, CustName: '잘못업체' },
  { CustKey: 20, CustName: '남대문 중앙' },
];
const customerKey = pasteCustomerMappingKey('남대문중앙');
const rematched = applyPasteCustomerMappings([
  { custName: '남대문중앙', custMatch: customers[0], custFromMapping: false },
], { [customerKey]: { custKey: 20, custName: '남대문 중앙' } }, customers)[0];
assert('saved customer mapping overrides repeated automatic mismatch', Number(rematched.custMatch?.CustKey) === 20);
assert('saved customer mapping is marked', rematched.custFromMapping === true);

const pasteSource = fs.readFileSync('pages/orders/paste.js', 'utf8');
assert('manual customer selection awaits persistence', pasteSource.includes('await learnCustomerMapping(inputName, customer)'));
assert('customer mapping POST response is checked', pasteSource.includes('if (!response.ok || !data.success)'));
assert('local/server customer cache applies after parse', pasteSource.includes('applyPasteCustomerMappings(applyCache(raw, cache, allProducts), customerCache, allCustomers)'));

console.log(`\n=== pasteRematchCache: ${pass} pass, ${fail} fail ===`);
process.exit(fail > 0 ? 1 : 0);
