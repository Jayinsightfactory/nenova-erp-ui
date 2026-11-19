// Pure pre-receipt review. Never calls a provider, DB, or edits source files.
import {normalizePackingMetadata} from './importPackingMetadata.js';
export const AMOUNT_REVIEW_CODE='PACKING_AMOUNT_REVIEW_REQUIRED';
export const REVIEW_FIELDS=['description','pcs','total_bunch','total_stems','u_price','t_price'];
const number=v=>v!==null&&v!==undefined&&v!==''&&typeof v!=='boolean'&&Number.isFinite(Number(v))?Number(v):NaN;
export function suspectedSummaryRows(invoice){
 const rows=invoice?.products||[];if(rows.length<2)return [];
 return rows.flatMap((row,index)=>Math.abs(number(row.t_price)-number(invoice.invoice_total))<=.02
  &&Math.abs(rows.reduce((s,r,i)=>i===index?s:s+number(r.t_price),0)-number(invoice.invoice_total))<=.02?[index]:[]);
}
export function invoiceAmountState(invoice,draft={}){
 const products=(invoice.products||[]).map((row,index)=>({...row,...draft.edits?.[index]}));
 const included=products.filter((_,i)=>!draft.excluded?.includes(i));
 const printed=number(invoice.invoice_total),freight=number(invoice.freight_total);
 const goods=included.reduce((sum,row)=>sum+number(row.t_price),0),planned=goods+freight;
 const invalid=included.some(row=>REVIEW_FIELDS.filter(k=>k!=='description').some(k=>row[k]!=null&&( !Number.isFinite(number(row[k]))||number(row[k])<0))
  ||['total_stems','u_price','t_price'].some(k=>!Number.isFinite(number(row[k]))||number(row[k])<0)
  ||Math.abs(number(row.total_stems)*number(row.u_price)-number(row.t_price))>.02);
 return {products,included,printed,freight,planned,difference:planned-printed,ready:included.length>0&&!invalid&&Number.isFinite(printed)&&Number.isFinite(planned)&&Math.abs(planned-printed)<=.02};
}
export function packingAmountIssues(result){
 return (result?.invoices||[]).flatMap((invoice,invoiceIndex)=>{
  if(!Array.isArray(invoice.products))return [];
  const state=invoiceAmountState(invoice);
  return state.ready?[]:[{code:AMOUNT_REVIEW_CODE,invoiceIndex,invoice:invoice.invoice,message:`송장 ${invoice.invoice}: 원본 총액과 추출 수량·단가·금액 확인 필요`}];
 });
}
// Older/local drafts may legitimately omit printed totals. Their existing
// source-value/amount-confirmation gates remain authoritative, not this new UI.
export function hasPackingAmountMismatch(invoice){
 const rows=invoice?.products||[],printed=number(invoice?.invoice_total),freight=number(invoice?.freight_total);
 const goods=rows.reduce((sum,row)=>sum+number(row.t_price),0);
 return Number.isFinite(printed)&&Number.isFinite(freight)&&Number.isFinite(goods)&&Math.abs(goods+freight-printed)>.02;
}
export function applyPackingAmountReview(result,drafts,{sourceHash,visitedPages=[],at=new Date().toISOString()}={}){
 if(!/^[a-f0-9]{64}$/.test(sourceHash||''))throw Error('원본 파일 식별자를 확인하세요.');
 if(result.amount_review_source_hash!==sourceHash)throw Error('다른 원본 파일의 검토 초안입니다. 다시 불러오세요.');
 const pending=packingAmountIssues(result),invoices=[...result.invoices];
 if(!pending.length)throw Error('검토할 금액 불일치가 없습니다.');
 for(const issue of pending){
  const invoice=result.invoices[issue.invoiceIndex],draft=drafts[issue.invoiceIndex]||{};
  if(!Array.isArray(draft.excluded||[])||new Set(draft.excluded||[]).size!==(draft.excluded||[]).length)throw Error('제외할 행이 중복되었습니다.');
  if(!draft.confirmed||!String(draft.reason||'').trim())throw Error('원본 확인과 변경 사유를 입력하세요.');
  const changed=[...new Set([...Object.keys(draft.edits||{}).map(Number),...(draft.excluded||[])])];
  if(!changed.length||changed.some(i=>!Number.isInteger(i)||i<0||i>=invoice.products.length))throw Error('검토한 원본 행을 확인하세요.');
  for(const i of changed){const row=invoice.products[i],evidence=row.review_evidence?.description||row.review_evidence?.t_price;
   const page=Number(draft.pages?.[i]??evidence?.page??row.source_page);
   if(!Number.isInteger(page)||!visitedPages.includes(page))throw Error('수정·제외할 행의 원본 PDF 페이지를 먼저 확인하세요.');
   if(Object.keys(draft.edits?.[i]||{}).some(k=>!REVIEW_FIELDS.includes(k)))throw Error('허용하지 않은 필드 변경입니다.');
   if(draft.edits?.[i]?.description!=null&&(typeof draft.edits[i].description!=='string'||!draft.edits[i].description.trim()))throw Error('품명은 비어 있지 않은 원문 문자열이어야 합니다.');
  }
  const state=invoiceAmountState(invoice,draft);
  if(!state.ready)throw Error('수량×단가·행 금액과 원본 총액의 차이를 확인하세요.');
  const recalculated=normalizePackingMetadata({...invoice,products:state.included,
   extractionIssues:(invoice.extractionIssues||[]).filter(item=>item.code!=='INVOICE_TOTAL_MISMATCH')},'CO');
  invoices[issue.invoiceIndex]={...recalculated,source_amount_review:{sourceHash,at,reason:draft.reason.trim(),
   excludedRows:(draft.excluded||[]).map(index=>({index,row:structuredClone(invoice.products[index])})),
   changes:changed.map(index=>({index,before:Object.fromEntries(REVIEW_FIELDS.map(k=>[k,invoice.products[index][k]??null])),after:Object.fromEntries(REVIEW_FIELDS.map(k=>[k,state.products[index][k]??null])),excluded:(draft.excluded||[]).includes(index)})),
   events:draft.events||[],verifiedPages:changed.map(index=>({index,page:Number(draft.pages?.[index]??invoice.products[index].review_evidence?.description?.page??invoice.products[index].review_evidence?.t_price?.page??invoice.products[index].source_page)})),confirmed:true}};
 }
 const output={...result,invoices,recoverable_review_draft:null};
 output.extractionIssues=[...(result.extractionIssues||[]).filter(i=>i.code!==AMOUNT_REVIEW_CODE),...packingAmountIssues(output)];
 return output;
}
