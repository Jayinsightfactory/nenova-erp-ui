// Browser-safe pure ERP source adapter. Saved quantities are never inferred.
export const COUNTRY_ORDER_COUNTRIES = Object.freeze({ Colombia: '콜롬비아', Netherlands: '네덜란드', Ecuador: '에콰도르', Australia: '호주', Thailand: '태국', China: '중국', Vietnam: '베트남' });
export class CountryOrderSourceError extends Error {
  constructor(code, message, statusCode = 409) { super(message); this.code = code; this.statusCode = statusCode; }
}
const fail = (code, message) => { throw new CountryOrderSourceError(code, message); };
const text = value => String(value ?? '').trim();
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function compareCodePoints(a, b) {
  const aa = Array.from(a), bb = Array.from(b);
  for (let i = 0; i < Math.min(aa.length, bb.length); i += 1) {
    const difference = aa[i].codePointAt(0) - bb[i].codePointAt(0);
    if (difference) return difference;
  }
  return aa.length - bb.length;
}
export const isCountryOrderCustomerCode = code => /^[A-Z]*CL[A-Z0-9_-]*$/i.test(text(code));
export function normalizeCountryOrderUnit(value) {
  const unit = text(value).toUpperCase();
  if (['송이', 'STEM', 'STEMS', 'STEAM'].includes(unit)) return 'stems';
  if (['단', 'BUNCH', 'BUNCHES'].includes(unit)) return 'bunches';
  if (['박스', 'BOX', 'BOXES'].includes(unit)) return 'boxes';
  return null;
}
export function compareCountryOrderSubweeks(a, b) {
  const parts = value => text(value).match(/^\d{2}-(\d+)(.*)$/u);
  const aa = parts(a), bb = parts(b);
  return aa && bb ? Number(aa[1]) - Number(bb[1]) || compareCodePoints(aa[2], bb[2]) || compare(a, b) : compare(a, b);
}
function numeric(value, context) {
  if (value == null || value === '' || typeof value === 'boolean' || !Number.isFinite(Number(value))) fail('REQUIRED_QUANTITY_UNAVAILABLE', `${context}: 저장 수량을 확인하세요.`);
  return Number(value);
}
// Product metadata describes today's registered basis, not a historic-order conversion.
export function buildCountryOrderUnitBasis(raw) {
  const nullableFactor = field => raw[field] == null ? null : numeric(raw[field], `품목 환산기준 ${field}`);
  return { outUnit: text(raw.OutUnit), unit: normalizeCountryOrderUnit(raw.OutUnit), steamOf1Bunch: nullableFactor('SteamOf1Bunch'), bunchOf1Box: nullableFactor('BunchOf1Box'), steamOf1Box: nullableFactor('SteamOf1Box'),
    boxWeight: nullableFactor('BoxWeight'), boxCBM: nullableFactor('BoxCBM'), tariffRate: nullableFactor('TariffRate') };
}
/** Expected Product snapshot for /api/master/products-bulk (stale check). Same 6 fields as PRODUCT_BULK_SNAPSHOT. */
export function buildCountryOrderProductSnapshot(basis) {
  return { BunchOf1Box: basis?.bunchOf1Box ?? null, SteamOf1Bunch: basis?.steamOf1Bunch ?? null, BoxWeight: basis?.boxWeight ?? null, BoxCBM: basis?.boxCBM ?? null, TariffRate: basis?.tariffRate ?? null, SteamOf1Box: basis?.steamOf1Box ?? null };
}
/**
 * Suggest conversion factors for a blocked row from the web-entered quantity and the stored bunch/box quantities.
 * Only fills factors that are missing (null/0); existing positive factors are kept. Returns {SteamOf1Bunch?, BunchOf1Box?, SteamOf1Box?}.
 */
