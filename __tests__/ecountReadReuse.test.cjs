const {test}=require('node:test'),assert=require('node:assert/strict');
const {sharedPendingReader,serialReads,lookupFailureMemo}=require('../lib/ecountReadReuse.cjs');
const pending=require('../lib/ecountPendingReceipts.cjs');
const hash='a'.repeat(64),id='b'.repeat(64),pattern='c'.repeat(64),period={from:'2026-12-01',to:'2027-01-01'};
const row={id,pattern,date:'2026-12-31',amount:200,status:'PENDING',code:hash,self:false};
const snapshot=(at,rows=[row])=>({at:new Date(at).toISOString(),from:'2026-12-01',to:'2027-01-01',complete:true,rows});
test('next customer reuses prior after snapshot; after remains fresh and double-deduction guard unchanged',async()=>{
 const {collectLedgerWithBank}=await import('../scripts/ecount-scraper/pending-receipts.mjs');let now=Date.parse('2027-01-01T01:00:00Z'),calls=0;
 const reader=sharedPendingReader({now:()=>now,read:async()=>{calls++;return snapshot(now);}});
 const history=snapshot(now-1000,[]),run=()=>collectLedgerWithBank({period,history,collectBefore:(_p,_b,p)=>reader.before(p),collectBank:(_p,_b,p)=>reader.fresh(p),collectLedger:async()=>{now+=1000;return {collectedAt:new Date(now).toISOString(),periodFrom:period.from,periodTo:period.to,totals:{receipt:0,balance:1000},rows:[]};}});
 const a=await run(),b=await run();assert.equal(calls,3);assert.equal(b.bankEvidence.before.at,a.bankEvidence.after.at);
 assert.equal(pending.calculatePendingReceipts(a.bankEvidence,a,hash).calculatedBalance,800);assert.equal(pending.calculatePendingReceipts(b.bankEvidence,b,hash).calculatedBalance,800);
 const changed={...b,bankEvidence:{...b.bankEvidence,after:snapshot(now,[])}};assert.equal(pending.calculatePendingReceipts(changed.bankEvidence,changed,hash).reason,'BANK_CHANGED');
});
test('expired, failed, scope, session and cross-year cache never masquerade as a current before snapshot',async()=>{
 let now=Date.parse('2026-12-31T15:00:00Z'),session=1,calls=0,fail=false;
 const reader=sharedPendingReader({now:()=>now,version:()=>session,read:async p=>{calls++;if(fail)throw Error('SOURCE_UNAVAILABLE');return {...snapshot(now),from:p.from.slice(0,7)+'-01',to:p.to,rows:[]};}});
 await reader.before(period);await reader.before(period);assert.equal(calls,1);now+=90001;await reader.before(period);assert.equal(calls,2);session++;await reader.before(period);assert.equal(calls,3);
 await reader.before({from:'2026-11-30',to:'2026-12-31'});assert.equal(calls,4);fail=true;await assert.rejects(reader.fresh(period));fail=false;await reader.before(period);assert.equal(calls,6);
 now-=120000;await reader.before(period);assert.equal(calls,7);
});
test('explicit zero age disables reuse, malformed snapshot is rejected and raw input extras are discarded',async()=>{
 let calls=0;const now=Date.parse('2027-01-01T01:00:00Z'),reader=sharedPendingReader({now:()=>now,maxAgeMs:0,read:async()=>{calls++;return {...snapshot(now),private:'never retain'};}});
 assert.ok(!JSON.stringify(await reader.before(period)).includes('private'));await reader.before(period);assert.equal(calls,2);
 await assert.rejects(sharedPendingReader({read:async()=>({...snapshot(now),complete:false})}).before(period),/INVALID_BANK_EVIDENCE/);
});
test('source read queue serializes independent reports and survives a rejected operation',async()=>{
 const run=serialReads(),seen=[];let release;const first=run(async()=>{seen.push(1);await new Promise(r=>release=r);throw Error('SOURCE');});const second=run(async()=>seen.push(2));await new Promise(setImmediate);assert.deepEqual(seen,[1]);release();await assert.rejects(first);await second;assert.deepEqual(seen,[1,2]);
});
test('only unchanged verified lookup failure is held; manual success, mapping, expiry, malformed state retry',()=>{
 let now=Date.parse('2026-12-31T17:00:00Z');const c={custKey:7,sourceCode:'fixture-code',lookupName:'fixture-name',lookupQuery:'fixture-query'},memo=lookupFailureMemo(undefined,{now:()=>now});
 assert.equal(memo.skip(c),false);memo.fail(c);assert.equal(memo.skip(c),true);const saved=memo.snapshot();assert.ok(!JSON.stringify(saved).includes('fixture'));assert.equal(lookupFailureMemo(saved,{now:()=>now}).skip(c),true);
 for(const patch of [{sourceCode:'other'},{lookupName:'other'},{lookupQuery:'other'}])assert.equal(memo.skip({...c,...patch}),false);
 now+=7*24*3600000;assert.equal(memo.skip(c),false);memo.fail(c);memo.success(c);assert.equal(memo.skip(c),false);
 assert.equal(lookupFailureMemo({'7':{signature:'bad',at:now}},{now:()=>now}).skip(c),false);const zero=lookupFailureMemo(undefined,{now:()=>now,maxAgeMs:0});zero.fail(c);assert.equal(zero.skip(c),false);
});

test('legacy reports run once per weekday 08/11/14 slot, no startup catch-up/night/weekend/restart replay',async()=>{
 const {scheduledReadCycle}=require('../lib/ecountReadReuse.cjs');let now=Date.parse('2026-12-31T07:59:00+09:00'),saved=null,calls=0;
 const create=()=>scheduledReadCycle({lastAttempt:saved,now:()=>now,save:async v=>saved=v}),tick=create(),run=async()=>calls++;
 assert.equal(await tick(run),false);now+=60000;assert.equal(await tick(run),true);assert.equal(await tick(run),false);assert.equal(await create()(run),false);
 now=Date.parse('2026-12-31T11:00:00+09:00');assert.equal(await tick(run),true);now=Date.parse('2026-12-31T14:00:00+09:00');assert.equal(await tick(run),true);assert.equal(calls,3);
 for(const date of ['2026-12-31T18:00:00+09:00','2027-01-01T09:30:00+09:00','2027-01-02T08:00:00+09:00']){now=Date.parse(date);assert.equal(await tick(run),false);}
 now=Date.parse('2027-01-01T08:00:00+09:00');await assert.rejects(tick(async()=>{throw Error('SOURCE');}));assert.equal(await tick(run),false);assert.equal(await create()(run),false);
});

test('a held link is retried next Korean day even before 24 elapsed hours, including year rollover',()=>{
 let now=Date.parse('2026-12-31T23:59:00+09:00');const memo=lookupFailureMemo(undefined,{now:()=>now}),c={custKey:8,sourceCode:'fixture'};memo.fail(c);assert.equal(memo.skip(c),true);now+=60000;assert.equal(memo.skip(c),false);
});

test('wrong bank scope/status cannot enter reuse cache',async()=>{
 const now=Date.parse('2027-01-01T01:00:00Z');
 await assert.rejects(sharedPendingReader({read:async()=>({...snapshot(now),to:'2027-01-02'})}).before(period),/BANK_SCOPE_MISMATCH/);
 await assert.rejects(sharedPendingReader({read:async()=>snapshot(now,[{...row,status:'REFLECTED',postingDate:'2026-12-31'}])}).before(period),/BANK_STATUS_MISMATCH/);
});
