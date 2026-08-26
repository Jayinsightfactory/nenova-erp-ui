// Estimate 쓰기 경로의 공급가/부가세는 nenova.exe ClassShipmentDate 규약을 따라야 한다.
//   Amount = ROUND(Cost * ROUND(Quantity,0) / 1.1, 0)
//   Vat    = Cost * ROUND(Quantity,0) - Amount
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { amountVatFromCostEst } from '../lib/distributeUnits.js';
import { exeAmountVatSql, exeDateAmountVat } from '../lib/estimateDateQuantity.js';

for (const [cost, qty] of [[740, 2000], [1, 1], [3333, 7], [12000, 3], [700, 190]]) {
  const { amount, vat } = amountVatFromCostEst(cost, qty);
  const exe = exeDateAmountVat(cost, qty);
  assert.equal(amount, exe.amount);
  assert.equal(vat, exe.vat);
  assert.equal(amount + vat, cost * qty, `정수 수량 Amount+Vat 가 총액과 같아야 한다 (cost=${cost}, qty=${qty})`);
}

const frac = amountVatFromCostEst(15500, 5.17);
assert.equal(frac.amount + frac.vat, 15500 * 5, '소수 수량은 EXE처럼 먼저 정수화한 뒤 금액을 계산한다.');
assert.notEqual(frac.amount + frac.vat, 15500 * 5.17);

const neg = amountVatFromCostEst(3333, -7);
assert.equal(neg.amount + neg.vat, 3333 * -7, '음수 수량도 Amount+Vat=총액을 유지해야 한다.');

const sql = exeAmountVatSql('sd.Cost', 'sd.EstQuantity');
assert.match(sql.amount, /ROUND\(.*\/ 1\.1, 0\)/);
assert.match(sql.vat, /-\s*ROUND/);
assert.doesNotMatch(sql.vat, /\/\s*11/);

const writePaths = [
  'pages/api/estimate/index.js',
  'pages/api/estimate/update-cost.js',
  'pages/api/estimate/update-quantity.js',
  'pages/api/estimate/update-entry.js',
  'pages/api/shipment/adjust.js',
];
const readIfExists = (file) => {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
};
// 2026-08-26 단가 전용 저장 분리 설계로 update-cost.js의 금액 계산이
// lib/estimateCostOnly.js로 이동할 수 있다 — 그 경로만 헬퍼 모듈도 함께 확인한다.
const helperOverrides = {
  'pages/api/estimate/update-cost.js': ['lib/estimateCostOnly.js'],
};
for (const p of writePaths) {
  const src = fs.readFileSync(p, 'utf8');
  const combined = [src, ...(helperOverrides[p] || []).map(readIfExists)].join('\n');
  assert.ok(combined.includes('amountVatFromCostEst'), `${p} 는 공용 헬퍼로 Amount/Vat 를 계산해야 한다 (분리된 헬퍼 모듈 포함).`);
  assert.ok(
    !/Vat\b[\s\S]{0,80}?\/\s*11\b/.test(combined.replace(/^\s*(\/\/|\*).*$/gm, '')),
    `${p} 에 Vat 를 /11 로 따로 반올림하는 쓰기가 남아 있다.`,
  );
}

console.log('estimate amount/vat parity tests passed');
