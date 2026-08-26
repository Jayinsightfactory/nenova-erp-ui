// Week-pivot Excel sheet builder.  It deliberately receives every display value
// from its caller so exporting remains a read-only, UI-only operation.

function valueAt(map, key) {
  return map && Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
}

function numeric(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

/**
 * Build the historic three-header-row week-pivot sheet.
 *
 * Notes intentionally use the supplied descrMap without cleaning or parsing: a
 * note is audit text, including when the associated shipment quantity is zero.
 */
export function buildWeekPivotSheet(XLSX, {
  weeks = [], custKeys = [], prodKeys = [], prodMap = {}, dataMap = {}, inMap = {},
  startStocks = {}, prevStockMap = {}, descrMap = {}, areaGroups = [],
  customerLabel = (key) => String(key),
  productLabel = (product) => product?.displayName || product?.name || '',
} = {}) {
  if (!XLSX?.utils?.aoa_to_sheet || !XLSX?.utils?.encode_col || !XLSX?.utils?.encode_cell) {
    throw new TypeError('buildWeekPivotSheet requires a SheetJS-compatible XLSX instance');
  }

  const colsPerWeek = custKeys.length + 5; // customer quantities + 시작/입고/출고/잔량 + change notes
  const totalCols = 3 + weeks.length * colsPerWeek;
  const dataStartRow = 3;
  const sumRow = dataStartRow + prodKeys.length;
  const notesByCell = new Map();
  const noteRowHeights = [];
  const flatData = [];

  const header1 = ['', '', ''];
  for (const week of weeks) {
    for (let index = 0; index < colsPerWeek; index += 1) header1.push(index === 0 ? week : '');
  }
  flatData.push(header1);

  const header2 = ['', '', ''];
  for (const _week of weeks) {
    for (const group of areaGroups) {
      for (let index = 0; index < numeric(group?.count); index += 1) header2.push(index === 0 ? (group?.area || '') : '');
    }
    // The stock summary and notes have no customer-area grouping.
    header2.push('', '', '', '', '');
  }
  flatData.push(header2);

  const header3 = ['국가', '꽃', '품명'];
  for (const _week of weeks) {
    for (const customerKey of custKeys) header3.push(customerLabel(customerKey));
    header3.push('시작', '입고', '출고', '잔량', '수량 변경내역');
  }
  flatData.push(header3);

  prodKeys.forEach((productKey, productIndex) => {
    const product = prodMap[productKey] || {};
    const row = [product.coun || '', product.flower || '', productLabel(product) || ''];
    const firstStart = valueAt(startStocks, `${productKey}-${weeks[0]}`);
    let rollingStock = firstStart?.stock != null ? numeric(firstStart.stock) : numeric(prevStockMap[productKey]);

    weeks.forEach((week, weekIndex) => {
      const start = valueAt(startStocks, `${productKey}-${week}`)?.stock;
      if (start != null) rollingStock = numeric(start);

      for (const customerKey of custKeys) {
        const quantity = numeric(valueAt(dataMap, `${productKey}-${customerKey}-${week}`));
        row.push(quantity > 0 ? quantity : '');
      }

      const weekStart = rollingStock;
      const incoming = numeric(valueAt(inMap, `${productKey}-${week}`));
      const outgoing = custKeys.reduce((total, customerKey) => total + numeric(valueAt(dataMap, `${productKey}-${customerKey}-${week}`)), 0);
      rollingStock = weekStart + incoming - outgoing;
      row.push(weekStart || '', incoming || '', outgoing || '', rollingStock);

      const notes = custKeys
        .map((customerKey) => {
          const note = valueAt(descrMap, `${productKey}-${customerKey}-${week}`);
          return note == null || note === '' ? '' : `${customerLabel(customerKey)}: ${String(note)}`;
        })
        .filter(Boolean)
        .join('\n');
      row.push(notes);
      if (notes) {
        notesByCell.set(`${productIndex}:${weekIndex}`, notes);
        // Excel's automatic row sizing is inconsistent for merged/frozen export
        // sheets, so leave enough room for the longest customer-prefixed note.
        const lineCount = notes.split(/\r\n|\r|\n/).length;
        noteRowHeights[productIndex] = Math.max(noteRowHeights[productIndex] || 0, 18, lineCount * 15);
      }
    });
    flatData.push(row);
  });

  const totals = ['', '', '합계'];
  for (let column = 3; column < totalCols; column += 1) {
    const withinWeek = (column - 3) % colsPerWeek;
    if (withinWeek === colsPerWeek - 1 || prodKeys.length === 0) totals.push('');
    else {
      const excelColumn = XLSX.utils.encode_col(column);
      // SheetJS needs a numeric cached value to retain a formula through an XLSX
      // write/read roundtrip. Excel recalculates this SUM when the file opens.
      totals.push({ t: 'n', f: `SUM(${excelColumn}${dataStartRow + 1}:${excelColumn}${sumRow})`, v: 0 });
    }
  }
  flatData.push(totals);

  const worksheet = XLSX.utils.aoa_to_sheet(flatData);
  const merges = [
    { s: { r: 0, c: 0 }, e: { r: 2, c: 0 } },
    { s: { r: 0, c: 1 }, e: { r: 2, c: 1 } },
    { s: { r: 0, c: 2 }, e: { r: 2, c: 2 } },
  ];
  weeks.forEach((_week, weekIndex) => {
    const startColumn = 3 + weekIndex * colsPerWeek;
    const endColumn = startColumn + colsPerWeek - 1;
    merges.push({ s: { r: 0, c: startColumn }, e: { r: 0, c: endColumn } });
    let column = startColumn;
    for (const group of areaGroups) {
      const count = numeric(group?.count);
      if (count > 1) merges.push({ s: { r: 1, c: column }, e: { r: 1, c: column + count - 1 } });
      column += count;
    }
    merges.push({ s: { r: 1, c: endColumn - 4 }, e: { r: 1, c: endColumn } });
  });
  worksheet['!merges'] = merges;
  worksheet['!cols'] = [
    { wch: 10 }, { wch: 10 }, { wch: 26 },
    ...Array.from({ length: weeks.length }, () => [
      ...Array.from({ length: custKeys.length + 4 }, () => ({ wch: 7 })),
      { wch: 36 },
    ]).flat(),
  ];
  if (noteRowHeights.some(Boolean)) {
    worksheet['!rows'] = noteRowHeights.map((hpt) => hpt ? { hpt } : undefined);
    // Data begins below the three header rows; row metadata is zero-based too.
    worksheet['!rows'] = [undefined, undefined, undefined, ...worksheet['!rows']];
  }

  // AOA strings can be mistaken for formulas by alternate SheetJS builds.  Make
  // every note explicitly textual, while retaining raw note content exactly.
  for (const [key, note] of notesByCell) {
    const [productIndex, weekIndex] = key.split(':').map(Number);
    const column = 3 + weekIndex * colsPerWeek + colsPerWeek - 1;
    worksheet[XLSX.utils.encode_cell({ r: dataStartRow + productIndex, c: column })] = {
      t: 's', v: note, s: { alignment: { wrapText: true, vertical: 'top' } },
    };
  }
  return worksheet;
}
