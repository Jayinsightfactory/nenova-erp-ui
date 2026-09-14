// EXE quantity-pivot view model.  This module deliberately has no DB or UI dependency.

export const EXE_FIELDS = [
  { id: 'CounName', label: '국가', numeric: false },
  { id: 'FlowerName', label: '꽃', numeric: false },
  { id: 'ProdName', label: '품목명(색상)', numeric: false },
  { id: 'CountryFlower', label: '품목명', numeric: false },
  { id: 'CustArea', label: '지역', numeric: false },
  { id: 'ShipmentDtm', label: '출고일', numeric: false },
  { id: 'UPrice', label: '입고단가', numeric: true },
  { id: 'TPrice', label: '입고총단가', numeric: true },
  { id: 'OrderNo', label: 'AWB', numeric: false },
  { id: 'CustDescr', label: '비고', numeric: false },
  { id: 'CustName', label: '거래처명/농장명', numeric: false },
  // Years are dimensions even when the API serializes them as numbers.  Moving one to data
  // therefore counts source rows instead of pretending a year is a quantity.
  { id: 'OrderYear', label: '주문년도', numeric: false },
  { id: 'OrderWeek', label: '주문차수', numeric: false },
  { id: 'ListType', label: '구분', numeric: false },
  { id: 'Quantity', label: '수량', numeric: true },
];

const FIELD_IDS = new Set(EXE_FIELDS.map(field => field.id));
const FIELD_BY_ID = new Map(EXE_FIELDS.map(field => [field.id, field]));
const ZONES = ['row', 'column', 'filter', 'data'];

export const EXE_DEFAULT_LAYOUT = Object.freeze({
  row: ['CounName', 'FlowerName', 'ProdName'],
  column: ['OrderYear', 'OrderWeek', 'ListType', 'CustName'],
  filter: ['CountryFlower', 'CustArea', 'ShipmentDtm', 'UPrice', 'TPrice', 'OrderNo', 'CustDescr'],
  data: ['Quantity'],
});

const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);
const number = value => (typeof value === 'number' ? value : Number(value));
const finiteNumber = value => {
  if (value === null || value === undefined || value === '') return null;
  const valueAsNumber = number(value);
  return Number.isFinite(valueAsNumber) ? valueAsNumber : null;
};

/** Normalizes a persisted layout without losing a field or allowing duplicate placement. */
export function normalizeLayout(layout = EXE_DEFAULT_LAYOUT) {
  const normalized = Object.fromEntries(ZONES.map(zone => [zone, []]));
  const seen = new Set();
  for (const zone of ZONES) {
    const values = Array.isArray(layout?.[zone]) ? layout[zone] : [];
    for (const id of values) {
      if (FIELD_IDS.has(id) && !seen.has(id)) {
        normalized[zone].push(id);
        seen.add(id);
      }
    }
  }
  // A malformed/old saved layout must not make a native field disappear.  Put it in Filter,
  // which is non-destructive and keeps the field available to every zone picker.
  for (const { id } of EXE_FIELDS) if (!seen.has(id)) normalized.filter.push(id);
  return normalized;
}

/** Returns a new layout after moving one native field.  Index is clamped, never silently dropped. */
export function moveField(layout, id, zone, index) {
  if (!FIELD_IDS.has(id)) throw new Error(`Unknown EXE pivot field: ${id}`);
  if (!ZONES.includes(zone)) throw new Error(`Unknown EXE pivot zone: ${zone}`);
  const next = normalizeLayout(layout);
  for (const target of ZONES) next[target] = next[target].filter(fieldId => fieldId !== id);
  const requested = Number.isFinite(Number(index)) ? Math.trunc(Number(index)) : next[zone].length;
  const destination = Math.max(0, Math.min(requested, next[zone].length));
  next[zone].splice(destination, 0, id);
  return next;
}

function isNull(value) { return value === null || value === undefined; }
function string(value) { return isNull(value) ? '' : String(value); }
function compareValues(left, right) {
  const leftNumber = finiteNumber(left);
  const rightNumber = finiteNumber(right);
  if (leftNumber !== null && rightNumber !== null && typeof left !== 'string' && typeof right !== 'string') return leftNumber - rightNumber;
  return string(left).localeCompare(string(right), 'ko', { numeric: true, sensitivity: 'base' });
}
function equalValues(left, right) {
  if (isNull(left) || isNull(right)) return isNull(left) && isNull(right);
  return compareValues(left, right) === 0;
}
function asArray(value) { return Array.isArray(value) ? value : (value === undefined ? [] : [value]); }

