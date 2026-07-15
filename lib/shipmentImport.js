import { query, withTransaction, sql } from './db';
import { normalizeOrderUnit, normalizeOrderWeek, resolveActiveOrderYear } from './orderUtils';

/** 물량표 업로드용 연도 해석 — normalizeOrderYear 의 "NN-NN → 2025 레거시" 규칙을 타면 안 된다.
 * (그 규칙 때문에 28-01 업로드가 OrderYear=2025 마스터 + 2025-07 출고일을 생성한 사고: 2026-07-08) */
export function resolveImportOrderYear(rawWeek, rawYear) {
  return resolveActiveOrderYear(rawWeek, rawYear);
}
import { changeEntry, appendDescr } from './shipmentDescr';
import { distributeUnits, amountVatFromCostEst } from './distributeUnits';
import { refreshShipmentDatesAfterDetailChange } from './syncShipmentDateEst.js';
import { isActiveShipmentOutQty, purgeZeroOutShipmentDetail } from './shipmentDetailWriteGuard.js';
import {
  loadCategoryFixStates,
  loadLineFixStates,
  evaluateImportRowFixBlock,
} from './shipmentFixScope';
import {
  normalizeUploadQtyForProduct,
  detectQtyWarnings,
  hasCriticalQtyWarnings,
  isAlstroImportRow,
  toOrderUnits,
  appendPeerQtyWarnings,
  appendCustomerPeerQtyWarnings,
  resolveImportOrderSyncPlan,
  importProductOverrideKey,
  classifyImportUnmatchedReason,
  isImportRowInUploadScope,
  dedupeVerifyTargets,
  compareVerifyResult,
  resolveImportCustomerOverrideKey,
  isImportIgnoreCustomerValue,
  isRowFromIgnoredCustomer,
} from './shipmentImportQty.js';

export { normalizeUploadQtyForProduct, detectQtyWarnings, hasCriticalQtyWarnings, appendPeerQtyWarnings, appendCustomerPeerQtyWarnings, resolveImportOrderSyncPlan, importProductOverrideKey, classifyImportUnmatchedReason } from './shipmentImportQty.js';

