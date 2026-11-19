import React,{useEffect,useMemo,useRef,useState} from 'react';
import {loadPdfPreview} from '../../lib/importPackingPdfPreview.js';
import {packingAmountIssues,invoiceAmountState,applyPackingAmountReview,REVIEW_FIELDS,suspectedSummaryRows} from '../../lib/packingAmountReview.js';
import styles from '../../styles/PackingAmountReview.module.css';
const labels={description:'추출 품명',pcs:'박스',total_bunch:'단수',total_stems:'송이 수',u_price:'단가',t_price:'행 금액'};
const display=n=>Number.isFinite(n)?n.toLocaleString('ko-KR',{maximumFractionDigits:6}):'미확인';
export default function PackingAmountReview({result,pdfBase64,sourceHash,onDraft,onApply,disabled=false}){
 const issues=useMemo(()=>packingAmountIssues(result),[result]);
 const [invoiceIndex,setInvoiceIndex]=useState(()=>issues[0]?.invoiceIndex??0),[rowIndex,setRowIndex]=useState(()=>suspectedSummaryRows(result.invoices[issues[0]?.invoiceIndex??0])[0]??0);
 const [preview,setPreview]=useState(null),[page,setPage]=useState(1),[zoom,setZoom]=useState(1),[visited,setVisited]=useState([]),[highlight,setHighlight]=useState(null),[error,setError]=useState(''),[pdfError,setPdfError]=useState('');
 const canvas=useRef(null),generation=useRef(0);
 const drafts=result.recoverable_review_draft||{},invoice=result.invoices[invoiceIndex],draft=drafts[invoiceIndex]||{};
 const state=invoiceAmountState(invoice||{},draft),row=invoice?.products?.[rowIndex],values=state.products[rowIndex]||{};
 const evidence=row?.review_evidence?.description||row?.review_evidence?.t_price;
 const sourcePage=Number(draft.pages?.[rowIndex]??evidence?.page??row?.source_page);
 useEffect(()=>{let stale=false,loaded;setPreview(null);setVisited([]);setPdfError('');
  if(pdfBase64)loadPdfPreview(pdfBase64).then(p=>{loaded=p;if(stale)p.destroy();else setPreview(p);}).catch(e=>!stale&&setPdfError(e.message));
  return()=>{stale=true;loaded?.destroy();};
 },[pdfBase64,sourceHash]);
 useEffect(()=>{if(preview&&Number.isInteger(sourcePage)&&sourcePage>0&&sourcePage<=preview.numPages)setPage(sourcePage);},[preview,invoiceIndex,rowIndex,sourcePage]);
 useEffect(()=>{if(!preview||!canvas.current)return;let stale=false;const token=++generation.current;setHighlight(null);setPdfError('');
  preview.renderPage(page,canvas.current,zoom).then(async r=>{if(stale||token!==generation.current||r.cancelled)return;setVisited(v=>v.includes(page)?v:[...v,page]);
   const mark=evidence?await preview.locateEvidence(page,evidence):null;if(!stale&&token===generation.current)setHighlight(mark);
  }).catch(e=>!stale&&setPdfError(e.message));return()=>{stale=true;};
 },[preview,page,zoom,invoiceIndex,rowIndex]);
 if(!issues.length)return null;
 function update(patch,event){const old=drafts[invoiceIndex]||{};onDraft({...result,recoverable_review_draft:{...drafts,[invoiceIndex]:{...old,...patch,confirmed:false,
  events:[...(old.events||[]),{at:new Date().toISOString(),...event}].slice(-2000)}}});setError('');}
 function edit(field,value){const old=draft.edits?.[rowIndex]?.[field]??row?.[field]??null;
  update({edits:{...draft.edits,[rowIndex]:{...draft.edits?.[rowIndex],[field]:field==='description'?value:value===''?null:Number(value)}}},{kind:'EDIT',rowIndex,field,before:old,after:value});}
 function exclude(){const excluded=draft.excluded||[],removing=!excluded.includes(rowIndex);update({excluded:removing?[...excluded,rowIndex]:excluded.filter(i=>i!==rowIndex)},
  {kind:removing?'EXCLUDE_SUMMARY':'RESTORE',rowIndex,before:!removing,after:removing});}
 const allReady=issues.every(i=>{const d=drafts[i.invoiceIndex]||{};return invoiceAmountState(result.invoices[i.invoiceIndex],d).ready&&d.confirmed&&String(d.reason||'').trim();});
 return <section className={styles.root} aria-label="확인필요 송장·행 검토" data-testid="packing-amount-review">
  <h3>확인필요 송장·행 {issues.length}건</h3><p>분석 결과를 보존했습니다. 원본과 대조해 수정·제외하고 검증을 통과해야 기존 입고 준비로 이동할 수 있습니다. AI 호출·입고 저장은 실행하지 않습니다.</p>
  <nav aria-label="확인필요 송장">{issues.map(i=><button type="button" key={i.invoiceIndex} aria-pressed={invoiceIndex===i.invoiceIndex} disabled={disabled} onClick={()=>{setInvoiceIndex(i.invoiceIndex);setRowIndex(suspectedSummaryRows(result.invoices[i.invoiceIndex])[0]??0);setError('');}}>{result.invoices[i.invoiceIndex].supplier} · 송장 {i.invoice} · 확인필요</button>)}</nav>
  <details><summary>정상 송장 펼치기 ({result.invoices.length-issues.length}건)</summary>{result.invoices.filter((_,i)=>!issues.some(x=>x.invoiceIndex===i)).map((i,n)=><p key={n}>{i.supplier} · {i.invoice} · {i.products?.length||0}행 · 총액 {display(Number(i.invoice_total))}</p>)}</details>
  <div className={styles.totals} role="status" data-testid="packing-amount-totals"><span>원본 합계 {invoice.currency} {display(state.printed)}</span><span>입고 예정 합계 {display(state.planned)}</span><strong>차이 {display(state.difference)}</strong><span>{state.ready?'수량·단가·금액 대조 통과':'확인 필요'}</span></div>
  <div className={styles.columns}>
   <section aria-label="왼쪽 원본 PDF"><h4>원본 PDF · {page}쪽</h4><div className={styles.controls}>
    <label>페이지 <input aria-label="원본 PDF 페이지" type="number" min="1" max={preview?.numPages||1} value={page} onChange={e=>{const p=Number(e.target.value);if(Number.isInteger(p)&&p>=1&&p<=preview?.numPages)setPage(p);}}/></label>
    <button type="button" onClick={()=>setZoom(z=>Math.max(.5,z-.25))}>축소</button><span>{Math.round(zoom*100)}%</span><button type="button" onClick={()=>setZoom(z=>Math.min(2.5,z+.25))}>확대</button></div>
    <p>{highlight?.bbox?highlight.label:'근거행 좌표 없음 · 해당 페이지 전체를 직접 확인하세요.'}</p>
    {(!pdfBase64||pdfError)&&<p role="alert">{pdfError||'원본 PDF를 다시 선택해야 검토를 적용할 수 있습니다.'}</p>}
    <div className={styles.pdf}><div className={styles.page}><canvas ref={canvas}/>{highlight?.bbox&&<span className={styles.highlight} style={{left:`${highlight.bbox[0]*100}%`,top:`${highlight.bbox[1]*100}%`,width:`${highlight.bbox[2]*100}%`,height:`${highlight.bbox[3]*100}%`}}/>}</div></div>
   </section>
   <section aria-label="오른쪽 추출값 수정"><h4>{invoice.supplier} · 송장 {invoice.invoice}</h4>
    <div className={styles.rows}>{suspectedSummaryRows(invoice).map(i=><button type="button" key={i} aria-pressed={rowIndex===i} onClick={()=>setRowIndex(i)}>{i+1}. {invoice.products[i].description} · 소계 의심(자동 제외 아님){draft.excluded?.includes(i)?' · 제외됨':''}</button>)}</div>
    <details open={!suspectedSummaryRows(invoice).length}><summary>나머지 행 펼치기·접기 ({invoice.products.length-suspectedSummaryRows(invoice).length}행)</summary><div className={styles.rows}>{invoice.products.map((r,i)=>suspectedSummaryRows(invoice).includes(i)?null:<button type="button" key={i} aria-pressed={rowIndex===i} onClick={()=>setRowIndex(i)}>{i+1}. {r.description||'품명 미확인'}{draft.excluded?.includes(i)?' · 소계 제외':''}</button>)}</div></details>
    <fieldset disabled={disabled}><legend>{rowIndex+1}행 원본 대조</legend>{REVIEW_FIELDS.map(field=><label className={styles.field} key={field}>{labels[field]}<input aria-label={`${rowIndex+1}행 ${labels[field]}`} type={field==='description'?'text':'number'} step="any" min={field==='description'?undefined:0} value={values[field]??''} onChange={e=>edit(field,e.target.value)}/></label>)}
     <label>행 근거 페이지 확인·수정<input aria-label="행 근거 페이지" type="number" min="1" max={preview?.numPages||1} value={Number.isInteger(sourcePage)&&sourcePage>0?sourcePage:''} onChange={e=>update({pages:{...draft.pages,[rowIndex]:Number(e.target.value)}},{kind:'SOURCE_PAGE',rowIndex,before:sourcePage,after:Number(e.target.value)})}/></label>
     <button type="button" onClick={exclude} data-testid="packing-summary-toggle">{draft.excluded?.includes(rowIndex)?'제외한 소계 복원':'중복 소계로 제외'}</button><p>원본 행은 삭제하지 않고 변경 전후·제외 근거를 작업 초안에 보존합니다.</p>
     <label>원본 확인·수정 사유<textarea aria-label="원본 확인·수정 사유" value={draft.reason||''} onChange={e=>update({reason:e.target.value},{kind:'REASON'})}/></label>
     <label><input type="checkbox" checked={draft.confirmed===true} onChange={e=>onDraft({...result,recoverable_review_draft:{...drafts,[invoiceIndex]:{...draft,confirmed:e.target.checked}}})}/>선택한 원본 페이지와 수정·제외 행을 확인했습니다.</label>
    </fieldset>
   </section>
  </div>
  {error&&<p role="alert">{error}</p>}
  <button type="button" data-testid="packing-amount-apply" disabled={disabled||!preview||Boolean(pdfError)||!allReady} onClick={()=>{try{onApply(applyPackingAmountReview(result,drafts,{sourceHash,visitedPages:visited}));}catch(e){setError(e.message);}}}>검증 통과 · 기존 입고 준비로 적용</button>
 </section>;
}
