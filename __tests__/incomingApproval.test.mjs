import test from 'node:test';
import assert from 'node:assert/strict';
import { approvalPermissions, strictApprovalNumber, normalizeApprovalMatching, buildApprovalDistributionPlan } from '../lib/incomingApprovalPolicy.js';

const product = (ProdKey, OutUnit = '단') => ({ ProdKey, ProdName: `P${ProdKey}`, OutUnit, EstUnit: '단', BunchOf1Box: 10, SteamOf1Box: 100, SteamOf1Bunch: 10, isDeleted: false });
const base = () => ({ scope: { orderYear: '2026', orderWeek: '41-01' }, receiptPlan: { detailsChanged: true, keys: [1, 2] },
  products: [product(1), product(2)], masters: [{ ShipmentKey: 10, OrderYear: '2026', OrderWeek: '41-01', OrderYearWeek: '202641', CustKey: 5, isFix: true, isDeleted: false }],
  details: [{ SdetailKey: 20, ShipmentKey: 10, ProdKey: 1, OutQuantity: 100, isFix: true, CustKey: null }],
  dates: [{ SdateKey: 30, SdetailKey: 20, ShipmentQuantity: 60, EstQuantity: 60, Cost: 110, Amount: 6000, Vat: 600, ShipmentDtm: '2026-10-08' }, { SdateKey: 31, SdetailKey: 20, ShipmentQuantity: 40, EstQuantity: 40, Cost: 110, Amount: 4000, Vat: 400, ShipmentDtm: '2026-10-09' }] });
const row = patch => ({ sdateKey: 30, shipmentKey: 10, prodKey: 1, quantity: 50, cost: 110, date: '2026-10-08', ...patch });
const plan = (matching, facts = base()) => buildApprovalDistributionPlan({ ...facts, matching: normalizeApprovalMatching({ rows: matching }) });
test('authority: blank/null/false/deactivated are not administrators; import and support separate', () => {
  for (const authority of ['', null, undefined, false]) assert.deepEqual(approvalPermissions({ userId: 'x', authority }), { request: false, review: false, admin: false });
  assert.equal(approvalPermissions({ userId: 'x', deptName: '수입부' }).review, false);
  assert.equal(approvalPermissions({ userId: 'x', deptName: '영업지원' }).request, false);
  assert.equal(approvalPermissions({ userId: 'x', deptName: '영업지원', accountActive: false }).review, false);
  assert.equal(approvalPermissions({ userId: 'x', authority: 1 }).review, true);
});
test('strict numbers preserve zero, reject omitted/empty/boolean/negative/nonfinite', () => {
  assert.equal(strictApprovalNumber(0, '수량'), 0);
  for (const n of [undefined, null, '', ' ', false, true, -1, NaN, Infinity, '4x', {}]) assert.throws(() => strictApprovalNumber(n, '수량'));
});
test('reduction-only preserves other dates and adds no other product', () => {
  const p = plan([row({})]); assert.equal(p.length, 1); assert.equal(p[0].outQuantity, 90); assert.equal(p[0].amount, 9000); assert.equal(p[0].stockDelta, 10); assert.equal(p[0].after.find(d => d.SdateKey === 31).ShipmentQuantity, 40);
});
test('zero is explicit deletion and full cancellation leaves no fake zero order', () => {
  const p = plan([row({ quantity: 0 }), row({ sdateKey: 31, quantity: 0, date: '2026-10-09' })]); assert.equal(p[0].after.length, 0); assert.equal(p[0].stockDelta, 100); assert.equal(p[0].amount, 0);
});
test('same-unit move reassigns quantity and money; native null detail customer accepted', () => {
  const p = plan([row({ prodKey: 2, quantity: 60 })]);
  const old = p.find(g => g.product.ProdKey === 1), next = p.find(g => g.product.ProdKey === 2);
  assert.equal(old.outQuantity, 40); assert.equal(next.outQuantity, 60); assert.equal(old.stockDelta, 60); assert.equal(next.stockDelta, -60); assert.equal(next.amount, 6000);
});
test('different units calculate target estimate quantities, never assume number equality', () => {
  const facts = base(); facts.products[1] = product(2, '박스');
  const p = plan([row({ prodKey: 2, quantity: 6 })], facts).find(g => g.product.ProdKey === 2);
  assert.equal(p.outQuantity, 6); assert.equal(p.after[0].EstQuantity, 60); assert.equal(p.amount, 6000);
});

