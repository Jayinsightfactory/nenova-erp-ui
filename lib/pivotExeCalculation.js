import { assertPivotRenderLimit, buildPivotModel, filterRows } from './pivotExeModel.js';
import { pivotIncludedWeeks } from './pivotExeWeekGrouping.js';

// Progress counts completed stages, NOT elapsed time or server SQL completion.
export function calculatePivotResult(rows, options, progress = () => {}) {
  progress(25);
  const selected = filterRows(rows, options);
  progress(50);
  const model = buildPivotModel(selected, { ...options, fieldFilters: undefined, filterTree: undefined });
  assertPivotRenderLimit(model);
  // Never clone the enumerable lazy aoa getter: it materializes a potentially huge matrix.
  const transferableModel = Object.fromEntries(Object.keys(model).filter(key => key !== 'aoa').map(key => [key, model[key]]));
  return {
    model: transferableModel,
    includedWeeks: pivotIncludedWeeks(selected),
    hasStock: selected.some(row => ['01. 전재고','05. 현재고'].includes(row.ListType)),
  };
}

// A job owns one worker. Disposal also rejects queued late events from a replaced job.
export function startPivotCalculation({ createWorker, rows, options, onProgress, onResult, onError }) {
  let active = true;
  let worker;
  const dispose = () => { active = false; worker?.terminate(); };
  const fail = message => { if (!active) return; dispose(); onError(message || '피벗 계산에 실패했습니다. 다시 시도하세요.'); };
  try {
    worker = createWorker();
    worker.onmessage = ({ data }) => {
      if (!active) return;
      if (data.type === 'progress') onProgress(data.percent);
      else if (data.type === 'result') { dispose(); onResult(data.result); }
      else if (data.type === 'error') fail(data.message);
    };
    worker.onerror = () => fail('피벗 계산 모듈을 불러오지 못했습니다. 새로고침 후 다시 시도하세요.');
    worker.onmessageerror = () => fail('피벗 계산 결과를 읽지 못했습니다. 다시 시도하세요.');
    worker.postMessage({ rows, options });
  } catch { fail('피벗 계산을 시작하지 못했습니다. 새로고침 후 다시 시도하세요.'); }
  return dispose;
}
