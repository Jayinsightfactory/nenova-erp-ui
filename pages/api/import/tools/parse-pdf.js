import {withAuth} from '../../../../lib/auth';
import {readPackingProviderResponse,packingProviderFailureCode} from '../../../../lib/importPackingProviderStream';
import {validatePackingPdf} from '../../../../lib/importTeamPdf';
import {buildPrompt} from '../../../../lib/importPackingPrompt';
import {trackLLMCall} from '../../../../lib/chat/costTracker';
import {reservePackingPdfRequest} from '../../../../lib/importTeamPdfQuota';
import {packingPdfCacheKey,readPackingPdfCache,writePackingPdfCache,PDF_ANALYSIS_MODEL} from '../../../../lib/importTeamPdfCache';
import {PDF_JOB_TIMEOUT_MS,getPackingPdfJob,findPackingPdfJobByKey,startPackingPdfJob,markPackingPdfAttempt,finishPackingPdfJob,markPackingPdfCacheSaved} from '../../../../lib/importTeamPdfJobs';
import {doclingApplies,doclingWaitMs,doclingPdfSha,readDoclingResult,enqueueDoclingJob,waitForDoclingResult,buildDoclingPromptBlock,checkTablesArithmetic,appendDoclingMetrics} from '../../../../lib/importDoclingBridge';

export const config={api:{bodyParser:{sizeLimit:'55mb'},responseLimit:'10mb'}};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const storageError={error:{message:'PDF 분석 작업 저장소를 사용할 수 없습니다. 파일을 유지하고 잠시 후 다시 확인하세요.'}};

// docling 전처리(기술레이더 1호): owner PC 워커가 뽑은 "후보 표"를 시스템 프롬프트에 주입.
// PDF는 증거(page/quote/bbox) 계약 때문에 항상 그대로 첨부하며, 워커가 늦거나 죽으면 블록 없이 기존 그대로 진행(무해 폴백).
async function acquireDoclingBlock(parsed){
  const startedAt=Date.now();
  try{
    const pdfSha=doclingPdfSha(parsed.pdfBase64);
    let record=await readDoclingResult(pdfSha);
    if(!record){
      await enqueueDoclingJob({pdfBase64:parsed.pdfBase64,country:parsed.country});
      record=await waitForDoclingResult(pdfSha,doclingWaitMs());
    }
    if(record&&record.ok!==false&&record.markdown){
      const arith=checkTablesArithmetic(record.tables);
      return {block:buildDoclingPromptBlock(record),meta:{used:true,waitMs:Date.now()-startedAt,doclingSec:record.sec,arithChecked:arith.checked,arithFlagged:arith.flagged.length}};
    }
    return {block:'',meta:{used:false,waitMs:Date.now()-startedAt,reason:record?'docling-failed':'timeout'}};
  }catch(e){
    return {block:'',meta:{used:false,waitMs:Date.now()-startedAt,reason:'error',error:String(e?.message||e).slice(0,200)}};
  }
}

async function executeProviderOnce({uid,jobId,token,cacheKey,parsed,prompt,key,useDocling}) {
  let dispatched=false;
  try{
    if(!await markPackingPdfAttempt(uid,jobId,token))return null;
    dispatched=true;
    const docling=useDocling?await acquireDoclingBlock(parsed):{block:'',meta:{used:false,reason:'flag-off-or-nl'}};
    const documents=[{type:'document',source:{type:'base64',media_type:'application/pdf',data:parsed.pdfBase64}},
      ...(parsed.awbPdfBase64?[{type:'document',source:{type:'base64',media_type:'application/pdf',data:parsed.awbPdfBase64}}]:[])];
    const response=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',headers:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},signal:AbortSignal.timeout(PDF_JOB_TIMEOUT_MS),
      body:JSON.stringify({model:PDF_ANALYSIS_MODEL,stream:true,max_tokens:64000,system:prompt+docling.block,messages:[{role:'user',content:[...documents,{type:'text',text:parsed.awbPdfBase64
        ?'The first PDF is the commercial invoice and the second PDF is its supporting AWB. Extract the invoice and the AWB fields requested by the system instructions, keep the sources separate, and return ONLY the JSON object, no other text.'
        :'Extract all invoices from this PDF. Return ONLY the JSON object, no other text.'}]}]})
    });
    if(!response.ok){
      return await finishPackingPdfJob(uid,jobId,token,{error:{message:response.status===429?'PDF 분석 요청이 많습니다. 파일은 유지됩니다. 추가 비용을 확인한 뒤 다시 분석하세요.':'PDF 분석 서비스 요청에 실패했습니다. 파일은 유지됩니다. 추가 비용을 확인한 뒤 다시 분석하세요.',code:'PDF_ANALYSIS_UNCERTAIN'}});
    }
    const data=await readPackingProviderResponse(response);
    trackLLMCall({userId:uid,model:'claude-sonnet-4-6',inputTokens:data.usage?.input_tokens||0,outputTokens:data.usage?.output_tokens||0,purpose:'import-team-packing-pdf'});
    // 전/후 비교 로그(2주 수집): 전처리 사용 여부·대기시간·산술검증 통계·토큰. 실패해도 본 흐름 영향 없음.
    void appendDoclingMetrics({country:parsed.country,docling:docling.meta,inputTokens:data.usage?.input_tokens||0,outputTokens:data.usage?.output_tokens||0,stopReason:data.stop_reason});
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
    console.error('[packing-pdf-provider]',JSON.stringify({jobId,code:packingProviderFailureCode(e)}));
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
  const uid=String(req.user.userId),prompt=buildPrompt(parsed.country,{awbDocument:Boolean(parsed.awbPdfBase64)});
  // docling 전처리 여부가 결과에 영향 줄 수 있으므로 캐시 키를 분리(끄면 기존 키 그대로 = 전/후 캐시 오염 없음).
  const useDocling=doclingApplies(parsed.country);
  const cacheKey=packingPdfCacheKey({...parsed,prompt:useDocling?prompt+'\n[docling-preprocess-v1]':prompt});
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
    const task=executeProviderOnce({uid,jobId:admitted.job.jobId,token:admitted.token,cacheKey,parsed,prompt,key,useDocling});
    if(req.body?.async===true){res.status(202).json(admitted.job);void task;return;}
    return syncResult(res,await task);
  }catch{return res.status(503).json(storageError);}
});
