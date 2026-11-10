// Real provider extraction only: no DB imports, old receipts, manual labels or retries.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildPrompt} from '../lib/importPackingPrompt.js';
import {splitPackingPdf,chunkExtractionPrompt,runPackingChunks} from '../lib/importPackingPdfChunks.js';
import {readPackingProviderResponse} from '../lib/importPackingProviderStream.js';
const root='.verify/co46-live-ai', model='claude-sonnet-4-6';
assert.ok(process.env.ANTHROPIC_API_KEY,'ANALYSIS_KEY_REQUIRED');
assert.ok(!Object.keys(process.env).some(k=>/^(DB_|MSSQL|SQL_)/.test(k)),'DB_CONFIGURATION_FORBIDDEN');
const bytes=await fs.readFile(root+'/source.pdf'),sourceHash=createHash('sha256').update(bytes).digest('hex');
assert.equal(sourceHash,'d892c13ac311aefbd0f58fcc8c6f2724aef60493256922087215a929ec34b0cf');
const plan=await splitPackingPdf(bytes.toString('base64'));assert.equal(plan.length,6);
let calls=0;
const result=await runPackingChunks({plan,sourceHash,load:async()=>null,claim:async()=>{},
 saveResponse:async(i,pages,data)=>fs.writeFile(`${root}/segment-${i+1}.response.json`,JSON.stringify({pages,data})),
 save:async(i,pages,result)=>fs.writeFile(`${root}/segment-${i+1}.parsed.json`,JSON.stringify({pages,result})),
 onProgress:async p=>console.log(JSON.stringify({stage:p.stage,completed:p.completed,total:p.total,current:p.current})),
 analyze:async(chunk)=>{
  assert.ok(++calls<=6,'SIX_CALL_LIMIT');
  const response=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',
   headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},signal:AbortSignal.timeout(180000),
   body:JSON.stringify({model,stream:true,max_tokens:24000,system:buildPrompt('CO')+chunkExtractionPrompt(chunk.pages),
    messages:[{role:'user',content:[{type:'document',source:{type:'base64',media_type:'application/pdf',data:chunk.pdfBase64}},{type:'text',text:'Extract only this source segment. Return complete JSON.'}]}]})});
  if(!response.ok)throw Error('PROVIDER_HTTP_'+response.status);
  return readPackingProviderResponse(response);
 }});
await fs.writeFile(root+'/merged.response.json',JSON.stringify(result));
const parsed=JSON.parse(result.content.filter(b=>b.type==='text').map(b=>b.text).join(''));
const rows=parsed.invoices.flatMap(i=>i.products);
const report={sourceHash,model,calls,pages:16,invoices:parsed.invoices.length,rows:rows.length,
 boxes:rows.reduce((s,r)=>s+Number(r.pcs||0),0),stems:rows.reduce((s,r)=>s+Number(r.total_stems||0),0),
 goods:rows.reduce((s,r)=>s+Number(r.t_price||0),0),freshAI:true,receiptInputsUsed:false,productionDbUsed:false};
await fs.writeFile(root+'/analysis-report.json',JSON.stringify(report));console.log(JSON.stringify(report));
