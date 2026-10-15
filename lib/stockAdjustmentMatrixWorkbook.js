// Runtime XLSX export of the exact read-only adjustment matrix.
const HEADER_ROW = 6;
const QUANTITY_FORMAT = '+0.###;-0.###;0';
const SMALL_QUANTITY_FORMAT = '+0.##############E+00;-0.##############E+00;0';
const BLUE = 'FF164E87';
const ZERO_NET_GREEN = 'FFEAF5ED';

function literal(value) {
  // ExcelJS string cells stay literal even when they begin with =, +, -, or @.
  // Never pass a caller-controlled object (which could contain a formula) through.
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : '확인 필요';
  return String(value);
}

function addSheet(workbook, name, columns, metadata, data, frozenColumns = 2) {
  const sheet = workbook.addWorksheet(name, {
    properties: { defaultRowHeight: 22 },
    views: [{ state: 'frozen', xSplit: frozenColumns, ySplit: HEADER_ROW, activeCell: `${String.fromCharCode(65 + frozenColumns)}${HEADER_ROW + 1}`, showGridLines: false }],
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `1:${HEADER_ROW}` },
  });
  sheet.columns = columns.map(({ width }) => ({ width }));
  metadata.forEach((value, index) => {
    sheet.mergeCells(index + 1, 1, index + 1, columns.length);
    const cell = sheet.getCell(index + 1, 1);
    cell.value = literal(value);
    cell.font = { name: '맑은 고딕', size: index === 0 ? 16 : 10, bold: index === 0, color: { argb: index === 0 ? BLUE : 'FF475569' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    sheet.getRow(index + 1).height = index === 0 ? 30 : 28;
  });
  const header = sheet.getRow(HEADER_ROW);
  header.values = columns.map(({ label }) => label);
  header.height = 32;
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
    cell.font = { name: '맑은 고딕', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  data.forEach(({ values, zeroNet }, index) => {
    const row = sheet.addRow(values.map(literal));
    row.height = Math.max(26, Math.min(132, Math.ceil(Math.max(...values.map((value, c) => String(value ?? '').length / Math.max(8, columns[c].width * 0.65)))) * 16));
    row.eachCell({ includeEmpty: true }, (cell, c) => {
      cell.font = { name: '맑은 고딕', size: 10, color: { argb: 'FF0F172A' } };
      cell.alignment = { vertical: 'middle', wrapText: true, horizontal: columns[c - 1]?.numeric ? 'right' : 'left' };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFDCE6F1' } } };
      if (zeroNet || index % 2 === 1) cell.fill = {
        type: 'pattern', pattern: 'solid', fgColor: { argb: zeroNet ? ZERO_NET_GREEN : 'FFF0F6FC' },
      };
      if (columns[c - 1]?.numeric) {
        // The compact default rounds tiny nonzero values to a displayed zero.
        // Scientific display preserves their nonzero meaning without changing values.
        cell.numFmt = typeof cell.value === 'number' && cell.value !== 0 && Math.abs(cell.value) < 0.001
          ? SMALL_QUANTITY_FORMAT : QUANTITY_FORMAT;
      }
      if (cell.value === '확인 필요') {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE9C5' } };
        cell.font = { ...cell.font, bold: true, color: { argb: 'FF9A3412' } };
      }
    });
    if (zeroNet) {
      const total = row.getCell(columns.length);
      total.note = '차수별 조정 합계 0: 유효한 조정 이력이 있으며 선택한 차수 전체의 순조정이 정확히 0입니다.';
      total.font = { ...total.font, bold: true, color: { argb: 'FF25633D' } };
    }
  });
  sheet.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: Math.max(HEADER_ROW, sheet.rowCount), column: columns.length } };
  return sheet;
}

const col = (label, width = 14, numeric = false) => ({ label, width, numeric });

export async function buildStockAdjustmentMatrixWorkbook(matrix) {
  if (!matrix?.orderYear || !Array.isArray(matrix.rows) || !Array.isArray(matrix.weeks)) {
    throw new Error('조회가 완료된 재고조정 자료가 필요합니다.');
  }
  const imported = await import('exceljs');
  const ExcelJS = imported.default || imported;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Nenovaweb';
  workbook.subject = `${matrix.orderYear}년 세부차수별 실제 재고조정`;
  const scope = `${matrix.orderYear}년 · 차수: ${matrix.major || '전체'} · 검색: ${matrix.search || '전체'}`;
  const source = '출처: StockHistory · CodeInfo(StockType) · Product / 실제 조정 = AfterValue − BeforeValue';
  const isZeroNet = (row) => row.eventCount > 0 && row.invalidCount === 0 && row.net === 0;
  addSheet(workbook, '세부차수별 실제 조정', [
    col('품목번호', 14), col('품명', 38), col('단위', 12),
    ...matrix.weeks.map((week) => col(week.label, week.key.includes(':') ? 25 : 13, true)), col('순조정', 16, true),
  ], [
    '세부차수별 실제 재고조정', scope, source,
    '빈칸 = 이력 없음 · 0 = 실제 순조정 0 · 확인 필요 = 수량 누락/오류 · 미소 수량은 지수 표기 · 연한 초록 행 = 차수별 조정 합계 0',
    `원장 ${matrix.eventCount}건 · 수량 확인 필요 ${matrix.invalidCount}건 · 품목 ${matrix.rows.length}행 · 차수별 조정 합계 0: ${matrix.rows.filter(isZeroNet).length}행 · 단위 혼합 전체합계 없음`,
  ], matrix.rows.map((row) => ({
    zeroNet: isZeroNet(row),
    values: [
      row.prodKey, row.productName, row.unit,
      ...matrix.weeks.map(({ key }) => !row.cells[key] ? null : row.cells[key].quantity == null ? '확인 필요' : row.cells[key].quantity),
      row.net == null ? '확인 필요' : row.net,
    ],
  })));
  return workbook;
}
