import XLSX from 'xlsx';

const MAX_ROWS = 5000;
const MAX_SHEETS = 20;
const MAX_COLUMNS = 128;
const MAX_CELLS = 250_000;

function cellAddress(row, col) {
  return XLSX.utils.encode_cell({ r: row, c: col });
}

function displayValue(cell) {
  if (!cell) return '';
  if (cell.f) return `=${cell.f}`;
  if (cell.v instanceof Date) return cell.v.toISOString().slice(0, 10);
  return cell.w ?? (cell.v == null ? '' : String(cell.v));
}

function isSectionTitle(value) {
  const text = String(value || '').replace(/\s+/g, '');
  return /^(카네이션|장미|수국|알스트로메리아|호주|중국)/.test(text);
}

function canonicalSectionTitle(value) {
  const text = String(value || '').replace(/\s+/g, '');
  return text.match(/^(카네이션|장미|수국|알스트로메리아|호주|중국)/)?.[1] || String(value || '').trim();
}

function classifyHeader(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (/발주수량\s*\(?박스\)?|총\s*발주\s*수량|총량/.test(text)) return 'order-total-box-candidate';
  if (/발주수량\s*\(?단\)?/.test(text)) return 'order-total-bunch-candidate';
  if (/선출고|기출고/.test(text)) return 'pre-shipment-candidate';
  if (/출고\s*예정|출고예정/.test(text) && /월|화|수|목|금|토|일|\d{1,2}\s*일/.test(text)) return 'date-quantity-candidate';
  if (/사용|비고|메모/.test(text)) return 'note-candidate';
  return '';
}

function parseCellKind(cell, raw) {
  if (cell?.f) return { kind: 'formula-review', numericCandidate: null, reason: '수식은 업로드 시 재계산하지 않습니다.' };
  if (raw === '') return { kind: 'blank', numericCandidate: null, reason: '' };
  if (typeof cell?.v === 'number' && Number.isFinite(cell.v)) {
    return { kind: 'numeric-candidate', numericCandidate: cell.v, reason: '순수 숫자 후보이며 단위/세부차수 확인이 필요합니다.' };
  }
  const numericText = String(cell?.v ?? raw).trim().replace(/,/g, '');
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(numericText)) {
    return { kind: 'numeric-candidate', numericCandidate: Number(numericText), reason: '숫자 텍스트 후보이며 단위/세부차수 확인이 필요합니다.' };
  }
  return { kind: 'text-review', numericCandidate: null, reason: '문자/복합수량은 자동 변환하지 않습니다.' };
}

