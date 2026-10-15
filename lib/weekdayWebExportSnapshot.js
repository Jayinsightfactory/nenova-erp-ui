import { weekdayFlowerGroup, compareWeekdayFlowerRows, horizontalCycleKey } from './weekdayHorizontalMatrix.js';
import { suggestDisplayName } from './displayName.js';
import { recoverWeekdayWilsonEditing } from './weekdayWilsonEditing.js';

const exportFlowerAliases = {
  '카네이션':['CARNATION'], '장미':['ROSE'], '수국':['HYDRANGEA'],
  '알스트로':['ALSTROEMERIA','ALSTROMERIA'],
};
const regexEscape = value => value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
// Only a category prefix is redundant. Never remove a substring in a variety name.
export function weekdayExportProductName(row, category) {
  const original = row.displayName?.trim() || suggestDisplayName(row.name);
  const flowerCategory=/ 장미$/.test(category) || category==='장미 (국가 미확인)'?'장미':category;
  const aliases = [category,flowerCategory,...(exportFlowerAliases[flowerCategory] || [])].filter(Boolean).map(regexEscape);
  const prefix = new RegExp(`^(?:(SPRAY|스프레이|SP)\\s+)?(?:${aliases.join('|')})(?=$|[\\s/·,:()\\[\\]-])[\\s/·,:-]*`,'i');
  const match = original.match(prefix);
  if(!match) return original;
  const remainder = original.slice(match[0].length).trim();
  return remainder ? [match[1],remainder].filter(Boolean).join(' ') : original;
}
const number = value => value == null ? null : value !== '' && ['number','string'].includes(typeof value) && Number.isFinite(Number(value)) ? Number(value) : (() => { throw Error('엑셀 수량을 확인하세요.'); })();
export function weekdayWebExportCycleKey(cycle) {
  const year=Number(cycle?.year), week=Number(cycle?.majorWeek);
  return Number.isInteger(year) && year>=2000 && year<=2100 && Number.isInteger(week) && week>=1 && week<=53
    ? `${year}|${String(week).padStart(2,'0')}` : '';
}
export function weekdayWebExportSelectionNames(selectedCycles) {
  if (!Array.isArray(selectedCycles) || !selectedCycles.length || selectedCycles.some(key=>!/^(?:20\d{2}|2100)\|(?:0[1-9]|[1-4]\d|5[0-3])$/.test(key)))
    throw Error('다운로드할 차수를 하나 이상 선택하세요.');
  const ordered=[...new Set(selectedCycles)].sort();
  const groups=[];
  for (const key of ordered) {
    const [year,week]=key.split('|');
    const last=groups.at(-1);
    if(last?.year===year) last.weeks.push(week);
    else groups.push({year,weeks:[week]});
  }
  return {
    title:groups.length===1 ? `${groups[0].weeks.map(week=>Number(week)).join('·')}차`
      : groups.map(group=>`${group.year}년 ${group.weeks.map(week=>Number(week)).join('·')}차`).join(' · '),
    file:groups.map(group=>[group.year,...group.weeks].join('_')).join('_'),
  };
}
export function selectWeekdayWebExportCycles(cycles, selectedCycles) {
  if (!Array.isArray(cycles) || !cycles.length) throw Error('전산 조회 후 다운로드하세요.');
  if (selectedCycles == null) return cycles;
  if (!Array.isArray(selectedCycles) || !selectedCycles.length) throw Error('다운로드할 차수를 하나 이상 선택하세요.');
  const keys=cycles.map(weekdayWebExportCycleKey), wanted=new Set(selectedCycles);
  if (keys.some(key=>!key) || keys.length!==new Set(keys).size || wanted.size!==selectedCycles.length
    || [...wanted].some(key=>!keys.includes(key))) throw Error('선택한 차수가 현재 조회 범위와 다릅니다. 다시 선택하세요.');
  return cycles.filter((_,index)=>wanted.has(keys[index]));
}
export function buildWeekdayWebExportSnapshot(matrix, title = '주광 발주내역', {wilsonDay='일',wilsonRecords=[],wilsonDrafts=[],custKey,selectedCycles}={}) {
  if (!matrix?.cycles?.length || !Array.isArray(matrix.rows)) throw Error('전산 조회 후 다운로드하세요.');
  const exportCycles=selectWeekdayWebExportCycles(matrix.cycles, selectedCycles);
  const columns = [], specs = [];
  const add = (cycle, kind, label, day) => {
    const key = `${horizontalCycleKey(cycle)}|${kind}|${day?.date || ''}`;
    const suffix=day && cycle.days.indexOf(day)<4?'1':'2';
    columns.push({ key, label, kind, ...(day?{groupKey:`${cycle.year}|${cycle.majorWeek}-${suffix}`,groupLabel:`${cycle.majorWeek}-${suffix}`}:{}) }); specs.push({ key, cycle, kind, day });
  };
  const addDay = (cycle, day) => {
    const shortDate = day.date.slice(5).replace('-', '/');
    add(cycle,'day',`${shortDate}\n${day.label}`,day);
    if(day.label===wilsonDay) {
      add(cycle,'wilson',`${shortDate}\n윌슨 ${day.label}`,day);
      add(cycle,'dayTotal',`${shortDate}\n${day.label} 합계`,day);
    }
  };
  for (const cycle of exportCycles) {
    const prefix = `${cycle.majorWeek}`;
    add(cycle, 'initial01', `${prefix}-1 물량표 기준`);
    for (const day of cycle.days.slice(0, 4)) addDay(cycle, day);
    add(cycle, 'sum01', `${prefix}-1 합계`); add(cycle, 'remaining01', `${prefix}-1 잔량`);
    add(cycle, 'initial02', `${prefix}-2 물량표 기준`);
    for (const day of cycle.days.slice(4)) addDay(cycle, day);
    add(cycle, 'sum02', `${prefix}-2 합계`); add(cycle, 'remaining02', `${prefix}-2 잔량`);
    add(cycle, 'total', `${prefix}차 합계`); add(cycle, 'remaining', `${prefix}차 잔량`);
    add(cycle, 'change', `${prefix}차 변경`);
  }
  const rows = [...matrix.rows].sort(compareWeekdayFlowerRows).flatMap(row => {
    const category = weekdayFlowerGroup(row);
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
        const latestSplit=recoverWeekdayWilsonEditing({record,identity:{year:block.cycle.year,orderWeek:day.effectiveOrderWeek,
          custKey,prodKey:row.prodKey,date:day.date},unit:day.unit,savedTotal,plannedTotal:day.planned,draft,disabledReason:day.editDisabledReason});
        wilson=number(draft?.wilsonQuantity ?? draft?.wilson ?? latestSplit?.wilson ?? (cleared?0:record?.wilson ?? record?.wilsonQuantity ?? 0));
        if(stale && !draft && !latestSplit || wilson==null || wilson<0 || wilson>total || draft && (draft.unit!==day.unit || !Number.isFinite(Number(draft.expectedTotal ?? draft.totalQuantity ?? draft.total))
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
    const name = weekdayExportProductName(row, category);
    return { prodKey: row.prodKey, category, name, unit, values };
    });
  });
  return { title, sheetName: '주광 발주내역', columns, rows };
}
