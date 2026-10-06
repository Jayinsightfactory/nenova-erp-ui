import {inspectInvoiceLocal} from './importInvoiceLocal.js';
import {readPackingPdfResponse} from './importPackingState.js';

/** No external AI request without the caller's explicit allowAI action. */
export async function extractPackingDocument({country,pdfBase64,readPdf,allowAI=false,fetchImpl=globalThis.fetch}) {
  if(!allowAI){
    if(country==='NL'&&typeof readPdf==='function'){
      try{
        const parsed=inspectInvoiceLocal(await readPdf(pdfBase64),{country});
        if(parsed.result)return {data:{content:[{type:'text',text:JSON.stringify(parsed.result)}],stop_reason:'end_turn'},source:'local'};
        return {needsAI:true,reason:parsed.reason||'UNSUPPORTED_LAYOUT'};
      }catch{return {needsAI:true,reason:'LOCAL_PDF_READ_FAILED'};}
    }
    return {needsAI:true,reason:'UNSUPPORTED_LAYOUT'};
  }
  const response=await fetchImpl('/api/import/tools/parse-pdf',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({country,pdfBase64}),
  });
  const data=await readPackingPdfResponse(response);
  return {data,source:data.source==='cache'?'cache':'ai',cacheSaved:data.cacheSaved};
}
