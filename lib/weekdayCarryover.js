import { normalizeWeekdayUnit } from './weekdayEstimateCompare.js';
import { shiftDate } from './weekdayEstimateCycle.js';

const list = value => Array.isArray(value) ? value : [];
const numeric = value => typeof value === 'number' && Number.isFinite(value);
const scopeKey = (cycle, prodKey) => `${Number(cycle.year)}|${cycle.majorWeek}|${Number(prodKey)}`;
const moneyless = value => Number(value.toFixed(9));

// A manual closing balance is a page-only seed, not ERP stock or shipment quantity.
// Never create an automatic zero seed for unregistered historical carry.
export function buildWeekdayCarryoverLedger(context = {}, records = []) {
  const custKey = Number(context.custKey);
  if (!Number.isSafeInteger(custKey) || custKey <= 0) return new Map();
  const cycles = [...list(context.cycles)].sort((a,b)=>String(a.startDate).localeCompare(String(b.startDate)));
  const inputs = list(context.inputs).filter(row=>row.custKey == null || Number(row.custKey) === custKey);
  const validRecords = list(records).filter(row=>Number(row.custKey) === custKey);
  const products = new Set([...inputs.map(row=>Number(row.prodKey)), ...validRecords.map(row=>Number(row.prodKey))]);
  const result = new Map();
  for (const prodKey of products) {
    let previous = null;
    for (const cycle of cycles) {
      const key = scopeKey(cycle, prodKey);
      const matches = inputs.filter(row=>scopeKey(row,prodKey)===key && Number(row.prodKey)===prodKey);
      const input = matches.length === 1 ? matches[0] : null;
      const unit = normalizeWeekdayUnit(input?.unit ?? input?.outUnit);
      const overrides = validRecords.filter(row=>scopeKey(row,prodKey)===key && Number(row.prodKey)===prodKey);
      const manual = overrides.length === 1 ? overrides[0] : null;
      const incomingActive = previous?.active === true;
      const consecutive = !previous || /^\d{4}-\d{2}-\d{2}$/.test(String(previous.startDate))
        && shiftDate(previous.startDate,7) === cycle.startDate;
      let error = !input || input.valid === false || !numeric(input.basis) || !numeric(input.allocated) || !unit
        ? input?.error || '이월 계산 기준 미확인' : '';
      const validCycle=cycle.calendarState==='FOUND' && /^\d{4}-\d{2}-\d{2}$/.test(String(cycle.startDate));
      if(!validCycle) error='차수 달력 미확인';
      if (!consecutive) error = '전후 차수 달력 간격 미확인';
      if (overrides.length > 1) error = '마감 잔량 중복';
      const incoming = incomingActive
        ? consecutive && previous.unit === unit && numeric(previous.closing) ? previous.closing : null
        : null;
      if (incomingActive && incoming === null) error = error || '전차수 잔량 또는 단위 미확인';
      const baseRemainder = !error ? moneyless(input.basis-input.allocated) : null;
      let closing = baseRemainder;
      let active = incomingActive;
      if (incomingActive) closing = !error && numeric(incoming) ? moneyless(incoming+baseRemainder) : null;
      if (manual) {
        active = true;
        if (!validCycle || manual.startDate !== cycle.startDate || normalizeWeekdayUnit(manual.unit) !== unit || !numeric(manual.quantity)) {
          closing = null; error = '수동 마감 잔량의 달력·단위 확인 필요';
        } else {
          closing = manual.quantity;
          // A valid authoritative manual closing can restart a previously unknown chain.
          error = '';
        }
      }
      const state = { year:Number(cycle.year), majorWeek:cycle.majorWeek, startDate:cycle.startDate, prodKey,
        unit, incoming, closing, baseRemainder, active, manual,
        source:incomingActive ? {year:previous.year,majorWeek:previous.majorWeek} : null,
        provisional:Boolean(!manual && (input?.provisional || (incomingActive && previous?.provisional))),
        hasDraft:Boolean(!manual && (input?.hasDraft || (incomingActive && previous?.hasDraft))), error,
        incomingProvisional:Boolean(incomingActive && previous?.provisional),
        incomingHasDraft:Boolean(incomingActive && previous?.hasDraft) };
      result.set(key,state); previous=state;
    }
  }
  return result;
}