function numericCompare(left, right) {
  const a = finiteNumber(left); const b = finiteNumber(right);
  return a === null || b === null ? null : a - b;
}

/** Evaluates one non-code filter predicate.  No expression is ever passed to eval/Function. */
export function matchesFilterCondition(row, condition = {}) {
  if (!condition || typeof condition !== 'object') return true;
  const field = condition.field || condition.id;
  if (!FIELD_IDS.has(field)) return false;
  const value = row?.[field];
  const operator = String(condition.operator || condition.op || condition.comparator || 'eq').toLowerCase();
  const expected = own(condition, 'value') ? condition.value : condition.values;
  const values = asArray(own(condition, 'values') ? condition.values : expected);
  const actualText = string(value).toLocaleLowerCase();
  const expectedText = string(expected).toLocaleLowerCase();
  const comparison = numericCompare(value, expected);
  switch (operator) {
    case 'eq': case '=': return equalValues(value, expected);
    case 'neq': case '!=': case '<>': return !equalValues(value, expected);
    case 'contains': return !isNull(value) && actualText.includes(expectedText);
    case 'notcontains': return isNull(value) || !actualText.includes(expectedText);
    case 'startswith': return !isNull(value) && actualText.startsWith(expectedText);
    case 'endswith': return !isNull(value) && actualText.endsWith(expectedText);
    case 'in': return values.some(item => equalValues(value, item));
    case 'notin': return !values.some(item => equalValues(value, item));
    case 'gt': case '>': return comparison !== null && comparison > 0;
    case 'gte': case '>=': return comparison !== null && comparison >= 0;
    case 'lt': case '<': return comparison !== null && comparison < 0;
    case 'lte': case '<=': return comparison !== null && comparison <= 0;
    case 'between': {
      const from = own(condition, 'from') ? condition.from : values[0];
      const to = own(condition, 'to') ? condition.to : (own(condition, 'value2') ? condition.value2 : values[1]);
      const lower = numericCompare(value, from); const upper = numericCompare(value, to);
      return lower !== null && upper !== null && lower >= 0 && upper <= 0;
    }
    case 'isnull': return isNull(value);
    case 'isnotnull': case 'notnull': return !isNull(value);
    default: return false;
  }
}

/** Recursively evaluates {operator:'AND'|'OR'|'NOT', children:[...]} or a leaf predicate. */
export function matchesFilterTree(row, tree) {
  if (!tree) return true;
  if (Array.isArray(tree)) return tree.every(node => matchesFilterTree(row, node));
  if (typeof tree !== 'object') return true;
  if (tree.kind === 'condition') return matchesFilterCondition(row, tree);
  if (tree.kind === 'not') return !matchesFilterTree(row, tree.child);
  const children = Array.isArray(tree.children) ? tree.children : (Array.isArray(tree.conditions) ? tree.conditions : null);
  if (!children) return matchesFilterCondition(row, tree);
  const operator = String(tree.operator || tree.op || tree.logic || 'AND').toUpperCase();
  if (operator === 'OR') return children.some(node => matchesFilterTree(row, node));
  if (operator === 'NOT') return !children.every(node => matchesFilterTree(row, node));
  return children.every(node => matchesFilterTree(row, node));
}

function matchesFieldFilters(row, fieldFilters) {
  if (!fieldFilters) return true;
  if (Array.isArray(fieldFilters)) return fieldFilters.every(condition => matchesFilterCondition(row, condition));
  if (typeof fieldFilters !== 'object') return true;
  return Object.entries(fieldFilters).every(([field, selected]) => {
    if (!FIELD_IDS.has(field) || selected === undefined || selected === null) return true;
    // Presence of an empty selection means the user explicitly unticked every value.  Omit the
    // field entirely to mean “all values”; treating [] as all makes a checkbox filter unsafe.
    if (Array.isArray(selected)) return selected.some(value => equalValues(row?.[field], value));
    if (typeof selected === 'object') {
      if (selected.enabled === false) return true;
      if (selected.operator || selected.op || selected.comparator) return matchesFilterCondition(row, { field, ...selected });
      const include = selected.values || selected.include || selected.in;
      const exclude = selected.exclude || selected.notIn;
      return ((include === undefined || include === null) || asArray(include).some(value => equalValues(row?.[field], value)))
        && (!exclude || asArray(exclude).every(value => !equalValues(row?.[field], value)));
    }
    return equalValues(row?.[field], selected);
  });
}

