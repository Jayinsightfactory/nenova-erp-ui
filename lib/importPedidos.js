import XLSX from 'xlsx-js-style';

// Static port of pedidoshome.py. No Python execution, server calls or ERP writes.
export const PEDIDOS_COUNTRIES = ['Colombia', 'Netherlands', 'Ecuador', 'Australia', 'Thailand', 'China', 'Vietnam'];
const PALETTES = {
  Colombia: ['1F4E79', '2E75B6', 'D6E4F0', 'BDD7EE', 'B4C7E7'],
  Netherlands: ['B85C00', 'E97132', 'FCE5CD', 'FFE0B2', 'F0B080'],
  Australia: ['385723', '6AA84F', 'D9EAD3', 'C9E1BC', '9EBF87'],
  Thailand: ['5B2C6F', '8E44AD', 'E8D5F2', 'DCC2EA', 'C7A8DA'],
  Ecuador: ['7F6000', 'BF9000', 'FFF2CC', 'FFE99B', 'D6B656'],
  Vietnam: ['134F5C', '45818E', 'CFE2E5', 'B6D3D7', '9CBFC5'],
  China: ['660000', 'A6322B', 'EFC2BE', 'E8AAA3', 'D9877E'],
};
const BOXES = {
  'Fern Umbrella': 50, 'Fern Sea Star': 50, 'Steel Grass': 120,
  Stenocarpus: 25, 'Emu Grass': 50, 'Emu Feather': 100, 'Banker Bush': 25,
  'Koala Fern': 50, 'Goanna Claw': 50, 'Copper Glow': 30, 'Fern Rainbow': 50,
  'Wolly Bush Green Tip': 30, 'Woolly Bush Red Tip': 30, 'Dingo Fern': 50,
};
const COL = {
  '장미': ['Rosas', ['Total', 'Tallos'], ['B{r}+C{r}', 'D{r}*10']],
  '카네이션': ['Clavel', ['Cajas Total'], ['B{r}+C{r}']],
  '알스트로': ['Alstromeria', ['Total', 'Cajas'], ['B{r}+C{r}', 'D{r}/16']],
  '루스커스': ['Ruscus', ['Pedido final'], ['B{r}+C{r}']],
  '수국': ['Hortensias', ['Pedido final'], ['B{r}+C{r}']],
};
const COL_WORDS = ['Hydrangea', 'ROSE', 'CARNATION', 'ALSTROMERIA', 'Ruscus', 'MiniCarn', 'SPRAY'];
const NL_WORDS = ['tulip', 'allium', 'astilbe', 'anthurium', 'agapanthus', 'eryngium', 'hyacinth', 'skimmia', 'campanula', 'lily', 'matricaria', 'cordyline', 'convallaria', 'amaryllis', 'cymbidium', 'sanguisorba', 'protea', 'nutan', 'asparagus'];
const NL_CATS = ['깜바눌라', '장미', '기타', '마트리카리아', '백합', '스키미아', '아가판서스', '아스틸베', '안시리움', '알륨', '에린지움', '튤립', '히아신스', '오이초', '은방울꽃', '심비디움', '아마릴리스', '아란', '프로테아'];
const HEADERS = new Set(['품목명(색상)', '변경수량', '주문주차', '국가', '단위', '입력일자', 'C.N.', '거래처명', '꽃', 'Grand Total']);
const endsTotal = value => typeof value === 'string' && value.endsWith('Total');
const hasWord = (value, words) => Boolean(value) && words.some(word => String(value).includes(word));
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sum = values => values.reduce((a, b) => a + b, 0);
const address = (r, c) => XLSX.utils.encode_cell({ r, c });

export function sanitizePedidosWeek(week) {
  // Python Unicode \w = Unicode letters/numbers + underscore (not JS ASCII \w).
  const clean = String(week ?? '').trim().replace(/[^\p{L}\p{N}_-]/gu, '');
  if (!clean) throw new Error('차수를 입력하세요. 예: 34-1');
  return clean;
}

function zipText(zip, path) {
  const entry = XLSX.CFB.find(zip, `/${path}`);
  return entry ? new TextDecoder().decode(new Uint8Array(entry.content)) : null;
}

