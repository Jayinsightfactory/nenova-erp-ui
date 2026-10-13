import { weekdayReceiptDates } from '../lib/weekdaySaveReceipt.js';
const fix=value=>value==null?'출고 없음 / 상태 기록 없음':value?'확정':'미확정';
const latest={MATCH:'최신 재조회와 일치',CHANGED:'저장 이후 현재값이 달라짐',UNAVAILABLE:'최신값 비교 미확인'};
export function WeekdayReceiptDateTable({dates,unit}) {
  return <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
    <thead><tr><th scope="col">출고일</th><th scope="col">변경 전</th><th scope="col">저장 후</th><th scope="col">증감 {unit || ''}</th></tr></thead>
    <tbody>{dates.map(day=><tr key={day.timestamp} style={{background:day.changed?'#eff6ff':'transparent'}}>
      <th scope="row" style={{textAlign:'left',padding:'4px'}}>{day.date}{day.timestamp.slice(11,19) && day.timestamp.slice(11,19)!=='00:00:00' && ` ${day.timestamp.slice(11,19)}`}</th>
      <td>{day.before}</td><td>{day.after}</td><td>{day.after-day.before>0?'+':''}{day.after-day.before}</td>
    </tr>)}</tbody></table></div>;
}
export function WeekdaySavedHistoryEvent({event,prodName}) {
  let dates=null;try {dates=weekdayReceiptDates(event.before,event.after);} catch { /* Preserve legacy raw audit instead of inventing dates. */ }
  return <details style={{padding:'6px 0',borderBottom:'1px solid #ddd',fontSize:13,overflowWrap:'anywhere'}}>
    <summary>{event.createdAt || event.changedAt || '시각 기록 없음'} · {event.year}/{event.orderWeek} · {prodName || event.prodName || `품목 ${event.prodKey}`} · {event.reason || '사유 기록 없음'}</summary>
    <p>작업 {event.operationId} · 담당자 {event.userName || event.userId || event.changedBy || '기록 없음'}</p>
    {dates?<WeekdayReceiptDateTable dates={dates} unit={event.unit}/>:<><p>날짜별 기록을 해석할 수 없습니다. 원본 감사값을 확인하세요.</p><pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify({before:event.before,after:event.after},null,2)}</pre></>}
    <p>확정: {fix(event.before?.detail?.isFix)} → {fix(event.after?.detail?.isFix)} · 저장 시점 감사 기록입니다.</p>
  </details>;
}
export default function WeekdaySaveReceipt({receipt,error,busy,onRetry,names={}}) {
  if(!receipt && !error && !busy) return null;
  return <section aria-label="분배 적용 저장 결과" style={{padding:8,border:'1px solid #93b4da',borderRadius:5,background:'#f4f8ff',margin:'6px 8px'}}>
    <div role="status">{busy?'저장된 작업과 날짜별 감사 기록을 확인 중입니다…':receipt?`ERP 저장 결과 확인 · ${receipt.changes.length}개 품목/세부차수 · ${receipt.changes.reduce((sum,change)=>sum+change.dates.filter(day=>day.changed).length,0)}개 날짜 변경`:'ERP 저장 응답 확인 · 상세 결과 재조회 필요'}</div>
    {error && <p role="alert" style={{color:'#9f1c16',margin:'6px 0'}}>저장 상세 확인: {error}</p>}
    {onRetry && <button type="button" disabled={busy} onClick={onRetry}>{busy?'확인 중…':'같은 작업 결과 다시 조회'}</button>}
    {receipt && <details><summary style={{cursor:'pointer',padding:'5px 0'}}>출고일·수량 변경 결과와 검증 로그 펼치기</summary>
      <p style={{overflowWrap:'anywhere'}}>작업 {receipt.operationId} · 업체 {receipt.custKey} · 사유 {receipt.reason}<br/>확인 시각 {receipt.checkedAt} · 저장 당시 감사값과 최신 재조회값을 구분합니다.</p>
      {receipt.changes.map(change=><article key={`${change.year}|${change.orderWeek}|${change.prodKey}`} style={{borderTop:'1px solid #cbd5e1',padding:'6px 0'}}>
        <strong>{change.year}/{change.orderWeek} · {names[change.prodKey] || change.prodName || `품목 ${change.prodKey}`}</strong>
        <p style={{margin:'4px 0'}}>총량 {change.beforeState.total ?? 0} → {change.afterState.total ?? 0} {change.unit} · {fix(change.beforeState.fixed)} → {fix(change.afterState.fixed)}<br/>
          <span style={{color:change.latestState==='CHANGED'?'#9f1c16':'#334155'}}>{latest[change.latestState]}</span> · 담당자 {change.userId || '기록 없음'}</p>
        <WeekdayReceiptDateTable dates={change.dates} unit={change.unit}/>
        {change.latestState==='CHANGED' && <p>현재 총량 {change.latest.total ?? 0} · {fix(change.latest.fixed)} · 현재 출고일 {change.latest.dates.map(day=>`${day.date} ${day.quantity}`).join(' / ') || '없음'}. 위 표는 이 작업의 저장 시점 값입니다.</p>}
        <details><summary>서버 저장 검증 근거</summary><ul>{change.logs.map(log=><li key={log} style={{overflowWrap:'anywhere'}}>{log}</li>)}</ul>
          {change.confirmationLifecycle && <p>저장 확정 처리: {(change.confirmationLifecycle.transitionStages || []).join(' → ') || '상태 변경 없음'}</p>}
        </details>
      </article>)}
    </details>}
  </section>;
}
