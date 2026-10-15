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
  return { outUnit: text(raw.OutUnit), unit: normalizeCountryOrderUnit(raw.OutUnit), steamOf1Bunch: nullableFactor('SteamOf1Bunch'), bunchOf1Box: nullableFactor('BunchOf1Box'), steamOf1Box: nullableFactor('SteamOf1Box') };
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
    if (['Netherlands', 'Ecuador', 'Vietnam'].includes(scope.country)) { unit = 'stems'; field = 'SteamQuantity'; }
    else if (['Australia', 'Thailand'].includes(scope.country)) { unit = 'bunches'; field = 'BunchQuantity'; }
    else {
      unit = normalizeCountryOrderUnit(raw.OutUnit); field = 'OutQuantity';
      if (!unit) blockers.add(`REQUIRED_QUANTITY_UNAVAILABLE: ${name} [ProdKey:${prodKey}] 단위 ${text(raw.OutUnit) || '미등록'} · ${diagnostic}`);
      if (scope.country === 'Colombia' && (!COLOMBIA_UNITS[flower] || COLOMBIA_UNITS[flower] !== unit)) blockers.add(`REQUIRED_QUANTITY_UNAVAILABLE: ${name} [ProdKey:${prodKey}] 콜롬비아 ${flower || '분류 미등록'} 단위 확인 필요 · ${diagnostic}`);
    }
    try { quantity = numeric(raw[field], `${name} [ProdKey:${prodKey}] ${field}`); }
    catch (error) { if (!(error instanceof CountryOrderSourceError)) throw error; quantity = 0; blockers.add(`${error.code}: ${error.message} · ${diagnostic}`); }
    if (evidence && quantity <= 0) blockers.add(`${scope.country === 'Netherlands' ? 'STEM_QUANTITY_UNAVAILABLE' : 'REQUIRED_QUANTITY_UNAVAILABLE'}: ${name} [ProdKey:${prodKey}] 생성에 필요한 저장 수량이 없습니다 (${field}=${quantity}). ${diagnostic} · 단위 변경만으로 기존 주문 수량은 자동 변환되지 않으므로 전산 원주문을 확인하세요.`);
    // Invalid units remain visible, with an export blocker; no quantity conversion occurs.
    const rowKey = `${prodKey}|${unit || text(raw.OutUnit)}|${scope.country === 'Colombia' ? flower : ''}`;
    let row = rows.get(rowKey);
    if (!row) { row = { key: rowKey, prodKey, name, flower, unit: unit || 'unknown', quantities: {}, total: 0, unitBasis, storedQuantities: null, storedQuantitiesByCustomer: {} }; rows.set(rowKey, row); }
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
