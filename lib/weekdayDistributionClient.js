import { normalizeWeekdayUnit } from './weekdayEstimateCompare.js';
import { dateKey, locateShippingDay, moveWeekdayPlan } from './weekdayEstimateCycle.js';
import { weekdaySaveEligibility } from './weekdayErpCompatibility.js';

export const weekdayDraftScope = (custKey, year, majorWeek) => `${Number(custKey)}|${year}|${String(majorWeek).padStart(2, '0')}`;
const identity = row => `${Number(row.year)}|${row.orderWeek}|${Number(row.custKey)}|${Number(row.prodKey)}`;
const clone = value => JSON.parse(JSON.stringify(value));
export const draftFingerprint = plan => JSON.stringify(plan);

// Accept one coherent read scope; never mix foreign rows/digests into a save baseline.
export function validateWeekdayDistributionCompareResponse(request, result) {
  const sameSet=(a,b)=>Array.isArray(a) && Array.isArray(b)
    && new Set(a).size===a.length && new Set(b).size===b.length
    && JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
  if(result?.success!==true || result.readOnly!==true || !Array.isArray(result.rows)
    || Number(result.scope?.year)!==Number(request.year) || Number(result.scope?.custKey)!==Number(request.custKey)
    || !sameSet(result.scope?.orderWeeks,request.orderWeeks) || !sameSet(result.scope?.prodKeys,request.prodKeys)) throw new Error('전산 대조 응답의 조회 범위가 요청과 다릅니다. 다시 조회하세요.');
  const seen=new Set();
  for(const row of result.rows) {
    const key=identity(row);
    if(Number(row.year)!==Number(request.year) || Number(row.custKey)!==Number(request.custKey)
      || !request.orderWeeks.includes(row.orderWeek) || !request.prodKeys.includes(Number(row.prodKey))
      || seen.has(key)) throw new Error('전산 대조 행의 업무 범위가 다르거나 중복입니다. 다시 조회하세요.');
    seen.add(key);
  }
  if(seen.size!==request.orderWeeks.length*request.prodKeys.length) throw new Error('전산 대조의 전체 업무키 조회값이 누락됐습니다. 다시 조회하세요.');
  return result;
}

export function weekdayDistributionPreviewMatches(preview, submission) {
  return preview?.scopeKey===submission?.scopeKey
    && JSON.stringify(preview?.payload?.changes)===JSON.stringify(submission?.payload?.changes)
    && JSON.stringify(preview?.submitted)===JSON.stringify(submission?.submitted);
}

// Display-only projection: untouched dates are preserved; draft values are final quantities,
// not a subtotal to subtract from the whole ShipmentDetail quantity.
export function projectWeekdayDistribution(row, plans = []) {
  const unit=normalizeWeekdayUnit(row?.outUnit);
  const number=value=>typeof value==='number' && Number.isFinite(value) && value>=0 ? value : null;
  const draftNumber=value=>typeof value==='number' ? number(value)
    : typeof value==='string' && /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()) ? number(Number(value)) : null;
  const rounded=value=>Math.round(value*1e6)/1e6;
  try {
    if(!unit) throw new Error('현재 OutUnit을 확인하세요.');
    if(!Array.isArray(row.shipmentDates) || !Number.isInteger(row.detailRows) || row.detailRows<0 || row.detailRows>1) throw new Error('복수 상세 또는 불완전한 날짜 기준입니다.');
    const currentTotal=number(row.shipmentOutQuantity)
      ?? (row.state==='NO_SHIPMENT' && row.detailRows===0 && row.shipmentOutQuantity===null && !row.shipmentDates.length ? 0 : null);
    if(currentTotal===null) throw new Error('전산 총량이 미확인입니다.');
    const dates=new Map();
    for(const actual of row.shipmentDates) {
      const date=dateKey(actual.date),quantity=number(actual.shipmentQuantity);
      if(quantity===null) throw new Error(`${date}: 전산 날짜 수량이 미확인입니다.`);
      if(dates.has(date)) throw new Error(`${date}: 복수 날짜행은 임의 합산하지 않습니다.`);
      dates.set(date,{date,currentQuantity:quantity,projectedQuantity:quantity,estimateQuantity:number(actual.estimateQuantity),drafted:false});
    }
    const datedTotal=rounded([...dates.values()].reduce((sum,day)=>sum+day.currentQuantity,0));
    if(Math.abs(datedTotal-currentTotal)>1e-6) throw new Error('전산 날짜 합계와 전체 출고량이 다릅니다.');
    const seen=new Set();
    for(const plan of plans) {
      if(identity(plan)!==identity(row)) throw new Error('초안과 전산 업무 범위가 다릅니다.');
      if(normalizeWeekdayUnit(plan.unit)!==unit) throw new Error('초안 단위와 현재 OutUnit이 다릅니다.');
      const date=dateKey(plan.date),quantity=draftNumber(plan.quantity);
      if(quantity===null) throw new Error(`${date}: 초안 수량이 미확인입니다.`);
      if(seen.has(date)) throw new Error(`${date}: 복수 날짜 초안은 임의 합치지 않습니다.`);
      seen.add(date);
      const before=dates.get(date) || {date,currentQuantity:0,estimateQuantity:null};
      dates.set(date,{...before,projectedQuantity:quantity,drafted:true});
    }
    const projectedDates=[...dates.values()].sort((a,b)=>a.date.localeCompare(b.date))
      .map(day=>({...day,delta:rounded(day.projectedQuantity-day.currentQuantity)}));
    const projectedTotal=rounded(projectedDates.reduce((sum,day)=>sum+day.projectedQuantity,0));
    if(!Number.isFinite(projectedTotal)) throw new Error('예상 합계가 올바르지 않습니다.');
    return {valid:true,error:'',unit,currentTotal,projectedTotal,delta:rounded(projectedTotal-currentTotal),dates:projectedDates};
  } catch(error) {
    return {valid:false,error:error.message,unit,currentTotal:null,projectedTotal:null,delta:null,dates:[]};
  }
}