/** Read typed cells and retain OOXML activeTab, which SheetJS otherwise discards. */
export function readPedidosWorkbook(data) {
  const workbook = XLSX.read(data, { type: 'array', cellFormula: true, cellDates: false });
  const bytes = new Uint8Array(data);
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const xml = zipText(XLSX.CFB.read(bytes, { type: 'array' }), 'xl/workbook.xml');
    const active = xml?.match(/<(?:\w+:)?workbookView\b[^>]*\bactiveTab=["'](\d+)["']/);
    if (active) workbook.Workbook = { ...workbook.Workbook, Views: [{ activeTab: Number(active[1]) }] };
  }
  return workbook;
}

function source(workbook, preferredSheet) {
  const active = workbook?.Workbook?.Views?.[0]?.activeTab ?? workbook?.Workbook?.WBView?.[0]?.activeTab;
  const index = Number(active);
  const sheetName = preferredSheet ?? workbook?.SheetNames?.[Number.isInteger(index) && index >= 0 ? index : 0] ?? workbook?.SheetNames?.[0];
  const sheet = workbook?.Sheets?.[sheetName];
  if (!sheet) throw new Error('읽을 수 있는 Excel 시트가 없습니다.');
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  if (range.e.r > 200000 || range.e.c > 2000 || (range.e.r + 1) * (range.e.c + 1) > 2000000) throw new Error('시트 범위가 너무 큽니다. 필요한 데이터만 포함한 파일을 사용하세요.');
  // Preserve A1-relative positional semantics and physical blank rows.
  const rows = Array.from({ length: range.e.r + 1 }, (_, r) => Array.from({ length: range.e.c + 1 }, (_, c) => {
    const cell = sheet[address(r, c)];
    return cell?.t === 'e' ? undefined : cell?.v;
  }));
  const warnings = new Set();
  function numeric(r, c, allowBlank = true) {
    if (c == null) throw new Error(`${sheetName}: 수량 열을 찾지 못했습니다. 숫자 수량 열이 있는 원본 양식을 사용하세요.`);
    const cell = c == null ? undefined : sheet[address(r, c)];
    if (cell?.f && !(cell.t === 'n' && typeof cell.v === 'number' && Number.isFinite(cell.v))) {
      throw new Error(`${sheetName}!${address(r, c)}: 수식의 숫자 계산값이 없습니다. Excel에서 재계산 후 저장하여 다시 업로드하세요.`);
    }
    if (cell?.t === 'e') throw new Error(`${sheetName}!${address(r, c)}: 수량 셀에 Excel 오류가 있습니다.`);
    if (cell?.t === 'n' && typeof cell.v === 'number' && Number.isFinite(cell.v)) return cell.v;
    if (allowBlank && (cell?.v == null || cell.v === '') && cell?.t !== 'b') return 0;
    throw new Error(`${sheetName}!${address(r, c)}: 숫자형 수량이 필요합니다. 빈값·문자 수량 또는 수량(박스수) 표시값 대신 숫자 원본을 사용하세요.`);
  }
  function isNumeric(r, c) {
    const cell = sheet[address(r, c)];
    if (cell?.f) numeric(r, c); // Never hide a missing cache behind a fallback.
    return cell?.t === 'n' && typeof cell.v === 'number' && Number.isFinite(cell.v);
  }
  return { rows, numeric, isNumeric, sheetName, warnings };
}

function totalColumn(rows) {
  for (const row of rows.slice(0, 8)) {
    const col = row.indexOf('Grand Total');
    if (col >= 0) return col;
  }
  let col = null;
  for (const row of rows.slice(0, 8)) row.forEach((value, c) => { if (value && endsTotal(value)) col = c; });
  return col;
}

function detectColumn(rows, candidates, predicate) {
  for (const row of rows) for (const c of candidates) if (predicate(row[c])) return c;
  return null;
}

function parseColombia(ctx) {
  const { rows, numeric } = ctx;
  const gt = totalColumn(rows);
  const marker = rows.some(row => row[0] === '콜롬비아');
  const cat = marker ? detectColumn(rows, [2, 3, 4], value => Object.hasOwn(COL, value)) : 0;
  const prod = detectColumn(rows, marker ? [4, 5, 6] : [2, 3, 4, 5], value => hasWord(value, COL_WORDS));
  if (gt == null || cat == null || prod == null) throw new Error(`Colombia 파일 구조를 찾지 못했습니다 (total=${gt}, category=${cat}, product=${prod}).`);
  const categories = new Map();
  let category = null, name = null, qty = 0, inBlock = !marker;
  function commit() {
    if (name && category) categories.get(category).push([name, qty]);
    name = null; qty = 0;
  }
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i], c0 = row[0];
    if (marker) {
      // Original checks totals before entering the selected country block.
      if (c0 && String(c0).includes('Total') && c0 !== '콜롬비아') { commit(); break; }
      if (c0 === '콜롬비아') inBlock = true;
      if (!inBlock) continue;
    } else if (c0 === 'Grand Total') { commit(); break; }
    if (Object.hasOwn(COL, row[cat])) {
      commit(); category = row[cat];
      if (!categories.has(category)) categories.set(category, []);
    } else if (row[cat] && endsTotal(row[cat])) { commit(); continue; }
    if (row[prod] && endsTotal(row[prod])) { commit(); continue; }
    if (row[prod]) { commit(); name = String(row[prod]).trim(); qty = numeric(i, gt); }
    else if (name) qty += numeric(i, gt);
  }
  commit();
  return categories;
}

function clColumns(rows, china) {
  const header = rows.slice(0, 8).findIndex(row => row.some(value => typeof value === 'string' && value.startsWith('CL')));
  const columns = new Map(), totals = new Set();
  if (header >= 0) {
    rows[header].forEach((value, c) => {
      if (typeof value === 'string' && value.startsWith('CL') && value.endsWith(' Total')) {
        const cl = value.slice(0, -6).trim(); columns.set(cl, [c]); totals.add(cl);
      }
    });
    rows[header].forEach((value, c) => {
      if (typeof value !== 'string' || !value.startsWith('CL') || endsTotal(value) || totals.has(value)) return;
      if (!columns.has(value)) columns.set(value, [c]);
      else if (!china) columns.get(value).push(c);
    });
  }
  return { header, columns };
}

