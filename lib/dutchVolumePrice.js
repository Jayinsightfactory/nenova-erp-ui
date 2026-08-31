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

function shiftedColumn(oldColumn, customerColumns) {
  return oldColumn + customerColumns.filter(column => column < oldColumn).length;
}

function shiftFormulaColumns(XLSX, formula, customerColumns) {
  const protectedSums = [];
  const withPlaceholders = String(formula || '').replace(/SUM\((\$?[A-Z]{1,3})(\$?\d+):(\$?[A-Z]{1,3})(\$?\d+)\)/gi, (match, startLetters, startRow, endLetters, endRow) => {
    const startColumn = XLSX.utils.decode_col(startLetters.replace('$', ''));
    const endColumn = XLSX.utils.decode_col(endLetters.replace('$', ''));
    if (startRow !== endRow || !customerColumns.includes(startColumn) || !customerColumns.includes(endColumn)) return match;
    const refs = customerColumns
      .filter(column => column >= startColumn && column <= endColumn)
      .map(column => `${XLSX.utils.encode_col(shiftedColumn(column, customerColumns))}${startRow}`);
    if (!refs.length) return match;
    const token = `__DUTCH_CUSTOMER_SUM_${protectedSums.length}__`;
    protectedSums.push(`SUM(${refs.join(',')})`);
    return token;
  });
  const shifted = withPlaceholders.replace(/(\$?)([A-Z]{1,3})(\$?\d+)/g, (match, abs, letters, rowPart) => {
    const oldColumn = XLSX.utils.decode_col(letters);
    return `${abs}${XLSX.utils.encode_col(shiftedColumn(oldColumn, customerColumns))}${rowPart}`;
  });
  return shifted.replace(/__DUTCH_CUSTOMER_SUM_(\d+)__/g, (match, index) => protectedSums[Number(index)] || match);
}

function cloneCell(cell) {
  if (!cell) return null;
  return { ...cell, s: cell.s ? { ...cell.s } : cell.s };
}

/**
 * Pivot 통계 물량표 원본의 행/요약/농장 구조와 서식을 보존하고,
 * 각 업체 수량 열 바로 오른쪽에 단가 열 하나만 삽입한다.
 */
export function addDutchPriceColumns(XLSX, workbook, entries, prices, currency = 'EUR') {
  const result = { ...workbook, SheetNames: [...(workbook?.SheetNames || [])], Sheets: { ...(workbook?.Sheets || {}) } };
  const priceByCell = new Map((entries || []).map(entry => [entry.id, Number(prices?.[entry.id] || 0)]));

  for (const sheetName of result.SheetNames) {
    const source = workbook.Sheets[sheetName];
    if (!source || !isDutchPivotSheet(XLSX, sheetName, source)) continue;
    const range = rangeOf(XLSX, source);
    if (!range || range.e.r < 3) continue;

    let summaryStart = range.e.c + 1;
    for (let col = 1; col <= range.e.c; col += 1) {
      if (valueOf(source[XLSX.utils.encode_cell({ r: 2, c: col })]) === '주문') { summaryStart = col; break; }
    }
    const customerColumns = [];
    for (let col = 2; col < summaryStart; col += 1) {
      const header = valueOf(source[XLSX.utils.encode_cell({ r: 2, c: col })]);
      if (header && header !== '칼라') customerColumns.push(col);
    }
    if (!customerColumns.length) continue;

    const target = {};
    Object.entries(source).forEach(([key, value]) => {
      if (key.startsWith('!')) return;
      const address = XLSX.utils.decode_cell(key);
      const nextColumn = shiftedColumn(address.c, customerColumns);
      const nextAddress = XLSX.utils.encode_cell({ r: address.r, c: nextColumn });
      const cell = cloneCell(value);
      if (cell?.f) cell.f = shiftFormulaColumns(XLSX, cell.f, customerColumns);
      target[nextAddress] = cell;
    });

    customerColumns.forEach((oldColumn) => {
      const quantityColumn = shiftedColumn(oldColumn, customerColumns);
      const priceColumn = quantityColumn + 1;
      for (let row = range.s.r; row <= range.e.r; row += 1) {
        const sourceCell = source[XLSX.utils.encode_cell({ r: row, c: oldColumn })];
        const address = XLSX.utils.encode_cell({ r: row, c: priceColumn });
        const style = cloneCell(sourceCell)?.s;
        if (row === 2) target[address] = { t: 's', v: `단가\n(${currency})`, s: style };
        else if (row >= 3) {
          const product = valueOf(source[XLSX.utils.encode_cell({ r: row, c: 0 })]);
          const price = product && product !== '합계'
            ? priceByCell.get(`${sheetName}!${XLSX.utils.encode_cell({ r: row, c: oldColumn })}`)
            : 0;
          target[address] = price > 0
            ? { t: 'n', v: price, s: style, z: '#,##0.####' }
            : { t: 's', v: '', s: style };
        } else target[address] = { t: 's', v: '', s: style };
      }
    });

    const targetEndColumn = shiftedColumn(range.e.c, customerColumns);
    target['!ref'] = XLSX.utils.encode_range({ s: range.s, e: { r: range.e.r, c: targetEndColumn } });
    target['!cols'] = [];
    for (let oldColumn = 0; oldColumn <= range.e.c; oldColumn += 1) {
      const nextColumn = shiftedColumn(oldColumn, customerColumns);
      target['!cols'][nextColumn] = source['!cols']?.[oldColumn] ? { ...source['!cols'][oldColumn] } : {};
      if (customerColumns.includes(oldColumn)) target['!cols'][nextColumn + 1] = { wch: 10 };
    }
    if (source['!rows']) target['!rows'] = source['!rows'].map(row => row ? { ...row } : row);
    if (source['!freeze']) target['!freeze'] = { ...source['!freeze'] };
    if (source['!merges']) target['!merges'] = source['!merges'].map(merge => ({
      s: { ...merge.s, c: shiftedColumn(merge.s.c, customerColumns) },
      e: { ...merge.e, c: shiftedColumn(merge.e.c, customerColumns) + (customerColumns.includes(merge.e.c) ? 1 : 0) },
    }));
    result.Sheets[sheetName] = target;
  }
  return { workbook: result, rows: buildDutchPriceRows(entries, prices, currency) };
}
