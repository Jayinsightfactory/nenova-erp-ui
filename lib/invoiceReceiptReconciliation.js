const ALLOWED_UNITS = ['박스', '단', '송이'];
const UNIT_ORDER = new Map(ALLOWED_UNITS.map((unit, index) => [unit, index]));
const QUANTITY_SCALE = 1_000_000;
const MAX_SCALED_QUANTITY = Number.MAX_SAFE_INTEGER;

function fail(message) {
  throw new TypeError(`invoice receipt reconciliation: ${message}`);
}

function normalizeYear(value, field) {
  const text = typeof value === 'number' && Number.isInteger(value)
    ? String(value)
    : typeof value === 'string'
      ? value.trim()
      : '';
  if (!/^\d{4}$/.test(text)) fail(`${field} must be a four-digit year`);
  return Number(text);
}

function normalizeWeek(value, field) {
  const text = typeof value === 'string' ? value.trim() : '';
  const match = /^(\d{1,2})-(\d{1,2})$/.exec(text);
  if (!match) fail(`${field} must use week-subweek format`);
  const week = Number(match[1]);
  const subweek = Number(match[2]);
  if (week < 1 || week > 53 || subweek < 1 || subweek > 99) {
    fail(`${field} must be within week 1..53 and subweek 1..99`);
  }
  return `${String(week).padStart(2, '0')}-${String(subweek).padStart(2, '0')}`;
}

function requireCollection(value, field) {
  if (!Array.isArray(value)) fail(`${field} collection is required and must be an array`);
  return value;
}

function normalizeProdKey(value, field) {
  const number = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+$/.test(value.trim())
      ? Number(value.trim())
      : NaN;
  if (!Number.isSafeInteger(number) || number <= 0) fail(`${field} must be a positive integer`);
  return number;
}

function normalizeUnit(value, field) {
  const unit = typeof value === 'string' ? value.trim() : '';
  if (!ALLOWED_UNITS.includes(unit)) fail(`${field} must be one of ${ALLOWED_UNITS.join(', ')}`);
  return unit;
}

function normalizeQuantity(value, field) {
  let number;
  if (typeof value === 'number') {
    number = value;
  } else if (typeof value === 'string') {
    const text = value.trim();
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) {
      fail(`${field} must be a nonnegative decimal number`);
    }
    number = Number(text);
  } else {
    fail(`${field} must be a nonnegative number or numeric string`);
  }

  if (!Number.isFinite(number) || number < 0) fail(`${field} must be finite and nonnegative`);
  const scaled = Math.round(number * QUANTITY_SCALE);
  if (!Number.isSafeInteger(scaled) || scaled < 0 || scaled > MAX_SCALED_QUANTITY) {
    fail(`${field} exceeds the safe six-decimal quantity range`);
  }
  return scaled;
}

function normalizeWarehouseKey(value, field) {
  const number = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+$/.test(value.trim())
      ? Number(value.trim())
      : NaN;
  if (!Number.isSafeInteger(number) || number <= 0) fail(`${field} must be a positive integer`);
  return String(number);
}

function addScaled(left, right, field) {
  const result = left + right;
  if (!Number.isSafeInteger(result) || Math.abs(result) > MAX_SCALED_QUANTITY) {
    fail(`${field} aggregate exceeds the safe six-decimal quantity range`);
  }
  return result;
}

function fromScaled(value) {
  return Number((value / QUANTITY_SCALE).toFixed(6));
}

function rowIdentity(prodKey, unit) {
  return `${prodKey}\u0000${unit}`;
}

function normalizeSelectedRows(rows, collectionName, scope, { receipt = false, rejectForeignScope = false } = {}) {
  const selected = [];
  rows.forEach((row, index) => {
    const field = `${collectionName}[${index}]`;
    if (!row || typeof row !== 'object' || Array.isArray(row)) fail(`${field} must be an object`);

    const orderYear = normalizeYear(row.orderYear, `${field}.orderYear`);
    const orderWeek = normalizeWeek(row.orderWeek, `${field}.orderWeek`);
    if (orderYear !== scope.orderYear || orderWeek !== scope.orderWeek) {
      if (rejectForeignScope) fail(`${field} must match the selected year/week scope`);
      return;
    }

    selected.push({
      orderYear,
      orderWeek,
      prodKey: normalizeProdKey(row.prodKey, `${field}.prodKey`),
      unit: normalizeUnit(row.unit, `${field}.unit`),
      quantity: normalizeQuantity(row.quantity, `${field}.quantity`),
      ...(receipt ? { warehouseKey: normalizeWarehouseKey(row.warehouseKey, `${field}.warehouseKey`) } : {}),
    });
  });
  return selected;
}

