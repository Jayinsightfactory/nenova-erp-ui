import {inspectColombia461Local} from './importColombia461Local.js';
import {stemsPerBunchCO} from './importPacking.js';
const norm=x=>String(x??'').trim().toUpperCase();
const fail=message=>{throw new Error(message);};
export function prepareColombiaFreeRecovery(evidence){
 const parsed=inspectColombia461Local(evidence);
 if(!parsed.result)fail(parsed.reason||'무료 OCR 결과를 원본과 대조하지 못했습니다.');
 const report=parsed.result;
 const normalized=report.invoices.map(inv=>{
 const sourceItems=evidence.pages[inv.pages[0]-1].items;
 const sourceText=sourceItems.map(x=>x.str).join(' ');
 const raw_date=sourceText.match(/2026[-/]11[-/]0?6|0?6[\/.]11[\/.](?:20)?26|0?6\/NOVEMBER\/2026|06-NOV\.?-2026|11\/0?6\/2026/i)?.[0]||null;
 const currencyQuote=sourceText.match(/\bUSD\b|US\$|D[oó]lares|Dollars/i)?.[0]||'';
 const date_order=raw_date?.startsWith('2026')?'YMD':raw_date?.startsWith('11/')?'MDY':'DMY';
 return {
  invoice:inv.invoice,supplier:inv.supplier,currency:'USD',date:'2026/11/06',raw_date,date_kind:'invoice',date_order,
  awb:'865-14699602',master_awb:'865-14699602',invoice_total:inv.printedTotal,freight_total:inv.charges,
  source_page:inv.pages[0],source_box_total:inv.printedPieces,pdfSourceHash:evidence.sourceHash,pdfReviewRequired:true,
  products:inv.products.map((p,index)=>{
   const sourceName=p.description;
   const familyName=inv.supplier==='VERDNATURA'?'CARNATION '+sourceName:sourceName;
   const explicit=p.bunches>0?p.stems/p.bunches:Number(sourceName.match(/(?:x|\*)\s*(\d+)\s*Stems/i)?.[1])||null;
   const ratio=explicit||stemsPerBunchCO(familyName,null);
   return {description:sourceName,source_description:sourceName,pcs:p.pieces??0,steam_box:p.pieces>0?p.stems/p.pieces:0,
    bunch_st:ratio||1,total_stems:p.stems,u_price:p.unitPricePerStem,t_price:p.amount,source_page:p.sourcePage,source_row:index+1,
    ...(ratio?{}:{unit_review_required:true}),
    review_evidence:{description:{page:p.sourcePage,quote:p.raw_quote||'',bbox:null},total_stems:{page:p.sourcePage,quote:p.raw_quote||'',bbox:null},t_price:{page:p.sourcePage,quote:p.raw_quote||'',bbox:null}}};
  }),
  metadata_evidence:{invoice_total:{page:inv.pages[1],quote:'',bbox:null},date:{page:inv.pages[0],quote:raw_date||'',bbox:null},currency:{page:inv.pages[0],quote:currencyQuote,bbox:null}}
 };});
 const plan=Array.from({length:15},(_,index)=>{const pages=Array.from({length:Math.min(3,43-index*3)},(_,i)=>index*3+i+1);return {index,pages,result:{covered_pages:pages.map(page=>({page,kind:page===1?'manifest':normalized.some(x=>x.source_page===page)?'invoice':'supporting'})),invoices:normalized.filter(x=>pages.includes(x.source_page))}};});
 function merge(chunks,pageCount){
  const pages=chunks.flatMap(c=>c.pages);if(pageCount!==43||pages.length!==43||pages.some((p,i)=>p!==i+1))fail('무료 복구 페이지가 누락·중복되었습니다.');
  const invoices=chunks.flatMap(c=>c.result.invoices||[]),ids=new Set();
  for(const actual of invoices){
   const expected=report.invoices.find(x=>norm(x.invoice)===norm(actual.invoice));
   if(!expected||ids.has(norm(actual.invoice))||norm(actual.currency)!=='USD')fail('기존 완료 구간과 무료 복구 송장 목록이 다릅니다.');ids.add(norm(actual.invoice));
   const products=actual.products||[];
   const sum=products.reduce((n,p)=>n+Number(p.t_price),0)+Number(actual.freight_total);
   const stems=products.reduce((n,p)=>n+(p.total_stems!=null?Number(p.total_stems):Number(p.pcs)*Number(p.steam_box)),0);
   if(!Number.isFinite(sum)||!Number.isFinite(stems)||Math.abs(sum-expected.printedTotal)>.011||stems!==expected.printedStems||Number(actual.invoice_total)!==expected.printedTotal)fail('기존 완료 구간 또는 무료 복구의 수량·총액이 원본과 다릅니다. 완료 구간은 수정하지 않았습니다.');
  }
  if(ids.size!==31)fail('전체31개 송장을 모두 확인하지 못했습니다.');
  return {content:[{type:'text',text:JSON.stringify({master_awb:'865-14699602',invoices,free_ocr_review_issues:report.manifestIssues})}],stop_reason:'end_turn',source:'free-ocr',cacheSaved:false};
 }
 return {plan,merge,reviewIssues:report.manifestIssues};
}
