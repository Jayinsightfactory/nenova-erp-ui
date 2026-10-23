import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { applyInvoiceAllocation, needsInvoiceAllocation } from '../../lib/invoiceProductAllocation.js';
import styles from '../../styles/InvoiceReceipt.module.css';
import { loadPdfPreview, isValidNormalizedBBox } from '../../lib/importPackingPdfPreview.js';
const fields=['boxQuantity','bunchQuantity','stemQuantity','lineAmount'];
const labels=['박스','단','송이','금액'];

export default function InvoiceProductAllocation({ document:doc, products, file, onApply, onClose }) {
  const [rows,setRows]=useState(()=>doc.lines.filter(line=>line.sourceEvidence?.allocationSourceId).map(line=>({...line})));
  const [error,setError]=useState('');
  const [preview,setPreview]=useState(null);
  const [page,setPage]=useState(1);
  const [pdfError,setPdfError]=useState('');
  const [highlight,setHighlight]=useState(null);
  const canvas=useRef(null);
  const dialog=useRef(null);
  const closeRef=useRef(onClose); closeRef.current=onClose;
  const candidates=products.filter(p=>p.country==='AU'&&p.selectable!==false&&needsInvoiceAllocation('AU',p.ProdName));
  useEffect(()=>{
    if(!file||!String(file.name).toLowerCase().endsWith('.pdf'))return;
    let stale=false,loaded;
    const reader=new FileReader();
    reader.onload=()=>loadPdfPreview(String(reader.result).split(',')[1]).then(value=>{
      loaded=value;if(stale){value.destroy();return;}setPreview(value);
    }).catch(err=>{if(!stale)setPdfError(err.message);});
    reader.onerror=()=>setPdfError('원본 PDF를 읽지 못했습니다. 파일을 다시 선택하세요.');
    reader.readAsDataURL(file);
    return()=>{stale=true;reader.abort();loaded?.destroy();};
  },[file]);
  useEffect(()=>{
    if(!preview||!canvas.current)return;
    let stale=false;setPdfError('');
    preview.renderPage(page,canvas.current,1).catch(err=>{if(!stale)setPdfError(err.message);});
    return()=>{stale=true;};
  },[preview,page]);
  useEffect(()=>{
    const previous=document.activeElement;
    dialog.current?.querySelector('select,button')?.focus();
    const key=event=>{
      if(event.key==='Escape'){event.preventDefault();closeRef.current();}
      if(event.key!=='Tab')return;
      const controls=[...dialog.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),iframe')];
      const first=controls[0],last=controls.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    };
    document.addEventListener('keydown',key);
    return()=>{document.removeEventListener('keydown',key);if(previous?.isConnected)previous.focus();};
  },[]);
  const change=(id,field,value)=>setRows(current=>current.map(row=>row.lineId===id?{...row,[field]:value}:row));
  const save=()=>{
    try{
      let next=doc;
      for(const source of doc.rawMetadata.allocationSources) next=applyInvoiceAllocation(next,source.sourceLineId,rows.filter(row=>row.sourceEvidence.allocationSourceId===source.sourceLineId),products);
      onApply(next);
    }catch(error){setError(error.message);}
  };
  return createPortal(<div className={styles.modalBackdrop}><section ref={dialog} className={styles.modal} style={{width:'min(1440px, calc(100vw - 48px))',minWidth:0}} role="dialog" aria-modal="true" aria-label="Woolly bush 입고량 분류">
    <header><h3>Woolly bush · 품목별 입고량 분류</h3><button type="button" onClick={onClose}>닫기 · 미확인 유지</button></header>
    <div className={styles.modalBody}>
      <p>원본에는 색상 구분이 없습니다. 담당자가 전산 품목을 선택하고 박스·단·송이를 나누어 입력하세요. 이 파일에만 저장되며 다음 업로드에서는 다시 확인합니다.</p>
      <div style={{display:'flex',flexWrap:'wrap',gap:16,alignItems:'flex-start'}}>
        <div style={{flex:'1 1 360px',minWidth:0}}>
          <div><button type="button" disabled={!preview||page<=1} onClick={()=>{setPage(page-1);setHighlight(null);}}>이전 페이지</button> {page} / {preview?.numPages||'?'} <button type="button" disabled={!preview||page>=preview.numPages} onClick={()=>{setPage(page+1);setHighlight(null);}}>다음 페이지</button></div>
          <div style={{maxHeight:540,overflow:'auto'}}><div style={{position:'relative',width:'fit-content'}}>
            <canvas ref={canvas} aria-label="분류 원본 인보이스 PDF" style={{maxWidth:'100%',height:'auto'}}/>
            {highlight&&<span aria-label="AI 추정 원문 영역 · 직접 확인" style={{position:'absolute',pointerEvents:'none',left:`${highlight[0]*100}%`,top:`${highlight[1]*100}%`,width:`${highlight[2]*100}%`,height:`${highlight[3]*100}%`,background:'#ffd54f66',outline:'2px solid #d97706'}}/>}
          </div></div>
          {pdfError&&<p role="alert">{pdfError}</p>}
        </div>
        <div style={{flex:'1 1 600px',minWidth:0}}>
          {doc.rawMetadata.allocationSources.map((source,sourceIndex)=> <section key={source.sourceLineId} style={{border:'1px solid #ccd6e5',padding:12,marginBottom:12}}>
            <strong>원본 {sourceIndex+1} · {source.originalName}</strong>
            <button type="button" disabled={!preview} onClick={()=>{
              const evidence=source.sourceEvidence?.descriptionEvidence;
              const target=Number(evidence?.page);
              if(Number.isInteger(target)&&target>0&&target<=preview.numPages){setPage(target);setHighlight(isValidNormalizedBBox(evidence?.bbox)?evidence.bbox:null);}
              else {setHighlight(null);setPdfError('원문 위치 근거가 없습니다. 페이지를 넘겨 직접 확인하세요.');}
            }}>원문 위치 보기</button>
            <p>원본: {source.boxQuantity??'미확인'}박스 / {source.bunchQuantity??'미확인'}단 / {source.stemQuantity??'미확인'}송이 · 단가 {source.unitPrice} {source.currency} / {source.priceUnit} · 금액 {source.lineAmount}</p>
            <div style={{overflowX:'auto'}}><table className={styles.sheet}><thead><tr><th>전산 품목</th>{labels.map(label=><th key={label}>{label}</th>)}<th>행</th></tr></thead><tbody>
              {rows.filter(row=>row.sourceEvidence.allocationSourceId===source.sourceLineId).map((row,index)=><tr key={row.lineId}>
                <td><select aria-label={`원본 ${sourceIndex+1} 분류 ${index+1} 품목`} value={row.prodKey||''} onChange={e=>change(row.lineId,'prodKey',e.target.value)}><option value="">품목 선택</option>{candidates.map(p=><option key={p.ProdKey} value={p.ProdKey}>{p.ProdName} (#{p.ProdKey})</option>)}</select></td>
                {fields.map((field,i)=><td key={field}><input style={{width:90}} inputMode="decimal" aria-label={`원본 ${sourceIndex+1} 분류 ${index+1} ${labels[i]}`} value={row[field]??''} disabled={source[field]==null} onChange={e=>change(row.lineId,field,e.target.value)}/></td>)}
                <td><button type="button" onClick={()=>setRows(current=>current.filter(item=>item.lineId!==row.lineId))}>제거</button></td>
              </tr>)}
            </tbody></table></div>
            <button type="button" onClick={()=>setRows(current=>[...current,{lineId:crypto.randomUUID(),prodKey:null,sourceEvidence:{allocationSourceId:source.sourceLineId},...Object.fromEntries(fields.map(key=>[key,source[key]==null?null:0]))}])}>분류 품목 추가</button>
          </section>)}
        </div>
      </div>
      {error&&<p role="alert" style={{color:'#b42318',whiteSpace:'pre-wrap'}}>{error}</p>}
    </div>
    <footer><button type="button" onClick={onClose}>취소</button><button type="button" onClick={save}>합계 검증 · 문서에 적용</button></footer>
  </section></div>, document.body);
}