export function moveWeekdayDistributionDraft({ plans, move, cycles, compareRows, custKey, scopeKey }) {
  const active=plans.filter(plan=>plan.draftScope===scopeKey && Number(plan.custKey)===Number(custKey));
  const original=active.find(plan=>plan.id===move.id),destination=locateShippingDay(cycles,move.date);
  if(!original || !destination) throw new Error('현재 조회 범위의 이동 초안을 선택하세요.');
  if(active.some(plan=>plan.id!==original.id && Number(plan.prodKey)===Number(original.prodKey) && Number(plan.year)===destination.cycle.year && plan.date===move.date)) throw new Error('도착 날짜에 기존 초안이 있습니다. 복수 의도를 임의 합치지 않습니다.');
  const actual=(compareRows || []).filter(row=>Number(row.year)===destination.cycle.year && Number(row.custKey)===Number(custKey) && Number(row.prodKey)===Number(original.prodKey))
    .flatMap(row=>(row.shipmentDates || []).filter(day=>dateKey(day.date)===move.date).map(day=>({...day,orderWeek:row.orderWeek})));
  if(actual.length>1 || actual.some(day=>day.orderWeek!==destination.day.orderWeek)) throw new Error('도착 날짜의 실제 업무차수/상세를 먼저 검토하세요.');
  const result=moveWeekdayPlan(active,move,cycles);
  // Omission means preserve on the server; a complete move must explicitly cancel its source.
  if(!result.plans.some(plan=>plan.id===original.id)) result.plans.push({...original,quantity:0});
  const moved=result.plans.find(plan=>plan.moveEventId===move.eventId);
  moved.quantity+=actual.length?Number(actual[0].shipmentQuantity):0;
  return {...result,plans:[...plans.filter(plan=>!active.includes(plan)),...result.plans]};
}

