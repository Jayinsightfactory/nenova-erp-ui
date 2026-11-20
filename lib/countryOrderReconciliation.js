// File-only policy. Never derives historical quantities from current product factors.
const units = new Set(['stems', 'bunches', 'boxes']);
const text = value => String(value ?? '').trim();
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const millis = value => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const scaled = value => Math.round(value * 1000);
const quantityValid=value=>number(value)&&Math.abs(scaled(value)-value*1000)<0.000001;
const fail = message => { throw Object.assign(new Error(message),{statusCode:400}); };
export function countryOrderHistoryScope(input) {
  if (!/^[A-Za-z]+$/.test(text(input?.country)) || !/^20\d{2}$/.test(text(input?.year)) || !/^(?:0[1-9]|[1-4]\d|5[0-3])-\d+[^\s]*$/.test(text(input?.orderWeek)) || text(input.orderWeek).length>50) fail('국가·연도·세부차수를 확인하세요.');
  return { country: text(input.country), year: Number(text(input.year)), orderWeek: text(input.orderWeek) };
}
export const countryOrderHistoryScopeKey = input => JSON.stringify(Object.values(countryOrderHistoryScope(input)));
const scopeEqual = (a,b) => countryOrderHistoryScopeKey(a) === countryOrderHistoryScopeKey(b);
export function countryOrderEvidenceKey(row) {
  if (!/^\d+$/.test(text(row?.custKey)) || Number(row.custKey) <= 0 || !/^\d+$/.test(text(row?.prodKey)) || Number(row.prodKey) <= 0 || !units.has(row.unit)) fail('업체·품목·단위 근거가 필요합니다.');
  return JSON.stringify([String(row.custKey), String(row.prodKey), row.unit]);
}

/** All current ERP cells survive, including cells with no selected chat evidence.
 * A match consumes an explicit native event, not an equal aggregate quantity.
 * Unproven/partial/repeated event allocation blocks export instead of adding a guess.
 */
