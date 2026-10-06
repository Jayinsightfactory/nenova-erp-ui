const DUTCH_TOKEN = /네덜란드|netherlands|holland|dutch/i;
export const DUTCH_CUSTOMER_COLUMN_WIDTH = 10;
const valueOf = cell => String(cell?.v ?? '').trim();
const rangeOf = (XLSX, sheet) => sheet?.['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null;
const normalizePriceIdentity = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

export function isDutchIndividualPriceCustomer(customer) {
  return String(customer || '').split('\n')[0].trim().includes('주광');
}

export function dutchCustomerIdentity(entry) {
  const raw = String(entry?.sourceCustomer || entry?.customer || '').trim();
  return raw.split(/\r?\n/).map(normalizePriceIdentity).filter(Boolean).join('|') || `cust:${Number(entry?.sourceCustKey || entry?.custKey || 0)}`;
}

export function dutchCustomerLabel(entry) {
  return String(entry?.sourceCustomer || entry?.customer || '').split(/\r?\n/).map(value => value.trim()).filter(Boolean).join(' · ');
}

export function createDutchBulkPriceConfig(entries = []) {
  const excludedCustomers = [...new Set((entries || []).filter(entry => isDutchIndividualPriceCustomer(entry?.sourceCustomer || entry?.customer)).map(dutchCustomerIdentity))];
  return { version: 1, enabled: true, excludedCustomers };
}

export function normalizeDutchBulkPriceConfig(config, entries = []) {
  if (!config || config.version !== 1 || !Array.isArray(config.excludedCustomers)) return createDutchBulkPriceConfig(entries);
  return { version: 1, enabled: config.enabled !== false, excludedCustomers: [...new Set(config.excludedCustomers.map(value => String(value || '').trim()).filter(Boolean))] };
}

export function isDutchBulkPriceCustomer(entry, config) {
  if (config === undefined || config === null) return !isDutchIndividualPriceCustomer(entry?.sourceCustomer || entry?.customer);
  const normalized = normalizeDutchBulkPriceConfig(config);
  return normalized.enabled && !normalized.excludedCustomers.includes(dutchCustomerIdentity(entry));
}

export function dutchPriceKey(entry, bulkConfig) {
  const productIdentity = Number(entry?.prodKey || 0) > 0
    ? `prod:${Number(entry.prodKey)}`
    : `name:${normalizePriceIdentity(entry?.product)}|color:${normalizePriceIdentity(entry?.color)}`;
  if (isDutchBulkPriceCustomer(entry, bulkConfig)) return `uniform:${productIdentity}`;
  if (bulkConfig === undefined || bulkConfig === null) {
    if (isDutchIndividualPriceCustomer(entry?.sourceCustomer || entry?.customer)) return String(entry?.id || '');
    return `uniform:${productIdentity}`;
  }
  return `individual:${dutchCustomerIdentity(entry)}|${productIdentity}`;
}

export function dutchUniformPricePeerKeys(entries, entry, bulkConfig) {
  if (!isDutchBulkPriceCustomer(entry, bulkConfig)) return [dutchPriceKey(entry, bulkConfig)];
  const sourceProduct = row => normalizePriceIdentity(row?.sourceItem || row?.product);
  const sourceColor = row => normalizePriceIdentity(row?.sourceColor || row?.color);
  const productKey = Number(entry?.prodKey) || 0;
  const sameSourceRows = (entries || []).filter(row => {
    if (!isDutchBulkPriceCustomer(row, bulkConfig)) return false;
    return sourceProduct(row) === sourceProduct(entry) && sourceColor(row) === sourceColor(entry);
  });
  const mappedKeys = [...new Set(sameSourceRows.map(row => Number(row.prodKey) || 0).filter(Boolean))];
  const allowedKeys = productKey ? new Set([0, productKey])
    : mappedKeys.length === 1 ? new Set([0, mappedKeys[0]]) : new Set([0]);
  return [...new Set(sameSourceRows.filter(row => allowedKeys.has(Number(row.prodKey) || 0)).map(row => dutchPriceKey(row, bulkConfig)))];
}

export function migrateDutchBulkPriceConfig(entries, prices, previousConfig, nextConfig) {
  const migrated = { ...(prices || {}) };
  const valuesByNextKey = new Map();
  for (const entry of entries || []) {
    const oldKey = dutchPriceKey(entry, previousConfig);
    const nextKey = dutchPriceKey(entry, nextConfig);
    if (oldKey === nextKey) continue;
    const value = prices?.[oldKey];
    if (value === undefined || value === null || String(value) === '') continue;
    if (!valuesByNextKey.has(nextKey)) valuesByNextKey.set(nextKey, new Set());
    valuesByNextKey.get(nextKey).add(String(value));
  }
  const conflicts = [];
  for (const [key, values] of valuesByNextKey) {
    const existing = migrated[key];
    if (existing !== undefined && existing !== null && String(existing) !== '') {
      if ([...values].some(value => value !== String(existing))) conflicts.push(key);
      continue;
    }
    if (values.size === 1) migrated[key] = [...values][0];
    else conflicts.push(key);
  }
  return { prices: migrated, conflicts };
}

export function snapshotDutchPriceDraft(prices, keys) {
  return Object.fromEntries((keys || []).map(key => [key, {
    present: Object.prototype.hasOwnProperty.call(prices || {}, key),
    value: prices?.[key],
  }]));
}

export function restoreDutchPriceDraft(prices, snapshot) {
  const restored = { ...(prices || {}) };
  for (const [key, state] of Object.entries(snapshot || {})) {
    if (state?.present) restored[key] = state.value;
    else delete restored[key];
  }
  return restored;
}

export function dutchEntryPrice(entry, prices = {}, bulkConfig) {
  return Number(prices?.[dutchPriceKey(entry, bulkConfig)] || 0);
}

export function migrateDutchPriceDraft(entries = [], savedPrices = {}) {
  const next = { ...(savedPrices || {}) };
  const groups = new Map();
  for (const entry of entries) {
    if (isDutchIndividualPriceCustomer(entry.customer)) continue;
    const key = dutchPriceKey(entry);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  for (const [key, rows] of groups) {
    if (Object.prototype.hasOwnProperty.call(next, key)) continue;
    const legacyValues = [...new Set(rows.map(row => Number(savedPrices?.[row.id] || 0)).filter(value => value > 0))];
    if (legacyValues.length === 1) next[key] = legacyValues[0];
  }
  return next;
}

export function isDutchPivotSheet(XLSX, sheetName, sheet) {
  if (DUTCH_TOKEN.test(String(sheetName || ''))) return true;
  const range = rangeOf(XLSX, sheet);
  if (!range) return false;
  for (let row = range.s.r; row <= Math.min(range.e.r, 2); row += 1) {
    for (let col = range.s.c; col <= Math.min(range.e.c, 4); col += 1) {
      if (DUTCH_TOKEN.test(valueOf(sheet[XLSX.utils.encode_cell({ r: row, c: col })]))) return true;
    }
  }
  return false;
}

// Apply only local customer weekday-row drafts to a cloned workbook. These
// display values are exported with the sheet but never enter ERP preview data.
export function applyDutchWeekdayEdits(XLSX, workbook, dayEdits = {}) {
  const edits = Object.entries(dayEdits || {}).filter(([, value]) => value !== undefined && value !== null);
  if (!edits.length) return workbook;
  let result = workbook;
  const touched = new Set();
  for (const [key, value] of edits) {
    const splitAt = key.lastIndexOf('!');
    if (splitAt <= 0) continue;
    const sheetName = key.slice(0, splitAt);
    const address = key.slice(splitAt + 1);
    const source = workbook?.Sheets?.[sheetName];
    if (!source || !isDutchPivotSheet(XLSX, sheetName, source)) continue;
    let coordinate;
    try { coordinate = XLSX.utils.decode_cell(address); } catch { continue; }
    const range = rangeOf(XLSX, source);
    if (!range || coordinate.r !== 1 || coordinate.c < range.s.c || coordinate.c > range.e.c) continue;
    let summaryStart = range.e.c + 1;
    for (let col = 1; col <= range.e.c; col += 1) {
      if (valueOf(source[XLSX.utils.encode_cell({ r: 2, c: col })]) === '주문') { summaryStart = col; break; }
    }
    const header = valueOf(source[XLSX.utils.encode_cell({ r: 2, c: coordinate.c })]);
    if (coordinate.c >= summaryStart || !header || ['꽃', '품목명', '칼라'].includes(header)) continue;
    const oldCell = source[address];
    if (oldCell?.f) continue;
    if (result === workbook) result = { ...workbook, SheetNames: [...workbook.SheetNames], Sheets: { ...workbook.Sheets } };
    if (!touched.has(sheetName)) { result.Sheets[sheetName] = { ...source }; touched.add(sheetName); }
    const cleanValue = String(value).trim();
    result.Sheets[sheetName][address] = { ...(oldCell || {}), t: 's', v: cleanValue };
  }
  return result;
}

export function parseDutchPivotWorkbook(XLSX, workbook) {
  const entries = [];
  const sheets = [];
  for (const sheetName of workbook?.SheetNames || []) {
    if (sheetName === '_keymap') continue;
    const sheet = workbook.Sheets[sheetName];
    if (!isDutchPivotSheet(XLSX, sheetName, sheet)) continue;
    const range = rangeOf(XLSX, sheet);
    if (!range || range.e.r < 3) continue;
    if (range.e.r > 10000 || range.e.c > 500 || (range.e.r + 1) * (range.e.c + 1) > 500000) {
      throw new Error(`${sheetName}: 사용 범위가 너무 큽니다. 불필요한 끝 행·열을 정리한 물량표를 업로드하세요.`);
    }
    sheets.push(sheetName);
    let summaryStart = range.e.c + 1;
    for (let col = 1; col <= range.e.c; col += 1) {
      if (valueOf(sheet[XLSX.utils.encode_cell({ r: 2, c: col })]) === '주문') { summaryStart = col; break; }
    }
    if (summaryStart > range.e.c) throw new Error(`${sheetName}: 업체 수량의 끝인 '주문' 열을 찾지 못했습니다. 원본 물량표 헤더를 확인하세요.`);
    const header = col => valueOf(sheet[XLSX.utils.encode_cell({ r: 2, c: col })]);
    const threeLabels = header(1) === '품목명' && /^(칼라|컬러|색상)$/.test(header(2));
    const twoLabels = /^(칼라|컬러|색상|품목명\(색상\))$/.test(header(1));
    if (!threeLabels && !twoLabels) throw new Error(`${sheetName}: 꽃·품목명·칼라 또는 기존 꽃·칼라 헤더 양식인지 확인하세요.`);
    const customerStart = threeLabels ? 3 : 2;
    for (let row = 3; row <= range.e.r; row += 1) {
      const product = valueOf(sheet[XLSX.utils.encode_cell({ r: row, c: 0 })]);
      if (!product || product === '합계') continue;
      const color = valueOf(sheet[XLSX.utils.encode_cell({ r: row, c: 1 })]);
      if (color === '합계') continue;
      for (let col = customerStart; col < summaryStart; col += 1) {
        const customer = valueOf(sheet[XLSX.utils.encode_cell({ r: 2, c: col })]);
        if (!customer || customer === '칼라') continue;
        const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
        const quantity = Number(sheet[cellAddress]?.v);
        if (!(Number.isFinite(quantity) && quantity > 0)) continue;
        entries.push({ id: `${sheetName}!${cellAddress}`, sheetName, cellAddress, product, color, customer, quantity,
          sourceFlower: product, sourceItem: color,
          sourceColor: threeLabels ? valueOf(sheet[XLSX.utils.encode_cell({ r: row, c: 2 })]) : '',
          sourceCustomer: customer, sourceRow: row, sourceColumn: col,
          layoutVersion: threeLabels ? 3 : 2,
        });
      }
    }
  }
  if (!sheets.length) throw new Error('네덜란드 Pivot 시트를 찾지 못했습니다. Pivot 통계에서 내려받은 네덜란드 물량표인지 확인해 주세요.');
  if (!entries.length) throw new Error('네덜란드 시트에서 업체별 수량을 찾지 못했습니다. 수량이 입력된 원본 양식을 확인해 주세요.');
  return { sheets, entries };
}

/**
 * A freshly generated, authenticated LIVE Pivot workbook may attach the
 * exporter-owned customer identity to its visible header. This is deliberately
 * not called by the arbitrary file-upload path: uploaded _keymap sheets remain
 * untrusted. Ambiguous labels or keys outside the same live query stay on the
 * normal exact-name/OrderCode matcher.
 */
export function attachDutchLiveCustomerKeys(XLSX, workbook, entries, activeCustomerKeys = []) {
  const keySheet = workbook?.Sheets?._keymap;
  if (!keySheet || !XLSX?.utils?.sheet_to_json) return entries || [];
  const activeKeys = new Set((activeCustomerKeys || []).map(Number).filter(key => Number.isSafeInteger(key) && key > 0));
  if (!activeKeys.size) return entries || [];
  const rows = XLSX.utils.sheet_to_json(keySheet, { header: 1, defval: '' });
  const byHeader = new Map();
  for (const row of rows.slice(1)) {
    if (String(row?.[0] || '').trim() !== 'cust') continue;
    const sheetName = String(row?.[1] || '').trim();
    const label = String(row?.[2] || '').trim();
    const key = Number(row?.[3]);
    if (!sheetName || !label || !Number.isSafeInteger(key) || key <= 0 || !activeKeys.has(key)) continue;
    const identity = `${sheetName}\u0000${label}`;
    if (!byHeader.has(identity)) byHeader.set(identity, new Set());
    byHeader.get(identity).add(key);
  }
  return (entries || []).map(entry => {
    const label = String(entry?.sourceCustomer || entry?.customer || '').trim();
    const candidates = byHeader.get(`${entry?.sheetName || ''}\u0000${label}`);
    if (!candidates || candidates.size !== 1) return entry;
    return { ...entry, sourceCustKey: [...candidates][0] };
  });
}

export function buildDutchEntriesFromPivotData(data, orderYear, orderWeek) {
  const entries = [];
  const customersByKey = new Map((data?.customersByKey || data?.customers || []).map(customer => [String(Number(customer.custKey)), customer]));
  for (const row of data?.rows || []) {
    if (!DUTCH_TOKEN.test(String(row?.country || row?.counName || ''))) continue;
    const byKey = row.ordersByCustKey && typeof row.ordersByCustKey === 'object';
    const quantities = byKey ? Object.entries(row.ordersByCustKey).map(([key, quantity]) => {
      const master = customersByKey.get(String(Number(key)));
      const name = String(master?.custDescr || '').split('/')[0]?.trim() || String(master?.custName || '');
      const code = String(master?.orderCode || '').trim();
      return [code ? `${name}\n${code}` : name, quantity, Number(key)];
    }).filter(([customer]) => customer) : Object.entries(row.orders && typeof row.orders === 'object' ? row.orders : (row.outOrders || {})).map(([customer, quantity]) => [customer, quantity, 0]);
    for (const [customer, rawQuantity, custKey] of quantities) {
      const quantity = Number(rawQuantity);
      if (!(Number.isFinite(quantity) && quantity > 0)) continue;
      entries.push({
        id: `live:${orderYear}:${orderWeek}:${custKey || customer}:${row.prodKey}`,
        sheetName: '네노바웹 직접 조회',
        cellAddress: '',
        product: String(row.prodName || row.productName || ''),
        color: String(row.productDescr || row.color || ''),
        customer,
        quantity,
        ...(custKey ? { custKey } : {}),
        prodKey: Number(row.prodKey || 0),
      });
    }
  }
  return entries.sort((a, b) => a.product.localeCompare(b.product, 'ko') || a.customer.localeCompare(b.customer, 'ko'));
}

export function priceProgress(entries, prices, bulkConfig) {
  const completed = (entries || []).filter(entry => dutchEntryPrice(entry, prices, bulkConfig) > 0).length;
  return { completed, total: (entries || []).length, pending: (entries || []).length - completed };
}

export function buildDutchPriceRows(entries, prices, currency = 'EUR', bulkConfig) {
  return (entries || []).map(entry => {
    const unitPrice = dutchEntryPrice(entry, prices, bulkConfig);
    return { ...entry, currency, unitPrice, amount: Math.round(entry.quantity * unitPrice * 100) / 100, complete: unitPrice > 0 };
  });
}

function cloneCell(cell) {
  if (!cell) return null;
  return {
    ...cell,
    s: cell.s ? {
      ...cell.s,
      font: cell.s.font ? { ...cell.s.font } : cell.s.font,
      fill: cell.s.fill ? { ...cell.s.fill } : cell.s.fill,
      border: cell.s.border ? { ...cell.s.border } : cell.s.border,
      alignment: cell.s.alignment ? { ...cell.s.alignment } : cell.s.alignment,
    } : cell.s,
  };
}

function formatPrice(value) {
  return Number(value).toLocaleString('en-US', { maximumFractionDigits: 4, useGrouping: true });
}

const BORDER = {
  top: { style: 'thin', color: { rgb: 'C8C8C8' } }, bottom: { style: 'thin', color: { rgb: 'C8C8C8' } },
  left: { style: 'thin', color: { rgb: 'C8C8C8' } }, right: { style: 'thin', color: { rgb: 'C8C8C8' } },
};
const baseFont = { name: '맑은 고딕', sz: 9 };
const DESIGN = {
  title: { font: { ...baseFont, bold: true, sz: 10 }, fill: { fgColor: { rgb: 'D9E6F2' } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: BORDER },
  header: { font: { ...baseFont, bold: true }, fill: { fgColor: { rgb: 'E8EEF4' } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: BORDER },
  text: { font: baseFont, alignment: { horizontal: 'left', vertical: 'center' }, border: BORDER },
  number: { font: { ...baseFont, bold: true }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: BORDER, numFmt: 'General' },
  summary: { font: { ...baseFont, bold: true }, fill: { fgColor: { rgb: 'B5D9C8' } }, alignment: { horizontal: 'center', vertical: 'center' }, border: BORDER, numFmt: 'General' },
};

function normalizeVolumeTitle(value) {
  return String(value || '').replace(/\)\s*품종\(/, ')\n품종(');
}

function restorePivotDesign(XLSX, sheet) {
  const range = rangeOf(XLSX, sheet);
  if (!range) return;
  const totalRow = range.e.r;
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    for (let col = range.s.c; col <= range.e.c; col += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = sheet[address] || (sheet[address] = { t: 's', v: '' });
      if (row === 0 && cell.v) cell.v = normalizeVolumeTitle(cell.v);
      if (row <= 2) cell.s = cloneCell({ s: row === 0 ? DESIGN.title : DESIGN.header }).s;
      else if (row === totalRow || ['주문', '입고', '재고', '잔량'].includes(valueOf(sheet[XLSX.utils.encode_cell({ r: 2, c: col })]))) cell.s = cloneCell({ s: DESIGN.summary }).s;
      else cell.s = cloneCell({ s: typeof cell.v === 'number' ? DESIGN.number : DESIGN.text }).s;
    }
  }
  let summaryStart = range.e.c + 1;
  for (let col = 1; col <= range.e.c; col += 1) {
    if (valueOf(sheet[XLSX.utils.encode_cell({ r: 2, c: col })]) === '주문') { summaryStart = col; break; }
  }
  if (!sheet['!cols']) sheet['!cols'] = [];
  let customerHeaderHeight = 44;
  for (let col = 1; col < summaryStart; col += 1) {
    const label = valueOf(sheet[XLSX.utils.encode_cell({ r: 2, c: col })]);
    if (!label || ['꽃', '품목명', '칼라'].includes(label)) continue;
    sheet['!cols'][col] = { ...(sheet['!cols'][col] || {}), wch: DUTCH_CUSTOMER_COLUMN_WIDTH };
    const availablePx = DUTCH_CUSTOMER_COLUMN_WIDTH * 7 - 4;
    let lines = 0;
    for (const paragraph of label.split(/\r?\n/)) {
      let used = 0;
      lines += 1;
      for (const character of paragraph) {
        const glyphPx = /[^\u0000-\u007f]/.test(character) ? 12 : 7.2;
        if (used && used + glyphPx > availablePx) { lines += 1; used = 0; }
        used += glyphPx;
      }
    }
    customerHeaderHeight = Math.max(customerHeaderHeight, lines * 13.5 + 8);
  }
  if (!sheet['!rows']) sheet['!rows'] = [];
  sheet['!rows'][2] = { ...(sheet['!rows'][2] || {}), hpt: Math.max(Number(sheet['!rows'][2]?.hpt) || 0, customerHeaderHeight) };
  sheet['!rows'][0] = { ...(sheet['!rows'][0] || {}), hpt: 32 };
}

export function dutchQuantityPriceNumberFormat(unitPrice) {
  return Number(unitPrice || 0) > 0 ? '#,##0.###' : '';
}

/**
 * Pivot 통계 물량표 원본의 열·행·병합·색상·수식 구조를 그대로 보존한다.
 * 단가 도형은 직렬화된 XLSX에 별도로 삽입하므로 여기서는 수량 숫자를 그대로 보존한다.
 * 셀 값은 계속 숫자이므로 주문 합계 SUM 수식도 원본과 동일하게 계산된다.
 */
export function addDutchPriceColumns(XLSX, workbook, entries, prices, currency = 'EUR', bulkConfig) {
  const result = { ...workbook, SheetNames: [...(workbook?.SheetNames || [])], Sheets: { ...(workbook?.Sheets || {}) } };
  const priceByCell = new Map((entries || []).map(entry => [entry.id, dutchEntryPrice(entry, prices, bulkConfig)]));

  for (const sheetName of result.SheetNames) {
    const source = workbook.Sheets[sheetName];
    if (!source || !isDutchPivotSheet(XLSX, sheetName, source)) continue;
    const range = rangeOf(XLSX, source);
    if (!range || range.e.r < 3) continue;

    const target = {};
    Object.entries(source).forEach(([key, value]) => {
      if (key.startsWith('!')) return;
      target[key] = cloneCell(value);
    });
    target['!ref'] = source['!ref'];
    if (source['!cols']) target['!cols'] = source['!cols'].map(column => column ? { ...column } : column);
    if (source['!rows']) target['!rows'] = source['!rows'].map(row => row ? { ...row } : row);
    if (source['!freeze']) target['!freeze'] = { ...source['!freeze'] };
    if (source['!merges']) target['!merges'] = source['!merges'].map(merge => ({ s: { ...merge.s }, e: { ...merge.e } }));
    restorePivotDesign(XLSX, target);

    for (const [id, price] of priceByCell) {
      if (!(price > 0) || !id.startsWith(`${sheetName}!`)) continue;
      const address = id.slice(sheetName.length + 1);
      const cell = target[address];
      if (!cell || cell.t !== 'n' || !(Number(cell.v) > 0)) continue;
      cell.z = '#,##0.###';
      cell.s = { ...(cell.s || {}), numFmt: '#,##0.###', alignment: { ...(cell.s?.alignment || {}), horizontal: 'center', vertical: 'top', wrapText: false } };
      const { r } = XLSX.utils.decode_cell(address);
      target['!rows'][r] = { ...(target['!rows'][r] || {}), hpt: Math.max(Number(target['!rows'][r]?.hpt) || 0, 30) };
    }
    result.Sheets[sheetName] = target;
  }
  return { workbook: result, rows: buildDutchPriceRows(entries, prices, currency, bulkConfig) };
}