export function buildWeekdayDistributionSubmission({ plans, compareRows, cycles, custKey, scopeKey, reason, operationId }) {
  if (!String(reason ?? '').trim() || String(reason).trim().length>1000) throw new Error('ERP 저장 사유를 1~1000자로 입력하세요.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId ?? '')) throw new Error('저장 작업 UUID를 확인하세요.');
  if (!Number.isInteger(Number(custKey)) || Number(custKey) <= 0 || !Array.isArray(compareRows)) throw new Error('거래처와 전산 조회 기준을 먼저 확인하세요.');
  const selected = plans.filter(plan => plan.draftScope === scopeKey && Number(plan.custKey) === Number(custKey));
  if (!selected.length) throw new Error('현재 조회 범위의 저장할 초안이 없습니다.');
  const groups = new Map(), dateIntents = new Set();
  for (const plan of selected) {
    const destination = locateShippingDay(cycles, plan.date);
    const quantity = Number(plan.quantity), unit = normalizeWeekdayUnit(plan.unit);
    if (!destination || destination.cycle.calendarState !== 'FOUND' || destination.day.calendarState !== 'FOUND'
      || Number(plan.year) !== Number(destination.cycle.year) || !/^\d{2}-\d{2}$/.test(plan.orderWeek)
      || plan.orderWeek.split('-')[0] !== destination.cycle.majorWeek
      || typeof plan.quantity === 'boolean' || plan.quantity == null || String(plan.quantity).trim() === '' || !Number.isFinite(quantity) || quantity < 0 || !unit) throw new Error('초안 연도·차수·날짜·수량·단위를 확인하세요.');
    if(Math.abs(quantity-Math.round(quantity*1000)/1000)>1e-9) throw new Error('ERP 수량은 소수 셋째 자리까지 입력하세요. 저장 시 자동 반올림하지 않습니다.');
    const date = dateKey(plan.date), key = identity(plan);
    const dateIntent = `${plan.year}|${custKey}|${plan.prodKey}|${date}`;
    if (dateIntents.has(dateIntent)) throw new Error(`${date}: 복수 날짜 초안은 임의 합치지 않습니다. 상세 초안을 검토하세요.`);
    dateIntents.add(dateIntent);
    const matches = compareRows.filter(row => identity(row) === key);
    if (matches.length !== 1) throw new Error(`${plan.year}/${plan.orderWeek}: 최신 전산 조회 기준이 없거나 중복입니다.`);
    const row = matches[0];
    if (unit !== normalizeWeekdayUnit(row.outUnit)) throw new Error(`${plan.prodName || plan.prodKey}: 초안 단위와 현재 OutUnit이 다릅니다. 자동 환산하지 않습니다.`);
    if (!Number.isInteger(row.detailRows) || row.detailRows < 0 || row.detailRows > 1 || !Array.isArray(row.shipmentDates)) throw new Error('복수 상세 또는 불완전한 전산 스냅샷은 저장할 수 없습니다.');
    // Opaque server digest covers Master/Detail amounts and Product conversion values.
    // Do not recompute, normalize, or fall back to the narrower date-only snapshot.
    if(typeof row.snapshotDigest!=='string' || !/^[0-9a-f]{64}$/.test(row.snapshotDigest)) throw new Error('전산 전체 조회 스냅샷 digest가 누락됐거나 잘못됐습니다. 전산 새로고침 후 다시 확인하세요.');
    const required=['sdateKey','sdetailKey','shipmentKey','date','timestamp','shipmentQuantity','estimateQuantity','detailFixed','cost','amount','vat'];
    if(row.shipmentDates.some(day=>required.some(field=>!Object.hasOwn(day,field)))) throw new Error('전산 날짜의 전체 물리 스냅샷이 누락됐습니다. 전산 새로고침으로 다시 확인하세요.');
    if (row.shipmentOutQuantity !== null && (!Number.isFinite(row.shipmentOutQuantity) || row.shipmentOutQuantity < 0)) throw new Error('전산 총량 스냅샷을 확인하세요.');
    const actualAtDate = compareRows.filter(item => Number(item.custKey) === Number(custKey) && Number(item.year) === Number(plan.year) && Number(item.prodKey) === Number(plan.prodKey))
      .flatMap(item => (item.shipmentDates || []).filter(day => dateKey(day.date) === date).map(day => ({ ...day, orderWeek: item.orderWeek })));
    // Existing dates retain their actual full business week and physical snapshot.
    // Only a new date must use the canonical calendar subweek; never remap legacy rows.
    if (actualAtDate.length > 1 || actualAtDate.some(day => day.orderWeek !== plan.orderWeek)
      || !actualAtDate.length && plan.orderWeek !== destination.day.orderWeek) throw new Error(`${date}: 실제 출고일의 상세/업무차수와 달력 기준을 명시적으로 검토하세요.`);
    const before = actualAtDate.length ? Number(actualAtDate[0].shipmentQuantity) : 0;
    if (!Number.isFinite(before) || before < 0) throw new Error('현재 날짜 수량을 확인하세요.');
    if (quantity === before) continue;
    // Compare API flags are booleans. A missing/null/non-boolean value must never
    // be promoted to ERP confirmation; unchanged drafts are not submitted.
    const eligibility = weekdaySaveEligibility({
      detailRows: row.detailRows,
      fixed: row.fixed === true,
      masterFixed: row.masterFixed === true,
    });
    if (!eligibility.allowed) throw new Error(`${plan.year}/${plan.orderWeek} ${plan.prodName || row.prodName || plan.prodKey}: ${eligibility.reason}`);
    if (!groups.has(key)) groups.set(key, {
      year: Number(plan.year), orderWeek: plan.orderWeek, prodKey: Number(plan.prodKey), unit,
      expected: clone({ snapshotDigest: row.snapshotDigest, detailRows: row.detailRows, shipmentOutQuantity: row.shipmentOutQuantity, shipmentDates: row.shipmentDates }), dates: [],
      preview: [], submitted: [],
    });
    const group = groups.get(key);
    group.dates.push({ date, quantity });
    group.preview.push({ date, before, after: quantity, prodName: plan.prodName || row.prodName || String(plan.prodKey),
      detailFlag: row.detailRows === 1 ? '상세 확정 → 확정 유지' : '상세 없음 → 신규 확정 상세' });
    group.submitted.push(draftFingerprint(plan));
  }
  const entries = [...groups.values()];
  if(entries.length>200 || entries.some(entry=>entry.dates.length>31 || entry.expected.shipmentDates.length>31)) throw new Error('ERP 저장 범위를 200개 업무키·업무키당 31개 날짜 이내로 나누세요.');
  if (!entries.length) throw new Error('전산값과 다른 날짜 수량이 없습니다.');
  return {
    scopeKey,
    payload: { operationId, reason: String(reason).trim(), custKey: Number(custKey), changes: entries.map(({ preview, submitted, ...change }) => change) },
    preview: entries.flatMap(entry => entry.preview.map(cell => ({ ...cell, year: entry.year, orderWeek: entry.orderWeek, unit: entry.unit }))),
    submitted: entries.flatMap(entry => entry.submitted),
  };
}

export function clearSubmittedWeekdayDrafts(plans, submission) {
  const sent = new Set(submission.submitted);
  return plans.filter(plan => !sent.has(draftFingerprint(plan)));
}

export function weekdayUnsavedPrintReason(plans, cycle, custKey) {
  return plans.some(plan => Number(plan.custKey) === Number(custKey) && Number(plan.year) === Number(cycle.year)
    && plan.orderWeek?.split('-')[0] === cycle.majorWeek)
    ? '이 차수에 미저장 초안이 있습니다. ERP 저장 후 견적서를 인쇄하세요.' : '';
}

async function jsonRequest(fetcher, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { const response = await fetcher(url, { credentials: 'include', cache: 'no-store', ...options, signal: controller.signal }); return { response, data: await response.json() }; }
  finally { clearTimeout(timer); }
}

const sameOperation=(result,submission)=>typeof result?.operationId==='string'
  && result.operationId.toLowerCase()===submission.payload.operationId.toLowerCase();

// A missing operation can still be in flight. Status lookup never issues another POST.
export async function checkWeekdayDistributionStatus(submission, { fetcher = fetch, attempts = 3, pause = ms => new Promise(resolve => setTimeout(resolve, ms)), timeoutMs = 15000 } = {}) {
  let error = '';
  for (let i = 0; i < attempts; i++) {
    if (i) await pause(1000);
    try {
      const query = new URLSearchParams({ operationId: submission.payload.operationId, custKey: String(submission.payload.custKey) });
      const { response, data } = await jsonRequest(fetcher, `/api/estimate/weekday-changes?${query}`, {}, timeoutMs);
      if (!response.ok || data.success !== true) throw new Error(data.error || '저장 상태 조회 실패');
      if (data.saved === true && sameOperation(data.operation,submission)) return { state: 'saved', result: data.operation };
    } catch (failure) { error = failure.message; }
  }
  return { state: 'pending', error: `저장 여부 확인 중입니다. 같은 작업의 상태만 다시 조회하세요. 새 저장은 차단됩니다.${error ? ` (${error})` : ''}` };
}

export async function saveWeekdayDistribution(submission, options = {}) {
  const fetcher = options.fetcher || fetch;
  try {
    const { response, data } = await jsonRequest(fetcher, '/api/estimate/weekday-apply', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(submission.payload),
    }, options.timeoutMs ?? 30000);
    if (response.ok && data.success === true && data.saved === true && sameOperation(data,submission)) return { state: 'saved', result: data };
    if (!response.ok && data.success === false && data.rolledBack === true) return { state: 'failed', error: data.error || 'ERP 저장이 취소되었습니다. 초안을 확인하고 다시 저장하세요.' };
    if (response.status >= 400 && response.status < 500 && response.status !== 408 && data.success === false) return { state: 'failed', error: data.error || 'ERP 저장이 거절되었습니다.' };
  } catch { /* A transport/parse failure is not evidence of rollback. */ }
  return checkWeekdayDistributionStatus(submission, options);
}
