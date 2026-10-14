const key=row=>`${row.year}|${row.orderWeek}|${Number(row.prodKey)}`;
const uuid=value=>String(value || '').toLowerCase();
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=()=>{throw new Error('저장 결과의 작업번호·거래처·차수 또는 감사 기록이 일치하지 않습니다. ERP를 다시 저장하지 말고 같은 작업 결과를 다시 조회하세요.');};
function fixed(snapshot) {
  if(snapshot?.detailRows===0) return null;
  const value=snapshot?.detail?.isFix ?? snapshot?.fixed;
  if(value===true || value===1) return true;
  if(value===false || value===0) return false;
  const values=(snapshot?.shipmentDates || []).map(day=>day.detailFixed);
  return values.length && values.every(value=>value===true || value===1)?true
    :values.length && values.every(value=>value===false || value===0)?false:null;
}
function snapshot(snapshot) {
  if(!snapshot || !Object.hasOwn(snapshot,'shipmentOutQuantity') || !Array.isArray(snapshot.shipmentDates) || !Number.isInteger(snapshot.detailRows)
    || snapshot.shipmentOutQuantity!=null && !Number.isFinite(snapshot.shipmentOutQuantity)) fail();
  const dates=snapshot.shipmentDates.map(day=>{
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day.date || '') || !Number.isFinite(day.shipmentQuantity)) fail();
    return {date:day.date,quantity:day.shipmentQuantity,timestamp:day.timestamp || day.date};
  }).sort((a,b)=>a.timestamp.localeCompare(b.timestamp));
  if(new Set(dates.map(day=>day.timestamp)).size!==dates.length) fail();
  return {total:snapshot.shipmentOutQuantity,fixed:fixed(snapshot),detailRows:snapshot.detailRows,dates};
}
export function weekdayReceiptDates(before,after) {
  const a=new Map(snapshot(before).dates.map(day=>[day.timestamp,day]));
  const b=new Map(snapshot(after).dates.map(day=>[day.timestamp,day]));
  return [...new Set([...a.keys(),...b.keys()])].sort().map(timestamp=>({timestamp,date:(a.get(timestamp)||b.get(timestamp)).date,
    before:a.get(timestamp)?.quantity ?? 0,after:b.get(timestamp)?.quantity ?? 0,
    changed:(a.get(timestamp)?.quantity ?? 0)!==(b.get(timestamp)?.quantity ?? 0)}));
}
export function validateWeekdaySavedHistoryScope(result,scope) {
  if(result?.success!==true || Number(result.scope?.custKey)!==Number(scope.custKey)
    || String(result.scope?.year)!==String(scope.year) || String(result.scope?.majorWeek)!==String(scope.majorWeek)
    || !Array.isArray(result.changes)) fail();
  for(const event of result.changes) if(String(event.year)!==String(scope.year)
    || !String(event.orderWeek).startsWith(`${scope.majorWeek}-`) || Number(event.custKey)!==Number(scope.custKey)) fail();
  return result;
}
export function validateWeekdaySaveReceipt(submission,status,historyResults) {
  const request=submission?.payload,operation=status?.operation;
  if(!request || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request.operationId || '')
    || !Number.isInteger(Number(request.custKey)) || Number(request.custKey)<=0
    || status?.success!==true || status.saved!==true || operation?.success!==true || operation.saved!==true
    || uuid(operation.operationId)!==uuid(request.operationId) || !Array.isArray(operation.changes)
    || !Array.isArray(request.changes) || !request.changes.length) fail();
  const expected=request.changes.map(key).sort(),actual=operation.changes.map(key).sort();
  if(new Set(expected).size!==expected.length || !equal(expected,actual)) fail();
  const history=[];
  for(const result of historyResults || []) {
    if(result?.success!==true || Number(result.scope?.custKey)!==Number(request.custKey) || !Array.isArray(result.changes)) fail();
    for(const event of result.changes) {
      if(String(event.year)!==String(result.scope.year) || !String(event.orderWeek).startsWith(`${result.scope.majorWeek}-`)
        || Number(event.custKey)!==Number(request.custKey)) fail();
      if(uuid(event.operationId)===uuid(request.operationId)) history.push(event);
    }
  }
  const found=history.map(key).sort();
  if(!equal(found,expected)) {
    // A bounded history list may legitimately omit an older UUID. Distinguish
    // that known read limit from duplicate/foreign/corrupt audit responses.
    const missing=expected.filter(value=>!found.includes(value));
    const bounded=missing.length>0 && new Set(found).size===found.length && found.every(value=>expected.includes(value))
      && missing.every(value=>{
        const [year,week]=value.split('|');
        return (historyResults || []).some(result=>String(result.scope?.year)===year
          && String(result.scope?.majorWeek)===week.slice(0,2) && result.truncated===true);
      });
    if(bounded) throw Object.assign(new Error('저장 작업은 확인됐지만 날짜별 감사 기록이 최근 500건 조회범위를 초과하여 상세 대조를 완료하지 못했습니다. 작업 UUID로 전체 감사 기록 확인이 필요합니다. ERP를 다시 저장하지 마세요.'),{code:'WEEKDAY_RECEIPT_AUDIT_WINDOW_EXCEEDED'});
    fail();
  }
  const changes=operation.changes.map(change=>{
    const event=history.find(item=>key(item)===key(change));
    if([event.before,event.after,change.before,change.after].some(value=>value?.detail?.custKey!=null && Number(value.detail.custKey)!==Number(request.custKey))) fail();
    if(!equal(snapshot(event.before),snapshot(change.before)) || !equal(snapshot(event.after),snapshot(change.after))
      || String(event.reason)!==String(request.reason)) fail();
    return {...event,unit:change.unit,beforeState:snapshot(event.before),afterState:snapshot(event.after),
      dates:weekdayReceiptDates(event.before,event.after),confirmationLifecycle:change.confirmationLifecycle || event.after.confirmationLifecycle,
      logs:['같은 작업 UUID의 영속 저장 응답 조회 완료','같은 거래처·연도·세부차수·품목의 감사 전후값 대조 완료',
        ...(event.after.snapshotDigest ? [`저장 후 스냅샷 ${event.after.snapshotDigest}`]:[])]};
  });
  return {operationId:operation.operationId,custKey:Number(request.custKey),scopeKey:submission.scopeKey,
    reason:request.reason,changes,checkedAt:new Date().toISOString()};
}
export function compareWeekdayReceiptLatest(receipt,rows) {
  return {...receipt,changes:receipt.changes.map(change=>{
    const matches=Array.isArray(rows)?rows.filter(row=>Number(row.custKey)===receipt.custKey && key(row)===key(change)):[];
    if(matches.length!==1) return {...change,latestState:'UNAVAILABLE'};
    try {return {...change,latestState:equal(snapshot(matches[0]),change.afterState)?'MATCH':'CHANGED',latest:snapshot(matches[0])};}
    catch {return {...change,latestState:'UNAVAILABLE'};}
  })};
}
// GET-only. A failed readback never retransmits the already saved ERP request.
export async function loadWeekdaySaveReceipt(submission,{get,isCurrent=()=>true,latestRows=null}={}) {
  const request=submission.payload;
  const status=await get('/api/estimate/weekday-changes',{operationId:request.operationId,custKey:request.custKey});
  if(!isCurrent()) return null;
  const scopes=[...new Map(request.changes.map(change=>[`${change.year}|${change.orderWeek.slice(0,2)}`,
    {year:change.year,majorWeek:change.orderWeek.slice(0,2),custKey:request.custKey,limit:500}])).values()];
  const histories=await Promise.all(scopes.map(async scope=>validateWeekdaySavedHistoryScope(await get('/api/estimate/weekday-changes',scope),scope)));
  if(!isCurrent()) return null;
  return compareWeekdayReceiptLatest(validateWeekdaySaveReceipt(submission,status,histories),latestRows);
}