export function parseWeekdayEstimateWorkbook(input, options = {}) {
  const workbook = input?.SheetNames && input?.Sheets
    ? input
    : XLSX.read(input, { type: Buffer.isBuffer(input) ? 'buffer' : 'array', cellDates: true, cellFormula: true, cellNF: true, cellStyles: false });
  if (!workbook.SheetNames?.length || workbook.SheetNames.length > MAX_SHEETS) {
    throw new Error(`시트 수가 올바르지 않습니다. (1~${MAX_SHEETS}개)`);
  }

  const sheets = workbook.SheetNames.map((sheetName) => {
    const ws = workbook.Sheets[sheetName];
    const ref = ws?.['!ref'];
    if (!ref) return { name: sheetName, range: '', merges: [], title: '', headers: [], rows: [] };
    const range = XLSX.utils.decode_range(ref);
    if (range.e.r - range.s.r + 1 > MAX_ROWS) throw new Error(`${sheetName}: 행이 ${MAX_ROWS}개를 초과합니다.`);
    if (range.e.c - range.s.c + 1 > MAX_COLUMNS || (range.e.r - range.s.r + 1) * (range.e.c - range.s.c + 1) > MAX_CELLS) {
      throw new Error(`${sheetName}: 시트 크기가 분석 한도를 초과합니다.`);
    }
    const merges = (ws['!merges'] || []).map((m) => XLSX.utils.encode_range(m));
    const title = displayValue(ws[cellAddress(0, 0)]);
    const sectionMarkers = [];
    for (let r = range.s.r; r <= range.e.r; r += 1) {
      for (let c = range.s.c; c <= Math.min(range.e.c, 5); c += 1) {
        const value = displayValue(ws[cellAddress(r, c)]);
        if (isSectionTitle(value)) {
          sectionMarkers.push({ row: r + 1, value: canonicalSectionTitle(value), column: cellAddress(r, c) });
          break;
        }
      }
    }

    const headers = [];
    for (let r = range.s.r; r <= range.e.r; r += 1) {
      // A memo such as '수요일 사용' beside a real item is not a new header row.
      const rowTexts = [];
      for (let c = range.s.c; c <= range.e.c; c += 1) rowTexts.push(displayValue(ws[cellAddress(r,c)]));
      const isQuantityHeader = rowTexts.some((raw) => ['order-total-box-candidate', 'order-total-bunch-candidate', 'pre-shipment-candidate', 'date-quantity-candidate'].includes(classifyHeader(raw)));
      if (!isQuantityHeader) continue;
      for (let c = range.s.c; c <= range.e.c; c += 1) {
        const cell = ws[cellAddress(r, c)];
        const raw = displayValue(cell);
        const role = classifyHeader(raw);
        if (role) headers.push({ row: r + 1, column: XLSX.utils.encode_col(c), address: cellAddress(r, c), raw, role });
      }
    }

    const headerRows = new Set(headers.map((header) => header.row));
    const headerByColumn = new Map();
    const headersByRow = new Map();
    for (const header of headers) {
      const current = headersByRow.get(header.row) || [];
      current.push(header);
      headersByRow.set(header.row, current);
    }
    const rows = [];
    for (let r = range.s.r; r <= range.e.r; r += 1) {
      for (const header of headersByRow.get(r + 1) || []) headerByColumn.set(header.column, header);
      const cells = [];
      let hasValue = false;
      for (let c = range.s.c; c <= range.e.c; c += 1) {
        const cell = ws[cellAddress(r, c)];
        const raw = displayValue(cell);
        if (raw !== '') hasValue = true;
        if (raw === '' && !cell?.f) continue;
        const parsed = parseCellKind(cell, raw);
        cells.push({
          address: cellAddress(r, c),
          column: XLSX.utils.encode_col(c),
          raw,
          formula: cell?.f || null,
          ...parsed,
          headerRole: headerByColumn.get(XLSX.utils.encode_col(c))?.role || '',
          columnHeader: headerByColumn.get(XLSX.utils.encode_col(c))?.raw || '',
        });
      }
      if (!hasValue) continue;
      const values = cells.map((c) => c.raw);
      const productCell = cells.find((cell) => cell.column === 'B' && cell.kind === 'text-review' && !classifyHeader(cell.raw));
      const label = productCell?.raw || values.find((v) => v && !/^-?\d+(?:[,.]\d+)*$/.test(v) && !v.startsWith('=')) || '';
      rows.push({ row: r + 1, label, section: '', isHeaderRow: headerRows.has(r + 1), cells });
    }

    sectionMarkers.forEach((marker, index) => {
      const start = marker.row;
      const end = sectionMarkers[index + 1]?.row ?? (range.e.r + 2);
      for (const row of rows) if (row.row >= start && row.row < end) row.section = marker.value;
    });

    return {
      name: sheetName,
      range: ref,
      merges,
      title,
      sectionMarkers,
      headers,
      headerRows: [...headerRows],
      rows,
      reviewCount: rows.reduce((n, row) => n + row.cells.filter((c) => c.kind.endsWith('-review')).length, 0),
    };
  });

  return {
    source: { fileName: String(options.fileName || ''), sheetCount: sheets.length, parser: 'weekday-estimate-v1' },
    safety: { persisted: false, erpWritten: false, formulaRecalculated: false, autoMatched: false },
    sheets,
  };
}

export function parseWeekdayEstimateBuffer(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer)) throw new Error('엑셀 파일 바이트가 필요합니다.');
  return parseWeekdayEstimateWorkbook(buffer, options);
}
