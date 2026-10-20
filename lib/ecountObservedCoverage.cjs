'use strict';

const PROFILE = {
  kind: 'observed_empty',
  profileId: 'E040209-detail-line-20261020-v1',
  evidenceId: 'order-status-observed-empty-criteria',
  recordedAt: '2026-10-20T11:17:01.4254316Z',
  evidenceTimeKind: 'verification_recorded_at',
  sourceQueryExecutedAt: null,
  criteria: {
    program: 'E040209',
    periodFrom: '2026-10-20',
    periodTo: '2026-10-20',
    reportMode: 'detail',
    lineMode: 'line',
    comparison: 'none',
    tradeType: 'all',
    warehouseCodes: [],
    customerCodes: [],
    productCodes: [],
    deliveryFrom: null,
    deliveryTo: null,
    graph: false
  }
};
const QUOTE_PROFILE={kind:'observed_empty',profileId:'E040208-detail-voucher-20261020-v1',evidenceId:'quote-status-observed-empty-criteria',recordedAt:'2026-10-20T11:34:11.177Z',evidenceTimeKind:'verification_recorded_at',sourceQueryExecutedAt:null,criteria:{program:'E040208',periodFrom:'2026-10-20',periodTo:'2026-10-20',reportMode:'detail',lineMode:'voucher',comparison:'none',tradeType:'all',quoteNumber:'',warehouseCodes:[],projectCodes:[],managementCodes:[],customerCodes:[],productCodes:[],serialLotNumber:'',graph:false,form:'견적서현황'}};
const PROFILES={ordEmpty:PROFILE,quoteEmpty:QUOTE_PROFILE};
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
freeze(PROFILES);
function fail(code) { const error = new Error(code); error.status = 400; throw error; }
function exact(actual, expected) {
  if (expected === null || typeof expected !== 'object') return actual === expected;
  if (!actual || typeof actual !== 'object' || Array.isArray(actual) !== Array.isArray(expected)) return false;
  const keys = Object.keys(expected);
  return Object.keys(actual).length === keys.length && keys.every(key => Object.hasOwn(actual,key) && exact(actual[key],expected[key]));
}
function validateCriteria(value,dataset='ordEmpty') {
  const profile=Object.hasOwn(PROFILES,dataset)?PROFILES[dataset]:null;if(!profile)fail('INVALID_COVERAGE_SCOPE');
  if (typeof value === 'string') {
    if (value.length > 2048) fail('INVALID_COVERAGE_SCOPE');
    try { value = JSON.parse(value); } catch { fail('INVALID_COVERAGE_SCOPE'); }
  }
  if (!exact(value, profile.criteria)) fail('INVALID_COVERAGE_SCOPE');
  return JSON.parse(JSON.stringify(profile.criteria));
}
function validateCoverage(value, {dataset,periodFrom,periodTo,rows} = {}) {
  const profile=Object.hasOwn(PROFILES,dataset)?PROFILES[dataset]:null;
  if (!profile || !Array.isArray(rows) || rows.length !== 0 ||
      periodFrom !== profile.criteria.periodFrom || periodTo !== profile.criteria.periodTo ||
      !exact(value,profile)) fail('INVALID_OBSERVED_EMPTY');
  return JSON.parse(JSON.stringify(profile));
}
function selectObservedEmpty({version,criteria} = {}) {
  if (!version) return {rows:[],available:false,reason:'no-version'};
  try {
    validateCriteria(criteria,version.dataset);
    validateCoverage(version.coverage,{dataset:version.dataset,periodFrom:version.periodFrom,periodTo:version.periodTo,rows:version.rows});
  } catch {
    return {rows:[],available:false,reason:'unobserved-scope'};
  }
  return {rows:[],available:true,reason:null,observedEmpty:true};
}
module.exports = {PROFILE,QUOTE_PROFILE,PROFILES,validateCriteria,validateCoverage,selectObservedEmpty};
