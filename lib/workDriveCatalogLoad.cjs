'use strict';
const {decodeDriveList}=require('./workDriveListDecode.cjs');
// Request ownership belongs to one mounted screen, including background catalog
// and usage reads. Abort is supplemented by generation checks for late servers.
function createDriveCatalogLoader({fetch:fetcher=globalThis.fetch,onFiles,onStatus,onUsage,onUsageError,onDenied,nextPaint=()=>Promise.resolve()}={}){
 let generation=0,controller=null,fullController=null,fullAttempt=0,closed=false,canRetry=false,usageAllowed=false,identity='';
 const current=(g)=>!closed&&g===generation&&!controller.signal.aborted;
 const who=payload=>JSON.stringify([payload.me,payload.dept,payload.isAdmin]);
 function abortError(){const error=Error('요청이 취소되었습니다.');error.name='AbortError';return error;}
 function retryDelay(response){
  const value=response.headers?.get?.('Retry-After');if(typeof value!=='string'||!value.trim())return null;
  const raw=value.trim(),ms=/^\d+$/.test(raw)?Number(raw)*1000:Date.parse(raw)-Date.now();
  // Respect short server retry hints; invalid/long hints keep the manual retry.
  return Number.isFinite(ms)&&ms>=0&&ms<=10000?ms:null;
 }
 function waitRetry(ms,signal){return new Promise((resolve,reject)=>{
  if(signal.aborted){reject(abortError());return;}
  const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(abortError());};
  const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);signal.addEventListener('abort',abort,{once:true});
 });}
 async function read(url,signal,retryTemporary=false){
  for(let attempt=0;;attempt++){
   if(signal.aborted)throw abortError();const response=await fetcher(url,{cache:'no-store',signal});if(signal.aborted)throw abortError();
   if(response.status===401||response.status===403){const error=Error('로그인 또는 파일 접근 권한을 다시 확인해 주세요.');error.denied=true;throw error;}
   const delay=retryTemporary&&attempt===0&&[503,429].includes(response.status)?retryDelay(response):null;
   if(delay!==null){try{response.body?.cancel()?.catch(()=>{});}catch{}await waitRetry(delay,signal);continue;}
   const payload=await response.json();if(!payload.success){const error=Error(payload.error||'파일 목록을 불러오지 못했습니다.');error.status=response.status;throw error;}
   return payload;
  }
 }

 function failure(error,g){if(!current(g)||error.name==='AbortError')return;if(error.denied){usageAllowed=false;canRetry=false;onDenied();onUsage(null);}onStatus({phase:'error',error:error.message,denied:!!error.denied,retry:canRetry?'full':'preview'});}
 async function usage(g){try{const payload=await read('/api/work/drive?usage=only',controller.signal);if(payload.usage==null)throw Error('사용량 확인 실패');if(current(g)&&usageAllowed){onUsage(payload.usage);onUsageError('');}}catch(error){if(current(g)&&usageAllowed&&error.name!=='AbortError')onUsageError(error.message);}}
 async function full(g){
  if(!current(g)||!canRetry)return;const attempt=++fullAttempt;fullController?.abort();fullController=new AbortController();const root=controller,child=fullController,abort=()=>child.abort();root.signal.addEventListener('abort',abort,{once:true});onStatus({phase:'partial',error:'',denied:false});
  try{const payload=decodeDriveList(await read('/api/work/drive?format=table-v1&usage=deferred',child.signal,true));if(!current(g)||attempt!==fullAttempt)return;if(!Array.isArray(payload.files)||payload.catalog?.complete===false)throw Error('전체 파일 목록을 완성하지 못했습니다. 다시 시도해 주세요.');if(who(payload)!==identity){usageAllowed=false;onUsage(null);}if(!payload.isAdmin){usageAllowed=false;onUsage(null);}onFiles(payload,{complete:true});canRetry=false;onStatus({phase:'ready',error:'',denied:false,totalFiles:payload.files.length});}
  catch(error){if(attempt===fullAttempt)failure(error,g);}finally{root.signal.removeEventListener('abort',abort);}
 }
 async function load(){
  if(closed)return;controller?.abort();fullController?.abort();controller=new AbortController();const g=++generation;canRetry=false;usageAllowed=false;onStatus({phase:'loading',error:'',denied:false});
  try{
   let payload;
   try{payload=await read('/api/work/drive?format=table-v1&usage=deferred&preview=1',controller.signal,true);}catch(error){if(!current(g))return;if(![400,404,405].includes(error.status))throw error;payload=await read('/api/work/drive?format=table-v1&usage=deferred',controller.signal,true);}
   if(!current(g))return;payload=decodeDriveList(payload);if(!Array.isArray(payload.files))throw Error('파일 목록 응답을 확인하지 못했습니다.');
   identity=who(payload);usageAllowed=!!payload.isAdmin;const complete=payload.catalog?.complete!==false;onFiles(payload,{complete});onUsage(payload.usage??null);onUsageError('');onStatus({phase:complete?'ready':'partial',error:'',denied:false,totalFiles:payload.catalog?.totalFiles??payload.files.length});
   if(usageAllowed)void usage(g);
   if(!complete){canRetry=true;await nextPaint();if(current(g))void full(g);}
  }catch(error){failure(error,g);}
 }
 return {load,retry:()=>full(generation),close(){closed=true;generation++;controller?.abort();fullController?.abort();}};
}
module.exports={createDriveCatalogLoader};
