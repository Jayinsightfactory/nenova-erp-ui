// pages/estimate.js
// 견적서 관리
// 수정이력: 2026-03-27 — 차수/업체 검색 추가, 불량/검역 모달 품목 검색 드롭다운, 검색가능 드롭다운 컴포넌트 추가

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { apiGet, apiPost } from '../lib/useApi';
import { parseJsonResponse } from '../lib/parseJsonResponse';
import { getCurrentWeek } from '../lib/useWeekInput';
import { useLang } from '../lib/i18n';
import { useDropdownNav } from '../lib/useDropdownNav';
import { convertQwertyInputToHangul, editHangulSearchBuffer } from '../lib/qwertyHangul.js';
import { shouldRunCustomerSearch } from '../lib/customerSearch.js';
import { useDebouncedValue } from '../lib/useDebouncedValue.js';
import { PRODUCT_SEARCH_DEBOUNCE_MS, PRODUCT_SEARCH_RESULT_LIMIT } from '../lib/productSearchLimits.js';
import { rankProductSearchOptions } from '../lib/productSearchRanking.js';
import {
  filterItemsByWeekday as filterEstimateItemsByWeekday,
  filterPrintTargetItems,
  formatEstimatePrintDescr,
  isEstimateDeductionRow,
  isPrintableEstimateRow,
  sanitizeEstimateDescrForDisplay,
} from '../lib/estimateInvariants';
import { filterItemsByExeWeekDay } from '../lib/exeEstimateViewSql.js';
import { amountVatFromCostEst } from '../lib/distributeUnits.js';
import { requireCostSnapshot, rebaseCostItemsFromSaved, STALE_COST_MESSAGE } from '../lib/estimateCostSnapshot.js';
import { downloadEcountUploadWorkbook } from '../lib/estimateEcountExcel.js';
import { collectEstimateBatchReadFailures, estimateBatchReadFailureMessage } from '../lib/estimateBatchOutputGuard';
import {
  FIX_CATEGORY_PRESETS,
  categoriesForPreset,
  normalizeCategoryList,
  resolveCountryFlowerFilter,
} from '../lib/fixStatusCategories';
import { formatFixApiErrorMessage } from '../lib/shipmentFixGuards';
import { formatAutoUnfixSaveLog, getFixCycleWeeksForEditedItems as buildFixCycleWeeks } from '../lib/estimateFixCycle';
import { runScopedEstimateFixCycle } from '../lib/estimateCategoryCycle.js';
import {
  appendEstimateEditProgress,
  createEstimateEditProgress,
  describeDateQuantitySaveResult,
  ESTIMATE_EDIT_LOG_POLL_MS,
  finishEstimateEditProgress,
  formatEstimateEditElapsed,
  formatEstimateEditNotice,
  mergeEstimateEditServerLogs,
  nextEstimateEditPollDelay,
  recordEstimateEditPollFailure,
  setEstimateEditProgressWeeks,
} from '../lib/estimateEditProgress.js';
import { buildFixStatusQuery, findFixStatusWeek, resolveFixStatusOrderYear } from '../lib/fixStatusYearScope';
import {
  computePrintPreviewTotals,
  ESTIMATE_PRINT_FORMAT,
  getEstimateOriginCountry,
  getEstimateSpecLabel,
  getStatementProductName,
  getPrintFormatBigoSuffix,
  getPrintFormatDocTitle,
  isStatementPrintFormat,
  isSupplyPrintFormat,
} from '../lib/estimatePrintFormats';
import {
  estimateTypeLabel,
  prepareEstimatePrintRows,
  sanitizeExcelSheetName,
} from '../lib/estimatePrintPrepare';
import {
  buildEstimatePrintWorkbook,
  buildEstimatePrintWorksheet,
  downloadEstimatePrintWorkbook,
} from '../lib/estimatePrintExcel';
import { getEstimateShipmentManager, sortEstimateShipmentsForList, sortEstimateShipmentsForPrint } from '../lib/estimatePrintOrder';
import {
  estimateShipmentGroupId,
  filterRecentParentWeeks,
  buildManagerPrintGroups,
  filterManagerPrintGroups,
  managerSelectionState,
  toggleManagerSelection,
  toggleCustomerSelection,
  summarizeManagerPrintSelection,
  pruneSelectionToGroups,
} from '../lib/estimateManagerPrint';
import ShipmentFixLogPanel, { parseStockCalcProgressFromLogs } from '../components/ShipmentFixLogPanel';
import OrderRegisterDistributeModal from '../components/estimate/OrderRegisterDistributeModal';
import ErpEditPresenceBanner from '../components/ErpEditPresenceBanner';
import useErpEditPresence from '../hooks/useErpEditPresence';
import { confirmedWeekFixCycleStockFlags, shouldSkipFixCycleStockCalc } from '../lib/estimateAdditionalProduct';
import {
  buildEstimateDeductionDeletePayload,
  eligibleEstimateDeductions,
  hasEstimateDeductionDeleteSnapshot,
  isEligibleEstimateDeduction,
  resetEstimateDeductionSelection,
  selectAllEligibleEstimateDeductions,
  toggleEstimateDeductionSelection,
} from '../lib/estimateDeductionSelection';
import {
  createEstimateSelectionScope,
  createEstimateSelectionState,
  resolveEstimateReloadSelection,
  sameEstimateSelectionScope,
  shouldReloadCapturedEstimateSelection,
} from '../lib/estimateSelectionState';
import {
  classifyEstimateSaveSnapshot,
  estimateEditDraftKey,
  readEstimateEditDraft,
  runRecoverableEstimateSave,
  writeEstimateEditDraft,
} from '../lib/estimateSaveRecovery.js';
import { getEstimateGridNavigationTarget } from '../lib/estimateGridNavigation.js';

// 오늘 날짜 기준 차수(주차 번호)만 반환 — "2026-18-01" → "18"
function getCurrentWeekNum() {
  const w = getCurrentWeek(); // "2026-18-01" 또는 "18-01"
  const parts = w.split('-');
  // 신형식 YYYY-WW-SS 면 [1], 구형식 WW-SS 면 [0]
  return parts.length === 3 ? parts[1] : parts[0];
}
// 오늘 날짜 기준 연도 — "2026"
function getCurrentYearStr() {
  const w = getCurrentWeek();
  const parts = w.split('-');
  return parts.length === 3 ? parts[0] : String(new Date().getFullYear());
}

// 출고일자 포맷: "2026-04-03" → "03(금)" (기존 전산 프로그램 형식)
const FIX_STATUS_COUNT = 10;
const FIX_STATUS_LAST_SUB = '03';