function parseCL(ctx, china) {
  const { rows, numeric } = ctx;
  const { header, columns } = clColumns(rows, china);
  if (!columns.size) throw new Error(`${ctx.sheetName}: CL 수량 열을 찾지 못했습니다. 중국 행렬 파일은 수량원본·업체별발주·주문상세가 포함된 원본 Excel을 사용하세요.`);
  const markerName = china ? '중국' : '네덜란드';
  const marker = rows.some(row => row[0] === markerName);
  const cat = china ? null : (detectColumn(rows, [2, 3], v => NL_CATS.includes(v)) ?? 2);
  const prod = china
    ? (detectColumn(rows, [2, 4, 5], v => typeof v === 'string' && hasWord(v, ['CHINA', 'ROSE', 'MEL', 'ASPARAGUS', 'Delphinium', 'SPRAY', 'Amaranthus', 'Gypsophila', 'Greens'])) ?? 2)
    : marker ? (detectColumn(rows, [4, 5, 6], v => v && hasWord(String(v).toLowerCase(), NL_WORDS)) ?? 5) : 0;
  const products = new Map();
  let inBlock = !marker;
  // Preserve Python's (cl_row_idx or 3)+1, including header index zero.
  const start = china || marker ? 0 : ((header > 0 ? header : 3) + 1);
  for (let i = start; i < rows.length; i++) {
    const row = rows[i], c0 = row[0];
    if (china || marker) {
      if (c0 && String(c0).includes('Total') && c0 !== markerName) break;
      if (c0 === markerName) inBlock = true;
      if (!inBlock) continue;
      if (china ? [2, 3].some(c => row[c] && endsTotal(row[c])) : row[cat] && endsTotal(row[cat])) continue;
    }
    const value = row[prod];
    if (!value || ((china || marker) && endsTotal(value))) continue;
    const name = String(value).trim();
    if (!china && !marker) {
      if (name === 'Grand Total') break;
      if (HEADERS.has(name) || name.endsWith(' Total')) continue;
    }
    if (!china && marker && !name) continue;
    const byCL = new Map();
    // Python China comprehension reverses name/index and crashes; use its intended mapping.
    for (const [cl, positions] of columns) {
      const qty = sum(positions.map(c => numeric(i, c)));
      if (qty !== 0) byCL.set(cl, qty);
    }
    if (!china && marker && !byCL.size) continue;
    products.set(name, byCL); // Duplicate keys overwrite, insertion order stays stable.
  }
  if (china) return products;
  for (const [name, byCL] of products) {
    const multiplier = [['tulip', 10], ['hyacinth', 5], ['skimmia', 3], ['eucalyptus', 3]].find(([word]) => name.toLowerCase().includes(word))?.[1] ?? 1;
    for (const [cl, qty] of byCL) byCL.set(cl, qty * multiplier);
  }
  return products;
}

function parseSimple(ctx, country) {
  const { rows, numeric, isNumeric } = ctx;
  const gt = totalColumn(rows);
  const markerName = { Ecuador: '에콰도르', Thailand: '태국', Vietnam: '베트남' }[country];
  const marker = Boolean(markerName) && rows.some(row => row[0] === markerName);
  const prod = country === 'Thailand' && marker && rows.some(row => hasWord(row[6], ['Den.'])) ? 6 : 5;
  const products = [];
  if (country === 'Vietnam' && !marker) return products;
  let inBlock = false;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (marker) {
      if (row[0] && String(row[0]).includes('Total') && row[0] !== markerName) break;
      if (row[0] === markerName) inBlock = true;
      if (!inBlock || (country === 'Ecuador' ? hasWord(row[2], ['Total']) : endsTotal(row[2]))) continue;
      if (!row[prod] || endsTotal(row[prod])) continue;
      let c = gt;
      if (country === 'Ecuador' && (c == null || !isNumeric(i, c))) {
        c = null;
        for (let j = 6; j < row.length; j++) if (isNumeric(i, j)) { c = j; break; }
      } else if (country === 'Vietnam' && c == null) c = 6;
      products.push([String(row[prod]).trim(), numeric(i, c)]);
    } else {
      if (!row[0]) continue;
      const name = String(row[0]).trim();
      if (['주문주차', '변경수량', '품목명(색상)'].includes(name)) continue;
      if (name === 'Grand Total') { if (country === 'Ecuador') continue; break; }
      const match = country === 'Ecuador' ? !endsTotal(name) && hasWord(name, ['Ecuador', 'Rose', 'Tinted', 'AS', 'D29'])
        : country === 'Australia' ? Object.hasOwn(BOXES, name) || Object.keys(BOXES).some(k => name.startsWith(k.split(' ')[0]))
          : ['Den.', 'MOK', 'ARAN', 'Oncidium'].some(prefix => name.startsWith(prefix));
      if (match) products.push([name, numeric(i, gt)]);
    }
  }
  return products;
}

