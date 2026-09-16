import { EXE_DEFAULT_LAYOUT, EXE_FIELDS, normalizeLayout } from './pivotExeModel.js';

const FIELD_BY_ID = new Map(EXE_FIELDS.map((field) => [field.id, field]));
const FIELD_IDS = new Set(FIELD_BY_ID.keys());
const ZONES = ['rows', 'cols', 'filters', 'values'];
const FILTER_OPERATORS = new Map([
  ['eq', 'eq'], ['=', '='], ['neq', 'neq'], ['!=', '!='], ['<>', '<>'],
  ['contains', 'contains'], ['notcontains', 'notcontains'], ['startswith', 'startsWith'],
  ['endswith', 'endsWith'], ['in', 'in'], ['notin', 'notIn'], ['gt', 'gt'], ['>', '>'],
  ['gte', 'gte'], ['>=', '>='], ['lt', 'lt'], ['<', '<'], ['lte', 'lte'],
  ['<=', '<='], ['between', 'between'], ['isnull', 'isNull'], ['isnotnull', 'isNotNull'],
  ['notnull', 'notNull'],
]);
const MAX_SELECTION_VALUES = 200000;
const MAX_AST_DEPTH = 10;
const MAX_AST_NODES = 500;
const MAX_WIDTHS = 10000;

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isPrimitive = (value) => value === null || ['string', 'number', 'boolean'].includes(typeof value);
const emptyAst = () => ({ kind: 'group', op: 'AND', children: [] });

function favoriteError(message) {
  const error = new Error(`FAVORITE: ${message}`);
  error.code = 'PIVOT_EXE_FAVORITE_INVALID';
  return error;
}

function boundedNumber(value, fallback, min, max) {
  if (value === null || value === undefined || value === '') return fallback;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(min, Math.min(max, numeric)) : fallback;
}

function defaultZones() {
  return {
    rows: [...EXE_DEFAULT_LAYOUT.row],
    cols: [...EXE_DEFAULT_LAYOUT.column],
    filters: [...EXE_DEFAULT_LAYOUT.filter],
    values: EXE_DEFAULT_LAYOUT.data.map((id) => ({ id, aggregation: FIELD_BY_ID.get(id)?.defaultSummary || (FIELD_BY_ID.get(id)?.numeric ? 'sum' : 'count') })),
  };
}

function hasValidZoneShape(zones) {
  if (!isObject(zones) || !ZONES.every((zone) => Array.isArray(zones[zone]))) return false;
  return zones.rows.every((id) => typeof id === 'string')
    && zones.cols.every((id) => typeof id === 'string')
    && zones.filters.every((id) => typeof id === 'string')
    && zones.values.every((value) => isObject(value) && typeof value.id === 'string');
}

function normalizeZones(input, hidden) {
  const source = hasValidZoneShape(input)
    ? input
    : defaultZones();
  const layout = normalizeLayout({
    row: source.rows,
    column: source.cols,
    filter: source.filters,
    data: source.values.map((value) => value.id),
  });
  const requestedAggregations = new Map(source.values.map((value) => [value.id, value.aggregation]));
  const hiddenSet = new Set(hidden);
  const visible = (ids) => ids.filter((id) => !hiddenSet.has(id));
  return {
    rows: visible(layout.row),
    cols: visible(layout.column),
    filters: visible(layout.filter),
    values: visible(layout.data).map((id) => {
      const requested = requestedAggregations.get(id);
      const field = FIELD_BY_ID.get(id);
      const aggregation = ['sum', 'avg', 'weightedavg', 'min', 'max', 'count'].includes(requested) && (field?.numeric || requested === 'count')
        ? requested
        : (field?.defaultSummary || (field?.numeric ? 'sum' : 'count'));
      return { id, aggregation };
    }),
  };
}

function normalizeHidden(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id) => FIELD_IDS.has(id)))];
}

function normalizeSorts(value) {
  if (!isObject(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([id, direction]) => FIELD_IDS.has(id) && (direction === 'asc' || direction === 'desc')));
}

function isDynamicDataWidthKey(id) {
  const match = typeof id === 'string' && id.match(/^col-[a-f0-9]{64}-([A-Za-z]+):(sum|avg|weightedavg|min|max|count)$/);
  if (!match) return false;
  const field = FIELD_BY_ID.get(match[1]);
  return Boolean(field && (field.numeric || match[2] === 'count'));
}

function normalizeWidths(value) {
  if (!isObject(value)) return {};
  const widths = {};
  let accepted = 0;
  for (const [id, width] of Object.entries(value)) {
    if (accepted >= MAX_WIDTHS) break;
    if (id !== '__data' && !FIELD_IDS.has(id) && !isDynamicDataWidthKey(id)) continue;
    const normalized = boundedNumber(width, null, 48, 400);
    if (normalized !== null) { widths[id] = normalized; accepted += 1; }
  }
  return widths;
}

function normalizeSelections(value) {
  if (!isObject(value)) return {};
  let total = 0;
  const selections = {};
  for (const [field, values] of Object.entries(value)) {
    if (!FIELD_IDS.has(field)) continue;
    if (!Array.isArray(values) || !values.every(isPrimitive)) throw favoriteError(`${field} 값 필터 형식이 올바르지 않습니다.`);
    total += values.length;
    if (total > MAX_SELECTION_VALUES) throw favoriteError('값 필터 항목이 너무 많습니다.');
    selections[field] = [...values];
  }
  return selections;
}

