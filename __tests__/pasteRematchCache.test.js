/**
 * 붙여넣기 저장 매칭 — 재분석 시 Claude 결과보다 우선
 */
import { lookupSavedProductMapping } from '../lib/pasteLocalMapping.js';

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

console.log(`\n=== pasteRematchCache: ${pass} pass, ${fail} fail ===`);
process.exit(fail > 0 ? 1 : 0);
