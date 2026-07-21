// node __tests__/stockShortage.test.js

import { calculateStockShortage, roundStockQuantity } from '../lib/stockShortage.js';

let pass = 0;
let fail = 0;
const assert = (label, condition) => {
  if (condition) pass += 1;
  else { fail += 1; console.log(`  ✗ ${label}`); }
};

console.log('=== stock shortage ===');
assert('exact shortage is preserved', calculateStockShortage({ remain: -0.4 }) === 0.4);
assert('explicit shortage wins', calculateStockShortage({ remain: -2.5, shortage: 2.25 }) === 2.25);
assert('positive remain has no shortage', calculateStockShortage({ remain: 3 }) === 0);
assert('fraction is normalized only to 0.001', roundStockQuantity(1.23456) === 1.235);

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
