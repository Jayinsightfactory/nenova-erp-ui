import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWeekdayChangePlan, normalizeWeekdayApplyRequest, weekdayRequestHash, weekdaySnapshotDigest } from '../lib/weekdayDistributionPolicy.js';
import { prepareWeekdayAllocation } from '../lib/weekdayAllocation.js';

const types = { NVarChar: 'nvarchar', Int: 'int' };
const product = { ProdKey: 77, OutUnit: '송이', EstUnit: '송이', SteamOf1Box: 100, BunchOf1Box: 10, SteamOf1Bunch: 10 };
const change = actual => ({ year: '2026', orderWeek: '41-01', custKey: 533, prodKey: 77, unit: '송이',
  expected: { detailRows: actual.detailRows, shipmentOutQuantity: actual.shipmentOutQuantity,
    shipmentDates: actual.shipmentDates, snapshotDigest: weekdaySnapshotDigest({year:'2026',orderWeek:'41-01',custKey:533,prodKey:77}, actual) },
  dates: [{ date: '2026-10-08', quantity: 120 }] });
const calendar = new Map([['2026-10-08',{timestamp:'2026-10-08 00:00:00.000',weekDay:5}]]);
const empty = () => ({ detailRows: 0, shipmentOutQuantity: null, shipmentDates: [], master: null, detail: null,
  product, customer: { Manager: 'manager', OrderCode: '533' } });

test('only explicit allocation mode relaxes legacy fixed policy and enters request hash', () => {
  const actual = empty(), c = change(actual);
  const body = { operationId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', reason: 'explicit allocation', custKey: 533, changes: [c] };
  const legacy = normalizeWeekdayApplyRequest(body), allocation = normalizeWeekdayApplyRequest({ ...body, mode: 'ALLOCATION' });
  assert.equal(Object.hasOwn(legacy, 'mode'), false);
  assert.notEqual(weekdayRequestHash(legacy), weekdayRequestHash(allocation));
  assert.equal(weekdayRequestHash(legacy), weekdayRequestHash({ ...legacy, mode: undefined }));
  assert.throws(() => normalizeWeekdayApplyRequest({ ...body, mode: 'anything' }));
  assert.throws(() => buildWeekdayChangePlan(c,actual,calendar), error => error.code === 'ERP_CONFIRMATION_REQUIRED');
  const plan = buildWeekdayChangePlan(c,actual,calendar,{mode:'ALLOCATION'});
  assert.equal(plan.newTotal,120);assert.equal(plan.fixed,false);assert.equal(plan.newDetail,true);
});

test('existing unfixed date final120-current100 changes only20 and preserves cost/fix', () => {
  const actual = { ...empty(), master: { ShipmentKey: 1, MasterIsFix: 0, OrderYearWeek: '202641' }, detailRows: 1,
    shipmentOutQuantity: 100, detail: { SdetailKey: 1, DetailIsFix: 0, DetailCost: 700 }, shipmentDates: [{
      sdateKey: 1,sdetailKey:1,shipmentKey:1,date:'2026-10-08',timestamp:'2026-10-08 00:00:00.000',
      shipmentQuantity:100,estimateQuantity:100,cost:700,amount:63636,vat:6364,detailFixed:false }] };
  const plan = buildWeekdayChangePlan(change(actual),actual,calendar,{mode:'ALLOCATION'});
  assert.equal(plan.delta,20);assert.equal(plan.fixed,false);assert.equal(plan.finalDates[0].cost,700);
});

test('new target uses one CPC or native zero; existing active order is never expanded', async () => {
  const plan = buildWeekdayChangePlan(change(empty()),empty(),calendar,{mode:'ALLOCATION'});
  const calls = [];
  await prepareWeekdayAllocation(async (statement, params) => {
    calls.push(statement); assert.ok(!/\b(INSERT|UPDATE|DELETE)\b/.test(statement));
    if(statement.includes('CustomerProdCost')) return {recordset:[]};
    assert.equal(params.yr.value,'2026');assert.equal(params.wk.value,'41-01');
    return {recordset:[{OrderMasterKey:1,OrderDetailKey:2,OutQuantity:100,Manager:'old-manager'}]};
  },types,[plan]);
  assert.equal(plan.inheritedCost,0);assert.equal(plan.allocationOrder.existing.OutQuantity,100);
  assert.equal(calls.some(statement=>statement.includes('UserInfo')),false,'manager validation belongs only to new order');
  await assert.rejects(prepareWeekdayAllocation(async()=>({recordset:[{Cost:700},{Cost:701}]}),types,[plan]),
    error=>error.code==='ALLOCATION_SCOPE_UNVERIFIED');
});

test('CANCEL does not request/create orders; positive no-order requires active UserInfo manager', async () => {
  const actual=empty(), plan=buildWeekdayChangePlan(change(actual),actual,calendar,{mode:'ALLOCATION'});
  const calls=[];
  await prepareWeekdayAllocation(async statement=>{
    calls.push(statement);
    if(statement.includes('CustomerProdCost'))return {recordset:[{Cost:700}]};
    if(statement.includes('OrderMaster'))return {recordset:[]};
    return {recordset:[{UserID:'manager'}]};
  },types,[plan]);
  assert.ok(calls.some(statement=>statement.includes('ISNULL(isDeleted,0)=0')));
  assert.equal(plan.allocationOrder.existing,null);
  calls.length=0;
  const cancel={...plan,newDetail:false,delta:-20,actual:{...actual,detail:{DetailCost:700}}};
  await prepareWeekdayAllocation(async statement=>{calls.push(statement);throw Error('no reads expected');},types,[cancel]);
  assert.equal(calls.length,0);
});
