const MAX_AUDIT_REPORTS = 20;
const MAX_ENTRIES = 5;
const MAX_CANDIDATE_EVENTS = 3;

function sourceIdentityOf(value) { return value && typeof value.sourceIdentity === 'string' && value.sourceIdentity.length > 0 ? value.sourceIdentity : null; }
function pairKey(value) { const sourceIdentity = sourceIdentityOf(value); return sourceIdentity && typeof value?.id === 'string' && value.id.length > 0 ? `${sourceIdentity}\u001f${value.id}` : null; }
function candidateEvents(finding) { return Array.isArray(finding?.evidence?.candidateEvents) ? finding.evidence.candidateEvents : []; }
function publicCandidate(event) { return { before: event?.before ?? null, after: event?.after ?? null, unit: typeof event?.unit === 'string' ? event.unit : null, changeAt: typeof event?.changeAt === 'string' ? event.changeAt : null, week: typeof event?.week === 'string' ? event.week : null, shipmentDate: typeof event?.shipmentDate === 'string' ? event.shipmentDate : null }; }

function auditSummaryFor(report, sourceIdentity) {
  const requests = Array.isArray(report.report?.requests) ? report.report.requests.filter(row => sourceIdentityOf(row) === sourceIdentity) : [];
  const findings = Array.isArray(report.report?.findings) ? report.report.findings.filter(row => sourceIdentityOf(row) === sourceIdentity) : [];
  const unresolved = Array.isArray(report.report?.unresolved) ? report.report.unresolved.filter(row => sourceIdentityOf(row) === sourceIdentity) : [];
  const findingsByPair = new Map();
  for (const finding of findings) { const key = pairKey(finding); if (!key) continue; const rows = findingsByPair.get(key) || []; rows.push(finding); findingsByPair.set(key, rows); }
  const requestPairCounts = new Map();
  for (const request of requests) { const key = pairKey(request); requestPairCounts.set(key, (requestPairCounts.get(key) || 0) + 1); }
  const hasDuplicateRequestPair = [...requestPairCounts.values()].some(count => count > 1);
  const hasExtraFinding = findings.some(finding => { const key = pairKey(finding); return !key || !requestPairCounts.has(key); });
  const entries = requests.slice(0, MAX_ENTRIES).map(request => {
    const matches = findingsByPair.get(pairKey(request)) || [];
    const finding = matches.length === 1 ? matches[0] : null;
    const events = candidateEvents(finding);
    return { requestId: typeof request.id === 'string' ? request.id : null, sourceIdentity, quote: typeof request.quote === 'string' ? request.quote : null, customerText: typeof request.customerText === 'string' ? request.customerText : null, productText: typeof request.productText === 'string' ? request.productText : null, inputQty: Number.isFinite(request.inputQty) ? request.inputQty : Number.isFinite(request.qty) ? request.qty : null, inputUnit: typeof request.inputUnit === 'string' ? request.inputUnit : typeof request.unit === 'string' ? request.unit : null, status: finding?.status || 'NEEDS_REVIEW', reasonKorean: typeof finding?.reasonKorean === 'string' ? finding.reasonKorean : matches.length > 1 ? '같은 원문 요청에 비교 결과가 여러 개여서 하나로 연결하지 않습니다.' : '이 원문 요청과 정확히 연결된 비교 결과가 없습니다.', candidateEvents: events.slice(0, MAX_CANDIDATE_EVENTS).map(publicCandidate), candidateEventsTruncated: events.length > MAX_CANDIDATE_EVENTS || finding?.evidenceTruncated === true };
  });
  const matchedCount = requests.reduce((count, request) => { const key = pairKey(request); const matches = findingsByPair.get(key) || []; return count + (requestPairCounts.get(key) === 1 && matches.length === 1 && matches[0].status === 'MATCHING_HISTORY' ? 1 : 0); }, 0);
  const partialCount = requests.reduce((count, request) => { const key = pairKey(request); const matches = findingsByPair.get(key) || []; return count + (requestPairCounts.get(key) === 1 && matches.length === 1 && matches[0].status === 'PARTIAL_HISTORY' ? 1 : 0); }, 0);
  return { sourceIdentity, auditId: report.id, archiveCreatedAt: report.createdAt, asOf: typeof report.report?.asOf === 'string' ? report.report.asOf : null, requestCount: requests.length, findingCount: findings.length, unresolvedCount: unresolved.length, matchedRequestCount: matchedCount, partialRequestCount: partialCount, allMatchingHistory: requests.length > 0 && !hasDuplicateRequestPair && !hasExtraFinding && matchedCount === requests.length && unresolved.length === 0, entries, entriesTruncated: requests.length > MAX_ENTRIES, unresolved: unresolved.slice(0, MAX_ENTRIES).map(row => ({ quote: typeof row?.quote === 'string' ? row.quote : null, reason: typeof row?.reason === 'string' ? row.reason : null })), unresolvedTruncated: unresolved.length > MAX_ENTRIES, advisoryOnly: true, erpAction: 'NONE' };
}

