// Read-only baseline parser for the supplied distribution workbook format.
const columnName = n => {
  let out = '';
  for (let v = n + 1; v; v = Math.floor((v - 1) / 26)) out = String.fromCharCode(65 + ((v - 1) % 26)) + out;
  return out;
};
const cell = (sheet, row, col) => sheet[`${columnName(col)}${row}`];
const raw = (sheet, row, col) => cell(sheet, row, col)?.v ?? null;
const text = value => typeof value === 'string' ? value.trim() : String(value ?? '').trim();

function rangeEnd(sheet) {
  const match = String(sheet['!ref'] || 'A1').match(/:([A-Z]+)(\d+)$/i) || String(sheet['!ref'] || 'A1').match(/^([A-Z]+)(\d+)$/i);
  if (!match) throw new Error('유효하지 않은 시트 범위입니다.');
  let col = 0;
  for (const ch of match[1].toUpperCase()) col = col * 26 + ch.charCodeAt(0) - 64;
  return { cols: col, rows: Number(match[2]) };
}

function parseKeymap(workbook) {
  const sheet = workbook.Sheets?._keymap;
  const map = new Map();
  if (!sheet) return map;
  const { rows } = rangeEnd(sheet);
  for (let row = 2; row <= rows; row += 1) {
    const type = text(raw(sheet, row, 0));
    const name = raw(sheet, row, 1);
    const label = raw(sheet, row, 2);
    const key = raw(sheet, row, 3);
    if ((type === 'cust' || type === 'prod') && typeof name === 'string' && (typeof label === 'string' || typeof label === 'number') && key !== null) {
      map.set(`${type}|${name}|${String(label)}`, key);
    }
  }
  return map;
}

function titleScope(value) {
  const title = text(value);
  const week = title.match(/차수\s*\(\s*(\d{2})\s*-?\s*(\d{2})\s*\)/);
  if (!week || !/품종\s*\(/.test(title)) throw new Error('A1 제목에서 차수와 품종을 찾을 수 없습니다.');
  const year = title.match(/(?:^|\D)(20\d{2})(?:\D|$)/)?.[1] || null;
  return { week: `${week[1]}-${week[2]}`, year };
}

/** Returns true only for a full selected scope such as "2026-37-01". */
function validateSelectedScope(baseline, selectedScope) {
  return Boolean(baseline && Array.isArray(baseline.sheets)
    && selectedScope === `${baseline.year}-${baseline.week}`);
}

function parseDistributionBaseline(workbook, { year, week, fileName = '' } = {}) {
  if (!workbook?.SheetNames || !workbook?.Sheets) throw new Error('워크북이 필요합니다.');
  if (!/^20\d{2}$/.test(String(year ?? ''))) throw new Error('연도가 필요합니다.');
  if (!/^\d{2}-\d{2}$/.test(String(week ?? ''))) throw new Error('차수 형식이 올바르지 않습니다.');
  const scope = { year: String(year), week: String(week) };
  const names = workbook.SheetNames.filter(name => name !== '_keymap');
  if (!names.length) throw new Error('표시할 분배 시트가 없습니다.');
  const keymap = parseKeymap(workbook), issues = [], sheets = [];
  let combinedUnknown = /(?:^|[-_\s])02(?:\D|$)/.test(String(fileName));
  for (const name of names) {
    const sheet = workbook.Sheets[name];
    if (!sheet) throw new Error(`${name} 시트를 찾을 수 없습니다.`);
    const size = rangeEnd(sheet);
    if (size.rows > 300 || size.cols > 150) throw new Error(`${name}: 안전 한도(300행/150열)를 초과했습니다.`);
    const found = titleScope(raw(sheet, 1, 0));
    if (found.week !== scope.week) throw new Error(`${name}: 선택 차수와 다른 차수입니다.`);
    if (found.year && found.year !== scope.year) throw new Error(`${name}: 선택 연도와 다른 연도입니다.`);
    if (found.week.endsWith('-02')) combinedUnknown = true;
    const headers = Array.from({ length: size.cols }, (_, col) => text(raw(sheet, 3, col)));
    const orderCol = headers.findIndex(header => header === '주문');
    const incomingCol = headers.findIndex((header, col) => col > orderCol && header === '입고');
    const remainingCol = headers.findIndex((header, col) => col > orderCol && (header === '잔량' || header === '재고잔량' || header === '입고재고잔량'));
    if (orderCol < 1 || incomingCol < 0 || remainingCol < 0) throw new Error(`${name}: 주문·입고·잔량 요약 헤더가 필요합니다.`);
    const productHeader = headers[0];
    const clients = [];
    for (let col = 1; col < orderCol; col += 1) {
      const label = headers[col];
      if (!label || label === productHeader || label.length > 35) continue;
      // Worker sheets repeat the product column between customer blocks, sometimes under a note.
      const productSamples = Array.from({ length: Math.min(size.rows - 3, 8) }, (_, i) => i + 4)
        .filter(row => text(raw(sheet, row, 0)));
      if (productSamples.length >= 3 && productSamples.every(row => text(raw(sheet, row, col)) === text(raw(sheet, row, 0)))) continue;
      clients.push({ id: `${name}!${columnName(col)}3`, col: columnName(col), label, day: raw(sheet, 2, col), key: keymap.get(`cust|${name}|${label}`) ?? null });
    }
    const rows = [];
    for (let row = 4; row <= size.rows; row += 1) {
      const labelValue = raw(sheet, row, 0), label = text(labelValue);
      if (!label || label === '합계') continue;
      const values = {};
      for (const client of clients) {
        const col = client.col.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
        const value = raw(sheet, row, col);
        values[client.id] = value;
        if (typeof value === 'string' && value.trim()) issues.push({ code: 'UNKNOWN_QUANTITY', sheet: name, cell: `${client.col}${row}`, message: '수량이 숫자가 아닌 텍스트입니다.' });
        if (cell(sheet, row, col)?.f && cell(sheet, row, col)?.v === undefined) issues.push({ code: 'UNKNOWN_QUANTITY', sheet: name, cell: `${client.col}${row}`, message: '수식 캐시값이 없습니다.' });
      }
      rows.push({ id: `${name}!A${row}`, label: labelValue, key: keymap.get(`prod|${name}|${String(labelValue)}`) ?? null, values, remaining: raw(sheet, row, remainingCol) });
    }
    sheets.push({ id: name, name, clients, rows, issues: issues.filter(issue => issue.sheet === name) });
  }
  return { ...scope, sheets, issues, combinedUnknown };
}

module.exports = { parseDistributionBaseline, validateSelectedScope };
