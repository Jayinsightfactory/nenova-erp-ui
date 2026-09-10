// Pure, read-only projector for an immutable distribution baseline and current ERP facts.
// It never reads or writes files/DB and never asserts that a requested operation completed.

const FULL_WEEK_RE = /^(0[1-9]|[1-4]\d|5[0-3])-(0[1-9]|[1-9]\d)$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ALSTRO_RE = /알스트로|alstro/i;
const UNITS = new Set(['박스', '단', '송이']);
const MAX_CURRENT_ROWS = 10000;
const MAX_UNION_CELLS = 100000;

class BaselineReconciliationError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'BaselineReconciliationError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function fail(code, message, statusCode) {
  throw new BaselineReconciliationError(code, message, statusCode);
}

function isObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveKey(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function calendarDate(value) {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function field(record, lower, upper) {
  return record?.[lower] ?? record?.[upper];
}

function active(record) {
  const deleted = field(record, 'isDeleted', 'IsDeleted');
  return deleted === undefined || deleted === null || Number(deleted) === 0;
}

function issue(code, details = {}) {
  return { code, ...details };
}

function pushIssue(target, value) {
  const fingerprint = JSON.stringify(value);
  if (!target.some(item => JSON.stringify(item) === fingerprint)) target.push(value);
}

function pushCode(target, code) {
  if (!target.includes(code)) target.push(code);
}

function validateBaseline(baseline) {
  if (!isObject(baseline)) fail('INVALID_BASELINE', '공개 기준본 객체가 필요합니다.');
  if (!/^[a-f0-9]{64}$/.test(text(baseline.id))) fail('INVALID_BASELINE_ID', '기준본 ID가 올바르지 않습니다.');
  if (!/^20\d{2}$/.test(text(baseline.year))) fail('INVALID_YEAR', '기준본 연도가 올바르지 않습니다.');
  if (!FULL_WEEK_RE.test(text(baseline.week))) fail('INVALID_WEEK', '기준본 전체 차수가 올바르지 않습니다.');
  if (!['single', 'combined'].includes(baseline.coverage)) fail('INVALID_COVERAGE', '기준본 수량 범위가 올바르지 않습니다.');
  if (baseline.coverage === 'combined' && !baseline.week.endsWith('-02')) {
    fail('INVALID_COMBINED_SCOPE', '01·02 합산 기준본은 02 세부차수에만 사용할 수 있습니다.');
  }
  if (!isObject(baseline.parsed) || !Array.isArray(baseline.parsed.sheets) || !baseline.parsed.sheets.length) {
    fail('INVALID_BASELINE', '기준본 parsed.sheets가 필요합니다.');
  }
  const sheetIds = new Set();
  const rowIds = new Set();
  const columnIds = new Set();
  for (const sheet of baseline.parsed.sheets) {
    if (!isObject(sheet) || !text(sheet.id) || !Array.isArray(sheet.rows) || !Array.isArray(sheet.clients)) {
      fail('INVALID_BASELINE', '기준본 시트 형식이 올바르지 않습니다.');
    }
    if (sheetIds.has(sheet.id)) fail('DUPLICATE_BASELINE_ID', `중복 시트 ID: ${sheet.id}`);
    sheetIds.add(sheet.id);
    for (const row of sheet.rows) {
      if (!isObject(row) || !text(row.id) || !isObject(row.values)) fail('INVALID_BASELINE', `${sheet.id} 기준 행 형식이 올바르지 않습니다.`);
      if (rowIds.has(row.id)) fail('DUPLICATE_BASELINE_ID', `중복 기준 행 ID: ${row.id}`);
      rowIds.add(row.id);
    }
    for (const column of sheet.clients) {
      if (!isObject(column) || !text(column.id)) fail('INVALID_BASELINE', `${sheet.id} 기준 열 형식이 올바르지 않습니다.`);
      if (columnIds.has(column.id)) fail('DUPLICATE_BASELINE_ID', `중복 기준 열 ID: ${column.id}`);
      columnIds.add(column.id);
    }
  }
  return { sheetIds, rowIds, columnIds };
}

function catalog(records, kind, issues) {
  if (!Array.isArray(records)) fail(`INVALID_${kind.toUpperCase()}_CATALOG`, `${kind} catalog는 배열이어야 합니다.`);
  const grouped = new Map();
  for (const record of records) {
    if (!isObject(record) || !active(record)) continue;
    const key = positiveKey(kind === 'product' ? field(record, 'prodKey', 'ProdKey') : field(record, 'custKey', 'CustKey'));
    if (!key) continue;
    const rows = grouped.get(key) || [];
    rows.push(record);
    grouped.set(key, rows);
  }
  const unique = new Map();
  for (const [key, rows] of grouped) {
    if (rows.length !== 1) {
      pushIssue(issues, issue(kind === 'product' ? 'DUPLICATE_PRODUCT_KEY' : 'DUPLICATE_CUSTOMER_KEY', { key, count: rows.length }));
      continue;
    }
    const row = rows[0];
    if (kind === 'product') {
      unique.set(key, {
        prodKey: key,
        prodName: text(field(row, 'prodName', 'ProdName')),
        displayName: text(field(row, 'displayName', 'DisplayName')),
        country: text(field(row, 'counName', 'CounName')),
        flower: text(field(row, 'flowerName', 'FlowerName')),
        outUnit: text(field(row, 'outUnit', 'OutUnit')),
        bunchOf1Box: Number(field(row, 'bunchOf1Box', 'BunchOf1Box')),
        steamOf1Box: Number(field(row, 'steamOf1Box', 'SteamOf1Box')),
      });
    } else {
      unique.set(key, { custKey: key, custName: text(field(row, 'custName', 'CustName')) });
    }
  }
  return unique;
}

function bindingMap(bindings, name, validIds) {
  const source = bindings[name];
  if (source === undefined) return new Map();
  if (!isObject(source)) fail('INVALID_BINDINGS', `bindings.${name}는 ID별 객체여야 합니다.`);
  const map = new Map();
  for (const id of Object.keys(source)) {
    if (id === '__proto__' || id === 'prototype' || id === 'constructor') fail('INVALID_BINDINGS', `${name}에 금지된 키가 있습니다.`);
    if (!validIds.has(id)) fail('UNKNOWN_BINDING_ID', `${name}에 기준본에 없는 ID ${id}가 있습니다.`);
    const item = source[id];
    if (!isObject(item)) fail('INVALID_BINDINGS', `${name}.${id} 값이 올바르지 않습니다.`);
    map.set(id, item);
  }
  return map;
}

function exactKeys(value, expected, label) {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) {
    fail('INVALID_BINDINGS', `${label} 필드 형식이 올바르지 않습니다.`);
  }
}

function parseBindings(rawBindings, ids) {
  const bindings = rawBindings === undefined ? {} : rawBindings;
  if (!isObject(bindings)) fail('INVALID_BINDINGS', 'bindings는 고정 형식 객체여야 합니다.');
  const allowed = new Set([
    'sheetScopes', 'keymapBatch', 'rowOverrides', 'columnOverrides', 'dateGroups',
    'columnDateOverrides', 'unitAttestation', 'rowUnitOverrides',
  ]);
  for (const key of Object.keys(bindings)) if (!allowed.has(key)) fail('INVALID_BINDINGS', `알 수 없는 bindings 필드: ${key}`);

  const keymapBatch = bindingMap(bindings, 'keymapBatch', ids.sheetIds);
  for (const [id, item] of keymapBatch) {
    exactKeys(item, ['confirmRows', 'confirmClients'], `keymapBatch.${id}`);
    if (typeof item.confirmRows !== 'boolean' || typeof item.confirmClients !== 'boolean') fail('INVALID_BINDINGS', 'keymapBatch 확인값은 boolean이어야 합니다.');
  }

  const rowOverrides = bindingMap(bindings, 'rowOverrides', ids.rowIds);
  for (const [id, item] of rowOverrides) {
    exactKeys(item, ['prodKey', 'confirmed'], `rowOverrides.${id}`);
    if (!positiveKey(item.prodKey) || typeof item.confirmed !== 'boolean') fail('INVALID_BINDINGS', 'rowOverrides 값이 올바르지 않습니다.');
  }

  const columnOverrides = bindingMap(bindings, 'columnOverrides', ids.columnIds);
  for (const [id, item] of columnOverrides) {
    exactKeys(item, ['custKey', 'confirmed'], `columnOverrides.${id}`);
    if (!positiveKey(item.custKey) || typeof item.confirmed !== 'boolean') fail('INVALID_BINDINGS', 'columnOverrides 값이 올바르지 않습니다.');
  }

  const columnDateOverrides = bindingMap(bindings, 'columnDateOverrides', ids.columnIds);
  for (const [id, item] of columnDateOverrides) {
    exactKeys(item, ['shipmentDate', 'confirmed'], `columnDateOverrides.${id}`);
    if (typeof item.confirmed !== 'boolean' || !calendarDate(item.shipmentDate)) {
      fail('INVALID_BINDINGS', 'columnDateOverrides에는 실제 YYYY-MM-DD 날짜가 필요합니다.');
    }
  }

  const rowUnitOverrides = bindingMap(bindings, 'rowUnitOverrides', ids.rowIds);
  for (const [id, item] of rowUnitOverrides) {
    exactKeys(item, ['unit', 'confirmed'], `rowUnitOverrides.${id}`);
    if (typeof item.confirmed !== 'boolean' || !UNITS.has(item.unit)) fail('INVALID_BINDINGS', 'rowUnitOverrides 단위가 올바르지 않습니다.');
  }

  const dateByColumn = new Map();
  const dateGroups = bindings.dateGroups === undefined ? [] : bindings.dateGroups;
  if (!Array.isArray(dateGroups)) fail('INVALID_BINDINGS', 'bindings.dateGroups는 배열이어야 합니다.');
  for (const group of dateGroups) {
    if (!isObject(group) || !Array.isArray(group.columnIds) || !group.columnIds.length || typeof group.confirmed !== 'boolean') {
      fail('INVALID_BINDINGS', 'dateGroups 형식이 올바르지 않습니다.');
    }
    exactKeys(group, ['columnIds', 'shipmentDate', 'confirmed'], 'dateGroups 항목');
    if (!calendarDate(group.shipmentDate)) fail('INVALID_BINDINGS', 'dateGroups에는 실제 YYYY-MM-DD 날짜가 필요합니다.');
    const local = new Set();
    for (const columnId of group.columnIds) {
      if (typeof columnId !== 'string' || !ids.columnIds.has(columnId)) fail('UNKNOWN_BINDING_ID', `기준본에 없는 열 ID: ${columnId}`);
      if (local.has(columnId) || dateByColumn.has(columnId)) fail('DUPLICATE_DATE_GROUP', `열 ${columnId}가 날짜 그룹에 중복되었습니다.`);
      local.add(columnId);
      dateByColumn.set(columnId, group);
    }
  }

  let sheetScopes = bindings.sheetScopes;
  if (sheetScopes === undefined) sheetScopes = Object.create(null);
  if (!isObject(sheetScopes)) fail('INVALID_BINDINGS', 'bindings.sheetScopes는 sheetId별 객체여야 합니다.');
  const scopeBySheet = new Map();
  for (const [sheetId, value] of Object.entries(sheetScopes)) {
    if (sheetId === '__proto__' || sheetId === 'prototype' || sheetId === 'constructor') fail('INVALID_BINDINGS', 'sheetScopes에 금지된 키가 있습니다.');
    if (!ids.sheetIds.has(sheetId)) fail('UNKNOWN_BINDING_ID', `기준본에 없는 시트 ID: ${sheetId}`);
    if (!isObject(value) || typeof value.confirmed !== 'boolean' || !Array.isArray(value.groups)) {
      fail('INVALID_BINDINGS', `sheetScopes.${sheetId} 형식이 올바르지 않습니다.`);
    }
    exactKeys(value, ['confirmed', 'groups'], `sheetScopes.${sheetId}`);
    if (value.groups.length < 1 || value.groups.length > 10) fail('INVALID_BINDINGS', `${sheetId} 시트 품목군은 1..10개여야 합니다.`);
    const seen = new Set();
    const groups = value.groups.map(group => {
      if (!isObject(group) || !text(group.country) || !text(group.flower)) fail('INVALID_BINDINGS', `${sheetId} 시트 품목군이 올바르지 않습니다.`);
      exactKeys(group, ['country', 'flower'], `sheetScopes.${sheetId}.groups`);
      const key = `${text(group.country)}\u0000${text(group.flower)}`;
      if (seen.has(key)) fail('DUPLICATE_BINDING', `${sheetId} 시트 품목군이 중복되었습니다.`);
      seen.add(key);
      return { country: text(group.country), flower: text(group.flower) };
    });
    scopeBySheet.set(sheetId, { confirmed: value.confirmed, groups });
  }

  const attestation = bindings.unitAttestation;
  if (attestation !== undefined && (!isObject(attestation) || typeof attestation.originalExportUnitsPreserved !== 'boolean')) {
    fail('INVALID_BINDINGS', 'unitAttestation 형식이 올바르지 않습니다.');
  }
  if (attestation !== undefined) exactKeys(attestation, ['originalExportUnitsPreserved'], 'unitAttestation');
  return {
    keymapBatch, rowOverrides, columnOverrides, columnDateOverrides, rowUnitOverrides,
    dateByColumn, scopeBySheet,
    originalExportUnitsPreserved: attestation?.originalExportUnitsPreserved === true,
  };
}

function broadGroupKey(country, flower) {
  return `${country}\u0000${flower}`;
}

function weeksFor(baseline) {
  return baseline.coverage === 'combined'
    ? [`${baseline.week.slice(0, 2)}-01`, baseline.week]
    : [baseline.week];
}

function normalizeCurrentRow(row, index) {
  const yearValue = field(row, 'year', 'OrderYear');
  const weekValue = field(row, 'week', 'OrderWeek');
  const shipmentDateValue = field(row, 'shipmentDate', 'ShipmentDtm');
  return {
    rawIndex: index,
    year: typeof yearValue === 'string' ? yearValue : String(yearValue ?? ''),
    week: typeof weekValue === 'string' ? weekValue : String(weekValue ?? ''),
    custKey: positiveKey(field(row, 'custKey', 'CustKey')),
    prodKey: positiveKey(field(row, 'prodKey', 'ProdKey')),
    SdetailKey: positiveKey(field(row, 'SdetailKey', 'sdetailKey')),
    SdateKey: positiveKey(field(row, 'SdateKey', 'sdateKey')),
    shipmentDate: shipmentDateValue ?? null,
    qty: field(row, 'qty', 'Qty'),
    unit: text(field(row, 'unit', 'Unit')),
  };
}

function currentIdentity(row) {
  return JSON.stringify([row.year, row.week, row.custKey, row.prodKey, row.SdetailKey, row.SdateKey]);
}

function productLabel(product) {
  return product.displayName || product.prodName || `ProdKey ${product.prodKey}`;
}

function convertQuantity(quantity, fromUnit, product) {
  if (!finiteNumber(quantity) || !UNITS.has(fromUnit) || !UNITS.has(product.outUnit)) return null;
  if (fromUnit === product.outUnit) return quantity;
  const bunch = product.bunchOf1Box;
  const steam = product.steamOf1Box;
  let boxes;
  if (fromUnit === '박스') boxes = quantity;
  else if (fromUnit === '단' && bunch > 0) boxes = quantity / bunch;
  else if (fromUnit === '송이' && steam > 0) boxes = quantity / steam;
  else return null;
  if (product.outUnit === '박스') return boxes;
  if (product.outUnit === '단' && bunch > 0) return boxes * bunch;
  if (product.outUnit === '송이' && steam > 0) return boxes * steam;
  return null;
}

function isExporterAlstro(product) {
  return ALSTRO_RE.test(`${product.flower} ${product.prodName}`);
}

function reconcileDistributionBaseline({
  baseline,
  bindings = {},
  products,
  customers,
  currentRows,
  currentComplete = true,
} = {}) {
  const ids = validateBaseline(baseline);
  if (!Array.isArray(currentRows)) fail('INVALID_CURRENT_ROWS', 'currentRows는 배열이어야 합니다.');
  if (typeof currentComplete !== 'boolean') fail('INVALID_CURRENT_COMPLETENESS', 'currentComplete는 boolean이어야 합니다.');
  if (currentRows.length > MAX_CURRENT_ROWS) fail('CURRENT_RESULT_LIMIT_EXCEEDED', '현재 출고 조회가 10,000건을 초과했습니다.', 422);

  const issues = [];
  const productByKey = catalog(products, 'product', issues);
  const customerByKey = catalog(customers, 'customer', issues);
  const parsedBindings = parseBindings(bindings, ids);
  const weeks = weeksFor(baseline);
  const weekSet = new Set(weeks);
  const scopedCurrent = currentRows
    .map(normalizeCurrentRow)
    .filter(row => row.year === text(baseline.year) && weekSet.has(row.week));

  const currentByPair = new Map();
  for (const row of scopedCurrent) {
    const pair = `${row.prodKey}|${row.custKey}`;
    const rows = currentByPair.get(pair) || [];
    rows.push(row);
    currentByPair.set(pair, rows);
  }

  const currentClassified = new Set();
  const currentUnclassifiedReasons = new Map();

  function markUnclassified(row, code) {
    const identity = currentIdentity(row);
    const reasons = currentUnclassifiedReasons.get(identity) || new Set();
    reasons.add(code);
    currentUnclassifiedReasons.set(identity, reasons);
  }

  const currentIdentityGroups = new Map();
  for (const row of scopedCurrent) {
    const identity = currentIdentity(row);
    const rows = currentIdentityGroups.get(identity) || [];
    rows.push(row);
    currentIdentityGroups.set(identity, rows);
  }
  const duplicateIdentityPairs = new Set();
  for (const [identity, rows] of currentIdentityGroups) {
    if (rows.length < 2) continue;
    const pair = `${rows[0].prodKey}|${rows[0].custKey}`;
    duplicateIdentityPairs.add(pair);
    const quantities = [...new Set(rows.map(row => finiteNumber(row.qty) ? row.qty : '<unknown>'))];
    pushIssue(issues, issue('DUPLICATE_CURRENT_IDENTITY', {
      identity,
      count: rows.length,
      conflictingQuantity: quantities.length > 1,
    }));
    rows.forEach(row => markUnclassified(row, 'DUPLICATE_CURRENT_IDENTITY'));
  }

  const sheetCandidates = [];
  const sheetModels = [];
  let projectedCellCount = 0;

  for (const rawSheet of baseline.parsed.sheets) {
    const sheetIssues = [];
    const batch = parsedBindings.keymapBatch.get(rawSheet.id);
    const baselineRows = rawSheet.rows.map(rawRow => {
      const override = parsedBindings.rowOverrides.get(rawRow.id);
      const candidateKey = positiveKey(override ? override.prodKey : rawRow.key);
      const product = candidateKey ? productByKey.get(candidateKey) : null;
      const verified = Boolean(product && (override ? override.confirmed === true : batch?.confirmRows === true));
      const rowIssues = [];
      if (!verified) pushCode(rowIssues, 'UNVERIFIED_PROD_KEY');
      return {
        id: rawRow.id,
        label: rawRow.label,
        prodKey: product?.prodKey ?? candidateKey,
        origin: 'BASELINE',
        bindingState: verified ? 'VERIFIED' : 'UNVERIFIED',
        product,
        raw: rawRow,
        issues: rowIssues,
      };
    });

    const scopeRows = baselineRows.map(row => {
      const rawProdKey = positiveKey(row.raw.key);
      return { row, product: rawProdKey ? productByKey.get(rawProdKey) : null };
    });
    const allRowKeysActive = scopeRows.length > 0 && scopeRows.every(({ product }) => (
      product && product.country && product.flower
    ));
    const candidateGroupsByKey = new Map();
    if (allRowKeysActive) {
      for (const { row, product } of scopeRows) {
        const key = broadGroupKey(product.country, product.flower);
        const found = candidateGroupsByKey.get(key) || {
          country: product.country,
          flower: product.flower,
          units: new Set(),
          rowIds: [],
        };
        if (UNITS.has(product.outUnit)) found.units.add(product.outUnit);
        found.rowIds.push(row.id);
        candidateGroupsByKey.set(key, found);
      }
    } else {
      pushIssue(sheetIssues, issue('UNVERIFIED_SHEET_SCOPE', { sheetId: rawSheet.id }));
    }

    const scopeBinding = parsedBindings.scopeBySheet.get(rawSheet.id);
    const requestedBroadGroups = new Set((scopeBinding?.groups || []).map(group => broadGroupKey(group.country, group.flower)));
    const confirmedGroupKeys = new Set();
    if (scopeBinding?.confirmed === true) {
      const candidateKeys = new Set(candidateGroupsByKey.keys());
      const exactScope = candidateKeys.size === requestedBroadGroups.size
        && [...candidateKeys].every(key => requestedBroadGroups.has(key));
      if (batch?.confirmRows !== true) {
        pushIssue(sheetIssues, issue('UNVERIFIED_SCOPE_KEYMAP', { sheetId: rawSheet.id }));
      } else if (!exactScope) {
        pushIssue(sheetIssues, issue('SHEET_SCOPE_SET_MISMATCH', { sheetId: rawSheet.id }));
      } else {
        candidateKeys.forEach(key => confirmedGroupKeys.add(key));
      }
    }
    const candidateGroups = [...candidateGroupsByKey.values()].map(group => {
      const units = [...group.units];
      return {
        country: group.country,
        flower: group.flower,
        unit: units.length === 1 ? units[0] : null,
        rowIds: group.rowIds,
        confirmed: confirmedGroupKeys.has(broadGroupKey(group.country, group.flower)),
      };
    });
    sheetCandidates.push({
      sheetId: rawSheet.id,
      groups: candidateGroups,
      state: confirmedGroupKeys.size ? 'CONFIRMED' : 'TENTATIVE',
      source: confirmedGroupKeys.size ? 'BINDING' : 'ERP_CANDIDATE',
    });

    const rowIdsByProd = new Map();
    for (const row of baselineRows) {
      if (!row.prodKey || !row.product) continue;
      const rows = rowIdsByProd.get(row.prodKey) || [];
      rows.push(row);
      rowIdsByProd.set(row.prodKey, rows);
    }
    const duplicateBoundProdKeys = new Set();
    for (const [prodKey, rows] of rowIdsByProd) {
      if (rows.length < 2) continue;
      duplicateBoundProdKeys.add(prodKey);
      rows.forEach(row => pushCode(row.issues, 'DUPLICATE_BOUND_ROW'));
      pushIssue(sheetIssues, issue('DUPLICATE_BOUND_ROW', { sheetId: rawSheet.id, prodKey, rowIds: rows.map(row => row.id) }));
    }

    const baselineColumns = rawSheet.clients.map(rawColumn => {
      const override = parsedBindings.columnOverrides.get(rawColumn.id);
      const candidateKey = positiveKey(override ? override.custKey : rawColumn.key);
      const customer = candidateKey ? customerByKey.get(candidateKey) : null;
      const custVerified = Boolean(customer && (override ? override.confirmed === true : batch?.confirmClients === true));
      const dateOverride = parsedBindings.columnDateOverrides.get(rawColumn.id);
      const dateGroup = parsedBindings.dateByColumn.get(rawColumn.id);
      const selectedDate = dateOverride ? dateOverride.shipmentDate : dateGroup?.shipmentDate;
      const dateVerified = Boolean(
        dateOverride ? dateOverride.confirmed && calendarDate(selectedDate)
          : dateGroup?.confirmed && calendarDate(selectedDate),
      );
      const columnIssues = [];
      if (!custVerified) pushCode(columnIssues, 'UNVERIFIED_CUST_KEY');
      if (!dateVerified) pushCode(columnIssues, 'UNVERIFIED_DATE');
      return {
        id: rawColumn.id,
        custKey: customer?.custKey ?? candidateKey,
        shipmentDate: dateVerified ? selectedDate : null,
        label: rawColumn.label,
        sourceDay: rawColumn.day ?? null,
        origin: 'BASELINE',
        bindingState: custVerified && dateVerified ? 'VERIFIED' : 'UNVERIFIED',
        customer,
        raw: rawColumn,
        issues: columnIssues,
      };
    });

    const columnsByPair = new Map();
    for (const column of baselineColumns) {
      if (column.bindingState !== 'VERIFIED') continue;
      const key = `${column.custKey}|${column.shipmentDate}`;
      const columns = columnsByPair.get(key) || [];
      columns.push(column);
      columnsByPair.set(key, columns);
    }
    const duplicateBoundColumnPairs = new Set();
    for (const [pair, columns] of columnsByPair) {
      if (columns.length < 2) continue;
      duplicateBoundColumnPairs.add(pair);
      columns.forEach(column => pushCode(column.issues, 'DUPLICATE_BOUND_COLUMN'));
      pushIssue(sheetIssues, issue('DUPLICATE_BOUND_COLUMN', { sheetId: rawSheet.id, pair, columnIds: columns.map(column => column.id) }));
    }

    const candidateGroupKeys = new Set(candidateGroups.map(group => broadGroupKey(group.country, group.flower)));
    const eligibleCurrent = [];
    for (const row of scopedCurrent) {
      const product = row.prodKey ? productByKey.get(row.prodKey) : null;
      const customer = row.custKey ? customerByKey.get(row.custKey) : null;
      if (!product || !customer) {
        markUnclassified(row, !product ? 'UNVERIFIED_PROD_KEY' : 'UNVERIFIED_CUST_KEY');
        continue;
      }
      const key = broadGroupKey(product.country, product.flower);
      if (!candidateGroupKeys.has(key)) continue;
      eligibleCurrent.push({ row, product, customer, group: key, confirmedGroup: confirmedGroupKeys.has(key) });
      if (confirmedGroupKeys.has(key)) {
        currentClassified.add(currentIdentity(row));
        currentUnclassifiedReasons.get(currentIdentity(row))?.delete('UNCONFIRMED_SHEET_SCOPE');
      } else {
        markUnclassified(row, 'UNCONFIRMED_SHEET_SCOPE');
      }
      if (duplicateBoundProdKeys.has(row.prodKey)) markUnclassified(row, 'DUPLICATE_BOUND_ROW');
      if (calendarDate(row.shipmentDate) && duplicateBoundColumnPairs.has(`${row.custKey}|${row.shipmentDate}`)) {
        markUnclassified(row, 'DUPLICATE_BOUND_COLUMN');
      }
    }

    const rows = baselineRows.slice();
    const existingProdKeys = new Set(rows.map(row => row.prodKey).filter(Boolean));
    const appendProducts = new Map();
    for (const entry of eligibleCurrent) {
      if (!existingProdKeys.has(entry.product.prodKey)) appendProducts.set(entry.product.prodKey, entry);
    }
    const appendedRows = [...appendProducts.values()]
      .sort((left, right) => productLabel(left.product).localeCompare(productLabel(right.product), 'ko') || left.product.prodKey - right.product.prodKey)
      .map(entry => ({
        id: `erp:${rawSheet.id}:prod:${entry.product.prodKey}`,
        label: productLabel(entry.product),
        prodKey: entry.product.prodKey,
        origin: entry.confirmedGroup ? 'ERP_ONLY' : 'ERP_CANDIDATE',
        bindingState: entry.confirmedGroup ? 'VERIFIED' : 'UNVERIFIED',
        product: entry.product,
        raw: null,
        issues: entry.confirmedGroup ? [] : ['UNVERIFIED_SHEET_SCOPE'],
      }));
    rows.push(...appendedRows);

    const columns = baselineColumns.slice();
    const existingColumnPairs = new Set(columns
      .filter(column => column.bindingState === 'VERIFIED')
      .map(column => `${column.custKey}|${column.shipmentDate}`));
    const appendPairs = new Map();
    for (const entry of eligibleCurrent) {
      if (!calendarDate(entry.row.shipmentDate) || entry.row.SdateKey === null) {
        markUnclassified(entry.row, 'UNKNOWN_CURRENT_DATE');
        continue;
      }
      const pair = `${entry.customer.custKey}|${entry.row.shipmentDate}`;
      if (!existingColumnPairs.has(pair)) appendPairs.set(pair, entry);
    }
    const appendedColumns = [...appendPairs.values()]
      .sort((left, right) => left.row.shipmentDate.localeCompare(right.row.shipmentDate)
        || left.customer.custName.localeCompare(right.customer.custName, 'ko')
        || left.customer.custKey - right.customer.custKey)
      .map(entry => ({
        id: `erp:${rawSheet.id}:cust:${entry.customer.custKey}:date:${entry.row.shipmentDate}`,
        custKey: entry.customer.custKey,
        shipmentDate: entry.row.shipmentDate,
        label: `${entry.customer.custName || `CustKey ${entry.customer.custKey}`} · ${entry.row.shipmentDate}`,
        sourceDay: null,
        origin: entry.confirmedGroup ? 'ERP_ONLY' : 'ERP_CANDIDATE',
        bindingState: entry.confirmedGroup ? 'VERIFIED' : 'UNVERIFIED',
        customer: entry.customer,
        raw: null,
        issues: entry.confirmedGroup ? [] : ['UNVERIFIED_SHEET_SCOPE'],
      }));
    columns.push(...appendedColumns);

    projectedCellCount += rows.length * columns.length;
    if (projectedCellCount > MAX_UNION_CELLS) fail('UNION_CELL_LIMIT_EXCEEDED', 'union grid가 100,000셀을 초과했습니다.', 422);

    const cells = [];
    for (const row of rows) {
      const product = row.product;
      const productGroup = product ? broadGroupKey(product.country, product.flower) : null;
      const groupConfirmed = Boolean(productGroup && confirmedGroupKeys.has(productGroup));
      const rowOverride = parsedBindings.rowUnitOverrides.get(row.id);
      for (const column of columns) {
        const cellIssues = [...row.issues, ...column.issues];
        const baselineRaw = row.raw && column.raw
          ? (Object.prototype.hasOwnProperty.call(row.raw.values, column.id) ? row.raw.values[column.id] : null)
          : null;
        let baselineQuantity = null;
        let unit = product?.outUnit || null;

        if (row.origin === 'BASELINE' && column.origin === 'BASELINE') {
          if (!finiteNumber(baselineRaw)) {
            pushCode(cellIssues, 'NON_NUMERIC_BASELINE');
          } else if (!product || row.bindingState !== 'VERIFIED') {
            pushCode(cellIssues, 'UNVERIFIED_PROD_KEY');
          } else if (rowOverride?.confirmed === true) {
            baselineQuantity = convertQuantity(baselineRaw, rowOverride.unit, product);
            if (baselineQuantity === null) pushCode(cellIssues, 'UNVERIFIED_UNIT');
          } else if (parsedBindings.originalExportUnitsPreserved && UNITS.has(product.outUnit)) {
            baselineQuantity = isExporterAlstro(product) ? baselineRaw * 16 : baselineRaw;
          } else {
            if (!parsedBindings.originalExportUnitsPreserved) pushCode(cellIssues, 'UNKNOWN_EXPORT_RULE');
            pushCode(cellIssues, 'UNVERIFIED_UNIT');
          }
        }

        const pair = `${row.prodKey}|${column.custKey}`;
        const columnPair = `${column.custKey}|${column.shipmentDate}`;
        const duplicateBinding = duplicateBoundProdKeys.has(row.prodKey) || duplicateBoundColumnPairs.has(columnPair);
        const related = currentByPair.get(pair) || [];
        const unknownRelated = related.filter(current => current.SdetailKey === null || current.SdateKey === null || !calendarDate(current.shipmentDate) || !finiteNumber(current.qty));
        if (unknownRelated.length) {
          pushCode(cellIssues, 'UNKNOWN_CURRENT_VALUE');
          unknownRelated.forEach(current => markUnclassified(current, 'UNKNOWN_CURRENT_VALUE'));
        }
        if (duplicateIdentityPairs.has(pair)) pushCode(cellIssues, 'DUPLICATE_CURRENT_IDENTITY');

        let contributions = [];
        let erpCurrentQuantity = null;
        if (!duplicateBinding && !duplicateIdentityPairs.has(pair)) {
          contributions = related.filter(current => (
            calendarDate(column.shipmentDate)
            && current.shipmentDate === column.shipmentDate
            && current.SdateKey !== null
            && finiteNumber(current.qty)
          ));
          if (contributions.some(current => current.unit !== product?.outUnit)) {
            pushCode(cellIssues, 'UNVERIFIED_UNIT');
            contributions = contributions.map(current => ({ ...current }));
          } else if (contributions.length > 0) {
            erpCurrentQuantity = contributions.reduce((sum, current) => sum + current.qty, 0);
          } else if (
            currentComplete
            && row.bindingState === 'VERIFIED'
            && column.bindingState === 'VERIFIED'
            && groupConfirmed
            && baselineQuantity !== null
            && UNITS.has(unit)
            && !unknownRelated.length
          ) {
            erpCurrentQuantity = 0;
          }
        }

        const comparable = baselineQuantity !== null
          && erpCurrentQuantity !== null
          && row.bindingState === 'VERIFIED'
          && column.bindingState === 'VERIFIED'
          && groupConfirmed
          && currentComplete
          && !duplicateBinding
          && !duplicateIdentityPairs.has(pair)
          && !unknownRelated.length
          && !cellIssues.includes('UNVERIFIED_UNIT');
        const delta = comparable ? erpCurrentQuantity - baselineQuantity : null;
        let state = 'UNRESOLVED';
        if (comparable) state = contributions.length ? 'COMPARABLE' : 'BASELINE_ONLY';
        else if (row.origin === 'ERP_CANDIDATE' || column.origin === 'ERP_CANDIDATE') state = 'ERP_CANDIDATE';
        else if (row.origin !== 'BASELINE' || column.origin !== 'BASELINE') state = 'ERP_ONLY';

        cells.push({
          rowId: row.id,
          columnId: column.id,
          baselineRaw,
          baselineQuantity,
          erpCurrentQuantity,
          delta,
          unit,
          state,
          contributions: duplicateBinding ? [] : contributions.map(current => ({
            year: current.year,
            week: current.week,
            custKey: current.custKey,
            prodKey: current.prodKey,
            SdetailKey: current.SdetailKey,
            SdateKey: current.SdateKey,
            shipmentDate: current.shipmentDate,
            qty: current.qty,
            unit: current.unit,
          })),
          issues: [...new Set(cellIssues)],
        });
      }
    }

    const publicRows = rows.map(({ product, raw, issues: rowIssues, ...row }) => ({ ...row, issues: rowIssues }));
    const publicColumns = columns.map(({ customer, raw, issues: columnIssues, ...column }) => ({ ...column, issues: columnIssues }));
    sheetModels.push({
      id: rawSheet.id,
      name: rawSheet.name || rawSheet.id,
      rows: publicRows,
      columns: publicColumns,
      cells,
      issues: sheetIssues,
    });
    sheetIssues.forEach(value => pushIssue(issues, value));
  }

  for (const row of scopedCurrent) {
    const product = row.prodKey ? productByKey.get(row.prodKey) : null;
    const identity = currentIdentity(row);
    const reasons = currentUnclassifiedReasons.get(identity);
    if (currentClassified.has(identity)) reasons?.delete('UNCONFIRMED_SHEET_SCOPE');
    if (!currentClassified.has(identity) && (!reasons || reasons.size === 0)) {
      markUnclassified(row, product ? 'OUTSIDE_SHEET_SCOPE' : 'UNVERIFIED_PROD_KEY');
    }
  }

  const unclassifiedCurrent = [];
  for (const [identity, reasons] of currentUnclassifiedReasons) {
    if (reasons.size === 0 && currentClassified.has(identity)) continue;
    const rawRows = currentIdentityGroups.get(identity) || [];
    if (!rawRows.length) continue;
    const first = rawRows[0];
    unclassifiedCurrent.push({
      year: first.year,
      week: first.week,
      custKey: first.custKey,
      prodKey: first.prodKey,
      SdetailKey: first.SdetailKey,
      SdateKey: first.SdateKey,
      shipmentDate: first.shipmentDate,
      qty: rawRows.length === 1 && finiteNumber(first.qty) ? first.qty : null,
      unit: first.unit || null,
      identity,
      duplicateCount: rawRows.length,
      issues: [...reasons, ...(rawRows.length > 1 ? ['DUPLICATE_CURRENT_IDENTITY'] : [])],
      duplicateContributions: rawRows.length > 1 ? rawRows.map(row => ({ qty: row.qty, shipmentDate: row.shipmentDate, unit: row.unit })) : [],
    });
  }
  unclassifiedCurrent.sort((left, right) => left.identity.localeCompare(right.identity));

  return { sheetCandidates, sheets: sheetModels, unclassifiedCurrent, issues };
}

module.exports = {
  ALSTRO_RE,
  MAX_CURRENT_ROWS,
  MAX_UNION_CELLS,
  BaselineReconciliationError,
  DistributionBaselineReconciliationError: BaselineReconciliationError,
  reconcileDistributionBaseline,
};
