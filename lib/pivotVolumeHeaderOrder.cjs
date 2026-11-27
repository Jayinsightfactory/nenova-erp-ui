const WEEKDAY_TOKEN_RE = /^(?:[월화수목금토일](?:요일)?|미지정|요일미지정)$/;
const VOLUME_TITLE_RE = /차수|품종|카네이션|장미|수국|알스트로|루스커스|\d{2,4}[-－]/;
const NON_CUSTOMER_HEADERS = new Set([
  '꽃', '품목명', '칼라', '컬러', '색상', '품종', '박스(자동)',
  '주문', '입고', '재고', '잔량', '재고잔량', '입고재고잔량',
]);

function cleanText(value) {
  return String(value ?? '').trim();
}

function sheetJsCellText(sheet, row1Based, col1Based) {
  if (!sheet || row1Based < 1 || col1Based < 1) return '';
  let colName = '';
  for (let v = col1Based; v > 0; v = Math.floor((v - 1) / 26)) {
    colName = String.fromCharCode(65 + ((v - 1) % 26)) + colName;
  }
  return cleanText(sheet[`${colName}${row1Based}`]?.v);
}

function hasKeymapDayMeta(workbook, sheetName) {
  const keymap = workbook?.Sheets?._keymap;
  if (!keymap || !sheetName) return false;
  const ref = String(keymap['!ref'] || 'A1');
  const endMatch = ref.match(/:[A-Z]+(\d+)$/i) || ref.match(/^[A-Z]+(\d+)$/i);
  const maxRow = endMatch ? Number(endMatch[1]) : 1;
  for (let r = 2; r <= maxRow; r += 1) {
    const type = sheetJsCellText(keymap, r, 1).toLowerCase();
    const name = sheetJsCellText(keymap, r, 2);
    const label = sheetJsCellText(keymap, r, 3).toLowerCase();
    const key = sheetJsCellText(keymap, r, 4).toLowerCase();
    if (type === 'meta' && name === sheetName && label === 'groupby' && key === 'day') {
      return true;
    }
  }
  return false;
}

function isVolumeTitleText(text) {
  return VOLUME_TITLE_RE.test(cleanText(text));
}

function detectVolumeHeaderOrder({ workbook = null, sheetName = '', headerRow = 3, summaryStartCol = 1, getCellText }) {
  if (hasKeymapDayMeta(workbook, sheetName)) return 'day';
  if (headerRow < 3 || typeof getCellText !== 'function') return 'region';

  const customerCols = [];
  for (let c = 2; c < summaryStartCol; c += 1) {
    const header = cleanText(getCellText(headerRow, c));
    if (!header || NON_CUSTOMER_HEADERS.has(header)) continue;
    customerCols.push(c);
  }
  if (!customerCols.length) return 'region';

  const row1Tokens = customerCols.map(c => cleanText(getCellText(headerRow - 2, c))).filter(Boolean);
  const row2Tokens = customerCols.map(c => cleanText(getCellText(headerRow - 1, c))).filter(Boolean);

  if (
    row1Tokens.length > 0
    && row1Tokens.every(token => WEEKDAY_TOKEN_RE.test(token))
    && (row2Tokens.length === 0 || row2Tokens.some(token => !WEEKDAY_TOKEN_RE.test(token)))
  ) {
    return 'day';
  }
  return 'region';
}

function detectSheetJsHeaderOrder(workbook, sheetName, headerRow1Based, summaryStartCol1Based) {
  const sheet = workbook?.Sheets?.[sheetName];
  if (!sheet) return 'region';
  return detectVolumeHeaderOrder({
    workbook,
    sheetName,
    headerRow: headerRow1Based,
    summaryStartCol: summaryStartCol1Based,
    getCellText: (r, c) => sheetJsCellText(sheet, r, c),
  });
}

function readLeftCarryCell({ row, col, minCol = 2, getCellText, skipTitle = false }) {
  if (row < 1 || col < minCol || typeof getCellText !== 'function') return { col: 0, text: '' };
  for (let c = col; c >= minCol; c -= 1) {
    const text = cleanText(getCellText(row, c));
    if (!text) continue;
    if (skipTitle && isVolumeTitleText(text)) continue;
    return { col: c, text };
  }
  return { col: 0, text: '' };
}

function resolveColumnDayAndRegion({ order, headerRow, col, minCol = 2, getCellText }) {
  if (headerRow < 3) return { day: '', dayCol: col, region: '', regionCol: col };
  if (order === 'day') {
    const dayHit = readLeftCarryCell({ row: headerRow - 2, col, minCol, getCellText, skipTitle: true });
    const regionHit = readLeftCarryCell({ row: headerRow - 1, col, minCol, getCellText, skipTitle: false });
    return {
      day: dayHit.text,
      dayCol: dayHit.col || col,
      region: regionHit.text,
      regionCol: regionHit.col || col,
    };
  }
  const regionHit = readLeftCarryCell({ row: headerRow - 2, col, minCol, getCellText, skipTitle: true });
  return {
    day: cleanText(getCellText(headerRow - 1, col)),
    dayCol: col,
    region: regionHit.text,
    regionCol: regionHit.col || col,
  };
}

module.exports = {
  WEEKDAY_TOKEN_RE,
  hasKeymapDayMeta,
  isVolumeTitleText,
  detectVolumeHeaderOrder,
  detectSheetJsHeaderOrder,
  readLeftCarryCell,
  resolveColumnDayAndRegion,
};
