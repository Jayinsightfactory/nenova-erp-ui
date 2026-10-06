import assert from 'node:assert/strict';
import { resolveWeekdayPrintReadiness as resolve,isExpectedWeekdayPrintBlock as blocked } from '../lib/weekdayPrintReadiness.js';
const readiness={scope:'ALL_CUSTOMERS_MAJOR_WEEK',positiveCount:0,unfixedCount:0,invalidCount:0,reasons:[]};
const result=extra=>({success:false,error:'legacy diagnostic must not be parsed',printReadiness:{...readiness,...extra}});
assert.equal(resolve(result({})).state,'NO_SHIPMENT');
assert.equal(resolve(result({positiveCount:1345,unfixedCount:97})).label,'확정 대기 97건');
assert.equal(resolve(result({positiveCount:10,unfixedCount:5,invalidCount:2,reasons:['invalid native link']})).state,'INVALID');
assert.equal(resolve(result({positiveCount:0,invalidCount:1,reasons:['null out with live dates']})).state,'INVALID',
  'selected-customer invalid source need not have a positive aggregate');
assert.equal(resolve(result({positiveCount:10})).state,'READY');
for(const patch of [{scope:'SELECTED_CUSTOMER'},{positiveCount:'0'},{invalidCount:-1},{unfixedCount:1},
  {positiveCount:null},{positiveCount:1.5},{reasons:null},{reasons:[{}]}]) assert.equal(resolve(result(patch)).state,'ERROR',JSON.stringify(patch));
assert.equal(resolve({error:'network error'}).state,'ERROR');
assert.equal(resolve({items:[]}),null,'legacy success is reconciled through existing quantity guard');
for(const status of [200,404,500,503]) assert.equal(blocked(status,result({})),false,'only the guard409 has expected normal status');
assert.equal(blocked(409,result({})),true);
assert.equal(blocked(409,result({positiveCount:10,unfixedCount:2})),true);
assert.equal(blocked(409,result({positiveCount:10})),false,'READY cannot bypass a failing print response');
assert.equal(blocked(409,result({scope:'foreign'})),false);
console.log('Weekday print readiness strict major/all-customer counts, expected409, unknown/error and unchanged ready guard passed');
