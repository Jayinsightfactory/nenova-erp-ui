// Node module customization hook (node:module register()) used ONLY by
// __tests__/kcsRatesByCategoryWeighting.test.js to redirect lib/taxableExchangeRate.js's import of
// './kcsRateDateWeights.js' to a test double (kcsRateDateWeightsMock.mjs) so kcsRatesByCategory()
// can be exercised end-to-end without a real DB connection (loadWarehouseDateWeights() normally
// calls lib/db.js#query, which requires DB_SERVER/DB_* env vars this sandbox does not have).
//
// This repo has no established DB-mock pattern for orchestration functions that import query()
// directly (not dependency-injected) — see the grep audit in the test file's header comment.
// This loader hook is a self-contained, repo-file-untouched alternative: it only intercepts the
// one specifier resolved from the one parent module (lib/taxableExchangeRate.js); every other
// import (including the mock module's own import of the REAL kcsRateDateWeights.js for
// weightedRateFromDatePoints/mapCategoryDateRowsToWeights) falls through to normal resolution.
const MOCK_URL = new URL('./kcsRateDateWeightsMock.mjs', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  const parent = context.parentURL ? context.parentURL.replace(/\\/g, '/') : '';
  if (specifier === './kcsRateDateWeights.js' && parent.endsWith('/lib/taxableExchangeRate.js')) {
    return { url: MOCK_URL, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