const CHINA_UNITS = { '단': 'bunches', '송이': 'stems', '박스': 'boxes' };
const CHINA_DETAIL_HEADERS = ['연도', '세부차수', '업체키(내부)', '업체명', '업체 주문코드(CL)', '품목키', '품목코드', '품목명', 'HF CODE', '단위', '수량'];
const CHINA_CUSTOMER_HEADERS = ['업체키(내부)', '업체 주문코드(CL)', '업체명', '품목키', '품목코드', '품목명', 'HF CODE', '매칭상태', '단위'];
const CHINA_RAW_HEADERS = ['품목키', '단위', '1박스당 단/송이', '총수량', '총박스수'];
const textValue = value => String(value ?? '').trim();
function chinaWeek(value) {
  const match = textValue(value).match(/^(\d{1,2})-(\d{1,2})([A-Za-z]?)$/);
  return match ? `${Number(match[1])}-${Number(match[2])}${match[3]}` : textValue(value);
}
function requireHeaders(ctx, expected) {
  if (expected.some((header, c) => ctx.rows[0]?.[c] !== header)) {
    throw new Error(`${ctx.sheetName}: 지원하는 숫자 원본 양식과 열이 다릅니다. ${expected.join(', ')} 열을 포함한 원본을 다시 내보내세요.`);
  }
}
function chinaId(value, ctx, r, c) {
  const id = textValue(value);
  if (!/^[1-9]\d*$/.test(id)) throw new Error(`${ctx.sheetName}!${address(r, c)}: 유효한 업체키/품목키가 필요합니다.`);
  return id;
}
function chinaUnit(value, ctx, r, c) {
  const unit = textValue(value);
  if (!Object.hasOwn(CHINA_UNITS, unit)) throw new Error(`${ctx.sheetName}!${address(r, c)}: 지원하지 않는 단위 '${unit}'입니다. 단/송이/박스 단위를 확인하세요.`);
  return unit;
}
const equalQuantity = (a, b) => Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(a), Math.abs(b));

/** Only the exporter-owned schemas are accepted, never presentation qty(box) text.
 * Identity is CustKey + ProdKey + unit; repeated codes/names are not identities.
 * Year/week scope is selected before aggregation. No ERP access or unit conversion.
 */
