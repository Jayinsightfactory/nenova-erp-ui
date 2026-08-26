export const ADDITIONAL_PRODUCT_CONTEXT_RELOAD_MESSAGE =
  '조회 범위가 변경되었습니다. 품목을 다시 선택해 단가·출고일을 재조회하세요.';

function normalized(value) {
  return String(value ?? '').trim();
}

export function buildAdditionalProductContextScope({ open, yearStr, weekNum, custKey, prodKey } = {}) {
  return {
    open: Boolean(open),
    year: normalized(yearStr),
    week: normalized(weekNum).replace(/^0+(?=\d)/, ''),
    custKey: normalized(custKey),
    prodKey: normalized(prodKey),
  };
}

export function sameAdditionalProductContextScope(a, b) {
  return Boolean(a && b)
    && Boolean(a.open) === Boolean(b.open)
    && normalized(a.year) === normalized(b.year)
    && normalized(a.week) === normalized(b.week)
    && normalized(a.custKey) === normalized(b.custKey)
    && normalized(a.prodKey) === normalized(b.prodKey);
}

export function buildAdditionalProductContextRequest({ sessionId, requestId, lineId, ...scope } = {}) {
  return {
    sessionId: Number(sessionId),
    requestId: Number(requestId),
    lineId: String(lineId),
    scope: buildAdditionalProductContextScope(scope),
  };
}

export function canApplyAdditionalProductContext(request, current) {
  return Boolean(request && current && current.open)
    && Number(request.sessionId) === Number(current.sessionId)
    && Number(request.requestId) === Number(current.requestId)
    && String(request.lineId) === String(current.lineId)
    && sameAdditionalProductContextScope(request.scope, current.scope);
}

export function invalidateAdditionalProductContextLine(line, message = ADDITIONAL_PRODUCT_CONTEXT_RELOAD_MESSAGE) {
  return {
    ...line,
    context: null,
    contextError: line?.prodKey ? message : '',
    costSourceId: '',
    cost: '',
  };
}