export function filterRows(rows, { fieldFilters, filterTree, filterEnabled = true } = {}) {
  const source = Array.isArray(rows) ? rows : [];
  if (filterEnabled === false) return [...source];
  return source.filter(row => matchesFieldFilters(row, fieldFilters) && matchesFilterTree(row, filterTree));
}

function keyPart(value) {
  if (value === null) return ['null'];
  if (value === undefined) return ['undefined'];
  if (typeof value === 'number' && Number.isNaN(value)) return ['number', 'NaN'];
  return [typeof value, String(value)];
}
function valueLabel(value) {
  if (value === null || value === undefined) return '(null)';
  if (value === '') return '(빈값)';
  return String(value);
}
/** Collision-safe key for a visible row or column path. */
export function pivotAxisKey(axis, path = []) { return JSON.stringify([axis, path.map(keyPart)]); }
/** Collision-safe key for a cell, even when native values include separators such as | or __. */
export function pivotCellKey(rowKey, columnKey) { return JSON.stringify([rowKey, columnKey]); }
function sortDirection(sort, field) {
  if (!sort) return null;
  if (Array.isArray(sort)) {
    const item = sort.find(entry => entry?.field === field || entry?.id === field);
    return item && (item.direction || item.order || item.value);
  }
  if (sort.field === field || sort.id === field) return sort.direction || sort.order || 'asc';
  return sort[field];
}

function makeTree(rows, fields, sort) {
  const root = { value: undefined, path: [], depth: -1, rows: [], children: new Map(), order: 0 };
  let order = 0;
  for (const row of rows) {
    root.rows.push(row);
    let node = root;
    fields.forEach((field, depth) => {
      const value = row?.[field]; const token = JSON.stringify(keyPart(value));
      if (!node.children.has(token)) node.children.set(token, { value, path: [...node.path, value], depth, rows: [], children: new Map(), order: order++ });
      node = node.children.get(token); node.rows.push(row);
    });
  }
  const visit = node => {
    const items = [...node.children.values()];
    const direction = fields[node.depth + 1] ? String(sortDirection(sort, fields[node.depth + 1]) || '').toLowerCase() : '';
    if (direction === 'asc' || direction === 'desc') items.sort((a, b) => (direction === 'desc' ? -1 : 1) * (compareValues(a.value, b.value) || a.order - b.order));
    node.items = items;
    items.forEach(visit);
  };
  visit(root);
  return root;
}

function collapseSet(value) {
  if (value instanceof Set) return value;
  return new Set(Array.isArray(value) ? value : (value ? Object.keys(value).filter(key => value[key]) : []));
}
function isCollapsed(node, prefix, collapsed) {
  const key = pivotAxisKey(prefix, node.path);
  return collapsed.has(key) || collapsed.has(node.key) || collapsed.has(JSON.stringify(node.path));
}

function flattenAxis(tree, fields, prefix, { showTotals, showGrandTotals, collapsed }) {
  const result = [];
  const emit = (node, forceTotal = false, collapsedNode = false) => {
    const key = pivotAxisKey(prefix, node.path);
    result.push({
      key, label: node.path.length ? valueLabel(node.value) : '총계', path: [...node.path], depth: node.depth,
      isTotal: forceTotal, isGrandTotal: node.path.length === 0, hasChildren: node.children.size > 0,
      collapsed: collapsedNode, rows: node.rows,
    });
  };
  const visit = node => {
    for (const child of node.items || []) {
      const hasChildren = child.children.size > 0;
      const closed = hasChildren && isCollapsed(child, prefix, collapsed);
      if (hasChildren && !closed) visit(child);
      if (!hasChildren || closed || showTotals) emit(child, hasChildren, closed);
    }
  };
  visit(tree);
  if (showGrandTotals) emit(tree, true);
  // With no axis fields there is exactly one meaningful aggregate cell.
  if (fields.length === 0 && !showGrandTotals) emit(tree, false);
  return result;
}