function structuredChina(workbook, week, options) {
  const has = name => Boolean(workbook?.Sheets?.[name]);
  if (!['수량원본', '업체별발주', '주문상세', '품목별업체수량'].some(has)) return null;
  if (!has('주문상세') && !has('업체별발주')) {
    throw new Error('중국 행렬의 표시 수량만으로 변환할 수 없습니다. 업체키·품목키와 숫자 수량을 포함한 주문상세/업체별발주 원본을 다시 내보내세요.');
  }
  const ctx = source(workbook, has('주문상세') ? '주문상세' : '업체별발주');
  const detail = ctx.sheetName === '주문상세';
  requireHeaders(ctx, detail ? CHINA_DETAIL_HEADERS : CHINA_CUSTOMER_HEADERS);
  const nonempty = row => row.some(value => value != null && value !== '');
  const records = ctx.rows.map((row, r) => ({ row, r })).slice(1).filter(({ row }) => nonempty(row));
  const scopes = detail
    ? [...new Set(records.map(({ row, r }) => {
      const year = row[0];
      if (!Number.isInteger(year) || year < 1900 || year > 9999 || !/^\d{1,2}-\d{1,2}[A-Za-z]?$/.test(textValue(row[1]))) {
        throw new Error(`${ctx.sheetName}!A${r + 1}: 연도·세부차수를 확인하세요.`);
      }
      return `${year}/${chinaWeek(row[1])}`;
    }))]
    : ctx.rows[0].slice(9, -1).map(header => {
      const match = textValue(header).match(/^(\d{4})-(\d{1,2}-\d{1,2}[A-Za-z]?)$/);
      if (!match) throw new Error(`${ctx.sheetName}: 숫자 수량 열의 연도·차수 헤더를 확인하세요.`);
      return `${match[1]}/${chinaWeek(match[2])}`;
    });
  if (!detail && (ctx.rows[0].at(-1) !== '합계' || !scopes.length || new Set(scopes).size !== scopes.length)) {
    throw new Error(`${ctx.sheetName}: 중복 없는 연도·차수 수량 열과 합계 열이 필요합니다.`);
  }
  const candidates = scopes.filter(scope => scope.split('/')[1] === chinaWeek(week)
    && (options.year == null || scope.split('/')[0] === String(options.year)));
  // An explicitly empty detail export is a valid empty result, not a parse failure.
  if (records.length && candidates.length !== 1) throw new Error('선택 연도·차수의 숫자 원본을 찾지 못했거나 여러 연도가 섞여 있습니다. 연도·차수를 확인하여 다시 내보내세요.');
  const scope = candidates[0] ?? (options.year == null ? null : `${options.year}/${chinaWeek(week)}`);
  const customers = new Map(), products = new Map();
  function register(row, r) {
    const ci = detail ? 2 : 0, pi = detail ? 5 : 3, ui = detail ? 9 : 8;
    const custKey = chinaId(row[ci], ctx, r, ci), prodKey = chinaId(row[pi], ctx, r, pi);
    const unit = chinaUnit(row[ui], ctx, r, ui), key = `${prodKey}|${unit}`;
    const customer = { custKey, code: textValue(row[detail ? 4 : 1]), name: textValue(row[detail ? 3 : 2]) };
    const product = { prodKey, unit, name: textValue(row[detail ? 7 : 5]), hfCode: textValue(row[detail ? 8 : 6]) };
    if (!product.name) throw new Error(`${ctx.sheetName}!${address(r, detail ? 7 : 5)}: 품목명이 없습니다.`);
    if (customers.has(custKey) && JSON.stringify(customers.get(custKey)) !== JSON.stringify(customer)) throw new Error(`${ctx.sheetName}: CustKey ${custKey}의 업체 정보가 일치하지 않습니다.`);
    customers.set(custKey, customer);
    const previous = products.get(key);
    if (previous && (previous.name !== product.name || previous.hfCode !== product.hfCode)) throw new Error(`${ctx.sheetName}: ProdKey ${prodKey}의 품목 정보가 일치하지 않습니다.`);
    if (!previous) products.set(key, { ...product, quantities: new Map() });
    return { custKey, product: products.get(key) };
  }
  for (const { row, r } of records) {
    if (detail && `${row[0]}/${chinaWeek(row[1])}` !== scope) continue;
    const { custKey, product } = register(row, r);
    const qty = ctx.numeric(r, detail ? 10 : 9 + scopes.indexOf(scope), false);
    product.quantities.set(custKey, (product.quantities.get(custKey) ?? 0) + qty);
  }
  let numericCtx = ctx;
  if (has('수량원본')) {
    if (scopes.length > 1) throw new Error('수량원본은 단일 연도·차수 행렬이어야 합니다. 선택 차수만 다시 내보내세요.');
    numericCtx = source(workbook, '수량원본');
    requireHeaders(numericCtx, CHINA_RAW_HEADERS);
    const columns = numericCtx.rows[0].map((header, c) => ({ match: textValue(header).match(/^([1-9]\d*) 원수량$/), c })).filter(item => item.match);
    if (!columns.length || new Set(columns.map(item => item.match[1])).size !== columns.length) throw new Error('수량원본: CustKey별 원수량 열이 없거나 중복됩니다. 숫자 원본을 다시 내보내세요.');
    const rawHeaders = numericCtx.rows[0];
    if (rawHeaders.length !== 6 + columns.length * 2 || rawHeaders.at(-1) !== '박스 환산불가'
      || columns.some(({ match, c }, i) => c !== i + 5 || rawHeaders[i + 5 + columns.length] !== `${match[1]} 박스수`)) {
      throw new Error('수량원본: CustKey별 원수량/박스수 열이 누락되었거나 순서가 다릅니다. 숫자 원본 양식을 다시 내보내세요.');
    }
    const rawProducts = new Map();
    // Overview supplies names for valid zero products which have no detail order.
    const overview = has('발주현황') ? source(workbook, '발주현황') : null;
    if (overview) requireHeaders(overview, ['품목번호', '품목코드', '품목명', 'HF CODE', '매칭상태', '단위']);
    const overviewProducts = new Map(overview?.rows.slice(1).map(row => [`${textValue(row[0])}|${textValue(row[5])}`, row]) ?? []);
    for (let r = 1; r < numericCtx.rows.length; r++) {
      const row = numericCtx.rows[r];
      if (!nonempty(row) || textValue(row[0]) === `${textValue(row[1])} 합계`) continue;
      const prodKey = chinaId(row[0], numericCtx, r, 0), unit = chinaUnit(row[1], numericCtx, r, 1), key = `${prodKey}|${unit}`;
      if (rawProducts.has(key)) throw new Error(`수량원본: 품목키 ${prodKey}/${unit}가 중복됩니다.`);
      let product = products.get(key);
      if (!product) {
        const metadata = overviewProducts.get(key);
        if (!metadata || !textValue(metadata[2])) throw new Error(`수량원본: 품목키 ${prodKey}/${unit}의 품목명·단위를 구조화 시트에서 확인할 수 없습니다.`);
        product = { prodKey, unit, name: textValue(metadata[2]), hfCode: textValue(metadata[3]), quantities: new Map() };
      }
      const quantities = new Map();
      for (const { match, c } of columns) {
        const custKey = match[1], qty = numericCtx.numeric(r, c, false);
        if (!equalQuantity(qty, product.quantities.get(custKey) ?? 0)) throw new Error(`수량원본!${address(r, c)}: 주문상세/업체별발주 숫자 수량과 일치하지 않습니다. 원본을 다시 내보내세요.`);
        quantities.set(custKey, qty);
        if (!customers.has(custKey)) customers.set(custKey, { custKey, code: '', name: '' });
      }
      if ([...product.quantities.keys()].some(key => !quantities.has(key))) throw new Error('수량원본: 주문 업체의 CustKey 원수량 열이 누락되었습니다.');
      if (!equalQuantity(sum([...quantities.values()]), numericCtx.numeric(r, 3, false))) throw new Error(`수량원본!D${r + 1}: 총수량과 업체별 원수량 합계가 일치하지 않습니다.`);
      rawProducts.set(key, { ...product, quantities });
    }
    if ([...products.keys()].some(key => !rawProducts.has(key))) throw new Error('수량원본: 주문 품목이 누락되었습니다. 원본을 다시 내보내세요.');
    products.clear(); for (const [key, product] of rawProducts) products.set(key, product);
  }
  const codeCounts = new Map();
  for (const customer of customers.values()) codeCounts.set(customer.code, (codeCounts.get(customer.code) ?? 0) + 1);
  const customerList = [...customers.values()].map(customer => {
    const code = customer.code || '코드미등록';
    const duplicate = !customer.code || codeCounts.get(customer.code) > 1;
    return { ...customer, column: duplicate ? `${code} [CustKey:${customer.custKey}]` : code };
  });
  if (new Set(customerList.map(customer => customer.column)).size !== customerList.length) throw new Error('업체 주문코드 표시가 충돌합니다. CustKey별 코드를 확인하세요.');
  const units = [...new Set([...products.values()].map(product => product.unit))];
  if (!units.length) units.push('단');
  const groups = units.map(unit => {
    const items = [...products.values()].filter(product => product.unit === unit);
    const nameCounts = new Map();
    for (const product of items) nameCounts.set(product.name, (nameCounts.get(product.name) ?? 0) + 1);
    const group = new Map(items.map(product => {
      const duplicate = nameCounts.get(product.name) > 1;
      const name = `${product.name}${product.hfCode ? ` (${product.hfCode})` : ''}${duplicate ? ` [ProdKey:${product.prodKey}]` : ''}`;
      return [name, new Map(customerList.map(customer => [customer.column, product.quantities.get(customer.custKey) ?? 0]))];
    }));
    if (group.size !== items.length) throw new Error('품목 표시명이 충돌합니다. ProdKey별 품목명을 확인하세요.');
    return { label: units.length === 1 ? 'Melody' : `Melody_${unit}`, group, unit: CHINA_UNITS[unit], sourceUnit: unit, customers: customerList, products: items.map(({ quantities, ...product }) => product) };
  });
  return { ctx: numericCtx, groups, scope };
}

