import { matchChinaHfCode } from './chinaHfCodes.js';
import { compareChinaSubweeks } from './chinaOrderDownload.js';
import { buildChinaOrderCustomerMatrix } from './chinaOrderCustomerMatrix.js';
import { chinaQuantityText } from './chinaOrderQuantityPresentation.js';

function literal(value) {
  if (value == null) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? value : '';
  if (typeof value === 'boolean') return String(value);
  return String(value);
}

function scopeText(report) {
  if (typeof report?.scope === 'string') return report.scope;
  const scope = report?.scope || {};
  const center = Number.isFinite(Number(scope.year)) && scope.majorWeek != null
    ? `${scope.year}-${String(scope.majorWeek).padStart(2, '0')}`
    : '';
  const cycles = Array.isArray(report?.cycles) ? report.cycles : [];
  const selected = Array.isArray(report?.columns)
    ? report.columns.find(column => column.key === report.selectedColumnKey && !column.empty)
    : null;
  const first = cycles[0];
  const last = cycles.at(-1);
  const range = first && last
    ? `${first.year}-${first.majorWeek}${first.startDate ? ` (${first.startDate})` : ''} ~ ${last.year}-${last.majorWeek}${last.endDate ? ` (${last.endDate})` : ''}`
    : '';
  const selectedLabel = selected ? `선택 세부차수 ${selected.year}-${selected.orderWeek}` : '';
  return [center ? `중심차수 ${center}` : '', range ? `조회차수 범위 ${range}` : '', selectedLabel].filter(Boolean).join(' / ') || '조회범위 정보 없음';
}

function displayCellText(cell) {
  const value = cell.value;
  if (value == null) return '';
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map(part => part.text || '').join('');
    if (value.text != null) return String(value.text);
    if (value.result != null) return String(value.result);
    return '';
  }
  return String(value);
}

function wrappedRowHeight(row, widths, isHeader) {
  let maxLines = 1;
  row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    const value = displayCellText(cell);
    if (!value) return;
    const capacity = Math.max(6, (widths[columnNumber - 1] || 16) - 2);
    const lines = value.split(/\r?\n/).reduce((sum, paragraph) => {
      let lineWidth = 0;
      let wrapped = 1;
      for (const character of paragraph) {
        const code = character.codePointAt(0);
        lineWidth += (code >= 0x2e80 || code >= 0x1f300) ? 2 : 1;
        if (lineWidth > capacity) {
          wrapped += 1;
          lineWidth = (code >= 0x2e80 || code >= 0x1f300) ? 2 : 1;
        }
      }
      return sum + wrapped;
    }, 0);
    maxLines = Math.max(maxLines, lines);
  });
  const minimum = isHeader ? 30 : 23;
  const maximum = isHeader ? 60 : 120;
  return Math.min(maximum, Math.max(minimum, maxLines * (isHeader ? 18 : 16) + 6));
}

function styledSheet(sheet, widths, headerRow = 1) {
  sheet.views = [{ state: 'frozen', ySplit: headerRow }];
  sheet.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: sheet.rowCount, column: sheet.columnCount } };
  sheet.columns.forEach((column, index) => {
    column.width = widths[index] || 16;
    column.alignment = { vertical: 'middle', horizontal: index < 4 ? 'left' : 'center', wrapText: true };
  });
  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    row.height = wrappedRowHeight(row, widths, rowNumber === headerRow);
    row.eachCell({ includeEmpty: true }, cell => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        right: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      };
      if (rowNumber === headerRow) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF374151' } };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      } else {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowNumber % 2 === 0 ? 'FFF3F4F6' : 'FFFFFFFF' } };
        cell.font = { color: { argb: 'FF111827' }, size: 10 };
      }
    });
  });
}

