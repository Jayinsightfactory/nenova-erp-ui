import { query, withTransaction, sql } from './db';
import { normalizeOrderUnit, normalizeOrderWeek, normalizeOrderYear } from './orderUtils';
import { changeEntry, appendDescr } from './shipmentDescr';

const SUMMARY_LABELS = new Set(['주문', '입고', '재고', '잔량']);
const PRODUCT_PREFIX_RE = /^((?:spray|spary)\s*rose\s*\/?|spray\s*|carnation|mini\s*carnation|rose\s*\/?|alstromeria|alstroemeria|hydrangea)\s*/i;
const PRODUCT_WORD_RE = /\b(spray\s+rose|rose|carnation|hydrangea|alstroe?meria)\b\s*\/?\s*/gi;
const IMPORT_CUSTOMER_ALIASES = {
  // 물량표에서 출고요일/표기 분리로 생기는 보조 컬럼. 실제 출고분배는 주광농원으로 합산한다.
  '윌슨': '주광',
  '태림농장': '태림CH농장',
  '영림선출고': '영림원예',
  '중앙 선출고': '중앙GR농장',
  '중앙선출고': '중앙GR농장',
  '수연선출고': '수연원예',
  '영남소재': '영남',
  '남대문-중앙': 'CL75',
  '남대문중앙': 'CL75',
};
const IMPORT_PRODUCT_ALIASES = {
  // 1901 카네이션 물량표에서 Mandalay가 깨진 표기로 저장되어 있다.
  'ㄱ3': 'Mandalay',
};

function inferProductFamily(...values) {
  for (const value of values) {
    const text = String(value || '').toLowerCase();
    if (!text) continue;
    if (/미니\s*카네이션|mini\s*carnation|minicarnation/.test(text)) return 'minicarnation';
    if (/카네이션|carnation/.test(text)) return 'carnation';
    if (/장미|\brose\b/.test(text)) return 'rose';
    if (/수국|hydrangea/.test(text)) return 'hydrangea';
    if (/알스트로|alstroemeria|alstromeria/.test(text)) return 'alstroemeria';
  }
  return '';
}

function productFamily(product) {
  return inferProductFamily(product?.ProdName, product?.DisplayName, product?.FlowerName, product?.CounName, product?.CountryFlower);
}