export function calculateEcuadorBoxes(products) {
  const remainder = n => ((n % 200) + 200) % 200; // Python modulo/floor, also for negatives.
  const rem = products.map((p, i) => remainder(p[1]) === 100 ? i : -1).filter(i => i >= 0);
  const pairs = new Map();
  for (let i = 0; i + 1 < rem.length; i += 2) { pairs.set(rem[i], rem[i + 1]); pairs.set(rem[i + 1], rem[i]); }
  const order = [], placed = new Set(), groups = [];
  for (let i = 0; i < products.length; i++) {
    if (placed.has(i)) continue;
    order.push(i); placed.add(i);
    if (pairs.has(i)) { order.push(pairs.get(i)); placed.add(pairs.get(i)); }
  }
  for (let i = 0; i < order.length;) {
    const idx = order[i];
    if (pairs.has(idx)) {
      groups.push({ positions: [i, i + 1], boxes: Math.floor(products[idx][1] / 200) + Math.floor(products[pairs.get(idx)][1] / 200) + 1 }); i += 2;
    } else {
      groups.push({ positions: [i], boxes: Math.floor(products[idx][1] / 200) + (remainder(products[idx][1]) === 100 ? 1 : 0) }); i++;
    }
  }
  return { order, groups, totalBoxes: sum(groups.map(g => g.boxes)) };
}

function style(country, kind, c, alternate = false, negative = false, bold = false) {
  const [title, header, alt, total, border] = PALETTES[country];
  const font = { name: 'Arial', sz: kind === 'title' ? 14 : kind === 'data' ? 10 : 11 };
  if (kind !== 'data' || bold || negative) font.bold = true;
  if (kind === 'title' || kind === 'header') font.color = { rgb: 'FFFFFF' };
  if (negative) font.color = { rgb: 'C00000' };
  const result = { font, alignment: { horizontal: kind === 'total' && c === 0 ? 'right' : kind === 'data' && c === 0 ? 'left' : 'center', vertical: 'center' } };
  if (!(kind === 'total' && c === 0)) result.alignment.wrapText = true;
  if (kind !== 'title') result.border = Object.fromEntries(['left', 'right', 'top', 'bottom'].map(side => [side, { style: 'thin', color: { rgb: border } }]));
  const fill = kind === 'title' ? title : kind === 'header' ? header : kind === 'total' ? total : alternate ? alt : null;
  if (fill) result.fill = { patternType: 'solid', fgColor: { rgb: fill } };
  return result;
}