export function suggestCountryOrderProductFactors(row, enteredByCustomer = {}) {
  const basis = row?.unitBasis ?? {}, suggestion = {};
  let stems = 0, bunches = 0, boxes = 0;
  for (const [custKey, stored] of Object.entries(row?.storedQuantitiesByCustomer ?? {})) {
    const entered = Number(enteredByCustomer[custKey]);
    if (!Number.isFinite(entered) || entered <= 0) continue;
    if (row.unit === 'stems') { stems += entered; bunches += stored?.bunchQuantity ?? 0; boxes += stored?.boxQuantity ?? 0; }
    else if (row.unit === 'bunches') { bunches += entered; boxes += stored?.boxQuantity ?? 0; }
  }
  const round = value => Math.round(value * 1000) / 1000;
  if (!(basis.steamOf1Bunch > 0) && stems > 0 && bunches > 0) suggestion.SteamOf1Bunch = round(stems / bunches);
  if (!(basis.bunchOf1Box > 0) && bunches > 0 && boxes > 0) suggestion.BunchOf1Box = round(bunches / boxes);
  if (!(basis.steamOf1Box > 0) && stems > 0 && boxes > 0) suggestion.SteamOf1Box = round(stems / boxes);
  return suggestion;
}
const displayNumber = value => typeof value === 'number' && Number.isFinite(value) ? String(value) : '미등록';
export function formatCountryOrderUnitBasis(basis) {
  if (basis?.unit === 'stems') return '1송이 기준';
  if (basis?.unit === 'bunches') return basis.steamOf1Bunch > 0 ? `1단 = ${displayNumber(basis.steamOf1Bunch)}송이` : '1단 기준 · 송이 환산기준 미등록';
  if (basis?.unit === 'boxes') return `1박스 기준 · ${basis.bunchOf1Box > 0 ? `${displayNumber(basis.bunchOf1Box)}단` : '단 환산기준 미등록'} · ${basis.steamOf1Box > 0 ? `${displayNumber(basis.steamOf1Box)}송이` : '송이 환산기준 미등록'}`;
  return `품목 단위 ${basis?.outUnit || '미등록'} · 환산기준 확인 필요`;
}
export function formatCountryOrderStoredQuantities(stored) {
  return `저장 단 ${displayNumber(stored?.bunchQuantity)} · 송이 ${displayNumber(stored?.steamQuantity)} · 박스 ${displayNumber(stored?.boxQuantity)} · 출고단위 수량 ${displayNumber(stored?.outQuantity)}`;
}
const STORED_QUANTITY_FIELDS = Object.freeze({ outQuantity: 'OutQuantity', boxQuantity: 'BoxQuantity', bunchQuantity: 'BunchQuantity', steamQuantity: 'SteamQuantity' });
function readStoredQuantities(raw, context) {
  return Object.fromEntries(Object.entries(STORED_QUANTITY_FIELDS).map(([key, field]) => [key, raw[field] == null ? null : numeric(raw[field], `${context} ${field}`)]));
}
function addStoredQuantities(previous, next) {
  if (!previous) return { ...next };
  return Object.fromEntries(Object.keys(STORED_QUANTITY_FIELDS).map(key => {
    // A missing constituent cannot safely be presented as a complete numeric total.
    const total = previous[key] == null || next[key] == null ? null : previous[key] + next[key];
    if (total !== null && !Number.isFinite(total)) fail('REQUIRED_QUANTITY_UNAVAILABLE', '저장 수량 합계가 유효하지 않습니다.');
    return [key, total];
  }));
}
const COLOMBIA_UNITS = Object.freeze({ '장미': 'bunches', '알스트로': 'bunches', '카네이션': 'boxes', '수국': 'boxes', '루스커스': 'boxes' });
export function buildCountryOrderMatrix(response, orderWeek) {
  const scope = response?.scope;
  if (response?.success !== true || response?.readOnly !== true || !scope || !Object.hasOwn(COUNTRY_ORDER_COUNTRIES, scope.country) || !Array.isArray(response.rows)) fail('INVALID_SOURCE_RESPONSE', '완료된 전산 조회 결과가 필요합니다.');
  if (!/^\d{4}$/.test(String(scope.year)) || !/^(?:0[1-9]|[1-4]\d|5[0-3])$/.test(String(scope.majorWeek))) fail('INVALID_SOURCE_SCOPE', '연도·대차수 형식을 다시 확인하세요.');
  if (scope.scopeKey !== `${scope.country}/${scope.year}/${scope.majorWeek}` || scope.counName !== COUNTRY_ORDER_COUNTRIES[scope.country]) fail('INVALID_SOURCE_SCOPE', '국가·연도·차수 범위를 다시 조회하세요.');
  if (typeof orderWeek !== 'string' || !new RegExp(`^${scope.majorWeek}-\\d+[^\\s]*$`, 'u').test(orderWeek) || !response.subweeks?.some(s => s.orderWeek === orderWeek)) fail('INVALID_SUBWEEK', '실제 주문이 있는 세부차수를 선택하세요.');
  const warnings = new Set((response.warnings || []).map(String)), blockers = new Set(), customers = new Map(), rows = new Map();
  const selected = response.rows.filter(r => Number(r.OrderYear) === Number(scope.year) && r.OrderWeek === orderWeek);
  for (const raw of selected) {
    if (raw.CounName !== scope.counName) fail('INVALID_SOURCE_SCOPE', '응답 주문 국가가 선택 범위와 다릅니다.');
    if (!/^\d+$/.test(String(raw.CustKey)) || Number(raw.CustKey) <= 0 || !/^\d+$/.test(String(raw.ProdKey)) || Number(raw.ProdKey) <= 0) fail('DUPLICATE_MATRIX_IDENTITY', '전산 업체키·품목키를 확인하세요.');
    const customerKey = String(raw.CustKey), prodKey = Number(raw.ProdKey), name = String(raw.ProdName ?? ''), flower = String(raw.FlowerName ?? '');
    const customer = { key: customerKey, code: text(raw.CustOrderCode), name: String(raw.CustName ?? ''), label: text(raw.CustOrderCode) };
    const previous = customers.get(customerKey);
    if (previous && (previous.code !== customer.code || previous.name !== customer.name)) fail('DUPLICATE_MATRIX_IDENTITY', `CustKey:${customerKey} 업체 정보가 서로 다릅니다.`);
    customers.set(customerKey, customer);
    const storedQuantities = readStoredQuantities(raw, name), unitBasis = buildCountryOrderUnitBasis(raw);
    const evidence = Object.values(storedQuantities).some(value => value != null && value > 0);
    const diagnostic = `품목기준 ${formatCountryOrderUnitBasis(unitBasis)} · ${formatCountryOrderStoredQuantities(storedQuantities)} [CustKey:${customerKey}]`;
    let unit, quantity, field;
    const rowBlockers = new Set();
    const block = message => { blockers.add(message); rowBlockers.add(message); };
    if (['Netherlands', 'Ecuador', 'Vietnam'].includes(scope.country)) { unit = 'stems'; field = 'SteamQuantity'; }
    else if (['Australia', 'Thailand'].includes(scope.country)) { unit = 'bunches'; field = 'BunchQuantity'; }
    else {
      unit = normalizeCountryOrderUnit(raw.OutUnit); field = 'OutQuantity';
      if (!unit) block(`REQUIRED_QUANTITY_UNAVAILABLE: ${name} [ProdKey:${prodKey}] 단위 ${text(raw.OutUnit) || '미등록'} · ${diagnostic}`);
      if (scope.country === 'Colombia' && (!COLOMBIA_UNITS[flower] || COLOMBIA_UNITS[flower] !== unit)) block(`REQUIRED_QUANTITY_UNAVAILABLE: ${name} [ProdKey:${prodKey}] 콜롬비아 ${flower || '분류 미등록'} 단위 확인 필요 · ${diagnostic}`);
    }
    try { quantity = numeric(raw[field], `${name} [ProdKey:${prodKey}] ${field}`); }
    catch (error) { if (!(error instanceof CountryOrderSourceError)) throw error; quantity = 0; block(`${error.code}: ${error.message} · ${diagnostic}`); }
    if (evidence && quantity <= 0) block(`${scope.country === 'Netherlands' ? 'STEM_QUANTITY_UNAVAILABLE' : 'REQUIRED_QUANTITY_UNAVAILABLE'}: ${name} [ProdKey:${prodKey}] 생성에 필요한 저장 수량이 없습니다 (${field}=${quantity}). ${diagnostic} · 단위 변경만으로 기존 주문 수량은 자동 변환되지 않으므로 전산 원주문을 확인하세요.`);
    // Invalid units remain visible, with an export blocker; no quantity conversion occurs.
    const rowKey = `${prodKey}|${unit || text(raw.OutUnit)}|${scope.country === 'Colombia' ? flower : ''}`;
    let row = rows.get(rowKey);
    if (!row) { row = { key: rowKey, prodKey, name, flower, unit: unit || 'unknown', quantities: {}, total: 0, unitBasis, storedQuantities: null, storedQuantitiesByCustomer: {}, blocked: false, blockers: [] }; rows.set(rowKey, row); }
    if (rowBlockers.size) { row.blocked = true; row.blockers = [...new Set([...row.blockers, ...rowBlockers])]; }
    if (row.name !== name || row.flower !== flower) fail('DUPLICATE_MATRIX_IDENTITY', `ProdKey:${prodKey} 품목 정보가 서로 다릅니다.`);
    if (JSON.stringify(row.unitBasis) !== JSON.stringify(unitBasis)) fail('DUPLICATE_MATRIX_IDENTITY', `ProdKey:${prodKey} 품목 환산기준이 서로 다릅니다. 다시 조회하세요.`);
    row.storedQuantities = addStoredQuantities(row.storedQuantities, storedQuantities);
    row.storedQuantitiesByCustomer[customerKey] = addStoredQuantities(row.storedQuantitiesByCustomer[customerKey], storedQuantities);
    row.quantities[customerKey] = (row.quantities[customerKey] ?? 0) + quantity; row.total += quantity;
    if (!Number.isFinite(row.total) || !Number.isFinite(row.quantities[customerKey])) fail('REQUIRED_QUANTITY_UNAVAILABLE', `${name}: 합계가 유효하지 않습니다.`);
  }
  const codeCounts = new Map(), nameKeys = new Map();
  for (const customer of customers.values()) if (customer.code) codeCounts.set(customer.code.toUpperCase(), (codeCounts.get(customer.code.toUpperCase()) ?? 0) + 1);
  for (const row of rows.values()) { if (!nameKeys.has(row.name)) nameKeys.set(row.name, new Set()); nameKeys.get(row.name).add(row.prodKey); }
  for (const customer of customers.values()) {
    if (!customer.code) { customer.label = `코드미등록 [CustKey:${customer.key}]`; warnings.add(`MISSING_CUSTOMER_CODE: ${customer.name} [CustKey:${customer.key}]`); }
    else if ((codeCounts.get(customer.code.toUpperCase()) ?? 0) > 1) { customer.label = `${customer.code} [CustKey:${customer.key}]`; warnings.add(`DUPLICATE_CUSTOMER_CODE: ${customer.label}`); }
    if (customer.code && !isCountryOrderCustomerCode(customer.code)) warnings.add(`UNRECOGNIZED_CUSTOMER_CODE: ${customer.code} [CustKey:${customer.key}]`);
  }
  for (const row of rows.values()) {
    if (nameKeys.get(row.name).size > 1) { row.label = `${row.name} [ProdKey:${row.prodKey}]`; warnings.add(`DUPLICATE_PRODUCT_NAME: ${row.label}`); }
    else row.label = row.name;
    for (const key of customers.keys()) if (!Object.hasOwn(row.quantities, key)) row.quantities[key] = 0;
  }
  return { source: 'erp', scope: { country: scope.country, year: Number(scope.year), orderWeek }, customers: [...customers.values()].sort((a, b) => compare(a.label, b.label) || compare(a.key, b.key)), rows: [...rows.values()].sort((a, b) => compare(a.flower, b.flower) || compare(a.name, b.name) || a.prodKey - b.prodKey || compare(a.unit, b.unit)), warnings: [...warnings], blockers: [...blockers] };
}

