// 업체별 품목단가 매트릭스 입력 검증 — DB 저장 전에 실행되는 순수 정책

function invalid(code, message) {
  const error = new Error(message);
  error.code = code;
  error.status = 400;
  return error;
}

function positiveKey(value, field) {
  const raw = typeof value === 'string' ? value.trim() : value;
  if ((typeof raw !== 'number' && typeof raw !== 'string')
    || (typeof raw === 'string' && !/^\d+$/.test(raw))
    || !Number.isSafeInteger(Number(raw)) || Number(raw) <= 0) {
    throw invalid('INVALID_PRICING_CHANGE', `${field}는 0보다 큰 정수여야 합니다.`);
  }
  return Number(raw);
}

function explicitCost(value) {
  // 0은 명시된 단가로 허용하지만 빈 값/NaN/음수는 조용히 0으로 바꾸지 않는다.
  if (value == null || typeof value === 'boolean'
    || (typeof value === 'string' && value.trim() === '')) {
    throw invalid('INVALID_PRICING_COST', '단가는 비어 있을 수 없습니다. 0원은 명시적으로 입력하세요.');
  }
  const cost = Number(value);
  if (!Number.isFinite(cost) || cost < 0) {
    throw invalid('INVALID_PRICING_COST', '단가는 유한한 0 이상 숫자여야 합니다.');
  }
  return cost;
}

export function normalizePricingChanges(changes) {
  if (!Array.isArray(changes) || changes.length === 0) {
    throw invalid('INVALID_PRICING_CHANGE', 'changes 배열 필요');
  }
  const seen = new Set();
  return changes.map((change, index) => {
    if (!change || typeof change !== 'object' || Array.isArray(change)) {
      throw invalid('INVALID_PRICING_CHANGE', `changes[${index}] 형식이 올바르지 않습니다.`);
    }
    const ck = positiveKey(change.custKey, `changes[${index}].custKey`);
    const pk = positiveKey(change.prodKey, `changes[${index}].prodKey`);
    const key = `${ck}_${pk}`;
    if (seen.has(key)) throw invalid('DUPLICATE_PRICING_CHANGE', `동일 업체·품목 단가가 중복되었습니다: ${ck}/${pk}`);
    seen.add(key);
    return { ck, pk, cost: explicitCost(change.cost) };
  });
}
