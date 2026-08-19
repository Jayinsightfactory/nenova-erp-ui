// Estimate 쓰기 경로의 공급가/부가세는 nenova.exe ClassShipmentDate 규약을 따라야 한다.
//   Amount = ROUND(Cost * Quantity / 1.1, 0),  Vat = Cost * Quantity - Amount
// Vat 를 따로 반올림(/11)하면 Amount+Vat 가 총액과 1원 어긋나는 드리프트가 쌓인다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { amountVatFromCostEst } from '../lib/distributeUnits.js';

for (const [cost, qty] of [[740, 2000], [1, 1], [3333, 7], [15500, 5.17], [12000, 3]]) {
  const { amount, vat } = amountVatFromCostEst(cost, qty);
  assert.equal(amount + vat, cost * qty, `Amount+Vat 가 총액과 같아야 한다 (cost=${cost}, qty=${qty})`);
}

// 불량차감 음수 수량도 총액 항등식을 유지해야 한다.
const neg = amountVatFromCostEst(3333, -7);
assert.equal(neg.amount + neg.vat, 3333 * -7, '음수 수량도 Amount+Vat=총액을 유지해야 한다.');

// 정수 총액에서는 두 수식이 항상 일치하고, 어긋나는 것은 소수 EstQuantity(분수 박스)뿐이다.
// 운영 probe 에서 확정 54,895행 중 3행만 틀렸던 이유가 이것이다.
for (let g = 1; g <= 200000; g++) {
  assert.equal(Math.round(g / 1.1) + Math.round(g / 11), g, `정수 총액 ${g} 은 두 수식이 같아야 한다.`);
}
const fracGross = 3333 * 0.01;
assert.notEqual(
  Math.round(fracGross / 1.1) + Math.round(fracGross / 11),
  fracGross,
  '소수 총액에서는 /11 별도 반올림이 총액과 어긋난다 — 이 케이스가 회귀 감시 대상이다.',
);

const writePaths = [
  'pages/api/estimate/index.js',
  'pages/api/estimate/update-cost.js',
  'pages/api/estimate/update-quantity.js',
  'pages/api/estimate/update-entry.js',
];
for (const p of writePaths) {
  const src = fs.readFileSync(p, 'utf8');
  assert.ok(src.includes('amountVatFromCostEst'), `${p} 는 공용 헬퍼로 Amount/Vat 를 계산해야 한다.`);
  assert.ok(
    !/Vat\b[\s\S]{0,80}?\/\s*11\b/.test(src.replace(/^\s*(\/\/|\*).*$/gm, '')),
    `${p} 에 Vat 를 /11 로 따로 반올림하는 쓰기가 남아 있다.`,
  );
}

console.log('estimate amount/vat parity tests passed');
