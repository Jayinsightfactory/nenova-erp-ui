import { useEffect, useMemo, useState } from 'react';
import { buildPivotModel } from './pivotExeModel';
import { startPivotCalculation } from './pivotExeCalculation';

const EMPTY = { model: buildPivotModel([]), includedWeeks: [], hasStock: false };

export function usePivotExeCalculation(rows, options, enabled) {
  const [retry, setRetry] = useState(0);
  const input = useMemo(() => ({ rows, options, retry }), [rows, options, retry]);
  const [state, setState] = useState({ input: null, job: null, result: EMPTY, percent: 25, error: '', visible: false });
  useEffect(() => {
    if (!enabled) return undefined;
    setState(previous => ({ ...previous, input: null, job: input, percent: 25, error: '', visible: true }));
    return startPivotCalculation({
      createWorker: () => new Worker(new URL('./pivotExeWorker.js', import.meta.url)),
      rows, options,
      onProgress: percent => setState(previous => ({ ...previous, percent })),
      onResult: result => setState({ input, job: input, result, percent: 75, error: '', visible: true }),
      onError: error => setState(previous => ({ ...previous, input, error, visible: false })),
    });
  }, [input, enabled]);
  useEffect(() => {
    if (!enabled || state.input !== input || state.error || state.percent !== 75) return undefined;
    let secondFrame;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => setState(previous => previous.input === input ? { ...previous, percent: 100 } : previous));
    });
    return () => { cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame); };
  }, [enabled, input, state.input, state.percent, state.error]);
  useEffect(() => {
    if (!enabled || state.input !== input || state.percent !== 100 || state.error) return undefined;
    const timer = setTimeout(() => setState(previous => previous.input === input ? { ...previous, visible: false } : previous), 350);
    return () => clearTimeout(timer);
  }, [enabled, input, state.input, state.percent, state.error]);
  const current = state.input === input;
  return { ...state.result,
    percent: state.job === input ? state.percent : 25,
    visible: enabled && (!current || state.visible),
    ready: enabled && current && !state.error,
    pending: enabled && (!current || (!state.error && state.percent < 100)),
    error: current ? state.error : '',
    retry: () => setRetry(value => value + 1),
  };
}
