import { normalizeWeekdayUnit } from './weekdayEstimateCompare.js';

export const horizontalCycleKey = (cycle) => `${cycle.offset}|${cycle.year}|${cycle.majorWeek}|${cycle.startDate}`;
export const belongsToHorizontalCycle = (row, cycle) => cycle.year != null && cycle.majorWeek != null
  && Number(row.year) === Number(cycle.year)
  && String(row.orderWeek ?? '').split('-')[0] === String(cycle.majorWeek);
const array = (value) => Array.isArray(value) ? value : [];
const unique = (values) => [...new Set(values)];
const knownNumber = (value) => value !== null && value !== undefined && value !== ''
  && (typeof value === 'number' || typeof value === 'string') && Number.isFinite(Number(value));
const date = (value) => {
  const key = String(value ?? '').slice(0, 10);
  const parsed = new Date(`${key}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) && Number.isFinite(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === key ? key : null;
};
const commonUnit = (values) => {
  const units = values.map(normalizeWeekdayUnit);
  return units.length && units.every(Boolean) && unique(units).length === 1 ? units[0] : null;
};
const sumKnown = (items, field) => items.length && items.every((item) => knownNumber(item[field]))
  ? items.reduce((sum, item) => sum + Number(item[field]), 0) : null;

// Display-only eligibility. Inspect individual scoped sources, not sums across units/business keys.
export function hasHorizontalShipmentQuantity(row) {
  const positive = (value) => knownNumber(value) && Number(value) > 0;
  return array(row?.blocks).some((block) =>
    array(block.productActuals).some((item) => positive(item.shipmentOutQuantity)
      || array(item.shipmentDates).some((day) => positive(day.shipmentQuantity)))
    || array(block.productPlans).some((plan) => positive(plan.quantity))
    || block.hasPositiveInitial === true || positive(block.initial01?.quantity) || positive(block.initial02?.quantity)
    || block.carryover?.active === true && (Number(block.carryover.closing)!==0 || block.carryover.manual));
}

const packageFields = ['bunchOf1Box','steamOf1Bunch','steamOf1Box'];
const positiveCount = value => knownNumber(value) && Number.isSafeInteger(Number(value)) && Number(value)>0 ? Number(value) : null;
const displayCount = value => value===null || value===undefined ? null : positiveCount(value) ?? 'INVALID';
// Metadata may only come from the already-scoped actual Product reads, not plans or historical baselines.
export function resolveWeekdayPackaging(actuals = []) {
  if (!actuals.length || actuals.some(item=>!item.packaging || typeof item.packaging!=='object')) return null;
  const normalized=actuals.map(item=>Object.fromEntries(packageFields.map(field=>[field,displayCount(item.packaging[field])])));
  return normalized.every(item=>JSON.stringify(item)===JSON.stringify(normalized[0])) ? normalized[0] : null;
}
const nearInteger = value => {
  const integer=Math.round(value);
  return Number.isSafeInteger(integer) && (integer!==0 || value===0)
    && Math.abs(value-integer)<=Math.min(1e-6,Number.EPSILON*Math.max(1,Math.abs(value))*8) ? integer : null;
};
const rawLabel = value => {
  const quantity=Number(value), rounded=Number(quantity.toFixed(6));
  return String(rounded===0 && quantity!==0 ? quantity : rounded);
};
function physicalQuantityLabel(quantity, unit, packaging) {
  const normalizedUnit=normalizeWeekdayUnit(unit);
  if (Number.isInteger(quantity)) return rawLabel(quantity);
  const absolute=Math.abs(quantity), sign=quantity<0?'-':'';
  const boxes=normalizedUnit==='박스'?Math.floor(absolute):0;
  const fraction=normalizedUnit==='박스'?absolute-boxes:absolute-Math.floor(absolute);
  const bunches=normalizedUnit==='단'?Math.floor(absolute):0;
  const b1b=positiveCount(packaging?.bunchOf1Box), s1b=positiveCount(packaging?.steamOf1Bunch), s1box=positiveCount(packaging?.steamOf1Box);
  if (packaging && packageFields.some(field=>packaging[field]!==null && packaging[field]!==undefined && !positiveCount(packaging[field]))) {
    return `${rawLabel(quantity)}${normalizedUnit||''} · 환산 확인`;
  }
  // Contradictory physical pack counts cannot be displayed as an exact conversion.
  if(normalizedUnit==='박스' && b1b && s1b && s1box && b1b*s1b!==s1box) return `${rawLabel(quantity)}박스 · 환산 확인`;
  if(normalizedUnit==='박스' && b1b) {
    const smallBunches=fraction*b1b, integerBunches=nearInteger(smallBunches);
    if(integerBunches!==null) {
      const allBunches=boxes*b1b+integerBunches;
      return sign+[Math.floor(allBunches/b1b)?`${Math.floor(allBunches/b1b)}박스`:'',allBunches%b1b?`${allBunches%b1b}단`:''].filter(Boolean).join(' ');
    }
    if(s1b && (!s1box || b1b*s1b===s1box)) {
      const stems=nearInteger(fraction*b1b*s1b);
      if(stems!==null) {
        const allStems=boxes*b1b*s1b+stems;
        return sign+[Math.floor(allStems/(b1b*s1b))?`${Math.floor(allStems/(b1b*s1b))}박스`:'',
          Math.floor((allStems%(b1b*s1b))/s1b)?`${Math.floor((allStems%(b1b*s1b))/s1b)}단`:'',
          allStems%s1b?`${allStems%s1b}송이`:''].filter(Boolean).join(' ');
      }
    }
  }
  if(normalizedUnit==='박스' && s1box) {
    const stems=nearInteger(fraction*s1box);
    if(stems!==null) {
      const allStems=boxes*s1box+stems;
      return sign+[Math.floor(allStems/s1box)?`${Math.floor(allStems/s1box)}박스`:'',allStems%s1box?`${allStems%s1box}송이`:''].filter(Boolean).join(' ');
    }
  }
  if(normalizedUnit==='단' && s1b) {
    const stems=nearInteger(fraction*s1b);
    if(stems!==null) {
      const allStems=bunches*s1b+stems;
      return sign+[Math.floor(allStems/s1b)?`${Math.floor(allStems/s1b)}단`:'',allStems%s1b?`${allStems%s1b}송이`:''].filter(Boolean).join(' ');
    }
  }
  return `${rawLabel(quantity)}${normalizedUnit||''} · 환산 확인`;
}

// Display aid only. Never change an ERP unit, input quantity, snapshot digest or quote amount.
export function weekdayQuantityLabel(value, row, unit, packaging = null) {
  if (!knownNumber(value)) return '—';
  const quantity = Number(value);
  const label = physicalQuantityLabel(quantity,unit,packaging);
  const alstro = array(row?.flowerNames).some(name => /^(알스트로|알스트로메리아|ALSTROEMERIA|ALSTROMERIA)$/i.test(String(name).trim()));
  return alstro && normalizeWeekdayUnit(unit) === '단'
    ? `${label}(${Number.isInteger(quantity/16)?rawLabel(quantity/16):physicalQuantityLabel(quantity/16,'박스',
      {bunchOf1Box:16,steamOf1Bunch:positiveCount(packaging?.steamOf1Bunch),steamOf1Box:positiveCount(packaging?.steamOf1Bunch)?16*Number(packaging.steamOf1Bunch):null})})` : label;
}

export function horizontalCycleColumns(cycle) {
  const day = item => ({ kind:'day', cycle, day:item });
  return [{kind:'initial01',cycle}, ...array(cycle.days).slice(0,4).map(day),
    {kind:'remaining01',cycle}, {kind:'initial02',cycle},
    ...array(cycle.days).slice(4).map(day), {kind:'remainingMajor',cycle}];
}

export function weekdayProductLabel(row) {
  // Only known flower prefixes are removed, never country/grade/color/size identities.
  return String(row?.name || '').replace(/^(?:ALSTROEMERIA|ALSTROMERIA|CARNATION|HYDRANGEA|ROSE)\s*(?:\/\s*|\s+)/i,'').trim();
}

function baselineAllocation(records, cycle, prodKey, suffix, unit) {
  const matches = records.filter(record => Number(record.year) === Number(cycle.year)
    && record.orderWeek === `${cycle.majorWeek}-${suffix}`);
  if(matches.length !== 1 || !unit) return null;
  const record = matches[0];
  const items = array(record.rows).filter(item => Number(item.prodKey) === prodKey);
  if(items.length !== 1 || !knownNumber(items[0].quantity) || Number(items[0].quantity)<0
    || normalizeWeekdayUnit(items[0].unit)!==unit) return null;
  return {...items[0],quantity:Number(items[0].quantity),confirmedAt:record.confirmedAt,confirmedBy:record.confirmedBy};
}

function datedAllocationTotal(productActuals, dated, days, unit) {
  if(!unit || !productActuals.length || days.some(day => day.calendarState!=='FOUND' || !date(day.date))
    || productActuals.some(row => normalizeWeekdayUnit(row.outUnit)!==unit
      || row.state!=='NO_SHIPMENT' && !knownNumber(row.shipmentOutQuantity))
    || dated.some(item => !item.date || !knownNumber(item.shipmentQuantity) || Number(item.shipmentQuantity)<0)) return null;
  const selected = new Set(days.map(day=>day.date));
  return dated.filter(item=>selected.has(item.date)).reduce((sum,item)=>sum+Number(item.shipmentQuantity),0);
}

const difference = (initial, total) => initial == null || total == null ? null
  : Number((initial-total).toFixed(6));

// No API/ERP mutations: every editable quantity is a browser-only proposal.
export function buildHorizontalWeekdayMatrix(cycles = [], plans = [], comparisons = [], baselines = [], baselineCandidates = [], carryInputs = []) {
  const orderedCycles = [...array(cycles)].sort((a, b) => a.offset - b.offset);
  const draft = array(plans);
  const actual = array(comparisons);
  const initialRecords = array(baselines);
  // Provisional current values are display-only, never historical comparison baselines.
  const candidates = array(baselineCandidates).filter(record=>record.provisional===true && !record.error
    && !initialRecords.some(saved=>Number(saved.year)===Number(record.year) && saved.orderWeek===record.orderWeek));
  const initialRows = initialRecords.flatMap(record=>array(record.rows).map(item=>({...item,
    year:record.year,orderWeek:record.orderWeek,outUnit:item.unit})));
  const inScope = (row) => orderedCycles.some((cycle) => belongsToHorizontalCycle(row, cycle));
  // Carry identities come from separately scoped Product SELECT metadata, never fake shipment rows.
  const carryIdentities=array(carryInputs).map(row=>({...row,orderWeek:`${row.majorWeek}-01`})).filter(inScope);
  const keys = unique([...actual, ...draft, ...initialRows, ...carryIdentities].filter(inScope).map((row) => Number(row.prodKey)))
    .filter((key) => Number.isInteger(key) && key > 0);
  const columns = orderedCycles.flatMap(horizontalCycleColumns);
  const rows = keys.map((prodKey) => {
    const source = [...actual, ...draft, ...initialRows, ...carryIdentities].filter((row) => Number(row.prodKey) === prodKey);
    const scopedSource = source.filter(inScope);
    // Prior-year/outside rows supply display identity only, never unit or quantity fallbacks.
    const name = scopedSource.find((row) => row.prodName)?.prodName
      || source.find((row) => row.prodName)?.prodName || `품목 ${prodKey}`;
    const flowerNames = unique(scopedSource.map((row) => row.flowerName ?? row.FlowerName).filter(Boolean));
    const fallbackUnit = commonUnit(scopedSource.map((row) => row.outUnit ?? row.unit));
    const blocks = orderedCycles.map((cycle) => {
      const productActuals = actual.filter((row) => Number(row.prodKey) === prodKey && belongsToHorizontalCycle(row, cycle));
      const productPlans = draft.filter((row) => Number(row.prodKey) === prodKey && belongsToHorizontalCycle(row, cycle));
      const productInitials = initialRows.filter(row=>Number(row.prodKey)===prodKey && belongsToHorizontalCycle(row,cycle));
      const packaging = resolveWeekdayPackaging(productActuals);
      const units = [...productActuals.map((row) => row.outUnit), ...productPlans.map((row) => row.unit), ...productInitials.map(row=>row.outUnit)];
      const unit = units.length ? commonUnit(units) : fallbackUnit;
      const dated = productActuals.flatMap((row) => array(row.shipmentDates)
        .map((item) => ({ ...item, date: date(item.date), originalDate: item.date, orderWeek: row.orderWeek, unit: row.outUnit })));
      const days = array(cycle.days).map((day) => {
        const actualDetails = dated.filter((item) => item.date !== null && item.date === day.date);
        const drafts = productPlans.filter((plan) => date(plan.date) !== null && date(plan.date) === day.date);
        const actualUnit = commonUnit(actualDetails.map((item) => item.unit));
        // Cancellation tombstones remain in raw evidence and totals, but a known
        // zero cannot make a single live source look like two editable sources.
        const nonzeroWeeks = unique(actualDetails.filter(item=>!knownNumber(item.shipmentQuantity)
          || Number(item.shipmentQuantity)!==0).map(item=>item.orderWeek));
        const rawWeeks = unique(actualDetails.map(item=>item.orderWeek));
        const actualOrderWeeks = nonzeroWeeks.length ? nonzeroWeeks
          : rawWeeks.includes(day.orderWeek) ? [day.orderWeek] : rawWeeks;
        const current = actualUnit && actualOrderWeeks.length === 1 ? sumKnown(actualDetails, 'shipmentQuantity') : null;
        const planned = unit && drafts.length === 1 && normalizeWeekdayUnit(drafts[0].unit) === unit
          ? sumKnown(drafts, 'quantity') : null;
        const effectiveOrderWeek = actualOrderWeeks.length === 1 ? actualOrderWeeks[0] : day.orderWeek;
        const reasons = [];
        if (cycle.calendarState !== 'FOUND' || day.calendarState !== 'FOUND' || !date(day.date)) reasons.push('전산 달력 미확인 또는 중복');
        if (!unit) reasons.push('복수 단위 또는 단위 불명 · 합산/편집 불가');
        if (actualOrderWeeks.length > 1) reasons.push(`실제 업무차수 복수: ${actualOrderWeeks.join(', ')}`);
        if (drafts.length > 1) reasons.push(`같은 날짜 원본 초안 ${drafts.length}건 · 임의 합치기 금지`);
        if (!/^\d{2}-\d{2}$/.test(String(effectiveOrderWeek ?? ''))) reasons.push('업무차수 미확인');
        if (actualDetails.some((item) => !knownNumber(item.shipmentQuantity))
          || drafts.some((item) => !knownNumber(item.quantity) || Number(item.quantity) < 0)) reasons.push('원본 수량 확인 필요');
        if (drafts.length === 1 && drafts[0].orderWeek !== effectiveOrderWeek) reasons.push('원본 초안과 실제 업무차수 불일치');
        return { ...day, current, planned, unit, actualUnit, drafts, actualDetails, actualOrderWeeks, initialOrderWeeks:rawWeeks,
          effectiveOrderWeek, remaining: null,
          delta: current !== null && planned !== null && actualUnit === unit ? planned - current : null,
          assignedWeekMismatch: actualOrderWeeks.some((week) => week !== day.orderWeek),
          editDisabledReason: reasons.join(' / ') };
      });
      const outside = dated.filter((item) => !array(cycle.days).some((day) => item.date !== null && item.date === day.date));
      const outsideDrafts = productPlans.filter((plan) => !array(cycle.days).some((day) => date(plan.date) !== null && date(plan.date) === day.date));
      const contributingActuals = productActuals.filter((row) => row.state !== 'NO_SHIPMENT'
        || array(row.shipmentDates).length || knownNumber(row.shipmentOutQuantity));
      const currentTotal = unit ? sumKnown(contributingActuals, 'shipmentOutQuantity')
        ?? (productInitials.length && productActuals.length && productActuals.every(item=>item.state==='NO_SHIPMENT')?0:null) : null;
      const plannedTotal = unit ? sumKnown(productPlans, 'quantity') : null;
      const initial01 = baselineAllocation(initialRecords,cycle,prodKey,'01',unit);
      const initial02 = baselineAllocation(initialRecords,cycle,prodKey,'02',unit);
      const provisional01 = initial01 ? null : baselineAllocation(candidates,cycle,prodKey,'01',unit);
      const provisional02 = initial02 ? null : baselineAllocation(candidates,cycle,prodKey,'02',unit);
      for(const day of days) {
        // Immutable history must retain both source weeks even when one is now
        // cancelled to zero. The filtered editing key is not a baseline key.
        const needed=day.initialOrderWeeks.length?day.initialOrderWeeks:[day.orderWeek];
        const sources=needed.map(week=>week===`${cycle.majorWeek}-01`?initial01:week===`${cycle.majorWeek}-02`?initial02:null);
        const items=sources.flatMap(source=>array(source?.shipmentDates).filter(item=>date(item.date)===day.date));
        day.initial = sources.every(source=>source && Array.isArray(source.shipmentDates)) && items.every(item=>knownNumber(item.quantity))
          ? items.reduce((sum,item)=>sum+Number(item.quantity),0) : null;
        // Combined display retains full raw keys; multiple live editing sources remain blocked.
        day.displayCurrent = day.current;
        if(day.displayCurrent==null && day.actualDetails.length && day.actualUnit===unit
          && day.actualDetails.every(item=>knownNumber(item.shipmentQuantity))) day.displayCurrent=sumKnown(day.actualDetails,'shipmentQuantity');
        if(day.displayCurrent==null && day.initial!=null && datedAllocationTotal(productActuals,dated,[day],unit)!=null) day.displayCurrent=0;
        const value = day.planned ?? day.displayCurrent;
        day.initialDelta = difference(value,day.initial);
      }
      const firstAllocated = datedAllocationTotal(productActuals,dated,days.slice(0,4),unit);
      const majorAllocated = datedAllocationTotal(productActuals,dated,days,unit);
      const projected = (selected, total) => {
        if(total==null || !selected.some(day=>day.drafts.length)) return null;
        if(selected.some(day=>day.drafts.length && (day.planned==null || day.editDisabledReason))) return null;
        return total + selected.reduce((sum,day)=>sum+(day.planned==null?0:day.planned
          - day.actualDetails.reduce((value,item)=>value+Number(item.shipmentQuantity),0)),0);
      };
      const initialMajor = initial01 && initial02 ? initial01.quantity+initial02.quantity : null;
      const remaining01 = difference(initial01?.quantity,firstAllocated);
      const remainingMajor = difference(initialMajor,majorAllocated);
      const initialChange = difference(currentTotal,initialMajor);
      const projectedRemaining01 = difference(initial01?.quantity,projected(days.slice(0,4),firstAllocated));
      const projectedRemainingMajor = difference(initialMajor,projected(days,majorAllocated));
      // Display planning values separately: never promote a preview into historical initial data.
      const remainderView = (selected, allocated, sources, savedValue) => {
        const hasDraft = selected.some(day=>day.drafts.length);
        const hasProvisional = sources.some(source=>source && source.provisional);
        const basis = sources.every(source=>source?.allocation)
          ? sources.reduce((sum,source)=>sum+source.allocation.quantity,0) : null;
        const effective = hasDraft ? projected(selected,allocated) : allocated;
        return { value:difference(basis,effective), savedValue, hasDraft, hasProvisional,
          label:basis==null || effective==null ? '미확인'
            : hasProvisional ? (hasDraft?'미확정·초안':'미확정 예상') : hasDraft?'초안 예상':'기준 잔량' };
      };
      const firstSource={allocation:initial01 || provisional01,provisional:!initial01};
      const secondSource={allocation:initial02 || provisional02,provisional:!initial02};
      const remainder01View=remainderView(days.slice(0,4),firstAllocated,[firstSource],remaining01);
      const remainderMajorView=remainderView(days,majorAllocated,[firstSource,secondSource],remainingMajor);
      const projectedMajor=projected(days,majorAllocated);
      const effectiveTotal=days.some(day=>day.drafts.length)
        ? projectedMajor==null || currentTotal==null ? null : Number((currentTotal+projectedMajor-majorAllocated).toFixed(6)) : currentTotal;
      const effectiveInitialChange=difference(effectiveTotal,initialMajor);
      return { cycle, unit, packaging, unitState: unit ? 'MATCHED' : 'REVIEW', days, outside, outsideDrafts,
        productActuals, productPlans, productInitials,
        hasPositiveInitial:productInitials.some(item=>knownNumber(item.quantity)&&Number(item.quantity)>0),
        currentTotal, plannedTotal, initial01, initial02, provisional01, provisional02,
        remaining01, remainingMajor, projectedRemaining01, projectedRemainingMajor,
        remainder01View, remainderMajorView, effectiveTotal, effectiveInitialChange,
        initialMajor, initialChange,
        fixed: productActuals.some((row) => row.fixed === true || row.fixed === 'mixed'),
        sources: unique(productPlans.map((plan) => plan.sourceOrderWeek
          ? `${plan.sourceYear ?? '?'}/${plan.sourceOrderWeek}` : '입고 원천 미지정')) };
    });
    const hasWork = (block) => block.productPlans.length > 0 || block.productActuals.some((item) =>
      array(item.shipmentDates).length > 0 || knownNumber(item.shipmentOutQuantity));
    const activePriority = blocks.some((block) => block.cycle.offset === 0 && hasWork(block)) ? 2
      : blocks.some(hasWork) ? 1 : 0;
    return { prodKey, name, flowerNames, blocks, activePriority };
  });
  // Stable sort only: retain every product and every original quantity, including zero.
  rows.sort((left,right)=>right.activePriority-left.activePriority);
  return { cycles: orderedCycles, columns, rows,
    outsidePlans: draft.filter((row) => !inScope(row)), outsideComparisons: actual.filter((row) => !inScope(row)) };
}

export function validateHorizontalQuantity(value) {
  const text = String(value ?? '').trim();
  if (!text) return { state: 'UNCHANGED' };
  if (!/^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)
    || !Number.isFinite(Number(text)) || Number(text) < 0) {
    return { state: 'INVALID', error: '수량은 0 이상의 유한한 숫자로 입력하세요.' };
  }
  return { state: 'VALID', quantity: Number(text) };
}

export function horizontalEditPayload(row, block, day, quantity) {
  if (day.editDisabledReason) throw new Error(day.editDisabledReason);
  const validated = validateHorizontalQuantity(quantity);
  if (validated.state === 'INVALID') throw new Error(validated.error);
  if (validated.state === 'UNCHANGED') return null;
  return { prodKey: row.prodKey, prodName: row.name, unit: day.unit,
    year: block.cycle.year, orderWeek: day.effectiveOrderWeek, date: day.date, quantity: validated.quantity };
}

export function horizontalPrintReason({ cycle, dates = [], mode = 'dates', onPrint, customerProvided, printBusy = false }) {
  if (!customerProvided) return '거래처를 먼저 선택하세요.';
  if (typeof onPrint !== 'function') return '견적 출력 기능 미연결';
  if (printBusy) return '견적 출력 처리 중';
  if (cycle?.calendarState !== 'FOUND' || cycle.year == null || cycle.majorWeek == null) return '차수 전산 달력 미확인';
  if (mode === 'major' && (array(cycle.days).length !== 7 || array(cycle.days).some((day) => day.calendarState !== 'FOUND' || !date(day.date)))) return '전체 7일 전산 달력 확인 필요';
  if (mode === 'dates' && (!dates.length || dates.some((value) => !array(cycle.days)
    .some((day) => day.date === value && day.calendarState === 'FOUND' && date(value))))) return '확인된 출력 요일을 선택하세요.';
  return '';
}
