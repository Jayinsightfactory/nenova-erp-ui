const FIXED_HEADER_ROW_INDEX = 4;
const FIRST_DETAIL_ROW_INDEX = 5;

const REQUIRED_HEADERS = new Map([
  [0, 'COD'],
  [1, 'VARIETYNAME'],
  [4, 'SIZE'],
  [5, 'BOX'],
  [8, 'TOTAL\nBUNCH'],
  [9, 'TOTALSTEAM'],
  [11, 'T.PRICE'],
]);

function text(value) {
  return value == null ? '' : String(value).trim();
}

function normalizedHeader(value) {
  return text(value).toUpperCase().replace(/ /g, '');
}

function number(value, rowNumber, label) {
  if (value == null || text(value) === '') return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${rowNumber}행 ${label} 값이 숫자가 아닙니다.`);
  }
  return parsed;
}

function excelDateText(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  return text(value);
}

export function assertWarehousePackingLayout(grid) {
  const header = grid?.[FIXED_HEADER_ROW_INDEX] || [];
  for (const [column, expected] of REQUIRED_HEADERS) {
    const actual = normalizedHeader(header[column]);
    if (actual !== expected) {
      throw new Error(`파킹리스트 5행 ${column + 1}열은 ${expected}이어야 합니다. (현재: ${actual || '빈 값'})`);
    }
  }
  return true;
}

export function parseWarehousePackingGrid(grid) {
  if (!Array.isArray(grid) || grid.length <= FIRST_DETAIL_ROW_INDEX) {
    throw new Error('정상적인 파킹리스트 업로드 파일이 아닙니다.');
  }
  assertWarehousePackingLayout(grid);

  const inputDate = excelDateText(grid[2]?.[6]);
  const parsedDate = inputDate ? new Date(inputDate.replace(/\//g, '-')) : null;
  const meta = {
    farmName: text(grid[1]?.[2]),
    orderWeek: text(grid[1]?.[6]),
    invoiceNo: text(grid[1]?.[10]),
    awb: text(grid[2]?.[2]),
    orderNo: text(grid[2]?.[2]),
    inputDate,
    orderYear: parsedDate && Number.isFinite(parsedDate.getTime())
      ? String(parsedDate.getFullYear())
      : '',
  };

  const rows = [];
  for (let index = FIRST_DETAIL_ROW_INDEX; index < grid.length; index += 1) {
    const source = grid[index] || [];
    const varietyName = text(source[1]);
    const hasNoQuantity = [5, 8, 9].every((column) => text(source[column]) === '');
    if (hasNoQuantity) continue;
    if (text(source[0]) === 'TOTAL' || !varietyName) break;

    const size = text(source[4]);
    rows.push({
      prodName: size ? `${varietyName} ${size}` : varietyName,
      orderCode: text(source[0]),
      boxQty: number(source[5], index + 1, 'BOX'),
      steamOf1Bunch: number(source[6], index + 1, 'STEAM/BUNCH'),
      steamOf1Box: number(source[7], index + 1, 'STEAM/BOX'),
      bunchQty: number(source[8], index + 1, 'TOTAL BUNCH'),
      steamQty: number(source[9], index + 1, 'TOTALSTEAM'),
      unitPrice: number(source[10], index + 1, 'U.PRICE'),
      totalPrice: number(source[11], index + 1, 'T.PRICE'),
    });
  }

  if (!rows.length) throw new Error('정상적인 파킹리스트 업로드 파일이 아닙니다.');
  return { meta, rows };
}

export function parseWarehousePackingWorkbook(buffer, XLSX) {
  if (!XLSX?.read || !XLSX?.utils?.sheet_to_json) {
    throw new Error('XLSX 라이브러리가 로드되지 않았습니다.');
  }
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  const firstSheetName = workbook?.SheetNames?.[0];
  if (!firstSheetName) throw new Error('엑셀 파일에 시트가 없습니다.');
  const grid = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], {
    header: 1,
    defval: '',
    raw: true,
  });
  return parseWarehousePackingGrid(grid);
}

export function normalizeExactProductName(value) {
  return text(value).toLocaleLowerCase();
}

export function prepareExactProductMatches(rows, products) {
  const productIndex = new Map();
  for (const product of products || []) {
    if (Number(product?.isDeleted || 0) !== 0) continue;
    const key = normalizeExactProductName(product?.ProdName ?? product?.prodName);
    if (!key) continue;
    const matches = productIndex.get(key) || [];
    matches.push(product);
    productIndex.set(key, matches);
  }

  const matched = [];
  const errors = [];
  for (const [index, row] of (rows || []).entries()) {
    const candidates = productIndex.get(normalizeExactProductName(row.prodName)) || [];
    if (candidates.length !== 1) {
      errors.push({
        row: index + FIRST_DETAIL_ROW_INDEX + 1,
        prodName: row.prodName,
        reason: candidates.length === 0 ? 'UNREGISTERED_PRODUCT' : 'AMBIGUOUS_PRODUCT',
      });
      continue;
    }
    matched.push({ ...row, prodKey: Number(candidates[0].ProdKey ?? candidates[0].prodKey) });
  }

  return {
    ok: errors.length === 0 && matched.length === (rows || []).length,
    items: errors.length === 0 ? matched : [],
    errors,
  };
}

export function decideWarehousePackingImport({ rows, products, orderYear, orderWeek }) {
  if (!/^\d{4}$/.test(String(orderYear || '')) || !text(orderWeek)) {
    return { ok: false, items: [], errors: [{ reason: 'YEAR_WEEK_REQUIRED' }] };
  }
  const result = prepareExactProductMatches(rows, products);
  return { ...result, orderYear: String(orderYear), orderWeek: text(orderWeek) };
}

export const WAREHOUSE_PACKING_LAYOUT = Object.freeze({
  fixedHeaderRowIndex: FIXED_HEADER_ROW_INDEX,
  firstDetailRowIndex: FIRST_DETAIL_ROW_INDEX,
  requiredHeaders: Object.freeze(Object.fromEntries(REQUIRED_HEADERS)),
});
