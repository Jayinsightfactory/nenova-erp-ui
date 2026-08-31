const DUTCH_TOKEN = /네덜란드|netherlands|holland|dutch/i;
const valueOf = cell => String(cell?.v ?? '').trim();
const rangeOf = (XLSX, sheet) => sheet?.['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null;

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

export function parseDutchPivotWorkbook(XLSX, workbook) {
  const entries = [];
  const sheets = [];
  for (const sheetName of workbook?.SheetNames || []) {
    if (sheetName === '_keymap') continue;
    const sheet = workbook.Sheets[sheetName];
    if (!isDutchPivotSheet(XLSX, sheetName, sheet)) continue;
    const range = rangeOf(XLSX, sheet);
    if (!range || range.e.r < 3) continue;
    sheets.push(sheetName);
    let summaryStart = range.e.c + 1;
    for (let col = 1; col <= range.e.c; col += 1) {
      if (valueOf(sheet[XLSX.utils.encode_cell({ r: 2, c: col })]) === '주문') { summaryStart = col; break; }
    }
    for (let row = 3; row <= range.e.r; row += 1) {
      const product = valueOf(sheet[XLSX.utils.encode_cell({ r: row, c: 0 })]);
      if (!product || product === '합계') continue;
      const color = valueOf(sheet[XLSX.utils.encode_cell({ r: row, c: 1 })]);
      for (let col = 1; col < summaryStart; col += 1) {
        const customer = valueOf(sheet[XLSX.utils.encode_cell({ r: 2, c: col })]);
        if (!customer || customer === '칼라') continue;
        const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
        const quantity = Number(sheet[cellAddress]?.v);
        if (!(Number.isFinite(quantity) && quantity > 0)) continue;
        entries.push({ id: `${sheetName}!${cellAddress}`, sheetName, cellAddress, product, color, customer, quantity });
      }
    }
  }
  if (!sheets.length) throw new Error('네덜란드 Pivot 시트를 찾지 못했습니다. Pivot 통계에서 내려받은 네덜란드 물량표인지 확인해 주세요.');
  if (!entries.length) throw new Error('네덜란드 시트에서 업체별 수량을 찾지 못했습니다. 수량이 입력된 원본 양식을 확인해 주세요.');
  return { sheets, entries };
}

export function buildDutchEntriesFromPivotData(data, orderYear, orderWeek) {
  const entries = [];
  for (const row of data?.rows || []) {
    if (!DUTCH_TOKEN.test(String(row?.country || row?.counName || ''))) continue;
    const quantities = row.orders && typeof row.orders === 'object' ? row.orders : (row.outOrders || {});
    for (const [customer, rawQuantity] of Object.entries(quantities)) {
      const quantity = Number(rawQuantity);
      if (!(Number.isFinite(quantity) && quantity > 0)) continue;
      entries.push({
        id: `live:${orderYear}:${orderWeek}:${customer}:${row.prodKey}`,
        sheetName: '네노바웹 직접 조회',
        cellAddress: '',
        product: String(row.prodName || row.productName || ''),
        color: String(row.productDescr || row.color || ''),
        customer,
        quantity,
        prodKey: Number(row.prodKey || 0),
      });
    }
  }
  return entries.sort((a, b) => a.product.localeCompare(b.product, 'ko') || a.customer.localeCompare(b.customer, 'ko'));
}

export function priceProgress(entries, prices) {
  const completed = (entries || []).filter(entry => Number(prices?.[entry.id]) > 0).length;
  return { completed, total: (entries || []).length, pending: (entries || []).length - completed };
}

export function buildDutchPriceRows(entries, prices, currency = 'EUR') {
  return (entries || []).map(entry => {
    const unitPrice = Number(prices?.[entry.id] || 0);
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
  if (!sheet['!rows']) sheet['!rows'] = [];
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
export function addDutchPriceColumns(XLSX, workbook, entries, prices, currency = 'EUR') {
  const result = { ...workbook, SheetNames: [...(workbook?.SheetNames || [])], Sheets: { ...(workbook?.Sheets || {}) } };
  const priceByCell = new Map((entries || []).map(entry => [entry.id, Number(prices?.[entry.id] || 0)]));

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
      cell.s = { ...(cell.s || {}), numFmt: '#,##0.###', alignment: { ...(cell.s?.alignment || {}), horizontal: 'center', vertical: 'center' } };
    }
    result.Sheets[sheetName] = target;
  }
  return { workbook: result, rows: buildDutchPriceRows(entries, prices, currency) };
}
