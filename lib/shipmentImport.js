import { allocationDateHeader, planUploadedDates, addUploadedDates } from './shipmentUploadDates.js';
import { distributionDateSnapshot, readDistributionDateContext, executeDistributionDateSave } from './shipmentDistributionDates.js';
import { assertDirectionalGateCapability, lockDirectionalGate } from './estimateDirectionalQuantity.js';
import { query, withTransaction, sql } from './db';
import { requireDistributionMode, normalizeImportInput, projectImportQuantity, verifiedImportTarget, assertAdditionBaseline } from './shipmentImportMode.js';
import { assignmentsKey, assertFarmOnlyPreserved } from './shipmentFarmText.js';
import { validateImportFarmRow, saveImportFarmRow } from './shipmentFarmImport.js';
import { withImportApplyLease } from './importApplyLease.cjs';
import { assertShipmentLineHasOrder, assertShipmentWeekConsistent } from './shipmentEstimateGuard.js';
import { assertReplacementCoverage, assertReplacementRows, replacementScopeSql } from './shipmentReplacementPlan.js';
import { getEarlyShipmentExclusions, assertEarlyShipmentSourceIntegrity } from './weekdayEarlyShipmentStore.js';
import { requireEarlyImportMode, projectEarlyImportTarget, findEarlyExclusion, verifyEarlyImportPreviewRow } from './weekdayEarlyShipmentImport.js';
import { resolveActiveOrderYear, requireOrderYear } from './orderUtils';
import { appendDescr } from './shipmentDescr';
import { distributeUnits, amountVatFromCostEst } from './distributeUnits';
import { chinaOrderUnits } from './chinaOrderUnits.js';
import { safeNextShipmentDetailKey } from './safeNextKey.js';
import { refreshShipmentDatesAfterDetailChange } from './syncShipmentDateEst.js';
import { readDutchScopeSnapshot, assertUniqueDutchLedger, findDutchFarmQtyBlockers, findDutchDateIntegrityBlockers } from './dutchVolumeDistributionSnapshot.js';
import { dutchError, assessDutchPriceReadback, dutchEstUnitConversionIssue, dutchComputedValueIssue } from './dutchVolumeDistribution.js';
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
  toOrderUnits,
  appendPeerQtyWarnings,
  appendCustomerPeerQtyWarnings,
  evaluateImportFinalStateStale,
  resolveImportOrderSyncPlan,
  importProductOverrideKey,
  classifyImportUnmatchedReason,
  dedupeVerifyTargets,
  isShipmentImportVerificationSuccessful,
  compareVerifyResult,
  resolveImportWriteIntent,
} from './shipmentImportQty.js';
import {
  attachShipmentImportVerification,
  createShipmentImportAuditBatch,
  failShipmentImportAuditBatch,
  finishShipmentImportAuditBatch,
  markShipmentImportAuditAppliedInTransaction,
  summarizeShipmentImportResult,
} from './shipmentImportAudit.js';
import {
  assertShipmentImportSnapshotSchema,
  buildRowSnapshotEntries,
  captureImportRowSnapshot,
  insertSnapshotRows,
  mergeSnapshotEntries,
} from './shipmentImportSnapshot.js';
import {
  normText,
  matchDutchProductByColor,
  normalizeImportWeek,
  sameQty,
  extractMoqText,
  resolvePreviewOverrideMaps,
  matchAndMergePreviewRows,
} from './shipmentImport/matchingEngine.js';
import {
  sortByExcelOrder,
  summarizePreviewByCustomer,
  appendPreviewDiagnosticLogs,
  buildImportDropdownOptions,
  formatImportPreviewPayload,
} from './shipmentImport/previewSummary.js';
import {
  isPkCollision,
  syncKeyNumbering,
  calcShipDate,
  orderQtyFromDetail,
  importMemo,
  insertOrderHistory,
  insertShipmentHistory,
  orderApplyAction as formatOrderApplyAction,
  loadCurrentImportState,
  updateDutchDatePrices,
  buildApplyLog,
  assertDutchNativeVisibility,
  verifyChinaPostWriteOrders,
  buildApplyRowsResult,
} from './shipmentImport/applyHelpers.js';

export { normalizeUploadQtyForProduct, detectQtyWarnings, hasCriticalQtyWarnings, appendPeerQtyWarnings, appendCustomerPeerQtyWarnings, resolveImportOrderSyncPlan, resolveImportWriteIntent, importProductOverrideKey, classifyImportUnmatchedReason } from './shipmentImportQty.js';
export { normText, matchDutchProductByColor } from './shipmentImport/matchingEngine.js';
export { preDistributeImportProductsToOrders } from './shipmentImport/preDistributeOrders.js';

/** 물량표 업로드용 연도 해석 — normalizeOrderYear 의 "NN-NN → 2025 레거시" 규칙을 타면 안 된다.
 * (그 규칙 때문에 28-01 업로드가 OrderYear=2025 마스터 + 2025-07 출고일을 생성한 사고: 2026-07-08) */
export function resolveImportOrderYear(rawWeek, rawYear) {
  return resolveActiveOrderYear(rawWeek, rawYear);
}

const SUMMARY_LABELS = new Set(['주문', '입고', '재고', '잔량']);
const PRODUCT_PREFIX_RE = /^((?:spray|spary)\s*rose\s*\/?|spray\s*|carnation|mini\s*carnation|rose\s*\/?|alstromeria|alstroemeria|hydrangea)\s*/i;
const PRODUCT_WORD_RE = /\b(spray\s+rose|rose|carnation|hydrangea|alstroe?meria)\b\s*\/?\s*/gi;
const IMPORT_PRODUCT_ALIASES = {
  // 1901 카네이션 물량표에서 Mandalay가 깨진 표기로 저장되어 있다.
  'ㄱ3': 'Mandalay',
};

function inferProductFamily(...values) {
  for (const value of values) {
    const text = String(value || '').toLowerCase();
    if (!text) continue;
    if (/루스커스|ruscus/.test(text)) return 'ruscus';
    if (/미니\s*카네이션|mini\s*carnation|minicarnation/.test(text)) return 'minicarnation';
    if (/카네이션|carnation/.test(text)) return 'carnation';
    if (/장미|\brose\b/.test(text)) return 'rose';
    if (/수국|hydrangea/.test(text)) return 'hydrangea';
    if (/알스트로|alstroemeria|alstromeria/.test(text)) return 'alstroemeria';
  }
  return '';
}

