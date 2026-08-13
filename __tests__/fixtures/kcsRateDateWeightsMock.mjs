// Test double for lib/kcsRateDateWeights.js — swapped in only for lib/taxableExchangeRate.js via
// __tests__/fixtures/kcsRateDateWeightsLoaderHook.mjs (node:module register() resolve hook).
//
// weightedRateFromDatePoints/mapCategoryDateRowsToWeights are re-exported UNCHANGED from the real
// module (imported via a relative path — this import's parentURL is THIS file, not
// lib/taxableExchangeRate.js, so the loader hook's redirect condition does not match and it
// resolves to the real lib/kcsRateDateWeights.js normally). Only loadWarehouseDateWeights (the
// DB-touching function) is replaced, with behavior controlled per-test via
// globalThis.__mockLoadWarehouseDateWeights (a function the test sets before each scenario).
export { weightedRateFromDatePoints, mapCategoryDateRowsToWeights } from '../../lib/kcsRateDateWeights.js';

export async function loadWarehouseDateWeights(orderYear, major) {
  if (typeof globalThis.__mockLoadWarehouseDateWeights !== 'function') {
    throw new Error('kcsRateDateWeightsMock: globalThis.__mockLoadWarehouseDateWeights not configured for this test');
  }
  return globalThis.__mockLoadWarehouseDateWeights(orderYear, major);
}