function normalizeSummaries(layout, summaryTypes) {
  const output = [];
  for (const field of layout.data) {
    const configured = typeof summaryTypes === 'string' || Array.isArray(summaryTypes)
      ? summaryTypes : summaryTypes?.[field];
    const values = asArray(configured ?? (FIELD_BY_ID.get(field)?.numeric ? 'sum' : 'count'));
    const summaries = [...new Set(values.map(value => String(value || '').toLowerCase()).map(value => value === 'average' ? 'avg' : value)
      .filter(value => ['sum', 'avg', 'min', 'max', 'count'].includes(value)))];
    for (const summary of (summaries.length ? summaries : [FIELD_BY_ID.get(field)?.numeric ? 'sum' : 'count'])) output.push({ field, summary, key: `${field}:${summary}` });
  }
  return output;
}

function axesForRow(row, fields, prefix, axesByKey) {
  const axes = [];
  const root = axesByKey.get(pivotAxisKey(prefix, []));
  if (root) axes.push(root);
  const path = [];
  for (const field of fields) {
    path.push(row?.[field]);
    const axis = axesByKey.get(pivotAxisKey(prefix, path));
    if (axis) axes.push(axis);
  }
  return axes;
}

function addMeasureValue(state, row, measure) {
  const value = row?.[measure.field];
  const accumulator = state.measures[measure.key] || (state.measures[measure.key] = { sum: 0, count: 0, min: null, max: null });
  if (measure.summary === 'count') {
    if (!isNull(value) && value !== '') accumulator.count += 1;
    return;
  }
  const numericValue = finiteNumber(value);
  if (numericValue === null) return;
  accumulator.sum += numericValue;
  accumulator.count += 1;
  accumulator.min = accumulator.min === null ? numericValue : Math.min(accumulator.min, numericValue);
  accumulator.max = accumulator.max === null ? numericValue : Math.max(accumulator.max, numericValue);
}

function finishMeasure(state, measure) {
  if (!state) return null;
  const accumulator = state.measures[measure.key];
  if (measure.summary === 'count') return accumulator?.count || 0;
  if (measure.summary === 'sum') return accumulator?.sum || 0;
  if (!accumulator || accumulator.count === 0) return null;
  if (measure.summary === 'avg') return accumulator.sum / accumulator.count;
  if (measure.summary === 'min') return accumulator.min;
  if (measure.summary === 'max') return accumulator.max;
  return null;
}

/**
 * Creates the complete visible pivot model.  Totals are always calculated from the matched
 * original rows; no subtotal (especially an average) is ever re-aggregated.
 */
export function buildPivotModel(rows, options = {}) {
  const layout = normalizeLayout(options.layout || EXE_DEFAULT_LAYOUT);
  const filteredRows = filterRows(rows, options);
  const rowTree = makeTree(filteredRows, layout.row, options.sort);
  const columnTree = makeTree(filteredRows, layout.column, options.sort);
  const rowAxisInternal = flattenAxis(rowTree, layout.row, 'row', {
    showTotals: options.showRowTotals !== false,
    showGrandTotals: options.showGrandTotals !== false,
    collapsed: collapseSet(options.collapsedRows),
  });
  const columnAxisInternal = flattenAxis(columnTree, layout.column, 'column', {
    showTotals: options.showColumnTotals !== false,
    showGrandTotals: options.showGrandTotals !== false,
    collapsed: collapseSet(options.collapsedColumns),
  });
  const measures = normalizeSummaries(layout, options.summaryTypes);
  const rowAxesByKey = new Map(rowAxisInternal.map(axis => [axis.key, axis]));
  const columnAxesByKey = new Map(columnAxisInternal.map(axis => [axis.key, axis]));
  const aggregates = new Map();
  // Each raw record contributes to its visible leaf and visible subtotal ancestors only.  This
  // avoids rescanning the full raw set once per cell while retaining every possible displayed
  // cell (including empty combinations) below.
  for (const row of filteredRows) {
    const rowAxes = axesForRow(row, layout.row, 'row', rowAxesByKey);
    const columnAxes = axesForRow(row, layout.column, 'column', columnAxesByKey);
    for (const rowAxis of rowAxes) for (const columnAxis of columnAxes) {
      const key = pivotCellKey(rowAxis.key, columnAxis.key);
      const state = aggregates.get(key) || { measures: {}, rowKey: rowAxis.key, columnKey: columnAxis.key };
      aggregates.set(key, state);
      for (const measure of measures) addMeasureValue(state, row, measure);
    }
  }
  const cells = [];
  const cellMap = {};
  // Iterate populated intersections, not the full cartesian grid. Large high-cardinality
  // layouts must reach the UI's render guard without billions of empty lookups first.
  for (const [key, aggregate] of aggregates) {
      const values = Object.fromEntries(measures.map(measure => [measure.key, finishMeasure(aggregate, measure)]));
      // A single common summary is convenient for simple UI renderers: values.Quantity.
      for (const measure of measures) if (measures.filter(other => other.field === measure.field).length === 1) values[measure.field] = values[measure.key];
      const cell = { key, rowKey: aggregate.rowKey, columnKey: aggregate.columnKey, values, value: measures.length === 1 ? values[measures[0].key] : null };
      cells.push(cell); cellMap[cell.key] = cell;
  }
  const publicAxis = axis => axis.map(({ rows: ignored, ...item }) => item);
  const model = {
    layout, rows: filteredRows, sourceRowCount: Array.isArray(rows) ? rows.length : 0, filteredRowCount: filteredRows.length,
    rowAxis: publicAxis(rowAxisInternal), columnAxis: publicAxis(columnAxisInternal), measures, cells, cellMap,
  };
  model.visibleCoordinateCount = model.rowAxis.length * model.columnAxis.length;
  model.visibleCellCount = model.visibleCoordinateCount * model.measures.length;
  model.populatedCellCount = model.cells.length;
  model.requiresVirtualization = model.visibleCellCount > 250000;
  // AOA can be very large.  Keeping it lazy makes normal table rendering sparse without
  // discarding a single cell; export explicitly materializes the exact visible grid.
  Object.defineProperty(model, 'aoa', { enumerable: true, get: () => pivotModelToAoA(model, { blankZero: options.blankZero === true }) });
  return model;
}

