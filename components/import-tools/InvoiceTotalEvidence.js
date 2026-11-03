import {useEffect,useRef,useState} from 'react';
import {loadPdfPreview} from '../../lib/importPackingPdfPreview.js';
import * as XLSX from 'xlsx-js-style';

export default function InvoiceTotalEvidence({file,evidence,onReady}) {
 const canvas=useRef(null),[pdf,setPdf]=useState(null),[page,setPage]=useState(Number(evidence?.page)||1),[error,setError]=useState(''),[bbox,setBbox]=useState(null),[rendering,setRendering]=useState(true);
 const [sheets,setSheets]=useState([]),[sheet,setSheet]=useState(0);
 const [zoom,setZoom]=useState(1);
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
   const located=await pdf.locateEvidence(safePage,evidence);
   if(active){setBbox(located.bbox);setRendering(false);onReady(true);}
  })().catch(e=>{if(active){setError(e.message);setRendering(false);}});return()=>{active=false;};
 },[pdf,page,evidence,zoom]);
 return <section aria-label="원본 총금액 캡처">{sheets.length?<><label>원본 시트 <select value={sheet} onChange={e=>setSheet(Number(e.target.value))}>{sheets.map((s,i)=><option key={i} value={i}>{s.name}</option>)}</select></label><p>원본 시트의 표시값입니다. 통화와 총금액을 대조하세요.</p><div style={{overflow:'auto',maxHeight:'60vh'}}><table><tbody>{sheets[sheet]?.rows.map((row,i)=><tr key={i}>{row.map((v,j)=><td key={j} style={{border:'1px solid #ccd5e2',padding:4,whiteSpace:'pre-wrap'}}>{String(v)}</td>)}</tr>)}</tbody></table></div></>:<label>원본 페이지 <input type="number" min="1" max={pdf?.numPages||pdf?.pageCount||100} value={page} onChange={e=>setPage(Math.max(1,Number(e.target.value)||1))}/></label>}
  {error&&<p role="alert">{error}</p>}
  {pdf&&<div><button type="button" disabled={zoom<=1} onClick={()=>setZoom(v=>Math.max(1,v-0.5))}>축소</button><span> {Math.round(zoom*100)}% </span><button type="button" disabled={zoom>=3} onClick={()=>setZoom(v=>Math.min(3,v+0.5))}>원문 확대</button></div>}
  {rendering&&!error&&<p role="status">원본 PDF 표시 중입니다. 표시가 끝나면 금액 확인을 누를 수 있습니다.</p>}
  <p>{bbox?'표시 영역의 통화와 총금액을 대조하세요.':'총액 위치가 인식되지 않으면 페이지를 바꿔 원문에서 직접 확인하세요.'}</p>
  <div style={{overflow:'auto',maxHeight:'60vh'}}><div style={{position:'relative',width:'fit-content'}}><canvas ref={canvas}/>
   {bbox&&<div style={{position:'absolute',pointerEvents:'none',border:'3px solid #ef4444',background:'#fef08a44',left:`${bbox[0]*100}%`,top:`${bbox[1]*100}%`,width:`${bbox[2]*100}%`,height:`${bbox[3]*100}%`}}/>}
  </div></div>
 </section>;
}