function summarizeAuditReports(reports) {
  const latest = new Map();
  const bounded = Array.isArray(reports) ? reports.slice(0, MAX_AUDIT_REPORTS) : [];
  for (const report of bounded) {
    if (!report || report.advisoryOnly !== true || report.erpAction !== 'NONE' || !report.report || typeof report.id !== 'string') continue;
    const identities = new Set();
    for (const row of [...(report.report.requests || []), ...(report.report.findings || []), ...(report.report.unresolved || [])]) { const sourceIdentity = sourceIdentityOf(row); if (sourceIdentity) identities.add(sourceIdentity); }
    for (const sourceIdentity of identities) if (!latest.has(sourceIdentity)) latest.set(sourceIdentity, auditSummaryFor(report, sourceIdentity));
  }
  return [...latest.values()].sort((left, right) => left.sourceIdentity.localeCompare(right.sourceIdentity));
}

function sourceConfirmation({manual,operation,identity,year,week,requestCount,appliedItemCount=0,evidenceAt=null}) {
  const sameScope = value => value && value.year === String(year) && value.week === week && value.sourceIdentity === identity;
  const entries = Array.isArray(operation?.entries) ? operation.entries : [];
  const committedOperation = sameScope(operation) && operation.status === 'committed' && operation.verified===true && !operation.undo && !operation.undone && !operation.incomplete
    && requestCount > 0 && entries.length > 0 && operation.committedCount === entries.length
    && entries.every(entry => entry.sourceIdentity === identity);
  // A successful operation can expand one source line into several catalog entries.
  // Require complete audit rows linked only to this exact message, not line-count equality.
  const historyEvidenceComplete = requestCount > 0 && appliedItemCount === requestCount;
  const automatic = committedOperation || historyEvidenceComplete;
  const operationTime = committedOperation ? dateMillis(operation?.at) : NaN;
  const historyTime = historyEvidenceComplete ? dateMillis(evidenceAt) : NaN;
  const automaticTime = Math.max(Number.isFinite(operationTime)?operationTime:-Infinity,Number.isFinite(historyTime)?historyTime:-Infinity);
  const manualTime = Date.parse(manual?.createdAt);
  const manualWins = sameScope(manual) && manual.status !== 'CLEAR' && !(automatic && Number.isFinite(automaticTime) && Number.isFinite(manualTime) && automaticTime > manualTime);
  if (manualWins && manual.status === 'MANUALLY_APPLIED') return {confirmed:true,cancelled:false,label:'확인완료 · 수동 확인'};
  if (manualWins && manual.status === 'MANUALLY_NOT_APPLIED') return {confirmed:false,cancelled:true,label:'확인취소 · 재확인 필요'};
  return {confirmed:!!automatic,cancelled:false,label:committedOperation?'확인완료 · 등록·분배 성공':historyEvidenceComplete?'확인완료 · 전산 이력 일치':''};
}

// These requests already passed the server's exact SQL comparison. Join only
// unique parser IDs; combined native events must not be rechecked per-line.
function appliedHistoryEntry({pair,application,confirmedRequests=[],quantityRequests=[]}) {
  if(application?.status==='APPLIED')return application;
  if(!pair?.request||pair.unparsedRequest||pair.duplicateRequest||!pair.requestId
    ||pair.request.id!==pair.requestId||pair.requestId!==pair.expectedRequestId)return application||{status:'UNCONFIRMED',entry:null};
  const exact=confirmedRequests.filter(request=>request?.id===pair.requestId);
  if(exact.length===1)return {status:'APPLIED',entry:null,matchKind:'SQL_HISTORY',evidenceAt:latestShipmentTime(exact[0])};
  if(exact.length>1)return application||{status:'UNCONFIRMED',entry:null};
  const quantity=quantityRequests.filter(request=>request?.id===pair.requestId);
  return quantity.length===1?{status:'APPLIED',entry:null,matchKind:'QUANTITY_HISTORY'}:application||{status:'UNCONFIRMED',entry:null};
}
function latestShipmentTime(request) {
  const events=Array.isArray(request?.shipmentEvents)?request.shipmentEvents:[];
  // Live history also exposes nonmatching same-key candidates. Without the
  // comparison's chosen event ID, only a single event has a safe native time.
  if(events.length!==1)return null;
  const time=dateMillis(events[0]?.changeAt);
  return Number.isFinite(time)?new Date(time).toISOString():null;
}