function normalizeImportWeek(week) {
  try {
    return normalizeOrderWeek(week);
  } catch {
    const raw = String(week || '').trim();
    const m = raw.match(/^(\d{1,2})-(\d{1,2})$/);
    if (m) return `${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    const ym = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (ym) return `${ym[2].padStart(2, '0')}-${ym[3].padStart(2, '0')}`;
    throw new Error(`Invalid order week: ${raw}`);
  }
}

export function normText(value) {
  return String(value ?? '')
    .replace(/\s+/g, '')
    .replace(/[()（）\[\]{}]/g, '')
    .replace(/[△☆★※＋+]/g, '')
    .toLowerCase();
}

export function cleanProductName(value) {
  let s = String(value ?? '')
    .replace(PRODUCT_PREFIX_RE, '')
    .replace(/mini\s*carnation/gi, 'Mini ')
    .replace(PRODUCT_WORD_RE, ' ')
    .replace(/^mini\s+/i, '')
    .replace(/^mini/i, 'mini')
    .replace(/^[\s/／-]+|[\s/／-]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  s = IMPORT_PRODUCT_ALIASES[s] || s;
  if (/mix\s*box/i.test(s)) {
    s = s.replace(/\s*\(.*?\)\s*/g, '').trim();
  }
  return s;
}

function customerAliases(customer) {
  const aliases = [customer.CustName, customer.OrderCode];
  const descr = String(customer.Descr || '').trim();
  if (descr) {
    const head = descr.split('/')[0]?.trim();
    if (head) aliases.push(head);
  }
  return aliases.filter(Boolean);
}

function normalizeCustomerLabel(label) {
  const raw = String(label || '').trim();
  return IMPORT_CUSTOMER_ALIASES[raw] || raw;
}

function asNumber(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const n = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

function sameQty(a, b) {
  return Math.abs(asNumber(a) - asNumber(b)) < 0.0001;
}

const columnExistsCache = {};
async function columnExists(tableName, columnName) {
  const key = `${tableName}.${columnName}`;
  if (columnExistsCache[key] !== undefined) return columnExistsCache[key];
  const r = await query(
    `SELECT CASE WHEN COL_LENGTH(@tableName, @columnName) IS NULL THEN 0 ELSE 1 END AS HasColumn`,
    {
      tableName: { type: sql.NVarChar, value: `dbo.${tableName}` },
      columnName: { type: sql.NVarChar, value: columnName },
    }
  );
  columnExistsCache[key] = Number(r.recordset[0]?.HasColumn || 0) === 1;
  return columnExistsCache[key];
}

function isNetherlandsProduct(product = {}) {
  return /네덜란드|netherlands|holland|dutch/i.test(String(product.CounName || ''));
}

function extractMoqText(product = {}) {
  if (!isNetherlandsProduct(product)) return '';
  const descr = String(product.ProdDescr || product.Descr || '').trim();
  if (!descr) return '';
  const line = descr.split(/\r?\n/).find(v => /moq|엠오큐|최소/i.test(v)) || '';
  const m = line.match(/(?:moq|엠오큐|최소)\s*[:：=]?\s*([^,;/\n]+)/i);
  return (m ? `MOQ ${m[1].trim()}` : line.trim()).trim();
}

function isAlstroImportRow(row) {
  if (row?.sourceType === 'weekPivot') return false;
  return row?.productFamily === 'alstroemeria' || /알스트로|alstroe?meria/i.test(`${row?.sheetName || ''} ${row?.productLabel || ''}`);
}

function uploadQtyForDb(row) {
  const qty = asNumber(row?.uploadQty);
  return isAlstroImportRow(row) ? qty * 16 : qty;
}

function cellValue(XLSX, sheet, row, col) {
  const addr = XLSX.utils.encode_cell({ r: row - 1, c: col - 1 });
  return sheet[addr]?.v ?? '';
}

function cellRef(XLSX, row, col) {
  return XLSX.utils.encode_cell({ r: row - 1, c: col - 1 });
}

function hasCellValue(XLSX, sheet, row, col) {
  const cell = sheet[cellRef(XLSX, row, col)];
  return !!cell && cell.v !== undefined && cell.v !== null && String(cell.v).trim() !== '';
}

function normalizeHeaderLabel(value) {
  return String(value || '').replace(/\s+/g, '').trim().toLowerCase();
}

function detectWeekPivotHeader(XLSX, sheet, range) {
  for (let r = 1; r <= Math.min(12, range.e.r + 1); r += 1) {
    const cols = {};
    for (let c = 1; c <= range.e.c + 1; c += 1) {
      const label = normalizeHeaderLabel(cellValue(XLSX, sheet, r, c));
      if (!label) continue;
      cols[label] = c;
    }
    const outQtyCol = cols['출고수량'] || cols['수정수량'];
    const custKeyCol = cols['_custkey'];
    const prodKeyCol = cols['_prodkey'];
    if (!outQtyCol || !custKeyCol || !prodKeyCol) continue;
    return {
      headerRow: r,
      cols: {
        week: cols['_week'] || cols['차수'],
        category: cols['품명'] || cols['분류'],
        product: cols['컬러'] || cols['칼라'] || cols['품목'] || cols['품명'],
        orderQty: cols['주문수량'],
        outQty: outQtyCol,
        custKey: custKeyCol,
        prodKey: prodKeyCol,
        outUnit: cols['_outunit'] || cols['단위'],
      },
    };
  }
  return null;
}

function parseWeekPivotCustomerSheet(XLSX, sheet, range, sheetName, logs) {
  const detected = detectWeekPivotHeader(XLSX, sheet, range);
  if (!detected) return null;

  const rows = [];
  const { headerRow, cols } = detected;
  for (let r = headerRow + 1; r <= range.e.r + 1; r += 1) {
    const prodKey = asNumber(cellValue(XLSX, sheet, r, cols.prodKey));
    const custKey = asNumber(cellValue(XLSX, sheet, r, cols.custKey));
    if (!prodKey || !custKey) continue;
    if (!hasCellValue(XLSX, sheet, r, cols.outQty)) continue;

    const productLabel = String(cellValue(XLSX, sheet, r, cols.product) || '').trim();
    if (!productLabel || /합\s*계|total/i.test(productLabel)) continue;

    rows.push({
      sourceType: 'weekPivot',
      sheetName,
      rowNo: r,
      colNo: cols.outQty,
      customerLabel: sheetName,
      productLabel: cleanProductName(productLabel),
      productFamily: '',
      uploadQty: asNumber(cellValue(XLSX, sheet, r, cols.outQty)),
      orderQty: cols.orderQty ? asNumber(cellValue(XLSX, sheet, r, cols.orderQty)) : 0,
      custKey,
      prodKey,
      week: cols.week ? String(cellValue(XLSX, sheet, r, cols.week) || '').trim() : '',
      outUnit: cols.outUnit ? String(cellValue(XLSX, sheet, r, cols.outUnit) || '').trim() : '',
    });
  }

  logs.push(`${sheetName}: 차수피벗 출고리스트 ${rows.length}건`);
  return rows;
}

function productColumnStats(XLSX, sheet, range, dataStartRow, productCol) {
  let count = 0;
  let latinCount = 0;
  let started = false;

  for (let r = dataStartRow; r <= range.e.r + 1; r += 1) {
    const raw = String(cellValue(XLSX, sheet, r, productCol) || '').trim();
    if (!raw || /합\s*계|total/i.test(raw) || /^\d{1,2}[-－]\d{1,2}/.test(raw)) {
      if (started) break;
      continue;
    }

    started = true;
    count += 1;
    if (/[a-z]/i.test(raw)) latinCount += 1;
  }

  const title = `${cellValue(XLSX, sheet, 1, productCol)} ${cellValue(XLSX, sheet, 2, productCol)}`.trim();
  const hasBlockTitle = /\d{2,4}[-－]?\d*|카네이션|장미|수국|알스트로|rose|carnation|hydrangea|alstro/i.test(title);
  const valid = latinCount >= 3 || count >= 15 || (hasBlockTitle && count >= 1);
  const score = (valid ? 1000 : 0) + (hasBlockTitle ? 100 : 0) + latinCount * 4 + count;

  return { count, latinCount, hasBlockTitle, valid, score };
}

function detectCustomerColumns(XLSX, sheet, range, logs) {
  let headerRow = null;
  let summaryStart = null;

  for (let r = 1; r <= Math.min(12, range.e.r + 1); r += 1) {
    let summaryCount = 0;
    let firstSummaryCol = null;
    for (let c = 1; c <= range.e.c + 1; c += 1) {
      const label = String(cellValue(XLSX, sheet, r, c) || '').trim();
      if (SUMMARY_LABELS.has(label)) {
        summaryCount += 1;
        if (!firstSummaryCol) firstSummaryCol = c;
      }
    }
    if (summaryCount >= 2) {
      headerRow = r;
      summaryStart = firstSummaryCol;
      break;
    }
  }
  if (!headerRow) headerRow = 3;
  if (!summaryStart) summaryStart = range.e.c + 2;

  const columns = [];
  for (let c = 1; c < summaryStart; c += 1) {
    const customer = String(cellValue(XLSX, sheet, headerRow, c) || '').trim();
    if (/^칼라$|^컬러$/i.test(customer)) continue;
    if (!customer || SUMMARY_LABELS.has(customer)) continue;

    let productCol = null;
    for (let pc = c - 1; pc >= 1; pc -= 1) {
      const header = String(cellValue(XLSX, sheet, headerRow, pc) || '').trim();
      if (header) continue;
      const sample = String(cellValue(XLSX, sheet, headerRow + 1, pc) || '').trim();
      if (sample && productColumnStats(XLSX, sheet, range, headerRow + 1, pc).valid) {
        productCol = pc;
        break;
      }
    }
    if (!productCol) continue;
    columns.push({ col: c, customer, productCol });
  }
  logs.push(`엑셀 헤더 감지: R${headerRow}, 업체열 ${columns.length}개, 요약 시작열 C${summaryStart}`);
  return { columns, headerRow, dataStartRow: headerRow + 1 };
}

function detectProductRows(XLSX, sheet, range, productCols, dataStartRow, logs, sheetName) {
  const rowsByProductCol = new Map();

  for (const productCol of productCols) {
    const rows = new Set();
    let firstRow = null;
    let lastRow = null;

    for (let r = dataStartRow; r <= range.e.r + 1; r += 1) {
      const rawProduct = String(cellValue(XLSX, sheet, r, productCol) || '').trim();
      if (!rawProduct || /합\s*계|total/i.test(rawProduct) || /^\d{1,2}[-－]\d{1,2}/.test(rawProduct)) {
        continue;
      }

      rows.add(r);
      firstRow ||= r;
      lastRow = r;
    }

    rowsByProductCol.set(productCol, rows);
    logs.push(`${sheetName}: 품목행 C${productCol} ${firstRow ? `R${firstRow}-R${lastRow}` : '없음'}`);
  }

  return rowsByProductCol;
}

// 물량표 숨김 키맵(_keymap) 파싱: 재업로드 시 이름이 아니라 키로 정확 매칭
function parseKeymapSheet(XLSX, workbook) {
  const sheet = workbook.Sheets?.['_keymap'];
  const custKeyBySheetCol = new Map();
  const prodKeyBySheetRow = new Map();
  if (!sheet) return { custKeyBySheetCol, prodKeyBySheetRow, found: false };
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  for (let r = 2; r <= range.e.r + 1; r += 1) {
    const kind = String(cellValue(XLSX, sheet, r, 1) || '').trim();
    const sheetName = String(cellValue(XLSX, sheet, r, 2) || '').trim();
    const idx = asNumber(cellValue(XLSX, sheet, r, 3));
    const key = asNumber(cellValue(XLSX, sheet, r, 4));
    if (!sheetName || !idx || !key) continue;
    if (kind === 'cust') custKeyBySheetCol.set(`${sheetName}|${idx}`, key);
    else if (kind === 'prod') prodKeyBySheetRow.set(`${sheetName}|${idx}`, key);
  }
  return { custKeyBySheetCol, prodKeyBySheetRow, found: true };
}

export function parseAllocationWorkbook(XLSX, workbook, options = {}) {
  const logs = [];
  const rows = [];
  const sheetNames = workbook.SheetNames || [];
  logs.push(`워크북 로드: 시트 ${sheetNames.length}개`);

  const { custKeyBySheetCol, prodKeyBySheetRow, found: keymapFound } = parseKeymapSheet(XLSX, workbook);
  if (keymapFound) logs.push(`키맵 감지: 거래처 ${custKeyBySheetCol.size}열, 품목 ${prodKeyBySheetRow.size}행 (키 정확매칭)`);

  for (const sheetName of sheetNames) {
    if (sheetName === '_keymap') continue;
    const sheetIndex = sheetNames.indexOf(sheetName);
    const sheet = workbook.Sheets[sheetName];
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
    const weekPivotRows = parseWeekPivotCustomerSheet(XLSX, sheet, range, sheetName, logs);
    if (weekPivotRows) {
      weekPivotRows.forEach(r => { r.custOrder = sheetIndex * 100000; });
      rows.push(...weekPivotRows);
      continue;
    }
    const { columns: customerColumns, dataStartRow } = detectCustomerColumns(XLSX, sheet, range, logs);
    if (customerColumns.length === 0) {
      logs.push(`${sheetName}: 업체열 없음, 건너뜀`);
      continue;
    }

    const productCols = [...new Set(customerColumns.map(cc => cc.productCol))];
    const productRowsByCol = detectProductRows(XLSX, sheet, range, productCols, dataStartRow, logs, sheetName);

    for (let r = dataStartRow; r <= range.e.r + 1; r += 1) {
      for (const cc of customerColumns) {
        if (!productRowsByCol.get(cc.productCol)?.has(r)) continue;
        const rawProduct = String(cellValue(XLSX, sheet, r, cc.productCol) || '').trim();
        const qty = asNumber(cellValue(XLSX, sheet, r, cc.col));
        // 키맵 있으면 이름 대신 키로 정확 매칭(표시명이 정리돼도 누락 방지)
        const custKey = custKeyBySheetCol.get(`${sheetName}|${cc.col}`) || 0;
        const prodKey = prodKeyBySheetRow.get(`${sheetName}|${r}`) || 0;
        rows.push({
          sheetName,
          rowNo: r,
          colNo: cc.col,
          custOrder: sheetIndex * 100000 + cc.col,   // 엑셀 좌측 업체 순서(검증 정렬용)
          customerLabel: cc.customer,
          productLabel: cleanProductName(rawProduct),
          productFamily: inferProductFamily(rawProduct, sheetName, options.sourceName),
          uploadQty: qty,
          ...(custKey ? { custKey } : {}),
          ...(prodKey ? { prodKey } : {}),
        });
      }
    }
  }

  logs.push(`엑셀 셀 읽기 완료: 업체×품목 후보 ${rows.length}건`);
  return { rows, logs };
}

export async function buildImportPreview({ parsedRows, rawWeek, customerOverrides }) {
  const week = normalizeImportWeek(rawWeek);
  const logs = [];
  if (!week) throw new Error('차수 필요');

  // 수동 업체 매칭(미매칭 보정): { 원본라벨: custKey } → 정규화 라벨 맵
  const overrideMap = new Map();
  for (const [rawLabel, ck] of Object.entries(customerOverrides || {})) {
    const k = normText(rawLabel);
    const num = Number(ck);
    if (k && num) overrideMap.set(k, num);
  }

  const productResult = await query(
    `SELECT ProdKey, ProdName, DisplayName, FlowerName, CounName, CountryFlower, OutUnit,
            ISNULL(BunchOf1Box,0) AS BunchOf1Box, ISNULL(SteamOf1Box,0) AS SteamOf1Box
       FROM Product
      WHERE ISNULL(isDeleted,0)=0`
  );
  const customerResult = await query(
    `SELECT CustKey, CustName, CustArea, OrderCode, ISNULL(Descr,'') AS Descr,
            ISNULL(BaseOutDay,0) AS BaseOutDay
       FROM Customer
      WHERE ISNULL(isDeleted,0)=0`
  );
  const dbResult = await query(
    `SELECT
        om.CustKey, c.CustName, c.OrderCode, od.ProdKey, p.ProdName, p.DisplayName, p.OutUnit,
        CASE WHEN p.OutUnit=N'단' THEN ISNULL(od.BunchQuantity,0)
             WHEN p.OutUnit=N'송이' THEN ISNULL(od.SteamQuantity,0)
             ELSE ISNULL(od.BoxQuantity, ISNULL(od.OutQuantity,0)) END AS orderQty,
        ISNULL(ship.outQty,0) AS currentOutQty,
        ISNULL(ship.dateIssueCount,0) AS shipmentDateIssueCount
       FROM OrderMaster om
       JOIN Customer c ON c.CustKey=om.CustKey
       JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey AND ISNULL(od.isDeleted,0)=0
       JOIN Product p ON p.ProdKey=od.ProdKey
       OUTER APPLY (
         SELECT
                SUM(ISNULL(sd.OutQuantity,0)) AS outQty,
                SUM(CASE WHEN ISNULL(sd.OutQuantity,0) <> 0
                           AND (
                             sd.ShipmentDtm IS NULL
                             OR ISNULL(sdt.DateQty,0) <> ISNULL(sd.OutQuantity,0)
                             OR ISNULL(sdt.DateRowCount,0) = 0
                             OR ISNULL(sdt.NullDateCount,0) > 0
                             OR CONVERT(date, sd.ShipmentDtm) <> sdt.MinShipmentDate
                             OR CONVERT(date, sd.ShipmentDtm) <> sdt.MaxShipmentDate
                           )
                         THEN 1 ELSE 0 END) AS dateIssueCount
           FROM ShipmentMaster sm
           JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
           OUTER APPLY (
             SELECT
                    SUM(ISNULL(ShipmentQuantity,0)) AS DateQty,
                    COUNT(*) AS DateRowCount,
                    SUM(CASE WHEN ShipmentDtm IS NULL THEN 1 ELSE 0 END) AS NullDateCount,
                    MIN(CONVERT(date, ShipmentDtm)) AS MinShipmentDate,
                    MAX(CONVERT(date, ShipmentDtm)) AS MaxShipmentDate
               FROM ShipmentDate
              WHERE SdetailKey=sd.SdetailKey
           ) sdt
          WHERE sm.CustKey=om.CustKey
            AND sm.OrderWeek=om.OrderWeek
            AND ISNULL(sm.isDeleted,0)=0
            AND sd.ProdKey=od.ProdKey
       ) ship
      WHERE om.OrderWeek=@week AND ISNULL(om.isDeleted,0)=0`,
    { week: { type: sql.NVarChar, value: week } }
  );

  const products = productResult.recordset || [];
  const customers = customerResult.recordset || [];
  const dbRows = dbResult.recordset || [];
  const productByKey = new Map(products.map(p => [Number(p.ProdKey), p]));
  const customerByKey = new Map(customers.map(c => [Number(c.CustKey), c]));
  logs.push(`DB 기준 로드: 품목 ${products.length}개, 업체 ${customers.length}개, 주문라인 ${dbRows.length}개`);

  const prodIndex = new Map();
  const addProdKey = (key, product) => {
    if (!key) return;
    if (!prodIndex.has(key)) prodIndex.set(key, []);
    const list = prodIndex.get(key);
    if (!list.some(p => p.ProdKey === product.ProdKey)) list.push(product);
  };
  for (const p of products) {
    const keys = [p.ProdName, p.DisplayName, cleanProductName(p.ProdName), cleanProductName(p.DisplayName)]
      .filter(Boolean)
      .map(normText);
    for (const key of keys) addProdKey(key, p);
  }

  const custMap = new Map();
  const duplicateCustKeys = new Set();
  for (const c of customers) {
    const keys = customerAliases(c).map(normText);
    for (const key of keys) {
      if (!key) continue;
      if (custMap.has(key) && custMap.get(key).CustKey !== c.CustKey) {
        duplicateCustKeys.add(key);
        continue;
      }
      if (!duplicateCustKeys.has(key)) custMap.set(key, c);
    }
  }
  for (const key of duplicateCustKeys) custMap.delete(key);

  const dbMap = new Map();
  const weekCustomerKeys = new Set();
  for (const row of dbRows) {
    dbMap.set(`${row.CustKey}|${row.ProdKey}`, row);
    weekCustomerKeys.add(row.CustKey);
  }
  const weekCustomers = customers.filter(c => weekCustomerKeys.has(c.CustKey));

  const uniqueFuzzy = (list, label, fields) => {
    const key = normText(label);
    if (!key) return null;
    const matches = list.filter(item => fields.some(field => {
      const v = normText(item[field]);
      return v && (v === key || v.startsWith(key) || v.includes(key) || key.includes(v));
    }));
    return matches.length === 1 ? matches[0] : null;
  };

  const scoreProduct = (product, row, exactKeys, customer) => {
    let score = 0;
    if (customer && dbMap.has(`${customer.CustKey}|${product.ProdKey}`)) score += 200;
    const family = productFamily(product);
    if (row.productFamily && family === row.productFamily) score += 100;
    else if (row.productFamily && family) score -= 30;
    const productKeys = [product.ProdName, product.DisplayName, cleanProductName(product.ProdName), cleanProductName(product.DisplayName)]
      .filter(Boolean)
      .map(normText);
    if (productKeys.some(k => exactKeys.has(k))) score += 50;
    score -= normText(product.ProdName).length / 1000;
    return score;
  };

  const chooseProduct = (row, customer) => {
    const exactKeys = new Set([normText(row.productLabel), normText(cleanProductName(row.productLabel))].filter(Boolean));
    const exactCandidates = [];
    for (const key of exactKeys) {
      for (const p of prodIndex.get(key) || []) {
        if (!exactCandidates.some(x => x.ProdKey === p.ProdKey)) exactCandidates.push(p);
      }
    }
    const familyCandidates = row.productFamily
      ? exactCandidates.filter(p => productFamily(p) === row.productFamily)
      : exactCandidates;
    const candidates = familyCandidates.length ? familyCandidates : exactCandidates;
    if (candidates.length) {
      return candidates
        .map(p => ({ product: p, score: scoreProduct(p, row, exactKeys, customer) }))
        .sort((a, b) => b.score - a.score)[0].product;
    }

    const fuzzy = uniqueFuzzy(
      row.productFamily ? products.filter(p => productFamily(p) === row.productFamily) : products,
      cleanProductName(row.productLabel),
      ['ProdName', 'DisplayName']
    );
    return fuzzy || uniqueFuzzy(products, cleanProductName(row.productLabel), ['ProdName', 'DisplayName']);
  };

  const merged = new Map();
  const custOrderByKey = new Map();   // custKey → 엑셀 좌측 업체 순서(검증 정렬용)
  const unmatched = [];
  const aliasHits = {};
  const uploadedProductKeys = new Set();
  let skippedOtherWeek = 0;
  for (const row of parsedRows) {
    if (row.week) {
      let rowWeek = '';
      try { rowWeek = normalizeImportWeek(row.week); } catch {}
      if (rowWeek && rowWeek !== week) {
        skippedOtherWeek += 1;
        continue;
      }
    }
    const customerLabel = normalizeCustomerLabel(row.customerLabel);
    const uploadQty = uploadQtyForDb(row);
    const excelQty = asNumber(row.uploadQty);
    const quantityMultiplier = isAlstroImportRow(row) ? 16 : 1;
    if (customerLabel !== row.customerLabel && row.uploadQty !== 0) {
      const aliasKey = `${row.customerLabel}→${customerLabel}`;
      if (!aliasHits[aliasKey]) aliasHits[aliasKey] = { count: 0, qty: 0 };
      aliasHits[aliasKey].count += 1;
      aliasHits[aliasKey].qty += uploadQty;
    }
    const explicitCustKey = Number(row.custKey || 0);
    const explicitProdKey = Number(row.prodKey || 0);
    const overrideCustKey = overrideMap.get(normText(customerLabel));
    const customer = (explicitCustKey ? customerByKey.get(explicitCustKey) : null) ||
      (overrideCustKey ? customerByKey.get(Number(overrideCustKey)) : null) ||
      custMap.get(normText(customerLabel)) ||
      uniqueFuzzy(weekCustomers, customerLabel, ['CustName', 'OrderCode', 'Descr']) ||
      uniqueFuzzy(customers, customerLabel, ['CustName', 'OrderCode', 'Descr']);
    const product = (explicitProdKey ? productByKey.get(explicitProdKey) : null) || chooseProduct(row, customer);
    if (!product || !customer) {
      if (row.uploadQty !== 0) {
        unmatched.push({
          ...row,
          reason: !product && !customer ? '품목/업체 매칭 실패' : !product ? '품목 매칭 실패' : '업체 매칭 실패',
        });
      }
      continue;
    }
    uploadedProductKeys.add(Number(product.ProdKey));
    const rowCustOrder = Number.isFinite(Number(row.custOrder)) ? Number(row.custOrder) : Infinity;
    const rowSortRow = Number.isFinite(Number(row.rowNo)) ? Number(row.rowNo) : Infinity;
    const key = `${customer.CustKey}|${product.ProdKey}`;
    const prior = merged.get(key);
    if (prior) {
      prior.uploadQty += uploadQty;
      prior.excelQty += excelQty;
      prior.quantityMultiplier = Math.max(prior.quantityMultiplier || 1, quantityMultiplier);
      prior.cells.push(`${row.sheetName}!R${row.rowNo}C${row.colNo}`);
      prior.sortCust = Math.min(prior.sortCust, rowCustOrder);
      prior.sortRow = Math.min(prior.sortRow, rowSortRow);
    } else {
      const db = dbMap.get(key) || {};
      merged.set(key, {
        key,
        week,
        custKey: customer.CustKey,
        custName: customer.CustName,
        orderCode: customer.OrderCode || '',
        prodKey: product.ProdKey,
        prodName: product.ProdName,
        displayName: product.DisplayName || '',
        outUnit: product.OutUnit || '박스',
        orderQty: Number(db.orderQty || 0),
        currentOutQty: Number(db.currentOutQty || 0),
        shipmentDateIssueCount: Number(db.shipmentDateIssueCount || 0),
        uploadQty,
        excelQty,
        quantityMultiplier,
        sortCust: rowCustOrder,
        sortRow: rowSortRow,
        cells: [`${row.sheetName}!R${row.rowNo}C${row.colNo}`],
      });
    }
    // 업체별 좌측 순서(custOrder) 최소값 기록 — 엑셀누락 행 정렬에도 사용
    const prevOrder = custOrderByKey.get(Number(customer.CustKey));
    if (prevOrder == null || rowCustOrder < prevOrder) custOrderByKey.set(Number(customer.CustKey), rowCustOrder);
  }

  let missingFromExcelCount = 0;
  for (const db of dbRows) {
    const key = `${db.CustKey}|${db.ProdKey}`;
    if (merged.has(key)) continue;
    if (!uploadedProductKeys.has(Number(db.ProdKey))) continue;
    const customer = customerByKey.get(Number(db.CustKey));
    const product = productByKey.get(Number(db.ProdKey));
    if (!customer || !product) continue;
    missingFromExcelCount += 1;
    merged.set(key, {
      key,
      week,
      custKey: customer.CustKey,
      custName: customer.CustName,
      orderCode: customer.OrderCode || '',
      prodKey: product.ProdKey,
      prodName: product.ProdName,
      displayName: product.DisplayName || '',
      outUnit: product.OutUnit || '박스',
      orderQty: Number(db.orderQty || 0),
      currentOutQty: Number(db.currentOutQty || 0),
      shipmentDateIssueCount: Number(db.shipmentDateIssueCount || 0),
      uploadQty: 0,
      excelQty: 0,
      quantityMultiplier: 1,
      missingFromExcel: true,
      sortCust: custOrderByKey.get(Number(db.CustKey)) ?? Infinity,
      sortRow: Infinity,
      cells: ['엑셀누락'],
    });
  }

  // 엑셀 좌측 업체 순서대로 정렬(검증 화면). 업체(custOrder) → 같은 업체 내 품목 행(sortRow) → 품명
  const sortByExcelOrder = (a, b) =>
    (a.sortCust ?? Infinity) - (b.sortCust ?? Infinity) ||
    (a.sortRow ?? Infinity) - (b.sortRow ?? Infinity) ||
    String(a.prodName || '').localeCompare(String(b.prodName || ''));

  const previewRows = [...merged.values()]
    .filter(r => r.uploadQty !== 0 || r.orderQty !== 0 || r.currentOutQty !== 0)
    .sort(sortByExcelOrder)
    .map(r => ({
      ...r,
      changeQty: r.uploadQty - r.orderQty,
      orderDiffQty: r.uploadQty - r.orderQty,
      shipmentDiffQty: r.uploadQty - r.currentOutQty,
      needsShipmentApply: !sameQty(r.uploadQty, r.currentOutQty) || Number(r.shipmentDateIssueCount || 0) > 0,
      status: r.missingFromExcel
        ? '엑셀누락'
        : !dbMap.has(`${r.custKey}|${r.prodKey}`)
        ? '주문없음'
        : sameQty(r.uploadQty, r.orderQty)
          ? '동일'
          : '변경',
    }));

  const summaryByCustomer = {};
  for (const r of previewRows) {
    if (!summaryByCustomer[r.custName]) {
      summaryByCustomer[r.custName] = {
        custName: r.custName,
        orderQty: 0,
        currentOutQty: 0,
        uploadQty: 0,
        changeQty: 0,
        shipmentDiffQty: 0,
        changedLines: 0,
        shipmentChangedLines: 0,
      };
    }
    const s = summaryByCustomer[r.custName];
    s.orderQty += r.orderQty;
    s.currentOutQty += r.currentOutQty;
    s.uploadQty += r.uploadQty;
    s.changeQty += r.changeQty;
    s.shipmentDiffQty += r.shipmentDiffQty;
    if (r.status !== '동일') s.changedLines += 1;
    if (r.needsShipmentApply || r.status !== '동일') s.shipmentChangedLines += 1;
  }

  const changedRows = previewRows.filter(r => r.status !== '동일');
  const applyRows = previewRows.filter(r => r.status !== '동일' || r.needsShipmentApply);
  for (const [alias, hit] of Object.entries(aliasHits)) {
    logs.push(`업체 alias 합산: ${alias} (${hit.count}건, 수량 ${hit.qty})`);
  }
  if (skippedOtherWeek > 0) logs.push(`다른 차수 행 제외: ${skippedOtherWeek}건`);
  if (missingFromExcelCount > 0) logs.push(`엑셀에서 빠진 기존 주문/분배: ${missingFromExcelCount}건 (엑셀수량 0으로 삭제대상 표시)`);
  logs.push(`매칭 완료: 표시 ${previewRows.length}건, 주문변경 ${changedRows.length}건, 분배반영 ${applyRows.length}건, 미매칭 ${unmatched.length}건`);

  // 수동 업체 매칭 드롭다운용 후보 목록 (전체 거래처)
  const customerOptions = customers
    .map(c => ({ custKey: c.CustKey, custName: c.CustName, orderCode: c.OrderCode || '', area: c.CustArea || '' }))
    .sort((a, b) => `${a.area}${a.custName}`.localeCompare(`${b.area}${b.custName}`));

  return {
    success: true,
    week,
    rows: previewRows,
    changedRows,
    applyRows,
    unmatched,
    customerOptions,
    summaryByCustomer: Object.values(summaryByCustomer),
    logs,
  };
}

async function safeNextKey(tQ, table, keyCol) {
  const r = await tQ(`SELECT ISNULL(MAX(${keyCol}),0)+1 AS nk FROM ${table} WITH (UPDLOCK, HOLDLOCK)`, {});
  return r.recordset[0].nk;
}

function isPkCollision(e) {
  return e?.number === 2627 || e?.number === 2601 || /PRIMARY KEY|duplicate key|UNIQUE/i.test(e?.message || '');
}

async function tryInsertWithRetry(tQ, table, keyCol, buildInsert, maxRetry = 5) {
  let lastErr;
  for (let attempt = 0; attempt < maxRetry; attempt += 1) {
    const key = await safeNextKey(tQ, table, keyCol);
    try {
      await buildInsert(key);
      return key;
    } catch (e) {
      lastErr = e;
      if (isPkCollision(e)) continue;
      throw e;
    }
  }
  throw lastErr || new Error(`${table} INSERT 재시도 실패`);
}

async function syncKeyNumbering(tQ, category, table, keyCol) {
  const allowed = {
    OrderMasterKey: ['OrderMaster', 'OrderMasterKey'],
    OrderDetailKey: ['OrderDetail', 'OrderDetailKey'],
    ShipmentMasterKey: ['ShipmentMaster', 'ShipmentKey'],
    ShipmentDetailKey: ['ShipmentDetail', 'SdetailKey'],
  };
  const [safeTable, safeKeyCol] = allowed[category] || [];
  if (safeTable !== table || safeKeyCol !== keyCol) throw new Error('invalid key numbering sync target');

  await tQ(
    `IF EXISTS (SELECT 1 FROM KeyNumbering WHERE Category=@cat)
       UPDATE KeyNumbering
          SET LastKeyNo = CASE WHEN LastKeyNo < x.MaxKey THEN x.MaxKey ELSE LastKeyNo END
         FROM KeyNumbering
         CROSS JOIN (SELECT ISNULL(MAX(${keyCol}),0) AS MaxKey FROM ${table}) x
        WHERE Category=@cat
     ELSE
       INSERT INTO KeyNumbering (Category, LastKeyNo, Descr)
       SELECT @cat, ISNULL(MAX(${keyCol}),0), '' FROM ${table}`,
    { cat: { type: sql.NVarChar, value: category } }
  );
}

async function assertWeekNotFixed(q, week) {
  const r = await q(
    `SELECT TOP 1 1 AS fixed
       FROM ShipmentMaster
      WHERE OrderWeek=@week AND ISNULL(isDeleted,0)=0 AND ISNULL(isFix,0)=1`,
    { week: { type: sql.NVarChar, value: week } }
  );
  if (r.recordset.length) throw new Error('확정된 차수는 업로드 적용할 수 없습니다. 확정취소 후 다시 진행하세요.');
}

function calcShipDate(weekStr, yearStr, baseDay) {
  const weekNum = parseInt(String(weekStr || '').split('-')[0], 10);
  const year = parseInt(yearStr, 10) || new Date().getFullYear();
  if (!weekNum) return null;
  const dateStart = new Date(year, 0, (weekNum - 1) * 7 + 1, 12, 0, 0, 0);
  const wednesday = new Date(dateStart);
  const daysBackToWednesday = (wednesday.getDay() - 3 + 7) % 7;
  wednesday.setDate(wednesday.getDate() - daysBackToWednesday);
  const offsets = [0, 4, 5, 6, 1, 3, 2];
  wednesday.setDate(wednesday.getDate() + (offsets[Number(baseDay)] ?? 0));
  return wednesday;
}

function toOrderUnits(qty, unit, product = {}) {
  const b1b = Number(product.BunchOf1Box || 0);
  const s1b = Number(product.SteamOf1Box || 0);
  const outUnit = normalizeOrderUnit(product.OutUnit, unit || '박스');
  const displayUnit = normalizeOrderUnit(unit, outUnit);

  let box = 0;
  let bunch = 0;
  let steam = 0;
  if (displayUnit === '단') {
    bunch = qty;
    box = b1b > 0 ? qty / b1b : 0;
    steam = box > 0 && s1b > 0 ? box * s1b : 0;
  } else if (displayUnit === '송이') {
    steam = qty;
    box = s1b > 0 ? qty / s1b : 0;
    bunch = box > 0 && b1b > 0 ? box * b1b : 0;
  } else {
    box = qty;
    bunch = b1b > 0 ? qty * b1b : 0;
    steam = s1b > 0 ? qty * s1b : 0;
  }

  const outQty = outUnit === '단' ? bunch : outUnit === '송이' ? steam : box;
  return { box, bunch, steam, outQty };
}

function toShipmentUnits(qty, product = {}) {
  const q = asNumber(qty);
  const b1b = Number(product.BunchOf1Box || 0);
  const s1b = Number(product.SteamOf1Box || 0);
  return {
    box: q,
    bunch: b1b > 0 ? q * b1b : 0,
    steam: s1b > 0 ? q * s1b : 0,
    outQty: q,
  };
}

function estimateQuantityFromUnits(units) {
  if (Number(units.bunch || 0) > 0) return Number(units.bunch || 0);
  if (Number(units.steam || 0) > 0) return Number(units.steam || 0);
  return Number(units.box || 0);
}

function orderQtyFromDetail(detail, product = {}) {
  const outUnit = normalizeOrderUnit(product.OutUnit, '박스');
  if (outUnit === '단') return Number(detail?.BunchQuantity || 0);
  if (outUnit === '송이') return Number(detail?.SteamQuantity || 0);
  return Number(detail?.BoxQuantity ?? detail?.OutQuantity ?? 0);
}

function memoQty(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? '').trim();
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3))).replace(/\.?0+$/, '');
}

// 전산 비고용 수량변경 항목: "담당자+이전>이후" (예: "임16>12").
//  수량 정보가 없는 이벤트(출고일지정 등)는 ''(비고 미기록) — "수량변경만" 정책.
function importMemo(userName, before = null, after = null) {
  if (before == null || after == null) return '';
  return changeEntry(userName, before, after);
}

function formatDateYmd(date) {
  if (!date || Number.isNaN(date.getTime?.())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function insertOrderHistory(tQ, detailKey, before, after, descr, uid) {
  try {
    await tQ(
      `INSERT INTO OrderHistory
         (OrderDetailKey, ChangeType, ColumName, BeforeValue, AfterValue, Descr, ChangeID, ChangeDtm)
       VALUES (@dk, N'수정', N'수량', @before, @after, @descr, @uid, GETDATE())`,
      {
        dk: { type: sql.Int, value: detailKey },
        before: { type: sql.NVarChar, value: String(before) },
        after: { type: sql.NVarChar, value: String(after) },
        descr: { type: sql.NVarChar, value: descr || '' },
        uid: { type: sql.NVarChar, value: uid || 'admin' },
      }
    );
  } catch (e) {
    console.warn('[OrderHistory INSERT failed]', e.message);
  }
}

async function insertShipmentHistory(tQ, sdetailKey, before, after, descr, uid) {
  try {
    await tQ(
      `INSERT INTO ShipmentHistory
         (SdetailKey, ShipmentDtm, ChangeType, ColumName, BeforeValue, AfterValue, Descr, ChangeID, ChangeDtm)
       SELECT @dk, ShipmentDtm, N'수정', N'OutQuantity', @before, @after, @descr, @uid, GETDATE()
         FROM ShipmentDetail
        WHERE SdetailKey=@dk`,
      {
        dk: { type: sql.Int, value: sdetailKey },
        before: { type: sql.NVarChar, value: String(before) },
        after: { type: sql.NVarChar, value: String(after) },
        descr: { type: sql.NVarChar, value: descr || '' },
        uid: { type: sql.NVarChar, value: uid || 'admin' },
      }
    );
  } catch (e) {
    console.warn('[ShipmentHistory INSERT failed]', e.message);
  }
}

async function syncOrderDetailForShipmentImport({ tQ, row, week, orderYear, uid, userName, customer, product, hasOrderYearWeekColumn, hasOrderDetailDescrColumn }) {
  const desiredQty = Number(row.uploadQty || 0);

  // Manager 는 UserInfo.UserID 여야 ViewOrder INNER JOIN UserInfo 통과(문자열 '관리자'=UserName 금지).
  const mgrRow = await tQ(`SELECT TOP 1 UserID FROM UserInfo WHERE UserName=N'관리자' ORDER BY UserID`, {});
  const mgr = mgrRow.recordset[0]?.UserID || 'admin';
  const orderCode = customer?.OrderCode || row.orderCode || '';
  const existingMaster = await tQ(
    `SELECT TOP 1 OrderMasterKey
       FROM OrderMaster WITH (UPDLOCK, HOLDLOCK)
      WHERE CustKey=@ck AND OrderWeek=@week AND ISNULL(isDeleted,0)=0
      ORDER BY OrderMasterKey ASC`,
    { ck: { type: sql.Int, value: Number(row.custKey) }, week: { type: sql.NVarChar, value: week } }
  );

  let orderCreated = false;
  let orderMasterKey = existingMaster.recordset[0]?.OrderMasterKey;
  if (!orderMasterKey) {
    if (desiredQty <= 0) return { orderCreated: false, detailCreated: false, detailUpdated: false, detailDeleted: false, orderChanged: false };
    orderCreated = true;
    orderMasterKey = await tryInsertWithRetry(tQ, 'OrderMaster', 'OrderMasterKey', async (newMk) => {
      const orderMasterParams = {
        mk: { type: sql.Int, value: newMk },
        yr: { type: sql.NVarChar, value: String(orderYear) },
        week: { type: sql.NVarChar, value: week },
        ywk: { type: sql.NVarChar, value: String(orderYear) + week.split('-')[0] },
        mgr: { type: sql.NVarChar, value: mgr },
        ck: { type: sql.Int, value: Number(row.custKey) },
        oc: { type: sql.NVarChar, value: orderCode },
        descr: { type: sql.NVarChar, value: '엑셀 출고분배 업로드 자동 주문등록' },
        adminId: { type: sql.NVarChar, value: 'admin' },
        uid: { type: sql.NVarChar, value: uid },
      };
      if (hasOrderYearWeekColumn) {
        await tQ(
          `INSERT INTO OrderMaster
             (OrderMasterKey, OrderDtm, OrderYear, OrderWeek, OrderYearWeek, Manager, CustKey, OrderCode, Descr,
              isDeleted, CreateID, CreateDtm, LastUpdateID, LastUpdateDtm)
           VALUES
             (@mk, GETDATE(), @yr, @week, @ywk, @mgr, @ck, @oc, @descr,
              0, @adminId, GETDATE(), @uid, GETDATE())`,
          orderMasterParams
        );
      } else {
        await tQ(
          `INSERT INTO OrderMaster
             (OrderMasterKey, OrderDtm, OrderYear, OrderWeek, Manager, CustKey, OrderCode, Descr,
              isDeleted, CreateID, CreateDtm, LastUpdateID, LastUpdateDtm)
           VALUES
             (@mk, GETDATE(), @yr, @week, @mgr, @ck, @oc, @descr,
              0, @adminId, GETDATE(), @uid, GETDATE())`,
          orderMasterParams
        );
      }
    });
    await syncKeyNumbering(tQ, 'OrderMasterKey', 'OrderMaster', 'OrderMasterKey');
  } else {
    await tQ(
      `UPDATE OrderMaster
          SET Manager=CASE WHEN Manager IS NULL OR Manager='' THEN @mgr ELSE Manager END,
              OrderCode=CASE WHEN OrderCode IS NULL OR OrderCode='' THEN @oc ELSE OrderCode END,
              LastUpdateID=@uid,
              LastUpdateDtm=GETDATE()
        WHERE OrderMasterKey=@mk`,
      {
        mgr: { type: sql.NVarChar, value: mgr },
        oc: { type: sql.NVarChar, value: orderCode },
        uid: { type: sql.NVarChar, value: uid },
        mk: { type: sql.Int, value: orderMasterKey },
      }
    );
  }

  const existingDetail = await tQ(
    `SELECT TOP 1 OrderDetailKey, BoxQuantity, BunchQuantity, SteamQuantity, OutQuantity
       FROM OrderDetail WITH (UPDLOCK, HOLDLOCK)
      WHERE OrderMasterKey=@mk AND ProdKey=@pk AND ISNULL(isDeleted,0)=0`,
    { mk: { type: sql.Int, value: orderMasterKey }, pk: { type: sql.Int, value: Number(row.prodKey) } }
  );
  const detail = existingDetail.recordset[0];
  const descr = importMemo(userName, orderQtyFromDetail(detail, product), desiredQty);
  const orderDetailDescr = extractMoqText(product);
  const units = toOrderUnits(desiredQty, product.OutUnit || row.outUnit || '박스', product);

  if (detail && desiredQty <= 0) {
    const oldQty = orderQtyFromDetail(detail, product);
    await tQ(
      `UPDATE OrderDetail
          SET isDeleted=1,
              LastUpdateID=@uid,
              LastUpdateDtm=GETDATE()
        WHERE OrderDetailKey=@dk`,
      { dk: { type: sql.Int, value: detail.OrderDetailKey }, uid: { type: sql.NVarChar, value: uid } }
    );
    if (!sameQty(oldQty, 0)) {
      await insertOrderHistory(tQ, detail.OrderDetailKey, oldQty, 0, descr, uid);
    }
    return { orderCreated, detailCreated: false, detailUpdated: false, detailDeleted: true, orderChanged: !sameQty(oldQty, 0), orderMasterKey, orderDetailKey: detail.OrderDetailKey };
  }

  if (detail) {
    const oldQty = orderQtyFromDetail(detail, product);
    if (sameQty(oldQty, desiredQty)) {
      return { orderCreated, detailCreated: false, detailUpdated: false, detailDeleted: false, orderChanged: orderCreated, orderMasterKey, orderDetailKey: detail.OrderDetailKey };
    }
    const updateDescrSql = hasOrderDetailDescrColumn
      ? `Descr = CASE WHEN @descr<>'' AND ISNULL(Descr,'')='' THEN @descr ELSE Descr END,`
      : '';
    await tQ(
      `UPDATE OrderDetail
          SET BoxQuantity=@box,
              BunchQuantity=@bunch,
              SteamQuantity=@steam,
              OutQuantity=@outQty,
              EstQuantity=@outQty,
              NoneOutQuantity=0,
              ${updateDescrSql}
              LastUpdateID=@uid,
              LastUpdateDtm=GETDATE()
        WHERE OrderDetailKey=@dk`,
      {
        dk: { type: sql.Int, value: detail.OrderDetailKey },
        box: { type: sql.Float, value: units.box },
        bunch: { type: sql.Float, value: units.bunch },
        steam: { type: sql.Float, value: units.steam },
        outQty: { type: sql.Float, value: units.outQty },
        descr: { type: sql.NVarChar, value: orderDetailDescr },
        uid: { type: sql.NVarChar, value: uid },
      }
    );
    await insertOrderHistory(tQ, detail.OrderDetailKey, oldQty, desiredQty, descr, uid);
    return { orderCreated, detailCreated: false, detailUpdated: true, detailDeleted: false, orderChanged: true, orderMasterKey, orderDetailKey: detail.OrderDetailKey };
  }

  if (desiredQty <= 0) {
    return { orderCreated, detailCreated: false, detailUpdated: false, detailDeleted: false, orderChanged: orderCreated, orderMasterKey };
  }

  const orderDetailKey = await tryInsertWithRetry(tQ, 'OrderDetail', 'OrderDetailKey', async (newDk) => {
    const insertCols = hasOrderDetailDescrColumn
      ? `(OrderDetailKey, OrderMasterKey, ProdKey,
          BoxQuantity, BunchQuantity, SteamQuantity, OutQuantity, EstQuantity, NoneOutQuantity,
          Descr, isDeleted, CreateID, CreateDtm)`
      : `(OrderDetailKey, OrderMasterKey, ProdKey,
          BoxQuantity, BunchQuantity, SteamQuantity, OutQuantity, EstQuantity, NoneOutQuantity,
          isDeleted, CreateID, CreateDtm)`;
    const insertValues = hasOrderDetailDescrColumn
      ? `(@dk, @mk, @pk,
          @box, @bunch, @steam, @outQty, @outQty, 0,
          @descr, 0, @adminId, GETDATE())`
      : `(@dk, @mk, @pk,
          @box, @bunch, @steam, @outQty, @outQty, 0,
          0, @adminId, GETDATE())`;
    await tQ(
      `INSERT INTO OrderDetail ${insertCols} VALUES ${insertValues}`,
      {
        dk: { type: sql.Int, value: newDk },
        mk: { type: sql.Int, value: orderMasterKey },
        pk: { type: sql.Int, value: Number(row.prodKey) },
        box: { type: sql.Float, value: units.box },
        bunch: { type: sql.Float, value: units.bunch },
        steam: { type: sql.Float, value: units.steam },
        outQty: { type: sql.Float, value: units.outQty },
        descr: { type: sql.NVarChar, value: orderDetailDescr },
        adminId: { type: sql.NVarChar, value: 'admin' },
      }
    );
  });
  await syncKeyNumbering(tQ, 'OrderDetailKey', 'OrderDetail', 'OrderDetailKey');
  await insertOrderHistory(tQ, orderDetailKey, 0, desiredQty, importMemo(userName, 0, desiredQty), uid);

  return { orderCreated, detailCreated: true, detailUpdated: false, detailDeleted: false, orderChanged: true, orderMasterKey, orderDetailKey };
}

function orderApplyAction(mutation = {}) {
  if (mutation.detailDeleted) return '주문삭제';
  if (mutation.detailCreated) return mutation.orderCreated ? '주문신규' : '주문품목추가';
  if (mutation.detailUpdated) return '주문수정';
  if (mutation.orderCreated) return '주문마스터생성';
  return '주문유지';
}

async function loadCurrentImportState(tQ, row, week, product = {}) {
  const orderResult = await tQ(
    `SELECT TOP 1 od.OrderDetailKey, od.BoxQuantity, od.BunchQuantity, od.SteamQuantity, od.OutQuantity
       FROM OrderMaster om WITH (UPDLOCK, HOLDLOCK)
       JOIN OrderDetail od WITH (UPDLOCK, HOLDLOCK)
         ON od.OrderMasterKey=om.OrderMasterKey
        AND od.ProdKey=@pk
        AND ISNULL(od.isDeleted,0)=0
      WHERE om.CustKey=@ck
        AND om.OrderWeek=@week
        AND ISNULL(om.isDeleted,0)=0
      ORDER BY om.OrderMasterKey ASC, od.OrderDetailKey ASC`,
    {
      ck: { type: sql.Int, value: Number(row.custKey) },
      pk: { type: sql.Int, value: Number(row.prodKey) },
      week: { type: sql.NVarChar, value: week },
    }
  );
  const shipmentResult = await tQ(
    `SELECT
            ISNULL(SUM(ISNULL(sd.OutQuantity,0)),0) AS currentOutQty,
            ISNULL(SUM(CASE WHEN ISNULL(sd.OutQuantity,0) <> 0
                              AND (
                                sd.ShipmentDtm IS NULL
                                OR ISNULL(sdt.DateQty,0) <> ISNULL(sd.OutQuantity,0)
                                OR ISNULL(sdt.DateRowCount,0) = 0
                                OR ISNULL(sdt.NullDateCount,0) > 0
                                OR CONVERT(date, sd.ShipmentDtm) <> sdt.MinShipmentDate
                                OR CONVERT(date, sd.ShipmentDtm) <> sdt.MaxShipmentDate
                              )
                            THEN 1 ELSE 0 END),0) AS dateIssueCount
       FROM ShipmentMaster sm WITH (UPDLOCK, HOLDLOCK)
       JOIN ShipmentDetail sd WITH (UPDLOCK, HOLDLOCK) ON sd.ShipmentKey=sm.ShipmentKey
       OUTER APPLY (
         SELECT
                SUM(ISNULL(ShipmentQuantity,0)) AS DateQty,
                COUNT(*) AS DateRowCount,
                SUM(CASE WHEN ShipmentDtm IS NULL THEN 1 ELSE 0 END) AS NullDateCount,
                MIN(CONVERT(date, ShipmentDtm)) AS MinShipmentDate,
                MAX(CONVERT(date, ShipmentDtm)) AS MaxShipmentDate
           FROM ShipmentDate
          WHERE SdetailKey=sd.SdetailKey
       ) sdt
      WHERE sm.CustKey=@ck
        AND sm.OrderWeek=@week
        AND ISNULL(sm.isDeleted,0)=0
        AND sd.ProdKey=@pk`,
    {
      ck: { type: sql.Int, value: Number(row.custKey) },
      pk: { type: sql.Int, value: Number(row.prodKey) },
      week: { type: sql.NVarChar, value: week },
    }
  );
  const detail = orderResult.recordset[0];
  return {
    orderQty: detail ? orderQtyFromDetail(detail, product) : 0,
    currentOutQty: Number(shipmentResult.recordset[0]?.currentOutQty || 0),
    dateIssueCount: Number(shipmentResult.recordset[0]?.dateIssueCount || 0),
  };
}

function buildApplyLog(row, applied) {
  const customer = row.custName || row.customerLabel || row.custKey;
  const product = row.displayName || row.prodName || row.productLabel || row.prodKey;
  return `${customer} / ${product}: ${applied.orderAction}, ${applied.shipmentAction} ` +
    `(주문 ${Number(row.orderQty || 0)}→${Number(row.uploadQty || 0)}, 분배 ${Number(applied.beforeQty || 0)}→${Number(applied.afterQty || 0)})`;
}

export async function applyImportRows({ rawWeek, rawYear, rows, user }) {
  const week = normalizeImportWeek(rawWeek);
  const orderYear = rawYear || normalizeOrderYear(rawWeek, new Date().getFullYear().toString());
  if (!week) throw new Error('차수 필요');
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('적용할 행이 없습니다');
  await assertWeekNotFixed(query, week);
  const hasOrderYearWeekColumn = await columnExists('OrderMaster', 'OrderYearWeek');
  const hasShipmentYearWeekColumn = await columnExists('ShipmentMaster', 'OrderYearWeek');
  const hasOrderDetailDescrColumn = await columnExists('OrderDetail', 'Descr');

  const uid = user?.userId || 'system';
  const userName = user?.userName || uid;
  const targetRows = rows
    .filter(r => r && r.custKey && r.prodKey && Number.isFinite(Number(r.uploadQty)))
    .map(r => ({ ...r, uploadQty: Number(r.uploadQty) }));

  const result = await withTransaction(async (tQ) => {
    const applied = [];
    let skippedNoChangeCount = 0;
    for (const row of targetRows) {
      const prod = await tQ(
        `SELECT TOP 1 p.OutUnit, p.CounName, ISNULL(p.Descr,'') AS ProdDescr,
                ISNULL(p.BunchOf1Box,0) AS BunchOf1Box, ISNULL(p.SteamOf1Box,0) AS SteamOf1Box,
                ISNULL(NULLIF(cpc.Cost,0), ISNULL(p.Cost,0)) AS Cost
           FROM Product p
           LEFT JOIN CustomerProdCost cpc ON cpc.CustKey=@ck AND cpc.ProdKey=p.ProdKey
          WHERE p.ProdKey=@pk`,
        { pk: { type: sql.Int, value: Number(row.prodKey) }, ck: { type: sql.Int, value: Number(row.custKey) } }
      );
      const cust = await tQ(
        `SELECT TOP 1 OrderCode, ISNULL(BaseOutDay,0) AS BaseOutDay FROM Customer WHERE CustKey=@ck`,
        { ck: { type: sql.Int, value: Number(row.custKey) } }
      );
      const productInfo = prod.recordset[0] || {};
      const customerInfo = cust.recordset[0] || {};
      const units = toShipmentUnits(row.uploadQty, productInfo);
      const estQty = estimateQuantityFromUnits(units);
      const fallbackCost = Number(productInfo.Cost || 0);
      const currentState = await loadCurrentImportState(tQ, row, week, productInfo);
      if (sameQty(currentState.orderQty, row.uploadQty) && sameQty(currentState.currentOutQty, units.outQty) && currentState.dateIssueCount === 0) {
        skippedNoChangeCount += 1;
        continue;
      }
      const shipDate = calcShipDate(week, orderYear, customerInfo.BaseOutDay ?? 0);
      if (!shipDate) throw new Error(`${row.custName || row.custKey} / ${row.prodName || row.prodKey}: 출고일 계산 실패`);

      const orderMutation = await syncOrderDetailForShipmentImport({
        tQ,
        row,
        week,
        orderYear,
        uid,
        userName,
        customer: customerInfo,
        product: productInfo,
        hasOrderYearWeekColumn,
        hasOrderDetailDescrColumn,
      });

      const sm = await tQ(
        `SELECT TOP 1 ShipmentKey FROM ShipmentMaster WITH (UPDLOCK, HOLDLOCK)
          WHERE CustKey=@ck AND OrderWeek=@week AND ISNULL(isDeleted,0)=0
          ORDER BY ISNULL(isFix,0) DESC, ShipmentKey ASC`,
        { ck: { type: sql.Int, value: Number(row.custKey) }, week: { type: sql.NVarChar, value: week } }
      );

      let shipmentKey = sm.recordset[0]?.ShipmentKey;
      if (!shipmentKey && row.uploadQty > 0) {
        shipmentKey = await tryInsertWithRetry(tQ, 'ShipmentMaster', 'ShipmentKey', async (newSk) => {
          const shipmentMasterParams = {
            sk: { type: sql.Int, value: newSk },
            yr: { type: sql.NVarChar, value: String(orderYear) },
            week: { type: sql.NVarChar, value: week },
            ywk: { type: sql.NVarChar, value: String(orderYear) + week.split('-')[0] },
            ck: { type: sql.Int, value: Number(row.custKey) },
            uid: { type: sql.NVarChar, value: uid },
          };
          if (hasShipmentYearWeekColumn) {
            await tQ(
              `INSERT INTO ShipmentMaster (ShipmentKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,isFix,isDeleted,WebCreated,CreateID,CreateDtm)
               VALUES (@sk,@yr,@week,@ywk,@ck,0,0,1,@uid,GETDATE())`,
              shipmentMasterParams
            );
          } else {
            await tQ(
              `INSERT INTO ShipmentMaster (ShipmentKey,OrderYear,OrderWeek,CustKey,isFix,isDeleted,WebCreated,CreateID,CreateDtm)
               VALUES (@sk,@yr,@week,@ck,0,0,1,@uid,GETDATE())`,
              shipmentMasterParams
            );
          }
        });
        await syncKeyNumbering(tQ, 'ShipmentMasterKey', 'ShipmentMaster', 'ShipmentKey');
      }

      const old = shipmentKey
        ? await tQ(
          `SELECT TOP 1 SdetailKey, ISNULL(OutQuantity,0) AS OutQuantity, ISNULL(Descr,'') AS Descr
             FROM ShipmentDetail WITH (UPDLOCK, HOLDLOCK)
            WHERE ShipmentKey=@sk AND ProdKey=@pk`,
          { sk: { type: sql.Int, value: shipmentKey }, pk: { type: sql.Int, value: Number(row.prodKey) } }
        )
        : { recordset: [] };
      const oldDetail = old.recordset[0];
      const oldQty = Number(oldDetail?.OutQuantity || 0);
      let shipmentChanged = false;
      let shipmentAction = oldDetail ? '분배유지' : '분배없음';
      let shipmentDetailKey = oldDetail?.SdetailKey || null;

      if (row.uploadQty <= 0) {
        if (oldDetail) {
          const log = importMemo(userName, oldQty, 0);
          await insertShipmentHistory(tQ, oldDetail.SdetailKey, oldQty, 0, log, uid);
          await tQ(`DELETE FROM ShipmentDate WHERE SdetailKey=@dk`, { dk: { type: sql.Int, value: oldDetail.SdetailKey } });
          await tQ(`DELETE FROM ShipmentDetail WHERE SdetailKey=@dk`, { dk: { type: sql.Int, value: oldDetail.SdetailKey } });
          shipmentChanged = true;
          shipmentAction = '분배삭제';
        }
      } else if (oldDetail && !sameQty(oldQty, units.outQty)) {
        const log = importMemo(userName, oldQty, row.uploadQty);
        const newDescr = appendDescr(oldDetail.Descr, log);
        await tQ(
          `UPDATE ShipmentDetail
              SET CustKey=@ck,
                  ShipmentDtm=@dt, OutQuantity=@outQty, EstQuantity=@estQty,
                  BoxQuantity=@box, BunchQuantity=@bunch, SteamQuantity=@steam,
                  Cost=CASE WHEN ISNULL(Cost,0)>0 THEN Cost ELSE @fallbackCost END,
                  Amount=ROUND(ISNULL(NULLIF(Cost,0), @fallbackCost) * @estQty / 1.1, 0),
                  Vat=ROUND(ISNULL(NULLIF(Cost,0), @fallbackCost) * @estQty / 11, 0),
                  Descr=@log
            WHERE SdetailKey=@dk`,
          {
            dk: { type: sql.Int, value: oldDetail.SdetailKey },
            ck: { type: sql.Int, value: Number(row.custKey) },
            dt: { type: sql.DateTime, value: shipDate },
            outQty: { type: sql.Float, value: units.outQty },
            estQty: { type: sql.Float, value: estQty },
            box: { type: sql.Float, value: units.box },
            bunch: { type: sql.Float, value: units.bunch },
            steam: { type: sql.Float, value: units.steam },
            fallbackCost: { type: sql.Float, value: fallbackCost },
            log: { type: sql.NVarChar, value: newDescr },
          }
        );
        await tQ(`DELETE FROM ShipmentDate WHERE SdetailKey=@dk`, { dk: { type: sql.Int, value: oldDetail.SdetailKey } });
        await tQ(
          `INSERT INTO ShipmentDate (SdetailKey, ShipmentDtm, ShipmentQuantity, EstQuantity, Cost, Amount, Vat)
           SELECT @dk, @dt, @outQty, @estQty, ISNULL(Cost,0), ISNULL(Amount,0), ISNULL(Vat,0)
             FROM ShipmentDetail
            WHERE SdetailKey=@dk`,
          {
            dk: { type: sql.Int, value: oldDetail.SdetailKey },
            dt: { type: sql.DateTime, value: shipDate },
            outQty: { type: sql.Float, value: units.outQty },
            estQty: { type: sql.Float, value: estQty },
          }
        );
        await insertShipmentHistory(tQ, oldDetail.SdetailKey, oldQty, units.outQty, log, uid);
        shipmentChanged = true;
        shipmentAction = '분배수정';
      } else if (oldDetail) {
        if (orderMutation.orderChanged || currentState.dateIssueCount > 0) {
          // 출고일/환산만 정리 — 수량변경 아님 → 비고(Descr) 미기록 (수량변경만 정책)
          await tQ(
            `UPDATE ShipmentDetail
                SET CustKey=@ck,
                    ShipmentDtm=@dt,
                    EstQuantity=@estQty,
                    BoxQuantity=@box,
                    BunchQuantity=@bunch,
                    SteamQuantity=@steam,
                    Cost=CASE WHEN ISNULL(Cost,0)>0 THEN Cost ELSE @fallbackCost END,
                    Amount=ROUND(ISNULL(NULLIF(Cost,0), @fallbackCost) * @estQty / 1.1, 0),
                    Vat=ROUND(ISNULL(NULLIF(Cost,0), @fallbackCost) * @estQty / 11, 0)
              WHERE SdetailKey=@dk`,
            {
              dk: { type: sql.Int, value: oldDetail.SdetailKey },
              ck: { type: sql.Int, value: Number(row.custKey) },
              dt: { type: sql.DateTime, value: shipDate },
              estQty: { type: sql.Float, value: estQty },
              box: { type: sql.Float, value: units.box },
              bunch: { type: sql.Float, value: units.bunch },
              steam: { type: sql.Float, value: units.steam },
              fallbackCost: { type: sql.Float, value: fallbackCost },
            }
          );
          await tQ(`DELETE FROM ShipmentDate WHERE SdetailKey=@dk`, { dk: { type: sql.Int, value: oldDetail.SdetailKey } });
          await tQ(
            `INSERT INTO ShipmentDate (SdetailKey, ShipmentDtm, ShipmentQuantity, EstQuantity, Cost, Amount, Vat)
             SELECT @dk, @dt, @outQty, @estQty, ISNULL(Cost,0), ISNULL(Amount,0), ISNULL(Vat,0)
               FROM ShipmentDetail
              WHERE SdetailKey=@dk`,
            {
              dk: { type: sql.Int, value: oldDetail.SdetailKey },
              dt: { type: sql.DateTime, value: shipDate },
              outQty: { type: sql.Float, value: units.outQty },
              estQty: { type: sql.Float, value: estQty },
            }
          );
          shipmentChanged = true;
          shipmentAction = '출고일지정';
        } else {
          shipmentAction = '분배유지';
        }
      } else {
        const log = importMemo(userName, 0, row.uploadQty);
        const detailKey = await tryInsertWithRetry(tQ, 'ShipmentDetail', 'SdetailKey', async (newDk) => {
          await tQ(
            `INSERT INTO ShipmentDetail
               (SdetailKey,ShipmentKey,CustKey,ProdKey,ShipmentDtm,OutQuantity,EstQuantity,BoxQuantity,BunchQuantity,SteamQuantity,Cost,Amount,Vat,isFix,Descr)
             VALUES
               (@dk,@sk,@ck,@pk,@dt,@outQty,@estQty,@box,@bunch,@steam,@cost,
                ROUND(@cost * @estQty / 1.1, 0), ROUND(@cost * @estQty / 11, 0),0,@log)`,
            {
              dk: { type: sql.Int, value: newDk },
              sk: { type: sql.Int, value: shipmentKey },
              ck: { type: sql.Int, value: Number(row.custKey) },
              pk: { type: sql.Int, value: Number(row.prodKey) },
              dt: { type: sql.DateTime, value: shipDate },
              outQty: { type: sql.Float, value: units.outQty },
              estQty: { type: sql.Float, value: estQty },
              box: { type: sql.Float, value: units.box },
              bunch: { type: sql.Float, value: units.bunch },
              steam: { type: sql.Float, value: units.steam },
              cost: { type: sql.Float, value: fallbackCost },
              log: { type: sql.NVarChar, value: log },
            }
          );
        });
        await syncKeyNumbering(tQ, 'ShipmentDetailKey', 'ShipmentDetail', 'SdetailKey');
        await tQ(
          `INSERT INTO ShipmentDate (SdetailKey, ShipmentDtm, ShipmentQuantity, EstQuantity, Cost, Amount, Vat)
           SELECT @dk, @dt, @outQty, @estQty, ISNULL(Cost,0), ISNULL(Amount,0), ISNULL(Vat,0)
             FROM ShipmentDetail
            WHERE SdetailKey=@dk`,
          {
            dk: { type: sql.Int, value: detailKey },
            dt: { type: sql.DateTime, value: shipDate },
            outQty: { type: sql.Float, value: units.outQty },
            estQty: { type: sql.Float, value: estQty },
          }
        );
        await insertShipmentHistory(tQ, detailKey, 0, units.outQty, log, uid);
        shipmentChanged = true;
        shipmentAction = '분배신규';
        shipmentDetailKey = detailKey;
      }

      if (shipmentChanged || orderMutation.orderChanged) {
        const appliedRow = {
          ...row,
          beforeQty: oldQty,
          afterQty: units.outQty,
          shipmentChanged,
          shipmentAction,
          shipmentDetailKey,
          orderAction: orderApplyAction(orderMutation),
          estimateQty: estQty,
          shipDate: shipDate.toISOString().slice(0, 10),
          ...orderMutation,
        };
        applied.push({ ...appliedRow, log: buildApplyLog(row, appliedRow) });
      }
    }
    return { applied, skippedNoChangeCount };
  });
  const appliedRows = result.applied || [];
  const logs = [
    `${week}차 엑셀 검증 적용 완료: 적용 ${appliedRows.length}건, 이미 동일해서 건너뜀 ${result.skippedNoChangeCount || 0}건`,
    `주문 신규/추가 ${appliedRows.filter(r => r.orderCreated || r.detailCreated).length}건, 주문수정 ${appliedRows.filter(r => r.detailUpdated).length}건, 주문삭제 ${appliedRows.filter(r => r.detailDeleted).length}건`,
    `분배 신규 ${appliedRows.filter(r => r.shipmentAction === '분배신규').length}건, 분배수정 ${appliedRows.filter(r => r.shipmentAction === '분배수정').length}건, 분배삭제 ${appliedRows.filter(r => r.shipmentAction === '분배삭제').length}건`,
    ...appliedRows.slice(0, 500).map(r => r.log),
  ];

  return {
    success: true,
    week,
    appliedCount: appliedRows.length,
    skippedNoChangeCount: result.skippedNoChangeCount || 0,
    shipmentChangedCount: appliedRows.filter(r => r.shipmentChanged).length,
    orderChangedCount: appliedRows.filter(r => r.orderChanged).length,
    orderCreatedCount: appliedRows.filter(r => r.orderCreated || r.detailCreated).length,
    orderUpdatedCount: appliedRows.filter(r => r.detailUpdated).length,
    orderDeletedCount: appliedRows.filter(r => r.detailDeleted).length,
    logs,
    appliedRows,
  };
}

export async function preDistributeImportProductsToOrders({ rawWeek, rawYear, rows, user }) {
  const week = normalizeImportWeek(rawWeek);
  const orderYear = rawYear || normalizeOrderYear(rawWeek, new Date().getFullYear().toString());
  if (!week) throw new Error('차수 필요');
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('업로드 파일에서 매칭된 품목이 없습니다');

  await assertWeekNotFixed(query, week);
  const hasShipmentYearWeekColumn = await columnExists('ShipmentMaster', 'OrderYearWeek');
  const uid = user?.userId || 'system';
  const userName = user?.userName || uid;
  const deduped = new Map();
  for (const row of rows) {
    if (!row?.custKey || !row?.prodKey) continue;
    const key = `${Number(row.custKey)}|${Number(row.prodKey)}`;
    if (!deduped.has(key)) deduped.set(key, row);
  }
  const targetRows = [...deduped.values()];
  if (targetRows.length === 0) throw new Error('업로드 파일에서 DB 업체/품목으로 매칭된 행이 없습니다');

  const result = await withTransaction(async (tQ) => {
    const applied = [];
    let skippedNoOrderCount = 0;
    let skippedNoChangeCount = 0;
    let skippedZeroNoShipmentCount = 0;

    for (const row of targetRows) {
      const prod = await tQ(
        `SELECT TOP 1 p.OutUnit, p.CounName, ISNULL(p.Descr,'') AS ProdDescr,
                ISNULL(p.BunchOf1Box,0) AS BunchOf1Box, ISNULL(p.SteamOf1Box,0) AS SteamOf1Box,
                ISNULL(NULLIF(cpc.Cost,0), ISNULL(p.Cost,0)) AS Cost
           FROM Product p
           LEFT JOIN CustomerProdCost cpc ON cpc.CustKey=@ck AND cpc.ProdKey=p.ProdKey
          WHERE p.ProdKey=@pk`,
        { pk: { type: sql.Int, value: Number(row.prodKey) }, ck: { type: sql.Int, value: Number(row.custKey) } }
      );
      const cust = await tQ(
        `SELECT TOP 1 CustName, OrderCode, ISNULL(BaseOutDay,0) AS BaseOutDay
           FROM Customer
          WHERE CustKey=@ck`,
        { ck: { type: sql.Int, value: Number(row.custKey) } }
      );
      const order = await tQ(
        `SELECT TOP 1 od.OrderDetailKey, od.BoxQuantity, od.BunchQuantity, od.SteamQuantity, od.OutQuantity
           FROM OrderMaster om WITH (UPDLOCK, HOLDLOCK)
           JOIN OrderDetail od WITH (UPDLOCK, HOLDLOCK)
             ON od.OrderMasterKey=om.OrderMasterKey
            AND od.ProdKey=@pk
            AND ISNULL(od.isDeleted,0)=0
          WHERE om.CustKey=@ck
            AND om.OrderWeek=@week
            AND ISNULL(om.isDeleted,0)=0
          ORDER BY om.OrderMasterKey ASC, od.OrderDetailKey ASC`,
        {
          ck: { type: sql.Int, value: Number(row.custKey) },
          pk: { type: sql.Int, value: Number(row.prodKey) },
          week: { type: sql.NVarChar, value: week },
        }
      );

      const productInfo = prod.recordset[0] || {};
      const customerInfo = cust.recordset[0] || {};
      const orderDetail = order.recordset[0];
      const label = {
        custName: row.custName || customerInfo.CustName || row.custKey,
        prodName: row.displayName || row.prodName || row.productLabel || row.prodKey,
      };
      if (!orderDetail) {
        skippedNoOrderCount += 1;
        continue;
      }

      const desiredQty = orderQtyFromDetail(orderDetail, productInfo);
      const units = toShipmentUnits(desiredQty, productInfo);
      const estQty = estimateQuantityFromUnits(units);
      const fallbackCost = Number(productInfo.Cost || 0);
      const currentState = await loadCurrentImportState(tQ, row, week, productInfo);
      if (sameQty(currentState.currentOutQty, units.outQty) && currentState.dateIssueCount === 0) {
        skippedNoChangeCount += 1;
        continue;
      }

      const shipDate = calcShipDate(week, orderYear, customerInfo.BaseOutDay ?? 0);
      if (!shipDate) throw new Error(`${label.custName} / ${label.prodName}: 출고일 계산 실패`);

      const sm = await tQ(
        `SELECT TOP 1 ShipmentKey FROM ShipmentMaster WITH (UPDLOCK, HOLDLOCK)
          WHERE CustKey=@ck AND OrderWeek=@week AND ISNULL(isDeleted,0)=0
          ORDER BY ISNULL(isFix,0) DESC, ShipmentKey ASC`,
        { ck: { type: sql.Int, value: Number(row.custKey) }, week: { type: sql.NVarChar, value: week } }
      );

      let shipmentKey = sm.recordset[0]?.ShipmentKey;
      if (!shipmentKey && desiredQty > 0) {
        shipmentKey = await tryInsertWithRetry(tQ, 'ShipmentMaster', 'ShipmentKey', async (newSk) => {
          const params = {
            sk: { type: sql.Int, value: newSk },
            yr: { type: sql.NVarChar, value: String(orderYear) },
            week: { type: sql.NVarChar, value: week },
            ywk: { type: sql.NVarChar, value: String(orderYear) + week.split('-')[0] },
            ck: { type: sql.Int, value: Number(row.custKey) },
            uid: { type: sql.NVarChar, value: uid },
          };
          if (hasShipmentYearWeekColumn) {
            await tQ(
              `INSERT INTO ShipmentMaster (ShipmentKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,isFix,isDeleted,WebCreated,CreateID,CreateDtm)
               VALUES (@sk,@yr,@week,@ywk,@ck,0,0,1,@uid,GETDATE())`,
              params
            );
          } else {
            await tQ(
              `INSERT INTO ShipmentMaster (ShipmentKey,OrderYear,OrderWeek,CustKey,isFix,isDeleted,WebCreated,CreateID,CreateDtm)
               VALUES (@sk,@yr,@week,@ck,0,0,1,@uid,GETDATE())`,
              params
            );
          }
        });
        await syncKeyNumbering(tQ, 'ShipmentMasterKey', 'ShipmentMaster', 'ShipmentKey');
      }

      const old = shipmentKey
        ? await tQ(
          `SELECT TOP 1 SdetailKey, ISNULL(OutQuantity,0) AS OutQuantity, ISNULL(Descr,'') AS Descr
             FROM ShipmentDetail WITH (UPDLOCK, HOLDLOCK)
            WHERE ShipmentKey=@sk AND ProdKey=@pk`,
          { sk: { type: sql.Int, value: shipmentKey }, pk: { type: sql.Int, value: Number(row.prodKey) } }
        )
        : { recordset: [] };
      const oldDetail = old.recordset[0];
      const oldQty = Number(oldDetail?.OutQuantity || 0);
      let shipmentAction = oldDetail ? '분배유지' : '분배없음';
      let shipmentDetailKey = oldDetail?.SdetailKey || null;
      let shipmentChanged = false;

      if (desiredQty <= 0) {
        if (!oldDetail) {
          skippedZeroNoShipmentCount += 1;
          continue;
        }
        const log = importMemo(userName, oldQty, 0);
        await insertShipmentHistory(tQ, oldDetail.SdetailKey, oldQty, 0, log, uid);
        await tQ(`DELETE FROM ShipmentDate WHERE SdetailKey=@dk`, { dk: { type: sql.Int, value: oldDetail.SdetailKey } });
        await tQ(`DELETE FROM ShipmentDetail WHERE SdetailKey=@dk`, { dk: { type: sql.Int, value: oldDetail.SdetailKey } });
        shipmentAction = '분배삭제';
        shipmentChanged = true;
      } else if (oldDetail) {
        const log = importMemo(userName, oldQty, desiredQty);
        const newDescr = appendDescr(oldDetail.Descr, log);
        await tQ(
          `UPDATE ShipmentDetail
              SET CustKey=@ck,
                  ShipmentDtm=@dt,
                  OutQuantity=@outQty,
                  EstQuantity=@estQty,
                  BoxQuantity=@box,
                  BunchQuantity=@bunch,
                  SteamQuantity=@steam,
                  Cost=CASE WHEN ISNULL(Cost,0)>0 THEN Cost ELSE @fallbackCost END,
                  Amount=ROUND(ISNULL(NULLIF(Cost,0), @fallbackCost) * @estQty / 1.1, 0),
                  Vat=ROUND(ISNULL(NULLIF(Cost,0), @fallbackCost) * @estQty / 11, 0),
                  Descr=@log
            WHERE SdetailKey=@dk`,
          {
            dk: { type: sql.Int, value: oldDetail.SdetailKey },
            ck: { type: sql.Int, value: Number(row.custKey) },
            dt: { type: sql.DateTime, value: shipDate },
            outQty: { type: sql.Float, value: units.outQty },
            estQty: { type: sql.Float, value: estQty },
            box: { type: sql.Float, value: units.box },
            bunch: { type: sql.Float, value: units.bunch },
            steam: { type: sql.Float, value: units.steam },
            fallbackCost: { type: sql.Float, value: fallbackCost },
            log: { type: sql.NVarChar, value: newDescr },
          }
        );
        await tQ(`DELETE FROM ShipmentDate WHERE SdetailKey=@dk`, { dk: { type: sql.Int, value: oldDetail.SdetailKey } });
        await tQ(
          `INSERT INTO ShipmentDate (SdetailKey, ShipmentDtm, ShipmentQuantity, EstQuantity, Cost, Amount, Vat)
           SELECT @dk, @dt, @outQty, @estQty, ISNULL(Cost,0), ISNULL(Amount,0), ISNULL(Vat,0)
             FROM ShipmentDetail
            WHERE SdetailKey=@dk`,
          {
            dk: { type: sql.Int, value: oldDetail.SdetailKey },
            dt: { type: sql.DateTime, value: shipDate },
            outQty: { type: sql.Float, value: units.outQty },
            estQty: { type: sql.Float, value: estQty },
          }
        );
        if (!sameQty(oldQty, units.outQty)) {
          await insertShipmentHistory(tQ, oldDetail.SdetailKey, oldQty, units.outQty, log, uid);
          shipmentAction = '분배수정';
        } else {
          shipmentAction = '출고일정리';
        }
        shipmentChanged = true;
      } else {
        const log = importMemo(userName, 0, desiredQty);
        const detailKey = await tryInsertWithRetry(tQ, 'ShipmentDetail', 'SdetailKey', async (newDk) => {
          await tQ(
            `INSERT INTO ShipmentDetail
               (SdetailKey,ShipmentKey,CustKey,ProdKey,ShipmentDtm,OutQuantity,EstQuantity,BoxQuantity,BunchQuantity,SteamQuantity,Cost,Amount,Vat,isFix,Descr)
             VALUES
               (@dk,@sk,@ck,@pk,@dt,@outQty,@estQty,@box,@bunch,@steam,@cost,
                ROUND(@cost * @estQty / 1.1, 0), ROUND(@cost * @estQty / 11, 0),0,@log)`,
            {
              dk: { type: sql.Int, value: newDk },
              sk: { type: sql.Int, value: shipmentKey },
              ck: { type: sql.Int, value: Number(row.custKey) },
              pk: { type: sql.Int, value: Number(row.prodKey) },
              dt: { type: sql.DateTime, value: shipDate },
              outQty: { type: sql.Float, value: units.outQty },
              estQty: { type: sql.Float, value: estQty },
              box: { type: sql.Float, value: units.box },
              bunch: { type: sql.Float, value: units.bunch },
              steam: { type: sql.Float, value: units.steam },
              cost: { type: sql.Float, value: fallbackCost },
              log: { type: sql.NVarChar, value: log },
            }
          );
        });
        await syncKeyNumbering(tQ, 'ShipmentDetailKey', 'ShipmentDetail', 'SdetailKey');
        await tQ(
          `INSERT INTO ShipmentDate (SdetailKey, ShipmentDtm, ShipmentQuantity, EstQuantity, Cost, Amount, Vat)
           SELECT @dk, @dt, @outQty, @estQty, ISNULL(Cost,0), ISNULL(Amount,0), ISNULL(Vat,0)
             FROM ShipmentDetail
            WHERE SdetailKey=@dk`,
          {
            dk: { type: sql.Int, value: detailKey },
            dt: { type: sql.DateTime, value: shipDate },
            outQty: { type: sql.Float, value: units.outQty },
            estQty: { type: sql.Float, value: estQty },
          }
        );
        await insertShipmentHistory(tQ, detailKey, 0, units.outQty, log, uid);
        shipmentAction = '분배신규';
        shipmentChanged = true;
        shipmentDetailKey = detailKey;
      }

      if (shipmentChanged) {
        applied.push({
          key: `${row.custKey}|${row.prodKey}`,
          custKey: row.custKey,
          prodKey: row.prodKey,
          custName: label.custName,
          prodName: row.prodName,
          displayName: row.displayName || '',
          beforeQty: oldQty,
          afterQty: units.outQty,
          orderQty: desiredQty,
          shipmentAction,
          shipmentChanged,
          shipmentDetailKey,
          shipDate: formatDateYmd(shipDate),
          log: `${label.custName} / ${label.prodName}: ${shipmentAction} (주문기준 ${memoQty(desiredQty)}, 분배 ${memoQty(oldQty)}>${memoQty(units.outQty)}, 출고일 ${formatDateYmd(shipDate)})`,
        });
      }
    }

    return { applied, skippedNoOrderCount, skippedNoChangeCount, skippedZeroNoShipmentCount };
  });

  const appliedRows = result.applied || [];
  const productCount = new Set(targetRows.map(r => Number(r.prodKey))).size;
  const customerCount = new Set(targetRows.map(r => Number(r.custKey))).size;
  const logs = [
    `${week}차 업로드 품종 사전 일괄분배 완료`,
    `대상 범위: 품목 ${productCount}개, 업체 ${customerCount}개, 매칭행 ${targetRows.length}건`,
    `분배 반영 ${appliedRows.length}건, 이미 동일 ${result.skippedNoChangeCount || 0}건, 주문없음 제외 ${result.skippedNoOrderCount || 0}건`,
    ...appliedRows.slice(0, 500).map(r => r.log),
  ];
  if ((result.skippedZeroNoShipmentCount || 0) > 0) {
    logs.splice(3, 0, `주문 0 / 분배 없음 ${result.skippedZeroNoShipmentCount}건은 건너뜀`);
  }

  return {
    success: true,
    week,
    appliedCount: appliedRows.length,
    shipmentChangedCount: appliedRows.length,
    skippedNoChangeCount: result.skippedNoChangeCount || 0,
    skippedNoOrderCount: result.skippedNoOrderCount || 0,
    skippedZeroNoShipmentCount: result.skippedZeroNoShipmentCount || 0,
    productCount,
    customerCount,
    logs,
    appliedRows,
  };
}
