import { normalizeWeekdayUnit } from './weekdayEstimateCompare.js';

const finitePositive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const sameMajor = (record, block, side) => Number(record[`${side}Year`]) === Number(block.cycle.year)
  && String(record[`${side}MajorWeek`]).padStart(2, '0') === String(block.cycle.majorWeek).padStart(2, '0');

// Linked APPLIED rows are the only classification evidence. This changes display
// remainders, never the immutable baseline, actual ERP quantity, or draft amount.
export function resolveEarlyShipmentRecords(records = []) {
  const unique = new Map();
  let conflict = false;
  for (const record of Array.isArray(records) ? records : []) {
    // The same operation is returned in source and target status requests.
    const signature = JSON.stringify([record.status, record.custKey, record.prodKey,
      normalizeWeekdayUnit(record.unit), record.quantity, record.sourceYear,
      record.sourceMajorWeek, record.targetYear, record.targetMajorWeek,
      record.sourceDate, record.sourceOrderWeek, record.sourceStockAnchorWeek,
      record.targetStockAnchorWeek, record.targetImportWeek, record.allocationIntent,
      record.sourceDateBefore, record.sourceDateFinal, record.sourceDateDelta]);
    const key = record.operationId ? String(record.operationId).toLowerCase() : signature;
    const revision = Number(record.revision ?? 0);
    const previous = unique.get(key);
    if (!Number.isSafeInteger(revision) || revision < 0) conflict = true;
    else if (!previous || revision > previous.revision) unique.set(key, {record, signature, revision});
    else if (revision === previous.revision && previous.signature !== signature) previous.conflict = true;
  }
  conflict ||= [...unique.values()].some(item => item.conflict);
  return {records:conflict ? null : [...unique.values()].map(item => item.record),
    error:conflict ? '선출고 연결 이력이 서로 다릅니다. 다시 조회한 뒤 잔량과 엑셀을 확인하세요.' : ''};
}

export function applyEarlyShipmentClassification(matrix, records = [], custKey) {
  if (!matrix || !Array.isArray(matrix.rows)) return matrix;
  const resolved = resolveEarlyShipmentRecords(records);
  if (resolved.error) return {...matrix,
    earlyClassificationError: resolved.error,
    rows: matrix.rows.map(row => ({...row, blocks: row.blocks.map(block => ({...block,
      remainderMajorView: block.remainderMajorView ? {...block.remainderMajorView, value:null, savedValue:null,
        label:'선출고 연결 이력 미확인'} : block.remainderMajorView,
    }))})),
  };
  const applied = resolved.records.filter(record => record.status === 'APPLIED'
    && Number(record.custKey) === Number(custKey) && finitePositive(record.quantity)
    && normalizeWeekdayUnit(record.unit));
  return {...matrix, rows: matrix.rows.map(row => ({...row, blocks: row.blocks.map(block => {
    const matching = applied.filter(record => Number(record.prodKey) === Number(row.prodKey)
      && (sameMajor(record, block, 'source') || sameMajor(record, block, 'target'))
      && normalizeWeekdayUnit(record.unit) === normalizeWeekdayUnit(block.unit));
    if (!matching.length) return block;
    const source = Number(matching.filter(record => sameMajor(record, block, 'source'))
      .reduce((sum, record) => sum + record.quantity, 0).toFixed(6));
    const target = Number(matching.filter(record => sameMajor(record, block, 'target'))
      .reduce((sum, record) => sum + record.quantity, 0).toFixed(6));
    const classified = Number((source - target).toFixed(6));
    const view = block.remainderMajorView;
    const add = value => value == null || !Number.isFinite(value) ? value : Number((value + classified).toFixed(6));
    return {...block, classifiedEarlyQuantity: source, targetEarlyQuantity: target,
      remainderMajorView: view ? {...view, value: add(view.value), savedValue: add(view.savedValue),
        label: `${view.label || '기준 잔량'} · 선출고 원천 +${source} / 대상 −${target}`} : view};
  })}))};
}

const fixedLabel = flags => flags.length === 0 || flags.some(flag => ![true,false,'mixed'].includes(flag))
  ? '미확인' : flags.includes('mixed') || new Set(flags).size > 1 ? '혼합' : flags[0] ? '확정' : '미확정';

export function earlyShipmentConfirmationLabel(record, compareRows = []) {
  if (!record || !Array.isArray(compareRows)) return '미확인';
  const actual = compareRows.filter(row => Number(row.year) === Number(record.sourceYear)
    && row.orderWeek === record.sourceOrderWeek && Number(row.prodKey) === Number(record.prodKey)
    && Number(row.custKey) === Number(record.custKey));
  if (actual.length) return `현재 ERP ${actual.length===1 && actual[0].detailRows===1
    ? fixedLabel(actual.map(row=>row.fixed)) : '미확인'}`;
  const saved = Array.isArray(record.confirmationAfter) ? record.confirmationAfter.filter(row =>
    Number(row.year) === Number(record.sourceYear) && row.orderWeek === record.sourceOrderWeek
      && Number(row.prodKey) === Number(record.prodKey)) : [];
  return saved.length ? `처리 당시 ${fixedLabel(saved.map(row=>row.fixed))}` : '미확인';
}
