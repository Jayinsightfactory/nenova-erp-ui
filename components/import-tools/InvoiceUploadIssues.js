import {useEffect,useRef,useState} from 'react';
import {apiGet,apiPost} from '../../lib/useApi';
import {uploadIssueLabels as labels} from '../../lib/invoiceUploadIssue';
export default function InvoiceUploadIssues({userId,fileName,error,unmatched,mismatches,processing,onChooseFile,blockedEvent}){
 const [rows,setRows]=useState([]),[pending,setPending]=useState([]),[warning,setWarning]=useState(''),[busy,setBusy]=useState(false),[open,setOpen]=useState(false);
 const last=useRef(''),ready=useRef(false),queue=useRef([]),flight=useRef(false);
 const key=`nenova-upload-issue-pending:${userId}`;
 const persist=()=>{setPending([...queue.current]);try{sessionStorage.setItem(key,JSON.stringify(queue.current));}catch{setWarning('대기 로그를 브라우저에 보관하지 못했습니다. 창을 닫기 전에 로그 저장을 확인하세요.');}};
 const read=async()=>{try{const d=await apiGet('/api/import/upload-issues');setRows(d.rows);}catch(e){setWarning(e.message);}};
 async function flush(){if(flight.current)return;flight.current=true;setBusy(true);try{while(queue.current.length){await apiPost('/api/import/upload-issues',queue.current[0]);queue.current.shift();persist();}setWarning('');if(open)await read();}catch(e){setWarning(`문제 로그 미저장: ${e.message} · 로그만 다시 저장하세요.`);}finally{flight.current=false;setBusy(false);}}
 useEffect(()=>{try{const value=JSON.parse(sessionStorage.getItem(key)||'[]');queue.current=Array.isArray(value)?value:[];setPending([...queue.current]);}catch{setWarning('이전 대기 로그를 읽지 못했습니다.');}ready.current=true;},[key]);
 useEffect(()=>{
  if(!ready.current||!userId||!fileName||processing)return;
  const events=[...(error?[{code:'UPLOAD_FAILED',count:1}]:[]),...(unmatched?[{code:'MATCH_REQUIRED',count:unmatched}]:[]),...(mismatches?[{code:'TOTAL_MISMATCH',count:mismatches}]:[])];
  const signature=JSON.stringify({fileName,error:Boolean(error),events});if(last.current===signature)return;last.current=signature;
  if(!events.length)return;
  queue.current.push(...events.map(e=>({...e,fileName,eventId:crypto.randomUUID()})));persist();void flush();
 },[fileName,error,unmatched,mismatches,userId,processing]);
 useEffect(()=>{
  if(!ready.current||!userId||!blockedEvent||blockedEvent.owner!==userId)return;
  if(!queue.current.some(e=>e.eventId===blockedEvent.eventId)){queue.current.push(blockedEvent);persist();void flush();}
 },[blockedEvent,userId]);
 return <section aria-label="인보이스 업로드 문제 로그" style={{margin:'10px 0'}}>
  <button type="button" aria-expanded={open} onClick={()=>{setOpen(v=>!v);if(!open)read();}}>업로드 문제 로그</button>
  {pending.length>0&&<span role="status"> 로그 저장 대기 {pending.length}건 <button type="button" disabled={busy} onClick={flush}>로그만 다시 저장</button></span>}
  {warning&&<p role="alert">{warning}</p>}
  {open&&<div><p>최근 50건 · 업로드 단계에서 발견한 문제입니다. 이후 수정 여부는 해당 파일의 현재 매칭·검증 결과에서 확인하세요.</p>
   <button type="button" onClick={read}>이력 새로고침</button>
   {rows.map(r=><div key={r.id}>{new Date(r.at).toLocaleString('ko-KR')} · {r.actor} · {r.fileName} · {labels[r.code]||'확인 필요'} {r.count}건
    {r.detail&&<p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{r.detail}</p>}
    <button type="button" onClick={onChooseFile}>파일 다시 선택·수정</button></div>)}
   {!rows.length&&<p>저장된 문제 기록이 없습니다.</p>}
  </div>}
 </section>;
}