function historyApplicationCoverage(items,requestCount) {
  const parsed=items.filter(item=>!item.pair?.unparsedRequest);
  const ids=parsed.map(item=>item.pair?.expectedRequestId);
  const complete=requestCount>0&&items.length===requestCount&&parsed.length===requestCount
    &&ids.every(id=>typeof id==='string'&&id)&&new Set(ids).size===requestCount
    &&parsed.every(item=>item.application?.status==='APPLIED'&&!item.pair.duplicateRequest&&item.pair.requestId===item.pair.expectedRequestId);
  // Only a fully SQL-covered message may use native event time to supersede a
  // manual cancellation. Fetch/asOf times and quantity-only candidates cannot.
  const times=parsed.map(item=>item.application?.matchKind==='SQL_HISTORY'?dateMillis(item.application.evidenceAt):NaN);
  return {appliedItemCount:complete?requestCount:0,evidenceAt:complete&&times.every(Number.isFinite)?new Date(Math.max(...times)).toISOString():null};
}

function operationRequestKey(value) {
  if (!value || !['ADD', 'CANCEL'].includes(value.action || value.type)) return null;
  const custKey=Number(value.custKey),prodKey=Number(value.prodKey);
  if (!Number.isInteger(custKey)||custKey<=0||!Number.isInteger(prodKey)||prodKey<=0) return null;
  return `${value.action||value.type}:${custKey}:${prodKey}`;
}

function normalizedUnit(value) {
  const unit=String(value||'').trim().toLowerCase().replace(/[\s._-]/g,'');
  if(['box','boxes','bx','박스'].includes(unit))return '박스';
  if(['bunch','bunches','단'].includes(unit))return '단';
  if(['stem','stems','송이'].includes(unit))return '송이';
  return unit;
}

function dateMillis(value) {
  if(typeof value!=='string'||!value.trim())return NaN;
  const text=value.trim();
  const zoned=/[zZ]|[+-]\d{2}:?\d{2}$/.test(text);
  return Date.parse(zoned?text:text.replace(' ','T')+'+09:00');
}

function verifiedOperation(operation,year,week) {
  const entries=Array.isArray(operation?.entries)?operation.entries:[];
  return operation?.status==='committed'&&operation.verified===true&&!operation.undo&&!operation.undone&&!operation.incomplete
    &&operation.year===String(year)&&operation.week===week&&Number.isInteger(operation.committedCount)
    &&operation.committedCount>0&&operation.committedCount===entries.length;
}

// Cross-source fallback for records whose commit audit has a different Kakao
// identity. Match only a one-to-one exact ERP-key/action/input-quantity/unit
// tuple in the same year/week and only after the source message timestamp.
function matchOperationByExactContent({messages=[],changesByIdentity=new Map(),liveHistory={},operations=[],year,week}) {
  const messageIdentities=new Set(messages.map(row=>row?.identity).filter(Boolean));
  const requests=[];
  for(const row of messages) {
    if(!row?.identity||!Number.isFinite(dateMillis(row.created_at)))continue;
    const item=liveHistory[row.identity];
    if(item?.sourceIdentity!==row.identity||item.status==='AMBIGUOUS'||item.status==='ORDER_ONLY')continue;
    const changes=changesByIdentity.get(row.identity)||[];
    const liveRequests=Array.isArray(item.requests)?item.requests:[];
    for(const change of changes) {
      if(!Number.isInteger(change.sourceIndex))continue;
      const requestId=`${row.identity}:${change.sourceIndex+1}`;
      const matches=liveRequests.filter(request=>request?.id===requestId);
      if(matches.length!==1)continue;
      const request=matches[0];
      const action=request.action==='ADD'?'ADD':request.action==='CANCEL'?'CANCEL':null;
      const custKey=Number(request.custKey),prodKey=Number(request.prodKey),qty=Number(request.inputQty),unit=normalizedUnit(request.inputUnit);
      if(!action||!Number.isInteger(custKey)||custKey<=0||!Number.isInteger(prodKey)||prodKey<=0||!Number.isFinite(qty)||qty<=0||!unit
        ||request.timestamp_approximate===true||request.status==='AMBIGUOUS'||request.status==='UNIT_UNRESOLVED'||request.status==='PRODUCT_UNRESOLVED')continue;
      requests.push({key:`${row.identity}\u001f${requestId}`,identity:row.identity,request,action,custKey,prodKey,qty,unit,sourceAt:dateMillis(row.created_at)});
    }
  }
  const candidatesByRequest=new Map();
  const requestCountsByEntry=new Map();
  for(const request of requests) {
    const candidates=[];
    for(const operation of operations) {
      if(!verifiedOperation(operation,year,week)||dateMillis(operation.at)<request.sourceAt)continue;
      for(let index=0;index<operation.entries.length;index+=1) {
        const entry=operation.entries[index];
        // An audit already attributed to a visible source must never be reused
        // by a different source through this fallback.
        if(entry?.sourceIdentity&&messageIdentities.has(entry.sourceIdentity))continue;
        if(entry?.type!==request.action||Number(entry.custKey)!==request.custKey||Number(entry.prodKey)!==request.prodKey
          ||Number(entry.qty)!==request.qty||normalizedUnit(entry.unit)!==request.unit)continue;
        const candidate={operation,entry,index,key:`${operation.key??operation.at}\u001f${index}`};
        candidates.push(candidate);
        requestCountsByEntry.set(candidate.key,(requestCountsByEntry.get(candidate.key)||0)+1);
      }
    }
    candidatesByRequest.set(request.key,candidates);
  }
  const result=new Map();
  for(const request of requests) {
    const candidates=candidatesByRequest.get(request.key)||[];
    if(candidates.length!==1)continue;
    const candidate=candidates[0];
    if(requestCountsByEntry.get(candidate.key)!==1)continue;
    result.set(request.key,{status:'APPLIED',entry:candidate.entry,matchKind:'OPERATION_CONTENT'});
  }
  return result;
}

