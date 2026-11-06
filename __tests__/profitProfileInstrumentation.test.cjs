const test=require('node:test'),assert=require('node:assert/strict'),{instrumentProfileSource:f}=require('../scripts/lib/profit-profile-instrumentation.cjs');
test('ephemeral wrapper awaits unchanged reader and records only stage names',async()=>{
 const source='export async function loadSourceFingerprints(value){return {kept:value};}\nexport async function latestSnapshots(value){return value;}';
 const out=f(source,'file:///repo/lib/profitReportSnapshot.js'),stages=[];
 const L=new Function('globalThis',out.replaceAll('export ','')+';return {loadSourceFingerprints,latestSnapshots};')({__profitProfileStage:s=>stages.push(s)});
 assert.deepEqual(await L.loadSourceFingerprints(7),{kept:7});assert.deepEqual(stages,['loadSourceFingerprints:start','loadSourceFingerprints:end']);assert.equal(await L.latestSnapshots(0),0);
 assert.equal(f(source,'file:///repo/untouched.js'),source);
 assert.throws(()=>f('', 'file:///repo/lib/profitReportSnapshot.js'),/PROFILE_SOURCE_MISMATCH/);
});