export function reconcileCountryOrderEvidence({ scope, current, baseline = null, messages = [], decisions = {}, events = [] }) {
  const normalizedScope = countryOrderHistoryScope(scope);
  if (!current || !scopeEqual(scope,current.scope) || millis(current.queriedAt) === null || !Array.isArray(current.rows)) fail('현재 전산 조회 범위·시각을 확인하세요.');
  if (baseline && (!scopeEqual(scope,baseline.scope) || millis(baseline.queriedAt) === null || millis(baseline.deliveredAt) === null || !Array.isArray(baseline.rows) || !Array.isArray(baseline.sourceKeys))) fail('전달 기준본이 현재 국가·연도·차수와 다릅니다.');
  const cutoff = baseline ? millis(baseline.queriedAt) : null;
  const rows = current.rows.map(row => {
    const key = countryOrderEvidenceKey(row);
    if (!quantityValid(row.quantity)) fail('전산 수량은 소수 셋째 자리까지 확인하세요.');
    return { ...row, key, erpQuantity: row.quantity, additionalQuantity: 0 };
  });
  if (new Set(rows.map(row=>row.key)).size !== rows.length) fail('전산 업체·품목·단위 셀이 중복되었습니다.');
  const cells = new Map(rows.map(row=>[row.key,row]));
  const old = new Map((baseline?.erpRows ?? baseline?.rows ?? []).map(row=>[countryOrderEvidenceKey(row),row]));
  const pendingSources=baseline?.pendingSources??[];
  const pendingKeys=new Set(pendingSources.map(item=>item.sourceKey));
  if(pendingKeys.size!==pendingSources.length)fail('전달 기준본의 미등록 원문키가 중복되었습니다.');
  const consumedSources = new Set(baseline?.sourceKeys ?? []), seenSources = new Map(), allocated = new Set();
  const eventMap = new Map();
  const allocatedQuantities=new Map();
  for (const event of events) {
    if (!text(event.id) || eventMap.has(event.id)) fail('전산 변동 근거키가 없거나 중복되었습니다.');
    eventMap.set(event.id,event);
  }
  const findings = [], sourceKeys = [];
  const supplied=new Map(messages.filter(item=>item.selected===true).map(item=>[item.sourceKey,item]));
  const inputs=[...pendingSources.map(item=>({...item,selected:true})),...messages.filter(item=>!pendingKeys.has(item.sourceKey))];
  for (const item of inputs) {
    if (item.selected !== true) continue;
    const sourceKey = text(item.sourceKey);
    const finding = { sourceKey, status: 'REVIEW', addedQuantity: 0, reason: '', item };
    const review = reason => { finding.reason=reason;findings.push(finding); };
    if (!sourceKey) { review('원문 행 식별자가 없습니다.');continue; }
    // Repeated polling/selection of one exact source is not a new order.
    const identity = JSON.stringify(item);
    if (seenSources.has(sourceKey)) {
      if (seenSources.get(sourceKey) !== identity) review('같은 원문키의 내용이 다릅니다.');
      else findings.push({...finding,status:'DUPLICATE',reason:'같은 원문 행은 한 번만 반영합니다.'});
      continue;
    }
    seenSources.set(sourceKey,identity);
    if (!scopeEqual(scope,item.scope)) { review('선택 국가·연도·세부차수와 다릅니다.');continue; }
    const pending=pendingKeys.has(sourceKey);
    const evidenceIdentity=value=>JSON.stringify([value.sourceKey,countryOrderHistoryScopeKey(value.scope),String(value.custKey),String(value.prodKey),value.unit,value.quantity,value.at,value.kind,value.sourceText??'']);
    if(pending&&supplied.has(sourceKey)&&evidenceIdentity(supplied.get(sourceKey))!==evidenceIdentity(item)){review('전달된 미등록 원문의 내용이 바뀌었습니다.');continue;}
    if (consumedSources.has(sourceKey)&&!pending) { findings.push({...finding,status:'ALREADY_SENT',reason:'마지막 전달본에 포함된 원문입니다.'});continue; }
    let key;
    try { key=countryOrderEvidenceKey(item); } catch { review('업체·품목·단위 연결을 확인하세요.');continue; }
    if (item.kind !== 'addition' || !quantityValid(item.quantity) || item.quantity <= 0 || millis(item.at) === null) { review('취소·정정 또는 수량·원문 시각을 확인하세요.');continue; }
    const decision=decisions[sourceKey];
    if (!baseline || (!pending&&millis(item.at) <= cutoff)) { review('전달 기준본 또는 기준 이후 신규 요청 근거가 필요합니다.');continue; }
    const cell=cells.get(key), before=old.get(key)?.quantity ?? 0;
    const relevant=events.filter(event=> {
      try { return scopeEqual(scope,event.scope) && countryOrderEvidenceKey(event)===key && millis(event.at)!==null && millis(event.at)>cutoff; } catch { return false; }
    });
    if (decision?.mode==='registered') {
      const event=eventMap.get(decision.eventId);
      if (!cell || !event || !relevant.includes(event) || allocated.has(event.id) || event.orderDetailKey == null || event.kind !== 'increase' || !number(event.before) || !number(event.after) || scaled(event.after-event.before)!==scaled(item.quantity) || millis(event.at)<millis(item.at) || millis(event.at)>millis(current.queriedAt) || relevant.some(other=>other.orderDetailKey===event.orderDetailKey&&millis(other.at)>millis(event.at)&&other.kind!=='unchanged')) { review('동일 건 등록 근거의 키·업체·품목·단위·수량·시각이 유일하게 일치하지 않습니다.');continue; }
      if(scaled(cell.erpQuantity-before)<(allocatedQuantities.get(key)??0)+scaled(item.quantity)){review('등록 근거와 현재 전체 전산 수량 증가분이 맞지 않습니다. 다른 정정·취소를 확인하세요.');continue;}
      allocatedQuantities.set(key,(allocatedQuantities.get(key)??0)+scaled(item.quantity));
      allocated.add(event.id);sourceKeys.push(sourceKey);findings.push({...finding,status:'REGISTERED',reason:'선택한 전산 변동에 이미 반영됨',eventId:event.id});
    } else if (pending || decision?.mode==='new' && decision.confirmed===true) {
      // Any ERP change is a review, not permission to add the whole/remaining amount.
      if (!cell || !number(before) || scaled(cell.erpQuantity)!==scaled(before) || relevant.length) { review('전산 수량 또는 변동이 있어 미등록 신규로 확정할 수 없습니다. 부분 일치는 검토하세요.');continue; }
      cell.additionalQuantity=(scaled(cell.additionalQuantity)+scaled(item.quantity))/1000;
      cell.quantity=(scaled(cell.erpQuantity)+scaled(cell.additionalQuantity))/1000;
      sourceKeys.push(sourceKey);findings.push({...finding,status:pending?'CARRY_PENDING':'NEW',addedQuantity:item.quantity,reason:pending?'이미 전달된 미등록 요청 유지 · 재추가 아님':'미등록 신규 확인 · 발주 파일에만 추가'});
    } else review('등록 동일건 또는 미등록 신규 여부를 확인하세요.');
  }
  return { scope:normalizedScope,rows,findings,sourceKeys:[...new Set([...consumedSources,...sourceKeys])],pendingSources:findings.filter(row=>['NEW','CARRY_PENDING'].includes(row.status)).map(row=>row.item),canExport:findings.every(row=>row.status!=='REVIEW'),duplicateCount:findings.filter(row=>row.status==='DUPLICATE').length };
}
