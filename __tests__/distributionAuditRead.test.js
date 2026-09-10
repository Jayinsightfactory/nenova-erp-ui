const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../pages/api/orders/distribution-change-audits.js'),'utf8');
const calls=[];
const deps={withAuth:h=>h,listAudits:async s=>{calls.push(s);return [];},getAudit:async s=>{calls.push(s);return {id:s.id};}};
const box={deps,module:{exports:null}};
vm.runInNewContext(source.replace(/import \{ withAuth \}[^;]+;/,'const {withAuth}=deps;').replace(/import \{ listAudits, getAudit \}[^;]+;/,'const {listAudits,getAudit}=deps;').replace('export default','module.exports='),box);
const response=()=>({code:200,setHeader(){},status(n){this.code=n;return this;},json(v){this.body=v;return this;}});
(async()=>{
 let res=response();await box.module.exports({method:'POST'},res);assert.equal(res.code,405);assert.equal(calls.length,0);
 res=response();await box.module.exports({method:'GET',query:{year:'2026',week:'37-02'}},res);assert.equal(calls[0].year,'2026');assert.equal(calls[0].week,'37-02');
 res=response();await box.module.exports({method:'GET',query:{year:'2025',week:'37-02',id:'id'}},res);assert.equal(calls[1].year,'2025');assert.equal(res.body.audit.id,'id');
 console.log('distribution audit archive read tests passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