function displayPath(axis, fieldCount) {
  const values = Array(fieldCount).fill('');
  axis.path.forEach((value, index) => { values[index] = valueLabel(value); });
  if (axis.isTotal && axis.path.length) values[Math.max(0, axis.path.length - 1)] = `${values[Math.max(0, axis.path.length - 1)]} 합계`;
  if (axis.isGrandTotal && fieldCount) values[0] = '총계';
  return values;
}

function displayColumnPath(axis, fields) {
  if (axis.isGrandTotal) return '총계';
  const path = axis.path.map((value, index) => `${FIELD_BY_ID.get(fields[index])?.label || fields[index]}: ${valueLabel(value)}`);
  return `${path.join(' / ')}${axis.isTotal ? ' 합계' : ''}`;
}

/** Throws an explicit, UI-displayable error before a non-virtualized grid is rendered. */
export function assertPivotRenderLimit(model, maxCells = 250000) {
  const visibleCellCount = Number(model?.visibleCellCount || 0);
  if (visibleCellCount > maxCells) {
    const error = new RangeError(`표시 셀이 ${visibleCellCount.toLocaleString()}개입니다. ${maxCells.toLocaleString()}개 이하로 필터를 좁히거나 가상 스크롤로 표시하세요.`);
    error.code = 'PIVOT_RENDER_CELL_LIMIT';
    error.visibleCellCount = visibleCellCount;
    error.maxCells = maxCells;
    throw error;
  }
  return model;
}

/** Produces an AOA from the already-visible model; it never re-filters or re-aggregates rows. */
export function pivotModelToAoA(model, { blankZero = false } = {}) {
  const rowFields = model?.layout?.row || [];
  const measures = model?.measures || [];
  const columns = model?.columnAxis || [];
  const header = [
    ...rowFields.map(field => FIELD_BY_ID.get(field)?.label || field),
    ...columns.flatMap(column => measures.map(measure => measures.length === 1
      ? displayColumnPath(column, model?.layout?.column || [])
      : `${displayColumnPath(column, model?.layout?.column || [])} · ${FIELD_BY_ID.get(measure.field)?.label || measure.field} (${measure.summary})`)),
  ];
  const rows = [header];
  for (const rowAxis of model?.rowAxis || []) {
    const values = displayPath(rowAxis, rowFields.length);
    for (const column of columns) for (const measure of measures) {
      const value = model.cellMap?.[pivotCellKey(rowAxis.key, column.key)]?.values?.[measure.key];
      values.push(blankZero && value === 0 ? '' : (value ?? ''));
    }
    rows.push(values);
  }
  return rows;
}

export const modelToAoA = pivotModelToAoA;
