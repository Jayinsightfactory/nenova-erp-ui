import { matchChinaHfCode } from './chinaHfCodes.js';

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
  const first = cycles[0];
  const last = cycles.at(-1);
  const range = first && last
    ? `${first.year}-${first.majorWeek}${first.startDate ? ` (${first.startDate})` : ''} ~ ${last.year}-${last.majorWeek}${last.endDate ? ` (${last.endDate})` : ''}`
    : '';
  return [center ? `중심차수 ${center}` : '', range ? `조회차수 범위 ${range}` : ''].filter(Boolean).join(' / ') || '조회범위 정보 없음';
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
  const cycleByYearMajor = new Map(cycles.map(cycle => [
    `${Number(cycle.year)}-${String(cycle.majorWeek).padStart(2, '0')}`,
    String(cycle.key),
  ]));
  const cycleKeys = new Set(cycles.map(cycle => String(cycle.key)));
  const cyclesValid = cycles.every(cycle => {
    const year = String(cycle.year);
    const majorWeek = String(cycle.majorWeek).padStart(2, '0');
    return /^\d{4}$/.test(year) && /^(0[1-9]|[1-4]\d|5[0-3])$/.test(majorWeek)
      && String(cycle.key) === `${year}${majorWeek}`;
  });
  if (cycles.length !== 7 || cycleKeys.size !== 7 || cycleByYearMajor.size !== 7 || !cyclesValid) {
    throw new Error('업체별 발주서에는 중복 없는 검증된 7개 차수가 필요합니다.');
  }
  const overview = workbook.addWorksheet('발주현황');
  overview.addRow(['품목번호', '품목코드', '품목명', 'HF CODE', '매칭상태', '단위', ...cycles.map(cycle => `${cycle.year}-${cycle.majorWeek}`), '합계']);
  for (const product of products) {
    const hf = statusFor(product);
    overview.addRow([
      product.prodKey == null ? '' : String(product.prodKey), literal(product.prodCode), literal(product.prodName), literal(hf.hfCode), literal(hf.label), literal(product.unit),
      ...cycles.map(cycle => literal(product.quantities?.[cycle.key] ?? 0)), literal(product.total ?? 0),
    ]);
  }
  const totalRows = [];
  for (const total of Array.isArray(report?.totals) ? report.totals : []) {
    const row = overview.addRow([
      '', '', `${literal(total.unit)} 합계`, '', '', literal(total.unit),
      ...cycles.map(cycle => literal(total.quantities?.[cycle.key] ?? 0)), literal(total.total ?? 0),
    ]);
    totalRows.push(row);
  }
  styledSheet(overview, [14, 20, 38, 16, 20, 12, ...cycles.map(() => 14), 14]);
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
    const week = String(order.orderWeek ?? '').match(/^(\d{1,2})-\d{1,2}[A-Za-z]?$/);
    const majorWeek = week?.[1] ? week[1].padStart(2, '0') : '';
    const cycleIdentity = `${Number(order.orderYear)}-${majorWeek}`;
    const cycleKey = cycleByYearMajor.get(cycleIdentity);
    if (!cycleKey) throw new Error(`주문 차수 ${order.orderYear}-${order.orderWeek}가 검증된 7차수 범위에 없습니다.`);
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
        quantities: Object.fromEntries(cycles.map(cycle => [cycle.key, 0])),
        total: 0,
      };
      customerOrders.set(groupKey, aggregate);
    } else if (aggregate.custOrderCode !== custOrderCode || aggregate.custName !== String(order.custName ?? '')
      || aggregate.prodCode !== String(order.prodCode ?? '') || aggregate.prodName !== String(order.prodName ?? '')) {
      throw new Error(`업체·품목 표시정보가 같은 집계키에서 일치하지 않습니다: ${groupKey}`);
    }
    aggregate.quantities[cycleKey] += quantity;
    aggregate.total += quantity;
  }

  customerSheet.addRow([
    '업체키(내부)', '업체 주문코드(CL)', '업체명', '품목키', '품목코드', '품목명', 'HF CODE', '매칭상태', '단위',
    ...cycles.map(cycle => `${cycle.year}-${cycle.majorWeek}`), '합계',
  ]);
  const customerOrderRows = [...customerOrders.values()].sort((a, b) => a.custName.localeCompare(b.custName, 'ko')
    || a.prodName.localeCompare(b.prodName, 'ko') || a.custKey.localeCompare(b.custKey, 'ko') || a.unit.localeCompare(b.unit, 'ko'));
  for (const aggregate of customerOrderRows) {
    customerSheet.addRow([
      aggregate.custKey, aggregate.custOrderCode, aggregate.custName, aggregate.prodKey, aggregate.prodCode, aggregate.prodName,
      aggregate.hfCode, aggregate.matchLabel, aggregate.unit,
      ...cycles.map(cycle => aggregate.quantities[cycle.key]), aggregate.total,
    ]);
  }
  styledSheet(customerSheet, [16, 22, 28, 14, 20, 38, 16, 22, 12, ...cycles.map(() => 14), 14]);
  for (const column of [1, 2, 4, 5, 7]) customerSheet.getColumn(column).numFmt = '@';
  customerSheet.getColumn(3).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  customerSheet.getColumn(6).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };

  return workbook;
}
