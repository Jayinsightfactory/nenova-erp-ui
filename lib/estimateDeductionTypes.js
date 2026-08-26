// UI eligibility and server legacy/CodeInfo fallback must use identical labels.
// This is not authorization for arbitrary codes: the server resolves stored
// EstimateType codes against CodeInfo under a transaction lock.
export function isLegacyDeductionType(value) {
  return /^(?:불량차감|검역차감)(?:\s*\/\s*(?:박스|단|송이|스팀(?:\s*\(대\))?|대|개|봉지))?$/.test(String(value ?? '').trim());
}
