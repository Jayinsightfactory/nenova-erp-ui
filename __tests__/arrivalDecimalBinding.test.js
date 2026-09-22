import assert from 'node:assert/strict';
import fs from 'node:fs';
import sql from 'mssql';

// Execute the production parameter construction with real MSSQL Request.input,
// not a fake that only observes value and misses scale=0 on the wire.
const core = fs.readFileSync(new URL('../lib/arrivalCost.js', import.meta.url), 'utf8');
const code = core.replace(/^import .*;\r?\n/gm, '').replaceAll('export async function', 'async function')
  .replaceAll('export function', 'function').replaceAll('export const', 'const');
const make = new Function('sql', code + '\nreturn arrivalLineInsertParams;')(sql);
const row = { orderWeek:'38-1', quantity:100.125, sourceArrivalCostKRW:9033.76279932948,
  selectedArrivalCostKRW:9033.76279932948, sourceArrivalCostVatKRW:9937.139,
  fobUSD:0.35, freightPerUnitUSD:0.194772, exchangeRate:1400.125,
  customsPerUnitKRW:38.134055, otherPerUnitKRW:102.561113,
  grossWeight:146.25, chargeableWeight:228.5, freightUSD:525.885, invoiceUSD:1446.4,
  weightMetricShare:0.03703704,volumeMetricShare:0.01234567,valueMetricShare:0.12345678 };
const params = make(row, {importKey:26,year:'2026',fileName:'fixture.xlsx',actorId:'fixture',idx:0});
const request = new sql.Request();
for (const [key,{type,value}] of Object.entries(params)) request.input(key,type,value);
const expected = {
  qty:4,sourceCost:4,selectedCost:4,sourceVat:4,customs:4,other:4,gw:4,cw:4,
  fob:6,freightUnit:6,fx:6,freight:6,invoice:6,weightShare:8,volumeShare:8,valueShare:8,
};
for (const [key,scale] of Object.entries(expected)) {
  assert.equal(request.parameters[key+'_0'].precision,18,key);
  assert.equal(request.parameters[key+'_0'].scale,scale,key);
}
assert.equal(request.parameters.sourceCost_0.value,row.sourceArrivalCostKRW);
assert.equal(request.parameters.fob_0.value,0.35);
assert.equal(request.parameters.cw_0.value,228.5);
assert.equal(request.parameters.year_0.value,'2026');
const prior = make(row,{importKey:1,year:'2025',fileName:'fixture.xlsx',actorId:'fixture',idx:1});
assert.equal(prior.year_1.value,'2025');
const zero = make({...row,fobUSD:0,quantity:0},{idx:2,year:'2026'});
assert.equal(zero.fob_2.value,0);
assert.equal(zero.qty_2.value,0);
const old = new sql.Request().input('old',sql.Decimal,0.35);
assert.equal(old.parameters.old.scale,undefined,'regression: bare Decimal leaves scale unspecified (driver defaults to0)');
console.log('arrival decimal bindings: real Request.input scales4/6/8, zero, original values and explicit year passed');
