// Test double for lib/profitReportConfirm.js#getActiveConfirm — swapped in only for
// lib/profitReportRateAnalysis.js via __tests__/fixtures/profitReportRateAnalysisLoaderHook.mjs.
// See __tests__/profitReportRateAnalysis.test.js header comment for why this mocking technique is used.
export async function getActiveConfirm(orderYear, major) {
  globalThis.__rateAnalysisCallLog?.push({ fn: 'getActiveConfirm', orderYear: String(orderYear), major });
  if (typeof globalThis.__mockGetActiveConfirm !== 'function') {
    throw new Error('profitReportConfirmMock: globalThis.__mockGetActiveConfirm not configured for this test');
  }
  return globalThis.__mockGetActiveConfirm(orderYear, major);
}