function table(country, title, headers, widths) {
  const sheet = { '!merges': [XLSX.utils.decode_range(`A1:${XLSX.utils.encode_col(headers.length - 1)}1`)], '!cols': widths.map(width => ({ width })), '!rows': [{ hpt: 28 }, { hpt: 5 }, { hpt: 22 }] };
  function put(r, c, value, options = {}) {
    const kind = r === 0 ? 'title' : r === 2 ? 'header' : options.total ? 'total' : 'data';
    const cell = value == null ? { t: 'z' } : { t: typeof value === 'number' ? 'n' : 's', v: value };
    if (options.formula != null) { cell.t = 'n'; cell.f = options.formula; cell.v = options.cache; }
    cell.s = style(country, kind, c, r >= 3 && (r - 3) % 2 === 1, options.negative, options.bold);
    sheet[address(r, c)] = cell;
    return cell;
  }
  put(0, 0, title);
  headers.forEach((header, c) => put(2, c, header));
  function finish(count, valueTotals = {}) {
    const r = count + 3;
    put(r, 0, 'TOTAL', { total: true });
    for (let c = 1; c < headers.length; c++) {
      if (Object.hasOwn(valueTotals, c)) put(r, c, valueTotals[c], { total: true });
      else {
        const col = XLSX.utils.encode_col(c);
        const cache = sum(Array.from({ length: count }, (_, i) => sheet[address(i + 3, c)]?.v).filter(v => typeof v === 'number'));
        put(r, c, null, { total: true, formula: `SUM(${col}4:${col}${r})`, cache });
      }
    }
    sheet['!rows'][r] = { hpt: 22 };
    sheet['!ref'] = `A1:${XLSX.utils.encode_col(headers.length - 1)}${r + 1}`;
    return sheet;
  }
  return { sheet, put, finish };
}

/** Pure conversion. Legacy filenames remain week-only; structured China uses year
 * to select source rows, never to read or write ERP records.
 * Returns [{ filename, workbook, country, week, sourceSheet, itemCount, totalQuantity,
 *            unit, warnings, preview: { headers, rows }, ...countrySummary }].
 * Empty templates retain original TOTAL-only workbooks; Netherlands omits empty sides.
 */
