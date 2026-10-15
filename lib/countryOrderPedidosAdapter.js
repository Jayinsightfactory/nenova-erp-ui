// Pure bridge; no workbook parsing, network, ERP writes, or quantity conversion.
const countries = ['Colombia', 'Netherlands', 'Ecuador', 'Australia', 'Thailand', 'China', 'Vietnam'];
const categoryNames = ['장미', '카네이션', '알스트로', '루스커스', '수국'];
const unitNames = { bunches: '단', stems: '송이', boxes: '박스' };
const total = values => values.reduce((sum, value) => sum + value, 0);

export function prepareCountryOrderPedidos(matrix) {
  if (matrix?.source !== 'erp' || !countries.includes(matrix.scope?.country) || !Number.isInteger(matrix.scope.year) || matrix.scope.year < 1900 || matrix.scope.year > 9999 || !/^\d{2}-\d+[^\s]*$/u.test(matrix.scope.orderWeek ?? '')) throw new Error('국가·연도·세부차수 행렬 범위를 확인하세요.');
  if (!Array.isArray(matrix.blockers) || matrix.blockers.length) throw new Error(`발주서 생성 차단: ${(matrix.blockers ?? ['행렬 검증 결과 없음']).join(' / ')}`);
  if (!Array.isArray(matrix.customers) || !Array.isArray(matrix.rows)) throw new Error('품목·업체 행렬이 없습니다.');
  const warnings = new Set(matrix.warnings ?? []);
  const keys = new Set(), labels = new Set();
  const codeCounts = new Map();
  for (const customer of matrix.customers) { const code = String(customer.code ?? '').toUpperCase(); codeCounts.set(code, (codeCounts.get(code) ?? 0) + 1); }
  const customers = matrix.customers.map(customer => {
    const key = String(customer.key);
    if (keys.has(key)) throw new Error(`DUPLICATE_MATRIX_IDENTITY: 업체 ${key}`);
    keys.add(key);
    const column = !customer.code ? `코드미등록 [CustKey:${key}]` : codeCounts.get(customer.code.toUpperCase()) > 1 ? `${customer.code} [CustKey:${key}]` : customer.code;
    if (labels.has(column)) throw new Error(`업체 표시명이 충돌합니다: ${column}`);
    labels.add(column);
    return { ...customer, custKey: key, column };
  });
  const names = new Map(), identities = new Set();
  for (const row of matrix.rows) names.set(row.name, (names.get(row.name) ?? 0) + 1);
  const productLabels = new Set();
  const rows = matrix.rows.map(row => {
    if (!row.key || identities.has(row.key) || !row.name || !Object.hasOwn(unitNames, row.unit)) throw new Error(`DUPLICATE_MATRIX_IDENTITY 또는 품목·단위 오류: ${row.key}`);
    identities.add(row.key);
    if (Object.keys(row.quantities ?? {}).some(key => !keys.has(key))) throw new Error(`등록되지 않은 업체 수량: ${row.key}`);
    const quantities = new Map(customers.map(customer => {
      const quantity = row.quantities?.[customer.custKey] ?? 0;
      if (typeof quantity !== 'number' || !Number.isFinite(quantity)) throw new Error(`숫자 수량 오류: ${row.key}/${customer.custKey}`);
      return [customer.column, quantity];
    }));
    const quantity = total([...quantities.values()]);
    if (typeof row.total !== 'number' || !Number.isFinite(row.total) || Math.abs(quantity - row.total) > 1e-8 * Math.max(1, Math.abs(quantity))) throw new Error(`행 합계 불일치: ${row.key}`);
    const name = names.get(row.name) > 1 ? `${row.name} [ProdKey:${row.prodKey};${row.unit}]` : row.name;
    if (productLabels.has(name)) throw new Error(`품목 표시명이 충돌합니다: ${name}`);
    productLabels.add(name);
    return { ...row, name, quantities, quantity };
  });
  const country = matrix.scope.country;
  const expectedUnit = { Netherlands: 'stems', Ecuador: 'stems', Vietnam: 'stems', Australia: 'bunches', Thailand: 'bunches' }[country];
  if (expectedUnit && rows.some(row => row.unit !== expectedUnit)) throw new Error(`${country}: ${expectedUnit} 원수량만 출력할 수 있습니다.`);
  const prepared = { scope: matrix.scope, ctx: { sheetName: '전산 주문', warnings } };
  if (country === 'Colombia') {
    prepared.categories = new Map();
    for (const row of rows) {
      if (!categoryNames.includes(row.flower)) throw new Error(`Colombia: 지원하지 않는 품종 '${row.flower}'`);
      const expected = ['장미', '알스트로'].includes(row.flower) ? 'bunches' : 'boxes';
      if (row.unit !== expected) throw new Error(`Colombia: ${row.flower} ${expected} 단위를 확인하세요.`);
      if (!prepared.categories.has(row.flower)) prepared.categories.set(row.flower, []);
      prepared.categories.get(row.flower).push([row.name, row.quantity]);
    }
  } else if (country === 'China') {
    const units = [...new Set(rows.map(row => row.unit))];
    if (!units.length) units.push('bunches');
    prepared.structured = { ctx: prepared.ctx, scope: `${matrix.scope.year}/${matrix.scope.orderWeek}`, groups: units.map(unit => ({
      label: units.length === 1 ? 'Melody' : `Melody_${unitNames[unit]}`, unit, sourceUnit: unitNames[unit], customers,
      products: rows.filter(row => row.unit === unit).map(({ quantities, quantity, ...row }) => row),
      group: new Map(rows.filter(row => row.unit === unit).map(row => [row.name, row.quantities])),
    })) };
  } else prepared.products = country === 'Netherlands' ? new Map(rows.map(row => [row.name, row.quantities])) : rows.map((row, index) => [row.name, row.quantity, matrix.rows[index].name]);
  return prepared;
}

/** Shared request-generation guard used by the UI and executable race tests. */
export function createCountryOrderRequestGuard() {
  let generation = 0;
  let controller = null;
  return {
    invalidate() { generation += 1; controller?.abort(); controller = null; },
    begin(scopeKey) {
      this.invalidate();
      controller = new AbortController();
      const current = generation, signal = controller.signal;
      return { signal, accepts(response) { return !signal.aborted && current === generation && response?.success === true && response?.readOnly === true && (scopeKey == null ? response.scope == null : response.scope?.scopeKey === scopeKey); } };
    },
  };
}
