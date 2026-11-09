import {inspectInvoiceLocal} from './importInvoiceLocal.js';
import {inspectChinaPdfInvoice} from './importChinaPdfInvoice.js';
import {readPackingPdfResponse} from './importPackingState.js';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const validJobId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
// Memory-only reference for the same source. No localStorage or automatic paid retry.
let pendingJob = null;
let localSourceEvidence = null;
function failedJobError(data) {
  const error=new Error(data.error?.message || 'PDF 분석이 중단되었습니다. 파일은 유지됩니다.');
  error.pdfJobTerminal=true;
  if (data.error?.code==='PDF_ANALYSIS_UNCERTAIN' && validJobId(data.retryJobId || data.error?.retryJobId)) {
    error.pdfRetryJobId=data.retryJobId || data.error.retryJobId;
  }
  return error;
}

export async function waitForPackingPdfJob({jobId, fetchImpl=globalThis.fetch, onProgress=()=>{}, sleep=wait, now=Date.now, timeoutMs=11*60*1000}) {
  if (!validJobId(jobId)) throw new Error('PDF 분석 작업 번호가 올바르지 않습니다. 파일은 유지됩니다.');
  const started = now();
  let limit=timeoutMs;
  for (let attempt=0; attempt<7921 && now()-started<=limit; attempt++) {
    onProgress({stage:'ANALYZING', elapsedSeconds:Math.floor((now()-started)/1000), jobId});
    let data, response;
    try {
      response = await fetchImpl(`/api/import/tools/parse-pdf?jobId=${encodeURIComponent(jobId)}`, {
        method:'GET', cache:'no-store', signal:AbortSignal.timeout(20000),
      });
    } catch {
      throw new Error('PDF 분석 결과를 조회하지 못했습니다. 서버 분석이 계속될 수 있습니다. 파일을 유지한 채 다시 분석 버튼을 누르면 같은 작업 결과부터 확인합니다.');
    }
    if ([401,403,404].includes(response.status)) {
      const error = new Error(response.status===404 ? 'PDF 분석 작업을 찾을 수 없습니다. 파일을 유지한 채 다시 분석을 요청하세요.' : 'PDF 분석 결과 조회 권한을 확인할 수 없습니다. 로그인 상태를 확인하세요.');
      error.pdfJobTerminal=true;
      throw error;
    }
    try { data=await readPackingPdfResponse(response); }
    catch { throw new Error('PDF 분석 결과 조회가 지연되거나 실패했습니다. 파일은 유지됩니다. 다시 분석 버튼으로 기존 결과부터 확인하세요.'); }
    if (data.status==='SUCCEEDED' && data.result) return data.result;
    if (data.status==='FAILED') {
      throw failedJobError(data);
    }
    if (data.status!=='RUNNING') throw new Error('PDF 분석 상태를 확인할 수 없습니다. 파일은 유지됩니다. 다시 결과를 확인하세요.');
    if(data.progress&&Number.isInteger(data.progress.total)&&data.progress.total>=1&&data.progress.total<=24){
      limit=Math.max(timeoutMs,data.progress.total*11*60*1000);
      onProgress({stage:data.progress.stage,elapsedSeconds:Math.floor((now()-started)/1000),jobId,...data.progress});
    }
    await sleep(2000);
  }
  throw new Error('PDF 분석 결과 대기 시간이 지났습니다. 파일은 유지됩니다. 다시 분석 버튼을 누르면 기존 작업 결과부터 확인합니다.');
}

/** No external AI request without the caller's explicit allowAI action. */
export async function extractPackingDocument({country,pdfBase64,awbPdfBase64=null,readPdf,allowAI=false,fetchImpl=globalThis.fetch,onProgress=()=>{},sleep=wait,now=Date.now,retryJobId=null}) {
  if(!allowAI){
    if(['NL','CN'].includes(country)&&typeof readPdf==='function'){
      try{
        const input=await readPdf(pdfBase64);
        localSourceEvidence={pdfBase64,country,input};
        const parsed=country==='CN'?inspectChinaPdfInvoice(input):inspectInvoiceLocal(input,{country});
        if(parsed.result)return {data:{content:[{type:'text',text:JSON.stringify(parsed.result)}],stop_reason:'end_turn'},source:'local',localSource:input};
        return {needsAI:true,reason:parsed.reason||'UNSUPPORTED_LAYOUT'};
      }catch{return {needsAI:true,reason:'LOCAL_PDF_READ_FAILED'};}
    }
    return {needsAI:true,reason:'UNSUPPORTED_LAYOUT'};
  }
  if (retryJobId!==null && !validJobId(retryJobId)) throw new Error('재분석 대상 작업 번호가 올바르지 않습니다.');
  let job = !retryJobId && pendingJob?.country===country && pendingJob?.pdfBase64===pdfBase64
    && pendingJob?.awbPdfBase64===awbPdfBase64 ? pendingJob : null;
  try {
    let data;
    if (!job) {
      onProgress({stage:'SUBMITTING',elapsedSeconds:0});
      const response=await fetchImpl('/api/import/tools/parse-pdf',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({country,pdfBase64,...(awbPdfBase64?{awbPdfBase64}:{}),async:true,...(retryJobId?{retryJobId}:{})}),
        signal:AbortSignal.timeout(45000),
      });
      data=await readPackingPdfResponse(response);
      if (response.status===202 || data.status==='RUNNING') {
        if (!validJobId(data.jobId)) throw new Error('PDF 분석 작업 번호를 받지 못했습니다. 파일은 유지됩니다.');
        job = pendingJob = {country,pdfBase64,awbPdfBase64,jobId:data.jobId};
      } else if (data.status==='SUCCEEDED' && data.result) data=data.result;
      else if (data.status==='FAILED') throw failedJobError(data);
    }
    if (job) data=await waitForPackingPdfJob({jobId:job.jobId,fetchImpl,onProgress,sleep,now});
    if (pendingJob===job) pendingJob=null;
    return {data,source:data.source==='cache'?'cache':'ai',cacheSaved:data.cacheSaved,
      localSource:localSourceEvidence?.pdfBase64===pdfBase64&&localSourceEvidence?.country===country?localSourceEvidence.input:null};
  } catch(error) {
    if (error.pdfJobTerminal && pendingJob===job) pendingJob=null;
    throw error;
  }
}
