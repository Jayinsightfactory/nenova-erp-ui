// lib/smokeEstimateRegression.js 단위 검증
import { countBadNormalEstimateRows } from '../lib/smokeEstimateRegression.js';

let pass = 0;
let fail = 0;
const assert = (label, cond) => {
  if (cond) { pass++; return; }
  fail++;
  console.log(`  ✗ ${label}`);
};

console.log('=== smokeEstimateRegression unit ===');

const bad = countBadNormalEstimateRows([
  { EstimateType: '정상출고', Quantity: 0, Cost: 0, ProdName: 'GHOST' },
  { EstimateType: '정상출고', Quantity: 5, Cost: 11000, ProdName: 'OK' },
  { EstimateType: '단가차감', Quantity: 0, Cost: 0, ProdName: 'DED' },
]);
assert('bad rows = 1 ghost only', bad.length === 1 && bad[0].ProdName === 'GHOST');
assert('good row not bad', !countBadNormalEstimateRows([{ EstimateType: '정상출고', Quantity: 1, Cost: 100 }]).length);

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