export function applyWeekdayCarryoverToMatrix(matrix, context = {}, records = [], plans = []) {
  const rows = list(matrix.rows).map(row=>({...row,blocks:list(row.blocks).map(block=>({...block}))}));
  if (!Number.isSafeInteger(Number(context.custKey)) || Number(context.custKey)<=0) return {...matrix,rows};
  // Displayed drafts use the matrix's validated date projection. An out-of-view
  // draft must not silently revert to the stored quantity while navigating.
  const inputs = list(context.inputs).map(input=>{
    const row=rows.find(item=>Number(item.prodKey)===Number(input.prodKey));
    const block=row?.blocks.find(item=>scopeKey(item.cycle,row.prodKey)===scopeKey(input,row.prodKey));
    const scopedDrafts=list(plans).filter(plan=>Number(plan.prodKey)===Number(input.prodKey)
      && Number(plan.year)===Number(input.year) && String(plan.orderWeek).split('-')[0]===input.majorWeek
      && (plan.custKey==null || Number(plan.custKey)===Number(context.custKey)));
    if(!block) return scopedDrafts.length
      ? {...input,valid:false,hasDraft:true,error:'화면 밖 차수의 초안 확인 필요'} : input;
    if(scopedDrafts.some(plan=>!list(block.productPlans).some(shown=>shown.id===plan.id)))
      return {...input,valid:false,hasDraft:true,error:'다른 조회 범위에 보관된 초안 확인 필요'};
    if(input.valid===false) return input;
    if(normalizeWeekdayUnit(input.unit ?? input.outUnit)!==normalizeWeekdayUnit(block.unit))
      return {...input,valid:false,hasDraft:scopedDrafts.length>0 || Boolean(block.remainderMajorView?.hasDraft),error:'초안 또는 전산 수량 단위 충돌'};
    const remaining=block.remainderMajorView;
    if(!remaining) return input;
    if(!numeric(remaining.value)) {
      // Server context includes absent product rows in validated baseline scopes,
      // while the legacy matrix deliberately has no fallback for that shape.
      // Keep the SELECT-only context; only an invalid browser projection must block it.
      if(!remaining.hasDraft) return input;
      return {...input,valid:false,error:'현재 화면 잔량 기준 미확인'};
    }
    return {...input,basis:remaining.value,allocated:0,unit:block.unit,valid:true,
      provisional:remaining.hasProvisional,hasDraft:remaining.hasDraft};
  });
  const ledger=buildWeekdayCarryoverLedger({...context,inputs},records);
  for(const row of rows) for(const block of row.blocks) {
    const carry=ledger.get(scopeKey(block.cycle,row.prodKey));
    if(!carry) continue;
    block.carryover=carry;
    if(!carry.active) continue;
    block.remainderMajorView={...block.remainderMajorView,value:carry.closing,
      hasDraft:carry.hasDraft,hasProvisional:carry.provisional,
      label:carry.error || (carry.manual?'수동 마감':carry.hasDraft?'이월·초안 예상':carry.provisional?'이월·미확정 예상':'이월 포함 잔량')};
    if(carry.source) block.remainder01View={...block.remainder01View,
      value:numeric(carry.incoming)&&numeric(block.remainder01View?.value)
        ? moneyless(carry.incoming+block.remainder01View.value):null,
      hasDraft:Boolean(carry.incomingHasDraft || block.remainder01View?.hasDraft),
      hasProvisional:Boolean(carry.incomingProvisional || block.remainder01View?.hasProvisional),
      label:carry.error || (carry.incomingHasDraft || block.remainder01View?.hasDraft?'이월·초안 예상':carry.incomingProvisional || block.remainder01View?.hasProvisional?'이월·미확정 예상':'이월 포함 잔량')};
  }
  return {...matrix,rows};
}
