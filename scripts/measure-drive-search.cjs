'use strict';
// Read-only operational verification. Credentials/query stay in memory; output
// contains only counts, timings, bytes and equality, never names, ids or paths.
const {decodeDriveList}=require('../lib/workDriveListDecode.cjs');
async function measureDriveSearch({baseUrl,token,query,fetch:fetcher=globalThis.fetch}={}) {
 const parsed=new URL(baseUrl);if(parsed.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(parsed.hostname))throw Error('HTTPS required');
 async function read(suffix){const start=performance.now(),response=await fetcher(new URL('/api/work/drive?format=table-v1&usage=deferred'+suffix,parsed),{headers:{Authorization:'Bearer '+token},cache:'no-store',signal:AbortSignal.timeout(30000)});const raw=await response.text();if(!response.ok)throw Error('HTTP '+response.status);const payload=decodeDriveList(JSON.parse(raw));if(!payload.success||!Array.isArray(payload.files))throw Error('Invalid response');return {payload,ms:Math.round(performance.now()-start),bytes:Buffer.byteLength(raw)};}
 const full=await read('');if(!query){query=full.payload.files[Math.floor(full.payload.files.length/2)]?.filename;if(typeof query!=='string'||!query.length||query.length>500)throw Error('An explicit in-memory query is required');}
 const search=await read('&search='+encodeURIComponent(query)),expected=full.payload.files.filter(f=>String(f.filename||'').toLowerCase().includes(query.toLowerCase())||String(f.uploaderName||'').includes(query)||(f.cycle||'')===query);
 expected.sort((a,b)=>String(a.uploadedAt||'')>String(b.uploadedAt||'')?-1:String(a.uploadedAt||'')<String(b.uploadedAt||'')?1:0);
 const clean=files=>files.map(({searchVersionCount,...file})=>file);const equal=JSON.stringify(clean(search.payload.files))===JSON.stringify(expected.slice(0,200));
 const result={full:{ms:full.ms,bytes:full.bytes,count:full.payload.files.length},search:{ms:search.ms,bytes:search.bytes,count:search.payload.files.length,totalFiles:search.payload.search?.totalFiles},exactMatch:equal,searchTotalCorrect:search.payload.search?.totalFiles===expected.length};
 if(!equal||!result.searchTotalCorrect)throw Error('Search/full comparison failed (concurrent index changes require a fresh verification)');return result;
}
module.exports={measureDriveSearch};
if(require.main===module){measureDriveSearch({baseUrl:process.env.DRIVE_VERIFY_BASE_URL,token:process.env.DRIVE_VERIFY_TOKEN,query:process.env.DRIVE_VERIFY_QUERY}).then(result=>console.log(JSON.stringify(result))).catch(()=>{console.error('Read-only drive search verification failed; no sensitive response was logged.');process.exitCode=1;});}
