import {withAuth} from '../../../../lib/auth';
import {validatePackingPdf} from '../../../../lib/importTeamPdf';
import {buildPrompt} from '../../../../lib/importPackingPrompt';
import {trackLLMCall} from '../../../../lib/chat/costTracker';
import {reservePackingPdfRequest} from '../../../../lib/importTeamPdfQuota';
import {packingPdfCacheKey,readPackingPdfCache,writePackingPdfCache,PDF_ANALYSIS_MODEL} from '../../../../lib/importTeamPdfCache';
export const config={api:{bodyParser:{sizeLimit:'30mb'},responseLimit:'10mb'}};
const running=new Set();
export default withAuth(async(req,res)=>{
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:{message:'POST 요청만 지원합니다.'}});}
  let parsed;
  try{parsed=validatePackingPdf(req.body);}catch(e){return res.status(e.statusCode||400).json({error:{message:e.message}});}
  if(req.user?.userId==null || !String(req.user.userId).trim())return res.status(401).json({error:{message:'사용자 인증 정보를 확인할 수 없습니다. 다시 로그인하세요.'}});
  const uid=String(req.user.userId);
  const prompt=buildPrompt(parsed.country);
  const cacheKey=packingPdfCacheKey({...parsed,prompt});
  res.setHeader('Cache-Control','private, no-store');
  const cached=await readPackingPdfCache(uid,cacheKey);
  if(cached)return res.json({...cached,source:'cache'});
  const key=process.env.ANTHROPIC_API_KEY;
  if(!key)return res.status(503).json({error:{message:'서버의 PDF 분석 서비스가 설정되지 않았습니다.'}});
  if(running.has(uid))return res.status(429).json({error:{message:'이 계정의 PDF 분석이 진행 중입니다. 완료 후 다시 시도하세요.'}});
  running.add(uid);
  try{
    try{await reservePackingPdfRequest(uid);}catch(e){if(e.retryAfter)res.setHeader('Retry-After',e.retryAfter);return res.status(e.statusCode||503).json({error:{message:e.statusCode===429?e.message:'PDF 분석 요청을 준비하지 못했습니다. 잠시 후 다시 시도하세요.'}});}
    const response=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',headers:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},signal:AbortSignal.timeout(180000),
      body:JSON.stringify({model:PDF_ANALYSIS_MODEL,max_tokens:64000,system:prompt,messages:[{role:'user',content:[{type:'document',source:{type:'base64',media_type:'application/pdf',data:parsed.pdfBase64}},{type:'text',text:'Extract all invoices from this PDF. Return ONLY the JSON object, no other text.'}]}]})
    });
    if(!response.ok)return res.status(response.status===429?429:502).json({error:{message:response.status===429?'PDF 분석 요청이 많습니다. 잠시 후 다시 시도하세요.':'PDF 분석 서비스 요청에 실패했습니다. 원본은 유지됩니다.'}});
    const data=await response.json();
    trackLLMCall({userId:uid,model:'claude-sonnet-4-6',inputTokens:data.usage?.input_tokens||0,outputTokens:data.usage?.output_tokens||0,purpose:'import-team-packing-pdf'});
    let cacheSaved=false;
    try{cacheSaved=await writePackingPdfCache(uid,cacheKey,parsed.country,data);}catch{ /* Analysis still succeeded; never charge again automatically. */ }
    return res.json({content:data.content,stop_reason:data.stop_reason,source:'ai',cacheSaved});
  }catch(e){return res.status(e.name==='TimeoutError'?504:502).json({error:{message:'PDF 분석을 완료하지 못했습니다. 파일은 유지됩니다. 잠시 후 다시 시도하세요.'}});}
  finally{running.delete(uid);}
});
