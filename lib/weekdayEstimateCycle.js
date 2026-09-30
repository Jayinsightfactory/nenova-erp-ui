// Business shipping cycle is Thu..Wed. Never derive ERP week numbers from ISO weeks.
import { normalizeWeekdayUnit } from './weekdayEstimateCompare.js';
export const SHIPPING_DAYS = Object.freeze([
  { label: '목', code: 5, suffix: '01' }, { label: '금', code: 6, suffix: '01' },
  { label: '토', code: 7, suffix: '01' }, { label: '일', code: 1, suffix: '01' },
  { label: '월', code: 2, suffix: '02' }, { label: '화', code: 3, suffix: '02' },
  { label: '수', code: 4, suffix: '02' },
]);

export function normalizeCycleRequest(body = {}) {
  const year = String(body.year ?? '').trim();
  const major = String(body.majorWeek ?? '').trim().padStart(2, '0');
  if (!/^\d{4}$/.test(year) || Number(year) < 2000 || Number(year) > 2200) throw new Error('연도를 명시하세요.');
  if (!/^\d{2}$/.test(major) || Number(major) < 1 || Number(major) > 53) throw new Error('대차수는 1~53입니다.');
  return { year: Number(year), majorWeek: major, orderYearWeek: `${year}${major}` };
}

