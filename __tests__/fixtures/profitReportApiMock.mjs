// Test double for pages/api/sales/profit-report.js#loadReportData — swapped in only for
// lib/profitReportRateAnalysis.js via __tests__/fixtures/profitReportRateAnalysisLoaderHook.mjs.
// See __tests__/profitReportRateAnalysis.test.js header comment for why this mocking technique is used.
export async function loadReportData(major, orderYear) {
  globalThis.__rateAnalysisCallLog?.push({ fn: 'loadReportData', major, orderYear: String(orderYear) });
  if (typeof globalThis.__mockLoadReportData !== 'function') {
    throw new Error('profitReportApiMock: globalThis.__mockLoadReportData not configured for this test');
  }
  return globalThis.__mockLoadReportData(major, orderYear);
}