/**
 * Partial export: drop rows that carry an export blocker so the remaining products can still be downloaded.
 * Never converts quantities. Excluded products are listed as EXCLUDED_BLOCKED_ROWS warnings for manual follow-up in nenova.exe.
 */
export function excludeBlockedCountryOrderRows(matrix) {
  if (!matrix || !Array.isArray(matrix.rows) || !Array.isArray(matrix.blockers)) fail('INVALID_SOURCE_RESPONSE', '전산 행렬이 필요합니다.');
  const excluded = matrix.rows.filter(row => row.blocked || (row.blockers?.length ?? 0) > 0);
  const rows = matrix.rows.filter(row => !excluded.includes(row));
  if (!excluded.length) return { ...matrix, rows, blockers: [...matrix.blockers], warnings: [...matrix.warnings], excludedRows: [] };
  if (!rows.length) fail('REQUIRED_QUANTITY_UNAVAILABLE', '모든 품목이 수량 확인 대상이라 제외 후 남는 품목이 없습니다. 전산 원주문을 확인하세요.');
  const coveredBlockers = new Set(excluded.flatMap(row => row.blockers ?? []));
  const remaining = matrix.blockers.filter(message => !coveredBlockers.has(message));
  if (remaining.length) fail('REQUIRED_QUANTITY_UNAVAILABLE', `품목 제외로 해결되지 않는 차단 사유가 있습니다: ${remaining.join(' / ')}`);
  const warnings = [...matrix.warnings, ...excluded.map(row => `EXCLUDED_BLOCKED_ROWS: ${row.label ?? row.name} [ProdKey:${row.prodKey}] 저장 수량 확인 전까지 발주서에서 제외했습니다. 전산 원주문을 수정한 뒤 다시 조회하세요.`)];
  return { ...matrix, rows, blockers: [], warnings, excludedRows: excluded.map(row => ({ key: row.key, prodKey: row.prodKey, name: row.label ?? row.name, blockers: [...(row.blockers ?? [])] })) };
}