// Keep integer formatting clean even after Excel recalculates cached strings.
function matrixQuantityFormula(quantityRef, boxRef, blankZero = false) {
  const formatted = ref => `TEXT(${ref},IF(ROUND(${ref},3)=INT(ROUND(${ref},3)),"#,##0","#,##0.###"))`;
  const result = `${formatted(quantityRef)}&"("&IF(ISNUMBER(${boxRef}),${formatted(boxRef)},"—")&")"`;
  return blankZero ? `IF(${quantityRef}=0,"",${result})` : result;
}

function addCustomerMatrixSheet(workbook, report, products, statusFor) {
  const matrix = buildChinaOrderCustomerMatrix(report);
  const sheet = workbook.addWorksheet('품목별업체수량', { properties: { defaultRowHeight: 23 } });
  const source = workbook.addWorksheet('수량원본', { properties: { state: 'veryHidden' } });
  const customerHeaders = matrix.customers.map(customer => customer.custOrderCode || 'CL미등록');
  const sourceHeaders = ['품목키', '단위', '1박스당 단/송이', '총수량', '총박스수'];
  for (const customer of matrix.customers) sourceHeaders.push(`${customer.custKey} 원수량`, `${customer.custKey} 박스수`);
  source.addRow(sourceHeaders);
  source.state = 'veryHidden';
  sheet.addRow(['품목명(HF 코드)', '단위', '총수량(박스수)', ...customerHeaders]);

  const sourceRowsByUnit = new Map();
  const rowProducts = new Map(products.map(product => [`${product.prodKey}|${product.unit}`, product]));
  for (const item of matrix.rows) {
    const product = rowProducts.get(`${item.prodKey}|${item.unit}`) || item;
    const hf = statusFor(product);
    const hfCode = literal(hf.hfCode).trim();
    const productName = literal(item.prodName) || '미등록 품목명';
    const productLabel = hfCode ? `${productName} (${hfCode})` : productName;
    const customerQuantities = matrix.customers.map(customer => Number(item.quantities[String(customer.custKey)] ?? 0));
    const sourceRow = source.addRow([literal(item.prodKey), literal(item.unit), item.boxConversion.unitsPerBox ?? '', null, null,
      ...customerQuantities.flatMap(quantity => [quantity, null])]);
    const sourceRowNumber = sourceRow.number;
    const rawColumns = matrix.customers.map((_, index) => source.getColumn(6 + index * 2).letter);
    const boxColumns = matrix.customers.map((_, index) => source.getColumn(7 + index * 2).letter);
    const sumArgs = rawColumns.map(column => `${column}${sourceRowNumber}`).join(',');
    sourceRow.getCell(4).value = { formula: `SUM(${sumArgs})`, result: item.total };
    sourceRow.getCell(5).value = item.boxTotal == null
      ? { formula: `IF(D${sourceRowNumber}=0,0,IF(OR(C${sourceRowNumber}="",C${sourceRowNumber}<=0),"",D${sourceRowNumber}/C${sourceRowNumber}))`, result: '' }
      : { formula: `IF(D${sourceRowNumber}=0,0,IF(OR(C${sourceRowNumber}="",C${sourceRowNumber}<=0),"",D${sourceRowNumber}/C${sourceRowNumber}))`, result: item.boxTotal };
    matrix.customers.forEach((customer, index) => {
      const rawCell = sourceRow.getCell(6 + index * 2);
      const boxCell = sourceRow.getCell(7 + index * 2);
      const boxes = item.boxQuantities[String(customer.custKey)];
      boxCell.value = { formula: `IF(${rawCell.address}=0,0,IF(OR($C${sourceRowNumber}="",$C${sourceRowNumber}<=0),"",${rawCell.address}/$C${sourceRowNumber}))`, result: boxes ?? '' };
      rawCell.numFmt = '#,##0.###';
      boxCell.numFmt = '#,##0.###';
    });
    sourceRow.getCell(3).numFmt = '#,##0.###';
    sourceRow.getCell(4).numFmt = '#,##0.###';
    sourceRow.getCell(5).numFmt = '#,##0.###';

    const row = sheet.addRow([productLabel, literal(item.unit), null, ...matrix.customers.map(() => null)]);
    const shownTotal = chinaQuantityText(item.total, item.boxTotal);
    row.getCell(3).value = {
      formula: matrixQuantityFormula(`'수량원본'!D${sourceRowNumber}`, `'수량원본'!E${sourceRowNumber}`),
      result: shownTotal,
    };
    matrix.customers.forEach((customer, index) => {
      const rawColumn = source.getColumn(6 + index * 2).letter;
      const boxColumn = source.getColumn(7 + index * 2).letter;
      const quantity = item.quantities[String(customer.custKey)] ?? 0;
      const boxes = item.boxQuantities[String(customer.custKey)];
      row.getCell(4 + index).value = {
        formula: matrixQuantityFormula(`'수량원본'!${rawColumn}${sourceRowNumber}`, `'수량원본'!${boxColumn}${sourceRowNumber}`, true),
        result: quantity === 0 ? '' : chinaQuantityText(quantity, boxes),
      };
    });
    if (!sourceRowsByUnit.has(item.unit)) sourceRowsByUnit.set(item.unit, []);
    sourceRowsByUnit.get(item.unit).push(sourceRowNumber);
  }

  for (const total of matrix.totals) {
    const matchingSourceRows = sourceRowsByUnit.get(total.unit) || [];
    const sourceRow = source.addRow([`${literal(total.unit)} 합계`, literal(total.unit), '', null, null,
      ...matrix.customers.flatMap(customer => [null, null])]);
    const sourceRowNumber = sourceRow.number;
    sourceRow.getCell(4).value = { formula: `SUM(${matchingSourceRows.map(number => `D${number}`).join(',')})`, result: total.total };
    const unknownTotalFactor = matchingSourceRows.map(number => `AND(OR(C${number}="",C${number}<=0),D${number}>0)`).join(',');
    sourceRow.getCell(5).value = total.boxTotal == null
      ? { formula: `IF(OR(${unknownTotalFactor}),"",SUM(${matchingSourceRows.map(number => `E${number}`).join(',')}))`, result: '' }
      : { formula: `IF(OR(${unknownTotalFactor}),"",SUM(${matchingSourceRows.map(number => `E${number}`).join(',')}))`, result: total.boxTotal };
    matrix.customers.forEach((customer, index) => {
      const rawColumn = source.getColumn(6 + index * 2).letter;
      const boxColumn = source.getColumn(7 + index * 2).letter;
      const rawValue = total.quantities[String(customer.custKey)] ?? 0;
      const boxValue = total.boxQuantities[String(customer.custKey)];
      sourceRow.getCell(6 + index * 2).value = { formula: `SUM(${matchingSourceRows.map(number => `${rawColumn}${number}`).join(',')})`, result: rawValue };
      const unknownCustomerFactor = matchingSourceRows.map(number => `AND(OR(C${number}="",C${number}<=0),${rawColumn}${number}>0)`).join(',');
      const formula = `IF(OR(${unknownCustomerFactor}),"",SUM(${matchingSourceRows.map(number => `${boxColumn}${number}`).join(',')}))`;
      sourceRow.getCell(7 + index * 2).value = { formula, result: boxValue ?? '' };
    });
    const rawTotalColumn = source.getColumn(4).letter;
    const boxTotalColumn = source.getColumn(5).letter;
    const shown = sheet.addRow([`${literal(total.unit)} 합계`, literal(total.unit), null, ...matrix.customers.map(() => null)]);
    const cachedTotal = chinaQuantityText(total.total, total.boxTotal);
    shown.getCell(3).value = { formula: matrixQuantityFormula(`'수량원본'!${rawTotalColumn}${sourceRowNumber}`, `'수량원본'!${boxTotalColumn}${sourceRowNumber}`), result: cachedTotal };
    matrix.customers.forEach((customer, index) => {
      const rawColumn = source.getColumn(6 + index * 2).letter;
      const boxColumn = source.getColumn(7 + index * 2).letter;
      shown.getCell(4 + index).value = {
        formula: matrixQuantityFormula(`'수량원본'!${rawColumn}${sourceRowNumber}`, `'수량원본'!${boxColumn}${sourceRowNumber}`, true),
        result: (total.quantities[String(customer.custKey)] ?? 0) === 0 ? '' : chinaQuantityText(total.quantities[String(customer.custKey)], total.boxQuantities[String(customer.custKey)]),
      };
    });
  }

  const customerWidths = matrix.customers.map(customer => Math.max(12, Math.min(16, String(customer.custOrderCode || '').length + 3)));
  const widths = [46, 12, 18, ...customerWidths];
  styledSheet(sheet, widths);
  styledSheet(source, [14, 12, 20, 16, 16, ...matrix.customers.flatMap(() => [16, 16])]);
  source.getColumn(1).numFmt = '@';
  for (let column = 6; column <= source.columnCount; column += 2) source.getColumn(column).numFmt = '#,##0.###';
  source.getColumn(1).hidden = true;
  source.getColumn(2).hidden = true;
  source.getColumn(3).hidden = true;
  source.getColumn(4).hidden = true;
  source.getColumn(5).hidden = true;
  for (let column = 6; column <= source.columnCount; column += 1) source.getColumn(column).hidden = true;
  for (const total of matrix.totals) {
    const row = [...Array(sheet.rowCount - 1)].map((_, index) => sheet.getRow(index + 2))
      .find(candidate => candidate.getCell(1).value === `${literal(total.unit)} 합계`);
    row?.eachCell({ includeEmpty: true }, cell => {
      cell.font = { bold: true, color: { argb: 'FF111827' }, size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    });
  }
  sheet.views = [{ state: 'frozen', xSplit: 3, ySplit: 1, topLeftCell: 'D2' }];
  sheet.getColumn(1).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  sheet.getColumn(2).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  for (let column = 3; column <= sheet.columnCount; column += 1) {
    sheet.getColumn(column).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  }
  for (let index = 1; index < matrix.customers.length; index += 1) {
    if (matrix.customers[index - 1].codeGroup === matrix.customers[index].codeGroup) continue;
    const column = 3 + index + 1;
    for (const row of [sheet.getRow(1), ...matrix.rows.map((_, rowIndex) => sheet.getRow(rowIndex + 2)), ...matrix.totals.map((_, rowIndex) => sheet.getRow(matrix.rows.length + rowIndex + 2))]) {
      row.getCell(column).border = { ...row.getCell(column).border, left: { style: 'medium', color: { argb: 'FF6B7280' } } };
    }
  }
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.eachCell((cell, columnNumber) => {
      if (columnNumber < 3) return;
      const value = typeof cell.value === 'object' ? cell.value?.result : cell.value;
      if (typeof value === 'number') cell.numFmt = Number.isInteger(value) ? '#,##0' : '#,##0.###';
    });
  });
  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    if (rowNumber !== 1) return;
    let maxLines = 1;
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      const value = displayCellText(cell);
      const capacity = Math.max(6, (widths[columnNumber - 1] || 16) - 2);
      const lines = value.split(/\r?\n/).reduce((sum, paragraph) => {
        let lineWidth = 0;
        let wrapped = 1;
        for (const character of paragraph) {
          const code = character.codePointAt(0);
          lineWidth += (code >= 0x2e80 || code >= 0x1f300) ? 2 : 1;
          if (lineWidth > capacity) {
            wrapped += 1;
            lineWidth = (code >= 0x2e80 || code >= 0x1f300) ? 2 : 1;
          }
        }
        return sum + wrapped;
      }, 0);
      maxLines = Math.max(maxLines, lines);
    });
    row.height = Math.max(30, maxLines * 18 + 6);
  });
  return sheet;
}

