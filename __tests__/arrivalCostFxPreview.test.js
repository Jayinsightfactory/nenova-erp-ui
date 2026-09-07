import assert from 'node:assert/strict';
import { recalcArrivalCostWithFx } from '../lib/arrivalCostFxPreview.js';

// 원본: fob+freight(USD)=10, exchangeRate=1300 → usd*fx=13000, customs=2000, other=500 → cost=15500
const row = {
  exchangeRate: 1300,
  sourceArrivalCostKRW: 15500,
  customsPerUnitKRW: 2000,
  otherPerUnitKRW: 500,
};

{
  const r = recalcArrivalCostWithFx(row, 1400);
  // usdPortion = (15500-2000-500)/1300 = 10, newCost = 10*1400+2500 = 16500
  assert.equal(r.ok, true);
  assert.equal(r.cost, 16500);
  assert.equal(r.origFx, 1300);
}

{
  const r = recalcArrivalCostWithFx(row, 1300);
  assert.equal(r.cost, 15500, '동일 환율이면 원본과 같아야 한다.');
}

{
  const r = recalcArrivalCostWithFx(row, 0);
  assert.equal(r.ok, false, '환율 0/미입력이면 계산하지 않는다.');
}

{
  const r = recalcArrivalCostWithFx({ ...row, exchangeRate: 0 }, 1400);
  assert.equal(r.ok, false, '원본 환율이 없으면 역산할 수 없다.');
}

{
  const r = recalcArrivalCostWithFx({ ...row, selectedArrivalCostKRW: 20000 }, 1400);
  // selectedArrivalCostKRW가 있으면 그것을 기준으로 써야 한다.
  // usdPortion=(20000-2500)/1300=13.4615..., newCost=13.4615*1400+2500
  assert.ok(Math.abs(r.cost - (((20000 - 2500) / 1300) * 1400 + 2500)) < 1e-6);
}

console.log('arrivalCostFxPreview tests passed');