/**
 * Manual quantities typed in the web for blocked products (e.g. stored stems = 0).
 * overrides: { [rowKey]: { [custKey]: number } }. Applies only to blocked rows, only for customers that have an order on that row.
 * Returns a blocker-free matrix for export; ERP is never written. Throws while any blocked row is incomplete.
 */
export function reviewCountryOrderQuantities(matrix, changes) {
  if (!matrix || !Object.keys(changes).length) return matrix;
  const rows = matrix.rows.map(row => {
    const draft = changes[row.key];
    if (!draft) return row;
    const quantities = { ...row.quantities };
    for (const [key, text] of Object.entries(draft)) {
      if (!['stems', 'bunches'].includes(row.unit) || !Object.hasOwn(quantities, key) ||
          (row.blocked && !(row.quantities[key] > 0)) || !/^\d+(?:\.\d+)?$/.test(text) || !Number.isFinite(Number(text))) {
        fail('INVALID_REVIEW_QUANTITY', `${row.label ?? row.name} · ${row.unit === 'stems' ? '송이' : '단'} 수량을 0 이상의 숫자로 입력하세요.`);
      }
      quantities[key] = Number(text);
    }
    return { ...row, originalQuantities: row.quantities, quantities, total: Object.values(quantities).reduce((sum, value) => sum + value, 0) };
  });
  return { ...matrix, rows };
}