export function dateKey(value) {
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('출고일이 올바르지 않습니다.');
  const parsed = new Date(`${text}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) throw new Error('실제 출고일이 아닙니다.');
  return text;
}

export function shiftDate(value, count) {
  const date = new Date(`${dateKey(value)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

// Every actual date/timestamp must come from PeriodDay; missing/duplicate dates are not guessed.
export function buildShippingCycles(periodRows, scope) {
  const anchorRows = periodRows.filter((row) => String(row.OrderYearWeek) === scope.orderYearWeek && Number(row.WeekDay) === 5);
  if (anchorRows.length !== 1) throw new Error('선택 차수의 목요일 달력이 없거나 중복입니다.');
  const anchor = dateKey(anchorRows[0].BaseYmd);
  if (new Date(`${anchor}T00:00:00Z`).getUTCDay() !== 4) throw new Error('PeriodDay 목요일 코드와 날짜가 다릅니다.');
  const byDate = new Map();
  for (const row of periodRows) {
    const key = dateKey(row.BaseYmd);
    byDate.set(key, [...(byDate.get(key) || []), row]);
  }
  return [-1, 0, 1].map((offset) => {
    const startDate = shiftDate(anchor, offset * 7);
    const thursdayRows = (byDate.get(startDate) || []).filter((row) => Number(row.WeekDay) === 5);
    const key = thursdayRows.length === 1 ? String(thursdayRows[0].OrderYearWeek) : '';
    const validIdentity = /^\d{6}$/.test(key) && Number(key.slice(4)) >= 1 && Number(key.slice(4)) <= 53;
    const year = validIdentity ? Number(key.slice(0, 4)) : null;
    const majorWeek = validIdentity ? key.slice(4) : null;
    return {
      offset, year, majorWeek, startDate, endDate: shiftDate(startDate, 6),
      calendarState: validIdentity ? 'FOUND' : 'MISSING_CYCLE',
      days: SHIPPING_DAYS.map((day, index) => {
        const date = shiftDate(startDate, index);
        const matches = (byDate.get(date) || []).filter((row) => Number(row.WeekDay) === day.code);
        const state = matches.length === 1 ? 'FOUND' : matches.length ? 'AMBIGUOUS' : 'MISSING';
        return { ...day, date, orderWeek: majorWeek ? `${majorWeek}-${day.suffix}` : null,
          periodTimestamp: state === 'FOUND' ? matches[0].BaseYmd : null, calendarState: state };
      }),
    };
  });
}

export function locateShippingDay(cycles, value) {
  const date = dateKey(value);
  for (const cycle of cycles || []) {
    const day = cycle.days.find((item) => item.date === date);
    if (day) return { cycle, day };
  }
  return null;
}

// A draft move is one paired event. Inventory source stays unchanged unless explicitly reallocated.
export function moveWeekdayPlan(plans, { id, quantity, date, reason, eventId }, cycles) {
  const original = plans.find((plan) => plan.id === id);
  const amount = Number(quantity);
  if (!original || !Number.isFinite(amount) || amount <= 0 || amount > Number(original.quantity)) throw new Error('이동수량을 확인하세요.');
  const target = locateShippingDay(cycles, date);
  if (!target || target.day.calendarState !== 'FOUND' || target.cycle.calendarState !== 'FOUND') throw new Error('이동 대상 전산 달력을 확인하세요.');
  if (!String(reason ?? '').trim() || !String(eventId ?? '').trim()) throw new Error('변경 사유와 이동 ID가 필요합니다.');
  if (original.date === target.day.date && Number(original.year) === target.cycle.year && original.orderWeek === target.day.orderWeek) throw new Error('변경된 출고일 또는 차수가 없습니다.');
  if (plans.some((plan) => plan.moveEventId === eventId)) throw new Error('이미 기록한 이동입니다.');
  const moved = { ...original, id: `${id}|move:${eventId}`, moveEventId: eventId,
    year: target.cycle.year, orderWeek: target.day.orderWeek, date: target.day.date, quantity: amount };
  const remaining = Number(original.quantity) - amount;
  const next = plans.flatMap((plan) => plan.id !== id ? [plan] : remaining > 0 ? [{ ...plan, quantity: remaining }] : []);
  next.push(moved);
  return { plans: next, event: {
    id: eventId, kind: 'DRAFT_MOVE', applied: false, prodKey: original.prodKey, unit: original.unit,
    quantity: amount, reason: String(reason).trim(),
    before: { year: original.year, orderWeek: original.orderWeek, date: original.date },
    after: { year: moved.year, orderWeek: moved.orderWeek, date: moved.date },
    source: { year: original.sourceYear ?? null, orderWeek: original.sourceOrderWeek ?? null, wdetailKey: original.wdetailKey ?? null },
  } };
}

export function buildWeekdayMatrix(cycle, plans, comparisons) {
  const scoped = (comparisons || []).filter((row) => Number(row.year) === cycle.year && String(row.orderWeek).split('-')[0] === cycle.majorWeek);
  const draft = (plans || []).filter((row) => Number(row.year) === cycle.year && String(row.orderWeek).split('-')[0] === cycle.majorWeek);
  const keys = [...new Set([...scoped, ...draft].map((row) => Number(row.prodKey)))];
  return keys.map((prodKey) => {
    const actual = scoped.filter((row) => Number(row.prodKey) === prodKey);
    const proposed = draft.filter((row) => Number(row.prodKey) === prodKey);
    const normalizedUnits = [...actual.map((row) => normalizeWeekdayUnit(row.outUnit)), ...proposed.map((row) => normalizeWeekdayUnit(row.unit))];
    const units = [...new Set(normalizedUnits.filter(Boolean))];
    const sameUnit = units.length === 1 && normalizedUnits.every((unit) => unit !== null);
    const days = cycle.days.map((day) => {
      const dates = actual.flatMap((row) => row.shipmentDates.map((item) => ({ ...item, orderWeek: row.orderWeek }))).filter((item) => dateKey(item.date) === day.date);
      const edits = proposed.filter((item) => item.date === day.date);
      const known = actual.length > 0 && actual.every((row) => row.shipmentOutQuantity !== null);
      const current = known && sameUnit ? dates.reduce((sum, item) => sum + Number(item.shipmentQuantity), 0) : null;
      const planned = edits.length && sameUnit ? edits.reduce((sum, item) => sum + Number(item.quantity), 0) : null;
      return { ...day, current, planned, delta: current !== null && planned !== null ? planned - current : null,
        remaining: null, actualOrderWeeks: [...new Set(dates.map((item) => item.orderWeek))],
        assignedWeekMismatch: dates.some((item) => item.orderWeek !== day.orderWeek) };
    });
    const outside = actual.flatMap((row) => row.shipmentDates.map((item) => ({ ...item, orderWeek: row.orderWeek }))).filter((item) => !cycle.days.some((day) => day.date === dateKey(item.date)));
    return { prodKey, name: proposed[0]?.prodName || actual[0]?.prodName || `품목 ${prodKey}`,
      unit: sameUnit ? units[0] : null, unitState: sameUnit ? 'MATCHED' : 'REVIEW', days, outside,
      fixed: actual.some((row) => row.fixed === true || row.fixed === 'mixed'),
      currentTotal: sameUnit && actual.length && actual.every((row) => row.shipmentOutQuantity !== null) ? actual.reduce((sum, row) => sum + row.shipmentOutQuantity, 0) : null,
      plannedTotal: sameUnit && proposed.length ? proposed.reduce((sum, row) => sum + Number(row.quantity), 0) : null,
      sources: [...new Set(proposed.map((row) => row.sourceOrderWeek ? `${row.sourceYear}/${row.sourceOrderWeek}` : '입고 원천 미지정'))],
    };
  });
}
