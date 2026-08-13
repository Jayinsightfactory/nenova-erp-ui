// Node module customization hook (node:module register()) used ONLY by
// __tests__/profitReportRateAnalysis.test.js to redirect lib/profitReportRateAnalysis.js's imports of
// './profitReportConfirm.js'(getActiveConfirm) and '../pages/api/sales/profit-report.js'(loadReportData)
// to test doubles, so loadWeekK()/loadRateTrend() can be exercised end-to-end without a real DB
// connection. Same rationale/audit as __tests__/fixtures/kcsRateDateWeightsLoaderHook.mjs — this repo's
// only existing DB-mock pattern is dependency-injected tQ (see syncShipmentDateEst.test.js), which
// does not apply here since both functions import query()-backed helpers directly at module scope.
const CONFIRM_MOCK_URL = new URL('./profitReportConfirmMock.mjs', import.meta.url).href;
const API_MOCK_URL = new URL('./profitReportApiMock.mjs', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  const parent = context.parentURL ? context.parentURL.replace(/\\/g, '/') : '';
  if (parent.endsWith('/lib/profitReportRateAnalysis.js')) {
    if (specifier === './profitReportConfirm.js') return { url: CONFIRM_MOCK_URL, shortCircuit: true };
    if (specifier === '../pages/api/sales/profit-report.js') return { url: API_MOCK_URL, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
