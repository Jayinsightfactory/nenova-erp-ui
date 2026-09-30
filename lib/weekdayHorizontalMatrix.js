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

// No API/ERP mutations: every editable quantity is a browser-only proposal.
export function buildHorizontalWeekdayMatrix(cycles = [], plans = [], comparisons = []) {
  const orderedCycles = [...array(cycles)].sort((a, b) => a.offset - b.offset);
  const draft = array(plans);
  const actual = array(comparisons);
  const inScope = (row) => orderedCycles.some((cycle) => belongsToHorizontalCycle(row, cycle));
  const keys = unique([...actual, ...draft].filter(inScope).map((row) => Number(row.prodKey)))
    .filter((key) => Number.isInteger(key) && key > 0);
  const columns = orderedCycles.flatMap((cycle) => [
    ...array(cycle.days).map((day) => ({ kind: 'day', cycle, day })), { kind: 'total', cycle },
  ]);
  const rows = keys.map((prodKey) => {
    const source = [...actual, ...draft].filter((row) => Number(row.prodKey) === prodKey);
    const scopedSource = source.filter(inScope);
    // Prior-year/outside rows supply display identity only, never unit or quantity fallbacks.
    const name = scopedSource.find((row) => row.prodName)?.prodName
      || source.find((row) => row.prodName)?.prodName || `품목 ${prodKey}`;
    const flowerNames = unique(scopedSource.map((row) => row.flowerName ?? row.FlowerName).filter(Boolean));
    const fallbackUnit = commonUnit(scopedSource.map((row) => row.outUnit ?? row.unit));
    const blocks = orderedCycles.map((cycle) => {
      const productActuals = actual.filter((row) => Number(row.prodKey) === prodKey && belongsToHorizontalCycle(row, cycle));
      const productPlans = draft.filter((row) => Number(row.prodKey) === prodKey && belongsToHorizontalCycle(row, cycle));
      const units = [...productActuals.map((row) => row.outUnit), ...productPlans.map((row) => row.unit)];
      const unit = units.length ? commonUnit(units) : fallbackUnit;
      const dated = productActuals.flatMap((row) => array(row.shipmentDates)
        .map((item) => ({ ...item, date: date(item.date), originalDate: item.date, orderWeek: row.orderWeek, unit: row.outUnit })));
      const days = array(cycle.days).map((day) => {
        const actualDetails = dated.filter((item) => item.date !== null && item.date === day.date);
        const drafts = productPlans.filter((plan) => date(plan.date) !== null && date(plan.date) === day.date);
        const actualUnit = commonUnit(actualDetails.map((item) => item.unit));
        const actualOrderWeeks = unique(actualDetails.map((item) => item.orderWeek));
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
        return { ...day, current, planned, unit, actualUnit, drafts, actualDetails, actualOrderWeeks,
          effectiveOrderWeek, remaining: null,
          delta: current !== null && planned !== null && actualUnit === unit ? planned - current : null,
          assignedWeekMismatch: actualOrderWeeks.some((week) => week !== day.orderWeek),
          editDisabledReason: reasons.join(' / ') };
      });
      const outside = dated.filter((item) => !array(cycle.days).some((day) => item.date !== null && item.date === day.date));
      const outsideDrafts = productPlans.filter((plan) => !array(cycle.days).some((day) => date(plan.date) !== null && date(plan.date) === day.date));
      const contributingActuals = productActuals.filter((row) => row.state !== 'NO_SHIPMENT'
        || array(row.shipmentDates).length || knownNumber(row.shipmentOutQuantity));
      const currentTotal = unit ? sumKnown(contributingActuals, 'shipmentOutQuantity') : null;
      const plannedTotal = unit ? sumKnown(productPlans, 'quantity') : null;
      return { cycle, unit, unitState: unit ? 'MATCHED' : 'REVIEW', days, outside, outsideDrafts,
        productActuals, productPlans, currentTotal, plannedTotal,
        fixed: productActuals.some((row) => row.fixed === true || row.fixed === 'mixed'),
        sources: unique(productPlans.map((plan) => plan.sourceOrderWeek
          ? `${plan.sourceYear ?? '?'}/${plan.sourceOrderWeek}` : '입고 원천 미지정')) };
    });
    return { prodKey, name, flowerNames, blocks };
  });
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