test('replacement keeps an unfixed source unfixed under a fixed header; mixed fix destinations fail closed', () => {
  const facts=base();facts.details[0].isFix=false;
  const next=plan([row({prodKey:2,quantity:60})],facts).find(g=>g.product.ProdKey===2);
  assert.equal(next.fixed,false);assert.equal(next.stockDelta,0);
  facts.details.push({SdetailKey:21,ShipmentKey:10,ProdKey:2,OutQuantity:5,isFix:true});
  facts.dates.push({SdateKey:32,SdetailKey:21,ShipmentQuantity:5,EstQuantity:5,Cost:110,Amount:500,Vat:50});
  assert.throws(()=>plan([row({prodKey:2,quantity:60})],facts),{code:'APPROVAL_FIX_MERGE_CONFLICT'});
  facts.details[1].isFix=false;
  assert.equal(plan([row({prodKey:2,quantity:60})],facts).find(g=>g.product.ProdKey===2).fixed,false);
});

test('new replacement destination cannot combine sources with mixed confirmation states',()=>{
  const facts=base();facts.products.push(product(3));facts.receiptPlan.keys.push(3);
  facts.details.push({SdetailKey:21,ShipmentKey:10,ProdKey:2,OutQuantity:5,isFix:false});
  facts.dates.push({SdateKey:32,SdetailKey:21,ShipmentQuantity:5,EstQuantity:5,Cost:110,Amount:500,Vat:50,ShipmentDtm:'2026-10-08'});
  assert.throws(()=>plan([row({prodKey:3,quantity:60}),row({sdateKey:32,prodKey:3,quantity:5})],facts),{code:'APPROVAL_FIX_MERGE_CONFLICT'});
  facts.details[1].isFix=true;
  assert.equal(plan([row({prodKey:3,quantity:60}),row({sdateKey:32,prodKey:3,quantity:5})],facts).find(g=>g.product.ProdKey===3).fixed,true);
});
test('independent addition and reduction need not balance', () => {
  const p = plan([row({ quantity: 20 }), row({ sdateKey: null, prodKey: 2, quantity: 7 })]);
  assert.equal(p.find(g => g.product.ProdKey === 1).outQuantity, 60); assert.equal(p.find(g => g.product.ProdKey === 2).outQuantity, 7);
});
test('existing destination merges into one detail and preserves original dates', () => {
  const facts = base(); facts.details.push({ SdetailKey: 21, ShipmentKey: 10, ProdKey: 2, OutQuantity: 5, isFix: true });
  facts.dates.push({ SdateKey: 32, SdetailKey: 21, ShipmentQuantity: 5, EstQuantity: 5, Cost: 110, Amount: 500, Vat: 50 });
  const p = plan([row({ prodKey: 2, quantity: 60 })], facts).find(g => g.product.ProdKey === 2);
  assert.equal(p.detail.SdetailKey, 21); assert.equal(p.outQuantity, 65); assert.equal(p.after.length, 2);
});
test('farm-only cannot edit money, quantity or products', () => {
  const facts = base(); facts.receiptPlan.detailsChanged = false;
  assert.deepEqual(plan([], facts), []); assert.throws(() => plan([row({})], facts), { code: 'APPROVAL_FARM_QUANTITY_CHANGE' });
});
test('prior-year same week cannot be selected; later year is explicitly preserved in group', () => {
  const facts = base(); facts.masters[0] = { ...facts.masters[0], OrderYear: '2025', OrderYearWeek: '202541' };
  assert.throws(() => plan([row({})], facts), { code: 'APPROVAL_SCOPE_MISMATCH' });
  facts.masters[0] = { ...facts.masters[0], OrderYear: '2027', OrderYearWeek: '202741' };
  assert.equal(plan([row({})], facts)[0].master.OrderYear, '2027');
});
test('duplicates, unrelated products, broken date totals and wrong source master reject', () => {
  assert.throws(() => plan([row({}), row({})]), { code: 'APPROVAL_DUPLICATE_DATE' });
  assert.throws(() => plan([row({ prodKey: 3 })]), { code: 'APPROVAL_UNRELATED_PRODUCT' });
  const facts = base(); facts.details[0].OutQuantity = 99;
  assert.throws(() => plan([row({})], facts), { code: 'APPROVAL_DATE_TOTAL' });
  assert.throws(() => plan([row({ shipmentKey: 999 })]), { code: 'APPROVAL_TARGET_MISSING' });
});