function parseSubWeekValue(value) {
  const m = String(value || '').match(/^(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  return { parent: Number(m[1]), sub: Number(m[2]) };
}

function formatSubWeekValue(parent, sub) {
  return `${String(parent).padStart(2, '0')}-${String(sub).padStart(2, '0')}`;
}

function shiftSubWeek(value, delta) {
  const parsed = parseSubWeekValue(value);
  if (!parsed) return value;
  let { parent, sub } = parsed;
  const step = delta >= 0 ? 1 : -1;
  for (let i = 0; i < Math.abs(delta); i += 1) {
    sub += step;
    if (sub > 4) { sub = 1; parent += 1; }
    if (sub < 1) { sub = 4; parent -= 1; }
    if (parent < 1) { parent = 1; sub = 1; }
  }
  return formatSubWeekValue(parent, sub);
}

function subWeekKey(value) {
  const p = parseSubWeekValue(value);
  return p ? p.parent * 100 + p.sub : 0;
}

function expandSubWeekRange(fromWeek, toWeek, limit = FIX_STATUS_COUNT) {
  const rows = [];
  let cur = fromWeek;
  let guard = 0;
  while (cur && subWeekKey(cur) <= subWeekKey(toWeek) && guard < 80) {
    rows.push(cur);
    cur = shiftSubWeek(cur, 1);
    guard += 1;
  }
  return rows.slice(-limit);
}

function getRecentFixStatusRange(parentWeek, count = FIX_STATUS_COUNT) {
  const toWeek = formatSubWeekValue(Number(parentWeek), Number(FIX_STATUS_LAST_SUB));
  return {
    fromWeek: shiftSubWeek(toWeek, -(count - 1)),
    toWeek,
  };
}

const DAY_KR = ['일','월','화','수','목','금','토'];
// YYYY-MM-DD → 로컬 요일(0=일). new Date('YYYY-MM-DD') 는 UTC 자정이라 KST 에서 요일이 틀어질 수 있음.
function weekdayFromYmd(ymd) {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return -1;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay();
}
function weekdayKrFromYmd(ymd) {
  const d = weekdayFromYmd(ymd);
  return d >= 0 ? DAY_KR[d] : '';
}
function fmtDate(dateStr) {
  if (!dateStr) return '';
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const day = weekdayKrFromYmd(dateStr);
  return `${m[3]}(${day})`;
}

const fmt = n => Number(n || 0).toLocaleString();
const WEEKDAYS = ['월','화','수','목','금','토','일'];
const FIX_UNFIX_FETCH_TIMEOUT_MS = 20 * 60 * 1000;
const ESTIMATE_MODAL_Z_INDEX = 2000;

/** 미확정 카테고리 문자열 → 라벨 배열 (estimate.js 번들에 직접 포함) */
function parseUnfixedCategoryLabels(text) {
  return String(text || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function EstimateModalPortal({ zIndex = ESTIMATE_MODAL_Z_INDEX, onBackdropClick, children }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted || typeof document === 'undefined') return null;
  return createPortal(
    <div className="modal-overlay" style={{ zIndex }} onClick={onBackdropClick}>
      {children}
    </div>,
    document.body,
  );
}

function parseAppLogTime(value) {
  const text = String(value || '').trim();
  if (!text) return 0;
  const dt = new Date(`${text.replace(' ', 'T')}+09:00`);
  const ms = dt.getTime();
  return Number.isFinite(ms) ? ms : 0;
}

async function postShipmentFix(body, { timeoutMs = FIX_UNFIX_FETCH_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('/api/shipment/fix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let data;
    try {
      data = await parseJsonResponse(res);
    } catch (e) {
      data = {
        success: false,
        error: e.message,
        _ambiguousResponse: true,
        _httpStatus: res.status,
      };
    }
    return { res, data };
  } finally {
    clearTimeout(timer);
  }
}

async function postEstimateWriteJson(url, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  let data;
  try {
    data = await parseJsonResponse(response);
  } catch (error) {
    error.status = response.status;
    throw error;
  }
  if (!response.ok || !data?.success) {
    const error = new Error(data?.error || `저장 실패 (${response.status})`);
    error.status = response.status;
    error.code = data?.code;
    error.data = data;
    throw error;
  }
  return data;
}

async function probeEstimateServer() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(`/api/ping?_estimateRecovery=${Date.now()}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    });
    return response.ok;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWeekFixStatus(week, orderYear) {
  const query = buildFixStatusQuery({ orderYear, fromWeek: week, toWeek: week });
  const res = await fetch(
    `/api/shipment/fix-status?${query}`,
    { credentials: 'same-origin' },
  );
  const data = await parseJsonResponse(res).catch(() => ({}));
  return findFixStatusWeek(data.weeks || [], { orderYear, orderWeek: week });
}

async function reconcileFixResultAfterAmbiguousResponse(week, data, orderYear) {
  if (data?.success || !data?._ambiguousResponse) return data;
  const row = await fetchWeekFixStatus(week, orderYear);
  if (row?.exeAligned || row?.status === 'FIXED') {
    return {
      success: true,
      message: `[${week}] 확정 완료 (응답 지연 — 서버에서 이미 처리됨)`,
      updatedCount: row.fixedDetailCount,
      _recoveredFromAmbiguousResponse: true,
      parity: row,
    };
  }
  if (row?.status === 'FIXED_PENDING_STOCK') {
    return {
      success: true,
      message: `[${week}] 출고 확정됨 — 재고 마감 미완(exe 정합 확인 필요)`,
      updatedCount: row.fixedDetailCount,
      _recoveredFromAmbiguousResponse: true,
      parity: row,
      stockWarning: true,
    };
  }
  return data;
}

// ── 한글 금액 변환 (52,434,150 → "오천이백사십삼만사천일백오십원 정")
function numToKorean(n) {
  const num = Math.round(Math.abs(n || 0));
  if (num === 0) return '영원 정';
  const digits = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
  const pos4   = ['', '십', '백', '천'];
  const bigUnit = ['', '만', '억', '조'];
  function fourDigit(v) {
    let s = '';
    const d = [Math.floor(v/1000)%10, Math.floor(v/100)%10, Math.floor(v/10)%10, v%10];
    for (let i = 0; i < 4; i++) {
      if (!d[i]) continue;
      s += digits[d[i]] + pos4[3 - i];
    }
    return s;
  }
  const parts = [];
  let rem = num;
  for (let i = 0; i < 4; i++) {
    const chunk = rem % 10000;
    rem = Math.floor(rem / 10000);
    if (chunk > 0) parts.unshift(fourDigit(chunk) + bigUnit[i]);
  }
  return parts.join('') + '원 정';
}

// FormPrintEstimate는 DateTime을 yyyy/MM/dd로 ReportEstimate.Title에 전달한다.
function formatExePrintDate(value) {
  const text = String(value || '').trim();
  const m = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}/${String(m[2]).padStart(2, '0')}/${String(m[3]).padStart(2, '0')}`;
  return text;
}

// ── 견적서 품목별 출력 그룹. 국가+꽃명+품명을 함께 보아 국가 장미/수국/알스트로가 섞이지 않게 한다.
function getFlowerGroup(row) {
  const country = String(row?.CounName || '').toUpperCase();
  const flower = String(row?.FlowerName || '').toUpperCase();
  const prod = String(row?.ProdName || '').toUpperCase();
  const text = `${country} ${flower} ${prod}`;

  if (text.includes('ECUADOR') || text.includes('에콰도르')) return '에콰도르 장미';
  if (text.includes('COLOMBIA') || text.includes('콜롬비아')) {
    if (text.includes('ROSE') || text.includes('장미')) return '콜롬비아 장미';
    if (text.includes('HYDRANGEA') || text.includes('수국')) return '콜롬비아 수국';
    if (text.includes('ALSTRO') || text.includes('알스트로')) return '콜롬비아 알스트로';
    return '콜롬비아 기타';
  }
  if (text.includes('CHINA') || text.includes('중국')) return '중국';
  if (text.includes('NETHERLAND') || text.includes('HOLLAND') || text.includes('네덜란드')) return '네덜란드';
  if (text.includes('HYDRANGEA') || text.includes('수국')) return '수국';
  if (text.includes('ALSTRO') || text.includes('알스트로')) return '알스트로메리아';
  if (text.includes('CARNATION') || text.includes('카네이션')) return '카네이션';
  if (text.includes('ROSE') || text.includes('장미')) return '장미';
  return '기타';
}

// ── EstimateType 코드 → 한글명 매핑 (레거시 코드 fallback)
// 실제 DB 값은 이미 한글(불량차감/박스 등)이지만, 과거 데이터가 fee03-kr0010 같은
// 전산 코드로 남아있을 경우를 위한 안전 매핑

function isAlstroRow(row) {
  const text = `${row?.FlowerName || ''} ${row?.ProdName || ''}`.toUpperCase();
  return text.includes('ALSTRO') || text.includes('알스트로');
}

function normalizeEstimatePrintRow(row) {
  if (!isAlstroRow(row)) return row;
  const rawSteam = Number(row?.RawSteamQuantity) || 0;
  const rawBunch = Number(row?.RawBunchQuantity) || 0;
  const currentQty = Number(row?.Quantity) || 0;
  const steamQty = rawSteam > 0 ? rawSteam : (rawBunch > 0 ? rawBunch * 10 : currentQty);
  if (steamQty <= 0) return row;
  const total = (Number(row?.Amount) || 0) + (Number(row?.Vat) || 0);
  const displayCost = total > 0 ? Math.round(total / steamQty) : row?.Cost;
  return {
    ...row,
    Quantity: steamQty,
    Unit: '송이',
    Cost: displayCost,
  };
}

const ESTIMATE_TYPE_MAP = {
  'fee01': '단가차감', 'fee02': '검역차감', 'fee03': '불량차감',
  'fee04': '부족차감', 'fee05': '출하오류차감', 'fee06': '샘플',
  'kr0010': '불량차감', 'kr0011': '검역차감', 'kr0012': '단가차감',
};
function mapEstimateType(t) {
  if (!t) return '';
  // "fee03-kr0010" / "fee03" / "kr0010" 같은 코드 형식 감지 (영문/숫자/하이픈만)
  if (/^[a-z0-9-]+$/i.test(t)) {
    const parts = t.toLowerCase().split('-');
    for (const p of parts) {
      if (ESTIMATE_TYPE_MAP[p]) return ESTIMATE_TYPE_MAP[p];
    }
    return '차감'; // 매핑 없으면 generic label
  }
  // 이미 한글 (불량차감/박스 등)
  return t.replace(/\/(박스|단|송이)$/, '');
}

// ── 견적서 HTML 생성 — PDF 실제 서식과 동일
function buildEstimateHtml({
  bigoLabel,
  serialNo,
  printDate,
  custName,
  rows,
  logoDataUrl,
  aggregate = false,
  showBoxQty = true,
  showDistribDesc = false,
  showDeductionOutDay = false,
  showDeductionDescr = false,
  printFormat = ESTIMATE_PRINT_FORMAT.ESTIMATE,
}) {
  const docTitle = getPrintFormatDocTitle(printFormat);
  const prepared = prepareEstimatePrintRows(rows, {
    printFormat,
    showDistribDesc,
    showDeductionOutDay,
    showDeductionDescr,
  });
  const { rows: printRows, totals, statementFormat, descLabel } = prepared;
  const fmtN = n => Number(n || 0).toLocaleString();
  const totalSupply = totals.supply;
  const totalVat = totals.vat;
  const totalAmt = totals.total;
  const isDeduct = isEstimateDeductionRow;

  const td = (content, style = '') => {
    const esc = String(content ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<td style="border:1px solid #bbb;padding:2px 5px;vertical-align:middle;${style}">${esc}</td>`;
  };

  let itemRows;
  let tableHead;
  let tableFoot;
  let itemColGroup = '';

  if (statementFormat) {
    itemRows = printRows.map((r, i) => {
      const deduct = isDeduct(r);
      const rowBg = deduct ? 'background:#FFF8DC;' : '';
      const origin = getEstimateOriginCountry(r);
      const spec = getEstimateSpecLabel(r);
      const qty = Number(r.Quantity) || 0;
      const productName = `${estimateTypeLabel(r.EstimateType)}${getStatementProductName(r)}`;
      return `
    <tr>
      ${td(i + 1, `${rowBg}text-align:center;width:24px`)}
      ${td(productName, rowBg)}
      ${td(origin, `${rowBg}text-align:center;white-space:nowrap;font-size:8pt`)}
      ${td(r.Unit || '', `${rowBg}text-align:center;white-space:nowrap`)}
      ${td(spec, `${rowBg}text-align:center;white-space:nowrap;font-size:8pt;color:#555`)}
      ${td(fmtN(qty), `${rowBg}text-align:right;white-space:nowrap`)}
      ${td(fmtN(r.Cost), `${rowBg}text-align:right`)}
      ${td(fmtN(r.Amount), `${rowBg}text-align:right`)}
      ${td(fmtN(r.Vat), `${rowBg}text-align:right`)}
      ${td(descLabel(r), `${rowBg}font-size:7.5pt;color:#555`)}
    </tr>`;
    }).join('');

    tableHead = `
    <tr>
      <th class="item-th" style="width:24px">번호</th>
      <th class="item-th">품목</th>
      <th class="item-th" style="width:52px">원산지</th>
      <th class="item-th" style="width:32px">단위</th>
      <th class="item-th" style="width:42px">규격</th>
      <th class="item-th" style="width:42px">수량</th>
      <th class="item-th" style="width:52px">단가</th>
      <th class="item-th" style="width:62px">금액</th>
      <th class="item-th" style="width:52px">세액</th>
      <th class="item-th" style="width:88px">비고</th>
    </tr>`;
    tableFoot = `
    <tr class="foot-row">
      <td colspan="7" style="text-align:right;padding-right:12px">합계</td>
      <td style="text-align:right">${fmtN(totalSupply)}</td>
      <td style="text-align:right">${fmtN(totalVat)}</td>
      <td style="text-align:right;font-size:10pt;background:#dce8f5">${fmtN(totalAmt)}</td>
    </tr>`;
  } else {
    itemRows = printRows.map((r, i) => {
      const deduct = isDeduct(r);
      const rowBg  = deduct ? 'background:#FFF8DC;' : '';
      const productName = r._exePrint
        ? (r.ProdName || '')
        : `${estimateTypeLabel(r.EstimateType)}${r.ProdName || ''}`;
      const unitQuantity = r.UnitQuantity || `${fmtN(r.Quantity)}${r.Unit || ''}`;
      const descr = descLabel(r);
      return `
    <tr>
      ${td(i + 1, `${rowBg}text-align:center;padding:2px 3px;`)}
      ${td(productName, `${rowBg}padding:2px 10px;`)}
      ${td(unitQuantity, `${rowBg}text-align:right;white-space:nowrap;padding:2px 10px 2px 5px;`)}
      ${td(fmtN(r.Cost), `${rowBg}text-align:right;white-space:nowrap;padding:2px 10px 2px 5px;`)}
      ${td(fmtN(r.Amount), `${rowBg}text-align:right;white-space:nowrap;padding:2px 10px 2px 5px;`)}
      ${td(fmtN(r.Vat), `${rowBg}text-align:right;white-space:nowrap;padding:2px 10px 2px 5px;`)}
      ${td(descr, `${rowBg}padding:2px 10px;font-size:8pt;`)}
    </tr>`;
    }).join('');

    // ReportEstimate.cs item table: 7열·weight 합계 3.0 (1800 tenths mm).
    itemColGroup = `
      <colgroup>
        <col style="width:5.882%"><col style="width:32.353%"><col style="width:9.444%">
        <col style="width:8.791%"><col style="width:12.941%"><col style="width:11.765%">
        <col style="width:18.824%">
      </colgroup>`;
    tableHead = `
    <tr>
      <th class="item-th" style="width:24px">순번</th>
      <th class="item-th">품목명[규격]</th>
      <th class="item-th" style="width:54px">수량</th>
      <th class="item-th" style="width:54px">단가</th>
      <th class="item-th" style="width:74px">공급가액</th>
      <th class="item-th" style="width:60px">부가세</th>
      <th class="item-th" style="width:108px">적요</th>
    </tr>`;
    tableFoot = `
    <tr class="foot-row">
      <td colspan="2" style="text-align:right">공급가액</td>
      <td style="text-align:right">${fmtN(totalSupply)}</td>
      <td style="text-align:right">VAT</td>
      <td style="text-align:right">${fmtN(totalVat)}</td>
      <td style="text-align:right">합계</td>
      <td style="text-align:right;font-size:10pt;background:#dce8f5">${fmtN(totalAmt)}</td>
    </tr>`;
  }

  const serialDisplay = serialNo || formatExePrintDate(printDate);
  const heading = statementFormat ? docTitle : '견 적 서';
  const amtSuffix = isSupplyPrintFormat(printFormat) ? ' / 분배단가=공급가액' : '';

  const greetLine2 = statementFormat
    ? '2. 하기와 같이 거래 명세를 전달드립니다.'
    : '2. 하기와 같이 견적드리오니 검토하기 바랍니다.';

  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<title>${docTitle} — ${custName}</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:Gulim,'굴림','Malgun Gothic','맑은 고딕',sans-serif; font-size:9pt; padding:10mm 15mm; }
/* exe ReportEstimate: xrLabel1 굴림 16pt Bold+Underline */
h1 { text-align:center; font-family:Gulim,'굴림',serif; font-size:16pt; font-weight:bold;
     letter-spacing:0; text-decoration:underline; margin-bottom:6px; line-height:1.2; }
table { width:100%; border-collapse:collapse; }
.hdr-outer { border:1px solid #555; table-layout:fixed; }
/* exe: 좌 47.9% / 우 51.3% (0.1mm 기준 861.7 / 923.4) */
.hdr-left  { width:47.9%; vertical-align:top; border-right:1px solid #555; }
.hdr-right { width:51.3%; vertical-align:top; padding:0; }
/* exe: 라벨열 27.3mm 고정(Weight 1:2.15625) — 좌·우 동일 너비로 세로줄 맞춤 */
.info-table { width:100%; border-collapse:collapse; table-layout:fixed; }
.info-table td { border:1px solid #999; padding:2px 5px; font-size:8pt;
                white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
                text-align:left; vertical-align:middle; line-height:1.35; }
.info-table td.info-key { background:#f5f5f5; font-weight:bold; color:#333; width:27.3mm; }
.info-table td.info-val { width:auto; font-size:8pt; }
/* 로고: exe xrPictureBox1 약 55.5×18mm, Zoom */
.logo-area { text-align:center; border-bottom:1px solid #555; padding:2mm 3mm; margin:0; line-height:0; background:#fff;
             height:18mm; overflow:hidden; display:flex; align-items:center; justify-content:center; }
.logo-area img { display:block; height:16mm; max-height:16mm; max-width:92%; object-fit:contain; }
.greet     { font-size:8pt; padding:6px 8px; border-top:1px solid #ddd; line-height:1.7; }
.amt-row   { border:1px solid #555; border-top:none; padding:5px 10px;
             display:flex; justify-content:space-between; align-items:center; margin-bottom:0; }
.amt-ko    { font-weight:bold; font-size:9pt; }
.amt-num   { font-size:8.5pt; }
.item-th   { background:#e8e8e8; border:1px solid #888; padding:3px 5px; font-size:8.5pt; text-align:center; }
.item-td   { border:1px solid #ccc; padding:2px 5px; font-size:8.5pt; vertical-align:middle; }
.foot-row td { background:#f5f5f5; border:1px solid #888; padding:3px 8px; font-size:8.5pt; font-weight:bold; }
@media print { @page{size:A4;margin:0;} body{padding:10mm 15mm;}
  .logo-area{height:18mm;padding:1.5mm 2mm;} .logo-area img{height:16mm;max-height:16mm;} }
</style>
</head><body>
<h1>${heading}</h1>

<table class="hdr-outer">
  <tr>
    <td class="hdr-left">
      <!-- 왼쪽: 수신/청조 그리드 (exe xrTable2) -->
      <table class="info-table">
        <colgroup><col style="width:27.3mm"><col></colgroup>
        <tr><td class="info-key">일련번호</td><td class="info-val">${serialDisplay}</td></tr>
        <tr><td class="info-key">수&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;신</td><td class="info-val"><b>${custName}</b></td></tr>
        <tr><td class="info-key">참&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;조</td><td class="info-val"></td></tr>
        <tr><td class="info-key">TEL/FAX</td><td class="info-val"></td></tr>
        <tr><td class="info-key">결제조건</td><td class="info-val"></td></tr>
        <tr><td class="info-key">유효기간</td><td class="info-val"></td></tr>
        <tr><td class="info-key">비&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;고</td><td class="info-val">${bigoLabel}</td></tr>
      </table>
      <div class="greet">
        1. 귀사의 일익 번창하심을 기원합니다.<br>
        ${greetLine2}
      </div>
    </td>
    <td class="hdr-right">
      <!-- 오른쪽: NENOVA 로고 (로컬 base64 인라인) + 회사정보 -->
      <div class="logo-area">
        <img src="${logoDataUrl || ''}" alt="NENOVA"
             onerror="this.style.display='none';this.nextElementSibling.style.display='block'"/>
        <div style="display:none;padding:8px 10px;font-size:18pt;font-weight:900;letter-spacing:4px;color:#1a3a6b;font-family:'Arial Black',Arial,sans-serif;text-align:left;">NENOVA</div>
      </div>
      <table class="info-table">
        <colgroup><col style="width:27.3mm"><col></colgroup>
        <tr><td class="info-key">사업자등록번호</td><td class="info-val">134-86-94367</td></tr>
        <tr><td class="info-key">회사명/대표</td><td class="info-val">(주) 네노바 / 김원배</td></tr>
        <tr><td class="info-key">주소</td><td class="info-val">서울특별시 서초구 언남길 15-7 102호 (양재동, 하얀빌딩)</td></tr>
        <tr><td class="info-key">업태/종목</td><td class="info-val">도매 / 무역</td></tr>
        <tr><td class="info-key">계좌번호</td><td class="info-val">하나은행 630-008129-149 (주)네노바</td></tr>
        <tr><td class="info-key">TEL/FAX</td><td class="info-val">025758003 / 02-576-8003</td></tr>
      </table>
    </td>
  </tr>
</table>

<!-- 금액 행 -->
<div class="amt-row">
  <span class="amt-ko">금 액 : ${numToKorean(totalAmt)}</span>
  <span class="amt-num">(￦ ${fmtN(totalAmt)}원${amtSuffix})</span>
</div>

<!-- 품목 테이블 -->
<table class="item-table">
  ${itemColGroup}
  <thead>
    ${tableHead}
  </thead>
  <tbody>${itemRows}</tbody>
  <tfoot>
    ${tableFoot}
  </tfoot>
</table>
<script>window.onload=()=>{window.print();window.onafterprint=()=>window.close();}</script>
</body></html>`;
}

function extractEstimateBody(html) {
  const bodyStart = html.indexOf('<body>');
  const scriptStart = html.indexOf('<script>', bodyStart);
  const bodyEnd = html.indexOf('</body>', bodyStart);
  if (bodyStart < 0) return html;
  const end = scriptStart > -1 ? scriptStart : bodyEnd;
  return html.slice(bodyStart + '<body>'.length, end > -1 ? end : undefined).trim();
}

function extractEstimateStyle(html) {
  const match = html.match(/<style>([\s\S]*?)<\/style>/);
  return match ? match[1] : '';
}

function buildEstimatePrintBundle(htmlPages, printFormat = ESTIMATE_PRINT_FORMAT.ESTIMATE) {
  const pages = (htmlPages || []).filter(Boolean);
  if (pages.length === 0) return '';
  const style = [...new Set(pages.map(extractEstimateStyle).filter(Boolean))].join('\n');
  const sections = pages
    .map(html => `<section class="print-page">${extractEstimateBody(html)}</section>`)
    .join('\n');
  const bundleTitle = `${getPrintFormatDocTitle(printFormat)} 일괄 인쇄`;
  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<title>${bundleTitle}</title>
<style>
${style}
body { padding:0 !important; }
.print-page { padding:10mm 15mm; page-break-after:always; break-after:page; }
.print-page:last-child { page-break-after:auto; break-after:auto; }
@media print {
  body { padding:0 !important; }
  .print-page { padding:10mm 15mm; page-break-after:always; break-after:page; }
  .print-page:last-child { page-break-after:auto; break-after:auto; }
}
</style>
</head><body>
${sections}
</body></html>`;
}

function getShipmentManager(ship) {
  return getEstimateShipmentManager(ship);
}
const ESTIMATE_TYPES = [
  '불량차감/박스','불량차감/단','불량차감/송이',
  '검역차감/박스','검역차감/단','검역차감/송이',
  '판매요청/박스','판매요청/단','판매요청/송이',
  '샘플/송이','샘플/단','단가차감/단','단가차감/송이',
  '취소 / Cancelar차감/송이','취소 / Cancelar차감/단','부족차감/단','출하오류차감/단'
];

// ── 검색 가능한 드롭다운 공통 컴포넌트
function SearchableSelect({ options, value, onChange, placeholder = '검색...' }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef();

  // 외부 클릭 닫기
  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // 품목 점수 계산은 전체 카탈로그를 훑기 때문에 타이핑 중간 값으로는 계산하지 않고,
  // 부모 리렌더마다 다시 계산하지 않도록 결과를 기억한다.
  const deferredQ = useDebouncedValue(q, PRODUCT_SEARCH_DEBOUNCE_MS);
  const filtered = useMemo(
    // 검색어가 없을 때 전체 목록을 그리면 DOM 노드가 수천 개가 되어 드롭다운이 멈춘다.
    () => rankProductSearchOptions(deferredQ, options, { limit: PRODUCT_SEARCH_RESULT_LIMIT }),
    [deferredQ, options],
  );

  const selectedLabel = options.find(o => o.value === value)?.label || '';

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <input
        className="form-control"
        placeholder={placeholder}
        value={open ? q : selectedLabel}
        onFocus={() => { setOpen(true); setQ(''); }}
        onChange={e => setQ(e.target.value)}
        readOnly={!open}
        style={{ cursor: open ? 'text' : 'pointer', background: open ? '#fff' : '#F8F8F8' }}
      />
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 300,
          background: '#fff', border: '2px solid var(--border2)',
          width: '100%', maxHeight: 220, overflowY: 'auto',
          boxShadow: '2px 2px 8px rgba(0,0,0,0.2)', minWidth: 280
        }}>
          {filtered.length === 0
            ? <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--text3)' }}>검색 결과 없음</div>
            : filtered.map(o => (
              <div key={o.value}
                onClick={() => { onChange(o.value); setOpen(false); setQ(''); }}
                style={{ padding: '5px 10px', cursor: 'pointer', borderBottom: '1px solid #EEE', fontSize: 12 }}
                onMouseEnter={e => e.currentTarget.style.background = '#E8F0FF'}
                onMouseLeave={e => e.currentTarget.style.background = '#fff'}
              >
                {o.label}
                {o.sub && <div style={{ fontSize: 10, color: 'var(--text3)' }}>{o.sub}</div>}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

export default function Estimate() {
  const { t } = useLang();
  // 차수: 단순 숫자 (14, 15 …) — 세부차수(14-01, 14-02)는 자동 그룹핑
  const [weekNum, setWeekNum] = useState(getCurrentWeekNum);
  const [yearStr, setYearStr] = useState(getCurrentYearStr);
  // 차수 확정 모달
  const [fixModal, setFixModal] = useState(null); // null | { stage, week, issues, result }
  const [fixWorking, setFixWorking] = useState(false);
  const [fixProgress, setFixProgress] = useState(null);
  const [fixServerLogs, setFixServerLogs] = useState([]);
  const [fixLogWeeks, setFixLogWeeks] = useState([]);
  const [fixLogSince, setFixLogSince] = useState(0);
  const [fixStatusModal, setFixStatusModal] = useState(null);
  const [fixStatusLoading, setFixStatusLoading] = useState(false);
  const [fixStatusSyncing, setFixStatusSyncing] = useState(false);
  const fixStatusDigestRef = useRef('');
  const [fixStatusBatchCount, setFixStatusBatchCount] = useState(FIX_STATUS_COUNT);
  const [fixStatusAvailableCategories, setFixStatusAvailableCategories] = useState([]);
  const [fixStatusSelectedCategories, setFixStatusSelectedCategories] = useState([]);
  const [fixStatusCategoryPreset, setFixStatusCategoryPreset] = useState('all');
  const [selectedFixStatusWeeks, setSelectedFixStatusWeeks] = useState(new Set());
  // 주문 vs 출고 불일치 검증
  const [mismatch, setMismatch] = useState(null); // { total, shortageCount, overflowCount, items }
  const [mismatchModalOpen, setMismatchModalOpen] = useState(false);
  // 자동조회 토글 — 차수 변경 시 자동으로 조회 (확정된 차수만 결과 있음, 옛 PATCH 안 거치고 isFix=1 필터됨)
  const [autoLoad, setAutoLoad] = useState(true);
  // 미확정 포함 토글 — 켜면 isFix=0 차수도 견적서에 표시
  const [includeUnfixed, setIncludeUnfixed] = useState(false);
  const queryIncludeUnfixedRef = useRef(false);
  const [highlightDeductions, setHighlightDeductions] = useState(false);
  const [previewCapture, setPreviewCapture] = useState(false);
  // 최근 2개 차수만 표시 토글 (default ON)
  const [recentOnly, setRecentOnly] = useState(true);
  // 차수별 확정 취소 작업 상태
  const [unfixingWeek, setUnfixingWeek] = useState(null); // 작업 중인 세부차수
  const [rangeUnfixWorking, setRangeUnfixWorking] = useState(false);
  const [rangeUnfixStatus, setRangeUnfixStatus] = useState('');
  useEffect(() => {
    try {
      const v = localStorage.getItem('est_autoLoad'); if (v === '0') setAutoLoad(false);
      const u = localStorage.getItem('est_inclUnfixed'); if (u === '1') setIncludeUnfixed(true);
      const r = localStorage.getItem('est_recentOnly'); if (r === '0') setRecentOnly(false);
    } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem('est_autoLoad', autoLoad ? '1' : '0'); } catch {} }, [autoLoad]);
  useEffect(() => { try { localStorage.setItem('est_inclUnfixed', includeUnfixed ? '1' : '0'); } catch {} }, [includeUnfixed]);
  useEffect(() => { try { localStorage.setItem('est_recentOnly', recentOnly ? '1' : '0'); } catch {} }, [recentOnly]);

  useEffect(() => {
    if (!fixProgress) return;
    let stopped = false;
    const logWeeks = fixLogWeeks.length ? fixLogWeeks : [`${String(weekNum || '').padStart(2, '0')}-`];
    const refreshLogs = async () => {
      try {
        const data = await apiGet('/api/dev/app-log', { limit: 120, category: 'shipmentFix' });
        if (stopped) return;
        const logs = (data.logs || [])
          .filter(l => !fixLogSince || parseAppLogTime(l.CreateDtm) >= fixLogSince)
          .filter(l => logWeeks.some(wk => String(l.Detail || '').includes(wk)))
          .filter(l => {
            const step = String(l.Step || '');
            return step.startsWith('fix_') || step.startsWith('stock_calc') || step.includes('_stock_calc');
          })
          .slice(-40)
          .reverse();
        setFixServerLogs(logs);
      } catch {
        if (!stopped) setFixServerLogs([]);
      }
    };
    refreshLogs();
    const timer = setInterval(refreshLogs, 1500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [fixProgress, weekNum, fixLogWeeks, fixLogSince]);

  useEffect(() => {
    if (!(rangeUnfixWorking || rangeUnfixStatus)) return;
    let stopped = false;
    const logWeeks = fixLogWeeks;
    const refreshLogs = async () => {
      try {
        const data = await apiGet('/api/dev/app-log', { limit: 120, category: 'shipmentFix' });
        if (stopped) return;
        const logs = (data.logs || [])
          .filter(l => !fixLogSince || parseAppLogTime(l.CreateDtm) >= fixLogSince)
          .filter(l => String(l.Step || '').startsWith('unfix_'))
          .filter(l => logWeeks.length === 0 || logWeeks.some(wk => String(l.Detail || '').includes(wk)))
          .slice(-40)
          .reverse();
        setFixServerLogs(logs);
      } catch {
        if (!stopped) setFixServerLogs([]);
      }
    };
    refreshLogs();
    const timer = setInterval(refreshLogs, 1500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [rangeUnfixWorking, rangeUnfixStatus, fixLogWeeks, fixLogSince]);

  // 특정 세부차수 확정 취소 (한 차수 단위)
  const unfixOneWeek = async (subWeek, force = false) => {
    if (!subWeek) return;
    if (!confirm(`[${subWeek}] 차수 확정을 취소하시겠습니까?\n취소 후 단가/수량 수정 가능합니다.`)) return;
    setUnfixingWeek(subWeek);
    setFixLogWeeks([subWeek]);
    setFixLogSince(Date.now() - 3000);
    setFixServerLogs([]);
    try {
      const { data: d } = await postShipmentFix({ week: subWeek, orderYear: yearStr, action: 'unfix' });
      if (!d.success) {
        alert(`확정 취소 실패: ${d.error || '알 수 없는 오류'}`);
        return;
      }
      alert(`${d.message || `[${subWeek}] 확정 취소 완료`}${d.stockWarning ? `\n\n참고: 재고 재계산 경고 ${d.stockErrors?.length || 0}건이 있습니다.` : ''}`);
      setIncludeUnfixed(true);
      await load(true, { includeUnfixedOverride: true }); // 화면 갱신
    } catch (e) {
      alert(`확정 취소 오류: ${e.message}`);
    } finally {
      setUnfixingWeek(null);
    }
  };

  const formatSubWeek = (parentWeek, sub = '01') => `${String(parentWeek).padStart(2, '0')}-${sub}`;

  const getLatestParentWeek = () => {
    const candidates = [weekNum, getCurrentWeekNum()];
    shipments.forEach(s => {
      if (s.ParentWeek) candidates.push(s.ParentWeek);
      (s.SubWeeks || '').split(',').forEach(sw => {
        const m = sw.match(/^(\d{1,2})-/);
        if (m) candidates.push(m[1]);
      });
    });
    return Math.max(...candidates.map(v => parseInt(v, 10)).filter(Number.isFinite));
  };

  const getSelectedFixRange = (parentWeekOverride = weekNum) => {
    const selectedParent = parseInt(parentWeekOverride, 10);
    if (!Number.isFinite(selectedParent)) return null;
    return getRecentFixStatusRange(selectedParent, fixStatusBatchCount);
  };

  const getFixStatusCountryFlowers = () => {
    if (fixStatusCategoryPreset === 'all' || !fixStatusSelectedCategories.length) return [];
    return resolveCountryFlowerFilter(fixStatusSelectedCategories, fixStatusAvailableCategories);
  };

  const ensureFixStatusCategorySelection = () => {
    if (fixStatusCategoryPreset === 'all') return true;
    const cf = resolveCountryFlowerFilter(fixStatusSelectedCategories, fixStatusAvailableCategories);
    if (cf.length > 0) return true;
    alert('선택한 카테고리가 조회 구간에 없습니다. 카테고리를 다시 선택하거나 「전체」를 사용하세요.');
    return false;
  };

  const fixStatusCategoryLabel = () => {
    const cf = getFixStatusCountryFlowers();
    if (!cf.length) return '전체 카테고리';
    if (cf.length <= 2) return cf.join(', ');
    return `${cf.slice(0, 2).join(', ')} 외 ${cf.length - 2}개`;
  };

  const applyFixStatusCategoryPreset = (presetId) => {
    setFixStatusCategoryPreset(presetId);
    if (presetId === 'all') {
      setFixStatusSelectedCategories([]);
      return;
    }
    setFixStatusSelectedCategories(categoriesForPreset(presetId, fixStatusAvailableCategories));
  };

  const toggleFixStatusCategory = (category) => {
    setFixStatusCategoryPreset('custom');
    setFixStatusSelectedCategories(prev => {
      const set = new Set(prev);
      if (set.has(category)) set.delete(category);
      else set.add(category);
      return [...set].sort((a, b) => a.localeCompare(b, 'ko'));
    });
  };

  const checkFixStatus = async ({ orderYearOverride = yearStr, parentWeekOverride = weekNum } = {}) => {
    if (!parentWeekOverride) { alert('차수를 입력하세요.'); return; }
    const range = getSelectedFixRange(parentWeekOverride);
    if (!range) { alert('확정 현황을 확인할 차수를 알 수 없습니다.'); return; }
    setFixStatusLoading(true);
    try {
      const res = await fetch(`/api/shipment/fix-status?${buildFixStatusQuery({ orderYear: orderYearOverride, fromWeek: range.fromWeek, toWeek: range.toWeek })}`, {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '확정 현황 조회 실패');
      const weeks = (data.weeks || [])
        .filter(w => Number(w.masterCount || 0) > 0 || Number(w.detailCount || 0) > 0)
        .sort((a, b) => String(b.WeekKey || b.OrderWeek).localeCompare(String(a.WeekKey || a.OrderWeek)));
      setSelectedFixStatusWeeks(new Set());
      setFixStatusAvailableCategories(normalizeCategoryList(data.categories || []));
      setFixStatusSelectedCategories([]);
      setFixStatusCategoryPreset('all');
      setFixStatusModal({ ...data, weeks, range });
      return data;
    } catch (e) {
      alert(`${orderYearOverride}년 ${range.fromWeek}~${range.toWeek} 확정 현황 자동 조회 오류: ${e.message}`);
      return null;
    } finally {
      setFixStatusLoading(false);
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('openFixStatus') !== '1') return;
    const requestedYear = String(params.get('year') || '').replace(/\D/g, '').slice(0, 4);
    const requestedWeek = String(params.get('week') || '').replace(/\D/g, '').slice(0, 2);
    if (!requestedYear || !requestedWeek) return;
    setYearStr(requestedYear);
    setWeekNum(String(Number(requestedWeek)));
    checkFixStatus({ orderYearOverride: requestedYear, parentWeekOverride: requestedWeek });
  }, []);

  const unfixRangeToSelectedWeek = async (force = false) => {
    if (!weekNum) { alert('차수를 입력하세요.'); return; }

    const range = getSelectedFixRange();
    if (!range) {
      alert('확정취소할 차수를 확인할 수 없습니다.');
      return;
    }
    const { fromWeek, toWeek } = range;

    setRangeUnfixWorking(true);
    setRangeUnfixStatus('확정취소 대상 확인 중');
    try {
      const statusRes = await fetch(`/api/shipment/fix-status?${buildFixStatusQuery({ orderYear: yearStr, fromWeek, toWeek })}`, {
        credentials: 'same-origin',
      });
      const status = await statusRes.json();
      if (!status.success) throw new Error(status.error || '구간 확정상태 조회 실패');

      const targetWeeks = (status.weeks || [])
        .filter(w => w.status === 'FIXED' || w.status === 'PARTIAL')
        .map(w => w.OrderWeek || w.week)
        .filter(Boolean)
        .sort()
        .reverse();

      if (targetWeeks.length === 0) {
        alert(`[${fromWeek} ~ ${toWeek}] 구간에 확정취소할 차수가 없습니다.`);
        return;
      }

      if (!force) {
        const ok = confirm(
          `[${fromWeek} ~ ${toWeek}] 구간 확정취소를 진행할까요?\n\n` +
          `대상: ${targetWeeks.join(', ')}\n\n` +
          `높은 차수부터 낮은 차수 순서로 취소되어 ${weekNum}차 수정이 가능해집니다.`
        );
        if (!ok) return;
      }

      const res = await fetch('/api/shipment/fix-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          orderYear: yearStr,
          fromWeek,
          toWeek,
          ...(getFixStatusCountryFlowers().length ? { countryFlowers: getFixStatusCountryFlowers() } : {}),
        }),
      });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || '구간 확정취소 실패');
      }

      setRangeUnfixStatus('확정취소 완료 — 화면 갱신 중');
      alert(data.message || `[${fromWeek} ~ ${toWeek}] 구간 확정취소 완료`);
      setIncludeUnfixed(true);
      await load(true, { includeUnfixedOverride: true });
    } catch (e) {
      setRangeUnfixStatus('');
      alert(`구간 확정취소 오류: ${e.message}`);
    } finally {
      setRangeUnfixWorking(false);
      setTimeout(() => setRangeUnfixStatus(''), 1500);
    }
  };

  const weekPrev = () => setWeekNum(w => String(Math.max(1, parseInt(w)||1) - 1));
  const weekNext = () => setWeekNum(w => String(Math.min(52, parseInt(w)||1) + 1));

  // 왼쪽 패널 - 출고 목록
  const [shipments, setShipments] = useState([]);
  const [selectedGroups, setSelectedGroups] = useState(new Set()); // 다중 선택 (전체선택 + 인쇄용)
  const [selectedId, setSelectedId] = useState(null);
  const [selectedCustKey, setSelectedCustKey] = useState(null);
  const estimateSelectionStateRef = useRef(createEstimateSelectionState());
  const renderedSelectionScopeRef = useRef(createEstimateSelectionScope());

  // 오른쪽 패널 - 견적서 목록
  const [items, setItems] = useState([]);
  // 인쇄용 왼쪽 업체 선택과 분리된, 현재 상세의 불량/검역 Estimate 삭제 선택.
  const [selectedDeductionKeys, setSelectedDeductionKeys] = useState(() => new Set());
  const [deductionDeleting, setDeductionDeleting] = useState(false);
  const deductionDeleteInFlightRef = useRef(false);
  const deductionDeleteScopeRef = useRef('');

  // 업체 검색 드롭다운
  const [custSearch, setCustSearch] = useState('');
  const [custQwertyBuf, setCustQwertyBuf] = useState('');
  const [custInputMode, setCustInputMode] = useState('ko');
  const [custList, setCustList] = useState([]);
  const [selectedCust, setSelectedCust] = useState(null);
  const [showCustDrop, setShowCustDrop] = useState(false);
  const custDropRef = useRef();
  // 늦게 도착한 이전 검색어 응답이 최신 목록을 덮어쓰지 못하게 하는 요청 순번.
  const custReqSeq = useRef(0);
  // 선택으로 채워진 검색어. 이 값으로는 재검색하지 않는다.
  const custPickedName = useRef(null);

  // WeekDay 필터 — 업체 검색 시에도 EXE 기본값인 전체 출고요일을 유지한다.
  const [activeWD, setActiveWD] = useState(new Set(WEEKDAYS));

  const buildSelectionScope = useCallback((overrides = {}) => {
    const hasOverride = (key) => Object.prototype.hasOwnProperty.call(overrides, key);
    const valueOr = (key, fallback) => hasOverride(key) ? overrides[key] : fallback;
    const filterCustKey = valueOr('filterCustKey', selectedCust?.CustKey);
    const preferredCustKey = valueOr('selectedCustKey', selectedCust?.CustKey ?? selectedCustKey);
    const selectedGroupId = valueOr(
      'selectedId',
      selectedCust && Number(selectedCust.CustKey) !== Number(selectedCustKey) ? null : selectedId,
    );
    return createEstimateSelectionScope({
      year: valueOr('year', yearStr),
      week: valueOr('week', weekNum),
      selectedId: selectedGroupId,
      selectedCustKey: preferredCustKey,
      filterCustKey,
      includeUnfixed: valueOr('includeUnfixed', queryIncludeUnfixedRef.current || includeUnfixed),
      weekDays: valueOr('weekDays', activeWD),
    });
  }, [activeWD, includeUnfixed, selectedCust, selectedCustKey, selectedId, weekNum, yearStr]);

  const renderedSelectionScope = useMemo(() => buildSelectionScope(), [buildSelectionScope]);
  // Write during render so a timeout from an earlier render is rejected even
  // before this render's effects (or auto-load) get a chance to run.
  renderedSelectionScopeRef.current = renderedSelectionScope;

  const activateSelectionScope = useCallback((scope) => {
    renderedSelectionScopeRef.current = scope;
    estimateSelectionStateRef.current.syncScope(scope);
  }, []);

  const beginCurrentSelectionRequest = useCallback((channel, scope, fresh = false) => (
    estimateSelectionStateRef.current[fresh ? 'beginFreshIfCurrent' : 'beginIfCurrent'](
      channel,
      scope,
      renderedSelectionScopeRef.current,
    )
  ), []);

  // A changed year/week/customer/filter must invalidate already-started list,
  // detail, mismatch, and their finally handlers. Clear spinners even when
  // auto-load is off, because no replacement request will do it for us.
  useEffect(() => {
    const scopeChanged = !sameEstimateSelectionScope(
      estimateSelectionStateRef.current.currentScope(),
      renderedSelectionScope,
    );
    estimateSelectionStateRef.current.syncScope(renderedSelectionScope);
    if (scopeChanged) {
      setLoading(false);
      setItemLoading(false);
    }
  }, [renderedSelectionScope]);

  const pickCustomer = useCallback((c) => {
    if (!c) return;
    // 진행 중인 검색 응답을 무효화해야 선택 직후 목록이 다시 덮이지 않는다.
    custReqSeq.current += 1;
    custPickedName.current = c.CustName;
    setSelectedCust(c);
    setCustSearch(c.CustName);
    setCustQwertyBuf('');
    setShowCustDrop(false);
    // 업체를 새로 검색하면 EXE 기본값과 같이 모든 출고요일을 다시 활성화한다.
    setActiveWD(new Set(WEEKDAYS));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const requestedYear = String(params.get('year') || '').replace(/\D/g, '').slice(0, 4);
    const requestedWeek = String(params.get('week') || '').replace(/\D/g, '').slice(0, 2);
    const requestedCustKey = Number(params.get('custKey') || 0);
    const requestedCustName = String(params.get('custName') || '').trim();
    if (params.get('includeUnfixed') === '1') {
      queryIncludeUnfixedRef.current = true;
      setIncludeUnfixed(true);
    }
    if (params.get('highlightDeductions') === '1') setHighlightDeductions(true);
    if (params.get('previewCapture') === '1') {
      setPreviewCapture(true);
      setHighlightDeductions(true);
    }
    if (requestedYear) setYearStr(requestedYear);
    if (requestedWeek) setWeekNum(String(Number(requestedWeek)));
    if (Number.isInteger(requestedCustKey) && requestedCustKey > 0) {
      pickCustomer({ CustKey: requestedCustKey, CustName: requestedCustName || `#${requestedCustKey}` });
    }
  }, [pickCustomer]);

  const resetCustomerSearch = useCallback((nextSearch = '') => {
    custReqSeq.current += 1;
    custPickedName.current = null;
    setCustSearch(nextSearch);
    setCustQwertyBuf('');
  }, []);

  const clearCustomerFilter = useCallback(() => {
    resetCustomerSearch('');
    setSelectedCust(null);
  }, [resetCustomerSearch]);

  // 거래처 드롭다운 키보드 탐색
  const custNav = useDropdownNav(
    custList,
    pickCustomer,
    () => setShowCustDrop(false)
  );

  // 로딩
  const [loading, setLoading] = useState(false);
  const [itemLoading, setItemLoading] = useState(false);

  // 견적서 로고 (base64 데이터 URL) — iframe srcdoc 에서는 상대 URL이 동작하지 않아 반드시 인라인.
  const [logoDataUrl, setLogoDataUrl] = useState(null);
  const logoDataUrlRef = useRef(null);
  const logoLoadPromiseRef = useRef(null);

  const blobToDataUrl = useCallback((blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  }), []);

  const loadEstimateLogoDataUrl = useCallback(async () => {
    if (logoDataUrlRef.current) return logoDataUrlRef.current;
    if (logoLoadPromiseRef.current) return logoLoadPromiseRef.current;

    logoLoadPromiseRef.current = (async () => {
      const paths = ['/nenova-logo-estimate.png', '/nenova-logo.png'];
      for (const path of paths) {
        try {
          const res = await fetch(path);
          if (!res.ok) continue;
          const blob = await res.blob();
          if (!blob || blob.size < 64) continue;
          const dataUrl = await blobToDataUrl(blob);
          if (!String(dataUrl || '').startsWith('data:image/')) continue;
          logoDataUrlRef.current = dataUrl;
          setLogoDataUrl(dataUrl);
          return dataUrl;
        } catch {
          /* try next path */
        }
      }
      return null;
    })();

    try {
      return await logoLoadPromiseRef.current;
    } finally {
      logoLoadPromiseRef.current = null;
    }
  }, [blobToDataUrl]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    loadEstimateLogoDataUrl().catch(() => {});
  }, [loadEstimateLogoDataUrl]);

  // 불량/검역 모달
  const [showDefect, setShowDefect] = useState(false);
  const [products, setProducts] = useState([]);  // 품목 전체 목록 (드롭다운용)
  const [estimateTypes, setEstimateTypes] = useState([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [showAdditionalProduct, setShowAdditionalProduct] = useState(false);
  const [pendingAdds, setPendingAdds] = useState([]);
  const [defectContext, setDefectContext] = useState(null);
  const [defectContextLoading, setDefectContextLoading] = useState(false);
  const [defectContextError, setDefectContextError] = useState('');

  // 품목명을 클릭하면 기존 견적 행의 상세 정보창을 연다.
  // Estimate(불량/검역/판매요청)는 전산 ClassEstimate.Update 범위로 직접 저장하고,
  // 정상출고는 기존 ShipmentDate/ShipmentDetail 수정 사이클을 그대로 사용한다.
  const [itemEditor, setItemEditor] = useState(null);
  const [selectedItemForEdit, setSelectedItemForEdit] = useState(null);
  const [itemEditorSaving, setItemEditorSaving] = useState(false);
  const [itemEditorError, setItemEditorError] = useState('');

  // ── 단가 수정 상태 (P3) ─────────────────────────
  // costEdits[sdetailKey] = 수정된 단가 (string)
  const [costEdits, setCostEdits] = useState({});
  // qtyEdits[sdateKey|estimateKey] = 수정된 견적 수량 (string)
  const [qtyEdits, setQtyEdits] = useState({});
  const [qtyApplying, setQtyApplying] = useState(false);
  const [qtyResult, setQtyResult] = useState(null);
  const [costMode, setCostMode] = useState('once'); // 'once' | 'fixed' | 'weekFav'
  const [costApplying, setCostApplying] = useState(false);
  const [editApplyTitle, setEditApplyTitle] = useState('단가 적용');
  const [costApplyLog, setCostApplyLog] = useState([]); // 진행 단계 로그
  const [costResult, setCostResult] = useState(null);   // 완료 후 결과
  const [editDraftHydratedScope, setEditDraftHydratedScope] = useState('');
  const [estimateEditUserId, setEstimateEditUserId] = useState('');
  const automaticEditOperationRef = useRef(0);
  const [automaticEditProgress, setAutomaticEditProgress] = useState(null);

  useEffect(() => {
    let stopped = false;
    apiGet('/api/auth/me')
      .then(data => {
        if (!stopped) setEstimateEditUserId(String(data?.user?.userId || '').trim());
      })
      .catch(() => {
        if (!stopped) setEstimateEditUserId('');
      });
    return () => { stopped = true; };
  }, []);

  const beginAutomaticEditProgress = useCallback(({ weeks, title, pollServerLogs = false }) => {
    const operationId = `estimate-edit-${Date.now()}-${++automaticEditOperationRef.current}`;
    setAutomaticEditProgress(createEstimateEditProgress({
      operationId,
      orderYear: yearStr,
      weeks,
      userId: estimateEditUserId,
      pollServerLogs,
      title,
    }));
    return operationId;
  }, [estimateEditUserId, yearStr]);

  const appendAutomaticEditStage = useCallback((operationId, stage) => {
    setAutomaticEditProgress(prev => appendEstimateEditProgress(prev, operationId, stage));
  }, []);

  const finishAutomaticEditProgress = useCallback((operationId, result) => {
    setAutomaticEditProgress(prev => finishEstimateEditProgress(prev, operationId, result));
  }, []);

  const automaticEditScopeKey = automaticEditProgress
    ? `${automaticEditProgress.orderYear}|${automaticEditProgress.weeks.join(',')}`
    : '';

  // Re-render elapsed time while a scoped automatic edit is actually running.
  useEffect(() => {
    if (!automaticEditProgress?.running) return undefined;
    const operationId = automaticEditProgress.operationId;
    const timer = setInterval(() => {
      setAutomaticEditProgress(prev => (
        prev?.operationId === operationId && prev.running
          ? { ...prev, lastProgressTickAt: Date.now() }
          : prev
      ));
    }, 1000);
    return () => clearInterval(timer);
  }, [automaticEditProgress?.operationId, automaticEditProgress?.running]);

  // AppLog has no operation id. Keep it visually separate from the browser's
  // own stages and only retain records matching this edit's year/week/time.
  useEffect(() => {
    const operation = automaticEditProgress;
    if (!operation?.running || !operation.pollServerLogs || operation.weeks.length === 0) return undefined;
    const operationId = operation.operationId;
    let stopped = false;
    let inFlight = false;
    let failures = 0;
    let timer = null;

    const schedule = (delay) => {
      if (!stopped) timer = setTimeout(refresh, delay);
    };
    async function refresh() {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        const data = await apiGet('/api/dev/app-log', { limit: 120, category: 'shipmentFix' });
        if (!stopped) {
          failures = 0;
          setAutomaticEditProgress(prev => mergeEstimateEditServerLogs(prev, operationId, data?.logs || [], Date.now()));
          schedule(ESTIMATE_EDIT_LOG_POLL_MS);
        }
      } catch (error) {
        if (!stopped) {
          failures += 1;
          setAutomaticEditProgress(prev => recordEstimateEditPollFailure(prev, operationId, error, Date.now()));
          schedule(nextEstimateEditPollDelay(failures));
        }
      } finally {
        inFlight = false;
      }
    }

    refresh();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [automaticEditProgress?.operationId, automaticEditProgress?.running, automaticEditScopeKey]);

  // 출력 다이얼로그
  const [showPrintDialog, setShowPrintDialog] = useState(false);
  const [printOpts, setPrintOpts] = useState({
    printDate: new Date().toISOString().slice(0, 10),
    splitMode: 'combined',   // 'combined' | 'split'
    printFormat: ESTIMATE_PRINT_FORMAT.ESTIMATE, // 'estimate' | 'statement'
    outType:   'total',      // 'total' | 'select'
    serialNo:  '',
    showBoxQty: true,
    showDistribDesc: false,
    showDeductionOutDay: false,
    showDeductionDescr: false,
  });

  // 인쇄 다이얼로그용 — 선택 거래처의 출고일(byDate) 분포.
  //   그리드는 출고상세 대표일자 1개로 합산돼 보이지만(분할품목 전량이 한 날짜로),
  //   실제 인쇄는 ShipmentDate 기준 출고일별로 쪼개진다. 다이얼로그에서 이 분포를
  //   요일별 실제 품목수/수량으로 보여줘, 요일 선택이 인쇄에 정확히 반영됨을 확인시킨다.
  const [printDayInfo, setPrintDayInfo] = useState({ loading: false, days: [] });
  const [printDialogItems, setPrintDialogItems] = useState([]);

  // 담당자별 출력 — 담당자 칩으로 업체를 묶어 고르고, 기존 일괄 인쇄(selectedGroups)로 넘긴다.
  const [showManagerPrintDialog, setShowManagerPrintDialog] = useState(false);
  const [managerPrintFormat, setManagerPrintFormat] = useState(ESTIMATE_PRINT_FORMAT.ESTIMATE);
  const [managerPrintSel, setManagerPrintSel] = useState(() => new Set());
  const [managerPrintQuery, setManagerPrintQuery] = useState('');

  // 불량/검역 폼
  const [defectForm, setDefectForm] = useState({
    entryMode: 'defect',
    estimateType: '',
    estimateDate: new Date().toISOString().slice(0,10),
    prodKey: '',
    unit: '단',
    negative: true,
    quantity: '',
    cost: '',
    descr: '',
  });

  // 공급가액/부가세 자동계산
  const amountSign = defectForm.negative ? -1 : 1;
  const { amount: supply, vat } = amountVatFromCostEst(
    parseFloat(defectForm.cost) || 0,
    amountSign * (parseFloat(defectForm.quantity) || 0),
  );

  // ── 외부 클릭 시 업체 드롭다운 닫기
  useEffect(() => {
    const handler = e => { if (custDropRef.current && !custDropRef.current.contains(e.target)) setShowCustDrop(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── 업체 검색 디바운스
  useEffect(() => {
    if (!shouldRunCustomerSearch(custSearch, custPickedName.current)) {
      if (custSearch.length < 1) setCustList([]);
      return;
    }
    const seq = ++custReqSeq.current;
    const t = setTimeout(() => {
      apiGet('/api/customers/search', { q: custSearch })
        .then(d => {
          // 선택 이후이거나 더 새로운 검색이 시작됐으면 이 응답은 버린다.
          if (seq !== custReqSeq.current) return;
          setCustList(d.customers || []);
          setShowCustDrop(true);
        })
        .catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [custSearch]);

  // ── 품목 목록 로드 (모달 드롭다운용)
  useEffect(() => {
    apiGet('/api/products/search', { q: '' })
      .then(d => setProducts(d.products || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    apiGet('/api/estimate', { view: 'types' })
      .then(d => setEstimateTypes(d.types || []))
      .catch(() => setEstimateTypes([]));
  }, []);

  const requestShipmentItems = useCallback(async (ship, scope, { throwOnError = false } = {}) => {
    const token = beginCurrentSelectionRequest('detail', scope);
    if (!token) return [];
    const canApply = () => estimateSelectionStateRef.current.shouldApply(token, renderedSelectionScopeRef.current);
    setItemLoading(true);
    const detailParams = {
      week: scope.week,
      year: scope.year,
      custKey: ship.CustKey,
      byDate: 1,
      itemsOnly: 1,
    };
    try {
      const data = await apiGet('/api/estimate', detailParams);
      if (canApply()) setItems(data.items || []);
      return data.items || [];
    } catch (primaryError) {
      // A newer list/selection may already own the detail channel. Do not let
      // this obsolete failure start another fallback request for the old row.
      if (!canApply()) return [];
      try {
        const keys = (ship.ShipmentKeys || '').split(',').map(Number).filter(Boolean);
        if (keys.length === 0) throw primaryError;
        const results = await Promise.all(keys.map((shipmentKey) => apiGet('/api/estimate', {
          shipmentKey,
          week: scope.week,
          year: scope.year,
          custKey: ship.CustKey,
          byDate: 1,
          itemsOnly: 1,
        }).then((result) => result.items || [])));
        const nextItems = results.flat();
        if (canApply()) setItems(nextItems);
        return nextItems;
      } catch (fallbackError) {
        if (!canApply()) return [];
        setErr(fallbackError.message || '견적서 상세 조회에 실패했습니다.');
        if (throwOnError) throw fallbackError;
        return [];
      }
    } finally {
      if (canApply()) setItemLoading(false);
    }
  }, [beginCurrentSelectionRequest]);

  const requestMismatch = useCallback((custKey, scope) => {
    if (!custKey || !scope.week) return;
    const token = beginCurrentSelectionRequest('mismatch', scope);
    if (!token) return;
    const canApply = () => estimateSelectionStateRef.current.shouldApply(token, renderedSelectionScopeRef.current);
    apiGet('/api/estimate', { view: 'mismatch', week: scope.week, year: scope.year, custKey })
      .then((data) => { if (canApply()) setMismatch(data.success ? data : null); })
      .catch(() => { if (canApply()) setMismatch(null); });
  }, [beginCurrentSelectionRequest]);

  // ── 조회 (차수 + 업체 기준) — 차수 단위 그룹핑 (14 → 14-01, 14-02 … 모두 포함)
  // silent=true: 자동조회 시 에러 무시 (입력 부족 케이스)
  const load = (silent = false, opts = {}) => {
    if (!weekNum && !selectedCust) {
      if (!silent) setErr('차수 또는 업체를 입력하세요.');
      return Promise.resolve();
    }
    const hasOption = (key) => Object.prototype.hasOwnProperty.call(opts, key);
    const includeUnfixedForLoad = hasOption('includeUnfixedOverride')
      ? Boolean(opts.includeUnfixedOverride)
      : queryIncludeUnfixedRef.current || includeUnfixed;
    const preserved = hasOption('preserveSelection')
      ? opts.preserveSelection
      : resolveEstimateReloadSelection({ selectedCust, selectedId, selectedCustKey });
    const scope = buildSelectionScope({
      selectedId: preserved?.groupId ?? null,
      selectedCustKey: preserved?.custKey ?? null,
      includeUnfixed: includeUnfixedForLoad,
    });
    const renderedScope = renderedSelectionScopeRef.current;
    const sameScopeExcept = (ignoredFields) => Object.keys(scope)
      .filter((key) => !ignoredFields.includes(key))
      .every((key) => Array.isArray(scope[key])
        ? Array.isArray(renderedScope[key]) && scope[key].join('|') === renderedScope[key].join('|')
        : scope[key] === renderedScope[key]);
    // setState has not rendered yet for these explicit user actions. Allow only
    // the declared override to advance scope; a stale saved callback still
    // differs in customer/year/week/filter and is rejected below.
    const canActivateExplicitOverride = (
      hasOption('includeUnfixedOverride')
      && sameScopeExcept(['includeUnfixed'])
    ) || (
      hasOption('preserveSelection')
      && opts.preserveSelection === null
      && sameScopeExcept(['selectedId', 'selectedCustKey'])
    );
    if (canActivateExplicitOverride) activateSelectionScope(scope);
    const token = beginCurrentSelectionRequest('load', scope, true);
    if (!token) return Promise.resolve({ skipped: true });
    const shouldApply = () => estimateSelectionStateRef.current.shouldApply(token, renderedSelectionScopeRef.current)
      && (typeof opts.shouldApply !== 'function' || opts.shouldApply());
    setLoading(true); setItemLoading(false); setErr('');
    return apiGet('/api/estimate', {
      week: scope.week,        // "14" 전달 → API에서 14-01, 14-02 등 자동 매칭
      year: scope.year,
      custKey: scope.filterCustKey || '',
      includeUnfixed: includeUnfixedForLoad ? '1' : '',
      ...(scope.weekDays.length < 7 ? { weekDays: scope.weekDays.join(',') } : {}),
      })
      .then((data) => {
        // 서버 목록 응답의 items는 첫 거래처의 것일 수 있다. 선택 거래처의
        // detail 요청이 성공한 경우에만 우측 목록을 갱신한다.
        if (!shouldApply()) return data;
        const nextShipments = data.shipments || [];
        const nextShip = preserved
          ? nextShipments.find((ship) => estimateShipmentGroupId(ship) === preserved.groupId
              && Number(ship.CustKey) === Number(preserved.custKey))
            || nextShipments.find((ship) => Number(ship.CustKey) === Number(preserved.custKey))
          : nextShipments[0];
        setShipments(nextShipments);
        setSelectedGroups(new Set()); // 새 조회 시 다중선택 초기화
        setSelectedDeductionKeys(resetEstimateDeductionSelection());
        setItems([]);
        setMismatch(null);
        setLoading(false);
        if (!nextShip) {
          if (preserved) setErr('선택한 업체의 조회 결과가 없습니다. 다른 업체로 자동 전환하지 않았습니다.');
          return data;
        }
        const nextScope = buildSelectionScope({
          selectedId: estimateShipmentGroupId(nextShip),
          selectedCustKey: nextShip.CustKey,
          includeUnfixed: includeUnfixedForLoad,
        });
        setSelectedId(estimateShipmentGroupId(nextShip));
        setSelectedCustKey(nextShip.CustKey);
        activateSelectionScope(nextScope);
        requestMismatch(nextShip.CustKey, nextScope);
        return requestShipmentItems(nextShip, nextScope, { throwOnError: true })
          .then(() => data);
      })
      .catch((error) => {
        // The initiating render is no longer visible: stale failures must not
        // become a save error for the newly selected scope.
        if (!sameEstimateSelectionScope(scope, renderedSelectionScopeRef.current)
          || (typeof opts.shouldApply === 'function' && !opts.shouldApply())
          || !shouldApply()) return { skipped: true };
        setErr(error.message || '견적서 조회에 실패했습니다.');
        // A current captured refresh needs to report its genuine detail/list
        // failure to the save flow; normal loads have already shown setErr.
        if (typeof opts.shouldApply === 'function') throw error;
        return undefined;
      })
      .finally(() => {
        if (shouldApply()) setLoading(false);
      });
  };

  // 자동조회: 차수/거래처 변경 시 자동 로드 (autoLoad=true 일 때만)
  useEffect(() => {
    if (!autoLoad) return;
    if (!weekNum && !selectedCust) return;
    const t = setTimeout(() => load(true), 200); // 입력 디바운스
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekNum, yearStr, selectedCust?.CustKey, autoLoad, includeUnfixed, activeWD]);

  // exe: GetDetail=전체 로드 → grdViewEstimate ActiveFilterString(WeekDay 코드)
  const filterItemsByWeekday = useCallback(
    (sourceItems) => {
      const rows = sourceItems || [];
      if (rows.length && rows.every((r) => r._exeParity && r.WeekDay != null)) {
        return filterItemsByExeWeekDay(rows, activeWD);
      }
      return filterEstimateItemsByWeekday(rows, activeWD);
    },
    [activeWD],
  );

  // ── 출고 목록 행 클릭 → exe GetDetail 1회 조회 (FormEstimateView parity)
  const selectShipment = (groupId, custKey, shipmentKeys) => {
    if (deductionDeleteInFlightRef.current) return;
    const ship = shipments.find((row) => estimateShipmentGroupId(row) === groupId
      && Number(row.CustKey) === Number(custKey)) || { CustKey: custKey, ShipmentKeys: shipmentKeys };
    const scope = buildSelectionScope({ selectedId: groupId, selectedCustKey: custKey });
    activateSelectionScope(scope);
    setSelectedId(groupId);
    setSelectedCustKey(custKey);
    setSelectedDeductionKeys(resetEstimateDeductionSelection());
    setLoading(false); setItems([]); setMismatch(null);
    requestShipmentItems(ship, scope).catch(() => {});
    requestMismatch(custKey, scope);
  };

  const reloadSelectedShipmentItems = useCallback(async () => {
    const ship = shipments.find(s => estimateShipmentGroupId(s) === selectedId);
    if (!ship) return [];
    const scope = buildSelectionScope({ selectedId, selectedCustKey: ship.CustKey });
    if (!sameEstimateSelectionScope(scope, renderedSelectionScopeRef.current)) return [];
    setSelectedDeductionKeys(resetEstimateDeductionSelection());
    return requestShipmentItems(ship, scope, { throwOnError: true });
  }, [buildSelectionScope, requestShipmentItems, selectedId, shipments]);

  const selectedShip = shipments.find(s => estimateShipmentGroupId(s) === selectedId);
  const captureEstimateRefresh = () => {
    if (!selectedShip) return null;
    const ship = {
      groupId: selectedId,
      custKey: selectedShip.CustKey,
      shipmentKeys: selectedShip.ShipmentKeys,
      shipmentKey: selectedShip.firstShipmentKey
        || Number((selectedShip.ShipmentKeys || '').split(',').find(Boolean)),
      custName: selectedShip.CustName || '선택 업체',
    };
    return {
      ship,
      orderYear: String(yearStr),
      parentWeek: String(weekNum).padStart(2, '0'),
      scope: buildSelectionScope({ selectedId: ship.groupId, selectedCustKey: ship.custKey }),
    };
  };
  const isCapturedEstimateScopeCurrent = (captured) => Boolean(captured)
    && shouldReloadCapturedEstimateSelection(captured.scope, renderedSelectionScopeRef.current);
  const refreshCapturedEstimate = async (captured) => {
    if (!isCapturedEstimateScopeCurrent(captured)) {
      return { skipped: true };
    }
    const refreshed = await load(true, {
      preserveSelection: { groupId: captured.ship.groupId, custKey: captured.ship.custKey },
      shouldApply: () => shouldReloadCapturedEstimateSelection(captured.scope, renderedSelectionScopeRef.current),
    });
    return isCapturedEstimateScopeCurrent(captured) ? refreshed : { skipped: true };
  };
  const deductionDeleteScope = `${yearStr}|${String(weekNum || '')}|${selectedShip?.CustKey || ''}|${selectedId || ''}|${selectedCust?.CustKey || ''}|${[...activeWD].sort().join(',')}`;
  // 연도·차수·업체·상세 필터가 바뀌면 다른 범위의 숨은 선택을 절대 유지하지 않는다.
  useEffect(() => {
    deductionDeleteScopeRef.current = deductionDeleteScope;
    setSelectedDeductionKeys(resetEstimateDeductionSelection());
  }, [deductionDeleteScope, activeWD]);
  // 견적 편집은 모든 세부차수를 묶는 대차수 단위다. STRING_AGG 조회 순서가
  // 34-01/34-02 사이에서 바뀌어도 같은 작업권을 해제·재취득하지 않는다.
  const selectedEditWeek = weekNum ? String(weekNum).padStart(2, '0') : '';
  const estimateEditPresence = useErpEditPresence({
    year: yearStr,
    week: selectedEditWeek,
    custKey: selectedShip?.CustKey,
    pageCode: 'estimate',
    enabled: Boolean(selectedShip?.CustKey && selectedEditWeek),
  });
  const ensureEstimateEditAllowed = () => {
    if (!estimateEditPresence.blocked) return true;
    setErr(estimateEditPresence.stale
      ? 'nenova.exe 또는 다른 화면에서 값이 변경되었습니다. 새로고침 후 다시 확인하세요.'
      : estimateEditPresence.locked
        ? `${estimateEditPresence.ownerName || '다른 사용자'}님이 이 업체를 작업 중입니다.`
        : '이 업체의 작업 상태를 확인한 뒤 다시 시도하세요.');
    return false;
  };
  const estimateEditGuard = () => ({ ...estimateEditPresence.editGuard, custKey: selectedShip?.CustKey || '' });

  // 확정현황 버튼은 사용자가 EXE/다른 화면 변경을 직접 확인하고 현재
  // 원장을 다시 읽겠다는 명시적 동작이다. 자동 polling은 계속 감지만 하고,
  // 이 흐름에서만 현재 탭이 소유한 업체의 기준 지문을 갱신한다.
  const refreshFixStatusAndEstimate = async () => {
    if (fixStatusLoading || fixStatusSyncing || !weekNum) return null;
    const captured = captureEstimateRefresh();
    setFixStatusSyncing(true);
    try {
      const status = await checkFixStatus();
      if (!status) return null;

      if (captured
        && estimateEditPresence.validScope
        && estimateEditPresence.ownedByMe
        && estimateEditPresence.token) {
        await estimateEditPresence.refresh({ force: true });
      }

      if (captured) {
        await refreshCapturedEstimate(captured);
      } else {
        await load(true);
      }

      if (captured
        && estimateEditPresence.validScope
        && estimateEditPresence.ownedByMe
        && estimateEditPresence.token) {
        await estimateEditPresence.refresh();
      }
      setErr('');
      setSuccessMsg('nenova.exe의 최신 확정 현황과 견적서 내용을 다시 불러왔습니다.');
      return status;
    } catch (error) {
      setErr(`최신 확정 현황을 다시 불러오지 못했습니다. ${error.message || '잠시 후 다시 시도하세요.'}`);
      return null;
    } finally {
      setFixStatusSyncing(false);
    }
  };

  // EXE에서 확정/확정취소만 바뀐 경우에는 실제 견적 내용 충돌이 아니다.
  // 상태 전용 지문 변화를 감지해 목록과 현재 업체를 자동으로 다시 읽는다.
  useEffect(() => {
    const nextDigest = String(estimateEditPresence.fixStatusDigest || '');
    const previousDigest = fixStatusDigestRef.current;
    fixStatusDigestRef.current = nextDigest;
    if (!previousDigest || !nextDigest || previousDigest === nextDigest) return;
    if (estimateEditPresence.stale || estimateEditPresence.locked || fixStatusSyncing || fixStatusLoading) return;

    const captured = captureEstimateRefresh();
    const refreshPromise = captured ? refreshCapturedEstimate(captured) : load(true);
    Promise.resolve(refreshPromise)
      .then(() => {
        setErr('');
        setSuccessMsg('nenova.exe의 확정상태 변경을 자동으로 반영했습니다.');
      })
      .catch((error) => setErr(`확정상태 자동 갱신에 실패했습니다. ${error.message || '확정 현황 확인을 눌러 다시 불러오세요.'}`));
    // 이 effect는 서버가 계산한 상태 전용 지문이 바뀔 때만 실행한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimateEditPresence.fixStatusDigest]);

  const editDraftScope = useMemo(() => ({
    orderYear: yearStr,
    parentWeek: selectedEditWeek,
    custKey: selectedShip?.CustKey,
  }), [selectedEditWeek, selectedShip?.CustKey, yearStr]);
  const editDraftScopeKey = estimateEditDraftKey(editDraftScope);

  // 배포·서버 재시작 중 새로고침되어도 현재 업체의 입력값은 브라우저에 남긴다.
  // 업체/연도/차수별 키를 분리하므로 다른 업체 입력과 섞이지 않는다.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!editDraftScopeKey) {
      setCostEdits({});
      setQtyEdits({});
      setEditDraftHydratedScope('');
      return;
    }
    const draft = readEstimateEditDraft(window.sessionStorage, editDraftScope);
    setCostEdits(draft?.costEdits || {});
    setQtyEdits(draft?.qtyEdits || {});
    if (draft?.costMode) setCostMode(draft.costMode);
    setEditDraftHydratedScope(editDraftScopeKey);
  }, [editDraftScopeKey]);

  useEffect(() => {
    if (typeof window === 'undefined' || !editDraftScopeKey || editDraftHydratedScope !== editDraftScopeKey) return;
    writeEstimateEditDraft(window.sessionStorage, editDraftScope, { costEdits, qtyEdits, costMode });
  }, [costEdits, costMode, editDraftHydratedScope, editDraftScope, editDraftScopeKey, qtyEdits]);

  const fetchEstimateRecoveryRows = async (captured) => {
    if (!captured?.ship?.custKey || !captured?.orderYear || !captured?.parentWeek) {
      throw new Error('저장 결과를 확인할 연도·차수·업체 정보가 없습니다.');
    }
    const query = new URLSearchParams({
      year: captured.orderYear,
      week: captured.parentWeek,
      custKey: String(captured.ship.custKey),
      byDate: '1',
      itemsOnly: '1',
      _estimateRecovery: String(Date.now()),
    });
    const response = await fetch(`/api/estimate?${query}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    let data;
    try {
      data = await parseJsonResponse(response);
    } catch (error) {
      error.status = response.status;
      throw error;
    }
    if (!response.ok || !data?.success) {
      const error = new Error(data?.error || `저장 결과 확인 실패 (${response.status})`);
      error.status = response.status;
      error.code = data?.code;
      throw error;
    }
    return data.items || [];
  };

  const appendEstimateRecoveryState = (state, onProgress) => {
    let label = '';
    if (state.phase === 'server-updating') {
      label = '서버 업데이트 중 — 입력값을 보존했습니다. 연결 복구 후 자동으로 다시 처리합니다.';
    } else if (state.phase === 'waiting') {
      label = `서버 연결 확인 중 — ${state.attempt}번째 확인`;
    } else if (state.phase === 'retrying') {
      label = '서버 복구 확인 — 아직 저장 전 상태여서 한 번 자동 재처리합니다.';
    } else if (state.phase === 'already-applied') {
      label = '서버 복구 확인 — 응답만 늦었고 입력값은 이미 정상 반영됐습니다.';
    }
    if (!label) return;
    setCostApplyLog(prev => [...prev, { step: 'save', label }]);
    onProgress?.({ kind: 'server', status: state.phase === 'already-applied' ? 'done' : undefined, label });
  };

  const runEstimateWriteWithRecovery = async ({ url, body, intents, captured, onProgress, recoveredData }) => {
    const result = await runRecoverableEstimateSave({
      request: () => postEstimateWriteJson(url, body),
      probe: probeEstimateServer,
      reconcile: async () => {
        const rows = await fetchEstimateRecoveryRows(captured);
        const snapshot = classifyEstimateSaveSnapshot({ intents, rows });
        if (snapshot.status === 'applied') snapshot.data = recoveredData(snapshot, rows);
        return snapshot;
      },
      onState: state => appendEstimateRecoveryState(state, onProgress),
    });
    return {
      ...result.data,
      recoveredAfterServerUpdate: result.recovered,
      responseRecovered: result.alreadyApplied,
    };
  };

  const handleEstimateEditCellKeyDown = useCallback((event) => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const table = event.currentTarget.closest('table');
    if (!table) return;
    const elements = [...table.querySelectorAll('[data-estimate-edit-cell="1"]')];
    const cells = elements.map(element => ({
      element,
      row: Number(element.dataset.estimateEditRow),
      column: element.dataset.estimateEditColumn,
      disabled: element.disabled,
    }));
    const target = getEstimateGridNavigationTarget(cells, {
      row: Number(event.currentTarget.dataset.estimateEditRow),
      column: event.currentTarget.dataset.estimateEditColumn,
    }, event.key);
    if (!target?.element) return;
    event.preventDefault();
    target.element.focus();
    target.element.select?.();
  }, []);

  // ── 단가 수정 관련 함수 (P3) ─────────────────────────
  // 현재 선택된 그룹의 ShipmentKey 목록
  const selectedShipmentKeys = selectedShip
    ? (selectedShip.ShipmentKeys || '').split(',').map(Number).filter(Boolean)
    : [];

  const sortWeeksAsc = (weeks) => [...new Set((weeks || []).filter(Boolean))]
    .sort((a, b) => String(a).localeCompare(String(b)));
  const sortWeeksDesc = (weeks) => sortWeeksAsc(weeks).reverse();

  const getFixedWeeksFromShip = (ship) => {
    if (!ship) return [];
    const entries = String(ship.SubWeeksFix || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    if (entries.length > 0) {
      return entries
        .map(entry => {
          const [week, fix] = entry.split(':');
          return Number(fix || 0) === 1 ? week : '';
        })
        .filter(Boolean);
    }
    return String(ship.SubWeeks || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  };

  const getFixCycleWeeksForEditedItems = (editedItems, ship) => buildFixCycleWeeks(editedItems, ship);

  const getCountryFlowersForEditedItems = (editedItems) => [...new Set((editedItems || [])
    .map(it => String(it.CountryFlower || '').trim())
    .filter(Boolean))];

  const getItemEditKey = (item) => {
    if (item?.SdetailKey != null) {
      return item.outDate ? `sd:${item.SdetailKey}@${item.outDate}` : `sd:${item.SdetailKey}`;
    }
    if (item?.EstimateKey != null) return `est:${item.EstimateKey}`;
    return '';
  };
  // nenova.exe FormEstimateView의 정상출고 수량 키는 ShipmentDate.SdateKey다.
  // SdetailKey는 단가 수정용/물리 출고 상세용이므로 견적 날짜수량 저장에 재사용하지 않는다.
  const getQtyEditKey = (item) => {
    if (item?.EstimateKey != null && item?.SdetailKey == null) return `est:${item.EstimateKey}`;
    if (item?.SdateKey != null) return `sdate:${item.SdateKey}`;
    return '';
  };
  const isEstimateEditKey = (key) => String(key || '').startsWith('est:');
  const isDateQuantityEditKey = (key) => String(key || '').startsWith('sdate:');
  const parseEditKeyNumber = (key) => parseInt(String(key || '').split('@')[0].split(':')[1] || key, 10);

  const runLimited = async (items, limit, worker) => {
    const results = new Array(items.length);
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await worker(items[currentIndex], currentIndex);
      }
    });
    await Promise.all(workers);
    return results;
  };

  // nenova.exe FormEstimateView는 정상출고의 견적 수량을 ShipmentDate.EstQuantity에
  // 저장한다. 여러 출고일을 한 번에 저장하여 품목별 총량 검증도 EXE와 동일한 시점에 수행한다.
  const saveDateQuantityBatch = async (rows, { onProgress, captured = captureEstimateRefresh() } = {}) => {
    if (!rows.length) return [];
    const startLabel = `EXE 출고일별 분배 ${rows.length}건 저장 시도 — ShipmentDetail + ShipmentDate`;
    setCostApplyLog(prev => [...prev, {
      step: 'save',
      label: startLabel,
    }]);
    onProgress?.({ kind: 'save', label: `수량 저장 요청 — ${rows.length}건 (확정 상태 유지)` });
    const body = {
      orderYear: yearStr,
      custKey: selectedShip?.CustKey || rows[0]?.item?.CustKey,
      editGuard: estimateEditGuard(),
      items: rows.map(p => ({
        sdateKey: p.keyNumber,
        quantity: p.newQty,
        unit: p.item.Unit,
        expectedOldQuantity: p.oldQty,
        ...(costEdits[getItemEditKey(p.item)] != null && costEdits[getItemEditKey(p.item)] !== ''
          ? { expectedOldCost: requireCostSnapshot(p.item).expectedOldCost } : {}),
      })),
    };
    const intents = rows.map(p => ({
      kind: 'date',
      field: 'quantity',
      key: p.keyNumber,
      expected: p.oldQty,
      desired: p.newQty,
      sdetailKey: p.item.SdetailKey,
      shipmentKey: p.item.ShipmentKey,
    }));
    try {
      const data = await runEstimateWriteWithRecovery({
        url: '/api/estimate/update-date-quantity',
        body,
        intents,
        captured,
        onProgress,
        recoveredData: (snapshot, liveRows) => ({
          success: true,
          changedCount: snapshot.matches.length,
          direction: 'recovered',
          stockMode: 'reconciled',
          items: snapshot.matches.map(({ intent, row }) => {
            if (row) {
              return {
                sdateKey: Number(row.SdateKey),
                sdetailKey: Number(row.SdetailKey),
                shipmentKey: Number(row.ShipmentKey),
                dateDeleted: false,
                dateCostAfter: Number(row.DateCost),
                detailCostAfter: Number(row.Cost),
              };
            }
            const remainingDetailRow = liveRows.find(candidate => Number(candidate.SdetailKey) === Number(intent.sdetailKey));
            return remainingDetailRow
              ? {
                sdateKey: Number(intent.key),
                sdetailKey: Number(intent.sdetailKey),
                shipmentKey: Number(intent.shipmentKey),
                dateDeleted: true,
                detailCostAfter: Number(remainingDetailRow.Cost),
              }
              : { sdetailKey: Number(intent.sdetailKey), purged: true };
          }),
        }),
      });
      if (data.recoveredAfterServerUpdate) {
        setCostApplyLog(prev => [...prev, { step: 'save', label: '서버 복구 후 실제 저장값까지 다시 확인했습니다.' }]);
      }
      if (!data.success) {
        const error = data.error || '출고일별 견적수량 저장 실패';
        const label = data.rolledBack === true ? `${error} — 저장되지 않았습니다.` : error;
        setCostApplyLog(prev => [...prev, {
          step: 'error',
          label,
        }]);
        onProgress?.({ kind: 'error', status: 'error', label });
        return rows.map(p => ({
          key: p.keyNumber,
          ok: false,
          code: data.code,
          oldQty: p.oldQty,
          newQty: p.newQty,
          orderWeek: p.item.OrderWeek,
          error,
          fixedWeeks: data.fixedWeeks || [],
          fixedCategories: data.fixedCategories || [],
          pendingRef: p,
        }));
      }
      const stockResponse = data.recoveredAfterServerUpdate
        ? ['서버 복구 후 수량 반영 확인']
        : describeDateQuantitySaveResult(data);
      const label = `저장 결과 — ${stockResponse.join(' / ')}`;
      setCostApplyLog(prev => [...prev, { step: 'save', label }]);
      onProgress?.({ kind: 'server', label });
      const savedByKey = new Map((data.items || []).map(item => [Number(item.sdateKey), item]));
      onProgress?.({ kind: 'server', status: 'done', label: `수량 저장 완료 — ${rows.length}건` });
      return rows.map(p => ({
        key: p.keyNumber,
        ok: true,
        oldQty: p.oldQty,
        newQty: p.newQty,
        orderWeek: p.item.OrderWeek,
        saved: savedByKey.get(p.keyNumber),
        pendingRef: p,
      }));
    } catch (error) {
      const label = error?.message || '수량 저장을 완료하지 못했습니다. 입력값은 그대로 보관했습니다.';
      setCostApplyLog(prev => [...prev, { step: 'error', label }]);
      onProgress?.({ kind: 'error', status: 'error', label });
      return rows.map(p => ({
        key: p.keyNumber,
        ok: false,
        code: error?.code || error?.data?.code,
        oldQty: p.oldQty,
        newQty: p.newQty,
        orderWeek: p.item.OrderWeek,
        error: error.message,
        fixedWeeks: error?.data?.fixedWeeks || [],
        fixedCategories: error?.data?.fixedCategories || [],
        pendingRef: p,
      }));
    }
  };

  const saveDeductionQuantity = async (p, { captured = captureEstimateRefresh() } = {}) => {
    const body = {
      sdetailKey: p.isEstimate ? undefined : p.keyNumber,
      estimateKey: p.isEstimate ? p.keyNumber : undefined,
      shipmentKey: p.item.ShipmentKey,
      orderYear: yearStr,
      custKey: selectedShip?.CustKey || p.item.CustKey,
      quantity: p.newQty,
      unit: p.item.Unit,
      expectedOldQuantity: p.oldQty,
      editGuard: estimateEditGuard(),
    };
    const intent = {
      kind: p.isEstimate ? 'estimate' : 'detail',
      field: 'quantity',
      key: p.keyNumber,
      expected: p.oldQty,
      desired: p.isEstimate && p.oldQty < 0 ? -Math.abs(p.newQty) : p.newQty,
    };
    try {
      const data = await runEstimateWriteWithRecovery({
        url: '/api/estimate/update-quantity',
        body,
        intents: [intent],
        captured,
        recoveredData: () => ({ success: true, recoveredAfterServerUpdate: true }),
      });
      return {
        key: p.keyNumber, ok: true, code: data.code,
        oldQty: p.oldQty, newQty: p.newQty, orderWeek: p.item.OrderWeek,
        fixedWeeks: data.fixedWeeks || [], fixedCategories: data.fixedCategories || [],
        pendingRef: p,
      };
    } catch (error) {
      return {
        key: p.keyNumber, ok: false, code: error?.code || error?.data?.code,
        oldQty: p.oldQty, newQty: p.newQty, orderWeek: p.item.OrderWeek,
        error: error?.message || '차감 수량 저장 실패',
        fixedWeeks: error?.data?.fixedWeeks || [], fixedCategories: error?.data?.fixedCategories || [],
        pendingRef: p,
      };
    }
  };

  const saveEstimateCostBatch = async ({ allItems, body, captured = captureEstimateRefresh() }) => {
    const intents = allItems.map((item) => {
      if (item.estimateKey != null) {
        return { kind: 'estimate', field: 'cost', key: item.estimateKey, expected: item.expectedOldCost, desired: item.cost };
      }
      if (item.sdateKey != null) {
        return { kind: 'date', field: 'cost', key: item.sdateKey, expected: item.expectedOldCost, desired: item.cost };
      }
      return { kind: 'detail', field: 'cost', key: item.sdetailKey, expected: item.expectedOldCost, desired: item.cost };
    });
    try {
      return await runEstimateWriteWithRecovery({
        url: '/api/estimate/update-cost',
        body,
        intents,
        captured,
        recoveredData: snapshot => ({
          success: true,
          changedCount: snapshot.matches.length,
          diffAmount: 0,
          changes: [],
          recoveredAfterServerUpdate: true,
        }),
      });
    } catch (error) {
      if (error?.code === 'STALE_DATA') error.isStaleData = true;
      throw error;
    }
  };

  const getProdKeysForEditedItems = (editedItems) => [...new Set((editedItems || [])
    .map(it => Number(it.ProdKey))
    .filter(Number.isFinite))];

  const runShipmentFixAction = async (orderYear, week, action, countryFlowers = [], stockProdKeys = [], extraBody = {}) => {
    const selectedYear = resolveFixStatusOrderYear(orderYear, week);
    const { data: d } = await postShipmentFix({
      week,
      orderYear: selectedYear,
      action,
      ...extraBody,
      custKey: selectedShip?.CustKey,
      editGuard: estimateEditGuard(),
      // 자동 편집은 뒤 차수 확정 경고를 강제로 우회하지 않는다.
      force: false,
      countryFlowers,
      stockProdKeys,
    });
    if (!d.success) {
      const error = new Error(d.error || d.message || `${week} ${action === 'unfix' ? '확정취소' : '재확정'} 실패`);
      error.code = d.code;
      error.data = d;
      if (d.code === 'ERP_EDIT_STALE') estimateEditPresence.markStale();
      throw error;
    }
    return d;
  };

  // 확정차수 편집은 EXE처럼 usp_ShipmentFix/Cancel 을 그대로 탄다.
  // 품목별 usp_StockCalculation 합산만 줄인다. lightStock=중간 생략,
  // skipFinalStockCalc=출고수량 불변일 때만 최종 재계산도 생략.
  const runEditWithFixCycle = async ({ weeks, orderYear, countryFlowers = [], stockProdKeys = [], progress, apply, lightStock = false, skipFinalStockCalc = false }) => {
    const targetWeeks = sortWeeksAsc(weeks);
    const selectedYear = resolveFixStatusOrderYear(orderYear, ...targetWeeks);
    return runScopedEstimateFixCycle({
      weeks: targetWeeks, orderYear: selectedYear, prodKeys: stockProdKeys,
      progress, apply, lightStock, skipFinalStockCalc,
      resolveScope: async (keys) => {
        const data = await apiGet('/api/shipment/fix', {
          week: targetWeeks[0], orderYear: selectedYear, editScope: '1', editProdKeys: keys.join(','),
        });
        if (!data.success || data.orderYear !== selectedYear || data.orderWeek !== targetWeeks[0]) {
          throw new Error(data.error || '수정 품목의 연도·차수·품종을 확인하지 못했습니다.');
        }
        return data.groups;
      },
      runAction: (body) => runShipmentFixAction(body.orderYear, body.week, body.action,
        body.countryFlowers, body.stockProdKeys, { editProdKeys: body.editProdKeys, skipStockCalc: body.skipStockCalc === true }),
    });
  };

  // 수정된 단가 개수
  const editedCount = Object.keys(costEdits).filter(k => {
    const v = costEdits[k];
    return v !== '' && v !== undefined && v !== null;
  }).length;
  // 수정된 수량 개수
  const editedQtyCount = Object.keys(qtyEdits).filter(k => {
    const v = qtyEdits[k];
    return v !== '' && v !== undefined && v !== null;
  }).length;

  // ── 차수 확정 — 사전검증 + 실행 + 오류상세 표시
  const fixWeekAllSubs = async () => {
    if (!weekNum) { alert('차수를 입력하세요'); return; }
    setFixWorking(true);
    setFixServerLogs([]);
    setFixLogWeeks([]);
    setFixLogSince(Date.now() - 3000);
    setFixProgress({
      phase: 'validating',
      title: `${weekNum}차 확정 준비 중`,
      currentWeek: '',
      total: 0,
      done: 0,
      success: 0,
      failed: 0,
      message: '확정 대상 차수를 확인하고 있습니다.',
      results: [],
    });
    try {
      const range = getSelectedFixRange();
      if (!range) throw new Error('확정 대상 차수 범위를 확인할 수 없습니다.');
      const statusRes = await fetch(`/api/shipment/fix-status?${buildFixStatusQuery({ orderYear: yearStr, fromWeek: range.fromWeek, toWeek: range.toWeek })}`, {
        credentials: 'same-origin',
      });
      const statusData = await statusRes.json();
      if (!statusData.success) throw new Error(statusData.error || '확정현황 조회 실패');

      const weekList = (statusData.weeks || [])
        .filter(w => Number(w.detailCount || 0) > 0)
        .filter(w => w.status === 'UNFIXED' || w.status === 'PARTIAL')
        .map(w => w.OrderWeek)
        .filter(Boolean)
        .sort();

      if (weekList.length === 0) {
        alert(`${weekNum}차에서 확정할 미확정 출고가 없습니다. 이미 확정되었거나 출고분배 데이터가 없습니다.`);
        setFixWorking(false);
        setFixProgress(null);
        return;
      }
      setFixLogWeeks(weekList);

      setFixProgress(prev => ({
        ...(prev || {}),
        phase: 'validating',
        title: `${weekNum}차 및 하위차수 사전검증`,
        total: weekList.length,
        done: 0,
        message: `${weekList.join(', ')} 순서로 하위차수부터 확인합니다.`,
        results: [],
      }));

      // 1단계: 각 세부차수 사전검증 → 이슈 모음
      const allIssues = {};
      const preflightFailures = {};
      for (let i = 0; i < weekList.length; i += 1) {
        const wk = weekList[i];
        setFixProgress(prev => ({
          ...(prev || {}),
          currentWeek: wk,
          done: i,
          message: `${wk} 사전검증 중입니다.`,
        }));
        try {
          const r = await fetch(`/api/shipment/fix?week=${encodeURIComponent(wk)}&orderYear=${encodeURIComponent(yearStr)}`);
          const d = await r.json();
          if (!r.ok || !d.success) throw new Error(d.error || d.message || '사전검증 응답 실패');
          if (d.success && d.issueCount > 0) {
            allIssues[wk] = {
              ghost: d.ghost || [], noIncoming: d.noIncoming || [],
              duplicate: d.duplicate || [], negative: d.negative || [],
              count: d.issueCount,
            };
          }
        } catch (error) {
          preflightFailures[wk] = error.message || '사전검증 응답을 확인할 수 없습니다.';
        }
        setFixProgress(prev => ({
          ...(prev || {}),
          done: i + 1,
          message: preflightFailures[wk] ? `${wk} 사전검증 확인 실패` : `${wk} 사전검증 완료`,
        }));
      }

      const failedWeeks = Object.keys(preflightFailures);
      if (failedWeeks.length > 0) {
        throw new Error(`사전검증 확인 실패: ${failedWeeks.map((wk) => `${wk} (${preflightFailures[wk]})`).join(', ')}. 재조회 후 다시 시도하세요.`);
      }

      const totalIssues = Object.values(allIssues).reduce((a, x) => a + x.count, 0);
      if (totalIssues > 0) {
        // 이슈 있으면 모달 띄움 (사용자 강제진행 여부 결정)
        setFixModal({ stage: 'preview', week: weekNum, weekList, allIssues, totalIssues });
        setFixWorking(false);
        setFixProgress(null);
        return;
      }
      // 이슈 0건 → 바로 fix 진행
      await doFixAll(weekList);
    } catch (e) {
      setFixModal({ stage: 'error', error: e.message });
      setFixWorking(false);
      setFixProgress(null);
    }
  };

  const doFixAll = async (weekList, force = false, countryFlowers = [], opts = {}) => {
    const capturedRefresh = captureEstimateRefresh();
    const weeks = weekList || [];
    if (!opts.skipProgressInit) {
      setFixWorking(true);
      setFixServerLogs([]);
      setFixLogWeeks(weeks);
      setFixLogSince(Date.now() - 3000);
      setFixProgress({
        phase: 'fixing',
        title: opts.title || `${weekNum}차 및 하위차수 출고 확정 진행 중`,
        currentWeek: '',
        total: weeks.length,
        done: 0,
        success: 0,
        failed: 0,
        message: `${weeks.length}개 세부차수를 낮은 차수부터 순서대로 확정합니다.`,
        results: [],
      });
    }
    const results = [];
    for (let i = 0; i < weeks.length; i += 1) {
      const wk = weeks[i];
      setFixProgress(prev => ({
        ...(prev || {}),
        currentWeek: wk,
        done: i,
        message: `${wk} 확정 중입니다. 재고 계산까지 함께 처리합니다.`,
      }));
      try {
        let { data: d } = await postShipmentFix({
          week: wk,
          orderYear: yearStr,
          action: 'fix',
          force,
          ...(countryFlowers.length ? { countryFlowers } : {}),
          ...(opts.autoStockAdd ? { autoStockAdd: true } : {}),
          ...(opts.confirmAutoStockAdd ? { confirmAutoStockAdd: true } : {}),
        });
        d = await reconcileFixResultAfterAmbiguousResponse(wk, d, yearStr);
        const stockAdjustments = Array.isArray(d.stockAdjustments) ? d.stockAdjustments : [];
        const stockAdjustmentMessage = stockAdjustments.length > 0
          ? ` · 재고 부족분 보정 ${stockAdjustments.map(item => `${item.prodName || item.prodKey} +${item.added}`).join(', ')}`
          : '';
        if (!d.success) {
          results.push({
            week: wk,
            ok: false,
            error: formatFixApiErrorMessage(d, wk),
            message: d.message,
            negative: d.negative || [],
            stockAdjustments,
          });
        } else {
          results.push({
            week: wk,
            ok: true,
            message: `${d.message || ''}${stockAdjustmentMessage}`,
            count: d.updatedCount,
            stockErrors: (d.stockErrors?.length || 0) + (d.reconcile?.stockErrors?.length || 0),
            stockAdjustments,
          });
        }
      } catch (e) {
        const msg = e?.name === 'AbortError'
          ? `요청 시간 초과(${Math.round(FIX_UNFIX_FETCH_TIMEOUT_MS / 60000)}분) — 재고 재계산 진행 중일 수 있습니다`
          : e.message;
        const recovered = await reconcileFixResultAfterAmbiguousResponse(wk, { success: false, _ambiguousResponse: true, error: msg }, yearStr);
        if (recovered.success) {
          results.push({ week: wk, ok: true, message: recovered.message, count: recovered.updatedCount, stockErrors: 0 });
        } else {
          results.push({ week: wk, ok: false, error: msg });
        }
      }
      const success = results.filter(x => x.ok).length;
      const failed = results.length - success;
      setFixProgress(prev => ({
        ...(prev || {}),
        done: i + 1,
        success,
        failed,
        results: results.slice(-5),
        message: `${wk} 처리 완료. 남은 차수 ${Math.max(weeks.length - i - 1, 0)}개`,
      }));
    }
    setFixModal({
      stage: 'done', results, title: opts.resultTitle,
      weekList: weeks, countryFlowers, resultTitle: opts.resultTitle,
      autoStockAddUsed: results.some(result => (result.stockAdjustments || []).length > 0),
    });
    setFixWorking(false);
    setFixProgress(null);
    await refreshCapturedEstimate(capturedRefresh); // 목록 → 선택 업체 상세 1회 갱신
  };

  // 수량 수정 적용 — 정상출고는 ShipmentDate.EstQuantity, 차감은 Estimate.Quantity에 저장
  const applyQtyEdits = async () => {
    if (editedQtyCount === 0) return;
    if (!ensureEstimateEditAllowed()) return;
    const capturedRefresh = captureEstimateRefresh();
    estimateEditPresence.beginSaving();
    let saveSucceeded = false;
    let automaticProgressId = '';
    setQtyApplying(true);
    setQtyResult(null);
    setCostApplying(true);
    setEditApplyTitle('수량 수정 저장');
    setCostResult(null);
    setCostApplyLog([{ step: 'start', label: `${weekNum}차 견적서 수량 수정 시작` }]);
    try {
      const pending = [];
      for (const [editKey, newVal] of Object.entries(qtyEdits)) {
        if (newVal === '' || newVal == null) continue;
        const item = filteredItems.find(it => getQtyEditKey(it) === editKey);
        if (!item) continue;
        const isDateQuantity = isDateQuantityEditKey(editKey);
        const isEstimate = isEstimateEditKey(editKey);
        if (!isDateQuantity && !isEstimate) continue;
        const keyNumber = parseEditKeyNumber(editKey);
        const oldQty = parseFloat(item.Quantity) || 0;
        const newQty = parseFloat(newVal);
        if (Number.isNaN(newQty) || newQty < 0) continue;
        const effectiveNewQty = isEstimate && oldQty < 0 ? -Math.abs(newQty) : newQty;
        if (Math.abs(effectiveNewQty - oldQty) < 0.001) continue;
        pending.push({ keyNumber, isDateQuantity, isEstimate, item, oldQty, newQty });
      }

      if (pending.length === 0) throw new Error('수정 대상 수량이 없습니다.');

      const atomicDateItems = pending.filter(p => p.isDateQuantity).map(p => p.item);
      if (atomicDateItems.length > 0) {
        automaticProgressId = beginAutomaticEditProgress({
          weeks: getFixCycleWeeksForEditedItems(atomicDateItems, selectedShip),
          title: '확정 상태 유지 수량 저장 준비 중',
        });
      }

      // 차감 행은 EXE의 Estimate.Quantity 저장 경로를 그대로 사용한다.
      const postOneDeductionQty = async (p) => {
        setCostApplyLog(prev => [...prev, {
          step: 'save',
          label: `${p.item.OrderWeek} ${p.item.ProdName} 수량 저장 — ${p.oldQty}${p.item.Unit} → ${p.newQty}${p.item.Unit}`,
        }]);
        return saveDeductionQuantity(p, { captured: capturedRefresh });
      };

      const savePendingQuantities = async (rows) => {
        const dateResults = await saveDateQuantityBatch(rows.filter(p => p.isDateQuantity), {
          captured: capturedRefresh,
          onProgress: stage => {
            if (automaticProgressId) appendAutomaticEditStage(automaticProgressId, stage);
          },
        });
        const deductionResults = await runLimited(rows.filter(p => p.isEstimate), 4, postOneDeductionQty);
        return [...dateResults, ...deductionResults];
      };

      let results = await savePendingQuantities(pending);

      // 기존 출고일 수량은 서버의 원자 저장이 확정 상태를 보존한 채 처리한다.
      // 구 서버의 FIXED_WEEK 응답도 여기서 자동 확정해제로 우회하지 않는다.

      const okCount = results.filter(r => r.ok).length;
      const failCount = results.filter(r => !r.ok).length;
      saveSucceeded = failCount === 0;
      if (!isCapturedEstimateScopeCurrent(capturedRefresh)) return;
      if (results.some(r => r.code === 'ERP_EDIT_STALE')) estimateEditPresence.markStale();
      setQtyResult({ results, okCount, failCount });
      if (failCount === 0) setQtyEdits({});
      setCostApplyLog(prev => [...prev, {
        step: failCount ? 'error' : 'done',
        label: failCount
          ? `수량 저장 실패 ${failCount}건 — 성공으로 처리하지 않았습니다.`
          : '완료 — 수정 수량 반영 후 견적서 재조회 중',
      }]);
      setCostResult({ success: failCount === 0, type: 'quantity', changedCount: okCount, error: failCount ? (results.find(r => !r.ok)?.error || '일부 수량 저장 실패') : undefined });
      // 다시 조회하여 화면 갱신
      await refreshCapturedEstimate(capturedRefresh);
    } catch (e) {
      if (automaticProgressId) appendAutomaticEditStage(automaticProgressId, { kind: 'error', status: 'error', label: `자동 수량 저장 오류 — ${e.message || '알 수 없는 오류'}` });
      if (!isCapturedEstimateScopeCurrent(capturedRefresh)) return;
      if (saveSucceeded) {
        setCostApplyLog(prev => [...prev, { step: 'error', label: '수량 저장은 완료됐지만 재조회에 실패했습니다. 다시 조회해 결과를 확인하세요.' }]);
        setCostResult(prev => prev && ({ ...prev, success: true, refreshRequired: true }));
        setErr('수량 저장은 완료됐지만 재조회에 실패했습니다. 다시 조회해 결과를 확인하세요.');
        return;
      }
      if (e?.code === 'ERP_EDIT_STALE' || e?.data?.code === 'ERP_EDIT_STALE') estimateEditPresence.markStale();
      setQtyResult({ error: e.message });
      setCostApplyLog(prev => [...prev, { step: 'error', label: `오류 — ${e.message}` }]);
      setCostResult({ success: false, error: e.message });
    } finally {
      if (automaticProgressId) {
        finishAutomaticEditProgress(automaticProgressId, {
          ok: saveSucceeded,
          label: saveSucceeded ? '확정 상태 유지 수량 저장 완료' : '확정 상태 유지 수량 저장이 실패했거나 중단됨',
        });
      }
      setQtyApplying(false);
      setCostApplying(false);
      await estimateEditPresence.endSaving({ refreshBaseline: saveSucceeded && isCapturedEstimateScopeCurrent(capturedRefresh) });
    }
  };

  // "단가 적용하기" — 재고 재계산 없이, 확정 플래그(isFix)를 보존한 채 단가/금액만 저장한다.
  // 2026-08-26: dnSpy CLI + 운영 read-only SELECT 근거
  // (docs/work-reports/2026-08-26_estimate-cost-no-stock-design.md) —
  // ShipmentMaster/ShipmentDate/CustomerProdCost 에는 트리거가 없고 ShipmentDetail 트리거는
  // OutQuantity UPDATE 에만 반응한다. 금액(Cost/Amount/Vat) UPDATE 에는 확정취소/재확정 SP나
  // 재고 SP가 필요 없다. 따라서 이 경로는 확정해제→재확정 사이클(runEditWithFixCycle)을
  // 태우지 않는다 — 수량/신규분배처럼 실제 물리 변경이 있는 경로만 기존 사이클을 그대로 쓴다.
  // modeOverride 는 새 "단가 + 업체 지정단가 함께 저장" 버튼이 React state 갱신 타이밍에
  // 의존하지 않고 mode='fixed' 를 명시적으로 전달하기 위한 인수다 (없으면 기존 select 상태 사용).
  async function applyCostEdits(modeOverride) {
    if (editedCount === 0) return;
    if (!selectedShipmentKeys.length) { setErr('선택된 견적서 없음'); return; }
    if (!ensureEstimateEditAllowed()) return;
    const capturedRefresh = captureEstimateRefresh();
    const effectiveMode = modeOverride || costMode;
    estimateEditPresence.beginSaving();
    let saveSucceeded = false;
    let savedCostOutcome = null;

    // 차수/거래처 정보
    const week = selectedShip.SubWeeks?.split(',')[0] || `${selectedShip.ParentWeek}-01`;

    setCostApplying(true);
    setEditApplyTitle('단가 수정 저장');
    setCostResult(null);
    setCostApplyLog([
      { step: 'start', label: '시작 — 단가 적용 준비 중...' },
    ]);

    try {
      // 편집된 정확한 행 키만 수집한다 — 같은 SdetailKey의 다른(미편집) 출고일을
      // 끌어들이지 않는다. 서버가 sdateKey 소속을 검증하고, 같은 상세의 동일가는
      // 병합, 서로 다른 가격은 명확히 거부한다.
      const editedEntries = Object.entries(costEdits)
        .filter(([, v]) => v !== '' && v !== undefined && v !== null);

      setCostApplyLog(prev => [...prev, {
        step: 'collect',
        label: `${editedEntries.length}건 수정 대상 확인 중...`,
      }]);

      const allItems = [];
      editedEntries.forEach(([key, rawVal]) => {
        const cost = Number(rawVal);
        if (!Number.isFinite(cost) || cost < 0) throw new Error('단가는 0 이상의 숫자로 입력하세요. 저장하지 않았습니다.');
        const it = items.find(row => getItemEditKey(row) === key);
        if (!it) throw new Error('수정한 품목이 현재 조회 내역에 없습니다. 입력값을 보관하고 다시 조회하세요.');
        if (isEstimateEditKey(key) && it.EstimateKey != null) {
          allItems.push({
            shipmentKey: it.ShipmentKey,
            estimateKey: it.EstimateKey,
            cost,
            OrderWeek: it.OrderWeek,
            ProdName: it.ProdName,
            CountryFlower: it.CountryFlower,
            expectedOldCost: it.Cost,
          });
        } else if (it.SdetailKey != null) {
          allItems.push({
            shipmentKey: it.ShipmentKey,
            sdetailKey: it.SdetailKey,
            ...requireCostSnapshot(it),
            cost,
            OrderWeek: it.OrderWeek,
            ProdName: it.ProdName,
            CountryFlower: it.CountryFlower,
            // 화면의 출고일별 단가(DateCost)와 상세 단가(Cost)가 다를 수 있다 — 서버가
            // sdateKey 소속을 검증하고 이 값으로 낙관적 동시성을 확인한다.
          });
        }
      });

      if (allItems.length === 0) {
        throw new Error('수정 대상 항목이 없습니다');
      }

      // 세부차수별 카운트 (로그용)
      const skCounts = {};
      allItems.forEach(it => {
        skCounts[it.shipmentKey] = (skCounts[it.shipmentKey] || 0) + 1;
      });
      const skSummary = Object.entries(skCounts)
        .map(([sk, n]) => `#${sk}(${n}건)`).join(', ');

      setCostApplyLog(prev => [...prev, {
        step: 'processing',
        label: `${allItems.length}건 처리 중 — 확정 상태와 재고는 그대로 두고 단가·금액을 한 번에 저장합니다.`,
      }]);

      // ── 단일 POST — 확정 플래그를 그대로 보존하는 금액 전용 저장.
      // 수량을 바꾸지 않으므로 확정해제→저장→재확정 사이클(fix/unfix)을 호출하지 않는다.
      const body = {
        items: allItems.map(({ OrderWeek, ProdName, CountryFlower, ...it }) => it),
        mode: effectiveMode,
        orderYear: yearStr,
        week,
        custKey: selectedShip.CustKey,
        editGuard: estimateEditGuard(),
      };

      allItems.forEach(it => {
        setCostApplyLog(prev => [...prev, {
          step: 'save',
          label: `${it.OrderWeek} ${it.ProdName} 단가 저장 — ${it.expectedOldCost} → ${it.cost}`,
        }]);
      });

      const d = await saveEstimateCostBatch({ allItems, body, captured: capturedRefresh });

      const customerCostNote = effectiveMode === 'fixed'
        ? ` · 업체 지정단가 ${Number(d.customerCostUpdated || 0)}건 저장. ${Number(d.customerCostSkippedEstimate || 0) > 0 ? `불량·검역·판매요청 ${Number(d.customerCostSkippedEstimate)}건은 견적 단가만 변경했습니다. ` : ''}다른 업체·다른 차수의 출고 저장값은 변경하지 않았습니다.`
        : '';
      setCostApplyLog(prev => [...prev, {
        step: 'processed',
        label: d.responseRecovered
          ? `✓ 서버 복구 후 실제 단가 ${d.changedCount}건 반영 확인${customerCostNote}`
          : `✓ 저장 완료 — ${d.changedCount}건, 공급가 ${d.diffAmount >= 0 ? '+' : ''}${(d.diffAmount || 0).toLocaleString()}원${customerCostNote}`,
      }]);

      const allChanges = d.changes || [];
      const totalDiff = d.diffAmount || 0;
      saveSucceeded = true;
      savedCostOutcome = {
        success: true,
        changedCount: Number(d.changedCount || allChanges.length),
        totalDiff,
        customerCostUpdated: Number(d.customerCostUpdated || 0),
      };
      if (!isCapturedEstimateScopeCurrent(capturedRefresh)) return;

      setCostApplyLog(prev => [...prev, { step: 'done', label: '✅ 전체 완료 — 견적서 재로딩 중...' }]);

      // 재로딩 — 좌측 출고목록(합계금액) + 우측 견적 상세 둘 다
      if (capturedRefresh) {
        await new Promise(res => setTimeout(res, 400));
        await refreshCapturedEstimate(capturedRefresh);
      }
      if (!isCapturedEstimateScopeCurrent(capturedRefresh)) return;

      setCostResult(savedCostOutcome);
      // 성공 시 편집 상태 초기화
      setCostEdits({});
    } catch (err) {
      if (!isCapturedEstimateScopeCurrent(capturedRefresh)) return;
      if (saveSucceeded) {
        setCostApplyLog(prev => [...prev, { step: 'error', label: '저장은 완료됐지만 재조회에 실패했습니다. 다시 조회해 결과를 확인하세요.' }]);
        setCostResult({ ...savedCostOutcome, refreshRequired: true });
        setErr('단가 저장은 완료됐지만 재조회에 실패했습니다. 다시 조회해 결과를 확인하세요.');
        return;
      }
      setCostApplyLog(prev => [...prev, { step: 'error', label: `❌ 오류: ${err.message}` }]);
      setCostResult({ success: false, error: err.message });
      // STALE_DATA = 화면이 옛 단가를 들고 있음(앞선 시도가 이미 저장됐거나 타인이 수정)
      // → 최신 단가로 화면 자동 갱신. 입력한 수정값(costEdits)은 유지되므로 바로 재적용 가능.
      if (err.isStaleData || err.code === 'STALE_DATA' || err.code === 'ERP_EDIT_STALE') {
        estimateEditPresence.markStale();
        setCostApplyLog(prev => [...prev, { step: 'cycle', label: '최신 단가로 화면 갱신 중 — 이미 반영된 항목은 값이 일치하게 보입니다' }]);
        try { await refreshCapturedEstimate(capturedRefresh); } catch { /* 최신 재조회 실패는 현재 오류 안내를 유지 */ }
      }
    } finally {
      setCostApplying(false);
      await estimateEditPresence.endSaving({ refreshBaseline: saveSucceeded && isCapturedEstimateScopeCurrent(capturedRefresh) });
    }
  }

  async function applyAllEdits() {
    if (editedCount === 0 && editedQtyCount === 0 && pendingAdds.length === 0) return;
    if (!selectedShipmentKeys.length) { setErr('선택된 견적서 없음'); return; }
    if (!ensureEstimateEditAllowed()) return;
    const capturedRefresh = captureEstimateRefresh();
    estimateEditPresence.beginSaving();
    let saveSucceeded = false;
    let automaticProgressId = '';

    setQtyApplying(true);
    setCostApplying(true);
    setEditApplyTitle(pendingAdds.length ? '단가/수량/추가품목 저장' : '단가/수량 수정 저장');
    setQtyResult(null);
    setCostResult(null);
    setCostApplyLog([{ step: 'start', label: `${weekNum}차 견적서 단가/수량/추가품목 저장 시작` }]);

    try {
      const qtyPending = [];
      for (const [editKey, newVal] of Object.entries(qtyEdits)) {
        if (newVal === '' || newVal == null) continue;
        const item = filteredItems.find(it => getQtyEditKey(it) === editKey);
        if (!item) continue;
        const isDateQuantity = isDateQuantityEditKey(editKey);
        const isEstimate = isEstimateEditKey(editKey);
        if (!isDateQuantity && !isEstimate) continue;
        const keyNumber = parseEditKeyNumber(editKey);
        const oldQty = parseFloat(item.Quantity) || 0;
        const newQty = parseFloat(newVal);
        if (Number.isNaN(newQty) || newQty < 0) continue;
        const effectiveNewQty = isEstimate && oldQty < 0 ? -Math.abs(newQty) : newQty;
        if (Math.abs(effectiveNewQty - oldQty) < 0.001) continue;
        qtyPending.push({ keyNumber, isDateQuantity, isEstimate, item, oldQty, newQty });
      }

      // 편집된 정확한 행 키만 수집한다 — 같은 SdetailKey의 다른(미편집) 출고일을
      // 끌어들이지 않는다. 서버가 sdateKey 소속을 검증하고, 같은 상세의 동일가는
      // 병합, 서로 다른 가격은 명확히 거부한다.
      const editedCostEntries = Object.entries(costEdits)
        .filter(([, v]) => v !== '' && v !== undefined && v !== null);
      const costItems = [];
      editedCostEntries.forEach(([key, rawVal]) => {
        const cost = Number(rawVal);
        if (!Number.isFinite(cost) || cost < 0) throw new Error('단가는 0 이상의 숫자로 입력하세요. 저장하지 않았습니다.');
        const it = items.find(row => getItemEditKey(row) === key);
        if (!it) throw new Error('수정한 품목이 현재 조회 내역에 없습니다. 입력값을 보관하고 다시 조회하세요.');
        if (isEstimateEditKey(key) && it.EstimateKey != null) {
          costItems.push({
            shipmentKey: it.ShipmentKey,
            estimateKey: it.EstimateKey,
            cost,
            OrderWeek: it.OrderWeek,
            ProdName: it.ProdName,
            CountryFlower: it.CountryFlower,
            expectedOldCost: it.Cost,
          });
        } else if (it.SdetailKey != null) {
          costItems.push({
            shipmentKey: it.ShipmentKey,
            sdetailKey: it.SdetailKey,
            ...requireCostSnapshot(it),
            cost,
            OrderWeek: it.OrderWeek,
            ProdName: it.ProdName,
            CountryFlower: it.CountryFlower,
          });
        }
      });

      if (qtyPending.length === 0 && costItems.length === 0 && pendingAdds.length === 0) throw new Error('수정 대상이 없습니다.');

      // 기존 출고일 수량은 서버의 원자 저장으로 확정 상태를 보존한다.
      // 신규 추가품목만 기존의 범위 제한 확정해제·저장·재확정 사이클 대상이다.
      // 단가 전용 수정은 확정 플래그를 보존하는 금액 전용 저장이므로 사이클에 포함하지 않는다
      // (2026-08-26: docs/work-reports/2026-08-26_estimate-cost-no-stock-design.md).
      // 차감(Estimate.Quantity)만 단독 수정하는 경우에도 ShipmentDetail 사이클이 필요 없다.
      const atomicDateItems = qtyPending.filter(p => p.isDateQuantity).map(p => p.item);
      const atomicDateWeeks = getFixCycleWeeksForEditedItems(atomicDateItems, selectedShip);
      const addWeekShort = `${String(weekNum).padStart(2, '0')}-02`;
      const addCycleItems = pendingAdds.map((t) => ({ OrderWeek: addWeekShort, ProdKey: t.prodKey }));
      const cycleItems = addCycleItems;
      const existingQtyChanged = pendingAdds.length > 0;
      const skipStockCalc = shouldSkipFixCycleStockCalc({ existingQtyChanged });
      const cycleStockFlags = confirmedWeekFixCycleStockFlags({ existingQtyChanged });
      const derivedCycleWeeks = getFixCycleWeeksForEditedItems(cycleItems, selectedShip);
      // 단가/출고일 수량을 함께 저장하는 경로에서 화면 행에 OrderWeek가 누락되어도
      // 확정 사이클을 생략하지 않는다. 선택 견적의 세부차수를 안전한 fallback으로 사용한다.
      const fallbackCycleWeeks = sortWeeksAsc(
        String(selectedShip?.SubWeeks || `${selectedShip?.ParentWeek || weekNum}-01`)
          .split(',')
          .map(s => s.trim())
          .filter(Boolean),
      );
      const cycleWeeks = derivedCycleWeeks.length > 0
        ? derivedCycleWeeks
        : (cycleItems.length > 0 ? fallbackCycleWeeks : []);
      const cycleCountryFlowers = getCountryFlowersForEditedItems(cycleItems);
      const cycleStockProdKeys = getProdKeysForEditedItems(cycleItems);
      if (cycleWeeks.length > 0) {
        automaticProgressId = beginAutomaticEditProgress({
          weeks: cycleWeeks,
          title: '확정차수 해제 준비 중',
          pollServerLogs: true,
        });
        setCostApplyLog(prev => [...prev, {
          step: 'cycle',
          label: formatAutoUnfixSaveLog(cycleWeeks, `${cycleCountryFlowers.length ? ` / 카테고리 ${cycleCountryFlowers.join(', ')}` : ''}${skipStockCalc ? ' · 재고 반영 생략' : ' · 대상 품목 재고 반영 및 영향 차수 재확정'}`),
        }]);
      } else if (atomicDateItems.length > 0) {
        automaticProgressId = beginAutomaticEditProgress({
          weeks: atomicDateWeeks,
          title: '확정 상태 유지 수량 저장 준비 중',
        });
      }

      const runCombinedUpdate = async () => {
        const dateResults = await saveDateQuantityBatch(qtyPending.filter(p => p.isDateQuantity), {
          captured: capturedRefresh,
          onProgress: stage => {
            if (automaticProgressId) appendAutomaticEditStage(automaticProgressId, stage);
          },
        });
        if (dateResults.some(r => !r.ok)) {
          return {
            qtyResults: dateResults,
            costResultData: { changedCount: 0, diffAmount: 0, changes: [] },
          };
        }

        const deductionResults = await runLimited(qtyPending.filter(p => p.isEstimate), 4, async (p) => {
          setCostApplyLog(prev => [...prev, {
            step: 'save',
            label: `${p.item.OrderWeek} ${p.item.ProdName} 수량 저장 — ${p.oldQty}${p.item.Unit} → ${p.newQty}${p.item.Unit}`,
          }]);
          return saveDeductionQuantity(p, { captured: capturedRefresh });
        });
        const qtyResults = [...dateResults, ...deductionResults];
        if (qtyResults.some(r => !r.ok)) {
          return {
            qtyResults,
            costResultData: { changedCount: 0, diffAmount: 0, changes: [] },
          };
        }

        let costResultData = { changedCount: 0, diffAmount: 0, changes: [] };
        const rebasedCosts = rebaseCostItemsFromSaved(costItems, dateResults.map(r => r.saved), dateResults.map(r => r.key));
        if (!rebasedCosts.ok) throw new Error(STALE_COST_MESSAGE);
        if (rebasedCosts.skipped) setCostApplyLog(prev => [...prev, { step: 'save', label: `출고 삭제로 단가 저장 제외 ${rebasedCosts.skipped}건` }]);
        if (rebasedCosts.items.length > 0) {
          rebasedCosts.items.forEach(it => {
            setCostApplyLog(prev => [...prev, {
              step: 'save',
              label: `${it.OrderWeek} ${it.ProdName} 단가 저장 — ${it.expectedOldCost} → ${it.cost}`,
            }]);
          });
          const costBody = {
            items: rebasedCosts.items.map(({ OrderWeek, ProdName, CountryFlower, ...it }) => it),
            mode: costMode,
            orderYear: yearStr,
            week: selectedShip.SubWeeks?.split(',')[0] || `${selectedShip.ParentWeek}-01`,
            custKey: selectedShip.CustKey,
            editGuard: estimateEditGuard(),
          };
          costResultData = await saveEstimateCostBatch({
            allItems: rebasedCosts.items,
            body: costBody,
            captured: capturedRefresh,
          });
        }
        const addResults = [];
        if (pendingAdds.length > 0) {
          for (const t of pendingAdds) {
            setCostApplyLog(prev => [...prev, {
              step: 'save',
              label: `${t.weekShort || addWeekShort} ${t.prodName} 추가 품목 저장 — +${t.qty}${t.unit} / ${Number(t.cost).toLocaleString()}원`,
            }]);
            try {
              const d = await apiPost('/api/shipment/adjust', {
                custKey: t.custKey,
                prodKey: t.prodKey,
                week: t.week,
                type: 'ADD',
                qty: t.qty,
                unit: t.unit,
                year: yearStr,
                mode: 'PIVOT_DISTRIBUTION',
                unitCost: t.cost,
                costSourceId: t.costSourceId,
                shipmentDate: t.shipmentDate,
                estimateAdditional: true,
                memo: `견적서 추가 품목: ${t.prodName} +${t.qty}${t.unit} 단가출처=${t.costSourceId}`,
                force: false,
                editGuard: estimateEditGuard(),
              });
              addResults.push({ ...t, ok: !!d.success, error: d.error });
            } catch (e) {
              addResults.push({ ...t, ok: false, code: e?.code || e?.data?.code, error: e.message });
            }
          }
          if (addResults.some(r => !r.ok)) {
            const first = addResults.find(r => !r.ok);
            const error = new Error(first?.error || '추가 품목 저장 실패');
            error.code = first?.code;
            throw error;
          }
        }
        return { qtyResults, costResultData, addResults };
      };

      const runCombinedFixCycle = async (weeks) => {
        if (automaticProgressId) {
          setAutomaticEditProgress(prev => setEstimateEditProgressWeeks(prev, automaticProgressId, weeks));
        }
        return runEditWithFixCycle({
          weeks,
          orderYear: yearStr,
          // 화면 품종은 안내용이며 최종 범위는 수정 ProdKey로 서버에서 다시 확인한다.
          countryFlowers: cycleCountryFlowers,
          stockProdKeys: existingQtyChanged ? cycleStockProdKeys : [],
          progress: label => {
            setCostApplyLog(prev => [...prev, { step: 'cycle', label }]);
            if (automaticProgressId) appendAutomaticEditStage(automaticProgressId, { kind: 'cycle', label });
          },
          apply: runCombinedUpdate,
          ...cycleStockFlags,
        });
      };

      let combinedResult;
      try {
        combinedResult = cycleWeeks.length > 0
          ? await runCombinedFixCycle(cycleWeeks)
          : await runCombinedUpdate();
      } catch (firstError) {
        // 첫 사이클의 화면 범위가 운영 DB의 확정 범위와 달랐던 경우에도
        // 서버가 반환한 실제 확정 차수를 합쳐 전체 범위로 1회 재시도한다.
        if (!automaticProgressId || firstError?.code !== 'FIXED_WEEK') throw firstError;
        const retryWeeks = sortWeeksAsc([
          ...cycleWeeks,
          ...fallbackCycleWeeks,
          ...(firstError.fixedWeeks || []),
        ]);
        if (retryWeeks.length === 0) throw firstError;
        setCostApplyLog(prev => [...prev, {
          step: 'cycle',
          label: `확정 범위 재확인 후 자동 재시도: ${sortWeeksDesc(retryWeeks).join(' 해제 → ')} 해제 후 ${sortWeeksAsc(retryWeeks).join(' 확정 → ')} 확정`,
        }]);
        combinedResult = await runCombinedFixCycle(retryWeeks);
      }

      const { qtyResults, costResultData, addResults = [] } = combinedResult;

      const okQty = qtyResults.filter(r => r.ok).length;
      const failedQty = qtyResults.length - okQty;
      const okAdds = addResults.filter(r => r.ok).length;
      saveSucceeded = failedQty === 0;
      if (!isCapturedEstimateScopeCurrent(capturedRefresh)) return;
      setQtyResult({ results: qtyResults, okCount: okQty, failCount: failedQty });
      setCostApplyLog(prev => [...prev, {
        step: failedQty ? 'error' : 'done',
        label: failedQty
          ? `수량 저장 실패 ${failedQty}건 — ${qtyResults.find(r => !r.ok)?.error || '단가/추가품목 저장은 실행하지 않음'}`
          : `완료 — 단가/수량/추가품목 ${okAdds}건 반영 후 견적서 재조회 중`,
      }]);
      setCostResult({
        success: failedQty === 0,
        type: 'combined',
        changedCount: okQty + Number(costResultData.changedCount || 0) + okAdds,
        totalDiff: Number(costResultData.diffAmount || 0),
        error: failedQty ? (qtyResults.find(r => !r.ok)?.error || '일부 수량 저장 실패') : undefined,
      });
      if (failedQty === 0) {
        setQtyEdits({});
        setCostEdits({});
        setPendingAdds([]);
      }
      await refreshCapturedEstimate(capturedRefresh);
    } catch (err) {
      if (automaticProgressId) {
        appendAutomaticEditStage(automaticProgressId, {
          kind: 'error', status: 'error', label: `자동 확정차수 편집 오류 — ${err.message || '알 수 없는 오류'}`,
        });
      }
      if (!isCapturedEstimateScopeCurrent(capturedRefresh)) return;
      if (saveSucceeded) {
        setCostApplyLog(prev => [...prev, { step: 'error', label: '수정 저장은 완료됐지만 재조회에 실패했습니다. 다시 조회해 결과를 확인하세요.' }]);
        setCostResult(prev => prev && ({ ...prev, success: true, refreshRequired: true }));
        setErr('수정 저장은 완료됐지만 재조회에 실패했습니다. 다시 조회해 결과를 확인하세요.');
        return;
      }
      if (err?.code === 'ERP_EDIT_STALE' || err?.data?.code === 'ERP_EDIT_STALE') estimateEditPresence.markStale();
      setCostApplyLog(prev => [...prev, { step: 'error', label: `오류 — ${err.message}` }]);
      setCostResult({ success: false, error: err.message });
      setQtyResult({ error: err.message });
    } finally {
      if (automaticProgressId) {
        finishAutomaticEditProgress(automaticProgressId, {
          ok: saveSucceeded,
          label: saveSucceeded ? '자동 확정차수 편집 완료' : '자동 확정차수 편집이 일부 실패했거나 중단됨',
        });
      }
      setQtyApplying(false);
      setCostApplying(false);
      await estimateEditPresence.endSaving({ refreshBaseline: saveSucceeded && isCapturedEstimateScopeCurrent(capturedRefresh) });
    }
  }

  function closeCostModal() {
    setCostApplying(false);
    setCostApplyLog([]);
    setCostResult(null);
    setAutomaticEditProgress(null);
  }

  // ── WeekDay 필터 (exe ActiveFilterString — filterItemsByWeekday 위에서 정의)
  const ALL_WD = ['월','화','수','목','금','토','일'];
  const filteredItems = filterItemsByWeekday(items);
  const deductionItemCount = filteredItems.filter(isEstimateDeductionRow).length;

  useEffect(() => {
    if (!highlightDeductions || itemLoading) return;
    const el = document.querySelector('[data-estimate-deduction="1"]');
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [highlightDeductions, itemLoading, filteredItems.length, selectedId]);

  useEffect(() => {
    if (!previewCapture || typeof document === 'undefined') return undefined;
    document.body.classList.add('estimate-preview-capture');
    return () => document.body.classList.remove('estimate-preview-capture');
  }, [previewCapture]);

  // 좌측 출고 목록에 실제로 보이는 업체 = 담당자별 출력 모달의 후보와 동일해야 한다.
  const visibleShipments = useMemo(
    () => filterRecentParentWeeks(shipments, recentOnly),
    [shipments, recentOnly],
  );

  // 전체선택 체크박스는 "보이는 업체 중 몇 개가 선택됐는지"로 판단해야 한다.
  // selectedGroups.size 로 비교하면 recentOnly 로 숨은 선택 때문에 상태가 어긋난다.
  const visibleSelectedCount = useMemo(
    () => visibleShipments.filter(s => selectedGroups.has(estimateShipmentGroupId(s))).length,
    [visibleShipments, selectedGroups],
  );

  // 담당자 → 해당 차수에 분배가 있는 업체. 검색어는 담당자·거래처 양쪽에 걸린다.
  const managerPrintGroups = useMemo(
    () => buildManagerPrintGroups(visibleShipments),
    [visibleShipments],
  );
  const managerPrintVisibleGroups = useMemo(
    () => filterManagerPrintGroups(managerPrintGroups, managerPrintQuery),
    [managerPrintGroups, managerPrintQuery],
  );
  const managerPrintSummary = useMemo(
    () => summarizeManagerPrintSelection(managerPrintGroups, managerPrintSel),
    [managerPrintGroups, managerPrintSel],
  );

  const printPreviewItems = useMemo(() => {
    if (!showPrintDialog) return [];
    if (printDialogItems.length > 0 && printDialogItems.every((row) => row?._exePrint === true)) {
      return printDialogItems
        .filter(isPrintableEstimateRow)
        .filter((row) => printOpts.outType !== 'select' || !isEstimateDeductionRow(row));
    }
    return filterPrintTargetItems(printDialogItems, activeWD, printOpts.outType);
  }, [showPrintDialog, printDialogItems, activeWD, printOpts.outType]);

  const printPreviewTotals = useMemo(() => {
    if (!showPrintDialog) return { supply: 0, vat: 0, total: 0, approximate: false };
    return computePrintPreviewTotals(printPreviewItems, printOpts.printFormat);
  }, [showPrintDialog, printPreviewItems, printOpts.printFormat]);

  const printPreviewSupply = printPreviewTotals.supply;
  const printPreviewVat = printPreviewTotals.vat;
  const printPreviewDedCount = printPreviewItems.filter(isEstimateDeductionRow).length;
  const printPreviewShipCount = printPreviewItems.length - printPreviewDedCount;

  const totalQty    = filteredItems.reduce((a,b) => a+(b.Quantity||0), 0);
  const totalCost   = filteredItems.reduce((a,b) => a+(b.Cost||0), 0);
  const totalSupply = filteredItems.reduce((a,b) => a+(b.Amount||0), 0);
  const totalVat    = filteredItems.reduce((a,b) => a+(b.Vat||0), 0);
  const eligibleDeductionItems = useMemo(
    () => eligibleEstimateDeductions(filteredItems),
    [filteredItems],
  );
  const selectedEligibleDeductionItems = useMemo(
    () => eligibleDeductionItems.filter((item) => selectedDeductionKeys.has(Number(item.EstimateKey))),
    [eligibleDeductionItems, selectedDeductionKeys],
  );
  const selectedDeductionCount = selectedEligibleDeductionItems.length;
  const deductionSnapshotMissingCount = filteredItems.filter((item) => isEstimateDeductionRow(item)
    && !hasEstimateDeductionDeleteSnapshot(item)).length;
  const hasUnsavedEstimateEdits = editedCount > 0 || editedQtyCount > 0 || pendingAdds.length > 0;

  const handleSelectedDeductionDelete = async () => {
    if (deductionDeleteInFlightRef.current) return;
    if (!selectedShip || !selectedDeductionCount) {
      setErr('삭제할 불량·검역 차감 행을 선택하세요.');
      return;
    }
    if (hasUnsavedEstimateEdits) {
      setErr('저장하지 않은 단가·수량·추가 품목이 있습니다. 먼저 수정 저장 또는 각 취소를 완료한 뒤 삭제하세요.');
      return;
    }
    if (!ensureEstimateEditAllowed()) return;

    const capturedScope = deductionDeleteScope;
    const capturedRefresh = captureEstimateRefresh();
    const capturedShip = {
      groupId: selectedId,
      custKey: selectedShip.CustKey,
      custName: selectedShip.CustName || '선택 업체',
    };
    let payload;
    try {
      payload = buildEstimateDeductionDeletePayload({
        orderYear: yearStr,
        orderWeek: String(weekNum || ''),
        custKey: capturedShip.custKey,
        items: filteredItems,
        selectedKeys: selectedDeductionKeys,
        editGuard: estimateEditGuard(),
      });
    } catch (error) {
      setErr(error.message || '선택 차감 삭제 정보를 확인할 수 없습니다. 다시 조회하세요.');
      return;
    }
    if (!payload.entries.length) {
      setErr('삭제할 수 있는 불량·검역 차감 행이 없습니다. 다시 조회한 뒤 선택하세요.');
      return;
    }

    const names = selectedEligibleDeductionItems
      .map((item) => `${item.ProdName || '품목'} ${item.DeleteSnapshot?.quantity ?? item.Quantity}${item.DeleteSnapshot?.unit ?? item.Unit ?? ''}`)
      .join(', ');
    const estimateTotalIncrease = selectedEligibleDeductionItems.reduce((sum, item) => {
      const snapshot = item.DeleteSnapshot || {};
      return sum + Math.abs(Number(snapshot.amount || 0) + Number(snapshot.vat || 0));
    }, 0);
    const confirmed = window.confirm(
      `${capturedShip.custName}\n${yearStr}년 ${weekNum}차\n선택한 불량·검역 차감 ${payload.entries.length}건만 삭제합니다.\n${names}\n\n주문·분배·재고 수량은 그대로이며, 선택 차감이 제외되어 견적 합계는 약 ${fmt(estimateTotalIncrease)}원 증가합니다. 연결된 영업 원본은 보존하고 선택한 견적 등록 연결만 취소합니다. 계속하시겠습니까?`,
    );
    if (!confirmed) return;
    if (deductionDeleteScopeRef.current !== capturedScope) {
      setErr('조회 범위가 변경되어 삭제하지 않았습니다. 현재 업체에서 다시 선택하세요.');
      return;
    }

    deductionDeleteInFlightRef.current = true;
    setDeductionDeleting(true);
    estimateEditPresence.beginSaving();
    let deleteSucceeded = false;
    let deletedCount = payload.entries.length;
    try {
      const result = await apiPost('/api/estimate/delete-deductions', payload);
      if (!result?.success) throw new Error(result?.error || '선택 차감 삭제에 실패했습니다.');
      deleteSucceeded = true;
      deletedCount = Number(result.deletedCount || payload.entries.length);

      // 요청 뒤 업체/차수 전환이 있었다면 이미 성공한 삭제를 다른 범위에 재조회하지 않는다.
      if (deductionDeleteScopeRef.current !== capturedScope || !isCapturedEstimateScopeCurrent(capturedRefresh)) return;
      setSelectedDeductionKeys(resetEstimateDeductionSelection());

      const refreshedList = await refreshCapturedEstimate(capturedRefresh);
      if (deductionDeleteScopeRef.current !== capturedScope || refreshedList?.skipped) return;
      const sameCustomerStillExists = (refreshedList?.shipments || [])
        .some((ship) => Number(ship.CustKey) === Number(capturedShip.custKey));
      if (!sameCustomerStillExists) {
        setSuccessMsg(`✅ 선택 차감 ${deletedCount}건을 삭제했습니다. 이 업체의 남은 견적 행이 없습니다.`);
        return;
      }
      setSuccessMsg(`✅ 선택 차감 ${deletedCount}건을 삭제했습니다.`);
    } catch (error) {
      if (!isCapturedEstimateScopeCurrent(capturedRefresh)) return;
      if (error?.code === 'ERP_EDIT_STALE' || error?.data?.code === 'ERP_EDIT_STALE') estimateEditPresence.markStale();
      if (deleteSucceeded) {
        setSuccessMsg(`✅ 선택 차감 ${deletedCount}건은 삭제됐습니다.`);
        setErr(`삭제는 완료, 목록 재조회 실패: ${error.message || '다시 조회해 결과를 확인하세요.'}`);
      } else {
        setErr(`선택 차감 삭제 오류: ${error.message || '다시 조회한 뒤 시도하세요.'}`);
      }
    } finally {
      deductionDeleteInFlightRef.current = false;
      setDeductionDeleting(false);
      await estimateEditPresence.endSaving({ refreshBaseline: deleteSucceeded && isCapturedEstimateScopeCurrent(capturedRefresh) });
    }
  };

  const resetDefectForm = (entryMode = 'defect') => {
    const isSalesRequest = entryMode === 'sales';
    const isLegacy = entryMode === 'legacy';
    setDefectForm({
      entryMode,
      estimateType: isLegacy ? '' : isSalesRequest ? '판매요청' : '불량차감',
      estimateDate: new Date().toISOString().slice(0,10),
      prodKey: '',
      unit: '단',
      negative: !isSalesRequest,
      quantity: '',
      cost: '',
      descr: '',
    });
    setDefectContext(null);
    setDefectContextError('');
  };

  const openEstimateEntry = (entryMode) => {
    if (!selectedShip) {
      alert('먼저 왼쪽에서 업체를 조회·선택하세요.');
      return;
    }
    if (!ensureEstimateEditAllowed()) return;
    resetDefectForm(entryMode);
    setShowDefect(true);
  };

  const loadDefectContext = async (prodKey) => {
    const key = Number(prodKey);
    if (!key || !selectedShip?.CustKey || !weekNum) {
      setDefectContext(null);
      setDefectContextError('차수와 거래처를 먼저 선택하세요.');
      return;
    }
    setDefectContextLoading(true);
    setDefectContextError('');
    setDefectContext(null);
    try {
      const data = await apiGet('/api/estimate', {
        view: 'defectContext',
        year: yearStr,
        week: weekNum,
        custKey: selectedShip.CustKey,
        prodKey: key,
      });
      const context = data.context || {};
      setDefectContext(context);
      setDefectForm((form) => ({
        ...form,
        prodKey: String(key),
        unit: context.displayUnit || form.unit || '단',
        cost: Number(context.cost || 0) > 0 ? String(Math.round(Number(context.cost))) : '',
      }));
      if (!(Number(context.cost) > 0)) {
        setDefectContextError('이전 차수 분배단가를 찾지 못했습니다. 단가를 확인해 주세요.');
      }
    } catch (e) {
      setDefectContextError(e.message || '분배단가 조회에 실패했습니다.');
      setDefectForm((form) => ({ ...form, prodKey: String(key), cost: '' }));
    } finally {
      setDefectContextLoading(false);
    }
  };

  // ── 불량차감/판매요청 등록 저장
  const handleDefectSave = async () => {
    if (!selectedId)              { alert('출고 거래처를 선택하세요.'); return; }
    if (!defectForm.estimateType) { alert('등록 구분을 선택하세요.'); return; }
    if (!defectForm.prodKey)      { alert('품목명을 선택하세요.'); return; }
    if (!defectForm.quantity || parseFloat(defectForm.quantity) <= 0) { alert('수량을 입력하세요.'); return; }
    if (!(parseFloat(defectForm.cost) > 0)) { alert('이전 차수 분배단가를 확인하세요.'); return; }
    const expectedNegative = defectForm.entryMode !== 'sales';
    if (Boolean(defectForm.negative) !== expectedNegative) {
      alert(expectedNegative ? `${defectForm.entryMode === 'legacy' ? '불량/검역' : '불량차감'}등록은 - 차감을 체크해야 합니다.` : '판매요청은 - 차감을 해제해야 합니다.');
      return;
    }
    const capturedRefresh = captureEstimateRefresh();
    const capturedShip = capturedRefresh?.ship && {
      ...capturedRefresh.ship,
    };
    const shipmentKeyForEstimate = capturedShip?.shipmentKey;
    if (!shipmentKeyForEstimate) { alert('견적을 등록할 출고번호를 찾지 못했습니다. 다시 조회 후 선택하세요.'); return; }
    if (!ensureEstimateEditAllowed()) return;
    estimateEditPresence.beginSaving();
    let saveSucceeded = false;
    setSaving(true);
    try {
      const data = await apiPost('/api/estimate', {
        shipmentKey:  shipmentKeyForEstimate,
        targetShipmentKey: shipmentKeyForEstimate,
        orderYear: yearStr,
        orderWeek: weekNum,
        custKey: capturedShip.custKey,
        prodKey:      parseInt(defectForm.prodKey),
        estimateType: defectForm.estimateType,
        entryMode:    defectForm.entryMode,
        negative:     defectForm.negative,
        unit:         defectForm.unit,
        quantity:     parseFloat(defectForm.quantity),
        cost:         parseFloat(defectForm.cost) || 0,
        estimateDate: defectForm.estimateDate,
        descr:        defectForm.descr || '',
        editGuard: estimateEditGuard(),
      });
      saveSucceeded = true;
      if (!isCapturedEstimateScopeCurrent(capturedRefresh)) return;
      setShowDefect(false);
      resetDefectForm('defect');
      setSuccessMsg(`✅ ${defectForm.entryMode === 'sales' ? '판매요청' : defectForm.entryMode === 'legacy' ? '불량/검역' : '불량차감'} 등록 완료 · 견적키 #${data.estimateKey || '-'}`);
      setTimeout(() => setSuccessMsg(''), 3000);
      // Saving A can finish after the user selected B. Reload only the exact
      // captured A scope through the shared list → detail path.
      await refreshCapturedEstimate(capturedRefresh);
    } catch(e) {
      if (!isCapturedEstimateScopeCurrent(capturedRefresh)) return;
      if (saveSucceeded) {
        setErr('등록은 완료됐지만 재조회에 실패했습니다. 다시 조회해 결과를 확인하세요.');
        return;
      }
      if (e?.code === 'ERP_EDIT_STALE' || e?.data?.code === 'ERP_EDIT_STALE') estimateEditPresence.markStale();
      setErr(e.message);
    } finally { setSaving(false); await estimateEditPresence.endSaving({ refreshBaseline: saveSucceeded && isCapturedEstimateScopeCurrent(capturedRefresh) }); }
  };

  const openItemEditor = (item) => {
    if (deductionDeleteInFlightRef.current) return;
    if (!item) return;
    setSelectedItemForEdit(item);
    const isEstimate = isEstimateDeductionRow(item) && item.EstimateKey != null;
    setItemEditor({
      item,
      isEstimate,
      estimateKey: isEstimate ? Number(item.EstimateKey) : null,
      prodKey: String(item.ProdKey || ''),
      unit: item.Unit || '단',
      quantity: String(Math.abs(Number(item.Quantity || 0))),
      cost: String(Number(item.Cost || 0)),
      estimateDate: String(item.outDate || '').slice(0, 10),
      descr: item.DescrRaw != null ? String(item.DescrRaw) : String(item.Descr || ''),
    });
    setItemEditorError('');
  };

  const saveItemEditor = async () => {
    const editor = itemEditor;
    const item = editor?.item;
    if (!editor || !item) return;
    const quantity = Number(editor.quantity);
    const cost = Number(editor.cost);
    if (!(quantity > 0)) { setItemEditorError('수량은 0보다 커야 합니다.'); return; }
    if (!Number.isFinite(cost) || cost < 0) { setItemEditorError('단가는 0 이상이어야 합니다.'); return; }
    if (!editor.prodKey) { setItemEditorError('품목을 선택하세요.'); return; }
    if (!ensureEstimateEditAllowed()) { setItemEditorError('다른 작업 또는 전산 변경이 감지되었습니다. 화면의 안내를 확인하세요.'); return; }
    const capturedRefresh = captureEstimateRefresh();
    if (!capturedRefresh) { setItemEditorError('선택한 업체 정보가 없어 다시 조회하세요.'); return; }
    estimateEditPresence.beginSaving();
    let saveSucceeded = false;
    let automaticProgressId = '';

    setItemEditorSaving(true);
    setItemEditorError('');
    try {
      if (editor.isEstimate) {
        const response = await fetch('/api/estimate/update-entry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            estimateKey: editor.estimateKey,
            shipmentKey: item.ShipmentKey,
            orderYear: yearStr,
            custKey: capturedRefresh.ship.custKey,
            prodKey: Number(editor.prodKey),
            unit: editor.unit,
            quantity,
            cost,
            estimateDate: editor.estimateDate || undefined,
            descr: editor.descr || '',
            expectedQuantity: Number(item.Quantity || 0),
            expectedCost: Number(item.Cost || 0),
            expectedProdKey: Number(item.ProdKey || 0),
            expectedUnit: String(item.Unit || ''),
            expectedDescr: item.DescrRaw != null ? String(item.DescrRaw) : String(item.Descr || ''),
            editGuard: estimateEditGuard(),
          }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          const error = new Error(data.error || '견적 품목 수정에 실패했습니다.');
          error.code = data.code;
          error.data = data;
          throw error;
        }
        saveSucceeded = true;
        if (!isCapturedEstimateScopeCurrent(capturedRefresh)) return;
        setItemEditor(null);
        setSuccessMsg(`✅ 견적 품목 수정 완료 · 견적키 #${editor.estimateKey}`);
        setTimeout(() => setSuccessMsg(''), 3000);
        await refreshCapturedEstimate(capturedRefresh);
        return;
      }

      // 정상출고는 기존 EXE 호환 저장 API를 사용한다. 품목·단위는 ShipmentDetail 원장과
      // 연결되어 있으므로 이 창에서는 변경하지 않고, 날짜별 수량/단가만 수정한다.
      const quantityChanged = Math.abs(quantity - Number(item.Quantity || 0)) > 0.001;
      const costChanged = Math.abs(cost - Number(item.Cost || 0)) > 0.001;
      const originalDescr = item.DescrRaw != null ? String(item.DescrRaw) : String(item.Descr || '');
      const descrChanged = String(editor.descr || '') !== originalDescr;
      if (!quantityChanged && !costChanged && !descrChanged) {
        setItemEditor(null);
        return;
      }
      if (quantityChanged && !item.SdateKey) {
        throw new Error('출고일별 견적키(SdateKey)가 없어 수량을 수정할 수 없습니다. 출고분배 화면에서 확인하세요.');
      }
      if (costChanged && !item.SdetailKey) {
        throw new Error('출고 상세키(SdetailKey)가 없어 단가를 수정할 수 없습니다.');
      }

      setCostApplying(true);
      setEditApplyTitle('품목 정보 수정');
      setCostApplyLog([{ step: 'start', label: `${item.OrderWeek || weekNum} ${item.ProdName} 정보 수정 시작` }]);
      setCostResult(null);
      if (quantityChanged || descrChanged) {
        automaticProgressId = beginAutomaticEditProgress({
          weeks: getFixCycleWeeksForEditedItems([item], selectedShip),
          title: '확정 상태 유지 출고일 저장 준비 중',
        });
      }
      const apply = async () => {
        let editorCostItems = costChanged ? [{ shipmentKey: item.ShipmentKey, sdetailKey: item.SdetailKey, cost, ...requireCostSnapshot(item) }] : [];
        if (quantityChanged || descrChanged) {
          setCostApplyLog(prev => [...prev, { step: 'save', label: quantityChanged
            ? `출고일 수량/비고 저장 — ${item.Quantity}${item.Unit} → ${quantity}${item.Unit}`
            : '출고일 비고 저장' }]);
          if (automaticProgressId) appendAutomaticEditStage(automaticProgressId, { kind: 'save', label: '출고일 저장 요청 (확정 상태 유지)' });
          const response = await fetch('/api/estimate/update-date-quantity', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
              orderYear: yearStr,
              custKey: capturedRefresh.ship.custKey,
              sdateKey: item.SdateKey,
              quantity,
              unit: item.Unit,
              expectedOldQuantity: Number(item.Quantity || 0),
              descr: editor.descr || '',
              expectedOldDescr: originalDescr,
              ...(costChanged ? { expectedOldCost: editorCostItems[0].expectedOldCost } : {}),
              editGuard: estimateEditGuard(),
            }),
          });
          const data = await response.json();
          if (!response.ok || !data.success) {
            const label = data.rolledBack === true
              ? `${data.error || '출고일 수량 수정 실패'} — 저장되지 않았습니다.`
              : `${data.error || '출고일 수량 수정 실패'} — 저장 결과를 확인하지 못했습니다. 다시 저장하지 말고 재조회하세요.`;
            setCostApplyLog(prev => [...prev, { step: 'error', label }]);
            if (automaticProgressId) appendAutomaticEditStage(automaticProgressId, { kind: 'error', status: 'error', label });
            const error = new Error(data.error || '출고일 수량 수정에 실패했습니다.');
            error.code = data.code;
            throw error;
          }
          const stockResponse = describeDateQuantitySaveResult(data);
          const label = `저장 결과 — ${stockResponse.join(' / ')}`;
          setCostApplyLog(prev => [...prev, { step: 'save', label }]);
          if (automaticProgressId) appendAutomaticEditStage(automaticProgressId, { kind: 'server', label });
          if (automaticProgressId) appendAutomaticEditStage(automaticProgressId, { kind: 'server', status: 'done', label: '출고일 저장 완료' });
          if (costChanged) {
            const rebased = rebaseCostItemsFromSaved(editorCostItems, data.items || [], [item.SdateKey]);
            if (!rebased.ok) throw new Error(STALE_COST_MESSAGE);
            editorCostItems = rebased.items;
            if (rebased.skipped) setCostApplyLog(prev => [...prev, { step: 'save', label: '출고 삭제로 단가 저장 제외' }]);
          }
        }
        if (editorCostItems.length > 0) {
          setCostApplyLog(prev => [...prev, { step: 'save', label: `출고 단가 저장 — ${item.Cost} → ${cost}` }]);
          const response = await fetch('/api/estimate/update-cost', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
              items: editorCostItems,
              mode: 'once',
              orderYear: yearStr,
              custKey: capturedRefresh.ship.custKey,
              editGuard: estimateEditGuard(),
            }),
          });
          const data = await response.json();
          if (!response.ok || !data.success) {
            const error = new Error(data.error || '출고 단가 수정에 실패했습니다.');
            error.code = data.code;
            throw error;
          }
        }
        return { success: true };
      };
      // 기존 행의 수량·비고·단가는 서버의 원자 저장으로 확정 상태를 보존한다.
      await apply();
      saveSucceeded = true;
      if (!isCapturedEstimateScopeCurrent(capturedRefresh)) return;
      setCostApplyLog(prev => [...prev, { step: 'done', label: '완료 — 견적서 재조회 중' }]);
      setItemEditor(null);
      setSuccessMsg(`✅ ${item.ProdName} 정보 수정 완료`);
      setTimeout(() => setSuccessMsg(''), 3000);
      await refreshCapturedEstimate(capturedRefresh);
    } catch (error) {
      if (automaticProgressId) appendAutomaticEditStage(automaticProgressId, { kind: 'error', status: 'error', label: `품목 저장 오류 — ${error.message || '알 수 없는 오류'}` });
      if (!isCapturedEstimateScopeCurrent(capturedRefresh)) return;
      if (saveSucceeded) {
        setErr('품목 정보 저장은 완료됐지만 재조회에 실패했습니다. 다시 조회해 결과를 확인하세요.');
        return;
      }
      if (error?.code === 'ERP_EDIT_STALE' || error?.data?.code === 'ERP_EDIT_STALE') estimateEditPresence.markStale();
      setItemEditorError(error.message || '수정에 실패했습니다.');
      setCostApplyLog(prev => [...prev, { step: 'error', label: `오류 — ${error.message}` }]);
    } finally {
      if (automaticProgressId) {
        finishAutomaticEditProgress(automaticProgressId, {
          ok: saveSucceeded,
          label: saveSucceeded ? '확정 상태 유지 출고일 저장 완료' : '확정 상태 유지 출고일 저장이 실패했거나 중단됨',
        });
      }
      setItemEditorSaving(false);
      setCostApplying(false);
      await estimateEditPresence.endSaving({ refreshBaseline: saveSucceeded && isCapturedEstimateScopeCurrent(capturedRefresh) });
    }
  };

  // ── 엑셀 다운 → 인쇄 옵션(인쇄와 동일 양식) 다이얼로그
  const handleExcel = () => {
    if (selectedGroups.size > 0) {
      openPrintDialog(printOpts.printFormat || ESTIMATE_PRINT_FORMAT.STATEMENT);
      return;
    }
    if (!filteredItems.length) { alert('출력할 데이터가 없거나 행이 선택되지 않았습니다. 좌측에서 행 클릭 또는 체크박스 선택 후 다시 시도하세요.'); return; }
    openPrintDialog(printOpts.printFormat || ESTIMATE_PRINT_FORMAT.STATEMENT);
  };

  /** exe btnExcel — GetExcelDetail → 이카운트 업로드 xlsx */
  const handleEcountExcel = useCallback(async () => {
    if (!weekNum) { alert('차수를 입력하세요.'); return; }
    if (activeWD.size === 0) { alert('출고요일을 선택하세요.'); return; }

    let targets = [];
    if (selectedGroups.size > 0) {
      targets = [...selectedGroups]
        .map((id) => shipments.find((s) => estimateShipmentGroupId(s) === id))
        .filter(Boolean);
    } else if (selectedShip) {
      targets = [selectedShip];
    } else {
      alert('좌측에서 업체를 선택하거나 체크박스로 선택하세요.');
      return;
    }

    const weekDays = [...activeWD].join(',');
    const allRows = [];
    try {
      for (const ship of targets) {
        const d = await apiGet('/api/estimate', {
          view: 'excelDetail',
          week: weekNum,
          year: yearStr,
          custKey: ship.CustKey,
          weekDays,
        });
        if (d.success && d.rows?.length) allRows.push(...d.rows);
      }
      if (!allRows.length) {
        alert('이카운트 업로드용 데이터가 없습니다. (확정 견적·EstQuantity>0·선택 요일)');
        return;
      }
      const fname = `이카운트_견적업로드_${weekNum}차_${new Date().toISOString().slice(0, 10)}.xlsx`;
      downloadEcountUploadWorkbook(allRows, fname);
      setSuccessMsg(`✅ 이카운트 Excel ${allRows.length}행 저장`);
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (e) {
      alert(e.message || '이카운트 Excel 저장 실패');
    }
  }, [weekNum, activeWD, selectedGroups, selectedShip, shipments]);

  const openPrintDialog = (printFormat = ESTIMATE_PRINT_FORMAT.ESTIMATE) => {
    setPrintOpts(o => ({ ...o, outType: 'total', printFormat }));
    setShowPrintDialog(true);
  };

  // ── 견적서 출력 버튼 → 출력 다이얼로그 열기
  const handlePrint = () => {
    // 다중 선택이 있으면 그것만 사용, 없으면 현재 단일 선택 사용
    if (selectedGroups.size > 0) {
      openPrintDialog(ESTIMATE_PRINT_FORMAT.ESTIMATE);
      return;
    }
    if (!filteredItems.length) { alert('출력할 데이터가 없거나 행이 선택되지 않았습니다. 좌측에서 행 클릭 또는 체크박스 선택 후 다시 시도하세요.'); return; }
    openPrintDialog(ESTIMATE_PRINT_FORMAT.ESTIMATE);
  };

  // ── 담당자별 견적서 출력
  //
  // 담당자 칩으로 업체 묶음을 고르고, 확정된 선택을 기존 일괄 인쇄(selectedGroups)에 넘긴다.
  // 인쇄 자체는 doActualPrint 를 그대로 재사용하므로 담당자별 전용 인쇄 경로는 없다.
  const openManagerPrintDialog = (printFormat = ESTIMATE_PRINT_FORMAT.ESTIMATE) => {
    if (!shipments.length) {
      alert('조회된 출고 목록이 없습니다. 차수를 조회한 뒤 다시 시도하세요.');
      return;
    }
    setManagerPrintFormat(printFormat);
    setManagerPrintQuery('');
    // 좌측에서 이미 체크해 둔 업체가 있으면 이어서 편집할 수 있게 가져온다.
    setManagerPrintSel(pruneSelectionToGroups(managerPrintGroups, selectedGroups));
    setShowManagerPrintDialog(true);
  };

  const confirmManagerPrint = () => {
    const picked = pruneSelectionToGroups(managerPrintGroups, managerPrintSel);
    if (picked.size === 0) {
      alert('인쇄할 업체를 선택하세요. 담당자를 누르면 그 담당자의 업체가 모두 선택됩니다.');
      return;
    }
    setSelectedGroups(picked);
    setShowManagerPrintDialog(false);
    openPrintDialog(managerPrintFormat);
  };

  const handleStatementPrint = () => {
    if (selectedGroups.size > 0) {
      openPrintDialog(ESTIMATE_PRINT_FORMAT.STATEMENT);
      return;
    }
    if (!filteredItems.length) { alert('출력할 데이터가 없거나 행이 선택되지 않았습니다. 좌측에서 행 클릭 또는 체크박스 선택 후 다시 시도하세요.'); return; }
    openPrintDialog(ESTIMATE_PRINT_FORMAT.STATEMENT);
  };

  // ── 실제 인쇄 실행
  //
  // [구조 변경] Blob URL + window.open(_blank) 방식 →  iframe srcdoc 방식으로 전환.
  // 이유: Blob URL + _blank 가 일부 Chrome 버전/조건에서 현재 탭으로 navigate 되어
  //       견적서 관리 페이지가 사라지던 문제.  iframe 은 팝업 차단 이슈도 없음.
  //       부모 페이지는 절대 영향 받지 않음.
  const doActualPrint = useCallback(async (opts) => {
    const week = weekNum || '';
    if (activeWD.size === 0) {
      alert('출고요일을 선택하세요. (상단 출고요일 필터 또는 인쇄 옵션에서 요일을 클릭)');
      return;
    }

    const printLogoDataUrl = await loadEstimateLogoDataUrl();

    // ── 숨김 iframe 에 HTML 주입 후 인쇄 (부모 창 영향 없음)
    const printInIframe = (html) => new Promise((resolve) => {
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;';
      iframe.srcdoc = html;
      let done = false;
      const cleanup = () => {
        if (done) return; done = true;
        setTimeout(() => iframe.remove(), 500);
        resolve();
      };
      iframe.onload = () => {
        try {
          iframe.contentWindow.focus();
          iframe.contentWindow.print();
        } catch (e) {
          console.error('[print] iframe error:', e);
        }
        // 프린트 다이얼로그 닫힘 이벤트 (대부분 브라우저 지원)
        try {
          iframe.contentWindow.onafterprint = cleanup;
        } catch (_) { /* cross-origin 등 */ }
        // 보조: 3초 후 강제 제거 (onafterprint 미발화 대비)
        setTimeout(cleanup, 3000);
      };
      document.body.appendChild(iframe);
    });

    // FormEstimateView.GetPrintDetail와 동일한 읽기 경로.
    // 견적서(일반) 인쇄는 ShipmentKey별 상세를 웹에서 재합산하지 않고,
    // 거래처·대차수·선택요일을 서버 SQL에 전달해 EXE 출력용 집계행을 받는다.
    const fetchPrintRowsForShip = async (ship) => {
      if (isStatementPrintFormat(opts.printFormat)) {
        const keys = (ship.ShipmentKeys || '').split(',').map(Number).filter(Boolean);
        const results = await Promise.all(keys.map(async (k) => {
          const response = await fetch(`/api/estimate?shipmentKey=${k}&byDate=1`, { credentials: 'same-origin' });
          const data = await response.json();
          if (!response.ok || !data.success) throw new Error(data.error || '거래명세표 출력자료 조회 실패');
          return data.items || [];
        }));
        return filterItemsByWeekday(results.flat());
      }
      const params = new URLSearchParams({
        custKey: String(ship.CustKey || ''),
        week: String(ship.ParentWeek || week),
        year: yearStr,
        byDate: '1',
        itemsOnly: '1',
        printDetail: '1',
        weekDays: [...activeWD].join(','),
      });
      const response = await fetch(`/api/estimate?${params.toString()}`, { credentials: 'same-origin' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'EXE 출력자료 조회 실패');
      return data.items || [];
    };

    const filterPrintRows = (sourceRows) => {
      const source = sourceRows || [];
      if (source.length > 0 && source.every(r => r?._exePrint === true)) {
        return source
          .filter(isPrintableEstimateRow)
          .filter(r => opts.outType !== 'select' || !isEstimateDeductionRow(r));
      }
      return filterPrintTargetItems(source, activeWD, opts.outType);
    };

    const groupPrintRows = (sourceRows) => {
      const source = sourceRows || [];
      if (source.length > 0 && source.every(r => r?._exePrint === true)) {
        const grouped = new Map();
        source.forEach((row) => {
          const groupNo = Number.isFinite(Number(row.GroupNo)) ? Number(row.GroupNo) : 99;
          const groupName = String(row.GroupName || '').trim() || '기타';
          const key = `${groupNo}|${groupName}`;
          if (!grouped.has(key)) grouped.set(key, { groupNo, label: groupName, rows: [] });
          grouped.get(key).rows.push(row);
        });
        return [...grouped.values()].sort((a, b) => a.groupNo - b.groupNo || a.label.localeCompare(b.label, 'ko'));
      }
      const groups = {};
      source.forEach(r => {
        const g = getFlowerGroup(r);
        if (!groups[g]) groups[g] = [];
        groups[g].push(r);
      });
      const groupOrder = [
        '콜롬비아 장미', '중국', '에콰도르 장미', '장미',
        '콜롬비아 수국', '수국',
        '콜롬비아 알스트로', '알스트로메리아',
        '카네이션', '네덜란드',
        '콜롬비아 기타', '기타',
      ];
      return [
        ...groupOrder.filter(g => groups[g]?.length > 0).map(label => ({ label, rows: groups[label] })),
        ...Object.keys(groups)
          .filter(g => !groupOrder.includes(g))
          .sort((a, b) => a.localeCompare(b, 'ko'))
          .map(label => ({ label, rows: groups[label] })),
      ];
    };

    // ── 한 거래처분 인쇄 페이지 생성 — rows 와 custName 받아 splitMode 에 따라 페이지 배열 반환
    const buildCustomerPrintPages = (oneCustName, oneRows) => {
      const printRows = filterPrintRows(oneRows);
      if (!printRows.length) return [];
      const bigoSuffix = getPrintFormatBigoSuffix(opts.printFormat);
      const htmlOpts = {
        serialNo: opts.serialNo,
        printDate: opts.printDate,
        custName: oneCustName,
        logoDataUrl: printLogoDataUrl,
        showBoxQty: opts.showBoxQty !== false,
        showDistribDesc: opts.showDistribDesc === true,
        showDeductionOutDay: opts.showDeductionOutDay === true,
        showDeductionDescr: opts.showDeductionDescr === true,
        printFormat: opts.printFormat || ESTIMATE_PRINT_FORMAT.ESTIMATE,
      };

      if (opts.splitMode === 'combined') {
        const bigoLabel = `${week}차 ${bigoSuffix}`;
        return [buildEstimateHtml({
          bigoLabel,
          rows: printRows,
          aggregate: true,
          ...htmlOpts,
        })];
      }

      const pages = groupPrintRows(printRows).map(({ label, rows }) => ({
        bigoLabel: `${week}차 ${label}`,
        rows,
      }));
      return pages.map(({ bigoLabel, rows }) => buildEstimateHtml({
        bigoLabel, rows, aggregate: true,
        ...htmlOpts,
      }));
    };

    // ── 다중 선택 모드: 각 거래처별로 순차 인쇄
    if (selectedGroups.size > 0) {
      // selectedGroups 의 각 그룹에 대해 items 가져와서 인쇄
      const groupArr = Array.from(selectedGroups);
      const printPages = [];
      const selectedShips = groupArr
        .map(groupId => shipments.find(s => estimateShipmentGroupId(s) === groupId))
        .filter(Boolean);
      // 담당자 순으로 정렬해 인쇄물이 담당자별로 모이게 한다(구분 표지는 종이 낭비라 미삽입).
      const printShips = sortEstimateShipmentsForPrint(selectedShips);
      const batchOutcomes = [];
      for (const ship of printShips) {
        let custPages = [];
        try {
          const rows = await fetchPrintRowsForShip(ship);
          custPages = buildCustomerPrintPages(ship.CustName, rows);
        } catch (e) {
          console.error(`[print] ${ship.CustName} 실패:`, e);
          batchOutcomes.push({ custName: ship.CustName, error: e });
        }
        // 요일 필터로 해당 거래처에 출력할 항목이 없으면 생략
        if (custPages.length === 0) continue;
        printPages.push(...custPages);
      }
      const failedCustomers = collectEstimateBatchReadFailures(batchOutcomes);
      if (failedCustomers.length > 0) {
        alert(estimateBatchReadFailureMessage(failedCustomers));
        return;
      }
      if (printPages.length === 0) {
        alert('출력할 데이터가 없습니다.');
        return;
      }
      await printInIframe(buildEstimatePrintBundle(printPages, opts.printFormat));
    } else {
      // 단일 선택 — 출고일별(byDate) 항목으로 요일필터 적용 후 인쇄
      const custName = selectedShip?.CustName || '';
      let refreshedItems = [];
      if (selectedShip) refreshedItems = await fetchPrintRowsForShip(selectedShip);
      else refreshedItems = await reloadSelectedShipmentItems();
      const printPages = buildCustomerPrintPages(custName, refreshedItems);
      if (printPages.length === 0) {
        alert('출력할 데이터가 없습니다.');
        return;
      }
      await printInIframe(buildEstimatePrintBundle(printPages, opts.printFormat));
    }

    setShowPrintDialog(false);
  }, [filteredItems, selectedShip, weekNum, loadEstimateLogoDataUrl, selectedGroups, shipments, reloadSelectedShipmentItems, filterItemsByWeekday, activeWD]);

  const doActualExcelExport = useCallback(async (opts) => {
    const week = weekNum || '';
    if (activeWD.size === 0) {
      alert('출고요일을 선택하세요. (상단 출고요일 필터 또는 인쇄 옵션에서 요일을 클릭)');
      return;
    }

    const bigoSuffix = getPrintFormatBigoSuffix(opts.printFormat);
    const sheetOpts = {
      week,
      printDate: opts.printDate,
      serialNo: opts.serialNo,
      printFormat: opts.printFormat || ESTIMATE_PRINT_FORMAT.ESTIMATE,
      showBoxQty: opts.showBoxQty !== false,
      showDistribDesc: opts.showDistribDesc === true,
      showDeductionOutDay: opts.showDeductionOutDay === true,
      showDeductionDescr: opts.showDeductionDescr === true,
    };

    const fetchPrintRowsForShip = async (ship) => {
      if (isStatementPrintFormat(opts.printFormat)) {
        const keys = (ship.ShipmentKeys || '').split(',').map(Number).filter(Boolean);
        const results = await Promise.all(keys.map(async (k) => {
          const response = await fetch(`/api/estimate?shipmentKey=${k}&byDate=1`, { credentials: 'same-origin' });
          const data = await response.json();
          if (!response.ok || !data.success) throw new Error(data.error || '거래명세표 출력자료 조회 실패');
          return data.items || [];
        }));
        return filterItemsByWeekday(results.flat());
      }
      const params = new URLSearchParams({
        custKey: String(ship.CustKey || ''),
        week: String(ship.ParentWeek || week),
        year: yearStr,
        byDate: '1',
        itemsOnly: '1',
        printDetail: '1',
        weekDays: [...activeWD].join(','),
      });
      const response = await fetch(`/api/estimate?${params.toString()}`, { credentials: 'same-origin' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'EXE 출력자료 조회 실패');
      return data.items || [];
    };

    const filterPrintRows = (sourceRows) => {
      const source = sourceRows || [];
      if (source.length > 0 && source.every(r => r?._exePrint === true)) {
        return source
          .filter(isPrintableEstimateRow)
          .filter(r => opts.outType !== 'select' || !isEstimateDeductionRow(r));
      }
      return filterPrintTargetItems(source, activeWD, opts.outType);
    };

    const groupPrintRows = (sourceRows) => {
      const source = sourceRows || [];
      if (source.length > 0 && source.every(r => r?._exePrint === true)) {
        const grouped = new Map();
        source.forEach((row) => {
          const groupNo = Number.isFinite(Number(row.GroupNo)) ? Number(row.GroupNo) : 99;
          const label = String(row.GroupName || '').trim() || '기타';
          const key = `${groupNo}|${label}`;
          if (!grouped.has(key)) grouped.set(key, { groupNo, label, rows: [] });
          grouped.get(key).rows.push(row);
        });
        return [...grouped.values()].sort((a, b) => a.groupNo - b.groupNo || a.label.localeCompare(b.label, 'ko'));
      }
      const groups = {};
      source.forEach(r => {
        const label = getFlowerGroup(r);
        if (!groups[label]) groups[label] = [];
        groups[label].push(r);
      });
      return Object.keys(groups).sort((a, b) => a.localeCompare(b, 'ko')).map(label => ({ label, rows: groups[label] }));
    };

    const appendSheet = (sheets, custName, oneRows, bigoLabel) => {
      const printRows = filterPrintRows(oneRows);
      if (!printRows.length) return;
      const baseName = sanitizeExcelSheetName(custName);
      let name = baseName;
      let n = 2;
      while (sheets.some(s => s.name === name)) {
        name = sanitizeExcelSheetName(`${baseName}_${n}`);
        n += 1;
      }
      sheets.push({
        name,
        worksheet: buildEstimatePrintWorksheet({
          custName,
          bigoLabel,
          rows: printRows,
          ...sheetOpts,
        }),
      });
    };

    const sheets = [];

    if (selectedGroups.size > 0) {
      const groupArr = Array.from(selectedGroups);
      const printShips = sortEstimateShipmentsForPrint(groupArr
        .map(groupId => shipments.find(s => estimateShipmentGroupId(s) === groupId))
        .filter(Boolean));
      const batchOutcomes = [];
      for (const ship of printShips) {
        try {
          const rows = await fetchPrintRowsForShip(ship);
          if (opts.splitMode === 'combined') {
            appendSheet(sheets, ship.CustName, rows, `${week}차 ${bigoSuffix}`);
          } else {
            groupPrintRows(filterPrintRows(rows)).forEach(({ label, rows: groupRows }) => {
              appendSheet(sheets, `${ship.CustName}_${label}`, groupRows, `${week}차 ${label}`);
            });
          }
        } catch (e) {
          console.error(`[excel] ${ship.CustName} 실패:`, e);
          batchOutcomes.push({ custName: ship.CustName, error: e });
        }
      }
      const failedCustomers = collectEstimateBatchReadFailures(batchOutcomes);
      if (failedCustomers.length > 0) {
        alert(estimateBatchReadFailureMessage(failedCustomers));
        return;
      }
    } else {
      const custName = selectedShip?.CustName || '';
      let refreshedItems = [];
      if (selectedShip) refreshedItems = await fetchPrintRowsForShip(selectedShip);
      else refreshedItems = await reloadSelectedShipmentItems();
      const rows = refreshedItems;
      if (opts.splitMode === 'combined') {
        appendSheet(sheets, custName, rows, `${week}차 ${bigoSuffix}`);
      } else {
        groupPrintRows(filterPrintRows(rows)).forEach(({ label, rows: groupRows }) => {
          appendSheet(sheets, `${custName}_${label}`, groupRows, `${week}차 ${label}`);
        });
      }
    }

    if (sheets.length === 0) {
      alert('출력할 데이터가 없습니다.');
      return;
    }

    const wb = buildEstimatePrintWorkbook(sheets);
    const title = getPrintFormatDocTitle(opts.printFormat);
    const fileName = sheets.length > 1
      ? `${title}_${week}차_일괄.xlsx`
      : `${title}_${sheets[0].name}_${week}차.xlsx`;
    downloadEstimatePrintWorkbook(wb, fileName);
    setShowPrintDialog(false);
  }, [weekNum, activeWD, selectedGroups, shipments, selectedShip, reloadSelectedShipmentItems, filterItemsByWeekday]);

  /** 주문등록(ViewOrder) 품목 → 거래명세표 Excel (인쇄·엑셀과 동일 양식) */
  const handleOrderStatementExcel = useCallback(async () => {
    const ships = selectedGroups.size > 0
      ? Array.from(selectedGroups)
        .map(g => shipments.find(s => estimateShipmentGroupId(s) === g))
        .filter(Boolean)
      : (selectedShip ? [selectedShip] : []);

    if (!ships.length) {
      alert('출고 목록에서 거래처를 선택하세요.');
      return;
    }
    const pw = weekNum || ships[0]?.ParentWeek || '';
    if (!pw) {
      alert('차수를 입력하세요.');
      return;
    }

    const printDate = new Date().toISOString().slice(0, 10);
    const sheets = [];
    const skipped = [];

    for (const ship of ships) {
      try {
        const d = await apiGet('/api/estimate/order-statement-rows', {
          custKey: ship.CustKey,
          orderYear: yearStr,
          parentWeek: ship.ParentWeek || pw,
        });
        if (!d.success) throw new Error(d.error || '조회 실패');
        if (!d.rows?.length) {
          skipped.push(ship.CustName);
          continue;
        }
        let name = sanitizeExcelSheetName(ship.CustName);
        let n = 2;
        while (sheets.some(s => s.name === name)) {
          name = sanitizeExcelSheetName(`${ship.CustName}_${n}`);
          n += 1;
        }
        const weekLabel = ship.ParentWeek || pw;
        sheets.push({
          name,
          worksheet: buildEstimatePrintWorksheet({
            custName: ship.CustName,
            week: `${weekLabel}차`,
            printDate,
            serialNo: '',
            printFormat: ESTIMATE_PRINT_FORMAT.STATEMENT,
            rows: d.rows,
            showBoxQty: false,
            showDistribDesc: false,
            showDeductionOutDay: false,
            showDeductionDescr: false,
            bigoLabel: `${weekLabel}차 종합거래명세표 (주문등록)`,
          }),
        });
      } catch (e) {
        console.error('[order-statement-excel]', ship.CustName, e);
        skipped.push(`${ship.CustName} (${e.message})`);
      }
    }

    if (sheets.length === 0) {
      alert(
        skipped.length
          ? `주문등록 품목이 없습니다.\n${skipped.join('\n')}`
          : '주문등록 품목이 없습니다. 해당 차수·거래처에 주문이 등록되어 있는지 확인하세요.',
      );
      return;
    }

    const wb = buildEstimatePrintWorkbook(sheets);
    const fileName = sheets.length > 1
      ? `거래명세표_주문등록_${pw}차_일괄.xlsx`
      : `거래명세표_주문등록_${sheets[0].name}_${pw}차.xlsx`;
    downloadEstimatePrintWorkbook(wb, fileName);

    if (skipped.length) {
      alert(`다운로드 완료 (${sheets.length}건).\n주문 없음/실패: ${skipped.join(', ')}`);
    }
  }, [weekNum, selectedGroups, shipments, selectedShip]);

  const toggleWD = d => { const n = new Set(activeWD); n.has(d) ? n.delete(d) : n.add(d); setActiveWD(n); };

  // ── 인쇄 다이얼로그가 열리면, 선택 거래처의 실제 출고일(byDate) 분포를 계산.
  //   인쇄와 동일한 byDate 데이터를 그대로 집계하므로, 다이얼로그에 보이는 요일별
  //   품목수/수량 = 그 요일만 골라 인쇄했을 때의 결과와 정확히 일치한다.
  useEffect(() => {
    if (!showPrintDialog) return;
    let cancelled = false;
    const ships = selectedGroups.size > 0
      ? Array.from(selectedGroups).map(g => shipments.find(s => estimateShipmentGroupId(s) === g)).filter(Boolean)
      : (selectedShip ? [selectedShip] : []);
    const keys = ships.flatMap(s => (s.ShipmentKeys || '').split(',').map(Number).filter(Boolean));
    if (keys.length === 0 && ships.length === 0) {
      setPrintDayInfo({ loading: false, days: [] });
      setPrintDialogItems([]);
      return;
    }
    setPrintDayInfo({ loading: true, days: [] });
    setPrintDialogItems([]);
    (async () => {
      try {
        const legacyResults = await Promise.all(keys.map(k =>
          fetch(`/api/estimate?shipmentKey=${k}&byDate=1`, { credentials: 'same-origin' })
            .then(r => r.json()).then(d => d.success ? (d.items || []) : [])
        ));
        let flatItems = legacyResults.flat();
        if (!isStatementPrintFormat(printOpts.printFormat)) {
          const printResults = await Promise.all(ships.map((ship) => {
            const params = new URLSearchParams({
              custKey: String(ship.CustKey || ''),
              week: String(ship.ParentWeek || weekNum || ''),
              year: yearStr,
              byDate: '1',
              itemsOnly: '1',
              printDetail: '1',
              weekDays: [...activeWD].join(','),
            });
            return fetch(`/api/estimate?${params.toString()}`, { credentials: 'same-origin' })
              .then(r => r.json()).then(d => d.success ? (d.items || []) : []);
          }));
          flatItems = printResults.flat();
        }
        if (cancelled) return;
        setPrintDialogItems(flatItems);
        const map = new Map();
        legacyResults.flat()
          .filter(i => i.EstimateType === '정상출고' && i.outDate)
          .forEach(it => {
            const wd = weekdayKrFromYmd(it.outDate);
            if (!wd) return;
            const cur = map.get(wd) || { wd, count: 0, qty: 0 };
            cur.count += 1; cur.qty += Number(it.Quantity) || 0;
            map.set(wd, cur);
          });
        const days = WEEKDAYS.filter(w => map.has(w)).map(w => map.get(w));
        setPrintDayInfo({ loading: false, days });
        // 출고일이 2개 이상(주광 등)이면 기본 '전체 요일' 대신 첫 출고요일만 선택 — 합산 인쇄 방지
        if (ships.length === 1 && days.length >= 1) {
          setActiveWD(prev => (prev.size === 7 ? new Set([days[0].wd]) : prev));
        }
      } catch (_) {
        if (!cancelled) {
          setPrintDayInfo({ loading: false, days: [] });
          setPrintDialogItems([]);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [showPrintDialog, selectedGroups, selectedShip, shipments, printOpts.printFormat, activeWD, weekNum]);

  // 품목 옵션 (검색 가능 드롭다운용)
  // 매 렌더마다 새 배열/객체를 만들면 품목 점수 캐시가 전부 무효화되어
  // 키 입력마다 전체 카탈로그를 처음부터 다시 계산한다.
  const prodOptions = useMemo(() => products.map(p => ({
    value: String(p.ProdKey),
    label: p.ProdName,
    sub: `${p.CounName} · ${p.FlowerName} · ${p.OutUnit}`,
    ProdKey: p.ProdKey,
    ProdCode: p.ProdCode,
    ProdName: p.ProdName,
    DisplayName: p.DisplayName,
    FlowerName: p.FlowerName,
    CounName: p.CounName,
    UsageCount: p.UsageCount ?? p.orderCount ?? 0,
    RecentUsageCount: p.RecentUsageCount ?? 0,
    MappingCount: p.MappingCount ?? 0,
  })), [products]);

  // 견적 유형 옵션
  const estimateTypeOptions = estimateTypes.length > 0
    ? estimateTypes.map(t => ({ value: t.DetailCode, label: t.Label || t.Descr || t.Descr2 || t.DetailCode }))
    : ESTIMATE_TYPES.map(t => ({ value: t, label: t }));


  const fixModalHasNegative = fixModal?.stage === 'preview' &&
    Object.values(fixModal.allIssues || {}).some(iss => (iss.negative || []).length > 0);
  const fixProgressTotal = Number(fixProgress?.total || 0);
  const fixProgressDone = Number(fixProgress?.done || 0);
  const fixProgressPct = fixProgressTotal > 0
    ? Math.min(100, Math.round((fixProgressDone / fixProgressTotal) * 100))
    : 0;
  const fixProgressRemain = Math.max(fixProgressTotal - fixProgressDone, 0);
  const fixStatusRows = fixStatusModal?.weeks || [];
  const selectedFixStatusRows = selectedFixStatusWeeks.size > 0
    ? fixStatusRows.filter(w => selectedFixStatusWeeks.has(w.OrderWeek))
    : [];
  const fixStatusActionBaseRows = selectedFixStatusRows.length ? selectedFixStatusRows : fixStatusRows;
  const resolveFixCountryFlowersForRows = (rows, selectedCategories) => {
    const partialRows = rows.filter((w) => w.shipmentStatus === 'PARTIAL' || w.status === 'PARTIAL');
    if (!partialRows.length) {
      return resolveCountryFlowerFilter(selectedCategories, fixStatusAvailableCategories);
    }
    const allUnfixed = partialRows.flatMap((w) => parseUnfixedCategoryLabels(w.unfixedCategories));
    const merged = [...new Set([...(selectedCategories || []), ...allUnfixed])];
    return resolveCountryFlowerFilter(merged, fixStatusAvailableCategories);
  };

  const fixStatusTargetRows = fixStatusActionBaseRows
    .filter(w => w.status === 'FIXED' || w.status === 'PARTIAL' || w.status === 'FIXED_PENDING_STOCK');
  const fixStatusFixTargetRows = fixStatusActionBaseRows
    .filter(w => Number(w.detailCount || 0) > 0)
    .filter(w => {
      const ship = w.shipmentStatus || w.status;
      return ship === 'UNFIXED' || ship === 'PARTIAL';
    });
  const fixStatusNegativeCount = fixStatusRows.reduce((sum, w) => sum + (Number(w.negativeCount) || 0), 0);
  const fixStatusExeMisalignedCount = fixStatusRows.filter(w => w.exeAligned === false && w.shipmentStatus === 'FIXED').length;
  const fixStatusBadge = (status) => {
    if (status === 'FIXED') return { text: '확정', bg: '#e8f5e9', color: '#2e7d32' };
    if (status === 'FIXED_PENDING_STOCK') return { text: '출고확정·재고미정합', bg: '#fff3e0', color: '#e65100' };
    if (status === 'PARTIAL') return { text: '부분확정', bg: '#fff8e1', color: '#ef6c00' };
    if (status === 'UNFIXED') return { text: '미확정', bg: '#e3f2fd', color: '#1565c0' };
    return { text: '출고없음', bg: '#f5f5f5', color: '#777' };
  };
  const stockFixBadge = (stockFixStatus) => {
    if (stockFixStatus === 'FIXED') return { text: '마감', bg: '#e8f5e9', color: '#2e7d32' };
    if (stockFixStatus === 'OPEN') return { text: '미마감', bg: '#fff3e0', color: '#e65100' };
    return { text: '-', bg: '#f5f5f5', color: '#777' };
  };

  const unfixSelectedFixStatusWeeks = async (force = false) => {
    const rows = fixStatusTargetRows;
    if (!ensureFixStatusCategorySelection()) return;
    const countryFlowers = getFixStatusCountryFlowers();
    const categoryNote = countryFlowers.length ? `\n\n카테고리: ${countryFlowers.join(', ')}` : '';
    if (!rows.length) {
      alert('확정취소할 차수를 선택하거나, 확정/부분확정 차수가 있어야 합니다.');
      return;
    }
    const ordered = [...rows].sort((a, b) => String(b.WeekKey || b.OrderWeek).localeCompare(String(a.WeekKey || a.OrderWeek)));
    const weekLabels = ordered.map(w => w.OrderWeek);
    if (!force && !confirm(`선택한 ${ordered.length}개 차수를 확정취소할까요?\n\n${weekLabels.join(', ')}\n\n높은 차수부터 낮은 차수 순서로 처리됩니다.${categoryNote}`)) {
      return;
    }

    setRangeUnfixWorking(true);
    setRangeUnfixStatus('선택 차수 확정취소 시작');
    setFixServerLogs([]);
    setFixLogWeeks(weekLabels);
    setFixLogSince(Date.now() - 3000);
    try {
      const errors = [];
      const warnings = [];
      for (const row of ordered) {
        setRangeUnfixStatus(`${row.OrderWeek} 확정취소 중`);
        let data;
        try {
          ({ data } = await postShipmentFix({
            week: row.OrderWeek,
            orderYear: yearStr,
            action: 'unfix',
            ...(countryFlowers.length ? { countryFlowers } : {}),
          }));
        } catch (e) {
          if (e?.name === 'AbortError') {
            errors.push(`${row.OrderWeek}: 요청 시간 초과(${Math.round(FIX_UNFIX_FETCH_TIMEOUT_MS / 60000)}분) — 서버에서 usp_StockCalculation 재고 재계산이 아직 진행 중일 수 있습니다. 잠시 후 확정 현황을 다시 조회하세요.`);
            continue;
          }
          throw e;
        }
        if (!data.success) errors.push(formatFixApiErrorMessage(data, row.OrderWeek));
        else {
          if (data.requiresAllCategoryFix) {
            warnings.push(`${row.OrderWeek}: 재확정 시 미확정 카테고리 전체 확정 필요 (${(data.pendingUnfixedCategories || []).join(', ')})`);
          }
          if (data.stockWarning) warnings.push(`${row.OrderWeek}: 재고 재계산 경고 ${(data.stockErrors?.length || 0) + (data.reconcile?.stockErrors?.length || 0)}건`);
          if (data.parity && !data.parity.exeAligned) {
            warnings.push(`${row.OrderWeek}: exe 정합 미완 — ${(data.parity.warnings || []).slice(0, 2).join('; ')}`);
          }
        }
      }
      setRangeUnfixStatus('확정취소 완료 — 현황 갱신 중');
      if (errors.length) {
        alert(`일부 확정취소 실패\n\n${errors.slice(0, 8).join('\n')}${errors.length > 8 ? `\n외 ${errors.length - 8}건` : ''}`);
      } else {
        alert(`선택 차수 확정취소 완료: ${weekLabels.join(', ')}${warnings.length ? `\n\n참고:\n${warnings.slice(0, 5).join('\n')}` : ''}`);
      }
      setSelectedFixStatusWeeks(new Set());
      await checkFixStatus();
      setIncludeUnfixed(true);
      await load(true, { includeUnfixedOverride: true });
    } catch (e) {
      setRangeUnfixStatus('');
      alert(`선택 차수 확정취소 오류: ${e.message}`);
    } finally {
      setRangeUnfixWorking(false);
      setTimeout(() => setRangeUnfixStatus(''), 1500);
    }
  };

  const fixSelectedFixStatusWeeks = async () => {
    try {
      const rows = fixStatusFixTargetRows;
      if (!ensureFixStatusCategorySelection()) return;
      if (!rows.length) {
        alert('확정할 차수를 선택하거나, 미확정/부분확정 차수가 있어야 합니다.');
        return;
      }
      const partialInSelection = rows.some((w) => w.shipmentStatus === 'PARTIAL' || w.status === 'PARTIAL');
      const countryFlowers = partialInSelection
        ? resolveFixCountryFlowersForRows(rows, fixStatusSelectedCategories)
        : getFixStatusCountryFlowers();
      const ordered = [...rows].sort((a, b) => String(a.WeekKey || a.OrderWeek).localeCompare(String(b.WeekKey || b.OrderWeek)));
      const weekLabels = ordered.map(w => w.OrderWeek).filter(Boolean);
      const progressTitle = `선택 ${weekLabels.length}차수 출고 확정 진행 중`;
      setFixWorking(true);
      setFixServerLogs([]);
      setFixLogWeeks(weekLabels);
      setFixLogSince(Date.now() - 3000);
      setFixProgress({
        phase: 'fixing',
        title: progressTitle,
        currentWeek: '',
        total: weekLabels.length,
        done: 0,
        success: 0,
        failed: 0,
        message: `${weekLabels.join(', ')} — 낮은 차수부터 순서대로 확정합니다.`,
        results: [],
      });
      setFixStatusModal(null);
      await doFixAll(weekLabels, false, countryFlowers, {
        skipProgressInit: true,
        title: progressTitle,
        resultTitle: `선택 ${weekLabels.length}차수 확정 결과`,
      });
    } catch (e) {
      console.error('[fix-status] fix failed', e);
      setFixModal({ stage: 'error', error: e.message });
      setFixWorking(false);
      setFixProgress(null);
      alert(`확정 처리 오류: ${e.message}`);
    }
  };

  const reconcileSelectedFixStatusWeeks = async () => {
    const base = selectedFixStatusRows.length ? selectedFixStatusRows : fixStatusRows.filter(w => w.exeAligned === false && Number(w.detailCount || 0) > 0);
    const rows = base.filter(w => w.status === 'FIXED_PENDING_STOCK' || w.stockFixStatus === 'OPEN' || Number(w.negativeLiveCount || 0) > 0);
    if (!rows.length) {
      alert('재고 정합 복구 대상 차수가 없습니다.\n(출고 확정됐으나 재고 마감 미완·음수재고 차수만 대상)');
      return;
    }
    const weekLabels = [...rows].sort((a, b) => String(a.WeekKey || a.OrderWeek).localeCompare(String(b.WeekKey || b.OrderWeek))).map(w => w.OrderWeek);
    if (!confirm(`${weekLabels.length}개 차수에 대해 차수 전체 재고 재계산(usp_StockCalculation)을 실행할까요?\n\n${weekLabels.join(', ')}\n\n카테고리 부분 확정/취소 후 exe와 어긋난 경우 복구용입니다.`)) {
      return;
    }
    setRangeUnfixWorking(true);
    setRangeUnfixStatus('재고 정합 복구 시작');
    const errors = [];
    try {
      for (const wk of weekLabels) {
        setRangeUnfixStatus(`${wk} 재고 재계산 중`);
        const res = await fetch('/api/shipment/fix-reconcile', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ week: wk, orderYear: yearStr, forceFullWeekRecalc: true }),
        });
        const data = await parseJsonResponse(res).catch(() => ({}));
        if (!data.success) errors.push(`${wk}: ${data.message || data.error || '실패'}`);
      }
      if (errors.length) {
        alert(`일부 복구 실패\n\n${errors.slice(0, 8).join('\n')}`);
      } else {
        alert(`재고 정합 복구 완료: ${weekLabels.join(', ')}`);
      }
      await checkFixStatus();
    } catch (e) {
      alert(`재고 정합 복구 오류: ${e.message}`);
    } finally {
      setRangeUnfixWorking(false);
      setRangeUnfixStatus('');
    }
  };

  return (
    <div className={previewCapture ? 'estimate-page estimate-preview-capture-root' : 'estimate-page'}>
      {/* ── 필터 바 ── */}
      <div className="filter-bar">
        {/* 연도 (별도) */}
        <span className="filter-label">연도</span>
        <input
          className="filter-input"
          style={{ width:60, textAlign:'center', fontWeight:700, background:'#f8f9fa' }}
          value={yearStr}
          onChange={e => setYearStr(e.target.value.replace(/\D/g,'').slice(0,4))}
          onBlur={e => setYearStr(String(Math.max(2024, Math.min(2030, parseInt(e.target.value)||new Date().getFullYear())))) }
          placeholder={getCurrentYearStr()}
        />
        {/* 차수 입력 — 단순 번호 (14, 15…), 세부차수(14-01/02)는 자동 묶음 */}
        <span className="filter-label">차수</span>
        <button type="button" className="btn btn-sm"
          style={{ width:22, height:22, padding:0, fontSize:11 }}
          onClick={weekPrev} title="이전 차수">◀</button>
        <input
          className="filter-input"
          style={{ width:44, textAlign:'center', fontWeight:700 }}
          value={weekNum}
          onChange={e => setWeekNum(e.target.value.replace(/\D/g,'').slice(0,2))}
          onBlur={e => setWeekNum(String(Math.max(1, Math.min(52, parseInt(e.target.value)||1))))}
          placeholder={getCurrentWeekNum()}
        />
        <button type="button" className="btn btn-sm"
          style={{ width:22, height:22, padding:0, fontSize:11 }}
          onClick={weekNext} title="다음 차수">▶</button>

        {/* 업체 검색 드롭다운 */}
        <span className="filter-label">거래처</span>
        <div style={{ position: 'relative' }} ref={custDropRef}>
          <input
            className={`filter-input${custInputMode === 'ko' ? ' ime-ko' : ''}`}
            lang={custInputMode === 'ko' ? 'ko' : 'en'}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="거래처 검색... (↓↑ 이동, Enter 선택)"
            value={custSearch}
            onChange={e => {
              const raw = e.target.value;
              custPickedName.current = null;
              if (e.nativeEvent.isComposing) {
                setCustQwertyBuf('');
                setCustSearch(raw);
              } else if (custInputMode === 'ko' && e.nativeEvent.inputType === 'insertFromPaste') {
                const converted = convertQwertyInputToHangul(raw);
                setCustQwertyBuf(/^[a-zA-Z0-9 ._-]+$/.test(raw) ? raw : '');
                setCustSearch(converted);
              } else {
                setCustQwertyBuf('');
                setCustSearch(raw);
              }
              custNav.reset();
            }}
            onCompositionStart={() => setCustQwertyBuf('')}
            onFocus={e => {
              e.currentTarget.style.imeMode = custInputMode === 'ko' ? 'active' : 'disabled';
              // 이미 고른 업체가 있으면 포커스만으로 목록을 다시 열지 않는다.
              if (custList.length > 0 && !selectedCust) setShowCustDrop(true);
            }}
            onKeyDown={e => {
              if (custInputMode === 'ko' && !e.nativeEvent.isComposing && !e.ctrlKey && !e.altKey && !e.metaKey) {
                const edit = editHangulSearchBuffer({
                  display: custSearch,
                  buffer: custQwertyBuf,
                  key: e.key,
                  selectionStart: e.currentTarget.selectionStart,
                  selectionEnd: e.currentTarget.selectionEnd,
                });
                if (edit.handled) {
                  e.preventDefault();
                  custPickedName.current = null;
                  setCustQwertyBuf(edit.buffer);
                  setCustSearch(edit.display);
                  custNav.reset();
                  return;
                }
              }
              // 목록이 닫힌 상태의 Enter는 첫 항목을 다시 고르면서 선택을 바꿔버린다.
              if (e.key === 'Enter' && !showCustDrop) return;
              custNav.onKeyDown(e);
            }}
            style={{ minWidth: 160, borderColor: selectedCust ? 'var(--blue)' : undefined, imeMode: custInputMode === 'ko' ? 'active' : 'disabled' }}
          />
          {showCustDrop && custList.length > 0 && (
            <div style={{ position:'absolute', top:'100%', left:0, zIndex:200, background:'#fff', border:'2px solid var(--border2)', width:300, maxHeight:200, overflowY:'auto', boxShadow:'2px 2px 6px rgba(0,0,0,0.2)' }}>
              {custList.map((c, i) => (
                <div key={c.CustKey}
                  onClick={() => {
                    pickCustomer(c);
                    custNav.reset();
                  }}
                  style={{ padding:'5px 10px', cursor:'pointer', borderBottom:'1px solid #EEE', fontSize:12,
                    background: custNav.idx === i ? '#C5D9F1' : '#fff' }}
                  onMouseEnter={e => { if (custNav.idx !== i) e.currentTarget.style.background = '#E8F0FF'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = custNav.idx === i ? '#C5D9F1' : '#fff'; }}
                >
                  <div style={{fontWeight:'bold'}}>{c.CustName}</div>
                  <div style={{fontSize:11, color:'var(--text3)'}}>{c.CustArea} · {c.Manager}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        {custSearch && !custPickedName.current && selectedShip && (
          <span style={{ fontSize: 10, color: 'var(--text3)' }}>
            검색어는 선택 전 초안입니다 · 저장 대상: {selectedShip.CustName}
          </span>
        )}
        <button type="button" className="btn btn-sm"
          onClick={() => {
            setCustInputMode(mode => mode === 'ko' ? 'en' : 'ko');
            resetCustomerSearch('');
            setCustList([]);
          }}
          title={custInputMode === 'ko' ? '현재 한글 입력 · 클릭하면 영문/코드 검색' : '현재 영문/코드 입력 · 클릭하면 한글 입력'}>
          {custInputMode === 'ko' ? '한글입력' : '영문입력'}
        </button>
        {selectedCust && (
          <button className="btn btn-sm" onClick={clearCustomerFilter}>✕</button>
        )}

        {/* 출고요일 필터 */}
        <span className="filter-label">출고요일</span>
        {WEEKDAYS.map(d => (
          <span key={d} className={`chip ${activeWD.has(d)?'chip-active':'chip-inactive'}`} onClick={() => toggleWD(d)}>{d}</span>
        ))}

        {/* 자동조회 토글 — 차수 변경 시 자동으로 업체목록 불러오기 */}
        <button type="button" onClick={() => setAutoLoad(v => !v)}
          title={autoLoad ? '자동조회 ON: 차수 변경 시 즉시 조회' : '자동조회 OFF: 조회 버튼 눌러야 조회'}
          style={{
            padding: '3px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer',
            borderRadius: 14, marginLeft: 4,
            border: `1.5px solid ${autoLoad ? '#2e7d32' : '#999'}`,
            background: autoLoad ? '#2e7d32' : '#fff',
            color: autoLoad ? '#fff' : '#666',
          }}>
          {autoLoad ? '⚡자동조회 ON' : '⚡자동조회 OFF'}
        </button>
        <button type="button" onClick={() => setIncludeUnfixed(v => !v)}
          title={includeUnfixed ? '미확정 차수도 견적서에 표시 (검토용)' : '확정된 차수만 표시 (정상)'}
          style={{
            padding: '3px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer',
            borderRadius: 14, marginLeft: 4,
            border: `1.5px solid ${includeUnfixed ? '#c62828' : '#999'}`,
            background: includeUnfixed ? '#ffebee' : '#fff',
            color: includeUnfixed ? '#c62828' : '#666',
          }}>
          {includeUnfixed ? '🔓 미확정 포함' : '🔒 확정만'}
        </button>
        <button type="button" onClick={refreshFixStatusAndEstimate} disabled={fixStatusLoading || fixStatusSyncing || fixWorking || rangeUnfixWorking || !weekNum}
          title={`${weekNum}차 기준 확정/미확정/음수재고 현황 확인 후 확정 또는 구간 확정취소`}
          style={{
            padding: '3px 12px', fontSize: 11, fontWeight: 700, cursor: (fixStatusLoading || fixStatusSyncing) ? 'wait' : 'pointer',
            borderRadius: 14, marginLeft: 4,
            border: '1.5px solid #1565c0', background: (fixStatusLoading || fixStatusSyncing) ? '#90caf9' : '#1565c0', color: '#fff',
          }}>
          {(fixStatusLoading || fixStatusSyncing) ? '⏳ 최신 현황 확인중...' : '🔎 확정 현황 확인'}
        </button>

        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => load(false)}>🔄 조회 / Buscar</button>
          <button className="btn" disabled title="불량/검역 등록 버튼으로 저장하세요">💾 저장 (불량/검역 등록 사용)</button>
          <button className="btn" onClick={handlePrint}>🖨️ 견적서 출력</button>
          <button className="btn" onClick={() => openManagerPrintDialog(ESTIMATE_PRINT_FORMAT.ESTIMATE)}
            title="담당자를 선택해 그 담당자의 업체만 일괄 인쇄 — 나머지 업체도 개별로 추가 가능">
            👤 담당자별 견적서 출력
          </button>
          <button className="btn" onClick={handleStatementPrint}>📋 거래명세표 출력</button>
          <button className="btn" onClick={handleOrderStatementExcel} title="주문등록(ViewOrder) 품목·단위·단가 기준 거래명세표 Excel">📥 주문→거래명세표 Excel</button>
          <button className="btn" onClick={handleEcountExcel} title="nenova.exe GetExcelDetail — 이카운트 견적 업로드용">📤 이카운트 Excel</button>
          <button className="btn" onClick={handleExcel} title="인쇄와 동일한 양식으로 Excel 저장">📊 인쇄·엑셀</button>
          <button className="btn" onClick={() => window.opener ? window.close() : history.back()}>✖️ 닫기 / Cerrar</button>
        </div>
      </div>

      {err      && <div className="banner-err">⚠️ {err}</div>}
      {successMsg && <div className="banner-ok">{successMsg}</div>}

      {/* ── 2분할 ── */}
      <div className="split-panel estimate-split-panel">

        {/* 왼쪽: 출고 목록 */}
        <div className="card estimate-shipment-list" style={{overflow:'hidden', display:'flex', flexDirection:'column'}}>
          <div className="card-header">
            <span className="card-title">■ 출고 목록</span>
            <span style={{fontSize:11, color:'var(--text3)'}}>{shipments.length}건</span>
            <button type="button" onClick={() => setRecentOnly(v => !v)}
              title={recentOnly ? '최근 2개 차수만 표시 중 (클릭하면 전체)' : '전체 차수 표시 중 (클릭하면 최근 2개만)'}
              style={{
                marginLeft: 6,
                padding: '2px 8px', fontSize: 10, fontWeight: 700, cursor: 'pointer',
                borderRadius: 10,
                border: `1.5px solid ${recentOnly ? '#1976d2' : '#999'}`,
                background: recentOnly ? '#e3f2fd' : '#fff',
                color: recentOnly ? '#1976d2' : '#666',
              }}>
              {recentOnly ? '🔽 최근 2개' : '📋 전체'}
            </button>
            {selectedGroups.size > 0 && (
              <span style={{marginLeft:'auto', fontSize:11, fontWeight:700, color:'#2e7d32',
                            padding:'2px 8px', background:'#e8f5e9', borderRadius:10}}>
                ✓ {selectedGroups.size}건 선택됨
              </span>
            )}
          </div>
          <div style={{overflowY:'auto', flex:1}}>
            {loading
              ? <div className="skeleton" style={{height:200, margin:12}}></div>
              : (
                <table className="tbl estimate-ship-list">
                  <thead>
                    <tr>
                      <th style={{ width: 40, minWidth: 40, textAlign: 'center', padding: '6px 4px' }}>
                        <input type="checkbox"
                          style={{ width: 22, height: 22, minWidth: 22, minHeight: 22, cursor: 'pointer', accentColor: 'var(--blue)' }}
                          ref={el => { if (el) el.indeterminate = visibleSelectedCount > 0 && visibleSelectedCount < visibleShipments.length; }}
                          checked={visibleShipments.length > 0 && visibleSelectedCount === visibleShipments.length}
                          onChange={() => {
                            if (visibleSelectedCount === visibleShipments.length) setSelectedGroups(new Set());
                            else setSelectedGroups(new Set(visibleShipments.map(estimateShipmentGroupId)));
                          }}
                          title="전체 선택/해제"/>
                      </th>
                      <th>차수</th><th>거래처</th><th>담당자</th>
                      <th style={{textAlign:'right'}}>총 합계금액 ▼</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const displayShips = sortEstimateShipmentsForList(visibleShipments);
                      if (displayShips.length === 0) {
                        return (
                          <tr>
                            <td colSpan={5} style={{textAlign:'center', padding:32, color:'var(--text3)', lineHeight:1.6}}>
                              {includeUnfixed
                                ? '조회된 출고 목록이 없습니다.'
                                : '확정된 출고 목록이 없습니다. 수정이 필요하면 미확정 포함을 켜고 조회하세요.'}
                              {!includeUnfixed && (
                                <div style={{marginTop:10}}>
                                  <button
                                    type="button"
                                    className="btn btn-sm"
                                    onClick={() => setIncludeUnfixed(true)}
                                    style={{fontWeight:700}}
                                  >
                                    미확정 포함으로 보기
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      }
                      return displayShips.map(s => {
                        const groupId = estimateShipmentGroupId(s);
                        // SubWeeksFix: '17-01:1,17-02:0' → [{wk:'17-01', fix:1}, ...]
                        const subFix = (s.SubWeeksFix || '').split(',').filter(Boolean).map(p => {
                          const [wk, fix] = p.split(':');
                          return { wk, fix: parseInt(fix) || 0 };
                        });
                        const checked = selectedGroups.has(groupId);
                        return (
                          <tr key={groupId}
                            className={selectedId === groupId ? 'selected' : ''}
                            onClick={() => selectShipment(groupId, s.CustKey, s.ShipmentKeys)}
                            style={{cursor:'pointer', background: checked ? '#e3f2fd' : undefined}}
                          >
                            <td style={{ width: 40, minWidth: 40, textAlign: 'center', padding: '6px 4px' }} onClick={e => e.stopPropagation()}>
                              <input type="checkbox"
                                style={{ width: 22, height: 22, minWidth: 22, minHeight: 22, cursor: 'pointer', accentColor: 'var(--blue)' }}
                                checked={checked}
                                onChange={() => {
                                  setSelectedGroups(prev => {
                                    const n = new Set(prev);
                                    if (n.has(groupId)) n.delete(groupId);
                                    else n.add(groupId);
                                    return n;
                                  });
                                }}/>
                            </td>
                            <td style={{fontFamily:'var(--mono)', fontWeight:'bold', fontSize:12}} onClick={e => e.stopPropagation()}>
                              <div style={{cursor:'pointer'}} onClick={() => selectShipment(groupId, s.CustKey, s.ShipmentKeys)}>
                                {s.ParentWeek}
                              </div>
                              {/* 세부차수별 확정 배지 + 확정취소 버튼 */}
                              <div style={{display:'flex', flexDirection:'column', gap:2, marginTop:2}}>
                                {subFix.length === 0 && (
                                  <span style={{fontSize:9, color:'var(--text3)', fontWeight:'normal'}}>(세부 없음)</span>
                                )}
                                {subFix.map(({ wk, fix }) => (
                                  <div key={wk} style={{display:'flex', alignItems:'center', gap:3}}>
                                    <span style={{
                                      fontSize: 10, fontWeight: 600,
                                      padding: '1px 5px', borderRadius: 8,
                                      background: fix ? '#e8f5e9' : '#fff3e0',
                                      color:      fix ? '#2e7d32' : '#e65100',
                                      border: `1px solid ${fix ? '#a5d6a7' : '#ffb74d'}`,
                                    }}>
                                      {fix ? '✓' : '⚠'} {wk}
                                    </span>
                                    {fix === 1 && (
                                      <button
                                        type="button"
                                        title={`${wk} 확정 취소`}
                                        disabled={unfixingWeek === wk}
                                        onClick={(e) => { e.stopPropagation(); unfixOneWeek(wk); }}
                                        style={{
                                          fontSize: 9, padding: '0 4px', height: 16,
                                          border: '1px solid #c62828', background: '#fff',
                                          color: '#c62828', borderRadius: 8, cursor: unfixingWeek === wk ? 'wait' : 'pointer',
                                          fontWeight: 600,
                                        }}
                                      >
                                        {unfixingWeek === wk ? '⏳' : '취소'}
                                      </button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </td>
                            <td style={{fontWeight:500}}>{s.CustName}</td>
                            <td style={{fontSize:11, color:'var(--text2)'}}>{getShipmentManager(s)}</td>
                            <td className="num">{fmt(s.totalAmount)}</td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              )}
          </div>
        </div>

        {/* 오른쪽: 견적서 목록 */}
        <div className="card estimate-item-list" style={{overflow:'hidden', display:'flex', flexDirection:'column'}}>
          <div className="card-header" style={{flexWrap:'wrap', gap:6}}>
            <span className="card-title">■ 견적서 목록</span>
            {selectedShip && <span style={{fontSize:12, color:'var(--blue)', fontWeight:'bold'}}>{selectedShip.CustName}</span>}
            {highlightDeductions && (
              <span style={{
                fontSize: 12, fontWeight: 800, padding: '2px 8px', borderRadius: 12,
                background: '#fef3c7', color: '#92400e', border: '1px solid #f59e0b',
              }}>
                {yearStr}년 {weekNum}차 {selectedCust?.CustName || selectedShip?.CustName || '선택 업체'} 불량차감 {deductionItemCount}건
              </span>
            )}
            {mismatch && mismatch.total > 0 && (
              <button onClick={() => setMismatchModalOpen(true)}
                title={`주문 vs 출고 불일치 ${mismatch.total}건 — 클릭하여 상세 보기`}
                style={{
                  fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 12,
                  background: '#fff3e0', color: '#e65100', border: '1.5px solid #fb8c00',
                  cursor: 'pointer', marginLeft: 4,
                }}>
                ⚠ 불일치 {mismatch.total}건
                {mismatch.shortageCount > 0 && ` (부족 ${mismatch.shortageCount})`}
                {mismatch.overflowCount > 0 && ` (과출고 ${mismatch.overflowCount})`}
              </button>
            )}
            <div style={{marginLeft:'auto', display:'flex', gap:4, alignItems:'center', flexWrap:'wrap'}}>
              {eligibleDeductionItems.length > 0 && (
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={deductionDeleting}
                  onClick={() => setSelectedDeductionKeys((prev) => selectAllEligibleEstimateDeductions(filteredItems, prev))}
                  title="현재 보이는 불량·검역 차감 행만 전체 선택 또는 해제합니다."
                >
                  {selectedDeductionCount === eligibleDeductionItems.length ? '불량·검역 전체 해제' : `불량·검역 전체 선택 (${eligibleDeductionItems.length})`}
                </button>
              )}
              <button
                type="button"
                className="btn btn-sm"
                style={{color:'#b91c1c', borderColor:'#dc2626', fontWeight:700}}
                disabled={deductionDeleting || hasUnsavedEstimateEdits || selectedDeductionCount === 0 || !selectedShip || estimateEditPresence.blocked}
                onClick={handleSelectedDeductionDelete}
                title={hasUnsavedEstimateEdits
                  ? '저장하지 않은 단가·수량·추가 품목을 먼저 저장하거나 취소하세요.'
                  : '선택한 불량·검역 차감 견적만 삭제합니다.'}
              >
                {deductionDeleting ? '선택 차감 삭제 중…' : `선택 차감 삭제 (${selectedDeductionCount})`}
              </button>
              {/* ── 단가 수정 모드 선택 + 적용 버튼 (P3) ── */}
              {(editedCount > 0 || editedQtyCount > 0 || pendingAdds.length > 0) && (
                <button
                  className="btn btn-sm"
                  style={{background:'#6a1b9a', color:'#fff', borderColor:'#4a148c', fontWeight:'bold'}}
                  disabled={costApplying || qtyApplying || deductionDeleting || estimateEditPresence.blocked}
                  onClick={applyAllEdits}
                  title="단가만 바꾸면 확정 상태와 재고를 그대로 두고 저장합니다. 실제 수량 변경이나 추가 품목이 있을 때만 기존 확정취소·저장·재확정 절차를 진행합니다."
                >
                  수정 저장 ({editedCount + editedQtyCount + pendingAdds.length})
                </button>
              )}
              {editedCount > 0 && editedQtyCount === 0 && (
                <>
                  <select
                    value={costMode}
                    onChange={e => setCostMode(e.target.value)}
                    style={{fontSize:11, padding:'3px 6px', borderRadius:4, border:'1px solid #CBD5E0'}}
                    disabled={costApplying || deductionDeleting || estimateEditPresence.blocked}
                    title="수정한 단가를 어떻게 저장할지 선택"
                  >
                    <option value="once">① 1회성 (이 견적서만)</option>
                    <option value="fixed">② 업체 품목 지정단가 함께 저장</option>
                    <option value="weekFav">③ 이 차수 즐겨찾기</option>
                  </select>
                  <button
                    className="btn btn-sm"
                    style={{background:'#2b6cb0', color:'#fff', borderColor:'#1e4e8c', fontWeight:'bold'}}
                    disabled={costApplying || deductionDeleting || estimateEditPresence.blocked}
                    onClick={() => applyCostEdits()}
                    title="확정 상태와 재고를 그대로 두고 단가·금액만 저장합니다. 위에서 선택한 방식으로 저장합니다."
                  >
                    단가 적용하기 ({editedCount})
                  </button>
                  <button
                    className="btn btn-sm"
                    style={{background:'#b45309', color:'#fff', borderColor:'#92400e', fontWeight:'bold'}}
                    disabled={costApplying || deductionDeleting || estimateEditPresence.blocked}
                    onClick={() => applyCostEdits('fixed')}
                    title="해당 품목의 연결된 모든 출고일 단가와 이 업체의 지정단가를 함께 저장합니다. 다른 업체·다른 차수의 출고 저장값은 유지합니다. 지정단가를 참고하는 화면에는 새 가격이 표시될 수 있습니다."
                  >
                    단가 + 업체 지정단가 함께 저장 ({editedCount})
                  </button>
                  <button
                    className="btn btn-sm"
                    disabled={costApplying || deductionDeleting || estimateEditPresence.blocked}
                    onClick={() => setCostEdits({})}
                  >
                    ↩ 수정 취소
                  </button>
                </>
              )}
              {/* 수량 수정 적용 버튼 */}
              {editedQtyCount > 0 && editedCount === 0 && (
                <>
                  <button
                    className="btn btn-sm"
                    style={{background:'#00897b', color:'#fff', borderColor:'#00695c', fontWeight:'bold'}}
                    disabled={qtyApplying || deductionDeleting || estimateEditPresence.blocked}
                    onClick={applyQtyEdits}
                    title="수량 변경분을 ADD/CANCEL 로 자동 분기 적용 (이력 기록됨)"
                  >
                    📦 수량 수정 적용 ({editedQtyCount})
                  </button>
                  <button
                    className="btn btn-sm"
                    disabled={qtyApplying || deductionDeleting || estimateEditPresence.blocked}
                    onClick={() => setQtyEdits({})}
                  >
                    ↩ 수량 취소
                  </button>
                </>
              )}
              {qtyResult && (
                <span style={{fontSize:11, color: qtyResult.failCount > 0 ? '#c62828' : '#2e7d32', fontWeight:700}}>
                  {qtyResult.error ? `❌ ${qtyResult.error}` :
                    `✅ ${qtyResult.okCount}건 적용${qtyResult.failCount > 0 ? ` / ❌ ${qtyResult.failCount}건 실패` : ''}`}
                </span>
              )}
              <button className="btn btn-sm" style={{background:'#006600', color:'#fff', borderColor:'#004400'}}
                onClick={() => openEstimateEntry('legacy')}
                disabled={deductionDeleting || !selectedShip || estimateEditPresence.blocked}
                title="기존 EstimateType을 선택해 nenova.exe 호환 음수 Estimate를 등록합니다.">
                ＋ 불량/검역등록
              </button>
              <button className="btn btn-sm" style={{background:'#166534', color:'#fff', borderColor:'#14532d'}}
                onClick={() => openEstimateEntry('defect')}
                disabled={deductionDeleting || !selectedShip || estimateEditPresence.blocked}
                title="선택한 거래처의 EXE 판매행에 불량차감 Estimate를 등록합니다.">
                ＋ 불량차감등록
              </button>
              <button className="btn btn-sm" style={{background:'#1565c0', color:'#fff', borderColor:'#0d47a1'}}
                onClick={() => openEstimateEntry('sales')}
                disabled={deductionDeleting || !selectedShip || estimateEditPresence.blocked}
                title="선택한 거래처에 판매요청 Estimate를 등록합니다.">
                ＋ 판매요청
              </button>
              <button className="btn btn-sm" style={{background:'#7c3aed',color:'#fff',borderColor:'#6d28d9'}} disabled={deductionDeleting || !selectedShip || estimateEditPresence.blocked} onClick={()=>setShowAdditionalProduct(true)} title="추가 품목을 목록에 담은 뒤 수량/단가와 한 번에 저장합니다.">＋ 추가 품목등록{pendingAdds.length ? ` (${pendingAdds.length})` : ''}</button>
              <button className="btn btn-sm"
                disabled={deductionDeleting || !selectedItemForEdit || itemEditorSaving || estimateEditPresence.blocked}
                onClick={() => openItemEditor(selectedItemForEdit)}
                title="표에서 품목명을 선택한 뒤 상세 정보창에서 수정합니다.">
                ✏️ 품목 정보 수정
              </button>
            </div>
          </div>

          <div style={{padding:'0 10px'}}><ErpEditPresenceBanner presence={estimateEditPresence} onReload={refreshFixStatusAndEstimate} reloadLabel="확정 현황 다시 불러오기" /></div>
          {hasUnsavedEstimateEdits && (
            <div style={{margin:'6px 12px 0', fontSize:12, color:'#9a3412'}}>
              저장하지 않은 단가·수량·추가 품목이 있습니다. 삭제하려면 먼저 수정 저장 또는 각 취소를 완료하세요.
            </div>
          )}
          {deductionSnapshotMissingCount > 0 && (
            <div style={{margin:'6px 12px 0', fontSize:12, color:'#9a3412'}}>
              삭제 확인정보가 없는 차감 행 {deductionSnapshotMissingCount}건은 삭제할 수 없습니다. 다시 조회하세요.
            </div>
          )}

          <OrderRegisterDistributeModal open={showAdditionalProduct} onClose={()=>setShowAdditionalProduct(false)} yearStr={yearStr} weekNum={weekNum} selectedShip={selectedShip} products={products} editBlocked={estimateEditPresence.blocked} editPresence={estimateEditPresence} onQueue={(rows)=>{setPendingAdds(prev=>[...prev,...rows]);setShowAdditionalProduct(false);}} />
          {pendingAdds.length > 0 && (
            <div style={{margin:'8px 12px 0',padding:'8px 10px',borderRadius:8,background:'#f5f3ff',border:'1px solid #ddd6fe',fontSize:12}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <b style={{color:'#5b21b6'}}>담은 추가 품목 {pendingAdds.length}건</b>
                <span style={{color:'#64748b'}}>수량/단가 수정과 함께 [수정 저장]으로 한 번에 반영됩니다.</span>
                <button type="button" className="btn btn-sm" style={{marginLeft:'auto'}} onClick={()=>setPendingAdds([])}>담기 취소</button>
              </div>
              {pendingAdds.map((t,i)=>(
                <div key={`${t.prodKey}-${i}`} style={{marginTop:4,color:'#334155'}}>{t.prodName}: +{t.qty}{t.unit} / {Number(t.cost).toLocaleString()}원</div>
              ))}
            </div>
          )}
          {/* 견적서 테이블 */}
          <div style={{overflowY:'auto', flex:1}}>
            {itemLoading
              ? <div className="skeleton" style={{height:200, margin:12}}></div>
              : (
                <table className="tbl">
                  <thead>
                    <tr>
                      <th style={{width:42, minWidth:42, padding:'4px 2px', textAlign:'center'}}>
                        <label title="현재 보이는 불량·검역 차감 행 전체 선택" style={{display:'inline-flex', alignItems:'center', justifyContent:'center', cursor: deductionDeleting ? 'wait' : 'pointer'}}>
                          <input
                            type="checkbox"
                            aria-label="불량·검역 차감 전체 선택"
                            checked={eligibleDeductionItems.length > 0 && selectedDeductionCount === eligibleDeductionItems.length}
                            ref={el => { if (el) el.indeterminate = selectedDeductionCount > 0 && selectedDeductionCount < eligibleDeductionItems.length; }}
                            onChange={() => setSelectedDeductionKeys((prev) => selectAllEligibleEstimateDeductions(filteredItems, prev))}
                            disabled={deductionDeleting || eligibleDeductionItems.length === 0}
                            style={{width:22, height:22, minWidth:22, minHeight:22, cursor: deductionDeleting ? 'wait' : 'pointer', accentColor:'#b91c1c'}}
                          />
                        </label>
                      </th>
                      <th>품목명</th><th>단위</th><th>출고일자</th>
                      <th style={{textAlign:'right'}}>수량</th>
                      <th style={{textAlign:'right', background:'#E6FFFA'}}>수량 수정</th>
                      <th style={{textAlign:'right'}}>단가</th>
                      <th style={{textAlign:'right', background:'#FFF9E6'}}>단가 수정</th>
                      <th style={{textAlign:'right'}}>공급가액</th>
                      <th style={{textAlign:'right'}}>부가세</th>
                      <th>비고</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.length === 0
                      ? <tr><td colSpan={11} style={{textAlign:'center', padding:32, color:'var(--text3)'}}>
                          {selectedId ? '견적서 데이터 없음' : '거래처를 선택하세요'}
                        </td></tr>
                      : filteredItems.map((item, i) => {
                          const isDed = isEstimateDeductionRow(item);
                          const canDeleteDeduction = isEligibleEstimateDeduction(item);
                          const deductionChecked = canDeleteDeduction && selectedDeductionKeys.has(Number(item.EstimateKey));
                          const highlightDed = highlightDeductions && isDed;
                          const sdk = item.SdetailKey;
                          const qtyEditKey = getQtyEditKey(item);
                          const costEditKey = getItemEditKey(item);
                          const editVal = costEditKey ? (costEdits[costEditKey] ?? '') : '';
                          const isEdited = editVal !== '' && !isNaN(parseFloat(editVal)) && parseFloat(editVal) !== item.Cost;
                          return (
                          <tr key={i} data-estimate-deduction={isDed ? '1' : undefined} style={{background: isEdited ? '#E6F7FF' : (highlightDed ? '#FDE68A' : (isDed ? '#FFF8DC' : ''))}}>
                            <td style={{padding:'2px', textAlign:'center'}}>
                              {canDeleteDeduction ? (
                                <label title="이 불량·검역 차감만 삭제 대상으로 선택" style={{display:'inline-flex', alignItems:'center', justifyContent:'center', cursor: deductionDeleting ? 'wait' : 'pointer'}}>
                                  <input
                                    type="checkbox"
                                    aria-label={`${item.ProdName || '품목'} 차감 삭제 선택`}
                                    checked={deductionChecked}
                                    disabled={deductionDeleting}
                                    onChange={(event) => setSelectedDeductionKeys((prev) => toggleEstimateDeductionSelection(prev, item.EstimateKey, event.target.checked))}
                                    style={{width:22, height:22, minWidth:22, minHeight:22, cursor: deductionDeleting ? 'wait' : 'pointer', accentColor:'#b91c1c'}}
                                  />
                                </label>
                              ) : <span title={isDed ? '불량·검역 차감 삭제 대상이 아니거나 삭제 확인정보가 없습니다.' : '정상출고는 삭제 대상이 아닙니다.'} style={{color:'var(--text3)'}}>—</span>}
                            </td>
                            <td style={{fontSize:12, fontWeight:500, color: isDed ? '#A0522D' : ''}}>
                              {isDed && <span style={{fontSize:10, color:'#B8860B', marginRight:3}}>
                                [{mapEstimateType(item.EstimateType)}]
                              </span>}
                              <button
                                type="button"
                                onClick={() => openItemEditor(item)}
                                style={{
                                  border: '0', background: 'transparent', padding: 0,
                                  cursor: 'pointer', textAlign: 'left',
                                  color: isDed ? '#A0522D' : 'var(--blue)',
                                  textDecoration: 'underline', fontWeight: 600,
                                }}
                                title="품목 정보를 열어 수정"
                              >{item.ProdName}</button>
                            </td>
                            <td style={{fontSize:12}}>{item.Unit}</td>
                            <td style={{fontFamily:'var(--mono)', fontSize:12}}>{fmtDate(item.outDate)}</td>
                            <td className="num" style={{color: isDed ? '#C0392B' : ''}}>{fmt(item.Quantity)}</td>
                            <td style={{textAlign:'right', padding:'2px 4px', background:'#F0FFFE'}}>
                              {!qtyEditKey ? (
                                <span style={{fontSize:10, color:'var(--text3)'}}>—</span>
                              ) : (
                                <input
                                  type="number"
                                  data-estimate-edit-cell="1"
                                  data-estimate-edit-row={i}
                                  data-estimate-edit-column="quantity"
                                  value={qtyEditKey ? (qtyEdits[qtyEditKey] ?? '') : ''}
                                  onKeyDown={handleEstimateEditCellKeyDown}
                                  onChange={e => {
                                    const v = e.target.value;
                                    setQtyEdits(prev => {
                                      const next = { ...prev };
                                      if (v === '') delete next[qtyEditKey];
                                      else next[qtyEditKey] = v;
                                      return next;
                                    });
                                  }}
                                  placeholder={isDed ? fmt(Math.abs(Number(item.Quantity || 0))) : fmt(item.Quantity)}
                                  style={{
                                    width: 70,
                                    padding: '2px 5px',
                                    textAlign: 'right',
                                    fontSize: 12,
                                    border: (qtyEditKey && qtyEdits[qtyEditKey] !== undefined && qtyEdits[qtyEditKey] !== '') ? '2px solid #00897b' : '1px solid #CBD5E0',
                                    borderRadius: 3,
                                    fontFamily: 'var(--mono)',
                                    background: (qtyEditKey && qtyEdits[qtyEditKey] !== undefined && qtyEdits[qtyEditKey] !== '') ? '#E0F2F1' : '#fff',
                                  }}
                                  disabled={deductionDeleting || qtyApplying || !qtyEditKey}
                                  title={isDed ? '차감 수량 수정: Estimate.Quantity' : '출고일별 견적수량 수정: ShipmentDate.EstQuantity'}
                                />
                              )}
                            </td>
                            <td className="num">{fmt(item.Cost)}</td>
                            <td style={{textAlign:'right', padding:'2px 4px', background:'#FFFDF5'}}>
                              {!costEditKey ? (
                                <span style={{fontSize:10, color:'var(--text3)'}}>—</span>
                              ) : (
                                <input
                                  type="number"
                                  data-estimate-edit-cell="1"
                                  data-estimate-edit-row={i}
                                  data-estimate-edit-column="cost"
                                  value={editVal}
                                  onKeyDown={handleEstimateEditCellKeyDown}
                                  onChange={e => {
                                    const v = e.target.value;
                                    setCostEdits(prev => {
                                      const next = { ...prev };
                                      if (v === '') delete next[costEditKey];
                                      else next[costEditKey] = v;
                                      return next;
                                    });
                                  }}
                                  placeholder={fmt(item.Cost)}
                                  style={{
                                    width: 80,
                                    padding: '2px 5px',
                                    textAlign: 'right',
                                    fontSize: 12,
                                    border: isEdited ? '2px solid #2b6cb0' : '1px solid #CBD5E0',
                                    borderRadius: 3,
                                    fontFamily: 'var(--mono)',
                                    background: isEdited ? '#EBF8FF' : '#fff',
                                  }}
                                  disabled={deductionDeleting || costApplying || !costEditKey}
                                />
                              )}
                            </td>
                            <td className="num" style={{color: isDed ? '#C0392B' : 'var(--blue)', fontWeight:'bold'}}>{fmt(item.Amount)}</td>
                            <td className="num" style={{color: isDed ? '#C0392B' : 'var(--text3)'}}>{fmt(item.Vat)}</td>
                            <td style={{fontSize:11, color:'var(--text3)'}}>{sanitizeEstimateDescrForDisplay(item, {
                              showDistribDesc: printOpts.showDistribDesc === true,
                              showDeductionOutDay: printOpts.showDeductionOutDay === true,
                            })}</td>
                          </tr>
                          );
                        })}
                  </tbody>
                  <tfoot>
                    <tr style={{background:'var(--bg2)'}}>
                      <td colSpan={4} style={{fontWeight:'bold', padding:'3px 6px', fontSize:12}}>합계</td>
                      <td className="num" style={{fontWeight:'bold'}}>{fmt(totalQty)}</td>
                      <td></td>
                      <td className="num" style={{fontWeight:'bold', color:'var(--text3)'}}>{fmt(totalCost)}</td>
                      <td></td>
                      <td className="num" style={{fontWeight:'bold', color:'var(--blue)'}}>{fmt(totalSupply)}</td>
                      <td className="num" style={{fontWeight:'bold'}}>{fmt(totalVat)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              )}
          </div>

          {/* WeekDay 필터 바 */}
          <div style={{padding:'5px 10px', borderTop:'1px solid var(--border)', display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', background:'var(--bg)'}}>
            <span style={{fontSize:11, color:'var(--text3)'}}>출고요일 필터:</span>
            {WEEKDAYS.map(d => (
              <span key={d} className={`chip ${activeWD.has(d)?'chip-active':'chip-inactive'}`} onClick={() => toggleWD(d)}>{d}</span>
            ))}
            {activeWD.size < 7 && (
              <button className="btn btn-sm" style={{height:20, fontSize:10}} onClick={() => setActiveWD(new Set(['월','화','수','목','금','토','일']))}>전체선택</button>
            )}
            <span style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 4px' }} />
            <span style={{fontSize:11, color:'var(--text3)'}}>비고 표시:</span>
            <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="checkbox"
                checked={printOpts.showDeductionOutDay === true}
                onChange={e => setPrintOpts(o => ({ ...o, showDeductionOutDay: e.target.checked }))}
              />
              출고일(N일)
            </label>
            <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="checkbox"
                checked={printOpts.showDistribDesc === true}
                onChange={e => setPrintOpts(o => ({ ...o, showDistribDesc: e.target.checked }))}
              />
              차수별 수량
            </label>
            <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="checkbox"
                checked={printOpts.showDeductionDescr === true}
                onChange={e => setPrintOpts(o => ({ ...o, showDeductionDescr: e.target.checked }))}
              />
              불량차감 적요
            </label>
          </div>
        </div>
      </div>

      {/* ── 단가 적용 로딩/결과 모달 (P3) ── */}
      {(costApplying || costResult) && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                {costApplying && !costResult ? `🔄 ${editApplyTitle} 중...` : (costResult?.success ? `✅ ${costResult.refreshRequired ? '저장 완료 · 다시 조회 필요' : `${editApplyTitle} 완료`}` : '❌ 오류')}
              </span>
              {!costApplying || costResult ? (
                <button className="btn btn-sm" onClick={closeCostModal}>✕</button>
              ) : null}
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ padding: '8px 12px', background: '#F7FAFC', borderRadius: 6, fontSize: 12 }}>
                <strong>진행 로그</strong>
                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 260, overflowY: 'auto' }}>
                  {costApplyLog.map((l, i) => (
                    <div key={i} style={{
                      padding: '4px 8px',
                      background: l.step === 'error' ? '#FED7D7' : (l.step === 'done' ? '#C6F6D5' : '#fff'),
                      borderRadius: 3,
                      borderLeft: l.step === 'error' ? '3px solid #c53030' : (l.step === 'done' ? '3px solid #2f855a' : '3px solid #4299e1'),
                      fontFamily: 'var(--mono)',
                      fontSize: 11,
                    }}>
                      {l.label}
                    </div>
                  ))}
                  {costApplying && !costResult && (
                    <div style={{ padding: '4px 8px', color: '#718096', fontSize: 11 }}>
                      <span className="spinner" style={{ display:'inline-block', width:10, height:10, border:'2px solid #4299e1', borderTopColor:'transparent', borderRadius:'50%', animation:'spin 1s linear infinite', marginRight:6 }} />
                      처리 중 — 이 창을 닫지 마세요
                    </div>
                  )}
                </div>
              </div>

              {automaticEditProgress && (
                <div style={{ padding: '8px 12px', background: '#FFFAF0', border: '1px solid #F6AD55', borderRadius: 6, fontSize: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <strong>수량 저장 진행</strong>
                    <span style={{ fontFamily: 'var(--mono)', color: '#744210' }}>경과 {formatEstimateEditElapsed(automaticEditProgress, automaticEditProgress.lastProgressTickAt || Date.now())}</span>
                  </div>
                  <div style={{ marginTop: 4, color: '#744210' }}>
                    대상: {automaticEditProgress.orderYear}년 {automaticEditProgress.weeks.join(', ') || '-'}
                  </div>
                  <div style={{ marginTop: 6, maxHeight: 150, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {automaticEditProgress.stages.map((stage, index) => (
                      <div key={`${stage.at}-${index}`} style={{
                        padding: '4px 7px', borderRadius: 3, fontSize: 11,
                        background: stage.status === 'error' ? '#FED7D7' : (stage.status === 'done' ? '#C6F6D5' : '#fff'),
                        borderLeft: stage.status === 'error' ? '3px solid #c53030' : (stage.status === 'done' ? '3px solid #2f855a' : '3px solid #d69e2e'),
                      }}>
                        {stage.label}
                      </div>
                    ))}
                  </div>
                  {automaticEditProgress.pollServerLogs ? (
                    <details style={{ marginTop: 8 }}>
                      <summary style={{ cursor: 'pointer', fontWeight: 700 }}>개발용 서버 참고 기록 {automaticEditProgress.serverLogs.length}건</summary>
                      <div style={{ marginTop: 5, maxHeight: 130, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {automaticEditProgress.serverLogs.length === 0 ? (
                          <div style={{ color: '#718096', fontSize: 11 }}>아직 일치하는 서버 로그가 없습니다.</div>
                        ) : automaticEditProgress.serverLogs.map((log, index) => (
                          <div key={`${log.CreateDtm}-${log.Step}-${index}`} style={{ fontFamily: 'var(--mono)', fontSize: 10, color: log.IsError ? '#c53030' : '#4A5568' }}>
                            [{log.correlation === 'user-match' ? '사용자 일치' : '같은차수 참고기록'}] [{log.CreateDtm}] {log.Step} — {log.Detail}
                          </div>
                        ))}
                      </div>
                      <div style={{ marginTop: 5, color: '#718096', fontSize: 10 }}>
                        사용자 ID가 없는 기록은 같은 차수의 참고 정보입니다.
                      </div>
                    </details>
                  ) : (
                    <div style={{ marginTop: 8, padding: '5px 7px', background: '#FFF', borderRadius: 3, color: '#744210', fontSize: 11 }}>
                      {formatEstimateEditNotice(automaticEditProgress)}
                    </div>
                  )}
                  {automaticEditProgress.pollServerLogs && automaticEditProgress.pollError && (
                    <div style={{ marginTop: 6, color: '#c53030', fontSize: 11 }}>
                      서버 로그 조회 실패: {automaticEditProgress.pollError}{automaticEditProgress.running ? ` · ${nextEstimateEditPollDelay(automaticEditProgress.pollFailures) / 1000}초 후 재시도` : ' · 기존 로그는 유지했습니다.'}
                    </div>
                  )}
                </div>
              )}

              {costResult && costResult.success && (
                <div style={{ padding: 12, background: '#F0FFF4', border: '1px solid #9AE6B4', borderRadius: 6, fontSize: 12 }}>
                  <div><strong>수정된 품목:</strong> {costResult.changedCount}건</div>
                  {costResult.type !== 'quantity' && (
                    <div><strong>공급가 변동:</strong> {costResult.totalDiff >= 0 ? '+' : ''}{(costResult.totalDiff || 0).toLocaleString()}원</div>
                  )}
                  <div style={{ marginTop: 6, color: '#2f855a' }}>
                    {costResult.refreshRequired
                      ? '저장은 완료됐지만 재조회에 실패했습니다. 다시 조회해 결과를 확인하세요.'
                      : `견적서가 재로딩되었습니다. 새 ${costResult.type === 'quantity' ? '수량' : '단가'}가 반영된 것을 확인하세요.`}
                  </div>
                </div>
              )}

              {costResult && !costResult.success && (
                <div style={{ padding: 12, background: '#FFF5F5', border: '1px solid #FEB2B2', borderRadius: 6, fontSize: 12, color: '#c53030' }}>
                  <strong>오류:</strong> {costResult.error}
                  <div style={{ marginTop: 4, fontSize: 11 }}>
                    작업이 중단되었습니다. 진행 로그에서 멈춘 차수와 단계를 확인하세요.
                  </div>
                </div>
              )}

              {(costResult || !costApplying) && (
                <button className="btn" onClick={closeCostModal} style={{ marginTop: 4 }}>
                  닫기
                </button>
              )}
            </div>
          </div>
          <style jsx>{`
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      )}

      {/* ── 담당자별 견적서 출력 ── */}
      {showManagerPrintDialog && (
        <EstimateModalPortal onBackdropClick={() => setShowManagerPrintDialog(false)}>
          <div className="modal" style={{ maxWidth: 640, width: '92vw', display: 'flex', flexDirection: 'column', maxHeight: '88vh' }}
            onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                👤 담당자별 견적서 출력
                <span style={{ fontSize: 11, fontWeight: 'normal', color: 'var(--text3)', marginLeft: 8 }}>
                  {weekNum}차 분배가 있는 업체 {managerPrintGroups.reduce((n, g) => n + g.customers.length, 0)}곳
                </span>
              </span>
              <button className="btn btn-sm" onClick={() => setShowManagerPrintDialog(false)}>✕</button>
            </div>

            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 10, overflow: 'hidden' }}>
              <div style={{ fontSize: 11, color: 'var(--text2)', background: '#f1f8e9', border: '1px solid #c5e1a5',
                            borderRadius: 6, padding: '6px 10px', lineHeight: 1.5 }}>
                담당자를 누르면 그 담당자의 업체가 모두 선택됩니다. 다른 담당자의 업체도 체크하면 함께 인쇄됩니다.
              </div>

              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  value={managerPrintQuery}
                  onChange={e => setManagerPrintQuery(e.target.value)}
                  placeholder="담당자 또는 거래처 검색"
                  style={{ flex: '1 1 180px', minWidth: 140, padding: '5px 8px', fontSize: 12,
                           border: '1px solid #ccc', borderRadius: 4 }}
                />
                <button type="button" className="btn btn-sm"
                  onClick={() => setManagerPrintSel(new Set(managerPrintVisibleGroups.flatMap(g => g.groupIds)))}>
                  전체 선택
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setManagerPrintSel(new Set())}>
                  전체 해제
                </button>
              </div>

              <div style={{ overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
                {managerPrintVisibleGroups.length === 0 ? (
                  <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: 'var(--text3)' }}>
                    {managerPrintGroups.length === 0
                      ? '이 차수에 분배가 있는 업체가 없습니다.'
                      : '검색 결과가 없습니다.'}
                  </div>
                ) : managerPrintVisibleGroups.map(group => {
                  const state = managerSelectionState(group, managerPrintSel);
                  return (
                    <div key={group.manager} style={{ borderBottom: '1px solid var(--border)' }}>
                      <button type="button"
                        onClick={() => setManagerPrintSel(sel => toggleManagerSelection(sel, group))}
                        title={state === 'all' ? '이 담당자 전체 해제' : '이 담당자 업체 전체 선택'}
                        style={{
                          width: '100%', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
                          padding: '7px 10px', cursor: 'pointer', border: 'none',
                          borderLeft: `4px solid ${state === 'all' ? '#2e7d32' : state === 'partial' ? '#f9a825' : 'transparent'}`,
                          background: state === 'none' ? '#fafafa' : state === 'all' ? '#e8f5e9' : '#fffde7',
                          fontSize: 12, fontWeight: 700,
                        }}>
                        <span style={{ width: 14, color: state === 'none' ? '#bbb' : '#2e7d32' }}>
                          {state === 'all' ? '☑' : state === 'partial' ? '◪' : '☐'}
                        </span>
                        <span>{group.manager}</span>
                        <span style={{ fontWeight: 'normal', color: 'var(--text3)' }}>
                          업체 {group.customers.length}곳 · {fmt(group.totalAmount)}
                        </span>
                      </button>

                      <div>
                        {group.customers.map(c => {
                          const on = managerPrintSel.has(c.groupId);
                          return (
                            <label key={c.groupId}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px 4px 30px',
                                cursor: 'pointer', fontSize: 12,
                                background: on ? '#f1f8e9' : 'transparent',
                              }}>
                              <input type="checkbox" checked={on}
                                onChange={() => setManagerPrintSel(sel => toggleCustomerSelection(sel, c.groupId))} />
                              <span style={{ flex: 1 }}>{c.custName}</span>
                              <span style={{ fontSize: 10, color: 'var(--text3)' }}>{c.parentWeek}차</span>
                              <span className="num" style={{ minWidth: 90, textAlign: 'right', color: 'var(--text2)' }}>
                                {fmt(c.totalAmount)}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="modal-footer" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 12, color: 'var(--text2)', flex: 1 }}>
                {managerPrintSummary.customerCount === 0 ? '선택된 업체가 없습니다.' : (
                  <>
                    담당자 {managerPrintSummary.managerCount}명 · 업체{' '}
                    <b style={{ color: '#2e7d32' }}>{managerPrintSummary.customerCount}곳</b> ·{' '}
                    {fmt(managerPrintSummary.totalAmount)}
                  </>
                )}
              </span>
              <button type="button" className="btn btn-sm" onClick={() => setShowManagerPrintDialog(false)}>취소</button>
              <button type="button" className="btn btn-primary btn-sm"
                disabled={managerPrintSummary.customerCount === 0}
                onClick={confirmManagerPrint}>
                🖨️ 인쇄 ({managerPrintSummary.customerCount}곳)
              </button>
            </div>
          </div>
        </EstimateModalPortal>
      )}

      {/* ── 견적서 출력 다이얼로그 ── */}
      {showPrintDialog && (
        <div className="modal-overlay" onClick={() => setShowPrintDialog(false)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                🖨️ {getPrintFormatDocTitle(printOpts.printFormat)} 출력 옵션
                {selectedGroups.size > 0 && (
                  <span style={{ fontSize:11, fontWeight:700, color:'#fff', background:'#2e7d32',
                                 padding:'2px 8px', borderRadius:10, marginLeft:8 }}>
                    {selectedGroups.size}건 일괄 인쇄
                  </span>
                )}
              </span>
              <button className="btn btn-sm" onClick={() => setShowPrintDialog(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

              {/* 출고요일 선택 — 실제 출고일(byDate) 분포 기준. 인쇄와 동일 데이터라 여기 수치=인쇄 결과 */}
              <div className="form-group" style={{ background:'#f1f8e9', border:'1px solid #c5e1a5', borderRadius:6, padding:'8px 12px' }}>
                <label className="form-label" style={{ display:'flex', alignItems:'center', gap:6 }}>
                  출고요일 선택
                  <span style={{ fontSize:10, fontWeight:'normal', color:'var(--text3)' }}>(이 거래처 실제 출고일 기준 — 선택한 요일만 인쇄)</span>
                </label>
                {printDayInfo.loading ? (
                  <div style={{ fontSize:11, color:'var(--text3)' }}>출고일 분포 불러오는 중…</div>
                ) : printDayInfo.days.length === 0 ? (
                  <div style={{ fontSize:11, color:'var(--text3)' }}>출고일 정보가 없습니다.</div>
                ) : (
                  <>
                    <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginTop:4 }}>
                      {printDayInfo.days.map(d => {
                        const on = activeWD.has(d.wd);
                        return (
                          <button key={d.wd} type="button"
                            onClick={() => setActiveWD(new Set([d.wd]))}
                            title="이 출고요일만 인쇄"
                            style={{
                              padding:'4px 10px', fontSize:12, fontWeight:700, cursor:'pointer', borderRadius:14,
                              border:`1.5px solid ${on ? '#2e7d32' : '#bbb'}`,
                              background: on ? '#2e7d32' : '#fff', color: on ? '#fff' : '#666',
                            }}>
                            {d.wd} · {d.count}품목 · {d.qty.toLocaleString()}
                          </button>
                        );
                      })}
                      <button type="button" onClick={() => setActiveWD(new Set(WEEKDAYS))}
                        title="모든 출고요일 인쇄"
                        style={{
                          padding:'4px 10px', fontSize:12, fontWeight:700, cursor:'pointer', borderRadius:14,
                          border:`1.5px solid ${activeWD.size === 7 ? '#1565c0' : '#bbb'}`,
                          background: activeWD.size === 7 ? '#1565c0' : '#fff', color: activeWD.size === 7 ? '#fff' : '#666',
                        }}>
                        전체 출고일
                      </button>
                    </div>
                    {(() => {
                      const sel = printDayInfo.days.filter(d => activeWD.size === 7 || activeWD.has(d.wd));
                      const cnt = sel.reduce((s, d) => s + d.count, 0);
                      const qty = sel.reduce((s, d) => s + d.qty, 0);
                      const isAll = activeWD.size === 7;
                      const dedNote = printOpts.outType === 'total' && printPreviewDedCount > 0
                        ? ` · 차감 ${printPreviewDedCount}건 포함`
                        : (printOpts.outType === 'select' ? ' · 차감 제외(선출고)' : '');
                      return (
                        <div style={{ fontSize:11, marginTop:6, color: isAll ? '#c62828' : '#2e7d32', fontWeight:600 }}>
                          {isAll
                            ? `⚠ 전체 출고일 인쇄 (${cnt}품목 · ${qty.toLocaleString()}${dedNote}) — 특정 요일만 인쇄하려면 위 요일을 클릭`
                            : `✔ 인쇄 대상: ${sel.map(d => d.wd).join('·')}요일 (${cnt}품목 · ${qty.toLocaleString()}${dedNote})`}
                        </div>
                      );
                    })()}
                  </>
                )}
              </div>

              {/* 인쇄 양식 */}
              <div className="form-group">
                <label className="form-label">인쇄 양식</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    [ESTIMATE_PRINT_FORMAT.ESTIMATE, '견적서 (기존) — 분배단가=부가세 포함'],
                    [ESTIMATE_PRINT_FORMAT.SUPPLY, '부가세 미분류 견적서 — 분배단가=공급가액'],
                    [ESTIMATE_PRINT_FORMAT.STATEMENT, '거래명세표 (원산지·단위·수량·금액·세액 10%)'],
                  ].map(([v, l]) => (
                    <label key={v} style={{ display: 'flex', alignItems: 'flex-start', gap: 5, cursor: 'pointer', fontSize: 12 }}>
                      <input type="radio" name="printFormat" value={v}
                        checked={printOpts.printFormat === v}
                        onChange={() => setPrintOpts(o => ({ ...o, printFormat: v }))}
                        style={{ marginTop: 2 }}
                      />
                      <span>{l}</span>
                    </label>
                  ))}
                </div>
                {isStatementPrintFormat(printOpts.printFormat) ? (
                  <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 6, lineHeight: 1.45 }}>
                    거래명세표 품목 열: hydrangea·rose / 등 꽃 종류명은 제외하고 품종명만 표시됩니다.
                  </div>
                ) : isSupplyPrintFormat(printOpts.printFormat) ? (
                  <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 6, lineHeight: 1.45 }}>
                    분배단가를 공급가액으로 그대로 출력합니다. 부가세는 공급가의 10%로 다시 계산하며, 저장된 부가세포함 분리는 쓰지 않습니다. 인쇄와 Excel이 같습니다.
                  </div>
                ) : (
                  <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 6, lineHeight: 1.45 }}>
                    견적서 양식은 품목명을 DB 그대로 출력합니다. 품종명만 필요하면 「거래명세표」를 선택하세요.
                  </div>
                )}
              </div>

              {/* 출력일자 (= 일련번호 기준) */}
              <div className="form-group">
                <label className="form-label">출력일자 (일련번호 기준)</label>
                <input type="date" className="form-control"
                  value={printOpts.printDate}
                  onChange={e => setPrintOpts(o => ({ ...o, printDate: e.target.value }))}
                />
              </div>

              {/* 일련번호 직접 입력 (선택) */}
              <div className="form-group">
                <label className="form-label">일련번호 <span style={{ color: 'var(--text3)', fontWeight: 'normal' }}>(비워두면 자동생성)</span></label>
                <input className="form-control"
                  value={printOpts.serialNo}
                  onChange={e => setPrintOpts(o => ({ ...o, serialNo: e.target.value }))}
                  placeholder="예: 2026-04-001"
                />
              </div>

              {/* 출고구분 */}
              <div className="form-group">
                <label className="form-label">출고 구분</label>
                <div style={{ display: 'flex', gap: 12 }}>
                  {[['total', '종합출고 (전체)'], ['select', '선출고 (정상출고만)']].map(([v, l]) => (
                    <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 12 }}>
                      <input type="radio" name="outType" value={v}
                        checked={printOpts.outType === v}
                        onChange={() => setPrintOpts(o => ({ ...o, outType: v }))}
                      />
                      {l}
                    </label>
                  ))}
                </div>
              </div>

              {/* 분할 선택 */}
              <div className="form-group">
                <label className="form-label">출력 방식</label>
                <div style={{ display: 'flex', gap: 12 }}>
                  {[['combined', '품목 일괄 출력 (1장)'], ['split', '품목별 분할 출력 (꽃종류별)']].map(([v, l]) => (
                    <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 12 }}>
                      <input type="radio" name="splitMode" value={v}
                        checked={printOpts.splitMode === v}
                        onChange={() => setPrintOpts(o => ({ ...o, splitMode: v }))}
                      />
                      {l}
                    </label>
                  ))}
                </div>
                {printOpts.splitMode === 'split' && (
                  <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>
                    국가/꽃명/품명을 기준으로 장미, 수국, 알스트로, 카네이션, 네덜란드 등을 분리 출력합니다.
                  </div>
                )}
              </div>

              {/* 표시 항목 */}
              <div className="form-group">
                <label className="form-label">표시 항목</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7, fontSize: 12 }}>
                  {isStatementPrintFormat(printOpts.printFormat) && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                      <input type="checkbox"
                        checked={printOpts.showBoxQty !== false}
                        onChange={e => setPrintOpts(o => ({ ...o, showBoxQty: e.target.checked }))}
                      />
                      박스수량 표시
                    </label>
                  )}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input type="checkbox"
                      checked={printOpts.showDistribDesc === true}
                      onChange={e => setPrintOpts(o => ({ ...o, showDistribDesc: e.target.checked }))}
                    />
                    적요에 차수별 수량 표시 <span style={{ color: 'var(--text3)' }}>(정상출고)</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input type="checkbox"
                      checked={printOpts.showDeductionOutDay === true}
                      onChange={e => setPrintOpts(o => ({ ...o, showDeductionOutDay: e.target.checked }))}
                    />
                    적요에 출고일(N일) 표시 <span style={{ color: 'var(--text3)' }}>(차감·비고 없을 때)</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input type="checkbox"
                      checked={printOpts.showDeductionDescr === true}
                      onChange={e => setPrintOpts(o => ({ ...o, showDeductionDescr: e.target.checked }))}
                    />
                    불량차감 적요 표시 <span style={{ color: 'var(--text3)' }}>(기본 미표시)</span>
                  </label>
                </div>
              </div>

              {/* 미리보기 요약 — 인쇄와 동일 byDate 데이터 + 출고구분(outType) 반영 */}
              <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '8px 12px', fontSize: 11, color: 'var(--text2)' }}>
                {printDayInfo.loading ? (
                  <div>미리보기 계산 중…</div>
                ) : selectedGroups.size > 0 ? (
                  <>
                    <div>선택 거래처: <b>{selectedGroups.size}건</b></div>
                    <div>양식: <b>{getPrintFormatDocTitle(printOpts.printFormat)}</b></div>
                    <div>출고 구분: <b>{printOpts.outType === 'select' ? '선출고 (정상출고만)' : '종합출고 (전체)'}</b></div>
                    <div>인쇄 항목: <b>{printPreviewItems.length}건</b>
                      {printOpts.outType === 'total' && printPreviewDedCount > 0 && (
                        <span style={{ color: '#A0522D' }}> (정상 {printPreviewShipCount} + 차감 {printPreviewDedCount})</span>
                      )}
                    </div>
                    <div>합계: <b>₩{(printPreviewSupply + printPreviewVat).toLocaleString()}</b>
                      {' '}(공급가 ₩{printPreviewSupply.toLocaleString()} + 세액 ₩{printPreviewVat.toLocaleString()})
                      {printPreviewTotals.approximate && (
                        <span style={{ color: 'var(--text3)' }}>
                          {isSupplyPrintFormat(printOpts.printFormat)
                            ? ' · 부가세 미분류는 분배단가×수량, 세액 10%'
                            : ' · 거래명세표 합계는 인쇄 시 품목 합산 후 재계산'}
                        </span>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <div>거래처: <b>{selectedShip?.CustName || '-'}</b></div>
                    <div>차수: <b>{weekNum || '-'}</b></div>
                    <div>양식: <b>{getPrintFormatDocTitle(printOpts.printFormat)}</b></div>
                    <div>출고 구분: <b>{printOpts.outType === 'select' ? '선출고 (정상출고만)' : '종합출고 (전체)'}</b></div>
                    <div>인쇄 항목: <b>{printPreviewItems.length}건</b>
                      {printOpts.outType === 'total' && printPreviewDedCount > 0 && (
                        <span style={{ color: '#A0522D' }}> (정상 {printPreviewShipCount} + 차감 {printPreviewDedCount})</span>
                      )}
                    </div>
                    <div>합계: <b>₩{(printPreviewSupply + printPreviewVat).toLocaleString()}</b>
                      {' '}(공급가 ₩{printPreviewSupply.toLocaleString()} + 세액 ₩{printPreviewVat.toLocaleString()})
                      {printPreviewTotals.approximate && (
                        <span style={{ color: 'var(--text3)' }}>
                          {isSupplyPrintFormat(printOpts.printFormat)
                            ? ' · 부가세 미분류는 분배단가×수량, 세액 10%'
                            : ' · 거래명세표 합계는 인쇄 시 품목 합산 후 재계산'}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => doActualPrint(printOpts)}>
                🖨️ {getPrintFormatDocTitle(printOpts.printFormat)} 출력 실행
              </button>
              <button className="btn" onClick={() => doActualExcelExport(printOpts)}>
                📊 Excel 다운로드 (인쇄와 동일)
              </button>
              <button className="btn" onClick={() => setShowPrintDialog(false)}>취소</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 주문 vs 출고 불일치 상세 모달 ── */}
      {mismatchModalOpen && mismatch && (
        <div className="modal-overlay" onClick={() => setMismatchModalOpen(false)}>
          <div className="modal" style={{ maxWidth: 720, maxHeight: '85vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                ⚠ {selectedShip?.CustName} / {mismatch.week}차 — 주문 vs 출고 불일치
              </span>
              <button className="btn btn-sm" onClick={() => setMismatchModalOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ display:'flex', gap:8, marginBottom:12, fontSize:12 }}>
                {mismatch.shortageCount > 0 && (
                  <span style={{ background:'#ffebee', color:'#c62828', padding:'4px 10px', borderRadius:14, fontWeight:700 }}>
                    📉 출고 부족 {mismatch.shortageCount}건
                  </span>
                )}
                {mismatch.overflowCount > 0 && (
                  <span style={{ background:'#e3f2fd', color:'#1565c0', padding:'4px 10px', borderRadius:14, fontWeight:700 }}>
                    📈 과출고 {mismatch.overflowCount}건
                  </span>
                )}
              </div>
              <div style={{ fontSize:11, color:'#666', marginBottom:8, lineHeight:1.5 }}>
                주문등록(OrderDetail) 대비 출고분배(ShipmentDetail) 합산이 다른 품목 목록입니다.
                <br/>출고일 별 분배가 일부만 됐거나, 주문 후 추가 출고된 케이스 등.
              </div>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
                <thead>
                  <tr style={{ background:'#f5f5f5', borderBottom:'2px solid #999' }}>
                    <th style={{ padding:'5px 6px', textAlign:'left' }}>품목</th>
                    <th style={{ padding:'5px 6px', textAlign:'center', width:40 }}>단위</th>
                    <th style={{ padding:'5px 6px', textAlign:'right', width:60 }}>주문</th>
                    <th style={{ padding:'5px 6px', textAlign:'right', width:60 }}>출고</th>
                    <th style={{ padding:'5px 6px', textAlign:'right', width:70 }}>차이</th>
                    <th style={{ padding:'5px 6px', textAlign:'center', width:70 }}>유형</th>
                  </tr>
                </thead>
                <tbody>
                  {mismatch.items.map(it => {
                    const isShortage = it.diffType === 'shortage';
                    return (
                      <tr key={it.ProdKey} style={{ borderBottom:'1px solid #eee' }}>
                        <td style={{ padding:'4px 6px' }}>
                          {it.ProdName}
                          <div style={{ fontSize:9, color:'#888' }}>
                            {it.CounName} / {it.FlowerName}
                          </div>
                        </td>
                        <td style={{ padding:'4px 6px', textAlign:'center' }}>{it.OutUnit}</td>
                        <td style={{ padding:'4px 6px', textAlign:'right', fontWeight:600 }}>
                          {Number(it.orderQty).toLocaleString()}
                        </td>
                        <td style={{ padding:'4px 6px', textAlign:'right', fontWeight:600 }}>
                          {Number(it.shipQty).toLocaleString()}
                        </td>
                        <td style={{ padding:'4px 6px', textAlign:'right', fontWeight:700,
                                     color: isShortage ? '#c62828' : '#1565c0' }}>
                          {isShortage ? '−' : '+'}{Math.abs(Number(it.diff)).toLocaleString()}
                        </td>
                        <td style={{ padding:'4px 6px', textAlign:'center', fontSize:10 }}>
                          {isShortage ? (
                            <span style={{ background:'#ffebee', color:'#c62828', padding:'1px 6px', borderRadius:8 }}>
                              부족
                            </span>
                          ) : (
                            <span style={{ background:'#e3f2fd', color:'#1565c0', padding:'1px 6px', borderRadius:8 }}>
                              과출고
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ display:'flex', gap:8, padding:12, justifyContent:'flex-end', borderTop:'1px solid var(--border)' }}>
              <button className="btn" onClick={() => setMismatchModalOpen(false)}>닫기</button>
            </div>
          </div>
        </div>
      )}

      {fixStatusModal && (
        <div className="modal-overlay" onClick={() => !(fixWorking || rangeUnfixWorking) && setFixStatusModal(null)}>
          <div className="modal" style={{ maxWidth: 980, width: 'min(96vw, 980px)', maxHeight: '92vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                🔎 확정 현황 — {fixStatusModal.range.fromWeek} ~ {fixStatusModal.range.toWeek}
              </span>
              {!(fixWorking || rangeUnfixWorking) && (
                <button className="btn btn-sm" onClick={() => setFixStatusModal(null)}>닫기</button>
              )}
            </div>
            <div className="modal-body">
              <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:12, fontSize:12 }}>
                <span style={{ background:'#e3f2fd', color:'#1565c0', padding:'4px 10px', borderRadius:14, fontWeight:700 }}>
                  조회 {fixStatusRows.length}차수
                </span>
                <span style={{ background:'#f3e5f5', color:'#6a1b9a', padding:'4px 10px', borderRadius:14, fontWeight:700 }}>
                  범위 {fixStatusBatchCount}차수
                </span>
                <span style={{ background:'#fce4ec', color:'#ad1457', padding:'4px 10px', borderRadius:14, fontWeight:700 }}>
                  {fixStatusCategoryLabel()}
                </span>
                <span style={{ background:'#ede7f6', color:'#4527a0', padding:'4px 10px', borderRadius:14, fontWeight:700 }}>
                  선택 {selectedFixStatusWeeks.size}차수
                </span>
                <span style={{ background:'#fff8e1', color:'#ef6c00', padding:'4px 10px', borderRadius:14, fontWeight:700 }}>
                  취소대상 {fixStatusTargetRows.length}차수
                </span>
                <span style={{ background:'#e8f5e9', color:'#2e7d32', padding:'4px 10px', borderRadius:14, fontWeight:700 }}>
                  확정대상 {fixStatusFixTargetRows.length}차수
                </span>
                <span style={{ background: fixStatusNegativeCount > 0 ? '#ffebee' : '#e8f5e9', color: fixStatusNegativeCount > 0 ? '#c62828' : '#2e7d32', padding:'4px 10px', borderRadius:14, fontWeight:700 }}>
                  음수재고 {fixStatusNegativeCount}건
                </span>
                <span style={{ background: fixStatusExeMisalignedCount > 0 ? '#fff3e0' : '#e8f5e9', color: fixStatusExeMisalignedCount > 0 ? '#e65100' : '#2e7d32', padding:'4px 10px', borderRadius:14, fontWeight:700 }}>
                  exe미정합 {fixStatusExeMisalignedCount}차수
                </span>
              </div>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', marginBottom:10, fontSize:12 }}>
                <span style={{ fontWeight:700, color:'#444' }}>조회 차수</span>
                {[10, 20, 40].map(n => (
                  <button
                    key={n}
                    type="button"
                    disabled={fixStatusLoading || rangeUnfixWorking || fixWorking}
                    onClick={async () => {
                      setFixStatusBatchCount(n);
                      if (!weekNum) return;
                      setFixStatusLoading(true);
                      try {
                        const range = getRecentFixStatusRange(parseInt(weekNum, 10), n);
                        const res = await fetch(`/api/shipment/fix-status?${buildFixStatusQuery({ orderYear: yearStr, fromWeek: range.fromWeek, toWeek: range.toWeek })}`, { credentials: 'same-origin' });
                        const data = await res.json();
                        if (!data.success) throw new Error(data.error || '확정 현황 조회 실패');
                        const weeks = (data.weeks || [])
                          .filter(w => Number(w.masterCount || 0) > 0 || Number(w.detailCount || 0) > 0)
                          .sort((a, b) => String(b.WeekKey || b.OrderWeek).localeCompare(String(a.WeekKey || a.OrderWeek)));
                        setFixStatusAvailableCategories(normalizeCategoryList(data.categories || []));
                        setFixStatusModal(prev => ({ ...prev, ...data, weeks, range }));
                      } catch (e) {
                        alert(`확정 현황 재조회 오류: ${e.message}`);
                      } finally {
                        setFixStatusLoading(false);
                      }
                    }}
                    style={{
                      padding:'4px 10px', borderRadius:14, cursor:'pointer', fontWeight:700,
                      border:`1.5px solid ${fixStatusBatchCount === n ? '#1565c0' : '#bbb'}`,
                      background: fixStatusBatchCount === n ? '#1565c0' : '#fff',
                      color: fixStatusBatchCount === n ? '#fff' : '#555',
                    }}
                  >
                    {n}차수
                  </button>
                ))}
              </div>
              <div style={{ marginBottom:12, padding:'10px 12px', background:'#fafafa', border:'1px solid #e0e0e0', borderRadius:8 }}>
                <div style={{ fontSize:12, fontWeight:800, color:'#333', marginBottom:8 }}>
                  카테고리 범위 (일괄 확정/취소)
                </div>
                <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:8 }}>
                  {FIX_CATEGORY_PRESETS.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      disabled={rangeUnfixWorking || fixWorking}
                      onClick={() => applyFixStatusCategoryPreset(p.id)}
                      style={{
                        padding:'4px 10px', borderRadius:14, cursor:'pointer', fontSize:11, fontWeight:700,
                        border:`1.5px solid ${fixStatusCategoryPreset === p.id ? '#6a1b9a' : '#ccc'}`,
                        background: fixStatusCategoryPreset === p.id ? '#6a1b9a' : '#fff',
                        color: fixStatusCategoryPreset === p.id ? '#fff' : '#555',
                      }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                {fixStatusAvailableCategories.length > 0 ? (
                  <div style={{ display:'flex', gap:6, flexWrap:'wrap', maxHeight:88, overflowY:'auto' }}>
                    {fixStatusAvailableCategories.map(cf => {
                      const checked = fixStatusCategoryPreset === 'all' || fixStatusSelectedCategories.includes(cf);
                      return (
                        <label key={cf} style={{
                          display:'inline-flex', alignItems:'center', gap:4, padding:'3px 8px', borderRadius:12,
                          border:`1px solid ${checked ? '#6a1b9a' : '#ddd'}`, background: checked ? '#f3e5f5' : '#fff',
                          fontSize:11, cursor:'pointer',
                        }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={fixStatusCategoryPreset === 'all'}
                            onChange={() => toggleFixStatusCategory(cf)}
                          />
                          {cf}
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ fontSize:11, color:'#777' }}>조회 구간에 카테고리 데이터가 없습니다.</div>
                )}
                <div style={{ fontSize:11, color:'#666', marginTop:8, lineHeight:1.5 }}>
                  예: <strong>카네이션</strong>만 선택하면 해당 카테고리만 확정/취소됩니다.
                  <strong>부분확정 차수</strong>는 미확정 카테고리를 한 번에 확정해야 하며, 이전 차수는 <strong>전 카테고리</strong> 기준으로 검사합니다.
                  작업 후 차수 전체 재고 재계산이 자동 실행됩니다.
                </div>
              </div>
              <div style={{ fontSize:12, color:'#555', marginBottom:10, lineHeight:1.5 }}>
                <strong>출고확정</strong>(ShipmentDetail) · <strong>재고마감</strong>(StockMaster) · <strong>exe정합</strong>(둘 다 + Product.Stock)을 함께 봅니다.
                카테고리만 확정/취소해도 자동으로 차수 전체 <code>usp_StockCalculation</code>이 돌아갑니다. 그래도 exe미정합이 남으면 <strong>재고 정합 복구</strong>를 실행하세요.
              </div>
              {(rangeUnfixWorking || rangeUnfixStatus) && (
                <div style={{ marginBottom:10, padding:'8px 10px', background:'#fff7ed', border:'1px solid #fed7aa', borderRadius:8, color:'#9a3412', fontSize:12, fontWeight:800 }}>
                  {rangeUnfixStatus || '확정취소 처리 중'}
                </div>
              )}
              {(rangeUnfixWorking || rangeUnfixStatus) && (
                <ShipmentFixLogPanel logs={fixServerLogs} action="unfix" />
              )}
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
                <thead>
                  <tr style={{ background:'#f5f5f5', borderBottom:'2px solid #999' }}>
                    <th style={{ padding:'6px', textAlign:'center', width:42 }}>선택</th>
                    <th style={{ padding:'6px', textAlign:'center', width:80 }}>차수</th>
                    <th style={{ padding:'6px', textAlign:'center', width:90 }}>출고확정</th>
                    <th style={{ padding:'6px', textAlign:'center', width:80 }}>재고마감</th>
                    <th style={{ padding:'6px', textAlign:'center', width:72 }}>exe</th>
                    <th style={{ padding:'6px', textAlign:'left' }}>미확정 카테고리</th>
                    <th style={{ padding:'6px', textAlign:'right' }}>음수재고</th>
                  </tr>
                </thead>
                <tbody>
                  {fixStatusRows.map(w => {
                    const badge = fixStatusBadge(w.status);
                    const stockBadge = stockFixBadge(w.stockFixStatus);
                    const selected = selectedFixStatusWeeks.has(w.OrderWeek);
                    const selectable = Number(w.detailCount || 0) > 0 && w.status !== 'NO_SHIPMENT';
                    return (
                      <tr
                        key={w.WeekKey || w.OrderWeek}
                        onClick={() => {
                          if (!selectable) return;
                          setSelectedFixStatusWeeks(prev => {
                            const next = new Set(prev);
                            if (next.has(w.OrderWeek)) next.delete(w.OrderWeek);
                            else next.add(w.OrderWeek);
                            return next;
                          });
                        }}
                        style={{
                          borderBottom:'1px solid #eee',
                          cursor: selectable ? 'pointer' : 'default',
                          background: selected ? '#f3e5f5' : undefined,
                        }}
                      >
                        <td style={{ padding:'5px 6px', textAlign:'center' }}>
                          {selectable ? <input type="checkbox" checked={selected} readOnly /> : '-'}
                        </td>
                        <td style={{ padding:'5px 6px', textAlign:'center', fontWeight:700 }}>{w.OrderWeek}</td>
                        <td style={{ padding:'5px 6px', textAlign:'center' }}>
                          <span style={{ background: badge.bg, color: badge.color, padding:'2px 8px', borderRadius:12, fontWeight:700 }}>
                            {badge.text}
                          </span>
                        </td>
                        <td style={{ padding:'5px 6px', textAlign:'center' }}>
                          <span style={{ background: stockBadge.bg, color: stockBadge.color, padding:'2px 8px', borderRadius:12, fontWeight:700 }}
                            title="StockMaster.isFix — nenova.exe 재고 마감(usp_StockCalculation)">
                            {stockBadge.text}
                          </span>
                        </td>
                        <td style={{ padding:'5px 6px', textAlign:'center' }}>
                          <span style={{
                            background: w.exeAligned ? '#e8f5e9' : '#ffebee',
                            color: w.exeAligned ? '#2e7d32' : '#c62828',
                            padding:'2px 8px', borderRadius:12, fontWeight:700,
                          }}
                            title={(w.parityWarnings || []).join('\n') || (w.exeAligned ? 'nenova.exe 정합' : 'exe 미정합')}>
                            {w.exeAligned ? 'OK' : '!'}
                          </span>
                        </td>
                        <td style={{ padding:'5px 6px', textAlign:'left', color: w.unfixedCategories ? '#c62828' : '#777', fontWeight: w.unfixedCategories ? 700 : 400 }}>
                          {w.unfixedCategories || '-'}
                        </td>
                        <td style={{ padding:'5px 6px', textAlign:'right', color: Number(w.negativeCount || 0) > 0 ? '#c62828' : '#555', fontWeight: Number(w.negativeCount || 0) > 0 ? 700 : 400 }}>
                          {Number(w.negativeCount || 0).toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                  {fixStatusRows.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ padding:16, textAlign:'center', color:'#777' }}>
                        조회된 차수 현황이 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div style={{ display:'flex', gap:8, padding:12, justifyContent:'flex-end', borderTop:'1px solid var(--border)', flexWrap:'wrap' }}>
              <button type="button" className="btn" onClick={() => setFixStatusModal(null)} disabled={fixWorking || rangeUnfixWorking}>닫기</button>
              <button
                className="btn"
                onClick={async () => { await reconcileSelectedFixStatusWeeks(); }}
                disabled={rangeUnfixWorking || fixWorking || fixStatusExeMisalignedCount === 0}
                style={{ background:'#e8eaf6', color:'#283593', borderColor:'#3949ab', fontWeight:700 }}
                title="카테고리 부분 작업 후 남은 재고 마감·음수재고 복구"
              >
                {rangeUnfixWorking ? (rangeUnfixStatus || '처리중...') : `재고 정합 복구 (${fixStatusExeMisalignedCount || 0}차수)`}
              </button>
              <button
                className="btn"
                onClick={async () => { await unfixSelectedFixStatusWeeks(false); }}
                disabled={rangeUnfixWorking || fixStatusTargetRows.length === 0}
                style={{ background:'#fff7ed', color:'#bf360c', borderColor:'#ef6c00', fontWeight:700 }}
              >
                {rangeUnfixWorking ? (rangeUnfixStatus || '취소중...') : `선택 확정취소 (${fixStatusTargetRows.length}차수 · ${fixStatusCategoryLabel()})`}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => { fixSelectedFixStatusWeeks(); }}
                disabled={fixWorking || rangeUnfixWorking || fixStatusFixTargetRows.length === 0}
                style={{ background:'#2e7d32', color:'#fff', borderColor:'#2e7d32', fontWeight:700 }}
              >
                {fixWorking ? '확정중...' : `선택 차수 확정하기 (${fixStatusFixTargetRows.length}차수 · ${fixStatusCategoryLabel()})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {fixProgress && (
        <EstimateModalPortal onBackdropClick={e => e.stopPropagation()}>
          <div className="modal" style={{ maxWidth: '98vw', width: 'min(98vw, 1200px)', height: '82vh', maxHeight: '94vh', minWidth: 420, minHeight: 340, resize: 'both', overflow: 'auto', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{ flex: '0 0 auto' }}>
              <span className="modal-title">{fixProgress.title || '출고 확정 진행 중'}</span>
              <span style={{ fontSize: 11, color: '#999', marginLeft: 8 }}>↘ 우하단을 드래그하면 창 크기를 조절할 수 있습니다</span>
            </div>
            <div className="modal-body" style={{ flex: '1 1 auto', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8, fontSize:12, color:'#555' }}>
                <span>{fixProgress.currentWeek ? `현재 ${fixProgress.currentWeek}` : '대상 확인 중'}</span>
                <span style={{ fontWeight:700 }}>{fixProgressDone}/{fixProgressTotal || '-'} 완료</span>
              </div>
              <div style={{ height:12, background:'#eceff1', borderRadius:6, overflow:'hidden', border:'1px solid #cfd8dc' }}>
                <div style={{
                  width: `${fixProgressPct}%`,
                  height:'100%',
                  background: fixProgress.phase === 'validating' ? '#1565c0' : '#2e7d32',
                  transition:'width 0.25s ease',
                }} />
              </div>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:12, fontSize:12 }}>
                <span style={{ background:'#e3f2fd', color:'#1565c0', padding:'4px 10px', borderRadius:14, fontWeight:700 }}>
                  진행률 {fixProgressPct}%
                </span>
                <span style={{ background:'#fff8e1', color:'#ef6c00', padding:'4px 10px', borderRadius:14, fontWeight:700 }}>
                  남음 {fixProgressRemain}개
                </span>
                {fixProgress.phase === 'fixing' && (
                  <>
                    <span style={{ background:'#e8f5e9', color:'#2e7d32', padding:'4px 10px', borderRadius:14, fontWeight:700 }}>
                      성공 {Number(fixProgress.success || 0)}개
                    </span>
                    <span style={{ background:'#ffebee', color:'#c62828', padding:'4px 10px', borderRadius:14, fontWeight:700 }}>
                      실패 {Number(fixProgress.failed || 0)}개
                    </span>
                  </>
                )}
              </div>
              <div style={{ marginTop:14, fontSize:13, lineHeight:1.5, color:'#333', fontWeight:600 }}>
                {fixProgress.message}
              </div>
              <ShipmentFixLogPanel logs={fixServerLogs} action="fix" />
              {fixProgress.results?.length > 0 && (
                <div style={{ marginTop:12, borderTop:'1px solid #eee', paddingTop:10 }}>
                  {fixProgress.results.map((r, i) => (
                    <div key={`${r.week}-${i}`} style={{
                      display:'flex', justifyContent:'space-between', gap:8,
                      padding:'4px 0', fontSize:12, color: r.ok ? '#2e7d32' : '#c62828',
                    }}>
                      <span style={{ fontWeight:700 }}>{r.week}</span>
                      <span>{r.ok ? '완료' : (r.error || '실패')}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </EstimateModalPortal>
      )}

      {/* ── 차수 확정 모달 (사전검증 결과 + 강제진행 + 결과) ── */}
      {fixModal && (
        <EstimateModalPortal onBackdropClick={() => !fixWorking && setFixModal(null)}>
          <div className="modal" style={{ width: 'min(96vw, 860px)', maxWidth: '96vw', height: '80vh', maxHeight: '92vh', minWidth: 380, minHeight: 300, resize: 'both', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                {fixModal.stage === 'preview' && `🔍 ${fixModal.week}차 확정 — 사전검증 결과`}
                {fixModal.stage === 'done'    && `📋 ${fixModal.title || `${weekNum}차 확정 결과`}`}
                {fixModal.stage === 'error'   && '❌ 차수 확정 오류'}
              </span>
              {!fixWorking && (
                <button className="btn btn-sm" onClick={() => setFixModal(null)}>✕</button>
              )}
            </div>

            {/* 사전검증 단계 — 이슈 목록 + 강제진행 */}
            {fixModal.stage === 'preview' && (
              <div className="modal-body">
                <div style={{ background: '#fff3e0', border: '1px solid #fb8c00', borderRadius: 6, padding: 10, marginBottom: 12, fontSize: 12, color: '#e65100' }}>
                  ⚠ 확정 전 검증에서 <b>{fixModal.totalIssues}건</b> 이슈 발견.
                  {fixModalHasNegative
                    ? ' 음수재고 품목의 부족수량을 확인하세요. 아래 “부족분 보정 후 확정”을 누르면 표시된 부족수량만 재고조정한 뒤 재확정합니다.'
                    : ' 강제 확정하면 견적서 오류가 발생할 수 있습니다.'}
                </div>
                {Object.entries(fixModal.allIssues).map(([wk, iss]) => (
                  <div key={wk} style={{ marginBottom: 12, border: '1px solid #ddd', borderRadius: 6, padding: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#1976d2', marginBottom: 6 }}>
                      📅 {wk} — 총 {iss.count}건 이슈
                    </div>
                    {iss.ghost?.length > 0 && (
                      <div style={{ fontSize: 11, marginBottom: 4 }}>
                        <span style={{ background: '#ffcdd2', color: '#c62828', padding: '1px 6px', borderRadius: 3, fontWeight: 700 }}>주문없는 출고 {iss.ghost.length}건</span>
                        <ul style={{ margin: '4px 0 0 16px', color: '#555' }}>
                          {iss.ghost.slice(0, 5).map((g, i) => (
                            <li key={i}>{g.CustName} / {g.ProdName} ({g.OutQuantity})</li>
                          ))}
                          {iss.ghost.length > 5 && <li>...외 {iss.ghost.length - 5}건</li>}
                        </ul>
                      </div>
                    )}
                    {iss.noIncoming?.length > 0 && (
                      <div style={{ fontSize: 11, marginBottom: 4 }}>
                        <span style={{ background: '#ffe0b2', color: '#e65100', padding: '1px 6px', borderRadius: 3, fontWeight: 700 }}>입고없는 출고 {iss.noIncoming.length}건</span>
                        <ul style={{ margin: '4px 0 0 16px', color: '#555' }}>
                          {iss.noIncoming.slice(0, 5).map((n, i) => (
                            <li key={i}>{n.ProdName} (출고 {n.outQty}, 입고 {n.inQty})</li>
                          ))}
                          {iss.noIncoming.length > 5 && <li>...외 {iss.noIncoming.length - 5}건</li>}
                        </ul>
                      </div>
                    )}
                    {iss.duplicate?.length > 0 && (
                      <div style={{ fontSize: 11, marginBottom: 4 }}>
                        <span style={{ background: '#f3e5f5', color: '#6a1b9a', padding: '1px 6px', borderRadius: 3, fontWeight: 700 }}>중복 출고 {iss.duplicate.length}건</span>
                        <ul style={{ margin: '4px 0 0 16px', color: '#555' }}>
                          {iss.duplicate.slice(0, 5).map((d, i) => (
                            <li key={i}>{d.CustName} / {d.ProdName} (총 {d.totalQty}, {d.cnt}건)</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {iss.negative?.length > 0 && (
                      <div style={{ fontSize: 11, marginBottom: 4 }}>
                        <span style={{ background: '#ffebee', color: '#b71c1c', padding: '1px 6px', borderRadius: 3, fontWeight: 700 }}>마이너스 잔량 {iss.negative.length}건</span>
                        <ul style={{ margin: '4px 0 0 16px', color: '#555' }}>
                          {iss.negative.slice(0, 30).map((n, i) => (
                            <li key={i}>
                              <b style={{ color: '#6a1b9a' }}>{n.FlowerName || ''}</b> {n.ProdName}
                              {' '}— <b style={{ color: '#c62828' }}>부족 {fmt(n.shortage ?? Math.abs(Number(n.remain) || 0))}</b>
                              <span style={{ color: '#999' }}> (전재고 {n.prevStock} + 입고 {n.inQty} - 출고 {n.outQty} = {n.remain})</span>
                            </li>
                          ))}
                          {iss.negative.length > 30 && <li style={{ color: '#999' }}>… 외 {iss.negative.length - 30}건</li>}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* 결과 단계 — 차수별 성공/실패 */}
            {fixModal.stage === 'done' && (
              <div className="modal-body">
                {fixModal.results.map((r, i) => (
                  <div key={i} style={{
                    padding: 8, marginBottom: 6, borderRadius: 6,
                    background: r.ok ? '#e8f5e9' : '#ffebee',
                    border: `1px solid ${r.ok ? '#66bb6a' : '#ef5350'}`,
                  }}>
                    <div style={{ fontWeight: 700, fontSize: 12, color: r.ok ? '#2e7d32' : '#c62828' }}>
                      {r.ok ? '✅' : '❌'} {r.week}차
                    </div>
                    <div style={{ fontSize: 11, marginTop: 4, color: '#555', whiteSpace: 'pre-wrap' }}>
                      {r.ok ? r.message : `오류: ${r.error}`}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 일반 오류 */}
            {fixModal.stage === 'error' && (
              <div className="modal-body">
                <div style={{ background: '#ffebee', padding: 12, borderRadius: 6, color: '#c62828' }}>
                  {fixModal.error}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, padding: 12, justifyContent: 'flex-end', borderTop: '1px solid var(--border)' }}>
              {fixModal.stage === 'preview' && (
                <>
                  <button className="btn" onClick={() => setFixModal(null)} disabled={fixWorking}>취소</button>
                  {(() => {
                    const negRows = Object.values(fixModal.allIssues || {}).flatMap(iss => iss.negative || []);
                    if (!negRows.length) return null;
                    return (
                      <button
                        className="btn"
                        style={{ background: '#2e7d32', color: '#fff', borderColor: '#1b5e20', fontWeight: 700 }}
                        onClick={() => {
                          const lines = negRows.slice(0, 30).map(n =>
                            `· ${n.FlowerName || ''} ${n.ProdName} : 부족 ${fmt(n.shortage ?? Math.abs(Number(n.remain) || 0))}`);
                          const more = negRows.length > 30 ? `\n… 외 ${negRows.length - 30}건` : '';
                          if (!confirm(`음수 잔량 ${negRows.length}건의 품목별 부족수량만큼 재고를 조정한 뒤 확정합니다.\n\n${lines.join('\n')}${more}\n\n진행하시겠습니까?`)) return;
                          doFixAll(fixModal.weekList, false, [], { autoStockAdd: true, confirmAutoStockAdd: true });
                        }}
                        disabled={fixWorking}
                      >
                        📦 부족분 보정 후 확정 (음수 {negRows.length}건)
                      </button>
                    );
                  })()}
                  <button
                    className="btn"
                    style={{ background: '#c62828', color: '#fff', borderColor: '#a01818', fontWeight: 700 }}
                    onClick={() => doFixAll(fixModal.weekList, true)}
                    disabled={fixWorking}
                  >
                    ⚠ 그래도 강제 확정 ({fixModal.weekList.length}차수)
                  </button>
                </>
              )}
              {fixModal.stage === 'done' && (() => {
                const negFail = (fixModal.results || []).some(
                  r => !r.ok && /마이너스|잔량|음수/.test(String(r.error || '')));
                return (
                  <>
                    {negFail && !fixModal.autoStockAddUsed && (
                      <button
                        className="btn"
                        style={{ background: '#2e7d32', color: '#fff', borderColor: '#1b5e20', fontWeight: 700 }}
                        disabled={fixWorking}
                        onClick={() => {
                          if (!confirm('음수 잔량으로 확정 실패한 차수에 품목별 정확한 부족분만큼 재고를 조정한 뒤 다시 확정합니다.\n\n(재고조정 → 재고재계산 → 확정)\n\n진행하시겠습니까?')) return;
                          doFixAll(fixModal.weekList, false, fixModal.countryFlowers || [], {
                            autoStockAdd: true,
                            confirmAutoStockAdd: true,
                            resultTitle: fixModal.resultTitle || '재고 추가 후 재확정 결과',
                          });
                        }}
                      >
                        📦 부족분 보정 후 재확정
                      </button>
                    )}
                    <button className="btn btn-primary" onClick={() => setFixModal(null)}>닫기</button>
                  </>
                );
              })()}
              {fixModal.stage === 'error' && (
                <button className="btn" onClick={() => setFixModal(null)}>닫기</button>
              )}
            </div>
          </div>
        </EstimateModalPortal>
      )}

      {/* ── 견적 품목 정보/수정 창 ── */}
      {itemEditor && (
        <EstimateModalPortal onBackdropClick={() => !itemEditorSaving && setItemEditor(null)}>
          <div className="modal" style={{maxWidth:680}} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">품목 정보 {itemEditor.isEstimate ? '수정' : '확인/수정'}</span>
              <button className="btn btn-sm" onClick={() => !itemEditorSaving && setItemEditor(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{fontWeight:700, fontSize:12, marginBottom:10, borderBottom:'1px solid var(--border)', paddingBottom:6}}>
                ■ {selectedShip?.CustName || '-'} / {yearStr}년 {weekNum}차
                <span style={{marginLeft:8, color:itemEditor.isEstimate ? '#a0522d' : '#1565c0'}}>
                  {itemEditor.isEstimate
                    ? `· ${itemEditor.item.Quantity < 0 ? '불량/검역 차감' : '판매요청'} · Estimate #${itemEditor.estimateKey}`
                    : '· 정상출고 (EXE 출고 원장)'}
                </span>
              </div>
              {!itemEditor.isEstimate && (
                <div style={{padding:'7px 9px', marginBottom:10, background:'#eff6ff', color:'#1e40af', fontSize:11, lineHeight:1.5}}>
                  정상출고의 품목·단위는 ShipmentDetail과 연결되어 있어 이 창에서 바꾸지 않습니다.
                  수량은 ShipmentDate, 단가는 ShipmentDetail의 기존 EXE 호환 수정 경로로 저장됩니다.
                </div>
              )}
              <div className="form-row form-row-1">
                <div className="form-group">
                  <label className="form-label">품목명</label>
                  {itemEditor.isEstimate ? (
                    <SearchableSelect
                      options={prodOptions}
                      value={itemEditor.prodKey}
                      onChange={async value => {
                        setItemEditor(prev => ({...prev, prodKey: String(value)}));
                        try {
                          const context = await apiGet('/api/estimate', {
                            view: 'defectContext', year: yearStr, week: weekNum,
                            custKey: selectedShip?.CustKey, prodKey: Number(value),
                          });
                          if (Number(context.context?.cost) > 0) {
                            setItemEditor(prev => ({...prev, cost: String(Math.round(Number(context.context.cost)))}));
                          }
                        } catch (_) { /* 단가는 기존값을 유지하고 저장 시 서버가 검증 */ }
                      }}
                      placeholder="품목명 검색..."
                    />
                  ) : (
                    <div className="form-control" style={{background:'#f8fafc'}}>{itemEditor.item.ProdName || '-'}</div>
                  )}
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">수 량</label>
                  <input type="number" min={0} className="form-control"
                    value={itemEditor.quantity}
                    onChange={e => setItemEditor(prev => ({...prev, quantity:e.target.value}))}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">단 위</label>
                  {itemEditor.isEstimate ? (
                    <div style={{display:'flex', gap:4, flexWrap:'wrap'}}>
                      {['단','박스','스팀(대)'].map(u => (
                        <button key={u} type="button" className="btn btn-sm"
                          onClick={() => setItemEditor(prev => ({...prev, unit:u}))}
                          style={{background:itemEditor.unit === u ? '#1565c0' : '#fff', color:itemEditor.unit === u ? '#fff' : '#334155', borderColor:itemEditor.unit === u ? '#0d47a1' : '#94a3b8', fontWeight:700}}
                        >{u}</button>
                      ))}
                    </div>
                  ) : <div className="form-control" style={{background:'#f8fafc'}}>{itemEditor.unit || '-'}</div>}
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">단 가</label>
                  <input type="number" min={0} className="form-control"
                    value={itemEditor.cost}
                    onChange={e => setItemEditor(prev => ({...prev, cost:e.target.value}))}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">견적일자</label>
                  <input type="date" className="form-control" disabled={!itemEditor.isEstimate}
                    value={itemEditor.estimateDate || ''}
                    onChange={e => setItemEditor(prev => ({...prev, estimateDate:e.target.value}))}
                  />
                </div>
              </div>
              <div className="form-row form-row-1">
                <div className="form-group">
                  <label className="form-label">비 고</label>
                  <input className="form-control" value={itemEditor.descr || ''}
                    onChange={e => setItemEditor(prev => ({...prev, descr:e.target.value}))}
                    placeholder="견적서에 표시할 비고를 입력하세요."
                  />
                </div>
              </div>
              {itemEditorError && <div className="banner-err" style={{marginTop:8}}>⚠️ {itemEditorError}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={saveItemEditor} disabled={itemEditorSaving || estimateEditPresence.blocked}>
                {itemEditorSaving ? '저장 중...' : '💾 수정 저장'}
              </button>
              <button className="btn" onClick={() => !itemEditorSaving && setItemEditor(null)}>닫기</button>
            </div>
          </div>
        </EstimateModalPortal>
      )}

      {/* ── 불량/검역 등록 모달 ── */}
      {showDefect && (
        <div className="modal-overlay" onClick={() => setShowDefect(false)}>
          <div className="modal" style={{maxWidth:560}} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{defectForm.entryMode === 'sales' ? '판매요청 등록' : defectForm.entryMode === 'legacy' ? '불량/검역등록' : '불량차감등록'}</span>
              <button className="btn btn-sm" onClick={() => setShowDefect(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{fontWeight:'bold', fontSize:12, marginBottom:10, borderBottom:'1px solid var(--border)', paddingBottom:6}}>
                ■ {selectedShip?.CustName || '-'} / {yearStr}년 {weekNum}차
              </div>

              {/* 등록 구분 + 견적일자 */}
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">구 분</label>
                  {defectForm.entryMode === 'legacy' ? (
                    <SearchableSelect options={estimateTypeOptions} value={defectForm.estimateType}
                      onChange={v => setDefectForm(f => ({...f, estimateType:v}))} placeholder="구분 검색..." />
                  ) : (
                    <div className="form-control" style={{background:'#f1f5f9',fontWeight:700,color:defectForm.entryMode === 'sales' ? '#1565c0' : '#006600'}}>
                      {defectForm.entryMode === 'sales' ? '판매요청 (양수)' : '불량차감 (음수)'}
                    </div>
                  )}
                </div>
                <div className="form-group">
                  <label className="form-label">견적일자</label>
                  <input type="date" className="form-control"
                    value={defectForm.estimateDate}
                    onChange={e => setDefectForm(f => ({...f, estimateDate: e.target.value}))}
                  />
                </div>
              </div>

              {/* 품목명 — DB 품목 검색 */}
              <div className="form-row form-row-1">
                <div className="form-group">
                  <label className="form-label">품목명</label>
                  <SearchableSelect
                    options={prodOptions}
                    value={defectForm.prodKey}
                    onChange={v => loadDefectContext(v)}
                    placeholder="품목명 검색... (예: CARNATION)"
                  />
                  {defectContextLoading && <div style={{fontSize:11, color:'#1565c0', marginTop:4}}>분배단가·EXE 판매행 확인 중…</div>}
                  {defectContextError && <div style={{fontSize:11, color:'#c62828', marginTop:4}}>{defectContextError}</div>}
                  {defectContext && (
                    <div style={{fontSize:11, color:'#166534', marginTop:4, lineHeight:1.5}}>
                      ✓ DB: {products.find(p => String(p.ProdKey) === String(defectForm.prodKey))?.ProdName || '-'}
                      {defectContext.shipmentKey ? ` · EXE 판매행 #${defectContext.shipmentKey}` : ' · 현재 차수 EXE 판매행 없음'}
                      {defectContext.costOrderWeek ? ` · 단가 원천 ${defectContext.costOrderWeek}` : ''}
                    </div>
                  )}
                </div>
              </div>

              {/* 수량 + 단위 + 음수 체크 */}
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">수 량</label>
                  <input type="number" min={0} className="form-control"
                    value={defectForm.quantity}
                    onChange={e => setDefectForm(f => ({...f, quantity: e.target.value}))}
                    placeholder="0"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">단 위</label>
                  <div style={{display:'flex', gap:4, flexWrap:'wrap'}}>
                    {['단','박스','스팀(대)'].map((u) => (
                      <button key={u} type="button" className="btn btn-sm"
                        onClick={() => setDefectForm(f => ({...f, unit:u}))}
                        style={{background:defectForm.unit === u ? '#1565c0' : '#fff', color:defectForm.unit === u ? '#fff' : '#334155', borderColor:defectForm.unit === u ? '#0d47a1' : '#94a3b8', fontWeight:700}}
                      >{u}</button>
                    ))}
                  </div>
                  <label style={{display:'flex', alignItems:'center', gap:5, marginTop:6, fontSize:12, color:defectForm.negative ? '#c62828' : '#1565c0'}}>
                    <input type="checkbox" checked={Boolean(defectForm.negative)}
                      onChange={e => setDefectForm(f => ({...f, negative:e.target.checked}))}
                    />
                    - 차감 {defectForm.entryMode === 'sales' ? '(판매요청에서는 해제)' : `(${defectForm.entryMode === 'legacy' ? '불량/검역' : '불량차감'} 필수)`}
                  </label>
                </div>
              </div>

              {/* 단가 */}
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">단 가</label>
                  <input type="number" min={0} className="form-control"
                    value={defectForm.cost}
                    onChange={e => setDefectForm(f => ({...f, cost: e.target.value}))}
                    readOnly={defectContextLoading || Number(defectContext?.cost || 0) > 0}
                    placeholder={defectContextLoading ? '조회 중...' : '분배단가 자동'}
                    style={{background: Number(defectContext?.cost || 0) > 0 ? '#f0fdf4' : '#fff'}}
                  />
                  <div style={{fontSize:10, color:'#64748b', marginTop:3}}>이전 차수 분배단가 자동 적용 · 필요 시 원장 확인</div>
                </div>
              </div>

              {/* 공급가액 + 부가세 — 자동계산 */}
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">공급가액</label>
                  <input type="number" className="form-control" value={supply} readOnly
                    style={{background:'#F0F0F0', color:'var(--blue)', fontWeight:'bold'}}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">부가세</label>
                  <input type="number" className="form-control" value={vat} readOnly
                    style={{background:'#F0F0F0', color:'var(--text3)'}}
                  />
                </div>
              </div>

              {/* 비고 */}
              <div className="form-row form-row-1">
                <div className="form-group">
                  <label className="form-label">비 고</label>
                  <input className="form-control"
                    value={defectForm.descr}
                    onChange={e => setDefectForm(f => ({...f, descr: e.target.value}))}
                  />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={handleDefectSave} disabled={saving || estimateEditPresence.blocked}>
                💾 {saving ? '저장 중... / Guardando' : (defectForm.entryMode === 'sales' ? '판매요청 등록' : defectForm.entryMode === 'legacy' ? '불량/검역 저장' : '불량차감 등록')}
              </button>
              <button className="btn" onClick={() => setShowDefect(false)}>{t('닫기')}</button>
            </div>
          </div>
        </div>
      )}

      {previewCapture && (
        <style jsx global>{`
          body.estimate-preview-capture [data-ui-sidebar],
          body.estimate-preview-capture [data-ui-topbar],
          body.estimate-preview-capture [data-ui-popupbar] { display: none !important; }
          .estimate-preview-capture-root .filter-bar,
          .estimate-preview-capture-root .page-actions,
          .estimate-preview-capture-root .estimate-shipment-list { display: none !important; }
          .estimate-preview-capture-root .estimate-split-panel { grid-template-columns: 1fr !important; min-height: 100vh; }
          .estimate-preview-capture-root .estimate-item-list .card-header .btn { display: none !important; }
        `}</style>
      )}
    </div>
  );
}
