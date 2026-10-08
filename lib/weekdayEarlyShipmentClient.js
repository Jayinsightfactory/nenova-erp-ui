import { normalizeWeekdayUnit } from './weekdayEstimateCompare.js';
import { buildWeekdayDistributionSubmission, weekdayDraftScope } from './weekdayDistributionClient.js';
import { isKnownEmptyHorizontalDate } from './weekdayHorizontalMatrix.js';
const OPERATION_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const knownNonnegative=value=>value!==null && value!==undefined && typeof value!=='boolean'
  && (typeof value==='number' || typeof value==='string' && value.trim()!=='')
  && Number.isFinite(Number(value)) && Number(value)>=0;

export function createEarlyShipmentRequestScope(initialScope) {
  let scope=initialScope, revision=0;
  return {
    setScope(nextScope) {if(nextScope!==scope){scope=nextScope;revision+=1;}},
    invalidate() {revision+=1;},
    capture() {return {scope,revision};},
    isCurrent(token) {return token?.scope===scope && token.revision===revision;},
  };
}

export function earlyShipmentPendingKey(userId, scope) {
  if(!userId || !/^\d+\|\d{4}\|\d{1,2}$/.test(scope || '')) throw new Error('선출고 사용자·조회 범위를 확인하세요.');
  return `weekday-early-pending:${encodeURIComponent(userId)}:${scope}`;
}

export function readEarlyShipmentPending(storage, userId, scope) {
  const raw=storage.getItem(earlyShipmentPendingKey(userId,scope));
  if(!raw)return null;
  let saved;
  try {saved=JSON.parse(raw);} catch {throw new Error('선출고 복구 기록을 읽을 수 없습니다.');}
  if(saved?.inputUser!==userId || saved?.requestScope!==scope
    || !['APPLY','REVERSE'].includes(saved?.body?.action)
    || !OPERATION_UUID.test(saved.body.operationId || '')
    || (saved.body.action==='REVERSE' && !OPERATION_UUID.test(saved.body.reversalOperationId || '')))
    throw new Error('선출고 복구 작업 정보가 불완전합니다.');
  return saved.body;
}

export function persistEarlyShipmentPending(storage, userId, scope, body) {
  const key=earlyShipmentPendingKey(userId,scope);
  const previous=readEarlyShipmentPending(storage,userId,scope);
  if(previous) {
    if(JSON.stringify(previous)!==JSON.stringify(body)) throw new Error('이 범위에 결과 미확인 선출고 작업이 있습니다. 같은 작업만 확인하세요.');
    return key;
  }
  storage.setItem(key,JSON.stringify({inputUser:userId,requestScope:scope,body}));
  return key;
}

export function clearEarlyShipmentPending(storage, userId, scope, body) {
  const key=earlyShipmentPendingKey(userId,scope);
  const previous=readEarlyShipmentPending(storage,userId,scope);
  if(previous && JSON.stringify(previous)!==JSON.stringify(body)) throw new Error('다른 선출고 복구 작업이 있습니다. 기록을 유지합니다.');
  storage.removeItem(key);
}

export function earlyShipmentPostFailure(status, result) {
  const error=new Error(result?.error || `선출고 요청 실패 (${status})`);
  error.rolledBack=result?.rolledBack===true;
  return error;
}

export function earlyShipmentSourceSnapshot({ cycle, date, prodKey, plans = [], compareRows = [], custKey }) {
  const day = cycle?.days?.find(item => item.date === date && item.calendarState === 'FOUND');
  if (cycle?.calendarState !== 'FOUND' || !day) throw new Error('원천 실제 날짜와 전산 달력을 확인하세요.');
  const identityRows=compareRows.filter(row => Number(row.year) === Number(cycle.year)
    && Number(row.custKey) === Number(custKey) && Number(row.prodKey) === Number(prodKey));
  const dated=identityRows.flatMap(row => (row.shipmentDates || [])
    .filter(value => String(value.date).slice(0,10) === date).map(value => ({row,value})));
  if (dated.length > 1 || dated.some(item => String(item.row.orderWeek).split('-')[0] !== String(cycle.majorWeek)))
    throw new Error('원천 날짜의 실제 출고 상세가 중복되거나 선택한 큰 차수 밖에 있습니다.');
  // The saved shipment week wins over the calendar's suggested subweek. Native
  // shipments can legitimately retain 40-01 on a Tuesday shown under 40-02.
  const effectiveOrderWeek=dated.length ? dated[0].row.orderWeek : day.orderWeek;
  const matches=identityRows.filter(row => row.orderWeek === effectiveOrderWeek);
  if (matches.length !== 1) throw new Error('원천 날짜의 최신 전산 업무키를 확인하세요.');
  const row = matches[0];
  if (row.customerLinkError || !normalizeWeekdayUnit(row.outUnit)
    || typeof row.snapshotDigest !== 'string' || !/^[a-f0-9]{64}$/.test(row.snapshotDigest)
    || !Array.isArray(row.shipmentDates) || !Number.isInteger(row.detailRows) || row.detailRows > 1)
    throw new Error('원천 전산 스냅샷·단위·거래처 연결을 확인하세요.');
  const actualQuantity=dated[0]?.value.shipmentQuantity;
  if(dated.length && !knownNonnegative(actualQuantity)) throw new Error('현재 날짜 분배량이 NULL·빈값이거나 미확인입니다.');
  const before = dated.length ? Number(actualQuantity) : isKnownEmptyHorizontalDate(row,date) ? 0 : null;
  if (before === null) throw new Error('현재 날짜 분배량을 확인하세요.');
  const drafts = plans.filter(plan => Number(plan.custKey) === Number(custKey) && Number(plan.year) === Number(cycle.year)
    && Number(plan.prodKey) === Number(prodKey) && plan.date === date && plan.draftScope === weekdayDraftScope(custKey,cycle.year,cycle.majorWeek));
  if (drafts.length > 1 || drafts.some(plan => plan.orderWeek !== effectiveOrderWeek || normalizeWeekdayUnit(plan.unit) !== normalizeWeekdayUnit(row.outUnit)))
    throw new Error('원천 날짜 초안이 중복되거나 전산 업무키·단위와 다릅니다.');
  if(drafts.length && !knownNonnegative(drafts[0].quantity)) throw new Error('최종 날짜 분배량을 확인하세요.');
  const final = drafts.length ? Number(drafts[0].quantity) : before;
  return {row, day:{...day,orderWeek:effectiveOrderWeek}, before, final, draft:drafts[0] || null,
    allocationIntent: final === before ? 'MARK_EXISTING' : 'APPLY_ABSOLUTE'};
}

