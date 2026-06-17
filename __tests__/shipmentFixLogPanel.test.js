import {
  parseCategoryFromFixDetail,
  summarizeCategoryFixProgress,
  parseStockCalcProgressFromDetail,
} from '../lib/shipmentFixLogUtils.js';

let pass = 0;
let fail = 0;
const assert = (label, cond) => {
  if (cond) { pass++; return; }
  fail++;
  console.log(`  ✗ ${label}`);
};

console.log('=== ShipmentFixLogPanel helpers ===');
assert('category 태국', parseCategoryFromFixDetail('2026/22-01 태국 10/15') === '태국');
assert('category prod=', parseCategoryFromFixDetail('2026/22-01 콜롬비아카네이션 prod=47') === '콜롬비아카네이션');
assert('progress 10/15', parseStockCalcProgressFromDetail('2026/22-01 태국 10/15').done === 10);

const cats = summarizeCategoryFixProgress([
  { Step: 'unfix_sp_start', Detail: '2026/22-01 태국 prod=15', IsError: 0 },
  { Step: 'unfix_stock_calc_done', Detail: '2026/22-01 콜롬비아카네이션 ok=47 err=0', IsError: 0 },
], 'unfix');
assert('2 categories tracked', cats.length === 2);
assert('done category', cats.some(c => c.label.includes('콜롬비아') && c.status === 'done'));

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
