import { useEffect, useMemo, useRef, useState } from 'react';
import { buildEarlyShipmentRequest, createEarlyShipmentRequestScope, earlyShipmentSourceSnapshot,
  earlyShipmentPendingKey, readEarlyShipmentPending, persistEarlyShipmentPending, clearEarlyShipmentPending,
  earlyShipmentPostFailure } from '../lib/weekdayEarlyShipmentClient.js';
import { earlyShipmentConfirmationLabel } from '../lib/weekdayEarlyShipmentPresentation.js';

const box = {border:'1px solid #a9b9cf',borderRadius:8,background:'#f8fbff',padding:12,margin:'10px 8px',fontSize:14,color:'#172b42'};
const control = {font:'inherit',minHeight:36,padding:'5px 8px',border:'1px solid #8094ac',borderRadius:5,background:'#fff',color:'#172b42'};
const label = {display:'grid',gap:4,minWidth:0};
const nice = value => value == null ? '미확인' : String(value);

async function postEarly(body) {
  const response = await fetch('/api/estimate/weekday-early-shipment', {method:'POST',credentials:'include',
    headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  let result;
  try { result = await response.json(); } catch { throw new Error('선출고 서버 응답을 확인할 수 없습니다. 작업 ID로 재조회하세요.'); }
  if (!response.ok || result?.success !== true) throw earlyShipmentPostFailure(response.status,result);
  return result;
}

export default function WeekdayEarlyShipmentPanel({inputUser, customer, sourceCycle, nextCycle, records, legacyNotes = [],
  compareRows = [], plans = [], cycles = [], loading = false, error = '', refreshSnapshot, onReload}) {
  const [prodKey,setProdKey] = useState('');
  const [sourceDate,setSourceDate] = useState('');
  const [quantity,setQuantity] = useState('');
  const [reason,setReason] = useState('');
  const [additional,setAdditional] = useState(false);
  const [dialog,setDialog] = useState(null);
  const [failure,setFailure] = useState('');
  const [working,setWorking] = useState(false);
  const [expanded,setExpanded] = useState(false);
  const [pending,setPending] = useState(null);
  const [recoveryBlocked,setRecoveryBlocked] = useState(false);
  useEffect(()=>{if(pending || error || failure) setExpanded(true);},[pending,error,failure]);
  const trigger = useRef(null);
  const firstDialogControl = useRef(null);
  const requestScope = `${customer?.CustKey || ''}|${sourceCycle?.year || ''}|${sourceCycle?.majorWeek || ''}`;
  const guardedScope=`${inputUser || ''}|${requestScope}`;
  const pendingStorageKey=inputUser && customer?.CustKey && sourceCycle?.year && sourceCycle?.majorWeek
    ? earlyShipmentPendingKey(inputUser,requestScope) : null;
  const requestGuard = useRef(null);
  if(!requestGuard.current)requestGuard.current=createEarlyShipmentRequestScope(guardedScope);
  requestGuard.current.setScope(guardedScope);
  useEffect(()=>()=>requestGuard.current?.invalidate(),[]);
  useEffect(()=>{
    setProdKey('');setSourceDate('');setQuantity('');setReason('');setAdditional(false);setDialog(null);setFailure('');
    setPending(null);setRecoveryBlocked(false);setFailure('');
    if(!pendingStorageKey)return;
    try {
      const saved=readEarlyShipmentPending(sessionStorage,inputUser,requestScope);
      if(!saved)return;
      setPending(saved);
      setFailure('이전 선출고 저장 결과가 확인되지 않았습니다. 같은 작업번호로 결과를 확인하세요.');
    } catch(e) {setRecoveryBlocked(true);setFailure(`선출고 복구 기록을 확인할 수 없습니다. 새 적용을 중단했습니다. ${e.message}`);}
  },[requestScope,inputUser,pendingStorageKey]);
  useEffect(()=>{if(dialog) firstDialogControl.current?.focus();},[dialog]);
  const products = useMemo(() => {
    if(!sourceCycle || !customer?.CustKey) return [];
    const rows = compareRows.filter(row => Number(row.year) === Number(sourceCycle.year)
      && Number(row.custKey) === Number(customer.CustKey)
      && String(row.orderWeek || '').split('-')[0] === String(sourceCycle.majorWeek));
    const draftRows = plans.filter(plan => Number(plan.year) === Number(sourceCycle.year)
      && Number(plan.custKey) === Number(customer.CustKey)
      && String(plan.orderWeek || '').split('-')[0] === String(sourceCycle.majorWeek));
    const keys = [...new Set([...rows,...draftRows].map(row => Number(row.prodKey)))].filter(Number.isInteger);
    return keys.map(key => ({key,name:rows.find(row=>Number(row.prodKey)===key)?.prodName
      || draftRows.find(row=>Number(row.prodKey)===key)?.prodName || `품목 ${key}`}))
      .sort((a,b)=>a.name.localeCompare(b.name,'ko'));
  },[sourceCycle,customer,compareRows,plans]);
  let selected = null, selectedError = '';
  if(prodKey && sourceDate && Array.isArray(compareRows)) try {
    selected = earlyShipmentSourceSnapshot({cycle:sourceCycle,date:sourceDate,prodKey:Number(prodKey),plans,compareRows,custKey:customer?.CustKey});
  } catch(e) {selectedError=e.message;}
  const applied = Array.isArray(records) ? records.filter(record=>record.status==='APPLIED') : [];
  const alreadyClassified=applied.filter(record=>Number(record.sourceYear)===Number(sourceCycle?.year)
    && String(record.sourceMajorWeek)===String(sourceCycle?.majorWeek)
    && Number(record.prodKey)===Number(prodKey) && String(record.sourceDate).slice(0,10)===sourceDate
    && record.unit===selected?.row.outUnit).reduce((sum,record)=>sum+Number(record.quantity),0);
  const historical = Array.isArray(records) ? records.filter(record=>record.status==='REVERSED') : [];
  const legacy = legacyNotes.filter(note=>Number(note.year)===Number(sourceCycle?.year)
    && String(note.majorWeek)===String(sourceCycle?.majorWeek) && note.earlyShipment?.confirmation==='MANUAL_USER_DECLARATION');
  const unavailable = loading || Boolean(error) || recoveryBlocked || !inputUser || !Array.isArray(records) || !customer?.CustKey
    || sourceCycle?.calendarState!=='FOUND' || !nextCycle;

  async function assertCurrentOwner() {
    const response=await fetch('/api/auth/me',{credentials:'include',cache:'no-store'});
    const result=await response.json();
    if(!response.ok || result?.success!==true || result.user?.userId!==inputUser)
      throw new Error('로그인 사용자가 변경됐습니다. 이 작업의 계정으로 다시 확인하세요.');
  }
  function persistPending(body) {
    if(!pendingStorageKey)throw new Error('로그인 사용자와 복구 범위를 확인하세요.');
    persistEarlyShipmentPending(sessionStorage,inputUser,requestScope,body);
  }
  function clearPending(body) {
    if(!pendingStorageKey)throw new Error('복구 범위를 확인할 수 없습니다.');
    clearEarlyShipmentPending(sessionStorage,inputUser,requestScope,body);
  }

  function closeDialog() {setDialog(null);setFailure('');queueMicrotask(()=>trigger.current?.focus());}
  async function preview(event) {
    if(unavailable || working || pending) return;
    const scopeToken=requestGuard.current.capture();
    trigger.current=event.currentTarget;setWorking(true);setFailure('');
    try {
      const fresh = await refreshSnapshot();
      if(!requestGuard.current.isCurrent(scopeToken))return;
      const operationId=crypto.randomUUID();
      const body=buildEarlyShipmentRequest({cycle:sourceCycle,targetCycle:nextCycle,custKey:customer.CustKey,
        prodKey:Number(prodKey),date:sourceDate,quantity,reason,operationId,plans,compareRows:fresh,cycles,
        alreadyClassified,allowAdditionalClassification:additional});
      const result=await postEarly(body);
      if(!requestGuard.current.isCurrent(scopeToken))return;
      if(result.readOnly!==true || !result.preview || !Number.isSafeInteger(result.expectedRevision))
        throw new Error('읽기 전용 선출고 미리보기 응답을 확인할 수 없습니다.');
      setDialog({kind:'preview',body:{...body,expectedRevision:result.expectedRevision},preview:result.preview});
    } catch(e) {if(requestGuard.current.isCurrent(scopeToken))setFailure(e.message);}
    finally {if(requestGuard.current.isCurrent(scopeToken))setWorking(false);}
  }
  async function sendPending(body) {
    if(working || recoveryBlocked)return;
    const scopeToken=requestGuard.current.capture();
    setWorking(true);setFailure('');
    let sent=false,committed=false;
    try {
      await assertCurrentOwner();
      if(!requestGuard.current.isCurrent(scopeToken))return;
      persistPending(body);
      setPending(body);
      sent=true;
      const result=await postEarly(body);
      if(result.saved!==true || result.operationId!==body.operationId
        || result.status!==(body.action==='APPLY'?'APPLIED':'REVERSED'))
        throw new Error('저장 응답을 확인할 수 없습니다. 같은 작업 ID로 다시 조회하세요.');
      committed=true;
      clearPending(body);
      if(!requestGuard.current.isCurrent(scopeToken))return;
      setPending(null);setDialog(null);setQuantity('');setReason('');
      await onReload();
      if(requestGuard.current.isCurrent(scopeToken))queueMicrotask(()=>trigger.current?.focus());
    } catch(e) {
      if(sent && (committed || e.rolledBack===true)) try {clearPending(body);if(requestGuard.current.isCurrent(scopeToken))setPending(null);}
      catch(storageError) {if(requestGuard.current.isCurrent(scopeToken)){setRecoveryBlocked(true);setFailure(`저장 복구 기록을 유지합니다. ${storageError.message}`);}return;}
      if(requestGuard.current.isCurrent(scopeToken))setFailure(`${e.message} · 작업 ID ${body.reversalOperationId || body.operationId}`);
    } finally {if(requestGuard.current.isCurrent(scopeToken))setWorking(false);}
  }
  function apply() {
    if(working || dialog?.kind!=='preview' || pending)return;
    return sendPending({...dialog.body,action:'APPLY'});
  }
  function openReverse(event,record) {
    if(unavailable || working || pending) return;
    trigger.current=event.currentTarget;setFailure('');
    setDialog({kind:'reverse',record,reason:'',reversalOperationId:crypto.randomUUID()});
  }
  function reverse() {
    if(working || dialog?.kind!=='reverse' || !dialog.reason.trim() || pending)return;
    const body={action:'REVERSE',operationId:dialog.record.operationId,reversalOperationId:dialog.reversalOperationId,
      expectedRevision:dialog.record.revision,reason:dialog.reason.trim()};
    return sendPending(body);
  }
  function dialogKeys(event) {
    if(event.key==='Escape' && !working && !pending){event.preventDefault();closeDialog();}
    if(event.key==='Tab') {
      const focusable=[...event.currentTarget.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')];
      if(!focusable.length)return;
      if(event.shiftKey && document.activeElement===focusable[0]){event.preventDefault();focusable.at(-1).focus();}
      else if(!event.shiftKey && document.activeElement===focusable.at(-1)){event.preventDefault();focusable[0].focus();}
    }
  }

  return <details style={box} open={expanded} onToggle={event=>setExpanded(event.currentTarget.open)} aria-busy={working || loading}>
    <summary style={{cursor:'pointer',fontWeight:700}}>대차수 선출고 · 적용 {applied.length}건 · 취소 {historical.length}건{pending?' · 저장 결과 확인 필요':error?' · 조회 확인 필요':''}</summary>
    <section aria-label="대차수 선출고 연결">
    <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',gap:10,flexWrap:'wrap'}}>
      <h2 style={{fontSize:18,margin:'0 0 7px'}}>선출고 품목입니다 · 대차수 연결</h2>
      <button type="button" style={control} disabled={working || loading} onClick={onReload}>선출고·전산 새로고침</button>
    </div>
    <p style={{margin:'2px 0 10px'}}>원천 {sourceCycle ? `${sourceCycle.year}/${sourceCycle.majorWeek}차`:'미선택'} → 대상 {nextCycle ? `${nextCycle.year}/${nextCycle.majorWeek}차`:'달력 확인 필요'} · 원천의 실제 출고 날짜에 연결합니다. 이미 분배된 수량에서 선출고 물량을 구분합니다.</p>
    {error && <p role="alert" style={{color:'#a51a24'}}>연결 원장 조회 실패: {error} · 조회 전까지 선출고 적용을 막습니다.</p>}
    {loading && <p role="status">연결 원장과 다음 대차수를 조회 중입니다.</p>}
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:9,alignItems:'end'}}>
      <label style={label}>품목<select style={control} value={prodKey} disabled={unavailable || working || Boolean(pending)} onChange={e=>{setProdKey(e.target.value);setSourceDate('');}}><option value="">품목 선택</option>{products.map(product=><option key={product.key} value={product.key}>{product.name}</option>)}</select></label>
      <label style={label}>원천 실제 출고일<select style={control} value={sourceDate} disabled={unavailable || working || Boolean(pending) || !prodKey} onChange={e=>setSourceDate(e.target.value)}><option value="">날짜 선택</option>{(sourceCycle?.days || []).filter(day=>day.calendarState==='FOUND').map(day=><option key={day.date} value={day.date}>{day.date}</option>)}</select></label>
      <label style={label}>선출고 수량<input style={control} type="text" inputMode="decimal" value={quantity} disabled={unavailable || working || Boolean(pending)} onChange={e=>setQuantity(e.target.value)} placeholder="예: 3"/></label>
      <label style={{...label,gridColumn:'span 1'}}>적용 사유<input style={control} type="text" maxLength={1000} value={reason} disabled={unavailable || working || Boolean(pending)} onChange={e=>setReason(e.target.value)} placeholder="필수"/></label>
    </div>
    {selected && <p style={{margin:'8px 0'}}>현재 날짜 분배 {nice(selected.before)} → 적용할 날짜 수량 {nice(selected.final)} {selected.row.outUnit} · {selected.allocationIntent==='MARK_EXISTING'?'기존 분배에서 선출고로 구분':'입력 수량 적용'} · ERP 상세 {selected.row.fixed===true?'확정':selected.row.fixed===false?'미확정':'상태 확인 필요'}</p>}
    {selected?.final===0 && <p>새 출고량을 등록하려면 아래 요일표에서 같은 날짜의 적용할 날짜 수량 초안을 먼저 입력하세요.</p>}
    {alreadyClassified>0 && <label style={{display:'flex',alignItems:'center',gap:7,margin:'5px 0'}}><input type="checkbox" checked={additional} disabled={unavailable || working || Boolean(pending)} onChange={e=>setAdditional(e.target.checked)}/>이미 분류된 {alreadyClassified} {selected?.row.outUnit || ''}에 추가로 등록합니다</label>}
    {selectedError && <p role="alert" style={{color:'#a51a24'}}>{selectedError}</p>}
    <button type="button" className="primary" style={{...control,marginTop:4}} disabled={unavailable || working || Boolean(pending) || !selected || !quantity || !reason.trim()} onClick={preview}>{working?'미리보기 조회 중…':'선출고 미리보기'}</button>
    {pending && <p role="alert" style={{color:'#9a3412'}}>저장 결과를 확인할 수 없습니다. 같은 작업 ID로 다시 시도하세요. {pending.reversalOperationId || pending.operationId} <button type="button" style={control} disabled={working || recoveryBlocked} onClick={()=>sendPending(pending)}>같은 작업 다시 확인</button></p>}
    {failure && <p role="alert" style={{color:'#a51a24',overflowWrap:'anywhere'}}>{failure}</p>}
    <h3 style={{fontSize:16,margin:'14px 0 7px'}}>연결 처리 이력</h3>
    {Array.isArray(records) && !records.length && <p>처리된 선출고가 없습니다.</p>}
    {Array.isArray(records) && <div role="region" aria-label="대차수 선출고 처리 이력" style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',minWidth:740,textAlign:'left'}}><thead><tr><th>품목·수량</th><th>원천 → 대상</th><th>실제 출고일</th><th>원천 날짜 변경</th><th>원천 확정 상태</th><th>상태·작업</th></tr></thead><tbody>{[...applied,...historical].map(record=><tr key={record.operationId} style={{borderTop:'1px solid #d5e0eb'}}><td>{products.find(item=>item.key===Number(record.prodKey))?.name || `품목 ${record.prodKey}`} · {record.quantity} {record.unit}</td><td>{record.sourceYear}/{record.sourceMajorWeek} → {record.targetYear}/{record.targetMajorWeek}</td><td>{record.sourceDate}</td><td>{nice(record.sourceDateBefore)} → {nice(record.sourceDateFinal)} (Δ{nice(record.sourceDateDelta)})</td><td>{earlyShipmentConfirmationLabel(record,compareRows)}</td><td>{record.status==='APPLIED'?'적용됨':'취소됨'} {record.status==='APPLIED' && <button type="button" style={control} disabled={unavailable || working || Boolean(pending)} onClick={e=>openReverse(e,record)}>분류 취소</button>}</td></tr>)}</tbody></table></div>}
    {legacy.length>0 && <details style={{marginTop:10}}><summary>이전 수동 선출고 비고 {legacy.length}건 · 참고용</summary><p>이 비고는 연결 원장 적용 실적이나 업로드 제외량으로 계산하지 않습니다.</p>{legacy.map(note=><p key={`${note.year}|${note.majorWeek}|${note.prodKey}`}>품목 {note.prodKey} · {note.earlyShipment.sourceYear}/{note.earlyShipment.sourceOrderWeek} · {note.earlyShipment.date} · {note.earlyShipment.quantity} {note.earlyShipment.unit}</p>)}</details>}
    {dialog && <div className="weekday-print-overlay" onKeyDown={dialogKeys}><section role="dialog" aria-modal="true" aria-label={dialog.kind==='preview'?'선출고 적용 미리보기':'선출고 분류 취소 확인'} style={{...box,width:'min(760px,calc(100vw - 24px))',maxHeight:'calc(100dvh - 24px)',overflow:'auto',boxSizing:'border-box',background:'#fff',fontSize:16}}>
      {dialog.kind==='preview' ? <><h3>선출고 적용 미리보기</h3><p>{dialog.body.sourceYear}/{dialog.body.sourceMajorWeek}차 → {dialog.body.targetYear}/{dialog.body.targetMajorWeek}차 · {dialog.body.sourceDate} · {dialog.body.quantity} {dialog.body.unit}</p><p>원천 재고 조정 +{dialog.body.quantity} / 대상 재고 조정 −{dialog.body.quantity}</p><p>날짜별 수량 {nice(dialog.preview.sourceDateBefore)} → {nice(dialog.preview.sourceDateFinal)} (변경 {nice(dialog.preview.sourceDateDelta)}) · {dialog.body.allocationIntent==='MARK_EXISTING'?'기존 분배 분류':'초안 절대값 적용'}</p><p>원천 실제 상세 확정: {dialog.preview.confirmationAfter===true?'예 · 확정':dialog.preview.confirmationAfter===false?'아니요 · 미확정':'미확인'} · 기존 확정 범위만 보존합니다.</p><p>대상 {dialog.body.targetMajorWeek}차의 {nice(dialog.preview.targetImportWeek)} 업로드에서 선출고 수량을 자동 제외합니다.</p><p>기존 분류량 {nice(dialog.preview.alreadyClassified)} · 잔여 분류 가능량 {nice(dialog.preview.remainingCap)}</p></> : <><h3>선출고 분류 취소</h3><p>{dialog.record.sourceYear}/{dialog.record.sourceMajorWeek}차 → {dialog.record.targetYear}/{dialog.record.targetMajorWeek}차 · {dialog.record.quantity} {dialog.record.unit}</p><p>선출고 구분과 연결된 재고 조정을 취소합니다. 날짜별 분배 수량은 유지됩니다.</p><label style={label}>취소 사유<input ref={firstDialogControl} style={control} value={dialog.reason} onChange={e=>setDialog(current=>({...current,reason:e.target.value}))} maxLength={1000}/></label></>}
      {failure && <p role="alert" style={{color:'#a51a24'}}>{failure}</p>}
      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:12}}><button ref={dialog.kind==='preview'?firstDialogControl:null} type="button" className="primary" style={control} disabled={working || Boolean(pending) || dialog.kind==='reverse'&&!dialog.reason.trim()} onClick={dialog.kind==='preview'?apply:reverse}>{working?'처리 중…':dialog.kind==='preview'?'선출고 적용':'분류 취소 적용'}</button><button type="button" style={control} disabled={working || Boolean(pending)} onClick={closeDialog}>닫기</button></div>
    </section></div>}
  </section></details>;
}
