import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeArrivalWeek, arrivalWeekPredicate, isArrivalExampleSheet, arrivalUploadViewScope } from '../lib/arrivalImportPolicy.js';

assert.equal(normalizeArrivalWeek('37-02'), '37-2');
for (const name of ['08-1(예시)', '견본', '37-2 (sample)', 'Example']) assert.equal(isArrivalExampleSheet(name), true);
for (const name of ['37-2', '21-2(H)', 'Samplesia']) assert.equal(isArrivalExampleSheet(name), false);
const rows = [{ orderYear: '2025', orderWeek: '37-2' }, { orderYear: '2026', orderWeek: '38-2' }, { orderYear: '2026', orderWeek: '37-02' }];
const selected = arrivalUploadViewScope(rows, '37-2 NL 원가자료 (2).xlsx');
assert.equal(selected.orderYear, '2026');
assert.equal(selected.orderWeek, '37-2');
assert.equal(selected.allVarieties, '1');
const wireScope = new URLSearchParams(selected);
assert.equal(wireScope.get('allVarieties'), '1', 'API 전체보기 프로토콜과 동일해야 한다');
assert.equal(selected.product, '');
assert.equal(arrivalUploadViewScope(rows, '원가자료.xlsx').orderWeek, '38-2');
assert.equal(arrivalUploadViewScope([]), null);
assert.match(arrivalWeekPredicate('l.OrderWeek'), /TRY_CONVERT/);
const page = fs.readFileSync(new URL('../pages/arrival-cost.js', import.meta.url), 'utf8');
assert.match(page, /setFilters\(json.viewScope\)/);
assert.match(page, /setAppliedFilters\(json.viewScope\)/);
// Execute the actual upload handler with a successful server response. No browser or DB writes.
const handlerSource = page.slice(page.indexOf('  const upload = async (event) => {') + '  const upload = async (event) => {'.length, page.indexOf('\n  const save = async (row) => {'));
const handlerBody = handlerSource.slice(0, handlerSource.lastIndexOf('  };'));
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const calls = [];
const handler = new AsyncFunction('event','filters','setUploading','setError','setMessage','fetch','parseJsonResponse','setFilters','setAppliedFilters','setPage','load','page','appliedFilters', handlerBody);
await handler({preventDefault(){},currentTarget:{elements:{namedItem(){return {files:[new Blob(['fixture'])]};}},reset(){calls.push(['reset']);}}},
  {orderYear:'2025',orderWeek:'1-1'}, ()=>{}, e=>{if(e)throw Error(e);}, ()=>{}, async()=>({ok:true}), async()=>({success:true,message:'saved',matchedCount:1,unmatchedCount:0,viewScope:selected}),
  f=>calls.push(['filters',f]), f=>calls.push(['applied',f]), p=>calls.push(['page',p]), async()=>{throw Error('Old filter reload forbidden');}, 5, {orderYear:'2025',orderWeek:'1-1'});
assert.deepEqual(calls.find(c=>c[0]==='applied')[1],selected);
assert.deepEqual(calls.find(c=>c[0]==='page'),['page',1]);
const lib = fs.readFileSync(new URL('../lib/arrivalCost.js', import.meta.url), 'utf8');
for (const name of ['l.OrderWeek', 'wm.OrderWeek', 'x.OrderWeek']) assert.ok(lib.includes(`arrivalWeekPredicate('${name}')`));
console.log('arrival import scope/example policy passed');
