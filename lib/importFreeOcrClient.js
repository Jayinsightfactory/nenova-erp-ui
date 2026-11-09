import {inspectAustraliaOcr} from './importAustraliaOcr.js';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function json(response){let data;try{data=await response.json();}catch{throw Error('무료 OCR 서버 응답을 읽지 못했습니다. 원본은 유지됩니다.');}if(!response.ok)throw Error(data.error?.message||data.error||'무료 OCR 요청이 실패했습니다. 유료 분석은 실행하지 않았습니다.');return data;}
export async function extractFreePackingDocument({country,pdfBase64,retryJobId,fetchImpl=globalThis.fetch,onProgress=()=>{},sleep=wait,now=Date.now}){
 if(!['CO','AU'].includes(country))throw Error('현재 무료 OCR 구조화는 검증된 콜롬비아 복구·호주 서식을 지원합니다. 다른 서식은 확인이 필요하며 유료 분석을 자동 실행하지 않습니다.');
 const cachedResponse=await fetchImpl('/api/import/tools/parse-pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({country,pdfBase64,cacheOnly:true}),signal:AbortSignal.timeout(45000)});
 if(cachedResponse.ok){const cached=await json(cachedResponse);return {data:cached,source:cached.source==='free-ocr'?'free-ocr':'cache',cacheSaved:true};}
 if(cachedResponse.status!==404)await json(cachedResponse);
 const admitted=await json(await fetchImpl('/api/import/tools/free-ocr',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({country,pdfBase64}),signal:AbortSignal.timeout(45000)}));
 let job=admitted.job;const started=now();
 while(['QUEUED','RUNNING'].includes(job?.status)){
  onProgress({stage:job.status,elapsedSeconds:Math.floor((now()-started)/1000)});
  if(now()-started>180000)throw Error('무료 OCR 워커 응답이 지연됩니다. 파일과 작업은 유지되며 유료 분석으로 전환하지 않습니다.');
  await sleep(2000);job=(await json(await fetchImpl('/api/import/tools/free-ocr?jobId='+encodeURIComponent(job.jobId),{cache:'no-store',signal:AbortSignal.timeout(20000)}))).job;
 }
 if(job?.status!=='SUCCEEDED')throw Error(job?.error||'무료 OCR을 완료하지 못했습니다. 원본은 유지됩니다.');
 if(country==='AU'){
  const parsed=inspectAustraliaOcr(job.result);if(!parsed.result)throw Error(parsed.reason);
  return {data:{content:[{type:'text',text:JSON.stringify(parsed.result)}],stop_reason:'end_turn'},source:'free-ocr',cacheSaved:false,localSource:job.result};
 }
 const recovered=await json(await fetchImpl('/api/import/tools/parse-pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({country,pdfBase64,freeOcrJobId:job.jobId,...(retryJobId?{retryJobId}:{})}),signal:AbortSignal.timeout(45000)}));
 if(recovered.status!=='SUCCEEDED'||!recovered.result)throw Error(recovered.error?.message||'무료 구간 병합을 완료하지 못했습니다. 기존 완료 구간은 유지됩니다.');
 return {data:recovered.result,source:'free-ocr',cacheSaved:false,localSource:job.result,revalidation:recovered.revalidation};
}
