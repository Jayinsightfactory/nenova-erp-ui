export function requireErpWriteScope(body = {}, label = 'ERP 저장') {
  const orderYear = String(body.orderYear || body.year || '').trim();
  const custKey = Number(body.custKey);

  if (!/^\d{4}$/.test(orderYear)) {
    const error = new Error(`${label} 요청에 화면의 선택 연도(4자리)가 포함되지 않았습니다.`);
    error.code = 'ORDER_YEAR_REQUIRED';
    throw error;
  }
  if (!Number.isInteger(custKey) || custKey <= 0) {
    const error = new Error(`${label} 요청에 화면의 선택 거래처가 포함되지 않았습니다.`);
    error.code = 'CUST_KEY_REQUIRED';
    throw error;
  }
  return { orderYear, custKey };
}

export function assertErpWriteScope(row = {}, scope = {}, label = 'ERP 저장 대상') {
  if (String(row.OrderYear || '') !== String(scope.orderYear)) {
    const error = new Error(`${label}의 실제 연도(${row.OrderYear || '없음'})가 선택 연도(${scope.orderYear})와 다릅니다.`);
    error.code = 'ERP_SCOPE_MISMATCH';
    throw error;
  }
  if (Number(row.CustKey) !== Number(scope.custKey)) {
    const error = new Error(`${label}의 실제 거래처가 선택 거래처와 다릅니다.`);
    error.code = 'ERP_SCOPE_MISMATCH';
    throw error;
  }
}
