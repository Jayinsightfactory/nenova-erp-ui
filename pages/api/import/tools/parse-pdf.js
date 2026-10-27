import {withAuth} from '../../../../lib/auth';
import {validatePackingPdf} from '../../../../lib/importTeamPdf';
import {buildPrompt} from '../../../../lib/importPackingPrompt';
import {trackLLMCall} from '../../../../lib/chat/costTracker';
import {reservePackingPdfRequest} from '../../../../lib/importTeamPdfQuota';
import {packingPdfCacheKey,readPackingPdfCache,writePackingPdfCache,PDF_ANALYSIS_MODEL} from '../../../../lib/importTeamPdfCache';
import {PDF_JOB_TIMEOUT_MS,getPackingPdfJob,findPackingPdfJobByKey,startPackingPdfJob,markPackingPdfAttempt,finishPackingPdfJob,markPackingPdfCacheSaved} from '../../../../lib/importTeamPdfJobs';

export const config={api:{bodyParser:{sizeLimit:'55mb'},responseLimit:'10mb'}};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const storageError={error:{message:'PDF 분석 작업 저장소를 사용할 수 없습니다. 파일을 유지하고 잠시 후 다시 확인하세요.'}};

async function executeProviderOnce({uid,jobId,token,cacheKey,parsed,prompt,key}) {
  let dispatched=false;
  try{
    if(!await markPackingPdfAttempt(uid,jobId,token))return null;
    dispatched=true;
    const documents=[{type:'document',source:{type:'base64',media_type:'application/pdf',data:parsed.pdfBase64}},
      ...(parsed.awbPdfBase64?[{type:'document',source:{type:'base64',media_type:'application/pdf',data:parsed.awbPdfBase64}}]:[])];
    const response=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',headers:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},signal:AbortSignal.timeout(PDF_JOB_TIMEOUT_MS),
      body:JSON.stringify({model:PDF_ANALYSIS_MODEL,max_tokens:64000,system:prompt,messages:[{role:'user',content:[...documents,{type:'text',text:parsed.awbPdfBase64
        ?'The first PDF is the commercial invoice and the second PDF is its supporting AWB. Extract the invoice and the AWB fields requested by the system instructions, keep the sources separate, and return ONLY the JSON object, no other text.'
        :'Extract all invoices from this PDF. Return ONLY the JSON object, no other text.'}]}]})
    });
    if(!response.ok){
      return await finishPackingPdfJob(uid,jobId,token,{error:{message:response.status===429?'PDF 분석 요청이 많습니다. 파일은 유지됩니다. 추가 비용을 확인한 뒤 다시 분석하세요.':'PDF 분석 서비스 요청에 실패했습니다. 파일은 유지됩니다. 추가 비용을 확인한 뒤 다시 분석하세요.',code:'PDF_ANALYSIS_UNCERTAIN'}});
    }
    const data=await response.json();
    trackLLMCall({userId:uid,model:'claude-sonnet-4-6',inputTokens:data.usage?.input_tokens||0,outputTokens:data.usage?.output_tokens||0,purpose:'import-team-packing-pdf'});
    const result={content:data.content,stop_reason:data.stop_reason,source:'ai',cacheSaved:false};
    const completed=await finishPackingPdfJob(uid,jobId,token,{result});
    if(completed?.status==='SUCCEEDED'){
      try{
        if(await writePackingPdfCache(uid,cacheKey,parsed.country,data))return await markPackingPdfCacheSaved(uid,jobId,token)||completed;
      }catch{ /* Durable job result remains available. */ }
    }
    return completed;
  }catch(e){
    const uncertain=dispatched;
    const message=uncertain?'PDF 분석 호출 결과를 확인할 수 없습니다. 자동 재호출하지 않습니다. 추가 비용을 확인한 뒤 다시 분석하세요.':'PDF 분석을 시작하지 못했습니다. 파일은 유지됩니다.';
    try{return await finishPackingPdfJob(uid,jobId,token,{error:{message,...(uncertain?{code:'PDF_ANALYSIS_UNCERTAIN'}:{})}});}catch{return null;}
  }
}

async function waitForJob(uid,id){
  const end=Date.now()+PDF_JOB_TIMEOUT_MS+15000;
  while(Date.now()<end){
    const job=await getPackingPdfJob(uid,id);
    if(!job||job.status!=='RUNNING')return job;
    await sleep(250);
  }
  return null;
}
function syncResult(res,job){
  if(job?.status==='SUCCEEDED')return res.status(200).json(job.result);
  if(job?.status==='FAILED')return res.status(job.error?.code==='PDF_ANALYSIS_UNCERTAIN'?503:502).json({error:job.error,...(job.error?.code==='PDF_ANALYSIS_UNCERTAIN'?{retryJobId:job.jobId}:{})});
  return res.status(503).json({error:{message:'PDF 분석이 계속 진행 중입니다. 잠시 후 다시 확인하세요.'}});
}

