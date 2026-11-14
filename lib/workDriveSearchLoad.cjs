'use strict';
const {decodeDriveListAsync}=require('./workDriveListDecode.cjs');
// One independent request owner per screen. Neither aborted nor late responses
// may replace newer search results (even if a server ignores AbortController).
function createDriveSearchLoader({fetch:fetcher=globalThis.fetch,onResult,onState,onDenied}={}){
 let generation=0,controller,closed=false;
 function cancel(){generation++;controller?.abort();}
 async function search(query,criteria={}){
  cancel();if(closed||!query)return;const g=generation;controller=new AbortController();const signal=controller.signal;
  const current=()=>!closed&&g===generation&&!signal.aborted;
  onState({phase:'loading',query,error:''});
  try{
   const response=await fetcher('/api/work/drive?format=table-v1&usage=deferred&search='+encodeURIComponent(query)+'&criteria='+encodeURIComponent(JSON.stringify(criteria)),{cache:'no-store',signal});
   if(!current())return;
   if(response.status===401||response.status===403){onDenied();throw Error('파일 접근 권한을 확인해 주세요.');}
   const payload=await decodeDriveListAsync(await response.json(),{signal});
   if(!current())return;
   if(!payload.success||!Array.isArray(payload.files)||payload.search?.query!==query)throw Error(payload.error||'전체 파일 검색 응답을 확인하지 못했습니다.');
   onResult(payload);onState({phase:'ready',query,error:''});
  }catch(error){if(current()&&error.name!=='AbortError')onState({phase:'error',query,error:error.message});}
 }
 return {search,cancel,close(){closed=true;cancel();}};
}
module.exports={createDriveSearchLoader};
