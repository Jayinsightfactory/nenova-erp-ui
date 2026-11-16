import {useEffect,useRef,useState} from 'react';
import {loadPdfPreview} from '../../lib/importPackingPdfPreview.js';
import * as XLSX from 'xlsx-js-style';
import {uniqueReceiptSourceRow} from '../../lib/invoiceReceiptComparison.js';
import styles from '../../styles/InvoiceReceipt.module.css';

export default function InvoiceTotalEvidence({file,evidence,onReady,focus=null}) {
 const canvas=useRef(null),[pdf,setPdf]=useState(null),[page,setPage]=useState(Number(evidence?.page)||1),[error,setError]=useState(''),[bbox,setBbox]=useState(null),[rendering,setRendering]=useState(true);
 const [sheets,setSheets]=useState([]),[sheet,setSheet]=useState(0);
 const [zoom,setZoom]=useState(1);
 const mark=useRef(null);
 const activeEvidence=focus ? focus.evidence : evidence;
 const sourceRow=uniqueReceiptSourceRow(sheets[sheet]?.rows,focus?.quote);
 useEffect(()=>{setPage(Number(activeEvidence?.page)||1);setZoom(focus?1.5:1);},[focus?.key,evidence]);
 useEffect(()=>{let active=true,loaded;onReady(false);setError('');setPdf(null);
  setSheets([]);setSheet(0);setRendering(true);
  if(file&&/\.xlsx?$/i.test(file.name)){
   file.arrayBuffer().then(data=>{const book=XLSX.read(data,{type:'array'});
    const values=book.SheetNames.map(name=>({name,rows:XLSX.utils.sheet_to_json(book.Sheets[name],{header:1,raw:false,defval:''})}));
    if(active){setSheets(values);setRendering(false);onReady(values.some(s=>s.rows.length>0));}
   }).catch(e=>{if(active){setError('원본 엑셀을 읽지 못했습니다: '+e.message);setRendering(false);}});
   return()=>{active=false;};
  }
  if(!file||!(/\.pdf$/i.test(file.name)||file.type==='application/pdf')){setError('원본 PDF를 불러와 총금액을 확인하세요.');return;}
  const reader=new FileReader();reader.onload=async()=>{try{loaded=await loadPdfPreview(String(reader.result).split(',')[1]);if(active)setPdf(loaded);else loaded.destroy();}catch(e){if(active)setError(e.message);}};
  reader.onerror=()=>setError('원본 PDF를 읽지 못했습니다.');reader.readAsDataURL(file);
  return()=>{active=false;reader.abort();loaded?.destroy();};
 },[file]);
 useEffect(()=>{if(!pdf)return;let active=true;onReady(false);setBbox(null);setRendering(true);
  (async()=>{const safePage=Math.min(pdf.numPages||pdf.pageCount||1,Math.max(1,page));
   const result=await pdf.renderPage(safePage,canvas.current,zoom);
   if(result.cancelled||!active)return;
   const located=activeEvidence?await pdf.locateEvidence(safePage,activeEvidence):{bbox:null};
   if(active){setBbox(located.bbox&&focus?.row?[0.01,located.bbox[1],0.98,located.bbox[3]]:located.bbox);setRendering(false);onReady(true);}
  })().catch(e=>{if(active){setError(e.message);setRendering(false);}});return()=>{active=false;};
 },[pdf,page,activeEvidence,zoom,focus?.key]);
 useEffect(()=>{if(bbox&&focus)mark.current?.scrollIntoView({block:'center',inline:'center',behavior:'smooth'});},[bbox,focus?.key]);
 useEffect(()=>{if(sourceRow>=0&&focus)mark.current?.scrollIntoView({block:'center',inline:'center',behavior:'smooth'});},[sourceRow,focus?.key,sheet]);
 return <section aria-label="원본 총금액 캡처">{sheets.length?<><label>원본 시트 <select value={sheet} onChange={e=>setSheet(Number(e.target.value))}>{sheets.map((s,i)=><option key={i} value={i}>{s.name}</option>)}</select></label><p>원본 시트의 표시값입니다. 통화와 수량을 대조하세요.</p><div style={{overflow:'auto',maxHeight:'60vh'}}><table style={{fontSize:focus?18:14}}><tbody>{sheets[sheet]?.rows.map((row,i)=><tr key={i} ref={i===sourceRow?mark:undefined} style={i===sourceRow?{background:'#fff2bf',outline:'3px solid #d97706'}:undefined}>{row.map((v,j)=><td key={j} style={{border:'1px solid #ccd5e2',padding:4,whiteSpace:'pre-wrap'}}>{String(v)}</td>)}</tr>)}</tbody></table></div></>:<label>원본 페이지 <input type="number" min="1" max={pdf?.numPages||pdf?.pageCount||100} value={page} onChange={e=>setPage(Math.max(1,Number(e.target.value)||1))}/></label>}
  {error&&<p role="alert">{error}</p>}
  {pdf&&<div className={styles.compareToolbar}><button type="button" disabled={zoom<=1} onClick={()=>setZoom(v=>Math.max(1,v-0.5))}>축소</button><span> {Math.round(zoom*100)}% </span><button type="button" disabled={zoom>=3} onClick={()=>setZoom(v=>Math.min(3,v+0.5))}>원문 확대</button></div>}
  {rendering&&!error&&<p role="status">원본 PDF 표시 중입니다. 표시가 끝나면 금액 확인을 누를 수 있습니다.</p>}
  <p role="status">{focus?`${focus.label} · ${(sheets.length?sourceRow>=0:!!bbox)?(sheets.length||focus.row?'품목행 기준 강조 · 수량 열을 직접 대조하세요.':'수량 근거 강조'):'정확한 위치 근거 없음 · 페이지 또는 시트를 바꿔 원본을 확인하세요.'}`:bbox?'표시 영역의 통화와 총금액을 대조하세요.':'총액 위치가 인식되지 않으면 페이지를 바꿔 원문에서 직접 확인하세요.'}</p>
  <div style={{overflow:'auto',maxHeight:'60vh'}}><div style={{position:'relative',width:'fit-content'}}><canvas ref={canvas}/>
   {bbox&&<div ref={mark} data-receipt-source-highlight style={{position:'absolute',pointerEvents:'none',border:'3px solid #d97706',background:'#fef08a66',left:`${bbox[0]*100}%`,top:`${bbox[1]*100}%`,width:`${bbox[2]*100}%`,height:`${bbox[3]*100}%`}}/>}
  </div></div>
 </section>;
}
