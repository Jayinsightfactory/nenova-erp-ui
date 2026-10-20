'use strict';
const assert=require('node:assert/strict');
const p=require('../lib/ecountLookupWindow.cjs');
const nonce='12345678-1234-4123-8123-123456789abc';
const child={closed:false},origin='https://nenovaweb.com';
for(const dataset of p.DATASETS){
  const state={origin,child,nonce,dataset,currentDataset:dataset};
  const event={origin,source:child,data:p.createSelection({nonce,dataset})};
  assert(p.validateSelection(event,state));
  for(const patch of [{origin:'https://evil.invalid'},{source:{closed:false}},{data:{...event.data,value:'monthly'}},{data:{...event.data,nonce:'12345678-1234-4123-8123-000000000000'}},{data:{...event.data,dataset:'journal'}},{data:{...event.data,extra:true}},{data:[]}])assert.equal(p.validateSelection({...event,...patch},state),false);
  for(const patch of [{currentDataset:'journal'},{parentClosed:true},{child:{closed:true}},{nonce:'old'},{origin:'null'}])assert.equal(p.validateSelection(event,{...state,...patch}),false);
  assert.equal(p.validateSelection(event,{...state,nonce:'12345678-1234-4123-8123-000000000000'}),false);
}
assert.throws(()=>p.createSelection({nonce,dataset:'journal'}));
assert.throws(()=>p.createSelection({nonce:'not-random',dataset:'orderStat'}));
assert.throws(()=>p.createSelection({nonce,dataset:'orderStat',value:'all'}));
assert(p.canReturn(child));assert(!p.canReturn(null));assert(!p.canReturn({closed:true}));assert(!p.canReturn({get closed(){throw Error('unavailable');}}));
console.log('PASS lookup return: exact origin/source/nonce, current menu, closed windows, payload allowlist and daily-only selection; no SQL.');
