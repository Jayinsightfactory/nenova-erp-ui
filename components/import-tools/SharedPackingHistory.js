import {useEffect,useState,useRef} from 'react';
import {loadPackingHistory} from '../../lib/packingSharedHistoryClient';
import {packingHistoryComparison} from '../../lib/packingHistoryComparison.js';
import styles from '../../styles/ImportTools.module.css';
export default function SharedPackingHistory({onRestore}){
 const [rows,setRows]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [comparison,setComparison]=useState(null);
 const compareHeading=useRef(null),compareButton=useRef(null);
 useEffect(()=>{if(comparison){compareHeading.current?.focus();compareHeading.current?.scrollIntoView({block:'start'});}},[comparison]);
 const number=value=>value===null?'미확인':value.toLocaleString('ko-KR',{maximumFractionDigits:4});
 async function compare(id,event){compareButton.current=event.currentTarget;setBusy(true);setError('');try{const snapshot=await loadPackingHistory(id);setComparison({fileName:snapshot.fileName,...packingHistoryComparison(snapshot)});}catch(e){setError(e.message);}finally{setBusy(false);}}
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
  }}><table className={`${styles.historyTable} ${styles.uploadHistoryTable}`}><thead><tr><th>최근 보관</th><th>파일명</th><th>국가</th><th>보관 계정</th><th>진행 상태</th><th>작업</th></tr></thead><tbody>
   {rows.map(row=><tr key={row.uploadId}><td>{new Date(row.at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}</td><td style={{whiteSpace:'normal',overflowWrap:'anywhere'}}>{row.fileName}</td><td>{row.country}</td><td>{row.actor}</td><td>{row.reviewConfirmed?'원문 검토 보관':row.hasAnalysis?'분석 보관 · 매칭/검토 필요':'원본 보관 · 분석 필요'}<small> · 입고 완료 여부와 별도</small></td><td><button type="button" disabled={busy} onClick={()=>restore(row.id)}>불러오기 · 이어서 작업</button> <button type="button" disabled={busy||!row.hasAnalysis} onClick={event=>compare(row.id,event)}>수량·금액 대조</button></td></tr>)}
  </tbody></table></div>{!rows.length&&!busy&&<p>아직 보관된 업로드가 없습니다.</p>}
 {comparison&&<section aria-label="보관 원본·분석 수량 금액 대조"><h3 ref={compareHeading} tabIndex={-1}>{comparison.fileName} · 수량·금액 대조</h3><p>원본 추출값과 현재 보관 분석값입니다. 실제 입고 저장 결과와는 별도이며, 미확인은 0이 아닙니다. 총액은 송장·통화별로 비교합니다.</p><button type="button" onClick={()=>{setComparison(null);compareButton.current?.focus();}}>대조 닫기</button>
  {['source','current'].map(side=><div key={side}><h4>{side==='source'?'원본 추출값':'현재 보관 분석값'}</h4>{comparison[side].map((invoice,index)=><div key={index}><strong>송장 {invoice.invoiceNo} · {invoice.currency} · {invoice.totals.items}품목 · 박스 {number(invoice.totals.boxes)} · 단 {number(invoice.totals.bunches)} · 송이 {number(invoice.totals.stems)} · 상품 총금액 {number(invoice.totals.amount)} · 송장 총액 {number(invoice.declaredTotal)}</strong><div className={styles.tableScroll}><table className={styles.historyTable}><thead><tr>{['행','원문 품목','매칭 품목','박스','단','송이','단가','금액'].map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{invoice.rows.map(row=><tr key={row.line}><td>{row.line}</td><td>{row.name}</td><td>{row.matchedName||'미매칭'}</td>{['boxes','bunches','stems','unitPrice','amount'].map(field=><td key={field}>{number(row[field])}</td>)}</tr>)}</tbody></table></div></div>)}</div>)}
 </section>}
 </section>;
}