export async function buildChinaOrderWorkbook(report, mapping) {
  const imported = await import('exceljs');
  const ExcelJS = imported.default || imported;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Nenova';
  workbook.subject = '중국 주문등록 조회';
  workbook.created = new Date();

  const products = Array.isArray(report?.rows) ? report.rows : [];
  const productByKey = new Map(products.map(product => [String(product.prodKey), product]));
  const catalog = Array.isArray(report?.products) ? report.products : [];
  const statusFor = product => matchChinaHfCode(product, mapping, catalog);
  const cycles = Array.isArray(report?.cycles) ? report.cycles : [];
  const columns = Array.isArray(report?.columns) ? report.columns : [];
  const cycleKeys = new Set(cycles.map(cycle => String(cycle.key)));
  const cyclesValid = cycles.every(cycle => {
    const year = String(cycle.year);
    const majorWeek = String(cycle.majorWeek).padStart(2, '0');
    return /^\d{4}$/.test(year) && /^(0[1-9]|[1-4]\d|5[0-3])$/.test(majorWeek)
      && String(cycle.key) === `${year}${majorWeek}`;
  });
  if (cycles.length !== 7 || cycleKeys.size !== 7 || !cyclesValid) {
    throw new Error('업체별 발주서에는 중복 없는 검증된 7개 차수가 필요합니다.');
  }
  const columnsValid = columns.length >= 7 && columns.every((column, index) => {
    const cycle = cycles.find(item => String(item.key) === String(column.cycleKey));
    if (!cycle || Number(column.year) !== Number(cycle.year)
      || String(column.majorWeek).padStart(2, '0') !== String(cycle.majorWeek).padStart(2, '0')
      || Number(column.offset) !== Number(cycle.offset)) return false;
    if (column.empty === true) {
      return column.key === `${cycle.key}/empty` && column.orderWeek === null
        && column.label === '주문 없음';
    }
    if (column.empty !== false || typeof column.orderWeek !== 'string'
      || column.label !== column.orderWeek) return false;
    const match = column.orderWeek.match(/^(\d{1,2})-(\d{1,2})([A-Za-z]?)$/);
    if (!match || Number(match[1]) !== Number(cycle.majorWeek)) return false;
    const canonicalWeek = `${String(Number(match[1])).padStart(2, '0')}-${String(Number(match[2])).padStart(2, '0')}${match[3]}`;
    return column.orderWeek === canonicalWeek
      && column.key === `${Number(cycle.year)}/${column.orderWeek}`;
  });
  const columnKeys = new Set(columns.map(column => String(column.key)));
  const columnsByCycle = new Map(cycles.map(cycle => [String(cycle.key), []]));
  for (const column of columns) {
    if (!columnsByCycle.has(String(column.cycleKey))) continue;
    columnsByCycle.get(String(column.cycleKey)).push(column);
  }
  const columnOrderValid = cycles.every(cycle => {
    const group = columnsByCycle.get(String(cycle.key)) || [];
    if (!group.length || (group.length > 1 && group.some(column => column.empty))) return false;
    const actual = group.filter(column => !column.empty);
    if (group.length === 1 && group[0].empty) return true;
    if (!actual.length) return false;
    const expected = [...actual].sort((a, b) => compareChinaSubweeks(a.orderWeek, b.orderWeek));
    return actual.every((column, index) => column === expected[index]);
  }) && columns.every((column, index) => {
    const expectedCycle = cycles.findIndex(cycle => String(cycle.key) === String(column.cycleKey));
    return index === 0 || expectedCycle >= cycles.findIndex(cycle => String(cycle.key) === String(columns[index - 1].cycleKey));
  });
  if (!columnsValid || columnKeys.size !== columns.length || !columnOrderValid) {
    throw new Error('업체별 발주서에는 7개 차수와 일치하는 중복 없는 세부차수 열이 필요합니다.');
  }
  const columnByYearWeek = new Map(columns.filter(column => !column.empty)
    .map(column => [`${Number(column.year)}/${column.orderWeek}`, column]));
  if (columnByYearWeek.size !== columns.filter(column => !column.empty).length) {
    throw new Error('세부차수 라벨이 중복되어 주문 열을 구분할 수 없습니다.');
  }
  for (const order of Array.isArray(report?.orders) ? report.orders : []) {
    const orderKey = `${Number(order.orderYear)}/${String(order.orderWeek ?? '')}`;
    if (!columnByYearWeek.has(orderKey)) {
      throw new Error(`주문 차수 ${order.orderYear}-${order.orderWeek}가 검증된 세부차수 열에 없습니다.`);
    }
  }
  let displayColumns = columns;
  if (report?.selectedColumnKey != null) {
    const selected = columns.find(column => column.key === report.selectedColumnKey && !column.empty);
    if (!selected) throw new Error('선택 세부차수는 검증된 실제 세부차수 열이어야 합니다.');
    for (const order of Array.isArray(report?.orders) ? report.orders : []) {
      if (`${Number(order.orderYear)}/${String(order.orderWeek)}` !== `${selected.year}/${selected.orderWeek}`) {
        throw new Error('선택 세부차수 엑셀에는 해당 연도·세부차수 주문만 포함할 수 있습니다.');
      }
    }
    displayColumns = [selected];
  }
  if (report?.selectedColumnKey != null) {
    addCustomerMatrixSheet(workbook, report, products, statusFor);
  }
  const columnHeader = column => column.empty
    ? `${column.year}-${column.majorWeek} (주문 없음)`
    : `${column.year}-${column.orderWeek}`;
  const overview = workbook.addWorksheet('발주현황');
  overview.addRow(['품목번호', '품목코드', '품목명', 'HF CODE', '매칭상태', '단위', ...displayColumns.map(columnHeader), '합계']);
  for (const product of products) {
    const hf = statusFor(product);
    overview.addRow([
      product.prodKey == null ? '' : String(product.prodKey), literal(product.prodCode), literal(product.prodName), literal(hf.hfCode), literal(hf.label), literal(product.unit),
      ...displayColumns.map(column => literal(column.empty ? 0 : product.quantities?.[column.key] ?? 0)), literal(product.total ?? 0),
    ]);
  }
  const totalRows = [];
  for (const total of Array.isArray(report?.totals) ? report.totals : []) {
    const row = overview.addRow([
      '', '', `${literal(total.unit)} 합계`, '', '', literal(total.unit),
      ...displayColumns.map(column => literal(column.empty ? 0 : total.quantities?.[column.key] ?? 0)), literal(total.total ?? 0),
    ]);
    totalRows.push(row);
  }
  styledSheet(overview, [14, 20, 38, 16, 20, 12, ...displayColumns.map(() => 14), 14]);
  for (const row of totalRows) row.eachCell({ includeEmpty: true }, cell => {
    cell.font = { bold: true, color: { argb: 'FF111827' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
  });
  overview.getColumn(1).numFmt = '@';
  overview.getColumn(2).numFmt = '@';
  overview.getColumn(4).numFmt = '@';
  overview.getColumn(3).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  overview.getColumn(3).hidden = false;

  const customerSheet = workbook.addWorksheet('업체별발주');

  const detail = workbook.addWorksheet('주문상세');
  detail.addRow(['연도', '세부차수', '업체키(내부)', '업체명', '업체 주문코드(CL)', '품목키', '품목코드', '품목명', 'HF CODE', '단위', '수량']);
  for (const order of Array.isArray(report?.orders) ? report.orders : []) {
    const product = productByKey.get(String(order.prodKey)) || order;
    const hf = statusFor(product);
    detail.addRow([
      literal(order.orderYear), literal(order.orderWeek), order.custKey == null ? '' : String(order.custKey), literal(order.custName), order.custOrderCode == null ? '' : String(order.custOrderCode),
      order.prodKey == null ? '' : String(order.prodKey), literal(order.prodCode), literal(order.prodName), literal(hf.hfCode), literal(order.unit), literal(order.quantity),
    ]);
  }
  styledSheet(detail, [12, 13, 16, 26, 22, 14, 20, 38, 16, 12, 14]);
  detail.getColumn(8).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  for (const column of [3, 5, 6, 7, 9]) detail.getColumn(column).numFmt = '@';
  detail.getColumn(2).numFmt = '@';

  const basis = workbook.addWorksheet('조회기준');
  basis.addRows([
    ['항목', '값'],
    ['조회범위', scopeText(report)],
    ['조회시각', literal(report?.queriedAt)],
    ['HF 사전 파일', literal(mapping?.sourceFile)],
    ['HF 사전 시트', literal(mapping?.sourceSheet)],
    ['안내', 'HF 매칭·검토 상태는 참고정보이며 원본 주문과 ERP 원장은 변경하지 않습니다.'],
    ...((report?.warnings || []).map(warning => ['경고', literal(warning)])),
  ]);
  styledSheet(basis, [22, 100]);
  basis.getColumn(2).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };

  const customerOrders = new Map();
  for (const order of Array.isArray(report?.orders) ? report.orders : []) {
    const column = columnByYearWeek.get(`${Number(order.orderYear)}/${String(order.orderWeek)}`);
    const custKey = order.custKey == null ? '' : String(order.custKey);
    const prodKey = order.prodKey == null ? '' : String(order.prodKey);
    const unit = String(order.unit ?? '');
    const groupKey = `${custKey}|${prodKey}|${unit}`;
    const custOrderCode = order.custOrderCode == null ? '' : String(order.custOrderCode);
    const product = productByKey.get(prodKey) || order;
    const hf = statusFor(product);
    const quantity = Number(order.quantity);
    if (!Number.isFinite(quantity)) throw new Error(`주문 수량이 올바르지 않습니다: ${groupKey}`);
    let aggregate = customerOrders.get(groupKey);
    if (!aggregate) {
      aggregate = {
        custKey,
        custOrderCode,
        custName: String(order.custName ?? ''),
        prodKey,
        prodCode: String(order.prodCode ?? ''),
        prodName: String(order.prodName ?? ''),
        hfCode: hf.hfCode,
        matchLabel: hf.label,
        unit,
        quantities: Object.fromEntries(columns.map(column => [column.key, 0])),
        total: 0,
      };
      customerOrders.set(groupKey, aggregate);
    } else if (aggregate.custOrderCode !== custOrderCode || aggregate.custName !== String(order.custName ?? '')
      || aggregate.prodCode !== String(order.prodCode ?? '') || aggregate.prodName !== String(order.prodName ?? '')) {
      throw new Error(`업체·품목 표시정보가 같은 집계키에서 일치하지 않습니다: ${groupKey}`);
    }
    aggregate.quantities[column.key] += quantity;
    aggregate.total += quantity;
  }

  customerSheet.addRow([
    '업체키(내부)', '업체 주문코드(CL)', '업체명', '품목키', '품목코드', '품목명', 'HF CODE', '매칭상태', '단위',
    ...displayColumns.map(columnHeader), '합계',
  ]);
  const customerOrderRows = [...customerOrders.values()].sort((a, b) => a.custName.localeCompare(b.custName, 'ko')
    || a.prodName.localeCompare(b.prodName, 'ko') || a.custKey.localeCompare(b.custKey, 'ko') || a.unit.localeCompare(b.unit, 'ko'));
  for (const aggregate of customerOrderRows) {
    customerSheet.addRow([
      aggregate.custKey, aggregate.custOrderCode, aggregate.custName, aggregate.prodKey, aggregate.prodCode, aggregate.prodName,
      aggregate.hfCode, aggregate.matchLabel, aggregate.unit,
      ...displayColumns.map(column => aggregate.quantities[column.key]), aggregate.total,
    ]);
  }
  styledSheet(customerSheet, [16, 22, 28, 14, 20, 38, 16, 22, 12, ...displayColumns.map(() => 14), 14]);
  for (const column of [1, 2, 4, 5, 7]) customerSheet.getColumn(column).numFmt = '@';
  customerSheet.getColumn(3).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  customerSheet.getColumn(6).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };

  return workbook;
}