function normalizeValueOrders(value) {
  if (value === undefined) return {};
  if (!isObject(value)) throw favoriteError('값 순서 형식이 올바르지 않습니다.');
  const orders = {};
  let total = 0;
  for (const [field, values] of Object.entries(value)) {
    if (!FIELD_IDS.has(field)) continue;
    if (!Array.isArray(values)) throw favoriteError(`${field} 값 순서 형식이 올바르지 않습니다.`);
    total += values.length;
    if (total > MAX_SELECTION_VALUES) throw favoriteError('값 순서 항목이 너무 많습니다.');
    for (const item of values) {
      if (!isPrimitive(item) || (typeof item === 'number' && !Number.isFinite(item))) {
        throw favoriteError(`${field} 값 순서 형식이 올바르지 않습니다.`);
      }
    }
    orders[field] = [...new Set(values)];
  }
  return orders;
}

function copyAstPrimitive(node, key, target) {
  if (!hasOwn(node, key)) return;
  if (!isPrimitive(node[key])) throw favoriteError(`필터 조건의 ${key} 값이 올바르지 않습니다.`);
  target[key] = node[key];
}

function copyAstPrimitiveArray(node, key, target) {
  if (!hasOwn(node, key)) return;
  if (!Array.isArray(node[key]) || !node[key].every(isPrimitive)) throw favoriteError(`필터 조건의 ${key} 값이 올바르지 않습니다.`);
  target[key] = [...node[key]];
}

function normalizeAstNode(node, state, depth) {
  if (!isObject(node) || depth > MAX_AST_DEPTH) throw favoriteError('필터 구조가 올바르지 않거나 너무 깊습니다.');
  state.nodes += 1;
  if (state.nodes > MAX_AST_NODES) throw favoriteError('필터 조건이 너무 많습니다.');
  if (node.kind === 'group') {
    if ((node.op !== 'AND' && node.op !== 'OR') || !Array.isArray(node.children)) throw favoriteError('필터 그룹이 올바르지 않습니다.');
    return { kind: 'group', op: node.op, children: node.children.map((child) => normalizeAstNode(child, state, depth + 1)) };
  }
  if (node.kind === 'not') {
    if (!hasOwn(node, 'child')) throw favoriteError('NOT 필터가 올바르지 않습니다.');
    return { kind: 'not', child: normalizeAstNode(node.child, state, depth + 1) };
  }
  if (node.kind !== 'condition' || !FIELD_IDS.has(node.field)) throw favoriteError('필터 필드가 올바르지 않습니다.');
  const operator = FILTER_OPERATORS.get(String(node.operator || '').toLowerCase());
  if (!operator) throw favoriteError('필터 연산자가 올바르지 않습니다.');
  const condition = { kind: 'condition', field: node.field, operator };
  copyAstPrimitive(node, 'value', condition);
  copyAstPrimitive(node, 'value2', condition);
  copyAstPrimitive(node, 'from', condition);
  copyAstPrimitive(node, 'to', condition);
  copyAstPrimitiveArray(node, 'values', condition);
  return condition;
}

function normalizeAst(value) {
  if (value === undefined || value === null) return emptyAst();
  return normalizeAstNode(value, { nodes: 0 }, 1);
}

/**
 * Produces the complete, safe persistence shape for the EXE pivot UI.
 * It intentionally excludes fetched ERP rows, server responses and date/week ranges.
 */
export function normalizePivotExeView(input = {}) {
  const source = isObject(input) ? input : {};
  if (hasOwn(source, 'schemaVersion') && source.schemaVersion !== 1) throw favoriteError('지원하지 않는 즐겨찾기 버전입니다.');
  const hidden = normalizeHidden(source.hidden);
  const decimals = Math.round(boundedNumber(source.decimals, 2, 0, 2));
  const previousNonzeroDecimals = Math.round(boundedNumber(source.previousNonzeroDecimals, 2, 1, 2));
  return {
    schemaVersion: 1,
    zones: normalizeZones(source.zones, hidden),
    hidden,
    decimals,
    previousNonzeroDecimals,
    zeroVisible: typeof source.zeroVisible === 'boolean' ? source.zeroVisible : false,
    widths: normalizeWidths(source.widths),
    rowHeight: boundedNumber(source.rowHeight, 24, 18, 48),
    custHeaderHeight: boundedNumber(source.custHeaderHeight, 24, 18, 120),
    sorts: normalizeSorts(source.sorts),
    valueOrders: normalizeValueOrders(source.valueOrders),
    selections: normalizeSelections(source.selections),
    filterActive: typeof source.filterActive === 'boolean' ? source.filterActive : true,
    ast: normalizeAst(source.ast),
    showRowTotals: typeof source.showRowTotals === 'boolean' ? source.showRowTotals : true,
    showColumnTotals: typeof source.showColumnTotals === 'boolean' ? source.showColumnTotals : true,
    showGrandTotals: typeof source.showGrandTotals === 'boolean' ? source.showGrandTotals : true,
  };
}

/** Parses one server FilterData value without allowing null/scalar favorites to become defaults. */
export function parsePivotExeFavoriteView(filterData) {
  if (typeof filterData !== 'string' || !filterData.trim()) throw favoriteError('저장된 즐겨찾기 데이터가 올바르지 않습니다.');
  let parsed;
  try { parsed = JSON.parse(filterData); } catch { throw favoriteError('저장된 즐겨찾기 데이터가 올바르지 않습니다.'); }
  if (!isObject(parsed)) throw favoriteError('저장된 즐겨찾기 데이터가 올바르지 않습니다.');
  return normalizePivotExeView(parsed);
}
