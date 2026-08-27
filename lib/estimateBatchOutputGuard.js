export function collectEstimateBatchReadFailures(outcomes = []) {
  return [...new Set(outcomes
    .filter((outcome) => outcome?.error)
    .map((outcome) => String(outcome.custName || '').trim())
    .filter(Boolean))];
}

export function estimateBatchReadFailureMessage(customerNames) {
  const names = [...new Set(customerNames || [])].filter(Boolean);
  return `출력 자료 조회에 실패한 업체가 있습니다: ${names.join(', ')}. 재조회 후 다시 시도하세요.`;
}
