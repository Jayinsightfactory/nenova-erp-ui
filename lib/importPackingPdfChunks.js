import {PDFDocument} from 'pdf-lib';

export const PACKING_CHUNK_VERSION='co-chunks-v1';
export const PACKING_CHUNK_MAX=24;
const fail=(message,diagnostic='VALIDATION')=>{throw Object.assign(new Error(message),{code:'PDF_CHUNK_VALIDATION',diagnostic});};
const norm=value=>String(value??'').normalize('NFKC').trim().replace(/\s+/g,' ').toUpperCase();

export async function splitPackingPdf(pdfBase64,{pagesPerChunk=3}={}){
  if(!Number.isInteger(pagesPerChunk)||pagesPerChunk<1||pagesPerChunk>3)fail('PDF 분할 범위가 올바르지 않습니다.');
  const source=await PDFDocument.load(Buffer.from(pdfBase64,'base64'),{updateMetadata:false});
  const count=source.getPageCount();
  if(count<1||Math.ceil(count/pagesPerChunk)>PACKING_CHUNK_MAX)fail('PDF는 최대 72쪽까지 분할 분석할 수 있습니다. 파일을 나누어 주세요.');
  const chunks=[];
  for(let start=0;start<count;start+=pagesPerChunk){
    const pages=Array.from({length:Math.min(pagesPerChunk,count-start)},(_,i)=>start+i+1);
    const document=await PDFDocument.create();
    for(const page of await document.copyPages(source,pages.map(p=>p-1)))document.addPage(page);
    chunks.push({pages,pdfBase64:await document.saveAsBase64({useObjectStreams:false})});
  }
  return chunks;
}

export function chunkExtractionPrompt(pages){
  return `\nBOUNDED SOURCE SEGMENT: original pages ${pages.join(', ')}. Evidence page numbers MUST be local 1-based pages in this attached segment. Extract ONLY rows visible here. An invoice continuing outside this segment must retain its exact printed supplier, invoice number and currency; do not invent missing totals or rows. For continuation fragments, invoice_total and freight_total MUST be null if not printed in this segment (never use a fabricated zero); do not copy any rows from outside this segment. Return invoices:[] for manifest-only/supporting pages.
MANDATORY PAGE COVERAGE JSON CONTRACT:
The top-level covered_pages array must have EXACTLY ${pages.length} objects, one for EACH local page ${pages.map((_,i)=>i+1).join(', ')} without duplicates. Each object MUST use these exact keys: {"page":1,"kind":"invoice"}. page is an INTEGER local page number, NOT an original/global page number. kind is exactly one of "invoice", "manifest", "supporting". Include blank/certificate/AWB pages as supporting; never omit them. Do not use strings, page ranges, original page labels, or alternative field names.
Add manifest_invoices:[{invoice:"exact printed invoice number or null",supplier:"exact printed exporter/farm"}] for EVERY manifest entry when a manifest is present. A farm-only manifest is valid; never infer missing invoice numbers. Return complete JSON only; no partial recovery.`;
}

function remap(value,pages){
  if(Array.isArray(value))return value.map(v=>remap(v,pages));
  if(!value||typeof value!=='object')return value;
  const out={};
  for(const [key,v] of Object.entries(value)){
    if(key==='page'&&v!=null){
      if(!Number.isInteger(v)||v<1||v>pages.length)fail('PDF 원문 페이지 근거가 분할 범위와 다릅니다.');
      out[key]=pages[v-1];
    }else out[key]=remap(v,pages);
  }
  return out;
}