export function applyCountryOrderManualQuantities(matrix, overrides = {}) {
  if (!matrix || !Array.isArray(matrix.rows) || !Array.isArray(matrix.blockers)) fail('INVALID_SOURCE_RESPONSE', '전산 행렬이 필요합니다.');
  const warnings = [...matrix.warnings], coveredBlockers = new Set(), missing = [];
  const rows = matrix.rows.map(row => {
    if (!row.blocked) return row;
    const entered = overrides[row.key] ?? {};
    const quantities = { ...row.quantities };
    // Only customers whose stored export quantity is missing need a web value; positive stored quantities stay as-is.
    const customers = Object.keys(row.storedQuantitiesByCustomer ?? {}).filter(custKey => !(((row.originalQuantities ?? row.quantities)?.[custKey] ?? 0) > 0));
    const parts = [];
    for (const custKey of customers) {
      const value = Number(entered[custKey]);
      if (!Number.isFinite(value) || value <= 0 || !(custKey in entered) || String(entered[custKey]).trim() === '') { missing.push(`${row.label ?? row.name} [ProdKey:${row.prodKey}] CustKey:${custKey}`); continue; }
      quantities[custKey] = value; parts.push(`CustKey:${custKey} ${value}`);
    }
    if (parts.length !== customers.length) return row;
    for (const message of row.blockers ?? []) coveredBlockers.add(message);
    const total = Object.values(quantities).reduce((sum, value) => sum + value, 0);
    warnings.push(`MANUAL_QUANTITY: ${row.label ?? row.name} [ProdKey:${row.prodKey}] 웹에서 입력한 ${row.unit === 'stems' ? '송이' : row.unit === 'bunches' ? '단' : '박스'} 수량 ${parts.join(', ')}을 발주서에만 사용했습니다. 전산 원주문은 변경되지 않았으니 전산에서도 수정하세요.`);
    return { ...row, quantities, total, blocked: false, blockers: [], manualQuantities: { ...entered } };
  });
  if (missing.length) fail('REQUIRED_QUANTITY_UNAVAILABLE', `수량 입력이 필요합니다: ${missing.join(' / ')}`);
  const remaining = matrix.blockers.filter(message => !coveredBlockers.has(message));
  if (remaining.length) fail('REQUIRED_QUANTITY_UNAVAILABLE', `입력으로 해결되지 않는 차단 사유가 있습니다: ${remaining.join(' / ')}`);
  return { ...matrix, rows, blockers: [], warnings };
}
