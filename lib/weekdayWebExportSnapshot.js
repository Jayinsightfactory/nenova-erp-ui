import { weekdayFlowerPriority, horizontalCycleKey } from './weekdayHorizontalMatrix.js';

const labels = ['카네이션', '장미', '수국', '알스트로'];
const number = value => value == null ? null : value !== '' && ['number','string'].includes(typeof value) && Number.isFinite(Number(value)) ? Number(value) : (() => { throw Error('엑셀 수량을 확인하세요.'); })();
export function buildWeekdayWebExportSnapshot(matrix, title = '주광 발주내역', {wilsonDay='일',wilsonRecords=[],wilsonDrafts=[],custKey}={}) {
  if (!matrix?.cycles?.length || !Array.isArray(matrix.rows)) throw Error('전산 조회 후 다운로드하세요.');
  const columns = [], specs = [];
  const add = (cycle, kind, label, day) => {
    const key = `${horizontalCycleKey(cycle)}|${kind}|${day?.date || ''}`;
    columns.push({ key, label }); specs.push({ key, cycle, kind, day });
  };
  const addDay = (cycle, day) => {
    add(cycle,'day',`${day.date}\n${day.label}`,day);
    if(day.label===wilsonDay) {
      add(cycle,'wilson',`${day.date}\n윌슨 ${day.label}`,day);
      add(cycle,'dayTotal',`${day.date}\n${day.label} 합계`,day);
    }
  };
  for (const cycle of matrix.cycles) {
    const prefix = `${cycle.year}/${cycle.majorWeek}`;
    add(cycle, 'initial01', `${prefix}-1 최초분배`);
    for (const day of cycle.days.slice(0, 4)) addDay(cycle, day);
    add(cycle, 'sum01', `${prefix}-1 합계`); add(cycle, 'remaining01', `${prefix}-1 잔량`);
    add(cycle, 'initial02', `${prefix}-2 최초분배`);
    for (const day of cycle.days.slice(4)) addDay(cycle, day);
    add(cycle, 'sum02', `${prefix}-2 합계`); add(cycle, 'remaining02', `${prefix}-2 잔량`);
    add(cycle, 'total', `${prefix}차 합계`); add(cycle, 'remaining', `${prefix}차 잔량`);
    add(cycle, 'change', `${prefix}차 변경`);
  }
  const rows = [...matrix.rows].sort((a,b) => weekdayFlowerPriority(a)-weekdayFlowerPriority(b)).flatMap(row => {
    const priority = weekdayFlowerPriority(row);
    const category = labels[priority] || row.flowerNames?.find(Boolean) || '기타';
    const units = [...new Set(row.blocks.map(block => block.unit).filter(Boolean))];
    return (units.length ? units : ['']).map(unit => {
    const values = {};
    for (const spec of specs) {
      const block = row.blocks.find(block => horizontalCycleKey(block.cycle) === horizontalCycleKey(spec.cycle));
      if (!block) throw Error('품목의 차수 조회가 누락되었습니다.');
      if (block.unit !== unit) { values[spec.key] = null; continue; }
      const day = spec.day && block.days.find(day => day.date === spec.day.date);
      const total = day && number(day.planned ?? day.displayCurrent ?? day.current ?? (day.knownEmpty ? 0 : null));
      let wilson = 0;
      if(day && day.label===wilsonDay && total!=null) {
        const matches = record => Number(record.year)===Number(block.cycle.year) && record.orderWeek===day.effectiveOrderWeek
          && Number(record.custKey)===Number(custKey) && Number(record.prodKey)===Number(row.prodKey) && record.date===day.date;
        const records=wilsonRecords.filter(matches), drafts=wilsonDrafts.filter(matches);
        if(records.length>1 || drafts.length>1) throw Error('윌슨 분류가 중복되었습니다.');
        const record=records[0], draft=drafts[0];
        const cleared=record?.status==='CLEARED';
        const savedTotal=day.displayCurrent ?? day.current;
        const stale=record && !cleared && (record.status!=='CURRENT' || record.unit!==day.unit || !Number.isFinite(Number(record.expectedTotal ?? record.total))
          || Math.abs(Number(record.expectedTotal ?? record.total)-Number(savedTotal))>1e-6);
        wilson=number(draft?.wilsonQuantity ?? draft?.wilson ?? (cleared?0:record?.wilson ?? record?.wilsonQuantity ?? 0));
        if(stale && !draft || wilson==null || wilson<0 || wilson>total || draft && (draft.unit!==day.unit || !Number.isFinite(Number(draft.expectedTotal ?? draft.totalQuantity ?? draft.total))
          || Math.abs(Number(draft.expectedTotal ?? draft.totalQuantity ?? draft.total)-total)>1e-6))
          throw Error('윌슨 분류와 현재 수량을 확인한 후 다운로드하세요.');
      }
      const value = spec.kind === 'day' ? total==null ? null : day.label===wilsonDay ? total-wilson : total
        : spec.kind === 'wilson' ? total==null ? null : wilson
        : spec.kind === 'dayTotal' ? total
        : spec.kind === 'initial01' ? (block.initial01 || block.provisional01)?.quantity
        : spec.kind === 'initial02' ? (block.initial02 || block.provisional02)?.quantity
        : spec.kind === 'sum01' ? block.subweek01?.effectiveTotal
        : spec.kind === 'sum02' ? block.subweek02?.effectiveTotal
        : spec.kind === 'remaining01' ? block.remainder01View?.value
        : spec.kind === 'remaining02' ? block.subweek02?.remainderView?.value
        : spec.kind === 'total' ? block.effectiveTotal
        : spec.kind === 'remaining' ? block.remainderMajorView?.value : block.effectiveInitialChange;
      values[spec.key] = number(value);
    }
    return { prodKey: row.prodKey, category, name: row.name, unit, values };
    });
  });
  return { title, sheetName: '주광 발주내역', columns, rows };
}