// Accept a single COMPLETE JSON object surrounded by prose/Markdown. Never close
// brackets, fix numeric values or recover the last complete invoice from a prefix.
export function readCompletePackingJson(text){
  const input=String(text).replace(/^\uFEFF/,'').trim();
  try{const value=JSON.parse(input);if(value&&typeof value==='object'&&!Array.isArray(value))return value;}
  catch{/* Inspect only a complete object below. */}
  const start=input.indexOf('{');
  if(start<0)fail('저장 응답에 JSON 객체가 없습니다.','JSON_OBJECT_MISSING');
  const stack=[];let quoted=false,escape=false,end=-1;
  for(let i=start;i<input.length;i++){
    const c=input[i];
    if(quoted){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')quoted=false;continue;}
    if(c==='"'){quoted=true;continue;}
    if(c==='{'||c==='[')stack.push(c);
    else if(c==='}'||c===']'){
      if(stack.pop()!==(c==='}'?'{':'['))fail('저장 응답의 JSON 괄호 형식이 올바르지 않습니다.','JSON_SYNTAX');
      if(!stack.length){end=i+1;break;}
    }
  }
  if(end<0||quoted)fail('저장 응답의 JSON이 끝까지 도착하지 않았습니다. 부분 결과는 사용하지 않습니다.','JSON_UNTERMINATED');
  if(/[{}\[\]]/.test(input.slice(0,start)+input.slice(end)))fail('응답에 JSON 객체가 여러 개이거나 배열 포장이 있습니다. 자동 합치지 않습니다.','JSON_MULTIPLE_OBJECTS');
  try{return JSON.parse(input.slice(start,end));}
  catch{fail('저장 응답의 JSON 문법이 올바르지 않습니다. 수량·금액을 임의 수정하지 않습니다.','JSON_SYNTAX');}
}

export function parsePackingChunk(data,pages){
  if(data?.stop_reason!=='end_turn')fail('PDF 구간 분석이 끝까지 완료되지 않았습니다.');
  const text=(data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('').trim();
  const result=readCompletePackingJson(text);
  if(!Array.isArray(result.invoices)||!Array.isArray(result.covered_pages))fail('PDF 구간의 송장·페이지 확인 결과가 없습니다.');
  const coverage=result.covered_pages;
  if(coverage.some(p=>!p||typeof p!=='object'||Array.isArray(p)||!Number.isInteger(p.page)||!['invoice','manifest','supporting'].includes(p.kind)))fail('AI 응답의 페이지 확인 형식이 다릅니다. 원본 PDF 누락을 뜻하지 않습니다. 분석 결과 형식을 확인해야 합니다.');
  if(coverage.length!==pages.length)fail(`AI 응답의 페이지 확인 수가 다릅니다 (필요 ${pages.length}쪽 · 응답 ${coverage.length}쪽). 원본 누락 여부는 아직 확인되지 않았습니다.`);
  if(new Set(coverage.map(p=>p.page)).size!==pages.length)fail('AI 응답의 페이지 번호가 중복되었습니다. 원본 PDF 누락을 뜻하지 않습니다.');
  if(coverage.some(p=>p.page<1||p.page>pages.length))fail(`AI 응답은 이 구간의 1~${pages.length}쪽 번호를 사용해야 합니다. 원본 페이지 번호와 혼동했는지 확인해야 합니다.`);
  if(coverage.some(p=>p.kind==='invoice')&&!result.invoices.length)fail('상품 페이지에서 송장을 추출하지 못했습니다.');
  if(coverage.some(p=>p.kind==='manifest')&&(!Array.isArray(result.manifest_invoices)||!result.manifest_invoices.length))fail('운송 명세서의 송장 목록을 확인하지 못했습니다.');
  return remap(result,pages);
}

const numeric=value=>value!=null&&value!==''&&typeof value!=='boolean'&&Number.isFinite(Number(value));
export function mergePackingChunks(chunks,pageCount){
  const allPages=chunks.flatMap(c=>c.pages);
  if(allPages.length!==pageCount||allPages.some((p,i)=>p!==i+1))fail('PDF 전체 페이지가 순서대로 완료되지 않았습니다.');
  const invoices=new Map(),manifest=new Map();let masterAwb=null;
  for(const {result} of chunks){
    if(result.master_awb){if(masterAwb&&norm(masterAwb)!==norm(result.master_awb))fail('구간별 공동 AWB가 서로 다릅니다.');masterAwb=result.master_awb;}
    for(const entry of result.manifest_invoices||[]){
      if(!norm(entry.invoice)&&!norm(entry.supplier))fail('명세서의 송장 번호 또는 농장을 확인해야 합니다.');
      manifest.set(JSON.stringify([norm(entry.invoice),norm(entry.supplier)]),entry);
    }
    for(const invoice of result.invoices){
      if(!norm(invoice.invoice)||!norm(invoice.supplier)||!norm(invoice.currency)||!Array.isArray(invoice.products)||!invoice.products.length)fail('농장·송장·통화·품목을 확인하지 못했습니다.');
      const key=JSON.stringify([norm(invoice.supplier),norm(invoice.invoice),norm(invoice.currency)]);
      const previous=invoices.get(key);
      if(!previous){invoices.set(key,structuredClone(invoice));continue;}
      for(const field of ['invoice_total','freight_total','date','awb','currency']){
        const a=previous[field],b=invoice[field];
        if(a!=null&&b!=null&&norm(a)!==norm(b))fail('같은 송장의 구간별 총액·일자·운임이 서로 다릅니다.');
        if(a==null&&b!=null)previous[field]=b;
      }
      // Identical source rows on the same original page are duplicates, not extra quantity.
      const seen=new Set(previous.products.map(row=>JSON.stringify(row)));
      for(const row of invoice.products){if(seen.has(JSON.stringify(row)))fail('같은 송장에 중복 상품행이 있습니다.');previous.products.push(structuredClone(row));}
      for(const field of ['metadata_evidence','review_evidence']){
        previous[field]={...previous[field]};
        for(const [name,evidence] of Object.entries(invoice[field]||{})){
          if(!previous[field][name]||evidence?.page!=null)previous[field][name]=evidence;
        }
      }
    }
  }
  if(!invoices.size)fail('PDF에서 상품 송장을 찾지 못했습니다.');
  const values=[...invoices.values()];
  for(const invoice of values){
    if(!numeric(invoice.invoice_total)||!numeric(invoice.freight_total)||invoice.products.some(row=>!numeric(row.t_price)||Number(row.t_price)<0))fail('송장 인쇄 총액·상품 금액·부대비를 확인해야 합니다.');
    const sum=invoice.products.reduce((a,row)=>a+Number(row.t_price),0)+Number(invoice.freight_total);
    if(Math.abs(sum-Number(invoice.invoice_total))>0.02)fail('상품 금액과 부대비 합계가 인보이스 총액과 다릅니다. 부분 결과는 입고에 사용하지 않습니다.');
  }
  if(manifest.size){
    const matched=new Set();
    for(const entry of manifest.values()){
      const matches=values.filter(i=>norm(entry.invoice)?norm(i.invoice)===norm(entry.invoice):norm(i.supplier)===norm(entry.supplier));
      if(matches.length!==1||matched.has(matches[0]))fail('명세서와 추출 송장 목록이 다릅니다. 누락·중복 송장을 확인해야 합니다.');
      matched.add(matches[0]);
    }
    if(matched.size!==values.length)fail('명세서와 추출 송장 목록이 다릅니다. 누락·중복 송장을 확인해야 합니다.');
  }
  return {content:[{type:'text',text:JSON.stringify({...(masterAwb?{master_awb:masterAwb}:{}),invoices:values})}],stop_reason:'end_turn'};
}

// Dependencies are explicit so tests cannot accidentally call a paid provider.
export async function runPackingChunks({plan,load,claim,analyze,save,saveResponse=async()=>{},invalidate=async()=>{},onProgress=async()=>{}}){
  const completed=[];
  for(let index=0;index<plan.length;index++){
    const chunk=plan[index];
    let result=await load(index,chunk.pages);
    if(!result){
      await claim(index,chunk.pages);
      await onProgress({completed:index,total:plan.length,current:index+1,stage:'ANALYZING'});
      const data=await analyze(chunk,index);
      await saveResponse(index,chunk.pages,data);
      result=parsePackingChunk(data,chunk.pages);
      await save(index,chunk.pages,result);
    }
    completed.push({pages:chunk.pages,result});
    await onProgress({completed:index+1,total:plan.length,current:index+1,stage:'ANALYZING'});
  }
  await onProgress({completed:plan.length,total:plan.length,current:plan.length,stage:'VALIDATING'});
  try{return mergePackingChunks(completed,plan.flatMap(c=>c.pages).length);}
  catch(error){
    // Extracted JSON is not a validated segment when whole-file reconciliation
    // fails. Do not trap a confirmed retry in an endless replay of bad values.
    for(let index=0;index<plan.length;index++)await invalidate(index,plan[index].pages);
    throw error;
  }
}