export default withAuth(async(req,res)=>{
  if(req.method!=='POST'&&req.method!=='GET'){res.setHeader('Allow','GET, POST');return res.status(405).json({error:{message:'GET 또는 POST 요청만 지원합니다.'}});}
  if(req.method==='GET'){
    if(req.user?.userId==null||!String(req.user.userId).trim())return res.status(401).json({error:{message:'사용자 인증 정보를 확인할 수 없습니다. 다시 로그인하세요.'}});
    res.setHeader('Cache-Control','private, no-store');
    try{
      const job=await getPackingPdfJob(String(req.user.userId),req.query?.jobId);
      return job?res.status(200).json(job):res.status(404).json({error:{message:'PDF 분석 작업을 찾을 수 없습니다.'}});
    }catch{return res.status(503).json(storageError);}
  }
  let parsed;
  try{parsed=validatePackingPdf(req.body);}catch(e){return res.status(e.statusCode||400).json({error:{message:e.message}});}
  if(req.user?.userId==null||!String(req.user.userId).trim())return res.status(401).json({error:{message:'사용자 인증 정보를 확인할 수 없습니다. 다시 로그인하세요.'}});
  const uid=String(req.user.userId),prompt=buildPrompt(parsed.country,{awbDocument:Boolean(parsed.awbPdfBase64)}),cacheKey=packingPdfCacheKey({...parsed,prompt});
  res.setHeader('Cache-Control','private, no-store');
  try{
    const retryJobId=req.body?.retryJobId;
    if(retryJobId!=null&&(typeof retryJobId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(retryJobId)))return res.status(400).json({error:{message:'재시도 작업 번호가 올바르지 않습니다.'}});
    if(retryJobId){
      const previous=await findPackingPdfJobByKey(uid,cacheKey);
      if(previous?.jobId!==retryJobId||previous.status!=='FAILED')return res.status(400).json({error:{message:'재시도할 PDF 분석 작업이 일치하지 않습니다.'}});
    }
    const cached=await readPackingPdfCache(uid,cacheKey);
    if(cached)return res.status(200).json({...cached,source:'cache'});
    const admitted=await startPackingPdfJob(uid,cacheKey,{retryJobId});
    if(admitted.kind==='INVALID_RETRY')return res.status(400).json({error:{message:'재시도할 PDF 분석 작업이 일치하지 않습니다.'}});
    if(admitted.kind==='BUSY')return res.status(429).json({error:{message:'이 계정의 다른 PDF 분석이 진행 중입니다. 완료 후 다시 시도하세요.',code:'BUSY'}});
    if(admitted.kind==='TERMINAL')return req.body?.async===true?res.status(200).json(admitted.job):syncResult(res,admitted.job);
    if(admitted.kind==='REUSED'){
      if(req.body?.async===true)return res.status(202).json(admitted.job);
      return syncResult(res,await waitForJob(uid,admitted.job.jobId));
    }
    const key=process.env.ANTHROPIC_API_KEY;
    if(!key){
      const failed=await finishPackingPdfJob(uid,admitted.job.jobId,admitted.token,{error:{message:'서버의 PDF 분석 서비스가 설정되지 않았습니다.'}});
      return res.status(503).json({error:failed?.error||{message:'서버의 PDF 분석 서비스가 설정되지 않았습니다.'}});
    }
    try{await reservePackingPdfRequest(uid);}catch(e){
      await finishPackingPdfJob(uid,admitted.job.jobId,admitted.token,{error:{message:e.statusCode===429?e.message:'PDF 분석 요청을 준비하지 못했습니다.'}});
      if(e.retryAfter)res.setHeader('Retry-After',e.retryAfter);
      return res.status(e.statusCode||503).json({error:{message:e.statusCode===429?e.message:'PDF 분석 요청을 준비하지 못했습니다. 잠시 후 다시 시도하세요.'}});
    }
    const task=executeProviderOnce({uid,jobId:admitted.job.jobId,token:admitted.token,cacheKey,parsed,prompt,key});
    if(req.body?.async===true){res.status(202).json(admitted.job);void task;return;}
    return syncResult(res,await task);
  }catch{return res.status(503).json(storageError);}
});
