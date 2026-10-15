// Runtime XLSX export of the exact read-only matrix and the existing year residual.
const HEADER_ROW = 6;
const QUANTITY_FORMAT = '+0.###;-0.###;0';
const SMALL_QUANTITY_FORMAT = '+0.##############E+00;-0.##############E+00;0';
const BLUE = 'FF164E87';

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
  data.forEach((values, index) => {
    const row = sheet.addRow(values.map(literal));
    row.height = Math.max(26, Math.min(132, Math.ceil(Math.max(...values.map((value, c) => String(value ?? '').length / Math.max(8, columns[c].width * 0.65)))) * 16));
    row.eachCell({ includeEmpty: true }, (cell, c) => {
      cell.font = { name: '맑은 고딕', size: 10, color: { argb: 'FF0F172A' } };
      cell.alignment = { vertical: 'middle', wrapText: true, horizontal: columns[c - 1]?.numeric ? 'right' : 'left' };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFDCE6F1' } } };
      if (index % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F6FC' } };
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
  });
  sheet.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: Math.max(HEADER_ROW, sheet.rowCount), column: columns.length } };
  return sheet;
}

const col = (label, width = 14, numeric = false) => ({ label, width, numeric });

export async function buildStockAdjustmentMatrixWorkbook(matrix, flowRows = []) {
  if (!matrix?.orderYear || !Array.isArray(matrix.rows) || !Array.isArray(matrix.weeks) || !Array.isArray(matrix.events)) {
    throw new Error('조회가 완료된 재고조정 자료가 필요합니다.');
  }
  const imported = await import('exceljs');
  const ExcelJS = imported.default || imported;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Nenovaweb';
  workbook.subject = `${matrix.orderYear}년 재고조정 실제 이력과 기존 대차수 흐름차이`;
  const scope = `${matrix.orderYear}년 · 차수: ${matrix.major || '전체'} · 검색: ${matrix.search || '전체'}`;
  const source = '출처: StockHistory · CodeInfo(StockType) · Product / 실제 조정 = AfterValue − BeforeValue';
  addSheet(workbook, '세부차수별 실제 조정', [
    col('품목번호', 14), col('품명', 38), col('국가', 16), col('품종', 18), col('단위', 12),
    ...matrix.weeks.map((week) => col(week.label, week.key.includes(':') ? 25 : 13, true)), col('순조정', 16, true),
  ], [
    '세부차수별 실제 재고조정', scope, source,
    '빈칸 = 이력 없음 · 0 = 실제 순조정 0 · 확인 필요 = 수량 누락/오류 포함 · 미소 수량은 지수 표기 · 단위 혼합 전체합계 없음',
    `원장 ${matrix.eventCount}건 · 수량 확인 필요 ${matrix.invalidCount}건 · 품목 ${matrix.rows.length}행`,
  ], matrix.rows.map((row) => [
    row.prodKey, row.productName, row.country, row.flower, row.unit,
    ...matrix.weeks.map(({ key }) => !row.cells[key] ? null : row.cells[key].quantity == null ? '확인 필요' : row.cells[key].quantity),
    row.net == null ? '확인 필요' : row.net,
  ]));
  addSheet(workbook, '실제 조정 원이력', [
    col('이력번호', 15), col('연도', 10), col('원본 차수', 20), col('열 구분', 27),
    col('품목번호', 14), col('품명', 38), col('국가', 16), col('품종', 18), col('단위', 12),
    col('변경 전 원본값', 18, true), col('변경 후 원본값', 18, true), col('실제 조정', 16, true),
    col('변경유형', 18), col('사유', 45), col('변경일시', 25), col('작업자', 18),
  ], [
    '실제 재고조정 원이력', scope, source,
    '변경 전/후 원본값과 원본 차수를 보존합니다. 확인 필요인 이력은 합계에서 정상 수량으로 취급하지 않습니다.',
    `원장 ${matrix.eventCount}건 · 수량 확인 필요 ${matrix.invalidCount}건`,
  ], matrix.events.map((event) => [
    event.historyKey, event.orderYear, event.rawOrderWeek, event.weekLabel, event.prodKey,
    event.productName, event.country, event.flower, event.unit,
    event.beforeValue, event.afterValue, event.delta == null ? '확인 필요' : event.delta,
    event.changeType, event.reason, event.changedAt, event.changedBy,
  ]), 2);
  // Existing annual residual arrives already calculated by its original loader.
  // It lacks complete metadata for an equivalent search, so preserve the full year.
  const selectedYearFlow = (Array.isArray(flowRows) ? flowRows : []).filter((row) => row.orderYear == null || String(row.orderYear) === String(matrix.orderYear));
  addSheet(workbook, '기존 대차수 흐름차이', [
    col('대차수', 12), col('품목번호', 14), col('품명', 38), col('카테고리', 18),
    col('기초', 16, true), col('입고', 16, true), col('출고', 16, true),
    col('흐름값', 16, true), col('스냅샷', 16, true), col('흐름차이', 16, true),
    col('음수 흐름', 14),
  ], [
    '기존 대차수 흐름차이',
    `${matrix.orderYear}년 · 선택 연도 전체 · 차수/검색 필터 미적용 · 실제 수정 이력과 다른 계산값`,
    '출처: 기존 연간 대차수 분석 결과 · 흐름차이 = 기말 스냅샷 − (기초 + 입고 − 출고)',
    '기존 계산값을 그대로 보존하며 세부차수로 나누지 않습니다. 실제 조정 원이력과 동일한 값으로 해석하지 않습니다.',
    `기존 분석 ${selectedYearFlow.length}행 · 단위 혼합 전체합계 없음`,
  ], selectedYearFlow.map((row) => [
    row.major, row.prodKey, row.productName, row.category,
    row.begin, row.arrivals, row.shipments, row.impliedEnd, row.snapshotEnd, row.adjustment,
    row.negativeFlow == null ? null : row.negativeFlow ? '예' : '아니오',
  ]));
  return workbook;
}
