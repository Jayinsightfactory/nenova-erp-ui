import {useEffect,useState} from 'react';
import {loadPackingHistory} from '../../lib/packingSharedHistoryClient';
import styles from '../../styles/ImportTools.module.css';
export default function SharedPackingHistory({onRestore}){
 const [rows,setRows]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function load(){setBusy(true);setError('');try{
  const response=await fetch('/api/import/tools/upload-history',{cache:'no-store'}),data=await response.json();
  if(!response.ok||!data.success)throw Error(data.error||'이력 조회 실패');setRows(data.rows);
 }catch(e){setError(e.message);}finally{setBusy(false);}}
 useEffect(()=>{load();},[]);
 async function restore(id){
  if(!window.confirm('선택한 업로드를 복구할까요? 현재 패킹 작업을 보관한 뒤 진행하세요. 불러오기만으로 입고는 등록되지 않습니다.'))return;
  setBusy(true);setError('');try{await onRestore(await loadPackingHistory(id));}catch(e){setError(e.message);}finally{setBusy(false);}
 }
 return <section aria-label="팀 업로드 이력">
  <div className={styles.sectionHeading}><div><h2>팀 업로드 이력 · 불러오기</h2><p>원본·분석·검토 내용을 함께 보관합니다. 불러온 뒤 최신 공용 매칭을 적용하고 입고를 별도로 승인하세요. 이전에 보관되지 않은 파일은 다시 올려야 합니다.</p></div><button type="button" onClick={load} disabled={busy}>새로고침</button></div>
  {error&&<p role="alert" className={styles.error}>{error}</p>}
  {busy&&<p role="status">이력 처리 중…</p>}
  <div className={styles.tableScroll} onKeyDown={event=>{
   if(!['ArrowUp','ArrowDown','Home','End'].includes(event.key)||event.target.tagName!=='BUTTON')return;
   const buttons=[...event.currentTarget.querySelectorAll('tbody button:not(:disabled)')],index=buttons.indexOf(event.target);if(index<0)return;
   event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:Math.max(0,Math.min(buttons.length-1,index+(event.key==='ArrowDown'?1:-1)));buttons[next]?.focus();
  }}><table className={styles.historyTable}><thead><tr><th>최근 보관</th><th>파일명</th><th>국가</th><th>보관 계정</th><th>진행 상태</th><th>작업</th></tr></thead><tbody>
   {rows.map(row=><tr key={row.uploadId}><td>{new Date(row.at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}</td><td style={{whiteSpace:'normal',overflowWrap:'anywhere'}}>{row.fileName}</td><td>{row.country}</td><td>{row.actor}</td><td>{row.reviewConfirmed?'원문 검토 보관':row.hasAnalysis?'분석 보관 · 매칭/검토 필요':'원본 보관 · 분석 필요'}<small> · 입고 완료 여부와 별도</small></td><td><button type="button" disabled={busy} onClick={()=>restore(row.id)}>불러오기 · 이어서 작업</button></td></tr>)}
  </tbody></table></div>{!rows.length&&!busy&&<p>아직 보관된 업로드가 없습니다.</p>}
 </section>;
}
