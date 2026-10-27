import React,{useEffect,useMemo,useRef,useState} from 'react';
import {toReceiptDraftPayload} from '../../lib/importPackingReceiptAdapter.js';
import InvoiceReceiptCostReview from './InvoiceReceiptCostReview.js';
import styles from '../../styles/InvoiceReceipt.module.css';
import {rememberInvoiceCostInput,restoreInvoiceCostInput} from '../../lib/invoiceCostEditing.js';

/** Calculation only. Never saves a draft, links a receipt, commits or approves. */
export default function InvoiceDraftCost({document,onEdit,onMetadataChange,onEditAllocation,products=[]}){
 const rememberedInput=useRef(null);
 const serialized=JSON.stringify({...toReceiptDraftPayload(document),sourceWarnings:document.sourceWarnings||[]});
 const payload=useMemo(()=>JSON.parse(serialized),[serialized]);
 const active=useRef(null);active.current=serialized;
 const [prepared,setPrepared]=useState(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  const controller=new AbortController(); let live=true; active.current=serialized;setPrepared(null);setError('');
  fetch('/api/import/receipts/invoice-cost',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({action:'prepare',document:payload}),signal:controller.signal})
   .then(async r=>{const data=await r.json();if(!r.ok||data.success===false)throw new Error(data.error||'원가 준비 실패');return data;})
   .then(data=>{if(live)setPrepared({data:{...data,document:restoreInvoiceCostInput(data.document,rememberedInput.current)},identity:serialized});}).catch(e=>{if(live&&e.name!=='AbortError')setError(e.message);});
  return()=>{live=false;active.current=null;controller.abort();};
 },[payload,attempt,serialized]);
 async function action(kind,input){
  if(prepared?.identity!==serialized)throw new Error('인보이스가 변경되었습니다. 다시 준비하세요.');
  const r=await fetch('/api/import/receipts/invoice-cost',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({action:kind,document:payload,baselineDigest:prepared.data.baselineDigest,input})});
  if(active.current!==serialized)throw new Error('문서가 변경되어 이전 요청을 취소했습니다.');
  if(!r.ok){const data=await r.json();throw new Error(data.error||'원가 계산 실패');}
  if(kind!=='download')return r.json();
  const blob=await r.blob();
  if(active.current!==serialized)throw new Error('문서가 변경되어 이전 파일 다운로드를 취소했습니다.');
  const url=URL.createObjectURL(blob),a=window.document.createElement('a');
  a.href=url;a.download=`도착원가_인보이스계산본_${document.orderYear}_${document.orderWeek}_${String(document.invoiceNo).replace(/[^\p{L}\p{N}_-]/gu,'_')}.xlsx`;
  a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 const data=prepared?.identity===serialized?prepared.data:null;
 return <section aria-label="인보이스 기준 원가 계산" className={styles.invoiceCostPreview}>
  <strong>업로드 인보이스로 도착원가 계산·다운로드</strong>
  <p>기존 입고 연결 없이 계산합니다. 결과는 미승인 계산본이며 입고·재고·최신 승인 원가에 반영되지 않습니다.</p>
  <p>{document.orderYear}/{document.orderWeek} · 인보이스 {document.invoiceNo}</p>
  <div className={styles.actions}>
   {onEditAllocation&&<button type="button" onClick={onEditAllocation}>Woolly bush 품목 선택·변경</button>}
   <button type="button" onClick={onEdit}>품목·수량·입력값 수정</button>
  </div>
  {onMetadataChange&&<div className={styles.actions}>
   <label>원가 적용일 <input type="date" value={document.reviewedMetadata?.inputDate||''} onChange={e=>onMetadataChange('inputDate',e.target.value)}/></label>
   <label>운송 방식 <select value={document.reviewedMetadata?.transportMode||''} onChange={e=>onMetadataChange('transportMode',e.target.value)}><option value="">선택</option><option value="AIR">항공</option><option value="SEA">해상</option></select></label>
  </div>}
  {error&&<p role="alert" className={styles.error}>{error} <button type="button" onClick={()=>setAttempt(v=>v+1)}>다시 준비</button></p>}
  {!data&&!error&&<p role="status">인보이스 품목·단위 확인 중…</p>}
  {data?.issues?.length>0&&<><ul role="alert">{data.issues.map((issue,i)=>{
   const line=document.lines.find(l=>l.lineId===issue.lineId);
   return <li key={i}>{line?`행 ${line.lineNo} · ${line.originalName}: `:''}{issue.message}</li>;
  })}</ul><button type="button" onClick={onEdit}>품목·수량·입력값 수정</button></>}
  {data&&!data.issues.length&&<InvoiceReceiptCostReview key={data.baselineDigest} document={data.document} invoicePreview onNativeAction={action}
   products={products} onEditAllocation={onEditAllocation} onInputDraftChange={input=>{rememberedInput.current=rememberInvoiceCostInput(data.document,input);}}/>}
 </section>;
}