function sourceProductFamily(label, ...headings) {
  const family = inferProductFamily(label);
  return { productFamily: family || inferProductFamily(...headings), productFamilySource: family ? 'row' : 'heading', productHeadings: headings.filter(Boolean).map(String) };
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

function asNumber(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const n = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
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
    const blankInExcel = !hasCellValue(XLSX, sheet, r, cols.outQty);

    const productLabel = String(cellValue(XLSX, sheet, r, cols.product) || '').trim();
    if (!productLabel || /합\s*계|total/i.test(productLabel)) continue;

    rows.push({
      sourceType: 'weekPivot',
      sheetName,
      rowNo: r,
      colNo: cols.outQty,
      customerLabel: sheetName,
      productLabel: cleanProductName(productLabel),
      ...sourceProductFamily([cols.category ? cellValue(XLSX, sheet, r, cols.category) : '', productLabel].join(' '), sheetName),
      uploadQty: asNumber(cellValue(XLSX, sheet, r, cols.outQty)),
      blankInExcel,
      hasFinalDistributionDirective: true,
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
  const hasBlockTitle = /\d{2,4}[-－]?\d*|카네이션|장미|수국|알스트로|루스커스|rose|carnation|hydrangea|alstro|ruscus/i.test(title);
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
  // Dedicated CL header is metadata, never a product or allocation quantity.
  const dataStartRow = headerRow + (String(cellValue(XLSX, sheet, headerRow + 1, 1)).trim() === '클라이언트 번호' ? 2 : 1);

  const columns = [];
  for (let c = 1; c < summaryStart; c += 1) {
    const customer = String(cellValue(XLSX, sheet, headerRow, c) || '').trim();
    if (/^칼라$|^컬러$|^박스\(자동\)$/i.test(customer)) continue;
    if (!customer || SUMMARY_LABELS.has(customer)) continue;

    let productCol = null;
    for (let pc = c - 1; pc >= 1; pc -= 1) {
      if ((sheet['!merges'] || []).some(merge =>
        merge.s.r <= headerRow - 1 && merge.e.r >= headerRow - 1 &&
        merge.s.c < pc - 1 && merge.e.c >= pc - 1)) continue;
      const header = String(cellValue(XLSX, sheet, headerRow, pc) || '').trim();
      if (header) continue;
      const sample = String(cellValue(XLSX, sheet, dataStartRow, pc) || '').trim();
      if (sample && productColumnStats(XLSX, sheet, range, dataStartRow, pc).valid) {
        productCol = pc;
        break;
      }
    }
    if (!productCol) continue;
    columns.push({ col: c, customer, productCol });
  }
  const summaryColumns = {};
  for (let c = summaryStart; c <= range.e.c + 1; c += 1) {
    const label = String(cellValue(XLSX, sheet, headerRow, c) || '').trim();
    if (SUMMARY_LABELS.has(label) && !summaryColumns[label]) summaryColumns[label] = c;
  }
  logs.push(`엑셀 헤더 감지: R${headerRow}, 업체열 ${columns.length}개, 요약 시작열 C${summaryStart}`);
  return { columns, summaryColumns, headerRow, dataStartRow };
}

function detectProductRows(XLSX, sheet, range, productCols, dataStartRow, logs, sheetName) {
  const rowsByProductCol = new Map();

  for (const productCol of productCols) {
    const rows = new Set();
    let firstRow = null;
    let lastRow = null;

    for (let r = dataStartRow; r <= range.e.r + 1; r += 1) {
      const rawProduct = String(cellValue(XLSX, sheet, r, productCol) || '').trim();
      if (/^(합\s*계|total)$/i.test(rawProduct) && firstRow) break;
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

function normKeymapLabel(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function parseKeymapSheet(XLSX, workbook, selectedSheets) {
  const sheet = workbook.Sheets?.['_keymap'];
  const custKeyByLabel = new Map();
  const prodKeyByLabel = new Map();
  const custKeysBySheet = new Map();
  const prodKeysBySheet = new Map();
  const pairKeysInScope = new Set();
  if (!sheet) return { custKeyByLabel, prodKeyByLabel, pairKeysInScope, found: false };
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  for (let r = 2; r <= range.e.r + 1; r += 1) {
    const kind = String(cellValue(XLSX, sheet, r, 1) || '').trim();
    const sheetName = String(cellValue(XLSX, sheet, r, 2) || '').trim();
    const label = normKeymapLabel(cellValue(XLSX, sheet, r, 3));
    const key = asNumber(cellValue(XLSX, sheet, r, 4));
    if (!sheetName || !label || !key || !selectedSheets.has(sheetName)) continue;
    if (kind === 'cust') {
      custKeyByLabel.set(`${sheetName}|${label}`, key);
      if (!custKeysBySheet.has(sheetName)) custKeysBySheet.set(sheetName, new Set());
      custKeysBySheet.get(sheetName).add(Number(key));
    } else if (kind === 'prod') {
      prodKeyByLabel.set(`${sheetName}|${label}`, key);
      if (!prodKeysBySheet.has(sheetName)) prodKeysBySheet.set(sheetName, new Set());
      prodKeysBySheet.get(sheetName).add(Number(key));
    }
  }
  for (const [sheetName, custKeys] of custKeysBySheet.entries()) {
    const prodKeys = prodKeysBySheet.get(sheetName) || new Set();
    for (const custKey of custKeys) {
      for (const prodKey of prodKeys) pairKeysInScope.add(`${custKey}|${prodKey}`);
    }
  }
  return { custKeyByLabel, prodKeyByLabel, pairKeysInScope, found: true };
}

export function parseAllocationWorkbook(XLSX, workbook, options = {}) {
  const logs = [];
  const rows = [];
  const visibleSheets = (workbook.SheetNames || []).filter((name, index) => name !== '_keymap' && name !== '농장분배_검증' && !workbook.Workbook?.Sheets?.[index]?.Hidden);
  const sheetNames = options.sheetName ? visibleSheets.filter(name => name === options.sheetName) : visibleSheets;
  if (!sheetNames.length) throw new Error('선택한 업로드 시트를 찾을 수 없습니다.');
  logs.push(`워크북 로드: 시트 ${sheetNames.length}개`);

  const { custKeyByLabel, prodKeyByLabel, pairKeysInScope, found: keymapFound } = parseKeymapSheet(XLSX, workbook, new Set(sheetNames));
  if (keymapFound) logs.push(`키맵 감지: 거래처 ${custKeyByLabel.size}개, 품목 ${prodKeyByLabel.size}개 (텍스트 기준 정확매칭)`);

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
        if (r.custKey && r.prodKey) pairKeysInScope.add(`${Number(r.custKey)}|${Number(r.prodKey)}`);
      });
      continue;
    }
    const { columns: customerColumns, summaryColumns, headerRow, dataStartRow } = detectCustomerColumns(XLSX, sheet, range, logs);
    if (customerColumns.length === 0) {
      logs.push(`${sheetName}: 업체열 없음, 건너뜀`);
      continue;
    }

    const date1904 = Boolean(workbook.Workbook?.WBProps?.date1904);
    const datesByColumn = new Map(customerColumns.map(({col}) => [
      col, headerRow > 1 ? allocationDateHeader(sheet[cellRef(XLSX, headerRow - 1, col)], XLSX, date1904) : '',
    ]));
    const headerFamilies = new Set();
    for (let r = 1; r < dataStartRow; r++) for (let c = 1; c <= Math.min(range.e.c + 1, 20); c++) {
      const family = inferProductFamily(cellValue(XLSX, sheet, r, c));
      if (family) headerFamilies.add(family);
    }
    const headerFamily = headerFamilies.size === 1 ? [...headerFamilies][0] : '';
    const productCols = [...new Set(customerColumns.map(cc => cc.productCol))];
    const productRowsByCol = detectProductRows(XLSX, sheet, range, productCols, dataStartRow, logs, sheetName);

    for (let r = dataStartRow; r <= range.e.r + 1; r += 1) {
      for (const cc of customerColumns) {
        if (!productRowsByCol.get(cc.productCol)?.has(r)) continue;
        // 이 파일은 최종 분배표다. 빈 셀도 분배 0 지시이며 주문등록값은 보존한다.
        const blankInExcel = !hasCellValue(XLSX, sheet, r, cc.col);
        const rawProduct = String(cellValue(XLSX, sheet, r, cc.productCol) || '').trim();
        const qty = asNumber(cellValue(XLSX, sheet, r, cc.col));
        const custKey = custKeyByLabel.get(`${sheetName}|${normKeymapLabel(cc.customer)}`) || 0;
        const prodKey = prodKeyByLabel.get(`${sheetName}|${normKeymapLabel(rawProduct)}`) || 0;
        rows.push({
          sheetName,
          rowNo: r,
          colNo: cc.col,
          custOrder: sheetIndex * 100000 + cc.col,
          customerLabel: cc.customer,
          productLabel: cleanProductName(rawProduct),
          rawProductLabel: rawProduct,
          ...sourceProductFamily(rawProduct, cellValue(XLSX, sheet, 1, cc.productCol), cellValue(XLSX, sheet, 2, cc.productCol), sheetName, headerFamily),
          uploadQty: qty,
          ...(datesByColumn.get(cc.col) ? { shipmentDateHeader: datesByColumn.get(cc.col) } : {}),
          alstroErpQuantity: String(cellValue(XLSX, sheet, 2, 1)).trim() === '알스트로 ERP 수량 (÷16 참고)',
          blankInExcel,
          hasFinalDistributionDirective: true,
          orderQty: summaryColumns?.['주문'] ? asNumber(cellValue(XLSX, sheet, r, summaryColumns['주문'])) : 0,
          incomingQty: summaryColumns?.['입고'] ? asNumber(cellValue(XLSX, sheet, r, summaryColumns['입고'])) : 0,
          stockQty: summaryColumns?.['재고'] ? asNumber(cellValue(XLSX, sheet, r, summaryColumns['재고'])) : 0,
          remainingQty: summaryColumns?.['잔량'] ? asNumber(cellValue(XLSX, sheet, r, summaryColumns['잔량'])) : 0,
          ...(custKey ? { custKey } : {}),
          ...(prodKey ? { prodKey } : {}),
        });
        if (custKey) custKeysInScope.add(Number(custKey));
        if (prodKey) prodKeysInScope.add(Number(prodKey));
        if (custKey && prodKey) pairKeysInScope.add(`${Number(custKey)}|${Number(prodKey)}`);
      }
    }
  }

  logs.push(`엑셀 셀 읽기 완료: 업체×품목 후보 ${rows.length}건`);
  return { rows, logs, keymapFound, custKeysInScope, prodKeysInScope, pairKeysInScope };
}

export async function buildImportPreview({ parsedRows, rawWeek, rawYear, customerOverrides, productOverrides, custKeysInScope, prodKeysInScope, pairKeysInScope, strictMatching = false, countryFilter = '', requestedProductFamily = '', fileBasedScope = false, queryFn = query, earlyImportMode = null, earlyExclusionLoader = null, distributionMode = 'REPLACE' }) {
  const importMode = requireDistributionMode(distributionMode);
  const week = normalizeImportWeek(rawWeek);
  const orderYear = rawYear == null ? resolveImportOrderYear(rawWeek) : requireOrderYear(rawWeek, rawYear).orderYear;
  const logs = [];
  if (!week) throw new Error('차수 필요');

  const [categoryFixStates, lineFixStates] = queryFn === query
    ? await Promise.all([
      loadCategoryFixStates(queryFn, orderYear, week),
      loadLineFixStates(queryFn, orderYear, week),
    ])
    : [await loadCategoryFixStates(queryFn, orderYear, week), await loadLineFixStates(queryFn, orderYear, week)];

  const {
    overrideMap,
    ignoredCustomerLabels,
    productOverrideMap,
    skippedProductLabels,
    ambiguousProductChoices,
  } = resolvePreviewOverrideMaps({ customerOverrides, productOverrides, parsedRows, fileBasedScope });

  const productResult = await queryFn(
    `SELECT ProdKey, ProdName, DisplayName, FlowerName, CounName, CountryFlower, OutUnit, EstUnit,
            ISNULL(BunchOf1Box,0) AS BunchOf1Box, ISNULL(SteamOf1Bunch,0) AS SteamOf1Bunch,
            ISNULL(SteamOf1Box,0) AS SteamOf1Box
       FROM Product
      WHERE ISNULL(isDeleted,0)=0`
  );
  const customerResult = await queryFn(
    `SELECT CustKey, CustName, CustArea, OrderCode, ISNULL(Descr,'') AS Descr,
            ISNULL(BaseOutDay,0) AS BaseOutDay
       FROM Customer
      WHERE ISNULL(isDeleted,0)=0`
  );
  const dbResult = await queryFn(
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
  // 주문 없이 분배만 남은 행도 최종 분배표의 0 대상에서 빠지면 안 된다.
  const shipmentOnlyDbResult = await queryFn(
    `SELECT
        sm.CustKey, c.CustName, c.OrderCode, sd.ProdKey, p.ProdName, p.DisplayName, p.OutUnit,
        CAST(0 AS FLOAT) AS orderQty,
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
                       THEN 1 ELSE 0 END),0) AS shipmentDateIssueCount
       FROM ShipmentMaster sm
       JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
       JOIN Customer c ON c.CustKey=sm.CustKey
       JOIN Product p ON p.ProdKey=sd.ProdKey
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
      WHERE sm.OrderWeek=@week
        AND ISNULL(sm.isDeleted,0)=0
        AND ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)), @importYear) = @importYear
        AND NOT EXISTS (
          SELECT 1
            FROM OrderMaster om
            JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey
             AND od.ProdKey=sd.ProdKey
             AND ISNULL(od.isDeleted,0)=0
           WHERE om.CustKey=sm.CustKey
             AND om.OrderWeek=sm.OrderWeek
             AND ISNULL(om.isDeleted,0)=0
             AND ISNULL(CAST(om.OrderYear AS NVARCHAR(4)), @importYear) = @importYear
        )
      GROUP BY sm.CustKey, c.CustName, c.OrderCode, sd.ProdKey, p.ProdName, p.DisplayName, p.OutUnit`,
    {
      week: { type: sql.NVarChar, value: week },
      importYear: { type: sql.NVarChar, value: String(orderYear) },
    }
  );

  const familyAllowed = family => !requestedProductFamily || requestedProductFamily === 'all' || family === requestedProductFamily || requestedProductFamily === 'carnation' && family === 'minicarnation';
  const products = (productResult.recordset || []).filter(p => (!countryFilter || (countryFilter === '중국'
    ? /중국|china/i.test(`${p.CounName || ''} ${p.CountryFlower || ''}`)
    : String(p.CounName || '').trim() === countryFilter)) && familyAllowed(inferProductFamily(p.FlowerName, p.CountryFlower, p.ProdName)));
  const outsideFamilyRows = requestedProductFamily && requestedProductFamily !== 'all' ? parsedRows.filter(row => row.productFamily && !familyAllowed(row.productFamily)) : [];
  parsedRows = parsedRows.filter(row => !outsideFamilyRows.includes(row));
  if (outsideFamilyRows.length) logs.push(`선택 품종 밖 원본 ${outsideFamilyRows.length}행 제외 (주문·분배 보존)`);
  const customers = customerResult.recordset || [];
  const dbRows = [...(dbResult.recordset || []), ...(shipmentOnlyDbResult.recordset || [])];
  logs.push(`DB 기준 로드: 품목 ${products.length}개, 업체 ${customers.length}개, 주문/분배 비교라인 ${dbRows.length}개`);

  const {
    productByKey,
    dbMap,
    merged,
    unmatched,
    duplicateProductReviews,
    aliasHits,
    replacementCategories,
    replacementProductKeys,
    skippedOtherWeek,
    skippedIgnoredCustomerCount,
    skippedProducts,
    missingFromExcelCount,
  } = matchAndMergePreviewRows({
    parsedRows,
    week,
    products,
    customers,
    dbRows,
    strictMatching,
    fileBasedScope,
    importMode,
    cleanProductName,
    overrideMap,
    ignoredCustomerLabels,
    productOverrideMap,
    skippedProductLabels,
    ambiguousProductChoices,
  });

  const earlyMode = earlyImportMode == null ? null : requireEarlyImportMode(earlyImportMode);
  const earlyScope = earlyMode ? {
    year: String(orderYear), majorWeek: week.split('-')[0], orderWeek: week,
    custKeys: [...new Set([...merged.values()].map(row => Number(row.custKey)))],
    prodKeys: [...new Set([...merged.values()].map(row => Number(row.prodKey)))],
  } : null;
  const earlyExclusions = earlyMode && earlyExclusionLoader
    ? await earlyExclusionLoader(queryFn, earlyScope)
    : null;
  if (earlyMode && !earlyExclusions) throw new Error('선출고 처리 원장 조회 결과가 없어 검증을 중단했습니다.');
  if (earlyMode === 'ORIGINAL_INCLUDES_EARLY' &&
      (earlyExclusions.rows || []).some(row => Number(row.processedEarlyTotal) > 0) &&
      parsedRows.some(row => {
        if (!row.week || asNumber(row.uploadQty) <= 0) return false;
        try { return normalizeImportWeek(row.week) === week; } catch { return false; }
      }) &&
      parsedRows.some(row => {
        if (!row.week || asNumber(row.uploadQty) <= 0) return false;
        try {
          const sourceWeek = normalizeImportWeek(row.week);
          return sourceWeek !== week && sourceWeek.split('-')[0] === week.split('-')[0];
        } catch { return false; }
      })) {
    const error = new Error('같은 대상 큰 차수의 원문 물량이 여러 저장 차수에 나뉘어 있습니다. 선출고 포함량의 위치를 확인한 뒤 파일을 분리하거나 이미 제외된 원문으로 다시 검증하세요.');
    error.code = 'EARLY_IMPORT_AMBIGUOUS_SUFFIX';
    error.statusCode = 409;
    throw error;
  }

  const hasDatedSource = [...merged.values()].some(row => row.shipmentDateSources?.some(source => source.header));
  const dateCalendar = hasDatedSource ? (await queryFn(
    `SELECT CONVERT(nvarchar(23),CONVERT(datetime,BaseYmd,121),121) AS Timestamp, WeekDay
       FROM PeriodDay WHERE OrderYearWeek=@dateWeek`,
    { dateWeek: { type: sql.NVarChar, value: orderYear + week.split('-')[0] } },
  )).recordset : [];
  const previewRows = [...merged.values()]
    .filter(r => r.uploadQty !== 0 || r.orderQty !== 0 || r.currentOutQty !== 0 || (strictMatching && r.entryIds?.length)
      || (earlyMode && (earlyExclusions.rows || []).some(item => Number(item.custKey) === Number(r.custKey) && Number(item.prodKey) === Number(r.prodKey))))
    .sort(sortByExcelOrder)
    .map(r => {
      const prod = productByKey.get(Number(r.prodKey)) || {};
      const excelOrderQty = Number(r.excelOrderQtyRaw || 0) > 0
        ? normalizeUploadQtyForProduct(
          { ...r, excelQty: r.excelOrderQtyRaw, uploadQty: r.excelOrderQtyRaw },
          prod
        )
        : 0;
      const originalTotal = normalizeImportInput(
        { ...r, excelQty: r.excelQty, excelUnit: r.excelUnit, uploadQty: r.excelQty },
        prod, importMode
      );
      const earlyExclusion = earlyMode ? findEarlyExclusion(earlyExclusions, r) : null;
      const earlyTarget = earlyMode ? projectEarlyImportTarget({
        originalTotal,
        currentOutQty: r.currentOutQty,
        exclusion: earlyExclusion,
        mode: earlyMode,
        missingFromExcel: r.missingFromExcel,
      }) : null;
      const inputQty = earlyTarget ? earlyTarget.finalTarget : originalTotal;
      const uploadQty = projectImportQuantity({ mode: importMode, inputQty, currentOutQty: r.currentOutQty });
      const sourceQuantityFactor = normalizeImportInput({ ...r, excelQty: 1, uploadQty: 1 }, prod, importMode);
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
      const hasExistingOrder = (dbResult.recordset || []).some(db => Number(db.CustKey) === r.custKey && Number(db.ProdKey) === r.prodKey);
      const orderDiffQty = importMode==='ADD' ? (!hasExistingOrder && inputQty>0 ? uploadQty : 0) : uploadQty > 0 ? (uploadQty - r.orderQty) : 0;
      const shipmentDiffQty = uploadQty - r.currentOutQty;
      const { shipmentDateSources = [], ...previewRow } = r;
      let shipmentDateAllocations = [];
      let shipmentDateError = '';
      try {
        shipmentDateAllocations = planUploadedDates(shipmentDateSources, dateCalendar, inputQty);
      } catch (error) {
        if (error.code !== 'SHIPMENT_UPLOAD_DATE_INVALID') throw error;
        shipmentDateError = error.message;
      }
      const needsShipmentApply = importMode==='ADD' && !inputQty ? false
        : !sameQty(uploadQty, r.currentOutQty) || Number(r.shipmentDateIssueCount || 0) > 0 || shipmentDateAllocations.length > 0;
      if (importMode==='ADD' && !inputQty) fixCheck.fixBlocked = false;
      const status = fixCheck.fixBlocked
        ? '확정차단'
        : r.missingFromExcel
        ? '엑셀누락'
        : uploadQty <= 0 && needsShipmentApply
        ? '분배0'
        : uploadQty > 0 && !dbMap.has(`${r.custKey}|${r.prodKey}`)
        ? '주문없음'
        : !sameQty(orderDiffQty, 0)
        ? '변경'
        : '동일';
      return {
        ...previewRow,
        ...(shipmentDateAllocations.length ? { shipmentDateAllocations } : {}),
        ...(shipmentDateError ? { shipmentDateError } : {}),
        uploadQty,
        ...(importMode!=='REPLACE' ? { distributionMode: importMode, inputQty, sourceQuantityFactor, hasExistingOrder } : {}),
        ...(earlyTarget ? {
          ...earlyTarget,
          earlyImportMode: earlyMode,
          earlyLedgerFingerprint: earlyExclusions.fingerprint,
          targetImportYear: earlyExclusion?.targetImportYear || null,
          targetImportWeek: earlyExclusion?.targetImportWeek || null,
          earlyExclusionReason: r.missingFromExcel ? '엑셀누락→0'
            : earlyMode === 'ALREADY_EXCLUDED' ? '원문에서 이미 제외됨'
            : earlyExclusion && !Number(earlyExclusion.earlyExcludedApplied) ? '대상 차수의 다른 저장 차수: 참고만 표시' : '',
        } : {}),
        excelOrderQty,
        changeQty: orderDiffQty,
        orderDiffQty,
        shipmentDiffQty,
        needsShipmentApply,
        qtyWarnings,
        hasQtyWarning: qtyWarnings.some(w => w.severity === 'critical'),
        countryFlower: prod.CountryFlower || '',
        categoryFixStatus: fixCheck.categoryStatus,
        fixBlocked: fixCheck.fixBlocked,
        fixBlockReason: fixCheck.fixBlockReason,
        status,
      };
    });

  appendPeerQtyWarnings(previewRows);
  appendCustomerPeerQtyWarnings(previewRows, productByKey);

  const summaryByCustomer = summarizePreviewByCustomer(previewRows);
  const fixBlockedRows = previewRows.filter(r => r.fixBlocked);
  const changedRows = previewRows.filter(r => !r.fixBlocked && !sameQty(r.orderDiffQty, 0));
  const applyRows = previewRows.filter(r => !r.fixBlocked && (!sameQty(r.orderDiffQty, 0) || r.needsShipmentApply));
  const qtyWarningRows = appendPreviewDiagnosticLogs({
    logs,
    aliasHits,
    skippedOtherWeek,
    skippedIgnoredCustomerCount,
    missingFromExcelCount,
    previewRows,
    applyRows,
    fixBlockedRows,
    changedRows,
    unmatched,
    skippedProducts,
    replacementProductKeys,
    replacementCategories,
    importMode,
    orderYear,
    week,
  });
  const { customerOptions, productOptions } = buildImportDropdownOptions(customers, products);

  let otherYearWeeks = [];
  try {
    const other = await queryFn(
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

  return formatImportPreviewPayload({
    importMode,
    week,
    orderYear,
    productByKey,
    replacementCategories,
    replacementProductKeys,
    skippedProducts,
    earlyMode,
    earlyExclusions,
    earlyScope,
    otherYearWeeks,
    previewRows,
    changedRows,
    applyRows,
    unmatched,
    customerOptions,
    productOptions,
    duplicateProductReviews,
    summaryByCustomer,
    qtyWarningRows,
    fixBlockedRows,
    skippedIgnoredCustomerCount,
    logs,
  });
}

async function safeNextKey(tQ, table, keyCol) {
  if (table === 'ShipmentDetail' && keyCol === 'SdetailKey') {
    return safeNextShipmentDetailKey(tQ);
  }
  const r = await tQ(`SELECT ISNULL(MAX(${keyCol}),0)+1 AS nk FROM ${table} WITH (UPDLOCK, HOLDLOCK)`, {});
  return r.recordset[0].nk;
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

async function syncOrderDetailForShipmentImport({ tQ, row, week, orderYear, uid, userName, customer, product, hasOrderYearWeekColumn, hasOrderDetailDescrColumn, chinaNativeOrder = false }) {
  const desiredQty = Number(row.uploadQty || 0);

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
    await syncKeyNumbering(tQ, sql, 'OrderMasterKey', 'OrderMaster', 'OrderMasterKey');
  }

  const existingDetail = await tQ(
    `SELECT TOP 1 OrderDetailKey, BoxQuantity, BunchQuantity, SteamQuantity, OutQuantity
       FROM OrderDetail WITH (UPDLOCK, HOLDLOCK)
      WHERE OrderMasterKey=@mk AND ProdKey=@pk AND ISNULL(isDeleted,0)=0`,
    { mk: { type: sql.Int, value: orderMasterKey }, pk: { type: sql.Int, value: Number(row.prodKey) } }
  );
  const detail = existingDetail.recordset[0];
  const orderDetailDescr = extractMoqText(product);
  const units = chinaNativeOrder ? chinaOrderUnits(desiredQty, product) : toOrderUnits(desiredQty, product.OutUnit || row.outUnit || '박스', product);

  if (detail) {
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
          @box, @bunch, @steam, @outQty, @estQty, 0,
          @descr, 0, @adminId, GETDATE())`
      : `(@dk, @mk, @pk,
          @box, @bunch, @steam, @outQty, @estQty, 0,
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
        estQty: { type: sql.Float, value: chinaNativeOrder ? units.estQty : units.outQty },
        descr: { type: sql.NVarChar, value: orderDetailDescr },
        adminId: { type: sql.NVarChar, value: 'admin' },
      }
    );
  });
  await syncKeyNumbering(tQ, sql, 'OrderDetailKey', 'OrderDetail', 'OrderDetailKey');
  await insertOrderHistory(tQ, sql, orderDetailKey, 0, desiredQty, importMemo(userName, 0, desiredQty), uid);

  return { orderCreated, detailCreated: true, detailUpdated: false, detailDeleted: false, orderChanged: true, orderMasterKey, orderDetailKey };
}

function orderApplyAction(mutation = {}) {
  return formatOrderApplyAction(mutation);
}

async function verifyAppliedShipmentRows(queryFn, week, targets, orderYear = String(new Date().getFullYear()), fullCategoryReplacement = false, replacementProductKeys = null) {
  if (!targets.length) return { checked: 0, matched: 0, mismatchCount: 0, mismatches: [] };

  const valuesSql = targets.map(t => {
    const ck = Number(t.custKey), pk = Number(t.prodKey);
    if (!Number.isSafeInteger(ck) || ck <= 0 || !Number.isSafeInteger(pk) || pk <= 0) throw new Error('잘못된 검증 업체·품목 키');
    return `(${ck},${pk})`;
  }).join(',');
  const params = {
    week: { type: sql.NVarChar, value: week },
    importYear: { type: sql.NVarChar, value: String(orderYear) },
  };

  const result = await queryFn(
    `WITH requested(CustKey, ProdKey) AS (SELECT * FROM (VALUES ${valuesSql}) v(CustKey, ProdKey)),
     target AS (
       SELECT CustKey,ProdKey FROM requested
       ${fullCategoryReplacement ? `UNION
       SELECT sm.CustKey,sd.ProdKey
         FROM ShipmentMaster sm
         JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
         JOIN Product p ON p.ProdKey=sd.ProdKey
        WHERE sm.OrderYear=@importYear AND sm.OrderWeek=@week AND ISNULL(sm.isDeleted,0)=0
          AND ${replacementScopeSql(replacementProductKeys, 'p', 'p.CountryFlower IN (SELECT p2.CountryFlower FROM requested r JOIN Product p2 ON p2.ProdKey=r.ProdKey)')}
       ` : ''}
     )
     SELECT t.CustKey, t.ProdKey, c.CustName, p.ProdName,
            ISNULL(ord.OrderQty,0) AS OrderQty,
            ISNULL(agg.OutQuantity,0) AS OutQuantity,
            ISNULL(agg.DateQty,0) AS DateQty,
            ISNULL(agg.DetailCount,0) AS DetailCount,
            ISNULL(agg.DateIssueCount,0) AS DateIssueCount
       FROM target t
       LEFT JOIN Customer c ON c.CustKey=t.CustKey
       LEFT JOIN Product p ON p.ProdKey=t.ProdKey
       OUTER APPLY (
         SELECT SUM(ISNULL(od.OutQuantity,0)) AS OrderQty
           FROM OrderMaster om
           JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey
                              AND od.ProdKey=t.ProdKey
                              AND ISNULL(od.isDeleted,0)=0
          WHERE om.CustKey=t.CustKey
            AND om.OrderWeek=@week
            AND ISNULL(om.isDeleted,0)=0
            AND ISNULL(CAST(om.OrderYear AS NVARCHAR(4)), @importYear)=@importYear
       ) ord
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
      orderQty: Number(r.OrderQty || 0),
      dateQty: Number(r.DateQty || 0),
      detailCount: Number(r.DetailCount || 0),
      dateIssueCount: Number(r.DateIssueCount || 0),
    }])
  );

  const completeTargets = [...targets];
  if (fullCategoryReplacement) {
    const knownPairs = new Set(targets.map(t => `${Number(t.custKey)}|${Number(t.prodKey)}`));
    for (const row of result.recordset || []) {
      if (!knownPairs.has(`${Number(row.CustKey)}|${Number(row.ProdKey)}`)) {
        completeTargets.push({ custKey: row.CustKey, prodKey: row.ProdKey, custName: row.CustName || `업체 #${row.CustKey}`, prodName: row.ProdName || `품목 #${row.ProdKey}`, intended: 0, verifyOrder: false });
      }
    }
  }
  return compareVerifyResult(completeTargets, actualByKey);
}

async function applyImportRowsCore({ palletSnapshot, rawWeek, rawYear, rows, user, ackQtyWarnings = false, shipmentOnly = false, onProgress = null, auditKey = null, fullCategoryReplacement = false, replacementProductKeys = null, dutchPlan = null, earlyImportMode = null, earlyLedgerFingerprint = null, earlyImportScope = null, distributionMode = 'REPLACE' }) {
  const importMode = requireDistributionMode(distributionMode);
  const dutchMode = !!dutchPlan;
  const progress = typeof onProgress === 'function' ? onProgress : () => {};
  const week = normalizeImportWeek(rawWeek);
  const { orderYear } = requireOrderYear(rawWeek, rawYear);
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
    .filter(r => importMode!=='ADD' || Number(r.inputQty)>0)
    .map(r => ({ ...r, uploadQty: Number(r.uploadQty) }));
  if (dutchMode && targetRows.length !== rows.length) throw dutchError('INVALID_DUTCH_TARGETS', '미리보기 대상 행이 누락되었습니다.', 409);
  if (fullCategoryReplacement) {
    assertReplacementRows(rows);
    await assertReplacementCoverage(query, rows, orderYear, week, sql, false, replacementProductKeys);
  }
  const earlyMode = earlyImportMode == null ? null : requireEarlyImportMode(earlyImportMode);
  const earlyScope = earlyMode ? {
    year: String(orderYear), majorWeek: week.split('-')[0], orderWeek: week,
    custKeys: [...new Set((earlyImportScope?.custKeys || []).map(Number))],
    prodKeys: [...new Set((earlyImportScope?.prodKeys || []).map(Number))],
  } : null;
  if (earlyMode && (String(earlyImportScope?.year) !== String(orderYear) ||
      String(earlyImportScope?.majorWeek) !== week.split('-')[0] ||
      String(earlyImportScope?.orderWeek) !== week ||
      targetRows.some(row => !earlyScope.custKeys.includes(Number(row.custKey)) || !earlyScope.prodKeys.includes(Number(row.prodKey))))) {
    const error = new Error('선출고 검증 범위와 적용 대상이 다릅니다. 다시 검증하세요.');
    error.code = 'EARLY_IMPORT_SCOPE_STALE';
    error.statusCode = 409;
    throw error;
  }
  const earlyPreflight = earlyMode ? await getEarlyShipmentExclusions(query, earlyScope) : null;
  if (earlyMode && (!earlyLedgerFingerprint || earlyPreflight.fingerprint !== earlyLedgerFingerprint)) {
    const error = new Error('선출고 처리 원장이 미리보기 이후 변경됐습니다. 다시 검증하세요.');
    error.code = 'EARLY_IMPORT_LEDGER_STALE';
    error.statusCode = 409;
    throw error;
  }

  progress({ total: targetRows.length, done: 0, stage: '사전 확인(품목·현재수량)' });
  const criticalWarnings = [];
  const checkRows = [];
  const productByKey = new Map();
  const preflightBlockers = [];
  let preflightIdx = 0;
  for (const row of targetRows) {
    preflightIdx += 1;
    const blockerStart = preflightBlockers.length;
    progress({ done: preflightIdx, current: `${row.custName || row.custKey} / ${row.prodName || row.prodKey}` });
    const prod = await query(
      `SELECT TOP 1 OutUnit, ProdName, CountryFlower,
              ISNULL(BunchOf1Box,0) AS BunchOf1Box, ISNULL(SteamOf1Box,0) AS SteamOf1Box
         FROM Product WHERE ProdKey=@pk`,
      { pk: { type: sql.Int, value: Number(row.prodKey) } }
    );
    const productInfo = prod.recordset[0] || {};
    productByKey.set(Number(row.prodKey), productInfo);
    const originalTotal = normalizeImportInput(row, productInfo, importMode);
    const earlyExclusion = earlyMode ? findEarlyExclusion(earlyPreflight, { ...row, outUnit: productInfo.OutUnit }) : null;
    const earlyProjection = earlyMode ? verifyEarlyImportPreviewRow({
      row: importMode==='ADD' ? { ...row, uploadQty: row.inputQty } : row, originalTotal, exclusion: earlyExclusion, mode: earlyMode, fingerprint: earlyPreflight.fingerprint,
    }) : null;
    const normalizedQty = verifiedImportTarget(row, earlyProjection ? earlyProjection.finalTarget : originalTotal, importMode);
    const state = await loadCurrentImportState(query, sql, row, week, productInfo, orderYear);
    assertAdditionBaseline(row, state.currentOutQty);
    const rowLabel = `${row.custName || row.custKey} / ${row.prodName || row.prodKey}`;
    if (fullCategoryReplacement && !String(productInfo.CountryFlower || '').trim()) {
      preflightBlockers.push(`${rowLabel}: 국가·품종 정보가 없어 전체 교체 범위를 확인할 수 없습니다. 품목 매칭을 확인하세요.`);
    }

    const fixCheck = evaluateImportRowFixBlock({
      orderWeek: week,
      countryFlower: productInfo.CountryFlower || row.countryFlower,
      prodName: productInfo.ProdName || row.prodName,
      custKey: row.custKey,
      prodKey: row.prodKey,
      categoryFixStates,
      lineFixStates,
    });
    if (fixCheck.fixBlocked) {
      preflightBlockers.push(`${rowLabel}: 확정됨(${fixCheck.fixBlockReason}) — 확정취소 후 재검증하세요.`);
    }

    const finalStateStale = evaluateImportFinalStateStale({
      previewOrderQty: row.orderQty,
      currentOrderQty: state.orderQty,
      intendedOrderQty: state.hasExistingOrder ? state.orderQty : normalizedQty,
      preserveOrder: state.hasExistingOrder || normalizedQty <= 0,
      previewShipmentQty: row.currentOutQty,
      currentShipmentQty: state.currentOutQty,
      intendedShipmentQty: distributeUnits(normalizedQty, productInfo).outQty,
    });
    if (finalStateStale.orderBlocked) {
      preflightBlockers.push(`${rowLabel}: 주문수량이 검증 이후 변경됨(검증시 ${row.orderQty} → 현재 ${state.orderQty}) — 다시 검증하세요.`);
    }
    if (finalStateStale.shipmentBlocked) {
      preflightBlockers.push(`${rowLabel}: 분배수량이 검증 이후 변경됨(검증시 ${row.currentOutQty} → 현재 ${state.currentOutQty}) — 다시 검증하세요.`);
    }

    const rawQty = Number(row.excelQty ?? row.uploadQty ?? 0);
    if (rawQty > 0 && originalTotal <= 0) {
      preflightBlockers.push(`${rowLabel}: 단위 환산 불가(엑셀 ${rawQty}${row.excelUnit || ''} → 출고단위 ${productInfo.OutUnit || '박스'} 환산 실패, 박스당 단/송이 계수 확인 필요)`);
    }

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
    if (preflightBlockers.length > blockerStart) {
      progress({ log: `[사전검사 ${preflightIdx}/${targetRows.length}] 차단 · ${preflightBlockers.slice(blockerStart).join(' / ')}` });
    }
  }

  if (preflightBlockers.length) {
    const err = new Error(
      `사전 검사에서 ${preflightBlockers.length}건이 차단되어 전체 적용을 중단했습니다(부분 적용 안 함).\n` +
      preflightBlockers.slice(0, 10).join('\n') +
      (preflightBlockers.length > 10 ? `\n... 외 ${preflightBlockers.length - 10}건` : '')
    );
    err.code = 'PREFLIGHT_BLOCKED';
    err.statusCode = 409;
    err.preflightBlockers = preflightBlockers;
    throw err;
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
  for (const warning of criticalWarnings) progress({ log: `[수량확인] ${warning}` });
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
  const auditRows = [];
  progress({ done: 0, stage: '적용 중(주문·분배 입력)', current: '' });
  const result = await withTransaction(async (tQ) => {
    if (targetRows.some(row => row.shipmentDateAllocations?.length)) {
      await assertDirectionalGateCapability(tQ);
      await lockDirectionalGate(tQ);
    }
    if (fullCategoryReplacement) await assertReplacementCoverage(tQ, rows, orderYear, week, sql, true, replacementProductKeys);
    const earlyLocked = earlyMode ? await getEarlyShipmentExclusions(tQ, earlyScope) : null;
    if (earlyMode && earlyLocked.fingerprint !== earlyLedgerFingerprint) {
      const error = new Error('선출고 처리 원장이 저장 직전에 변경됐습니다. 다시 검증하세요.');
      error.code = 'EARLY_IMPORT_LEDGER_STALE';
      error.statusCode = 409;
      throw error;
    }
    let txCategoryFixStates = categoryFixStates;
    let txLineFixStates = lineFixStates;
    if (fullCategoryReplacement || importMode!=='REPLACE') {
      txCategoryFixStates = await loadCategoryFixStates(tQ, orderYear, week);
      txLineFixStates = await loadLineFixStates(tQ, orderYear, week);
    }
    if (dutchMode) {
      const current = await readDutchScopeSnapshot(tQ, dutchPlan, true);
      assertUniqueDutchLedger(current.snapshot);
      if (current.digest !== dutchPlan.digest) {
        throw dutchError('DUTCH_PLAN_STALE', '미리보기 이후 주문·분배·단가·마스터·날짜·농장 또는 국가·품종 범위가 변경되었습니다. 다시 검증하세요.', 409);
      }
      const farmBlockers = findDutchFarmQtyBlockers(current.snapshot, targetRows);
      if (farmBlockers.length) throw dutchError('DUTCH_FARM_QTY_BLOCKED', farmBlockers.join('\n'), 409);
      const dateBlockers = findDutchDateIntegrityBlockers(current.snapshot, targetRows);
      if (dateBlockers.length) throw dutchError('DUTCH_DATE_INTEGRITY_BLOCKED', dateBlockers.join('\n'), 409);
      txCategoryFixStates = await loadCategoryFixStates(tQ, orderYear, week);
      txLineFixStates = await loadLineFixStates(tQ, orderYear, week);
    }
    const applied = [];
    const snapshotEntries = [];
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
        categoryFixStates: txCategoryFixStates,
        lineFixStates: txLineFixStates,
      });
      if (fixCheck.fixBlocked) {
        if (fullCategoryReplacement || importMode!=='REPLACE') throw Object.assign(new Error(`${row.custName || row.custKey} / ${row.prodName || row.prodKey}: 검증 이후 확정되어 전체 적용을 중단했습니다. 다시 검증하세요.`), { code: 'SHIPMENT_REPLACEMENT_REVERIFY', statusCode: 409 });
        if (dutchMode) throw dutchError('DUTCH_FIXED_STALE', `${row.custName || row.custKey} / ${row.prodName || row.prodKey}: 확정되어 전체 적용을 중단했습니다.`, 409);
        skippedFixedCount += 1;
        skippedFixedLogs.push(`${row.custName || row.custKey} / ${row.prodName || row.prodKey}: ${fixCheck.fixBlockReason}`);
        auditRows.push({
          rowNo: row.rowNo,
          custKey: row.custKey,
          prodKey: row.prodKey,
          customerName: row.custName || row.customerLabel || row.custKey,
          productName: row.displayName || row.prodName || row.productLabel || row.prodKey,
          sourceType: row.sourceType || '',
          sourceCells: row.cells || [],
          excelQty: row.excelQty ?? row.uploadQty,
          excelOrderQty: row.excelOrderQty,
          excelIncomingQty: row.excelIncomingQty,
          excelStockQty: row.excelStockQty,
          excelRemainingQty: row.excelRemainingQty,
          normalizedQty: row.uploadQty,
          orderAction: '확정차단',
          shipmentAction: '확정차단',
          rowStatus: 'FIXED_BLOCKED',
          verificationStatus: 'SKIPPED',
          verificationReason: fixCheck.fixBlockReason,
        });
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
      const txOriginalTotal = normalizeImportInput(row, productInfo, importMode);
      const txExclusion = earlyMode ? findEarlyExclusion(earlyLocked, { ...row, outUnit: productInfo.OutUnit }) : null;
      const txProjection = earlyMode ? verifyEarlyImportPreviewRow({
        row: importMode==='ADD' ? { ...row, uploadQty: row.inputQty } : row, originalTotal: txOriginalTotal, exclusion: txExclusion, mode: earlyMode, fingerprint: earlyLocked.fingerprint,
      }) : null;
      const normalizedUploadQty = verifiedImportTarget(row, txProjection ? txProjection.finalTarget : txOriginalTotal, importMode);
      if (dutchMode) {
        const unitIssue = dutchEstUnitConversionIssue(productInfo, normalizedUploadQty);
        if (unitIssue) throw dutchError('DUTCH_EST_UNIT_UNAVAILABLE', `${row.custName || row.custKey} / ${row.prodName || row.prodKey}: ${unitIssue}`, 409);
      }
      const applyRow = { ...row, uploadQty: normalizedUploadQty };
      const units = distributeUnits(normalizedUploadQty, productInfo);
      const estQty = units.estQty;
      const fallbackCost = dutchMode && row.currentCost != null ? Number(row.currentCost) : Number(productInfo.Cost || 0);
      if (dutchMode) {
        const computedIssue = dutchComputedValueIssue(productInfo, normalizedUploadQty, row.unitPrice == null ? fallbackCost : Number(row.unitPrice));
        if (computedIssue) throw dutchError('DUTCH_COMPUTED_VALUE_INVALID', `${row.custName || row.custKey} / ${row.prodName || row.prodKey}: ${computedIssue}`, 409);
      }
      const currentState = await loadCurrentImportState(tQ, sql, applyRow, week, productInfo, orderYear);
      assertAdditionBaseline(row, currentState.currentOutQty);
      const beforeSnapshot = await captureImportRowSnapshot(tQ, {
        custKey: row.custKey,
        prodKey: row.prodKey,
        week,
        orderYear,
      });
      const wantedDates = row.shipmentDateAllocations || [];
      const plannedDates = wantedDates.length && importMode === 'ADD'
        ? addUploadedDates(wantedDates, beforeSnapshot.shipmentDateRows, currentState.currentOutQty)
        : wantedDates;
      const farmAssignments = await validateImportFarmRow(tQ, row, beforeSnapshot, units.outQty);
      const farmNeedsWrite = farmAssignments != null && assignmentsKey(beforeSnapshot.shipmentFarmRows) !== assignmentsKey(farmAssignments);
      const baseAuditRow = {
        rowNo: row.rowNo,
        custKey: row.custKey,
        prodKey: row.prodKey,
        customerName: row.custName || row.customerLabel || row.custKey,
        productName: row.displayName || row.prodName || row.productLabel || row.prodKey,
        sourceType: row.sourceType || '',
        sourceCells: row.cells || [],
        excelQty: row.excelQty ?? row.uploadQty,
        excelOrderQty: row.excelOrderQty,
        excelIncomingQty: row.excelIncomingQty,
        excelStockQty: row.excelStockQty,
        excelRemainingQty: row.excelRemainingQty,
        normalizedQty: normalizedUploadQty,
        orderBeforeQty: currentState.orderQty,
        orderAfterQty: currentState.orderQty,
        shipmentBeforeQty: currentState.currentOutQty,
        shipmentAfterQty: units.outQty,
        orderAction: '주문유지',
        shipmentAction: '분배유지',
        rowStatus: 'NO_CHANGE',
        verificationStatus: 'PENDING',
        verificationReason: '',
      };
      verifyTargets.push({
        custKey: row.custKey,
        custName: row.custName || row.customerLabel || row.custKey,
        prodKey: row.prodKey,
        prodName: row.displayName || row.prodName || row.productLabel || row.prodKey,
        intended: units.outQty,
        verifyOrder: !shipmentOnly && !currentState.hasExistingOrder && normalizedUploadQty > 0,
        intendedOrder: !shipmentOnly && !currentState.hasExistingOrder && normalizedUploadQty > 0
          ? normalizedUploadQty
          : currentState.orderQty,
      });
      const orderAlreadyMatches = currentState.hasExistingOrder || applyRow.uploadQty <= 0;
      if (orderAlreadyMatches && sameQty(currentState.currentOutQty, units.outQty) && (dutchMode || currentState.dateIssueCount === 0) && !(dutchMode && row.priceChanged) && !farmNeedsWrite && !plannedDates.length) {
        skippedNoChangeCount += 1;
        auditRows.push(baseAuditRow);
        continue;
      }
      const preserveExistingDate = !dutchMode && !plannedDates.length && currentState.dateIssueCount === 0;
      const savedDate = beforeSnapshot.shipmentDetailRow?.ShipmentDtm;
      let shipDate = preserveExistingDate && savedDate instanceof Date && Number.isFinite(savedDate.getTime())
        ? savedDate : calcShipDate(week, orderYear, customerInfo.BaseOutDay ?? 0);
      if (!shipDate) throw new Error(`${applyRow.custName || applyRow.custKey} / ${applyRow.prodName || applyRow.prodKey}: 출고일 계산 실패`);

      const orderPlan = resolveImportOrderSyncPlan({
        orderQty: currentState.orderQty,
        uploadQty: applyRow.uploadQty,
        hasExistingOrder: currentState.hasExistingOrder,
      });
      let orderMutation = {
        orderCreated: false,
        detailCreated: false,
        detailUpdated: false,
        detailDeleted: false,
        orderChanged: false,
      };
      if (!shipmentOnly && orderPlan.action === 'create') {
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
          chinaNativeOrder: dutchPlan?.country === '중국',
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
      const shipmentCreateIntent = resolveImportWriteIntent({ uploadQty: applyRow.uploadQty, shipmentOnly });
      if (!shipmentKey && shipmentCreateIntent.shouldCreateShipment) {
        await assertShipmentWeekConsistent(tQ, sql, { orderYear, orderWeek: week, orderYearWeek: String(orderYear) + week.split('-')[0] });
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
        await syncKeyNumbering(tQ, sql, 'ShipmentMasterKey', 'ShipmentMaster', 'ShipmentKey');
      }

      const old = shipmentKey
        ? await tQ(
          `SELECT TOP 1 SdetailKey, ISNULL(OutQuantity,0) AS OutQuantity, ISNULL(Cost,0) AS Cost, ISNULL(Descr,'') AS Descr
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
          await insertShipmentHistory(tQ, sql, oldDetail.SdetailKey, oldQty, 0, log, uid);
          await purgeZeroOutShipmentDetail(tQ, oldDetail.SdetailKey, sql);
          shipmentChanged = true;
          shipmentAction = '분배삭제';
        }
      } else if (oldDetail && !sameQty(oldQty, units.outQty)) {
        const log = importMemo(userName, oldQty, applyRow.uploadQty);
        const newDescr = appendDescr(oldDetail.Descr, log);
        await tQ(
          `UPDATE ShipmentDetail
              SET ${dutchMode ? '' : 'CustKey=@ck,'}
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
        await refreshShipmentDatesAfterDetailChange(tQ, oldDetail.SdetailKey, sql, { shipDtm: shipDate, preserveExistingDate });
        await insertShipmentHistory(tQ, sql, oldDetail.SdetailKey, oldQty, units.outQty, log, uid);
        shipmentChanged = true;
        shipmentAction = '분배수정';
      } else if (oldDetail) {
        const existingOut = Number(oldDetail.OutQuantity || 0);
        if (!isActiveShipmentOutQty(existingOut) && applyRow.uploadQty <= 0) {
          await purgeZeroOutShipmentDetail(tQ, oldDetail.SdetailKey, sql);
          shipmentChanged = true;
          shipmentAction = '유령삭제';
        } else if (!dutchMode && !farmNeedsWrite && (orderMutation.orderChanged || currentState.dateIssueCount > 0)) {
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
          await refreshShipmentDatesAfterDetailChange(tQ, oldDetail.SdetailKey, sql, { shipDtm: shipDate, preserveExistingDate });
          shipmentChanged = true;
          shipmentAction = '출고일지정';
        } else {
          shipmentAction = dutchMode && row.priceChanged ? '단가수정' : '분배유지';
        }
      } else {
        const log = importMemo(userName, 0, applyRow.uploadQty);
        await assertShipmentLineHasOrder(tQ, sql, { orderYear, orderWeek: week, custKey: row.custKey, prodKey: row.prodKey });
        await assertShipmentWeekConsistent(tQ, sql, { orderYear, orderWeek: week, shipmentDtm: shipDate });
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
        await syncKeyNumbering(tQ, sql, 'ShipmentDetailKey', 'ShipmentDetail', 'SdetailKey');
        await refreshShipmentDatesAfterDetailChange(tQ, detailKey, sql, { shipDtm: shipDate, preserveExistingDate });
        await insertShipmentHistory(tQ, sql, detailKey, 0, units.outQty, log, uid);
        shipmentChanged = true;
        shipmentAction = '분배신규';
        shipmentDetailKey = detailKey;
      }

      if (dutchMode && shipmentDetailKey && applyRow.uploadQty > 0) {
        const price = row.unitPrice == null
          ? (oldDetail ? Number(oldDetail.Cost || 0) : fallbackCost)
          : Number(row.unitPrice);
        const storedDetail = await tQ(
          `SELECT EstQuantity FROM ShipmentDetail WITH (UPDLOCK,HOLDLOCK) WHERE SdetailKey=@dk`,
          { dk: { type: sql.Int, value: shipmentDetailKey } }
        );
        const storedEstQty = Number(storedDetail.recordset?.[0]?.EstQuantity ?? estQty);
        const amount = amountVatFromCostEst(price, storedEstQty);
        if (!Number.isFinite(amount.amount) || !Number.isFinite(amount.vat)) {
          throw dutchError('DUTCH_DETAIL_AMOUNT_INVALID', `${row.custName || row.custKey} / ${row.prodName || row.prodKey}: 원화 금액 계산 결과가 유효하지 않습니다.`, 409);
        }
        await tQ(
          `UPDATE ShipmentDetail SET Cost=@cost,Amount=@amount,Vat=@vat WHERE SdetailKey=@dk`,
          {
            dk: { type: sql.Int, value: shipmentDetailKey },
            cost: { type: sql.Float, value: price },
            amount: { type: sql.Float, value: amount.amount },
            vat: { type: sql.Float, value: amount.vat },
          }
        );
        await updateDutchDatePrices(tQ, sql, shipmentDetailKey, price);
        if (row.priceChanged && !shipmentChanged) shipmentChanged = true;
      }

      if (plannedDates.length) {
        const scope = { orderYear: String(orderYear), orderWeek: week, custKey: row.custKey, prodKey: row.prodKey };
        const context = await readDistributionDateContext(tQ, sql, scope);
        const unchanged = context.dates.length === plannedDates.length && plannedDates.every(allocation =>
          context.dates.some(date => date.Timestamp === allocation.timestamp && sameQty(date.ShipmentQuantity, allocation.quantity)));
        if (!unchanged) {
          const saved = await executeDistributionDateSave(tQ, sql, scope, {
            snapshot: distributionDateSnapshot(context), allocations: plannedDates,
          }, uid);
          shipDate = new Date(saved.plan.representative.replace(' ', 'T') + 'Z');
          shipmentChanged = true;
          shipmentAction = shipmentAction === '분배유지' ? '출고일수정' : `${shipmentAction}+출고일`;
        }
      }

      if (farmNeedsWrite) {
        if (!shipmentDetailKey || !(applyRow.uploadQty > 0)) throw Object.assign(new Error('농장분배 대상 출고가 없습니다. 전체 적용을 취소합니다.'), { statusCode: 409 });
        await saveImportFarmRow(tQ, shipmentDetailKey, farmAssignments);
        shipmentChanged = true;
        shipmentAction = shipmentAction === '분배유지' ? '농장분배수정' : `${shipmentAction}+농장분배`;
      }
      const appliedOrderAction = orderApplyAction(orderMutation);
      baseAuditRow.orderAfterQty = orderMutation.orderChanged && !shipmentOnly
        ? applyRow.uploadQty
        : currentState.orderQty;
      baseAuditRow.orderAction = appliedOrderAction;
      baseAuditRow.shipmentAction = shipmentAction;
      baseAuditRow.rowStatus = shipmentChanged || orderMutation.orderChanged ? 'APPLIED' : 'NO_CHANGE';
      auditRows.push(baseAuditRow);

      if (shipmentChanged || orderMutation.orderChanged) {
        const appliedRow = {
          ...row,
          beforeQty: oldQty,
          afterQty: units.outQty,
          shipmentChanged,
          shipmentAction,
          shipmentDetailKey,
          orderAction: appliedOrderAction,
          orderAfterQty: baseAuditRow.orderAfterQty,
          estimateQty: estQty,
          shipDate: shipDate.toISOString().slice(0, 10),
          ...orderMutation,
        };
        const logText = buildApplyLog(row, appliedRow);
        applied.push({ ...appliedRow, log: logText });
        progress({ log: `[${applyIdx}/${targetRows.length}] ${logText}` });

        const afterSnapshot = await captureImportRowSnapshot(tQ, {
          custKey: row.custKey,
          prodKey: row.prodKey,
          week,
          orderYear,
        });
        if (farmNeedsWrite && sameQty(oldQty, units.outQty) && !orderMutation.orderChanged) assertFarmOnlyPreserved(beforeSnapshot, afterSnapshot);
        if (dutchMode && applyRow.uploadQty > 0) {
          const expectedCost = row.unitPrice == null
            ? (oldDetail ? Number(oldDetail.Cost || 0) : fallbackCost)
            : Number(row.unitPrice);
          const priceProblems = assessDutchPriceReadback(afterSnapshot, expectedCost);
          if (priceProblems.length) {
            throw dutchError('DUTCH_PRICE_READBACK_FAILED', `${row.custName || row.custKey} / ${row.prodName || row.prodKey}: 단가·금액 저장 확인 실패(${priceProblems.join(', ')}). 전체 롤백합니다.`, 409);
          }
        }
        snapshotEntries.push(...buildRowSnapshotEntries({
          auditKey,
          custKey: row.custKey,
          prodKey: row.prodKey,
          before: beforeSnapshot,
          after: afterSnapshot,
        }));
      }
    }

    if (!auditKey) {
      const error = new Error('안전 이력 번호가 없어 전체 적용을 중단합니다.');
      error.code = 'SHIPMENT_IMPORT_AUDIT_REQUIRED';
      error.statusCode = 503;
      throw error;
    }
    progress({ stage: '복원 이력 저장', current: '' });
    await insertSnapshotRows(tQ, mergeSnapshotEntries(snapshotEntries));

    const inTxTargets = dedupeVerifyTargets(verifyTargets);
    progress({ stage: '커밋 전 전체 대조', current: '' });
    const inTxVerification = await verifyAppliedShipmentRows(tQ, week, inTxTargets, orderYear, fullCategoryReplacement, replacementProductKeys);
    if (inTxVerification.mismatchCount > 0) {
      const err = new Error(
        `적용 검증 실패 — 주문/분배 ${inTxVerification.mismatchCount}건이 의도값과 다릅니다. 전체 롤백합니다.\n` +
        inTxVerification.mismatches.slice(0, 10).map(m => `${m.custName} / ${m.prodName}: 의도 ${m.intended} vs 실제 ${m.actual} (${m.reason})`).join('\n')
      );
      err.code = 'APPLY_VERIFICATION_FAILED';
      err.statusCode = 409;
      err.verification = inTxVerification;
      throw err;
    }

    if (dutchMode) await assertDutchNativeVisibility(tQ, sql, targetRows, orderYear, week);
    if (earlyMode) await assertEarlyShipmentSourceIntegrity(tQ, earlyScope);

    const afterScope = dutchMode ? await readDutchScopeSnapshot(tQ, dutchPlan, true) : null;
    verifyChinaPostWriteOrders(dutchPlan, afterScope, targetRows);
    const postWriteDigest = afterScope?.digest || null;

    await markShipmentImportAuditAppliedInTransaction(tQ, {
      palletSnapshot,
      auditKey,
      appliedCount: applied.length,
      skippedNoChangeCount,
      skippedFixedCount,
      verification: inTxVerification,
    });

    return { applied, skippedNoChangeCount, skippedFixedCount, skippedFixedLogs, inTxVerification, postWriteDigest };
  }, { retries: dutchMode ? 0 : 3 });
  const appliedRows = result.applied || [];

  const dedupedVerifyTargets = dedupeVerifyTargets(verifyTargets);
  progress({ stage: '사후 검증(DB 재조회 대조)', current: '' });
  let verification = { checked: 0, matched: 0, mismatchCount: 0, mismatches: [] };
  try {
    verification = await verifyAppliedShipmentRows(query, week, dedupedVerifyTargets, orderYear, fullCategoryReplacement, replacementProductKeys);
    if (dutchMode && verification.mismatchCount === 0) {
      const postCommit = await readDutchScopeSnapshot(query, dutchPlan, false);
      if (postCommit.digest !== result.postWriteDigest) {
        verification = { ...verification, mismatchCount: 1, mismatches: [{ reason: '커밋 후 원장/단가/날짜 상태 변경', intended: 0, actual: 0 }] };
      }
    }
  } catch (e) {
    verification = { checked: dedupedVerifyTargets.length, matched: 0, mismatchCount: 0, mismatches: [], error: e.message };
  }

  return {
    ...buildApplyRowsResult({ week, rows, targetRows, result, appliedRows, verification, auditRows }),
    success: isShipmentImportVerificationSuccessful(verification),
  };
}

export async function applyImportRows(args = {}) {
  return withImportApplyLease(() => applyImportRowsLeased(args));
}

async function applyImportRowsLeased(args = {}) {
  const { rawWeek, rawYear, rows, user, sourceFileName = '', shipmentOnly = false } = args;
  if (shipmentOnly) {
    const error = new Error('파일 전체를 주문과 무관하게 분배만 바꾸는 모드는 사용할 수 없습니다. 양수는 주문·분배를 함께 맞추고, 0·빈칸·행누락만 주문을 보존한 채 분배 0으로 처리합니다.');
    error.code = 'SHIPMENT_ONLY_NOT_ALLOWED';
    error.statusCode = 400;
    throw error;
  }
  const week = normalizeImportWeek(rawWeek);
  const { orderYear } = requireOrderYear(rawWeek, rawYear);
  if (!week) throw new Error('차수 필요');
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('적용할 행이 없습니다');

  const targetRowCount = rows.filter((row) => row?.custKey && row?.prodKey && Number.isFinite(Number(row.uploadQty))).length;
  const auditKey = await createShipmentImportAuditBatch({
    orderYear,
    week,
    rows,
    targetRowCount,
    user,
    sourceFileName,
    shipmentOnly,
  });
  if (!auditKey) throw new Error('엑셀 업로드 안전 이력을 시작하지 못했습니다. 원장은 변경하지 않았습니다.');

  try {
    args.onProgress?.({ auditKey, year: orderYear, week, stage: '안전 이력 연결' });
    await assertShipmentImportSnapshotSchema(query);
    const result = await applyImportRowsCore({ ...args, auditKey });
    const auditRows = result.auditRows || [];
    attachShipmentImportVerification(auditRows, result.verification);
    const auditSummary = summarizeShipmentImportResult(result, auditRows);
    if (auditKey) {
      try {
        args.onProgress?.({ stage: '최종 적용 이력 저장', current: '' });
        await finishShipmentImportAuditBatch({
          auditKey,
          status: result.verification?.error || result.verification?.mismatchCount ? 'SUCCESS_WITH_WARNINGS' : 'SUCCESS',
          summary: auditSummary,
          rows: auditRows,
        });
      } catch (auditError) {
        console.error('[shipmentImportAudit] 완료 기록 실패:', auditError.message);
      }
    }
    const { auditRows: _auditRows, ...publicResult } = result;
    return { ...publicResult, auditBatchKey: auditKey, auditSummary };
  } catch (error) {
    await failShipmentImportAuditBatch(auditKey, error);
    throw error;
  }
}