export function generatePedidos(workbook, country, week, options = {}) {
  if (!PEDIDOS_COUNTRIES.includes(country)) throw new Error('지원하지 않는 국가입니다.');
  week = sanitizePedidosWeek(week);
  const structured = country === 'China' ? structuredChina(workbook, week, options) : null;
  const ctx = structured?.ctx ?? source(workbook), outputs = [];
  function output(label, sheetName, builder, products, unit, extra = {}) {
    if (sheetName.length > 31) throw new Error('차수가 너무 깁니다. 원본 시트명을 유지하려면 더 짧게 입력하세요.');
    const out = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(out, builder.sheet, sheetName);
    out.Workbook = { CalcPr: { calcMode: 'auto', fullCalcOnLoad: true, forceFullCalc: true } };
    const preview = XLSX.utils.sheet_to_json(builder.sheet, { header: 1, defval: null, raw: true });
    outputs.push({ filename: `${week}_${label}.xlsx`, workbook: out, country, week, sourceSheet: ctx.sheetName,
      itemCount: products.length, totalQuantity: sum(products.map(p => typeof p[1] === 'number' ? p[1] : sum([...p[1].values()]))),
      unit, warnings: [...ctx.warnings], preview: { headers: preview[2], rows: preview.slice(3, 3 + products.length) }, ...extra });
  }
  if (country === 'Colombia') {
    for (let [category, products] of parseColombia(ctx)) {
      const [label, extras, formulas] = COL[category];
      if (label === 'Clavel') products = [...products].sort((a, b) => Number(a[0].toLowerCase().startsWith('minicarnation')) - Number(b[0].toLowerCase().startsWith('minicarnation')) || compare(a[0].toLowerCase(), b[0].toLowerCase()));
      const b = table(country, `${label} - Pedido Colombia  |  Semana ${week}차`, ['Variedad', 'Pedido inicial', 'Cambios', ...extras], [52, ...Array(2 + extras.length).fill(16)]);
      products.forEach(([name, qty], i) => {
        const r = i + 3; b.put(r, 0, name); b.put(r, 1, qty, { negative: qty < 0 }); b.put(r, 2, null);
        formulas.forEach((f, j) => b.put(r, j + 3, null, { formula: f.replaceAll('{r}', r + 1), cache: j === 0 ? qty : label === 'Rosas' ? qty * 10 : qty / 16 }));
      });
      b.finish(products.length); output(label, `${label} ${week}차`, b, products, 'pedido inicial', { category });
    }
  } else if (country === 'Netherlands' || country === 'China') {
    const china = country === 'China', products = structured ? null : parseCL(ctx, china);
    const groups = structured?.groups ?? (china ? [{ label: 'Melody', group: products, unit: 'bunches' }]
      : ['Holex', 'EZ'].map(label => ({ label, group: new Map([...products].filter(([name]) => name.toLowerCase().startsWith('[ez]') === (label === 'EZ'))), unit: 'stems' })));
    for (const { label, group, unit, ...metadata } of groups) {
      if (!china && !group.size) continue;
      const cls = [...new Set([...group.values()].flatMap(values => [...values.keys()]))].sort(compare);
      const b = table(country, `${label} (${country}) - Order in ${unit}  |  Semana ${week}차`, ['Variedad', ...cls, `Total (${unit})`], [54, ...cls.map(() => 10), 14]);
      [...group].forEach(([name, byCL], i) => {
        const r = i + 3; b.put(r, 0, name);
        cls.forEach((cl, c) => { const v = byCL.get(cl); b.put(r, c + 1, v || null, { negative: v < 0 }); });
        b.put(r, cls.length + 1, null, { formula: cls.length ? `SUM(B${r + 1}:${XLSX.utils.encode_col(cls.length)}${r + 1})` : '0', cache: sum([...byCL.values()]), bold: true });
      });
      b.sheet['!freeze'] = 'B4'; b.finish(group.size);
      output(label, `${label} ${week}`, b, [...group], unit, { cls, ...metadata, ...(structured ? { sourceScope: structured.scope, sourceAdapter: 'china-numeric-v1' } : {}) });
    }
  } else {
    const products = parseSimple(ctx, country), vietnam = country === 'Vietnam', thailand = country === 'Thailand', ecuador = country === 'Ecuador';
    const label = vietnam ? 'Royal_base' : country, sheetLabel = vietnam ? 'Royal base' : country;
    const title = ecuador ? 'Rosas - Pedido Ecuador' : vietnam ? 'Royal base (Vietnam) - Order in stems' : thailand ? 'Thailand - Order in bunches' : 'Australia - Order';
    const b = table(country, `${title}  |  Semana ${week}차`, thailand ? ['Name', 'Bunches'] : ecuador || vietnam ? ['Variedad', 'Tallos', 'Cajas'] : ['Name', 'Bunches', 'Boxes'], thailand ? [52, 16] : [vietnam ? 60 : ecuador ? 52 : 36, 14, 12]);
    const boxes = ecuador ? calculateEcuadorBoxes(products) : null;
    const ordered = boxes ? boxes.order.map(i => products[i]) : products;
    ordered.forEach(([name, qty], i) => {
      const r = i + 3; b.put(r, 0, name); b.put(r, 1, qty);
      if (!thailand) b.put(r, 2, null);
      if (vietnam || country === 'Australia') {
        const divisor = vietnam ? 16 : BOXES[name];
        if (divisor) b.put(r, 2, null, { formula: `B${r + 1}/${divisor}`, cache: qty / divisor });
        else ctx.warnings.add(`${name}: bunches/box 기준이 없어 Boxes를 비워 두었습니다.`);
      }
    });
    if (boxes) for (const group of boxes.groups) {
      b.put(group.positions[0] + 3, 2, group.boxes);
      if (group.positions.length === 2) b.sheet['!merges'].push({ s: { r: group.positions[0] + 3, c: 2 }, e: { r: group.positions[1] + 3, c: 2 } });
    }
    b.finish(products.length, boxes ? { 2: boxes.totalBoxes } : {});
    output(label, `${sheetLabel} ${week}`, b, ordered, ecuador || vietnam ? 'stems' : 'bunches', boxes ? { totalBoxes: boxes.totalBoxes } : {});
  }
  return outputs;
}

/** xlsx-js-style writes cells/styles but omits panes and calcPr. Patch only these
 * OOXML nodes using its bundled CFB ZIP API; no extra runtime/dependency required. */
export function serializePedidosWorkbook(workbook) {
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx', cellStyles: true });
  const zip = XLSX.CFB.read(new Uint8Array(bytes), { type: 'array' });
  function replace(path, transform) {
    const xml = zipText(zip, path);
    if (xml == null) throw new Error(`Excel 출력 구성요소가 없습니다: ${path}`);
    XLSX.CFB.utils.cfb_add(zip, `/${path}`, new TextEncoder().encode(transform(xml)));
  }
  workbook.SheetNames.forEach((name, i) => {
    if (workbook.Sheets[name]['!freeze'] === 'B4') replace(`xl/worksheets/sheet${i + 1}.xml`, xml => xml.replace(/<sheetViews>[\s\S]*?<\/sheetViews>/, '<sheetViews><sheetView workbookViewId="0"><pane xSplit="1" ySplit="3" topLeftCell="B4" activePane="bottomRight" state="frozen"/><selection pane="bottomRight" activeCell="B4" sqref="B4"/></sheetView></sheetViews>'));
  });
  replace('xl/workbook.xml', xml => xml.replace(/<calcPr\b[^>]*\/?>(?:[\s\S]*?<\/calcPr>)?/, '').replace('</workbook>', '<calcPr calcId="0" calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>'));
  return new Uint8Array(XLSX.CFB.write(zip, { type: 'array', fileType: 'zip', compression: true }));
}
