import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFreightApplyPlan, freightApplyAmounts } from '../lib/estimateFreightApply.js';
import { FREIGHT_ROUNDING } from '../lib/estimateFreightPolicy.js';

test('groups by sub-week, rounds loading once and transport per category', () => {
  const source = [
    { OrderWeek: '37-01', ProdName: 'CARNATION Nova', CounName: '콜롬비아', FlowerName: '카네이션', Unit: '박스', Quantity: 4 },
    { OrderWeek: '37-01', ProdName: 'CARNATION Moon', CounName: '콜롬비아', FlowerName: '카네이션', Unit: '단', Quantity: 5, BunchesPerBox: 15 },
    { OrderWeek: '37-02', ProdName: 'ROSE Pink', CounName: '콜롬비아', FlowerName: '장미', Unit: '박스', Quantity: 2 },
  ];
  const products = [
    { ProdKey: 100, ProdName: '현지상차운임', OutUnit: '박스', BunchOf1Box: 1, SteamOf1Box: 1 },
    { ProdKey: 101, ProdName: '카네이션 운송료', OutUnit: '박스', BunchOf1Box: 1, SteamOf1Box: 1 },
    { ProdKey: 102, ProdName: '장미 운송료', OutUnit: '박스', BunchOf1Box: 1, SteamOf1Box: 1 },
  ];

  const plan = buildFreightApplyPlan({ sourceRows: source, products, rounding: FREIGHT_ROUNDING.CEIL });
  assert.equal(plan.unresolved.length, 0);
  assert.deepEqual(plan.inserts.map((r) => [r.week, r.kind, r.product.ProdKey, r.boxes]), [
      ['37-01', 'LOADING', 100, 5],
      ['37-01', 'TRANSPORT', 101, 5],
      ['37-02', 'LOADING', 100, 2],
      ['37-02', 'TRANSPORT', 102, 2],
  ]);
});

test('is idempotent against existing ShipmentDetail product rows', () => {
  const source = [
    { OrderWeek: '37-01', ProdName: 'CARNATION Nova', CounName: '콜롬비아', FlowerName: '카네이션', Unit: '박스', Quantity: 4 },
  ];
  const products = [
    { ProdKey: 100, ProdName: '현지상차운임', OutUnit: '박스', BunchOf1Box: 1, SteamOf1Box: 1 },
    { ProdKey: 101, ProdName: '카네이션 운송료', OutUnit: '박스', BunchOf1Box: 1, SteamOf1Box: 1 },
  ];
  const plan = buildFreightApplyPlan({ sourceRows: source, products, existingRows: [{ OrderWeek: '37-01', ProdKey: 100 }, { OrderWeek: '37-01', ProdKey: 101 }] });
  assert.deepEqual(plan.skipped.map((r) => r.product.ProdKey), [100, 101]);
  assert.deepEqual(plan.inserts.map((r) => r.product.ProdKey), []);
});

test('uses the same amount/vat conversion as shipment writes', () => {
  const row = { boxes: 2, unitPrice: 1500 };
  const product = { ProdKey: 100, ProdName: '현지상차운임', OutUnit: '박스', BunchOf1Box: 1, SteamOf1Box: 1 };
  const result = freightApplyAmounts(row, product, (qty) => ({ box: qty, bunch: qty, steam: qty, outQty: qty, estQty: qty }), (cost, qty) => ({ amount: Math.round(cost * qty / 1.1), vat: Math.round(cost * qty - cost * qty / 1.1) }));
  assert.equal(result.amount, 2727);
  assert.equal(result.vat, 273);
});