export function buildEarlyShipmentRequest({ cycle, targetCycle, custKey, prodKey, date, quantity, reason,
  operationId, expectedRevision = 0, plans = [], compareRows = [], cycles = [], allowAdditionalClassification = false,
  alreadyClassified = 0 }) {
  const q = Number(quantity), cleanReason = String(reason || '').trim();
  if (!Number.isFinite(q) || q <= 0 || Math.abs(q - Math.round(q * 100) / 100) > 1e-9)
    throw new Error('선출고 재고 조정량은 양수이며 소수 둘째 자리까지 입력하세요.');
  if (!cleanReason || cleanReason.length > 1000) throw new Error('선출고 적용 사유를 입력하세요.');
  if (!targetCycle || !Number.isInteger(Number(targetCycle.year)) || !/^(?:0?[1-9]|[1-4]\d|5[0-3])$/.test(String(targetCycle.majorWeek)))
    throw new Error('대상 다음 큰 차수의 전산 달력을 확인하세요.');
  if (!OPERATION_UUID.test(operationId || ''))
    throw new Error('선출고 작업 UUID를 확인하세요.');
  const source = earlyShipmentSourceSnapshot({cycle,date,prodKey,plans,compareRows,custKey});
  if (alreadyClassified > 0 && !allowAdditionalClassification)
    throw new Error('이 날짜에 처리된 선출고가 있습니다. 추가 분류 의도를 명시하세요.');
  if (!Number.isFinite(alreadyClassified) || alreadyClassified < 0 || q + alreadyClassified > source.final)
    throw new Error('기존 처리량과 새 선출고 분류량의 합계는 원천 날짜 최종 절대수량을 넘을 수 없습니다.');
  const scopeKey = weekdayDraftScope(custKey,cycle.year,cycle.majorWeek);
  let allocationBody;
  if (source.allocationIntent === 'APPLY_ABSOLUTE') {
    const effectiveCycles=cycles.map(item=>Number(item.year)===Number(cycle.year)
      && String(item.majorWeek)===String(cycle.majorWeek)
      ? {...item,days:(item.days || []).map(candidate=>candidate.date===date
        ? {...candidate,orderWeek:source.day.orderWeek}:candidate)} : item);
    const submission = buildWeekdayDistributionSubmission({mode:'ALLOCATION',wilsonDrafts:[],
      plans:[source.draft],compareRows,cycles:effectiveCycles,custKey,scopeKey,reason:cleanReason,operationId});
    if (submission.payload.changes.length !== 1 || submission.payload.changes[0].dates.length !== 1)
      throw new Error('원천 날짜 하나의 분배 변경만 선출고에 연결할 수 있습니다.');
    allocationBody = submission.payload;
  } else {
    allocationBody = {mode:'ALLOCATION',operationId,custKey:Number(custKey),reason:cleanReason,changes:[{
      year:Number(cycle.year),orderWeek:source.day.orderWeek,prodKey:Number(prodKey),unit:normalizeWeekdayUnit(source.row.outUnit),
      expected:{snapshotDigest:source.row.snapshotDigest,detailRows:source.row.detailRows,
        shipmentOutQuantity:source.row.shipmentOutQuantity,shipmentDates:source.row.shipmentDates},
      dates:[{date,quantity:source.final}]
    }]};
  }
  return {action:'PREVIEW',operationId,expectedRevision,reason:cleanReason,custKey:Number(custKey),prodKey:Number(prodKey),
    sourceYear:Number(cycle.year),sourceMajorWeek:String(cycle.majorWeek),targetYear:Number(targetCycle.year),
    targetMajorWeek:String(targetCycle.majorWeek),unit:normalizeWeekdayUnit(source.row.outUnit),quantity:q,
    sourceDate:date,sourceDateFinal:source.final,allocationIntent:source.allocationIntent,allocationBody,
    ...(allowAdditionalClassification ? {allowAdditionalClassification:true} : {})};
}
