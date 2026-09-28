import { calculatePivotResult } from './pivotExeCalculation.js';

self.onmessage = ({ data }) => {
  try {
    const result = calculatePivotResult(data.rows, data.options, percent => self.postMessage({ type: 'progress', percent }));
    self.postMessage({ type: 'result', result });
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message || '피벗 집계 실패' });
  }
};
