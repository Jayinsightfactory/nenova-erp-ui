const test=require('node:test'),assert=require('node:assert/strict');
test('eight independent customer responses, replacement, removal, reset and previous-year same week',async()=>{
 const {createDistributionPeerReads:create}=await import('../lib/shipmentDistributionPeers.js');const reads=create();
 const tokens=Array.from({length:8},(_,i)=>reads.start('2026-46-01',600+i));
 assert(tokens.toReversed().every(t=>reads.current(t,'2026-46-01')));
 const replacement=reads.start('2026-46-01',600);assert(!reads.current(tokens[0],'2026-46-01'));assert(reads.current(tokens[1],'2026-46-01'));
 reads.cancel('2026-46-01',602);assert(!reads.current(tokens[2],'2026-46-01'));assert(reads.current(tokens[3],'2026-46-01'));
 assert(!reads.current(replacement,'2025-46-01'));reads.reset();assert(!reads.current(replacement,'2026-46-01'));
 const prior=reads.start('2025-46-01',600),current=reads.start('2026-46-01',600);assert(reads.current(current,'2026-46-01'));assert(!reads.current(prior,'2026-46-01'));
 for(const [week,key] of [['',600],['46-01',600],['2026-46-01',0],['2026-46-01',null]])assert.throws(()=>reads.start(week,key));
});
test('labels and colors have no five-customer limit; transaction bound rejects before side effects',async()=>{
 const {distributionPeerColor:color,distributionSlotMark:mark,assertDistributionBatchSize:check}=await import('../lib/shipmentDistributionPeers.js');
 assert.equal(mark(0),'①');assert.equal(mark(7),'⑧');assert.equal(mark(99),'100');
 for(let i=0;i<100;i++)assert.match(color(i),/^#[a-f0-9]{6}$/);
 check([]);check(Array.from({length:1000},()=>({})));assert.throws(()=>check(Array.from({length:1001},()=>({}))),/확정해제는 시작하지 않았습니다/);
});