// Only a unique, verified, committed audit entry tied to this exact source identity
// and parser request line can color an item as applied. Name/quantity similarity and
// message-level manual markers are deliberately insufficient.
function appliedOperationEntry({operation,identity,year,week,request,requestId,requests=[]}) {
  const entries=Array.isArray(operation?.entries)?operation.entries:[];
  if (!operation || operation.status!=='committed'||operation.verified!==true||operation.undo||operation.undone||operation.incomplete
    ||operation.year!==String(year)||operation.week!==week||operation.sourceIdentity!==identity
    ||!Number.isInteger(operation.committedCount)||operation.committedCount<=0||operation.committedCount!==entries.length
    ||typeof requestId!=='string'||!requestId.startsWith(`${identity}:`)||request?.id!==requestId) return {status:'UNCONFIRMED',entry:null};
  const key=operationRequestKey(request);
  if (!key) return {status:'UNCONFIRMED',entry:null};
  const sameRequests=requests.filter(item=>operationRequestKey(item)===key);
  const sameEntries=entries.filter(entry=>entry?.sourceIdentity===identity&&operationRequestKey(entry)===key);
  if (sameRequests.length!==1||sameEntries.length!==1) return {status:'UNCONFIRMED',entry:null};
  return {status:'APPLIED',entry:sameEntries[0]};
}

function formatKakaoMessage(value) {
  const lines=String(value||'').split(/\r?\n/).map(line=>line.trim());
  const compact=[];
  let previousBlank=false;
  for(const line of lines){
    if(!line){if(compact.length&&!previousBlank)compact.push('');previousBlank=true;continue;}
    compact.push(line);previousBlank=false;
  }
  while(compact.at(-1)==='')compact.pop();
  return compact.join('\n');
}

// Presentation only: preserve every row and its audit evidence; never merge quantities.
function groupAppliedItems(items) {
  const groups=[];
  const additional=[];
  for(const item of items){
    if(item.pair.unparsedRequest){additional.push(item);continue;}
    const {pair,application}=item;
    const customer=application.entry?.custName||pair.request?.customerText||pair.change?.customer||'업체 확인 필요';
    const custKey=application.entry?.custKey??pair.request?.custKey;
    const key=Number.isInteger(Number(custKey))&&Number(custKey)>0?`id:${Number(custKey)}`:`name:${customer}`;
    const previous=groups.at(-1);
    // Contiguous grouping retains source order, including a later return to the same company.
    if(previous?.key===key)previous.items.push(item);
    else groups.push({key,customer,items:[item]});
  }
  return {groups,additional};
}

module.exports = { MAX_AUDIT_REPORTS, MAX_ENTRIES, MAX_CANDIDATE_EVENTS, summarizeAuditReports, sourceConfirmation, appliedHistoryEntry, historyApplicationCoverage, appliedOperationEntry, matchOperationByExactContent, formatKakaoMessage, groupAppliedItems };