const SUMMARY_LABELS = new Set(['주문', '입고', '재고', '잔량']);
const PRODUCT_PREFIX_RE = /^((?:spray|spary)\s*rose\s*\/?|spray\s*|carnation|mini\s*carnation|rose\s*\/?|alstromeria|alstroemeria|hydrangea)\s*/i;
const PRODUCT_WORD_RE = /\b(spray\s+rose|rose|carnation|hydrangea|alstroe?meria)\b\s*\/?\s*/gi;
const IMPORT_CUSTOMER_ALIASES = {
  // 물량표에서 출고요일/표기 분리로 생기는 보조 컬럼. 실제 출고분배는 주광농원으로 합산한다.
  '윌슨': '주광',
  // 2026-07-15 29차 물량표: '윌슨' 열이 '주광윌슨'으로 개명돼 별칭이 안 먹어 9박스 누락 신고
  '주광윌슨': '주광',
  // 라움(트라움에스앤씨, 680) 선출고 열 — Descr 별칭 '라움'으로 매칭 (수연선출고 패턴과 동일)
  '라움선출고': '라움',
  '라움선출고완료': '라움',
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

// 키맵 라벨 정규화(공백/줄바꿈 통일) — export 저장값과 import 읽기값에 동일 적용
function normKeymapLabel(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

// 물량표 숨김 키맵(_keymap) 파싱: 셀 텍스트(업체명/품목명)→키로 정확 매칭.
// 위치(컬럼/행)가 아니라 텍스트 기준이라 중간 품목열 삽입 등 레이아웃 변화에도 안 깨짐.
function parseKeymapSheet(XLSX, workbook) {
  const sheet = workbook.Sheets?.['_keymap'];
  const custKeyByLabel = new Map();
  const prodKeyByLabel = new Map();
  if (!sheet) return { custKeyByLabel, prodKeyByLabel, found: false };
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  for (let r = 2; r <= range.e.r + 1; r += 1) {
    const kind = String(cellValue(XLSX, sheet, r, 1) || '').trim();
    const sheetName = String(cellValue(XLSX, sheet, r, 2) || '').trim();
    const label = normKeymapLabel(cellValue(XLSX, sheet, r, 3));
    const key = asNumber(cellValue(XLSX, sheet, r, 4));
    if (!sheetName || !label || !key) continue;
    if (kind === 'cust') custKeyByLabel.set(`${sheetName}|${label}`, key);
    else if (kind === 'prod') prodKeyByLabel.set(`${sheetName}|${label}`, key);
  }
  return { custKeyByLabel, prodKeyByLabel, found: true };
}

export function parseAllocationWorkbook(XLSX, workbook, options = {}) {
  const logs = [];
  const rows = [];
  const sheetNames = workbook.SheetNames || [];
  logs.push(`워크북 로드: 시트 ${sheetNames.length}개`);

  const { custKeyByLabel, prodKeyByLabel, found: keymapFound } = parseKeymapSheet(XLSX, workbook);
  if (keymapFound) logs.push(`키맵 감지: 거래처 ${custKeyByLabel.size}개, 품목 ${prodKeyByLabel.size}개 (텍스트 기준 정확매칭)`);

  // 이번 업로드가 "다뤄야 했던" 전체 범위(품목을 지운 행/삭제 셀도 포함) — 유령 분배 판단용.
  // 키맵은 export 시점 워크북 전체의 (시트,라벨)→key 를 담고 있어 텍스트가 지금 사라져도 범위를 안다.
  const prodKeysInScope = new Set(prodKeyByLabel.values());
  const custKeysInScope = new Set(custKeyByLabel.values());

  for (const sheetName of sheetNames) {
    if (sheetName === '_keymap') continue;
    const sheetIndex = sheetNames.indexOf(sheetName);
    const sheet = workbook.Sheets[sheetName];
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
    const weekPivotRows = parseWeekPivotCustomerSheet(XLSX, sheet, range, sheetName, logs);
    if (weekPivotRows) {
      weekPivotRows.forEach(r => { r.custOrder = sheetIndex * 100000; });
      rows.push(...weekPivotRows);
      weekPivotRows.forEach(r => {
        if (r.custKey) custKeysInScope.add(Number(r.custKey));
        if (r.prodKey) prodKeysInScope.add(Number(r.prodKey));
      });
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
        // 키맵 있으면 셀 텍스트(업체명/품목명)로 정확 매칭(표시명이 정리돼도/레이아웃 바뀌어도 누락 방지)
        const custKey = custKeyByLabel.get(`${sheetName}|${normKeymapLabel(cc.customer)}`) || 0;
        const prodKey = prodKeyByLabel.get(`${sheetName}|${normKeymapLabel(rawProduct)}`) || 0;
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
        if (custKey) custKeysInScope.add(Number(custKey));
        if (prodKey) prodKeysInScope.add(Number(prodKey));
      }
    }
  }

  logs.push(`엑셀 셀 읽기 완료: 업체×품목 후보 ${rows.length}건`);
  return { rows, logs, keymapFound, custKeysInScope, prodKeysInScope };
}

export async function buildImportPreview({ parsedRows, rawWeek, customerOverrides, productOverrides, custKeysInScope, prodKeysInScope }) {
  const week = normalizeImportWeek(rawWeek);
  const orderYear = resolveImportOrderYear(rawWeek);
  const logs = [];
  if (!week) throw new Error('차수 필요');

  const [categoryFixStates, lineFixStates] = await Promise.all([
    loadCategoryFixStates(query, orderYear, week),
    loadLineFixStates(query, orderYear, week),
  ]);

  // 수동 업체 매칭(미매칭 보정): { 원본라벨: custKey } → 정규화 라벨 맵
  // '__ignore__' sentinel(IMPORT_IGNORE_CUSTOMER_VALUE) 은 거래처가 아닌 라벨(콜롬비아 농장 열 등)을
  // "제외" 표시한 것 — overrideMap 에는 안 넣고 ignoredCustomerLabels 에 별도로 모아 완전히 스킵한다.
  const overrideMap = new Map();
  const ignoredCustomerLabels = new Set();
  for (const [rawLabel, ck] of Object.entries(customerOverrides || {})) {
    if (isImportIgnoreCustomerValue(ck)) {
      ignoredCustomerLabels.add(normText(rawLabel));
      continue;
    }
    const k = normText(rawLabel);
    const num = Number(ck);
    if (k && num) overrideMap.set(k, num);
  }
  const productOverrideMap = new Map();
  for (const [rawKey, pk] of Object.entries(productOverrides || {})) {
    const num = Number(pk);
    if (rawKey && num) productOverrideMap.set(String(rawKey), num);
  }

  const productResult = await query(
    `SELECT ProdKey, ProdName, DisplayName, FlowerName, CounName, CountryFlower, OutUnit, EstUnit,
            ISNULL(BunchOf1Box,0) AS BunchOf1Box, ISNULL(SteamOf1Bunch,0) AS SteamOf1Bunch,
            ISNULL(SteamOf1Box,0) AS SteamOf1Box
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
            AND ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)), @importYear) = @importYear
            AND sd.ProdKey=od.ProdKey
       ) ship
      WHERE om.OrderWeek=@week AND ISNULL(om.isDeleted,0)=0
        AND ISNULL(CAST(om.OrderYear AS NVARCHAR(4)), @importYear) = @importYear`,
    {
      week: { type: sql.NVarChar, value: week },
      importYear: { type: sql.NVarChar, value: String(orderYear) },
    }
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

  const suggestCustomerCandidates = (label, limit = 5) => {
    const key = normText(label);
    if (!key) return [];
    const weekSet = new Set(weekCustomers.map(c => c.CustKey));
    const scoreCustomer = (c) => {
      let score = 0;
      for (const field of customerAliases(c).map(normText)) {
        if (!field) continue;
        if (field === key) score += 100;
        else if (field.startsWith(key) || key.startsWith(field)) score += 65;
        else if (field.includes(key) || key.includes(field)) score += 35;
      }
      if (weekSet.has(c.CustKey)) score += 25;
      return score;
    };
    return customers
      .map(c => ({
        custKey: c.CustKey,
        custName: c.CustName,
        orderCode: c.OrderCode || '',
        area: c.CustArea || '',
        score: scoreCustomer(c),
      }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  };

  const suggestProductCandidates = (row, customer, limit = 5) => {
    const exactKeys = new Set([normText(row.productLabel), normText(cleanProductName(row.productLabel))].filter(Boolean));
    const pool = row.productFamily ? products.filter(p => productFamily(p) === row.productFamily) : products;
    return pool
      .map(p => ({
        prodKey: p.ProdKey,
        prodName: p.ProdName,
        displayName: p.DisplayName || '',
        outUnit: p.OutUnit || '박스',
        score: scoreProduct(p, row, exactKeys, customer),
      }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
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
  let skippedIgnoredCustomerCount = 0;
  for (const row of parsedRows) {
    if (row.week) {
      let rowWeek = '';
      try { rowWeek = normalizeImportWeek(row.week); } catch {}
      if (rowWeek && rowWeek !== week) {
        skippedOtherWeek += 1;
        continue;
      }
    }
    // 콜롬비아 농장 열 등 거래처가 아닌 라벨을 "제외" 표시한 경우 — 미매칭·주문·분배 어디에도 넣지 않고 완전히 스킵.
    // 원본 라벨/정규화 라벨 둘 다 확인(override 조회와 동일 규칙).
    if (isRowFromIgnoredCustomer(row.customerLabel, normalizeCustomerLabel(row.customerLabel), ignoredCustomerLabels)) {
      skippedIgnoredCustomerCount += 1;
      continue;
    }
    const customerLabel = normalizeCustomerLabel(row.customerLabel);
    const excelQty = asNumber(row.uploadQty);
    const excelUnit = String(row.outUnit || '').trim();
    const excelOrderQtyRaw = asNumber(row.orderQty);
    const quantityMultiplier = isAlstroImportRow(row) ? 16 : 1;
    if (customerLabel !== row.customerLabel && excelQty !== 0) {
      const aliasKey = `${row.customerLabel}→${customerLabel}`;
      if (!aliasHits[aliasKey]) aliasHits[aliasKey] = { count: 0, qty: 0 };
      aliasHits[aliasKey].count += 1;
      aliasHits[aliasKey].qty += excelQty;
    }
    const explicitCustKey = Number(row.custKey || 0);
    const explicitProdKey = Number(row.prodKey || 0);
    // 미매칭 모달은 원본 라벨(row.customerLabel, alias 정규화 전) 기준으로 override 를 저장하는데
    // 이 매칭 루프는 정규화된 customerLabel 을 쓴다. 둘 중 하나로 override 를 저장해도 항상 찾도록
    // 원본 라벨을 먼저 확인(모달에서 실제 선택한 값 우선) → 정규화 라벨 순으로 조회한다.
    const overrideCustKey = resolveImportCustomerOverrideKey(row.customerLabel, customerLabel, overrideMap);
    // 사용자가 매칭 모달에서 명시적으로 업체를 지정(override)했다면 그 custKey 만 신뢰한다.
    // override 된 custKey 가 (삭제 등으로) 무효할 때 아래 fuzzy 폴백으로 조용히 다른 업체가
    // 선택되면 "선택했는데 다른 업체로 매칭" 문제가 재발하므로, 이 경우는 매칭 실패로 명시 처리한다.
    const customer = (explicitCustKey ? customerByKey.get(explicitCustKey) : null) ||
      (overrideCustKey
        ? customerByKey.get(Number(overrideCustKey)) || null
        : custMap.get(normText(customerLabel)) ||
          uniqueFuzzy(weekCustomers, customerLabel, ['CustName', 'OrderCode', 'Descr']) ||
          uniqueFuzzy(customers, customerLabel, ['CustName', 'OrderCode', 'Descr']));
    const overrideProdKey = productOverrideMap.get(importProductOverrideKey(row));
    const product = (explicitProdKey ? productByKey.get(explicitProdKey) : null)
      || (overrideProdKey ? productByKey.get(Number(overrideProdKey)) : null)
      || chooseProduct(row, customer);
    if (!product || !customer) {
      if (excelQty !== 0) {
        const { reason, matchKind } = classifyImportUnmatchedReason(!!customer, !!product);
        unmatched.push({
          ...row,
          reason,
          matchKind,
          productOverrideKey: importProductOverrideKey(row),
          suggestedCustomers: customer ? [] : suggestCustomerCandidates(customerLabel),
          suggestedProducts: product ? [] : suggestProductCandidates(row, customer),
        });
      }
      continue;
    }
    const dbEarly = dbMap.get(`${customer.CustKey}|${product.ProdKey}`) || {};
    const uploadQty = normalizeUploadQtyForProduct(
      {
        ...row,
        excelQty,
        excelUnit,
        uploadQty: excelQty,
        orderQty: Number(dbEarly.orderQty || 0),
        currentOutQty: Number(dbEarly.currentOutQty || 0),
      },
      product
    );
    uploadedProductKeys.add(Number(product.ProdKey));
    const rowCustOrder = Number.isFinite(Number(row.custOrder)) ? Number(row.custOrder) : Infinity;
    const rowSortRow = Number.isFinite(Number(row.rowNo)) ? Number(row.rowNo) : Infinity;
    const key = `${customer.CustKey}|${product.ProdKey}`;
    const prior = merged.get(key);
    if (prior) {
      prior.uploadQty += uploadQty;
      prior.excelQty += excelQty;
      prior.excelOrderQtyRaw = (prior.excelOrderQtyRaw || 0) + excelOrderQtyRaw;
      if (excelUnit && !prior.excelUnit) prior.excelUnit = excelUnit;
      if (row.sourceType === 'weekPivot') prior.sourceType = 'weekPivot';
      if (row.productFamily && !prior.productFamily) prior.productFamily = row.productFamily;
      if (row.sheetName && !prior.sheetName) prior.sheetName = row.sheetName;
      if (row.productLabel && !prior.productLabel) prior.productLabel = row.productLabel;
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
        excelUnit,
        excelOrderQtyRaw,
        sourceType: row.sourceType || '',
        productFamily: row.productFamily || inferProductFamily(product.ProdName, product.DisplayName, product.FlowerName),
        sheetName: row.sheetName || '',
        productLabel: row.productLabel || '',
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

  // 유령분배 방지: "엑셀에 없으면 삭제"의 대상 범위(missingFromExcel 게이트) — isImportRowInUploadScope 참고.
  let missingFromExcelCount = 0;
  for (const db of dbRows) {
    const key = `${db.CustKey}|${db.ProdKey}`;
    if (merged.has(key)) continue;
    if (!isImportRowInUploadScope(db.CustKey, db.ProdKey, uploadedProductKeys, custKeysInScope, prodKeysInScope)) continue;
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
    .map(r => {
      const prod = productByKey.get(Number(r.prodKey)) || {};
      const excelOrderQty = Number(r.excelOrderQtyRaw || 0) > 0
        ? normalizeUploadQtyForProduct(
          { ...r, excelQty: r.excelOrderQtyRaw, uploadQty: r.excelOrderQtyRaw },
          prod
        )
        : 0;
      const uploadQty = normalizeUploadQtyForProduct(
        { ...r, excelQty: r.excelQty, excelUnit: r.excelUnit, uploadQty: r.excelQty },
        prod
      );
      const qtyRow = { ...r, excelOrderQty, uploadQty };
      const qtyWarnings = detectQtyWarnings(qtyRow, prod);
      const fixCheck = evaluateImportRowFixBlock({
        orderWeek: week,
        countryFlower: prod.CountryFlower,
        prodName: prod.ProdName || r.prodName,
        custKey: r.custKey,
        prodKey: r.prodKey,
        categoryFixStates,
        lineFixStates,
      });
      return {
        ...r,
        uploadQty,
        excelOrderQty,
        changeQty: r.missingFromExcel ? (0 - r.currentOutQty) : (uploadQty - r.orderQty),
        orderDiffQty: r.missingFromExcel ? 0 : (uploadQty - r.orderQty),
        shipmentDiffQty: r.missingFromExcel ? (0 - r.currentOutQty) : (uploadQty - r.currentOutQty),
        needsShipmentApply: !sameQty(uploadQty, r.currentOutQty) || Number(r.shipmentDateIssueCount || 0) > 0,
        qtyWarnings,
        hasQtyWarning: qtyWarnings.some(w => w.severity === 'critical'),
        countryFlower: prod.CountryFlower || '',
        categoryFixStatus: fixCheck.categoryStatus,
        fixBlocked: fixCheck.fixBlocked,
        fixBlockReason: fixCheck.fixBlockReason,
        status: fixCheck.fixBlocked
          ? '확정차단'
          : r.missingFromExcel
          ? '엑셀누락'
          : !dbMap.has(`${r.custKey}|${r.prodKey}`)
          ? '주문없음'
          : sameQty(r.uploadQty, r.orderQty)
            ? '동일'
            : '변경',
      };
    });

  appendPeerQtyWarnings(previewRows);
  appendCustomerPeerQtyWarnings(previewRows, productByKey);

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

  const fixBlockedRows = previewRows.filter(r => r.fixBlocked);
  const changedRows = previewRows.filter(r => !r.fixBlocked && r.status !== '동일');
  const applyRows = previewRows.filter(r => !r.fixBlocked && (r.status !== '동일' || r.needsShipmentApply));
  for (const [alias, hit] of Object.entries(aliasHits)) {
    logs.push(`업체 alias 합산: ${alias} (${hit.count}건, 수량 ${hit.qty})`);
  }
  if (skippedOtherWeek > 0) logs.push(`다른 차수 행 제외: ${skippedOtherWeek}건`);
  if (skippedIgnoredCustomerCount > 0) logs.push(`제외 처리된 업체(농장 등 비거래처) 행 제외: ${skippedIgnoredCustomerCount}건`);
  if (missingFromExcelCount > 0) logs.push(`엑셀에서 빠진 기존 주문/분배: ${missingFromExcelCount}건 (엑셀수량 0으로 삭제대상 표시)`);
  const qtyWarningRows = previewRows.filter(r => r.hasQtyWarning);
  if (qtyWarningRows.length) {
    logs.push(`⚠ 수량 이상 징후 ${qtyWarningRows.length}건 — 적용 전 단위(박스/단/송이)를 확인하세요.`);
    for (const r of qtyWarningRows.slice(0, 8)) {
      const w = (r.qtyWarnings || []).find(x => x.severity === 'critical');
      if (w) logs.push(`  · ${r.custName} / ${r.prodName}: ${w.message}`);
    }
    if (qtyWarningRows.length > 8) logs.push(`  · ... 외 ${qtyWarningRows.length - 8}건`);
  }
  if (fixBlockedRows.length) {
    logs.push(`🔒 확정 품종/라인 차단 ${fixBlockedRows.length}건 — 미확정 품종만 적용 대상 (${orderYear}-${week})`);
    for (const r of fixBlockedRows.slice(0, 6)) {
      logs.push(`  · ${r.custName} / ${r.prodName}: ${r.fixBlockReason || '확정'}`);
    }
    if (fixBlockedRows.length > 6) logs.push(`  · ... 외 ${fixBlockedRows.length - 6}건`);
  }
  logs.push(`매칭 완료: 표시 ${previewRows.length}건, 적용가능 ${applyRows.length}건, 확정차단 ${fixBlockedRows.length}건, 주문변경 ${changedRows.length}건, 미매칭 ${unmatched.length}건`);

  // 수동 업체 매칭 드롭다운용 후보 목록 (전체 거래처)
  const customerOptions = customers
    .map(c => ({ custKey: c.CustKey, custName: c.CustName, orderCode: c.OrderCode || '', area: c.CustArea || '' }))
    .sort((a, b) => `${a.area}${a.custName}`.localeCompare(`${b.area}${b.custName}`));
  const productOptions = products
    .map(p => ({
      prodKey: p.ProdKey,
      prodName: p.ProdName,
      displayName: p.DisplayName || '',
      outUnit: p.OutUnit || '박스',
    }))
    .sort((a, b) => String(a.displayName || a.prodName).localeCompare(String(b.displayName || b.prodName)));

  // 타년도 동일차수 현황 — 매년 차수번호가 반복되므로 "기준연도 외 데이터가 몇 건 제외됐는지"
  // 화면에 명시해 검증 기준(작업일 기준연도 주문등록값)을 눈으로 확인할 수 있게 한다.
  let otherYearWeeks = [];
  try {
    const other = await query(
      `SELECT CAST(sm.OrderYear AS NVARCHAR(4)) AS yr, COUNT(sd.SdetailKey) AS detailCount
         FROM ShipmentMaster sm
         LEFT JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
        WHERE sm.OrderWeek=@week AND ISNULL(sm.isDeleted,0)=0
          AND ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)), @importYear) <> @importYear
        GROUP BY CAST(sm.OrderYear AS NVARCHAR(4))`,
      {
        week: { type: sql.NVarChar, value: week },
        importYear: { type: sql.NVarChar, value: String(orderYear) },
      }
    );
    otherYearWeeks = (other.recordset || []).map(r => ({ year: r.yr, detailCount: Number(r.detailCount) }));
  } catch { /* 정보성 — 실패해도 검증 진행 */ }

  return {
    success: true,
    week,
    orderYear: String(orderYear),
    otherYearWeeks,
    rows: previewRows,
    changedRows,
    applyRows,
    unmatched,
    customerOptions,
    productOptions,
    summaryByCustomer: Object.values(summaryByCustomer),
    qtyWarningCount: qtyWarningRows.length,
    fixBlockedCount: fixBlockedRows.length,
    fixBlockedRows: fixBlockedRows.map(r => ({
      custName: r.custName,
      prodName: r.prodName,
      countryFlower: r.countryFlower,
      reason: r.fixBlockReason,
    })),
    qtyWarningRows: qtyWarningRows.map(r => ({
      custName: r.custName,
      prodName: r.prodName,
      orderQty: r.orderQty,
      uploadQty: r.uploadQty,
      excelQty: r.excelQty,
      warnings: r.qtyWarnings,
    })),
    ignoredCustomerCount: skippedIgnoredCustomerCount,
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

// 계산된 달력 날짜를 자정(UTC) 으로 고정한다.
// mssql 기본 useUTC=true 라 JS Date 의 UTC 시각이 그대로 저장된다.
// 정오(로컬) Date 를 넘기면 KST 기준 9시간 밀려 03:00 으로 저장돼 PeriodDay.BaseYmd(자정) 와
// 정확매칭(견적 GetDetail 의 ShipmentDtm = pd.BaseYmd INNER JOIN)이 깨진다.
function toUtcMidnight(date) {
  if (!date || Number.isNaN(date.getTime?.())) return null;
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0));
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
  return toUtcMidnight(wednesday);
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
         (SdetailKey, ShipmentDtm, ChangeType, BeforeValue, AfterValue, Descr, ChangeID, ChangeDtm)
       SELECT @dk, ShipmentDtm, N'수정', @before, @after, @descr, @uid, GETDATE()
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

async function syncOrderDetailForShipmentImport({ tQ, row, week, orderYear, uid, userName, customer, product, hasOrderYearWeekColumn, hasOrderDetailDescrColumn, allowOrderDelete = true }) {
  const desiredQty = Number(row.uploadQty || 0);

  // Manager 는 UserInfo.UserID 여야 ViewOrder INNER JOIN UserInfo 통과(문자열 '관리자'=UserName 금지).
  const mgrRow = await tQ(`SELECT TOP 1 UserID FROM UserInfo WHERE UserName=N'관리자' ORDER BY UserID`, {});
  const mgr = mgrRow.recordset[0]?.UserID || 'admin';
  const orderCode = customer?.OrderCode || row.orderCode || '';
  const existingMaster = await tQ(
    `SELECT TOP 1 OrderMasterKey
       FROM OrderMaster WITH (UPDLOCK, HOLDLOCK)
      WHERE CustKey=@ck AND OrderWeek=@week AND ISNULL(isDeleted,0)=0
        AND ISNULL(CAST(OrderYear AS NVARCHAR(4)), @importYear) = @importYear
      ORDER BY OrderMasterKey ASC`,
    {
      ck: { type: sql.Int, value: Number(row.custKey) },
      week: { type: sql.NVarChar, value: week },
      importYear: { type: sql.NVarChar, value: String(orderYear) },
    }
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
    if (!allowOrderDelete) {
      return {
        orderCreated,
        detailCreated: false,
        detailUpdated: false,
        detailDeleted: false,
        orderChanged: false,
        orderMasterKey,
        orderDetailKey: detail.OrderDetailKey,
      };
    }
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

async function loadCurrentImportState(tQ, row, week, product = {}, orderYear = String(new Date().getFullYear())) {
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
        AND ISNULL(CAST(om.OrderYear AS NVARCHAR(4)), @importYear) = @importYear
      ORDER BY om.OrderMasterKey ASC, od.OrderDetailKey ASC`,
    {
      ck: { type: sql.Int, value: Number(row.custKey) },
      pk: { type: sql.Int, value: Number(row.prodKey) },
      week: { type: sql.NVarChar, value: week },
      importYear: { type: sql.NVarChar, value: String(orderYear) },
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
        AND ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)), @importYear) = @importYear
        AND sd.ProdKey=@pk`,
    {
      ck: { type: sql.Int, value: Number(row.custKey) },
      pk: { type: sql.Int, value: Number(row.prodKey) },
      week: { type: sql.NVarChar, value: week },
      importYear: { type: sql.NVarChar, value: String(orderYear) },
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

/**
 * 사후 검증(post-apply verification): 트랜잭션 COMMIT 후 별도 쿼리로 DB를 재조회해
 * 의도한 uploadQty 가 실제로 반영됐는지 확인한다. 같은 트랜잭션 값 재사용 금지 —
 * withTransaction 이 이미 commit 한 뒤(applyImportRows 본문에서 이 함수를 호출) query()(비-tQ)로 새로 읽는다.
 * 배치 1건으로 대상 전체를 조회(VALUES 조인) — 건별 왕복 방지.
 * 읽기 전용(SELECT만) — DB 수정 없음. 조회 범위는 targets 로 넘어온 (custKey,prodKey) 로만 한정
 * (이번 apply 대상 외 기존 분배는 조회·비교 대상에 포함되지 않음).
 * @param {Array<{custKey:number, prodKey:number, custName?:string, prodName?:string, intended:number}>} targets
 *   dedupeVerifyTargets 를 거친(=중복 출고일 열 합산 완료, custKey+prodKey 유일) 목록이어야 한다.
 */
async function verifyAppliedShipmentRows(week, targets, orderYear = String(new Date().getFullYear())) {
  if (!targets.length) return { checked: 0, matched: 0, mismatchCount: 0, mismatches: [] };

  const valuesSql = targets.map((_, i) => `(@ck${i},@pk${i})`).join(',');
  const params = {
    week: { type: sql.NVarChar, value: week },
    importYear: { type: sql.NVarChar, value: String(orderYear) },
  };
  targets.forEach((t, i) => {
    params[`ck${i}`] = { type: sql.Int, value: Number(t.custKey) };
    params[`pk${i}`] = { type: sql.Int, value: Number(t.prodKey) };
  });

  const result = await query(
    `WITH target(CustKey, ProdKey) AS (SELECT * FROM (VALUES ${valuesSql}) v(CustKey, ProdKey))
     SELECT t.CustKey, t.ProdKey,
            ISNULL(agg.OutQuantity,0) AS OutQuantity,
            ISNULL(agg.DateQty,0) AS DateQty,
            ISNULL(agg.DetailCount,0) AS DetailCount,
            ISNULL(agg.DateIssueCount,0) AS DateIssueCount
       FROM target t
       OUTER APPLY (
         SELECT
                SUM(ISNULL(sd.OutQuantity,0)) AS OutQuantity,
                SUM(ISNULL(sdt.DateQty,0)) AS DateQty,
                COUNT(*) AS DetailCount,
                SUM(CASE WHEN ISNULL(sd.OutQuantity,0) <> 0
                           AND (
                             sd.ShipmentDtm IS NULL
                             OR ISNULL(sdt.DateQty,0) <> ISNULL(sd.OutQuantity,0)
                             OR ISNULL(sdt.DateRowCount,0) = 0
                             OR ISNULL(sdt.NullDateCount,0) > 0
                           )
                         THEN 1 ELSE 0 END) AS DateIssueCount
           FROM ShipmentMaster sm
           JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey AND sd.ProdKey=t.ProdKey
           OUTER APPLY (
             SELECT
                    SUM(ISNULL(ShipmentQuantity,0)) AS DateQty,
                    COUNT(*) AS DateRowCount,
                    SUM(CASE WHEN ShipmentDtm IS NULL THEN 1 ELSE 0 END) AS NullDateCount
               FROM ShipmentDate
              WHERE SdetailKey=sd.SdetailKey
           ) sdt
          WHERE sm.CustKey=t.CustKey
            AND sm.OrderWeek=@week
            AND ISNULL(sm.isDeleted,0)=0
            AND ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)), @importYear) = @importYear
       ) agg`,
    params
  );

  const actualByKey = new Map(
    (result.recordset || []).map(r => [`${Number(r.CustKey)}|${Number(r.ProdKey)}`, {
      outQuantity: Number(r.OutQuantity || 0),
      dateQty: Number(r.DateQty || 0),
      detailCount: Number(r.DetailCount || 0),
      dateIssueCount: Number(r.DateIssueCount || 0),
    }])
  );

  return compareVerifyResult(targets, actualByKey);
}

// 출고일(요일) 열 처리 점검 메모 (작업 B):
// 물량표에서 같은 거래처+품목이 여러 열(서로 다른 요일=다른 출고일)로 나올 수 있으나,
// buildImportPreview 가 (custKey,prodKey) 기준으로 이미 합산해 단일 uploadQty 로 병합한다(웹은
// 거래처×품목 합산 표시가 정상 — 코디네이터 확인).
// 그 결과 apply 단계는 요일별로 ShipmentDate 를 분할 생성하지 않고, refreshShipmentDatesAfterDetailChange
// 가 "1 ShipmentDetail(합산 OutQuantity) + 기존 ShipmentDate 없으면 1행, 있으면 비율 스케일" 로 처리한다
// (lib/syncShipmentDateEst.js). 즉 sum(ShipmentDate.ShipmentQuantity)=OutQuantity 불변식은 항상 맞춰지지만,
// "요일별로 다른 날짜"라는 의미 정보는 대표 출고일(Customer.BaseOutDay 기준) 하나로 합쳐진다.
// 열별 출고일 분할 생성은 ShipmentMaster/Detail 구조 확장이 필요한 별도 작업 제안 사항 — 여기서는
// verifyAppliedShipmentRows/compareVerifyResult 의 dateSumMatches/dateIssueCount 체크로
// "sum(ShipmentDate)≠OutQuantity" 불변식 위반만 사후 검증에서 잡아 보고한다.
export async function applyImportRows({ rawWeek, rawYear, rows, user, ackQtyWarnings = false, shipmentOnly = false, onProgress = null }) {
  const progress = typeof onProgress === 'function' ? onProgress : () => {};
  const week = normalizeImportWeek(rawWeek);
  const orderYear = resolveImportOrderYear(rawWeek, rawYear);
  if (!week) throw new Error('차수 필요');
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('적용할 행이 없습니다');

  const [categoryFixStates, lineFixStates] = await Promise.all([
    loadCategoryFixStates(query, orderYear, week),
    loadLineFixStates(query, orderYear, week),
  ]);
  const hasOrderYearWeekColumn = await columnExists('OrderMaster', 'OrderYearWeek');
  const hasShipmentYearWeekColumn = await columnExists('ShipmentMaster', 'OrderYearWeek');
  const hasOrderDetailDescrColumn = await columnExists('OrderDetail', 'Descr');

  const uid = user?.userId || 'system';
  const userName = user?.userName || uid;
  const targetRows = rows
    .filter(r => r && r.custKey && r.prodKey && Number.isFinite(Number(r.uploadQty)))
    .map(r => ({ ...r, uploadQty: Number(r.uploadQty) }));

  progress({ total: targetRows.length, done: 0, stage: '사전 확인(품목·현재수량)' });
  const criticalWarnings = [];
  const checkRows = [];
  const productByKey = new Map();
  let preflightIdx = 0;
  for (const row of targetRows) {
    preflightIdx += 1;
    progress({ done: preflightIdx, current: `${row.custName || row.custKey} / ${row.prodName || row.prodKey}` });
    const prod = await query(
      `SELECT TOP 1 OutUnit, ProdName, CountryFlower,
              ISNULL(BunchOf1Box,0) AS BunchOf1Box, ISNULL(SteamOf1Box,0) AS SteamOf1Box
         FROM Product WHERE ProdKey=@pk`,
      { pk: { type: sql.Int, value: Number(row.prodKey) } }
    );
    const productInfo = prod.recordset[0] || {};
    productByKey.set(Number(row.prodKey), productInfo);
    const normalizedQty = normalizeUploadQtyForProduct(row, productInfo);
    const state = await loadCurrentImportState(query, row, week, productInfo, orderYear);
    const checkRow = {
      ...row,
      key: row.key || `${row.custKey}|${row.prodKey}`,
      outUnit: productInfo.OutUnit || row.outUnit || '박스',
      uploadQty: normalizedQty,
      orderQty: state.orderQty,
      currentOutQty: state.currentOutQty,
      excelOrderQty: row.excelOrderQty,
      excelOrderQtyRaw: row.excelOrderQtyRaw,
      excelQty: row.excelQty,
      excelUnit: row.excelUnit,
      sourceType: row.sourceType,
    };
    const warnings = detectQtyWarnings(checkRow, productInfo);
    checkRows.push({
      ...checkRow,
      qtyWarnings: warnings,
      hasQtyWarning: warnings.some(w => w.severity === 'critical'),
    });
  }
  appendPeerQtyWarnings(checkRows);
  appendCustomerPeerQtyWarnings(checkRows, productByKey);
  for (const row of checkRows) {
    for (const w of row.qtyWarnings || []) {
      if (w.severity === 'critical') {
        criticalWarnings.push(`${row.custName || row.custKey} / ${row.prodName || row.prodKey}: ${w.message}`);
      }
    }
  }
  if (criticalWarnings.length && !ackQtyWarnings) {
    const err = new Error(
      `수량 단위 이상 징후 ${criticalWarnings.length}건 — 검증 화면에서 확인 후 다시 적용하세요.\n` +
      criticalWarnings.slice(0, 5).join('\n') +
      (criticalWarnings.length > 5 ? `\n... 외 ${criticalWarnings.length - 5}건` : '')
    );
    err.code = 'QTY_WARNING';
    err.qtyWarnings = criticalWarnings;
    throw err;
  }

  const verifyTargets = [];
  progress({ done: 0, stage: '적용 중(주문·분배 입력)', current: '' });
  const result = await withTransaction(async (tQ) => {
    const applied = [];
    let skippedNoChangeCount = 0;
    let skippedFixedCount = 0;
    const skippedFixedLogs = [];
    let applyIdx = 0;
    for (const row of targetRows) {
      applyIdx += 1;
      progress({ done: applyIdx, current: `${row.custName || row.custKey} / ${row.prodName || row.prodKey}` });
      const prodMeta = productByKey.get(Number(row.prodKey)) || {};
      const fixCheck = evaluateImportRowFixBlock({
        orderWeek: week,
        countryFlower: prodMeta.CountryFlower || row.countryFlower,
        prodName: prodMeta.ProdName || row.prodName,
        custKey: row.custKey,
        prodKey: row.prodKey,
        categoryFixStates,
        lineFixStates,
      });
      if (fixCheck.fixBlocked) {
        skippedFixedCount += 1;
        skippedFixedLogs.push(`${row.custName || row.custKey} / ${row.prodName || row.prodKey}: ${fixCheck.fixBlockReason}`);
        continue;
      }

      const prod = await tQ(
        `SELECT TOP 1 p.OutUnit, p.EstUnit, p.CounName, ISNULL(p.Descr,'') AS ProdDescr,
                ISNULL(p.BunchOf1Box,0) AS BunchOf1Box, ISNULL(p.SteamOf1Bunch,0) AS SteamOf1Bunch,
                ISNULL(p.SteamOf1Box,0) AS SteamOf1Box,
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
      const normalizedUploadQty = normalizeUploadQtyForProduct(row, productInfo);
      const applyRow = { ...row, uploadQty: normalizedUploadQty };
      const units = distributeUnits(normalizedUploadQty, productInfo);
      const estQty = units.estQty;
      const fallbackCost = Number(productInfo.Cost || 0);
      const currentState = await loadCurrentImportState(tQ, applyRow, week, productInfo, orderYear);
      // 사후 검증 대상 등록 — 이 행이 "다뤄야 했던" 최종 의도값(OutUnit 기준).
      // targetRows 는 preview 단계(buildImportPreview)에서 이미 (custKey,prodKey) 기준으로
      // 여러 출고일(요일) 열을 합산한 유일 행이어야 하지만, 방어적으로 verifyAppliedShipmentRows
      // 호출 전에 (custKey,prodKey) 로 다시 한 번 합산·중복제거한다(아래 dedupeVerifyTargets).
      verifyTargets.push({
        custKey: row.custKey,
        custName: row.custName || row.customerLabel || row.custKey,
        prodKey: row.prodKey,
        prodName: row.displayName || row.prodName || row.productLabel || row.prodKey,
        intended: units.outQty,
      });
      if (sameQty(currentState.orderQty, applyRow.uploadQty) && sameQty(currentState.currentOutQty, units.outQty) && currentState.dateIssueCount === 0) {
        skippedNoChangeCount += 1;
        continue;
      }
      const shipDate = calcShipDate(week, orderYear, customerInfo.BaseOutDay ?? 0);
      if (!shipDate) throw new Error(`${applyRow.custName || applyRow.custKey} / ${applyRow.prodName || applyRow.prodKey}: 출고일 계산 실패`);

      const orderPlan = resolveImportOrderSyncPlan({
        orderQty: currentState.orderQty,
        uploadQty: applyRow.uploadQty,
      });
      let orderMutation = {
        orderCreated: false,
        detailCreated: false,
        detailUpdated: false,
        detailDeleted: false,
        orderChanged: false,
      };
      // shipmentOnly: 사용자 요청 시 OrderDetail(주문)은 절대 건드리지 않고 ShipmentDetail(분배)만 반영.
      if (!shipmentOnly && orderPlan.action === 'sync') {
        orderMutation = await syncOrderDetailForShipmentImport({
          tQ,
          row: applyRow,
          week,
          orderYear,
          uid,
          userName,
          customer: customerInfo,
          product: productInfo,
          hasOrderYearWeekColumn,
          hasOrderDetailDescrColumn,
          allowOrderDelete: orderPlan.allowOrderDelete,
        });
      }

      const sm = await tQ(
        `SELECT TOP 1 ShipmentKey FROM ShipmentMaster WITH (UPDLOCK, HOLDLOCK)
          WHERE CustKey=@ck AND OrderWeek=@week AND ISNULL(isDeleted,0)=0
            AND ISNULL(CAST(OrderYear AS NVARCHAR(4)), @importYear) = @importYear
          ORDER BY ISNULL(isFix,0) DESC, ShipmentKey ASC`,
        {
          ck: { type: sql.Int, value: Number(row.custKey) },
          week: { type: sql.NVarChar, value: week },
          importYear: { type: sql.NVarChar, value: String(orderYear) },
        }
      );

      let shipmentKey = sm.recordset[0]?.ShipmentKey;
      if (!shipmentKey && applyRow.uploadQty > 0) {
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

      if (applyRow.uploadQty <= 0) {
        if (oldDetail) {
          const log = importMemo(userName, oldQty, 0);
          await insertShipmentHistory(tQ, oldDetail.SdetailKey, oldQty, 0, log, uid);
          await purgeZeroOutShipmentDetail(tQ, oldDetail.SdetailKey, sql);
          shipmentChanged = true;
          shipmentAction = '분배삭제';
        }
      } else if (oldDetail && !sameQty(oldQty, units.outQty)) {
        const log = importMemo(userName, oldQty, applyRow.uploadQty);
        const newDescr = appendDescr(oldDetail.Descr, log);
        await tQ(
          `UPDATE ShipmentDetail
              SET CustKey=@ck,
                  ShipmentDtm=@dt, OutQuantity=@outQty, EstQuantity=@estQty,
                  BoxQuantity=@box, BunchQuantity=@bunch, SteamQuantity=@steam,
                  Cost=CASE WHEN ISNULL(Cost,0)>0 THEN Cost ELSE @fallbackCost END,
                  Amount=ROUND(ISNULL(NULLIF(Cost,0), @fallbackCost) * @estQty / 1.1, 0),
                  Vat=((ISNULL(NULLIF(Cost,0), @fallbackCost) * @estQty) - ROUND(ISNULL(NULLIF(Cost,0), @fallbackCost) * @estQty / 1.1, 0)),
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
        await refreshShipmentDatesAfterDetailChange(tQ, oldDetail.SdetailKey, sql, { shipDtm: shipDate });
        await insertShipmentHistory(tQ, oldDetail.SdetailKey, oldQty, units.outQty, log, uid);
        shipmentChanged = true;
        shipmentAction = '분배수정';
      } else if (oldDetail) {
        const existingOut = Number(oldDetail.OutQuantity || 0);
        if (!isActiveShipmentOutQty(existingOut) && applyRow.uploadQty <= 0) {
          await purgeZeroOutShipmentDetail(tQ, oldDetail.SdetailKey, sql);
          shipmentChanged = true;
          shipmentAction = '유령삭제';
        } else if (orderMutation.orderChanged || currentState.dateIssueCount > 0) {
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
                    Vat=((ISNULL(NULLIF(Cost,0), @fallbackCost) * @estQty) - ROUND(ISNULL(NULLIF(Cost,0), @fallbackCost) * @estQty / 1.1, 0))
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
          await refreshShipmentDatesAfterDetailChange(tQ, oldDetail.SdetailKey, sql, { shipDtm: shipDate });
          shipmentChanged = true;
          shipmentAction = '출고일지정';
        } else {
          shipmentAction = '분배유지';
        }
      } else {
        const log = importMemo(userName, 0, applyRow.uploadQty);
        const detailKey = await tryInsertWithRetry(tQ, 'ShipmentDetail', 'SdetailKey', async (newDk) => {
          await tQ(
            `INSERT INTO ShipmentDetail
               (SdetailKey,ShipmentKey,CustKey,ProdKey,ShipmentDtm,OutQuantity,EstQuantity,BoxQuantity,BunchQuantity,SteamQuantity,Cost,Amount,Vat,isFix,Descr)
             VALUES
               (@dk,@sk,@ck,@pk,@dt,@outQty,@estQty,@box,@bunch,@steam,@cost,
                ROUND(@cost * @estQty / 1.1, 0), ((@cost * @estQty) - ROUND(@cost * @estQty / 1.1, 0)),0,@log)`,
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
        await refreshShipmentDatesAfterDetailChange(tQ, detailKey, sql, { shipDtm: shipDate });
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
        const logText = buildApplyLog(row, appliedRow);
        applied.push({ ...appliedRow, log: logText });
        progress({ log: `[${applyIdx}/${targetRows.length}] ${logText}` });
      }
    }
    return { applied, skippedNoChangeCount, skippedFixedCount, skippedFixedLogs };
  });
  const appliedRows = result.applied || [];

  // 사후 검증(post-apply verification) — 트랜잭션 COMMIT 이후 새 쿼리로 재조회.
  // "생성 이력은 남는데 최종 상세가 안 남는" 조용한 미반영을 apply 응답에서 바로 드러낸다.
  // dedupeVerifyTargets: 같은 (custKey,prodKey) 가 여러 출고일(요일) 열로 대상목록에 중복돼 있어도
  // intended 를 합산한 뒤 "합산 후 최종값" 하나로 DB 합계와 비교 — 정상 분배 오탐(false mismatch) 방지.
  const dedupedVerifyTargets = dedupeVerifyTargets(verifyTargets);
  progress({ stage: '사후 검증(DB 재조회 대조)', current: '' });
  let verification = { checked: 0, matched: 0, mismatchCount: 0, mismatches: [] };
  try {
    verification = await verifyAppliedShipmentRows(week, dedupedVerifyTargets, orderYear);
  } catch (e) {
    verification = { checked: dedupedVerifyTargets.length, matched: 0, mismatchCount: 0, mismatches: [], error: e.message };
  }

  const logs = [
    `${week}차 엑셀 검증 적용 완료: 적용 ${appliedRows.length}건, 이미 동일 ${result.skippedNoChangeCount || 0}건, 확정차단 ${result.skippedFixedCount || 0}건`,
    `주문 신규/추가 ${appliedRows.filter(r => r.orderCreated || r.detailCreated).length}건, 주문수정 ${appliedRows.filter(r => r.detailUpdated).length}건, 주문삭제 ${appliedRows.filter(r => r.detailDeleted).length}건`,
    `분배 신규 ${appliedRows.filter(r => r.shipmentAction === '분배신규').length}건, 분배수정 ${appliedRows.filter(r => r.shipmentAction === '분배수정').length}건, 분배삭제 ${appliedRows.filter(r => r.shipmentAction === '분배삭제').length}건`,
    ...((result.skippedFixedLogs || []).slice(0, 20)),
    ...(result.skippedFixedLogs?.length > 20 ? [`... 확정차단 외 ${result.skippedFixedLogs.length - 20}건`] : []),
    ...appliedRows.slice(0, 500).map(r => r.log),
    verification.error
      ? `⚠ 사후 검증 실패(반영 여부 미확인): ${verification.error}`
      : `사후 검증: 확인 ${verification.checked}건 중 정상 반영 ${verification.matched}건, 불일치 ${verification.mismatchCount}건`,
    ...(verification.mismatches || []).slice(0, 20).map(m =>
      `  ⚠ ${m.custName} / ${m.prodName}: 의도 ${m.intended} vs 실제 ${m.actual} (${m.reason})`),
    ...((verification.mismatches || []).length > 20 ? [`  ⚠ ... 불일치 외 ${verification.mismatches.length - 20}건`] : []),
  ];

  return {
    success: true,
    week,
    appliedCount: appliedRows.length,
    skippedNoChangeCount: result.skippedNoChangeCount || 0,
    skippedFixedCount: result.skippedFixedCount || 0,
    shipmentChangedCount: appliedRows.filter(r => r.shipmentChanged).length,
    orderChangedCount: appliedRows.filter(r => r.orderChanged).length,
    orderCreatedCount: appliedRows.filter(r => r.orderCreated || r.detailCreated).length,
    orderUpdatedCount: appliedRows.filter(r => r.detailUpdated).length,
    orderDeletedCount: appliedRows.filter(r => r.detailDeleted).length,
    logs,
    appliedRows,
    verification,
  };
}

export async function preDistributeImportProductsToOrders({ rawWeek, rawYear, rows, user }) {
  const week = normalizeImportWeek(rawWeek);
  const orderYear = resolveImportOrderYear(rawWeek, rawYear);
  if (!week) throw new Error('차수 필요');
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('업로드 파일에서 매칭된 품목이 없습니다');

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

  const [categoryFixStates, lineFixStates] = await Promise.all([
    loadCategoryFixStates(query, orderYear, week),
    loadLineFixStates(query, orderYear, week),
  ]);

  const result = await withTransaction(async (tQ) => {
    const applied = [];
    let skippedNoOrderCount = 0;
    let skippedNoChangeCount = 0;
    let skippedZeroNoShipmentCount = 0;
    let skippedFixedCount = 0;

    for (const row of targetRows) {
      const prodScope = await tQ(
        `SELECT TOP 1 ProdName, CountryFlower FROM Product WHERE ProdKey=@pk`,
        { pk: { type: sql.Int, value: Number(row.prodKey) } },
      );
      const scope = prodScope.recordset[0] || {};
      const fixCheck = evaluateImportRowFixBlock({
        orderWeek: week,
        countryFlower: scope.CountryFlower || row.countryFlower,
        prodName: scope.ProdName || row.prodName,
        custKey: row.custKey,
        prodKey: row.prodKey,
        categoryFixStates,
        lineFixStates,
      });
      if (fixCheck.fixBlocked) {
        skippedFixedCount += 1;
        continue;
      }

      const prod = await tQ(
        `SELECT TOP 1 p.OutUnit, p.EstUnit, p.CounName, ISNULL(p.Descr,'') AS ProdDescr,
                ISNULL(p.BunchOf1Box,0) AS BunchOf1Box, ISNULL(p.SteamOf1Bunch,0) AS SteamOf1Bunch,
                ISNULL(p.SteamOf1Box,0) AS SteamOf1Box,
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
            AND ISNULL(CAST(om.OrderYear AS NVARCHAR(4)), @importYear) = @importYear
          ORDER BY om.OrderMasterKey ASC, od.OrderDetailKey ASC`,
        {
          ck: { type: sql.Int, value: Number(row.custKey) },
          pk: { type: sql.Int, value: Number(row.prodKey) },
          week: { type: sql.NVarChar, value: week },
          importYear: { type: sql.NVarChar, value: String(orderYear) },
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
      const units = distributeUnits(desiredQty, productInfo);
      const estQty = units.estQty;
      const fallbackCost = Number(productInfo.Cost || 0);
      const currentState = await loadCurrentImportState(tQ, row, week, productInfo, orderYear);
      if (sameQty(currentState.currentOutQty, units.outQty) && currentState.dateIssueCount === 0) {
        skippedNoChangeCount += 1;
        continue;
      }

      const shipDate = calcShipDate(week, orderYear, customerInfo.BaseOutDay ?? 0);
      if (!shipDate) throw new Error(`${label.custName} / ${label.prodName}: 출고일 계산 실패`);

      const sm = await tQ(
        `SELECT TOP 1 ShipmentKey FROM ShipmentMaster WITH (UPDLOCK, HOLDLOCK)
          WHERE CustKey=@ck AND OrderWeek=@week AND ISNULL(isDeleted,0)=0
            AND ISNULL(CAST(OrderYear AS NVARCHAR(4)), @importYear) = @importYear
          ORDER BY ISNULL(isFix,0) DESC, ShipmentKey ASC`,
        {
          ck: { type: sql.Int, value: Number(row.custKey) },
          week: { type: sql.NVarChar, value: week },
          importYear: { type: sql.NVarChar, value: String(orderYear) },
        }
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
        await purgeZeroOutShipmentDetail(tQ, oldDetail.SdetailKey, sql);
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
                  Vat=((ISNULL(NULLIF(Cost,0), @fallbackCost) * @estQty) - ROUND(ISNULL(NULLIF(Cost,0), @fallbackCost) * @estQty / 1.1, 0)),
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
        await refreshShipmentDatesAfterDetailChange(tQ, oldDetail.SdetailKey, sql, { shipDtm: shipDate });
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
                ROUND(@cost * @estQty / 1.1, 0), ((@cost * @estQty) - ROUND(@cost * @estQty / 1.1, 0)),0,@log)`,
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
        await refreshShipmentDatesAfterDetailChange(tQ, detailKey, sql, { shipDtm: shipDate });
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
