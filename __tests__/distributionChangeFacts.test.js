const assert=require('node:assert/strict');const fs=require('node:fs');
const {validateAuditScope,loadDistributionChangeFacts}=require('../lib/distributionChangeFacts');
const scope=validateAuditScope({year:'2026',week:'37-02',combined:true,from:'2026-09-09',to:'2026-09-10'});
assert.deepEqual(scope.weeks,['37-01','37-02']);assert.throws(()=>validateAuditScope({...scope,week:'37-01',combined:true}));
assert.throws(()=>validateAuditScope({year:'',week:'37-01',from:'2026-09-10',to:'2026-09-10'}));
assert.throws(()=>validateAuditScope({year:'2026',week:'37-01',from:'2026-99-10',to:'2026-09-10'}));
(async()=>{let count=0;const result=await loadDistributionChangeFacts(async(q,p)=>{count++;assert.doesNotMatch(q,/\b(INSERT|UPDATE|DELETE|ALTER|EXEC)\b/i);if(q.includes('@year')){assert.equal(p.year.value,'2026');assert.equal(p.w1.value,'37-01');assert.equal(p.w2.value,'37-02');assert.match(q,/OrderYear=@year/);}return {recordset:q.includes('COUNT_BIG')?[{count:3}]:[]}}, {NVarChar:'text'},scope);assert.equal(count,5);assert.equal(result.unscopedOrphanHistoryCount,3);assert.equal(result.historyComplete,false);assert.ok(result.warnings.some(v=>v.includes('연도·차수·업체를 특정할 수 없어')));console.log('distribution change facts tests passed');})();