function aggregateRows(rows, quantityField, target, includeRow = () => true) {
  for (const row of rows) {
    if (!includeRow(row)) continue;
    const key = rowIdentity(row.prodKey, row.unit);
    const current = target.get(key) || {
      prodKey: row.prodKey,
      unit: row.unit,
      orderedQty: 0,
      existingQty: 0,
      replacedQty: 0,
      draftQty: 0,
    };
    current[quantityField] = addScaled(current[quantityField], row.quantity, `${quantityField} for ${row.prodKey}/${row.unit}`);
    target.set(key, current);
  }
}

function rowStatus(difference) {
  if (difference < 0) return 'SHORTAGE';
  if (difference > 0) return 'SURPLUS';
  return 'MATCHED';
}

function createTotals(rows) {
  const totals = {};
  for (const row of rows) {
    const current = totals[row.unit] || {
      unit: row.unit,
      orderedQty: 0,
      existingQty: 0,
      replacedQty: 0,
      draftQty: 0,
      afterQty: 0,
      difference: 0,
      comparable: true,
      status: 'MATCHED',
      sameProductUnitConflict: false,
      unitConflictProductKeys: [],
    };
    for (const field of ['orderedQty', 'existingQty', 'replacedQty', 'draftQty', 'afterQty', 'difference']) {
      current[field] = fromScaled(addScaled(
        Math.round(current[field] * QUANTITY_SCALE),
        Math.round(row[field] * QUANTITY_SCALE),
        `totalsByUnit.${row.unit}.${field}`,
      ));
    }
    if (row.sameProductUnitConflict && !current.unitConflictProductKeys.includes(row.prodKey)) {
      current.unitConflictProductKeys.push(row.prodKey);
    }
    current.sameProductUnitConflict = current.unitConflictProductKeys.length > 0;
    current.comparable = !current.sameProductUnitConflict;
    current.status = current.comparable
      ? rowStatus(Math.round(current.difference * QUANTITY_SCALE))
      : 'UNIT_CONFLICT';
    totals[row.unit] = current;
  }
  return totals;
}

export function reconcileInvoiceReceipt({
  orderYear,
  orderWeek,
  orders,
  receipts,
  draft,
  editingWarehouseKey = null,
} = {}) {
  const scope = {
    orderYear: normalizeYear(orderYear, 'orderYear'),
    orderWeek: normalizeWeek(orderWeek, 'orderWeek'),
  };
  const orderRows = normalizeSelectedRows(requireCollection(orders, 'orders'), 'orders', scope);
  const receiptRows = normalizeSelectedRows(requireCollection(receipts, 'receipts'), 'receipts', scope, { receipt: true });
  const draftRows = normalizeSelectedRows(requireCollection(draft, 'draft'), 'draft', scope, { rejectForeignScope: true });
  const editingKey = editingWarehouseKey == null
    ? null
    : normalizeWarehouseKey(editingWarehouseKey, 'editingWarehouseKey');

  if (editingKey != null && !receiptRows.some((row) => row.warehouseKey === editingKey)) {
    fail(`editingWarehouseKey ${editingKey} was not found in the selected year/week scope`);
  }

  const aggregated = new Map();
  aggregateRows(orderRows, 'orderedQty', aggregated);
  aggregateRows(receiptRows, 'existingQty', aggregated);
  if (editingKey != null) {
    aggregateRows(receiptRows, 'replacedQty', aggregated, (row) => row.warehouseKey === editingKey);
  }
  aggregateRows(draftRows, 'draftQty', aggregated);

  const unitsByProduct = new Map();
  for (const row of aggregated.values()) {
    const units = unitsByProduct.get(row.prodKey) || new Set();
    units.add(row.unit);
    unitsByProduct.set(row.prodKey, units);
  }

  const rows = [...aggregated.values()]
    .sort((left, right) => left.prodKey - right.prodKey || UNIT_ORDER.get(left.unit) - UNIT_ORDER.get(right.unit))
    .map((row) => {
      const afterQty = addScaled(
        addScaled(row.existingQty, -row.replacedQty, `afterQty for ${row.prodKey}/${row.unit}`),
        row.draftQty,
        `afterQty for ${row.prodKey}/${row.unit}`,
      );
      const difference = addScaled(afterQty, -row.orderedQty, `difference for ${row.prodKey}/${row.unit}`);
      const sameProductUnitConflict = unitsByProduct.get(row.prodKey).size > 1;
      return {
        orderYear: scope.orderYear,
        orderWeek: scope.orderWeek,
        prodKey: row.prodKey,
        unit: row.unit,
        orderedQty: fromScaled(row.orderedQty),
        existingQty: fromScaled(row.existingQty),
        replacedQty: fromScaled(row.replacedQty),
        draftQty: fromScaled(row.draftQty),
        afterQty: fromScaled(afterQty),
        difference: fromScaled(difference),
        status: sameProductUnitConflict ? 'UNIT_CONFLICT' : rowStatus(difference),
        comparable: !sameProductUnitConflict,
        sameProductUnitConflict,
      };
    });

  return {
    orderYear: scope.orderYear,
    orderWeek: scope.orderWeek,
    editingWarehouseKey: editingKey,
    rows,
    totalsByUnit: createTotals(rows),
  };
}
