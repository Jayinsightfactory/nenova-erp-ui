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
import {
  filterItemsByWeekday as filterEstimateItemsByWeekday,
  filterPrintTargetItems,
  formatEstimatePrintDescr,
  isEstimateDeductionRow,
  isPrintableEstimateRow,
  sanitizeEstimateDescrForDisplay,
} from '../lib/estimateInvariants';
import { filterItemsByExeWeekDay } from '../lib/exeEstimateViewSql.js';
import { downloadEcountUploadWorkbook } from '../lib/estimateEcountExcel.js';
import {
  FIX_CATEGORY_PRESETS,
  categoriesForPreset,
  normalizeCategoryList,
  resolveCountryFlowerFilter,
} from '../lib/fixStatusCategories';
import { formatFixApiErrorMessage } from '../lib/shipmentFixGuards';
import { getFixCycleWeeksForEditedItems as buildFixCycleWeeks } from '../lib/estimateFixCycle';
import {
  computePrintPreviewTotals,
  ESTIMATE_PRINT_FORMAT,
  getEstimateOriginCountry,
  getEstimateSpecLabel,
  getStatementProductName,
  getPrintFormatBigoSuffix,
  getPrintFormatDocTitle,
  isStatementPrintFormat,
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
import ShipmentFixLogPanel, { parseStockCalcProgressFromLogs } from '../components/ShipmentFixLogPanel';

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

async function fetchWeekFixStatus(week) {
  const res = await fetch(
    `/api/shipment/fix-status?fromWeek=${encodeURIComponent(week)}&toWeek=${encodeURIComponent(week)}`,
    { credentials: 'same-origin' },
  );
  const data = await parseJsonResponse(res).catch(() => ({}));
  return (data.weeks || []).find(w => w.OrderWeek === week) || null;
}

async function reconcileFixResultAfterAmbiguousResponse(week, data) {
  if (data?.success || !data?._ambiguousResponse) return data;
  const row = await fetchWeekFixStatus(week);
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
  printFormat = ESTIMATE_PRINT_FORMAT.ESTIMATE,
}) {
  const docTitle = getPrintFormatDocTitle(printFormat);
  const prepared = prepareEstimatePrintRows(rows, { printFormat, showDistribDesc, showDeductionOutDay });
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
  let footerLabelColspan;

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
    footerLabelColspan = 7;
    tableFoot = `
    <tr class="foot-row">
      <td colspan="${footerLabelColspan}" style="text-align:right;padding-right:12px">합계</td>
      <td style="text-align:right">${fmtN(totalSupply)}</td>
      <td style="text-align:right">${fmtN(totalVat)}</td>
      <td style="text-align:right;font-size:10pt;background:#dce8f5">${fmtN(totalAmt)}</td>
    </tr>`;
  } else {
    itemRows = printRows.map((r, i) => {
      const deduct = isDeduct(r);
      const rowBg  = deduct ? 'background:#FFF8DC;' : '';
      const amtClr = '';
      const boxCell = showBoxQty
        ? `<td style="${rowBg}${amtClr}text-align:right;border:1px solid #bbb;padding:2px 5px;white-space:nowrap;color:#555">${fmtN(r.BoxQty || 0)}박스</td>`
        : '';
      return `
    <tr>
      <td style="${rowBg}text-align:center;border:1px solid #bbb;padding:2px 3px;width:28px">${i + 1}</td>
      <td style="${rowBg}border:1px solid #bbb;padding:2px 6px;">${estimateTypeLabel(r.EstimateType)}${r.ProdName || ''}</td>
      <td style="${rowBg}${amtClr}text-align:right;border:1px solid #bbb;padding:2px 5px;white-space:nowrap">${fmtN(r.Quantity)}${r.Unit || ''}</td>
      ${boxCell}
      <td style="${rowBg}text-align:right;border:1px solid #bbb;padding:2px 6px">${fmtN(r.Cost)}</td>
      <td style="${rowBg}${amtClr}text-align:right;border:1px solid #bbb;padding:2px 6px">${fmtN(r.Amount)}</td>
      <td style="${rowBg}${amtClr}text-align:right;border:1px solid #bbb;padding:2px 6px">${fmtN(r.Vat)}</td>
      <td style="${rowBg}border:1px solid #bbb;padding:2px 5px;font-size:7.5pt;color:#555">${String(descLabel(r) ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td>
    </tr>`;
    }).join('');

    const boxHeader = showBoxQty ? '<th class="item-th" style="width:46px">박스</th>' : '';
    footerLabelColspan = showBoxQty ? 5 : 4;
    tableHead = `
    <tr>
      <th class="item-th" style="width:24px">순번</th>
      <th class="item-th">품목명[규격]</th>
      <th class="item-th" style="width:54px">수량</th>
      ${boxHeader}
      <th class="item-th" style="width:54px">단가</th>
      <th class="item-th" style="width:74px">공급가액</th>
      <th class="item-th" style="width:60px">부가세</th>
      <th class="item-th" style="width:108px">적요</th>
    </tr>`;
    tableFoot = `
    <tr class="foot-row">
      <td colspan="${footerLabelColspan}" style="text-align:right;padding-right:12px">공급가액 합계</td>
      <td style="text-align:right">${fmtN(totalSupply)}</td>
      <td style="text-align:right">${fmtN(totalVat)}</td>
      <td style="text-align:right;font-size:10pt;background:#dce8f5">${fmtN(totalAmt)}</td>
    </tr>`;
  }

  const serialDisplay = serialNo || printDate;

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
     letter-spacing:0.42em; text-decoration:underline; margin-bottom:6px; line-height:1.2; }
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
@media print { body{padding:10mm 15mm;} @page{size:A4;margin:10mm 15mm;}
  .logo-area{height:18mm;padding:1.5mm 2mm;} .logo-area img{height:16mm;max-height:16mm;} }
</style>
</head><body>
<h1>${docTitle}</h1>

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
        <tr><td class="info-key">회사명/대표</td><td class="info-val">(주)네노바 / 김원배</td></tr>
        <tr><td class="info-key">주소</td><td class="info-val">서울 서초구 언남길 15-7, 102호</td></tr>
        <tr><td class="info-key">업태/종목</td><td class="info-val">도매 / 무역</td></tr>
        <tr><td class="info-key">계좌번호</td><td class="info-val">하나 630-008129-149</td></tr>
        <tr><td class="info-key">TEL/FAX</td><td class="info-val">02-575-8003 / 02-576-8003</td></tr>
      </table>
    </td>
  </tr>
</table>

<!-- 금액 행 -->
<div class="amt-row">
  <span class="amt-ko">금 액 : ${numToKorean(totalAmt)}</span>
  <span class="amt-num">(W ${fmtN(totalAmt)}원) / VAT 포함</span>
</div>

<!-- 품목 테이블 -->
<table>
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
.print-page { padding:10mm 12mm; page-break-after:always; break-after:page; }
.print-page:last-child { page-break-after:auto; break-after:auto; }
@media print {
  body { padding:0 !important; }
  .print-page { padding:5mm 8mm; page-break-after:always; break-after:page; }
  .print-page:last-child { page-break-after:auto; break-after:auto; }
}
</style>
</head><body>
${sections}
</body></html>`;
}

function getShipmentManager(ship) {
  const manager = String(ship?.Manager || '').trim();
  return manager || '담당자 미지정';
}

function compareShipmentsByManager(a, b) {
  const managerDiff = getShipmentManager(a).localeCompare(getShipmentManager(b), 'ko');
  if (managerDiff !== 0) return managerDiff;
  const weekDiff = String(b?.ParentWeek || '').localeCompare(String(a?.ParentWeek || ''), 'ko', { numeric: true });
  if (weekDiff !== 0) return weekDiff;
  return String(a?.CustName || '').localeCompare(String(b?.CustName || ''), 'ko');
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

  const filtered = q
    ? options.filter(o => o.label.toLowerCase().includes(q.toLowerCase()))
    : options;

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
      const { data: d } = await postShipmentFix({ week: subWeek, action: 'unfix', force });
      if (!d.success) {
        // 후속차수 확정 경고면 강제 진행 옵션 제공
        if (d.warning === 'LATER_FIXED_EXISTS') {
          if (confirm(`${d.error}\n\n그래도 강제 진행하시겠습니까?`)) {
            return await unfixOneWeek(subWeek, true);
          }
          return;
        }
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

  const getSelectedFixRange = () => {
    const selectedParent = parseInt(weekNum, 10);
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

  const checkFixStatus = async () => {
    if (!weekNum) { alert('차수를 입력하세요.'); return; }
    const range = getSelectedFixRange();
    if (!range) { alert('확정 현황을 확인할 차수를 알 수 없습니다.'); return; }
    setFixStatusLoading(true);
    try {
      const res = await fetch(`/api/shipment/fix-status?fromWeek=${encodeURIComponent(range.fromWeek)}&toWeek=${encodeURIComponent(range.toWeek)}`, {
        credentials: 'same-origin',
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
    } catch (e) {
      alert(`확정 현황 확인 오류: ${e.message}`);
    } finally {
      setFixStatusLoading(false);
    }
  };

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
      const statusRes = await fetch(`/api/shipment/fix-status?fromWeek=${encodeURIComponent(fromWeek)}&toWeek=${encodeURIComponent(toWeek)}`, {
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
          fromWeek,
          toWeek,
          force,
          ...(getFixStatusCountryFlowers().length ? { countryFlowers: getFixStatusCountryFlowers() } : {}),
        }),
      });
      const data = await res.json();
      if (!data.success) {
        if (data.warning === 'LATER_FIXED_EXISTS' && !force) {
          if (confirm(`${data.error}\n\n그래도 구간 확정취소를 진행할까요?`)) {
            return await unfixRangeToSelectedWeek(true);
          }
          return;
        }
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

  // 오른쪽 패널 - 견적서 목록
  const [items, setItems] = useState([]);

  // 업체 검색 드롭다운
  const [custSearch, setCustSearch] = useState('');
  const [custList, setCustList] = useState([]);
  const [selectedCust, setSelectedCust] = useState(null);
  const [showCustDrop, setShowCustDrop] = useState(false);
  const custDropRef = useRef();

  // 거래처 드롭다운 키보드 탐색
  const custNav = useDropdownNav(
    custList,
    (c) => { setSelectedCust(c); setCustSearch(c.CustName); setShowCustDrop(false); },
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

  // WeekDay 필터 — 기본값: 전체 요일 선택
  const [activeWD, setActiveWD] = useState(new Set(['월','화','수','목','금','토','일']));

  // 불량/검역 모달
  const [showDefect, setShowDefect] = useState(false);
  const [products, setProducts] = useState([]);  // 품목 전체 목록 (드롭다운용)
  const [estimateTypes, setEstimateTypes] = useState([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // ── 단가 수정 상태 (P3) ─────────────────────────
  // costEdits[sdetailKey] = 수정된 단가 (string)
  const [costEdits, setCostEdits] = useState({});
  // qtyEdits[sdetailKey] = 수정된 수량 (string)
  const [qtyEdits, setQtyEdits] = useState({});
  const [qtyApplying, setQtyApplying] = useState(false);
  const [qtyResult, setQtyResult] = useState(null);
  const [costMode, setCostMode] = useState('once'); // 'once' | 'fixed' | 'weekFav'
  const [costApplying, setCostApplying] = useState(false);
  const [editApplyTitle, setEditApplyTitle] = useState('단가 적용');
  const [costApplyLog, setCostApplyLog] = useState([]); // 진행 단계 로그
  const [costResult, setCostResult] = useState(null);   // 완료 후 결과

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
  });

  // 인쇄 다이얼로그용 — 선택 거래처의 출고일(byDate) 분포.
  //   그리드는 출고상세 대표일자 1개로 합산돼 보이지만(분할품목 전량이 한 날짜로),
  //   실제 인쇄는 ShipmentDate 기준 출고일별로 쪼개진다. 다이얼로그에서 이 분포를
  //   요일별 실제 품목수/수량으로 보여줘, 요일 선택이 인쇄에 정확히 반영됨을 확인시킨다.
  const [printDayInfo, setPrintDayInfo] = useState({ loading: false, days: [] });
  const [printDialogItems, setPrintDialogItems] = useState([]);

  // 불량/검역 폼
  const [defectForm, setDefectForm] = useState({
    estimateType: '',
    estimateDate: new Date().toISOString().slice(0,10),
    prodKey: '',
    unit: '단',
    quantity: '',
    cost: '',
    descr: '',
  });

  // 공급가액/부가세 자동계산
  const supply = Math.round((parseFloat(defectForm.quantity)||0) * (parseFloat(defectForm.cost)||0));
  const vat    = Math.round(supply / 11);

  // ── 외부 클릭 시 업체 드롭다운 닫기
  useEffect(() => {
    const handler = e => { if (custDropRef.current && !custDropRef.current.contains(e.target)) setShowCustDrop(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── 업체 검색 디바운스
  useEffect(() => {
    if (custSearch.length < 1) { setCustList([]); return; }
    const t = setTimeout(() => {
      apiGet('/api/customers/search', { q: custSearch })
        .then(d => { setCustList(d.customers || []); setShowCustDrop(true); })
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

  // ── 조회 (차수 + 업체 기준) — 차수 단위 그룹핑 (14 → 14-01, 14-02 … 모두 포함)
  // silent=true: 자동조회 시 에러 무시 (입력 부족 케이스)
  const load = (silent = false, opts = {}) => {
    if (!weekNum && !selectedCust) {
      if (!silent) setErr('차수 또는 업체를 입력하세요.');
      return Promise.resolve();
    }
    setLoading(true); setErr('');
    const includeUnfixedForLoad = opts.includeUnfixedOverride ?? includeUnfixed;
    return apiGet('/api/estimate', {
      week: weekNum,        // "14" 전달 → API에서 14-01, 14-02 등 자동 매칭
      custKey: selectedCust?.CustKey || '',
      includeUnfixed: includeUnfixedForLoad ? '1' : '',
      ...(activeWD.size < 7 ? { weekDays: [...activeWD].join(',') } : {}),
    })
      .then(d => {
        setShipments(d.shipments || []);
        setSelectedGroups(new Set()); // 새 조회 시 다중선택 초기화
        setItems(d.items || []);
        if (d.shipments?.length > 0) {
          // 그룹 기준: ParentWeek + CustKey
          const first = d.shipments[0];
          setSelectedId(`${first.ParentWeek}_${first.CustKey}`);
          setSelectedCustKey(first.CustKey);
        } else {
          setSelectedId(null); setSelectedCustKey(null);
        }
      })
      .catch(e => { if (!silent) setErr(e.message); })
      .finally(() => setLoading(false));
  };

  // 자동조회: 차수/거래처 변경 시 자동 로드 (autoLoad=true 일 때만)
  useEffect(() => {
    if (!autoLoad) return;
    if (!weekNum && !selectedCust) return;
    const t = setTimeout(() => load(true), 200); // 입력 디바운스
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekNum, selectedCust?.CustKey, autoLoad, includeUnfixed, activeWD]);

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
    setSelectedId(groupId);
    setSelectedCustKey(custKey);
    setItemLoading(true);
    const detailParams = {
      week: weekNum,
      custKey,
      byDate: 1,
      itemsOnly: 1,
    };
    apiGet('/api/estimate', detailParams)
      .then((d) => setItems(d.items || []))
      .catch(() => {
        const keys = (shipmentKeys || '').split(',').map(Number).filter(Boolean);
        return Promise.all(keys.map((sk) => apiGet('/api/estimate', { shipmentKey: sk, byDate: 1 }).then((r) => r.items || [])))
          .then((results) => setItems(results.flat()));
      })
      .finally(() => setItemLoading(false));
    // 주문 vs 출고 불일치 자동 검증
    if (custKey && weekNum) {
      apiGet('/api/estimate', { view: 'mismatch', week: weekNum, custKey })
        .then(d => { if (d.success) setMismatch(d); else setMismatch(null); })
        .catch(() => setMismatch(null));
    }
  };

  const reloadSelectedShipmentItems = useCallback(async () => {
    const ship = shipments.find(s => `${s.ParentWeek}_${s.CustKey}` === selectedId);
    if (!ship) return [];
    try {
      const d = await apiGet('/api/estimate', {
        week: weekNum,
        custKey: ship.CustKey,
        byDate: 1,
        itemsOnly: 1,
      });
      const nextItems = d.items || [];
      setItems(nextItems);
      return nextItems;
    } catch {
      const keys = (ship.ShipmentKeys || '').split(',').map(Number).filter(Boolean);
      const results = await Promise.all(keys.map((sk) => apiGet('/api/estimate', { shipmentKey: sk, byDate: 1 }).then((r) => r.items || [])));
      const nextItems = results.flat();
      setItems(nextItems);
      return nextItems;
    }
  }, [selectedId, shipments, weekNum]);

  const selectedShip = shipments.find(s => `${s.ParentWeek}_${s.CustKey}` === selectedId);

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
  const isEstimateEditKey = (key) => String(key || '').startsWith('est:');
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

  const getProdKeysForEditedItems = (editedItems) => [...new Set((editedItems || [])
    .map(it => Number(it.ProdKey))
    .filter(Number.isFinite))];

  const runShipmentFixAction = async (week, action, countryFlowers = [], stockProdKeys = [], extraBody = {}) => {
    const { data: d } = await postShipmentFix({
      week,
      action,
      force: true,
      countryFlowers,
      stockProdKeys,
      ...extraBody,
    });
    if (!d.success) {
      throw new Error(d.error || d.message || `${week} ${action === 'unfix' ? '확정취소' : '재확정'} 실패`);
    }
    return d;
  };

  // lightStock: 단가수정처럼 재고 수치가 안 변하는 편집용 — 사이클 중간 재고 재계산을 전부
  // 생략(skipStockCalc)하고, 마지막 재확정 1회만 전체 재계산으로 스냅샷을 정리한다.
  // 수량수정은 재고가 실제로 변하므로 lightStock 을 켜지 말 것.
  const runEditWithFixCycle = async ({ weeks, countryFlowers = [], stockProdKeys = [], progress, apply, lightStock = false }) => {
    const targetWeeks = sortWeeksAsc(weeks);
    const unfixedWeeks = [];
    let applyResult = null;
    let applyError = null;
    const skipBody = lightStock ? { skipStockCalc: true } : {};
    try {
      for (const wk of sortWeeksDesc(targetWeeks)) {
        progress?.(`${wk} 확정해제 중`);
        await runShipmentFixAction(wk, 'unfix', countryFlowers, stockProdKeys, skipBody);
        unfixedWeeks.push(wk);
      }
    } catch (err) {
      progress?.(`확정해제 오류 — ${err.message}`);
      for (const wk of sortWeeksAsc(unfixedWeeks)) {
        progress?.(`${wk} 원상복구 재확정 중`);
        // 원상복구는 안전 우선 — 재계산 생략하지 않음
        await runShipmentFixAction(wk, 'fix', countryFlowers, stockProdKeys);
      }
      throw err;
    }

    try {
      progress?.('수정값 저장 중');
      applyResult = await apply();
    } catch (err) {
      applyError = err;
      progress?.(`수정 저장 오류 — ${err.message}`);
    }

    const refixWeeks = sortWeeksAsc(unfixedWeeks);
    for (let i = 0; i < refixWeeks.length; i++) {
      const wk = refixWeeks[i];
      const isLast = i === refixWeeks.length - 1;
      progress?.(`${wk} 재확정 중${lightStock && isLast ? ' (재고 정리 재계산 포함)' : ''}`);
      // 경량 모드: 마지막 재확정만 전체 재계산으로 스냅샷 정리
      await runShipmentFixAction(wk, 'fix', countryFlowers, stockProdKeys, isLast ? {} : skipBody);
    }

    if (applyError) throw applyError;
    return applyResult;
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
      const statusRes = await fetch(`/api/shipment/fix-status?fromWeek=${encodeURIComponent(range.fromWeek)}&toWeek=${encodeURIComponent(range.toWeek)}`, {
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
      for (let i = 0; i < weekList.length; i += 1) {
        const wk = weekList[i];
        setFixProgress(prev => ({
          ...(prev || {}),
          currentWeek: wk,
          done: i,
          message: `${wk} 사전검증 중입니다.`,
        }));
        try {
          const r = await fetch(`/api/shipment/fix?week=${encodeURIComponent(wk)}`);
          const d = await r.json();
          if (d.success && d.issueCount > 0) {
            allIssues[wk] = {
              ghost: d.ghost || [], noIncoming: d.noIncoming || [],
              duplicate: d.duplicate || [], negative: d.negative || [],
              count: d.issueCount,
            };
          }
        } catch (_) { /* 검증 실패 시 무시하고 fix 시도 */ }
        setFixProgress(prev => ({
          ...(prev || {}),
          done: i + 1,
          message: `${wk} 사전검증 완료`,
        }));
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
          action: 'fix',
          force,
          ...(countryFlowers.length ? { countryFlowers } : {}),
          ...(opts.autoStockAdd ? { autoStockAdd: true } : {}),
        });
        d = await reconcileFixResultAfterAmbiguousResponse(wk, d);
        if (!d.success) {
          results.push({ week: wk, ok: false, error: formatFixApiErrorMessage(d, wk), message: d.message });
        } else {
          results.push({ week: wk, ok: true, message: d.message, count: d.updatedCount, stockErrors: (d.stockErrors?.length || 0) + (d.reconcile?.stockErrors?.length || 0) });
        }
      } catch (e) {
        const msg = e?.name === 'AbortError'
          ? `요청 시간 초과(${Math.round(FIX_UNFIX_FETCH_TIMEOUT_MS / 60000)}분) — 재고 재계산 진행 중일 수 있습니다`
          : e.message;
        const recovered = await reconcileFixResultAfterAmbiguousResponse(wk, { success: false, _ambiguousResponse: true, error: msg });
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
      autoStockAddUsed: !!opts.autoStockAdd,
    });
    setFixWorking(false);
    setFixProgress(null);
    load(true); // 화면 갱신
  };

  // 수량 수정 적용 — 단가수정과 다르게 ADD/CANCEL 으로 분기 (audit log)
  const applyQtyEdits = async () => {
    if (editedQtyCount === 0) return;
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
        const item = filteredItems.find(it => getItemEditKey(it) === editKey);
        if (!item) continue;
        const isEstimate = isEstimateEditKey(editKey);
        const keyNumber = parseEditKeyNumber(editKey);
        const oldQty = parseFloat(item.Quantity) || 0;
        const newQty = parseFloat(newVal);
        if (Number.isNaN(newQty) || (!isEstimate && newQty < 0)) continue;
        const effectiveNewQty = isEstimate && oldQty < 0 ? -Math.abs(newQty) : newQty;
        if (Math.abs(effectiveNewQty - oldQty) < 0.001) continue;
        pending.push({ keyNumber, isEstimate, item, oldQty, newQty });
      }

      if (pending.length === 0) throw new Error('수정 대상 수량이 없습니다.');

      // 2026-07-14: 선제 사이클 → "직접 저장 먼저, 서버가 FIXED_WEEK 라고 한 행만 사이클 후 재시도"
      //   (단가수정과 동일 패턴). 미확정 행은 즉시 저장되고, 진짜 확정된 행만 자동 확정해제→재확정을
      //   탄다. 이미 저장된 행은 재시도하지 않아 STALE_DATA 오탐도 없다.
      const postOneQty = async (p) => {
        setCostApplyLog(prev => [...prev, {
          step: 'save',
          label: `${p.item.OrderWeek} ${p.item.ProdName} 수량 저장 — ${p.oldQty}${p.item.Unit} → ${p.newQty}${p.item.Unit}`,
        }]);
        const r = await fetch('/api/estimate/update-quantity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            sdetailKey: p.isEstimate ? undefined : p.keyNumber,
            estimateKey: p.isEstimate ? p.keyNumber : undefined,
            shipmentKey: p.item.ShipmentKey,
            quantity: p.newQty,
            unit: p.item.Unit,
            expectedOldQuantity: p.oldQty,
          }),
        });
        const d = await r.json();
        return {
          key: p.keyNumber, ok: d.success, code: d.code,
          oldQty: p.oldQty, newQty: p.newQty, orderWeek: p.item.OrderWeek, error: d.error,
          fixedWeeks: d.fixedWeeks || [], fixedCategories: d.fixedCategories || [],
          pendingRef: p,
        };
      };

      // 1차: 전 행 직접 저장 (실패해도 수집만 — 행 단위 독립)
      const firstPass = await runLimited(pending, 4, postOneQty);
      let results = firstPass;

      // FIXED_WEEK 로 거절된 행만 자동 사이클 후 재시도
      const fixedFails = firstPass.filter(r => !r.ok && r.code === 'FIXED_WEEK');
      if (fixedFails.length > 0) {
        const fixedPending = fixedFails.map(r => r.pendingRef);
        // 서버가 알려준 확정 차수/카테고리(DB 기준)를 합집합 — 화면 아이템의 필드 누락과 무관하게 스코프 정확
        const cycleWeeks = sortWeeksAsc([
          ...getFixCycleWeeksForEditedItems(fixedPending.map(p => p.item), selectedShip),
          ...fixedFails.flatMap(r => r.fixedWeeks),
        ]);
        const cycleCountryFlowers = [...new Set([
          ...getCountryFlowersForEditedItems(fixedPending.map(p => p.item)),
          ...fixedFails.flatMap(r => r.fixedCategories),
        ])];
        const cycleStockProdKeys = getProdKeysForEditedItems(fixedPending.map(p => p.item));
        setCostApplyLog(prev => [...prev, {
          step: 'cycle',
          label: `확정된 상세 ${fixedFails.length}건 감지 → 자동 확정 사이클: ${sortWeeksDesc(cycleWeeks).join(' 해제 → ')} 해제 후 ${sortWeeksAsc(cycleWeeks).join(' 확정 → ')} 확정${cycleCountryFlowers.length ? ` / 카테고리 ${cycleCountryFlowers.join(', ')}` : ''}`,
        }]);
        const retryResults = await runEditWithFixCycle({
          weeks: cycleWeeks,
          countryFlowers: cycleCountryFlowers,
          stockProdKeys: cycleStockProdKeys,
          progress: label => setCostApplyLog(prev => [...prev, { step: 'cycle', label }]),
          apply: async () => await runLimited(fixedPending, 4, postOneQty),
        });
        // pendingRef 객체 identity 로 매핑 (keyNumber 는 est/sd 간 충돌 가능)
        results = firstPass.map(r => retryResults.find(x => x.pendingRef === r.pendingRef) || r);
      }

      const okCount = results.filter(r => r.ok).length;
      const failCount = results.filter(r => !r.ok).length;
      setQtyResult({ results, okCount, failCount });
      if (failCount === 0) setQtyEdits({});
      setCostApplyLog(prev => [...prev, { step: 'done', label: '완료 — 수정 수량 반영 후 견적서 재조회 중' }]);
      setCostResult({ success: true, type: 'quantity', changedCount: okCount });
      // 다시 조회하여 화면 갱신
      load(true);
    } catch (e) {
      setQtyResult({ error: e.message });
      setCostApplyLog(prev => [...prev, { step: 'error', label: `오류 — ${e.message}` }]);
      setCostResult({ success: false, error: e.message });
    } finally {
      setQtyApplying(false);
      setCostApplying(false);
    }
  };

  // "확정풀고 단가 적용하기" — 실제 적용 함수
  async function applyCostEdits() {
    if (editedCount === 0) return;
    if (!selectedShipmentKeys.length) { setErr('선택된 견적서 없음'); return; }

    // 차수/거래처 정보
    const week = selectedShip.SubWeeks?.split(',')[0] || `${selectedShip.ParentWeek}-01`;

    setCostApplying(true);
    setEditApplyTitle('단가 수정 저장');
    setCostResult(null);
    setCostApplyLog([
      { step: 'start', label: '시작 — 단가 적용 준비 중...' },
    ]);

    try {
      const editedSdKeys = Object.keys(costEdits)
        .filter(k => costEdits[k] !== '' && costEdits[k] !== undefined)
        .filter(k => !isEstimateEditKey(k))
        .map(k => parseEditKeyNumber(k));
      const editedEstimateKeys = Object.keys(costEdits)
        .filter(k => costEdits[k] !== '' && costEdits[k] !== undefined)
        .filter(k => isEstimateEditKey(k))
        .map(k => parseEditKeyNumber(k));

      setCostApplyLog(prev => [...prev, {
        step: 'collect',
        label: `${editedSdKeys.length + editedEstimateKeys.length}건 수정 대상 확인 중...`,
      }]);

      const sdkToShipment = Object.fromEntries(
        filteredItems
          .filter(it => it.SdetailKey && editedSdKeys.includes(it.SdetailKey) && it.ShipmentKey)
          .map(it => [it.SdetailKey, { sk: it.ShipmentKey, cost: it.Cost }])
      );

      // filteredItems 에서 편집된 sdk 를 찾고 각각에 shipmentKey 매핑
      const allItems = [];
      filteredItems.forEach(it => {
        if (it.SdetailKey && editedSdKeys.includes(it.SdetailKey) && sdkToShipment[it.SdetailKey]) {
          allItems.push({
            shipmentKey: sdkToShipment[it.SdetailKey].sk,
            sdetailKey: it.SdetailKey,
            cost: parseFloat(costEdits[getItemEditKey(it)]),
            OrderWeek: it.OrderWeek,
            ProdName: it.ProdName,
            CountryFlower: it.CountryFlower,
            // 낙관적 동시성: 조회 시점 snapshot 의 Cost (filteredItems 에 있는 값)
            expectedOldCost: it.Cost,
          });
        } else if (it.EstimateKey && editedEstimateKeys.includes(it.EstimateKey)) {
          allItems.push({
            shipmentKey: it.ShipmentKey,
            estimateKey: it.EstimateKey,
            cost: parseFloat(costEdits[getItemEditKey(it)]),
            OrderWeek: it.OrderWeek,
            ProdName: it.ProdName,
            CountryFlower: it.CountryFlower,
            expectedOldCost: it.Cost,
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
        label: `${allItems.length}건 처리 중 (${skSummary}) — 미확정 차수 단가/금액 수정 (단일 트랜잭션)...`,
      }]);

      // ── 2) 단일 POST — 모든 ShipmentKey + SdetailKey 를 한 트랜잭션으로
      const body = {
        items: allItems.map(({ OrderWeek, ProdName, CountryFlower, ...it }) => it),
        mode: costMode,
        week,
        custKey: selectedShip.CustKey,
      };
      // 2026-07-13: 확정된 차수에서 단가를 수정하면 확정해제→적용→재확정 사이클을 타야 하는데
      // cycleWeeks 가 항상 빈 배열로 고정돼 있어서 이 사이클이 아예 동작하지 않던 버그.
      // (서버 update-cost.js 의 확정차수 차단도 꺼져있어 직접 UPDATE는 "성공"하지만, 이후 재확정
      //  시점에 값이 되돌아가는 것으로 관측됨 — 수량수정(applyQtyEdits)과 동일한 방식으로 수정.)
      // 2026-07-14: 선제 사이클 → "직접 저장 먼저, 서버가 FIXED_WEEK 라고 할 때만 사이클"로 변경.
      //   화요일 카테고리별 부분확정 중간상태(마스터=1·상세=0)에서 SubWeeksFix 기준 선제 사이클이
      //   미확정 카테고리를 조기 재확정하려다 부분확정 가드에 막혀 "직접 확정취소하라" 경고가 뜨던
      //   문제 수정. 상세가 미확정이면 직접 저장이 안전하고(서버 가드도 상세 기준으로 정정),
      //   상세가 진짜 확정일 때만 사이클이 필요하다.
      const cycleWeeks = getFixCycleWeeksForEditedItems(allItems, selectedShip);
      const cycleCountryFlowers = getCountryFlowersForEditedItems(allItems);
      const postCostUpdate = async () => {
        allItems.forEach(it => {
          setCostApplyLog(prev => [...prev, {
            step: 'save',
            label: `${it.OrderWeek} ${it.ProdName} 단가 저장 — ${it.expectedOldCost} → ${it.cost}`,
          }]);
        });
        const r = await fetch('/api/estimate/update-cost', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const d = await r.json();
        if (!d.success) {
          if (d.code === 'FIXED_WEEK') {
            const fixedErr = new Error(
              `확정된 차수는 단가를 바로 수정할 수 없습니다.\n\n` +
              `대상 차수: ${(d.fixedWeeks || []).join(', ') || '확정 차수'}\n\n` +
              `확정해제 후 저장/재확정 과정에서 다시 확정된 데이터가 감지되었습니다.`
            );
            fixedErr.isFixedWeek = true;
            fixedErr.fixedWeeks = d.fixedWeeks || [];
            fixedErr.fixedCategories = d.fixedCategories || [];
            throw fixedErr;
          }
          if (d.code === 'STALE_DATA') {
            const staleErr = new Error(
              `⚠️ 데이터 변경 감지\n\n견적서 조회 이후 다른 사용자 또는 전산 프로그램이 단가를 변경했습니다.\n\n` +
              `(SdetailKey=${d.sdetailKey}${d.shipmentKey ? ` / ShipmentKey=${d.shipmentKey}` : ''}: ` +
              `조회시점=${d.expected}원 → 현재=${d.actual}원)\n\n` +
              `수정은 중단되고 확정 상태는 다시 복구됩니다. 조회 버튼을 다시 눌러 최신 데이터를 불러온 뒤 다시 시도해주세요.`
            );
            staleErr.isStaleData = true;
            throw staleErr;
          }
          throw new Error(d.error || '단가 수정 실패');
        }
        return d;
      };

      let d;
      try {
        d = await postCostUpdate();
      } catch (firstErr) {
        // 2026-07-14: 사이클 스코프는 서버가 알려준 "실제 확정된 차수/카테고리"를 합집합으로 사용.
        //   화면 아이템의 OrderWeek/CountryFlower 누락(차감류 null 차수, 중국장미 등 카테고리 공백)으로
        //   스코프가 빠지면 해당 카테고리가 안 풀려 저장이 다시 FIXED_WEEK 로 실패하던 문제 대응.
        const effWeeks = sortWeeksAsc([...cycleWeeks, ...(firstErr.fixedWeeks || [])]);
        const effCats = [...new Set([...cycleCountryFlowers, ...(firstErr.fixedCategories || [])])];
        if (!firstErr.isFixedWeek || effWeeks.length === 0) throw firstErr;
        setCostApplyLog(prev => [...prev, {
          step: 'cycle',
          label: `확정된 상세 감지 → 자동 확정 사이클: ${sortWeeksDesc(effWeeks).join(' 해제 → ')} 해제 후 ${sortWeeksAsc(effWeeks).join(' 확정 → ')} 확정${effCats.length ? ` / 카테고리 ${effCats.join(', ')}` : ''}`,
        }]);
        d = await runEditWithFixCycle({
          weeks: effWeeks,
          countryFlowers: effCats,
          stockProdKeys: [],
          progress: label => setCostApplyLog(prev => [...prev, { step: 'cycle', label }]),
          apply: postCostUpdate,
          // 단가는 재고 수치와 무관 — 중간 재계산 생략, 마지막 재확정만 정리 재계산
          lightStock: true,
        });
      }

      if (!d.success) {
        if (d.code === 'FIXED_WEEK') {
          const fixedErr = new Error(
            `확정된 차수는 단가를 바로 수정할 수 없습니다.\n\n` +
            `대상 차수: ${(d.fixedWeeks || []).join(', ') || '확정 차수'}\n\n` +
            `확정현황에서 필요한 구간을 먼저 확정취소한 뒤 단가를 수정하고, 낮은 차수부터 다시 확정해주세요.`
          );
          fixedErr.isFixedWeek = true;
          throw fixedErr;
        }
        if (d.code === 'STALE_DATA') {
          const staleErr = new Error(
            `⚠️ 데이터 변경 감지\n\n견적서 조회 이후 다른 사용자 또는 전산 프로그램이 단가를 변경했습니다.\n\n` +
            `(SdetailKey=${d.sdetailKey}${d.shipmentKey ? ` / ShipmentKey=${d.shipmentKey}` : ''}: ` +
            `조회시점=${d.expected}원 → 현재=${d.actual}원)\n\n` +
            `전체 변경이 롤백되었습니다. 조회 버튼을 다시 눌러 최신 데이터를 불러온 뒤 다시 시도해주세요.`
          );
          staleErr.isStaleData = true;
          throw staleErr;
        }
        throw new Error(d.error || '단가 수정 실패');
      }

      setCostApplyLog(prev => [...prev, {
        step: 'processed',
        label: `✓ DB 반영 완료 — ${d.changedCount}건, ${d.shipmentKeys?.length || 0}개 차수 동시 수정, 공급가 ${d.diffAmount >= 0 ? '+' : ''}${(d.diffAmount || 0).toLocaleString()}원`,
      }]);

      const allChanges = d.changes || [];
      const totalDiff = d.diffAmount || 0;

      setCostApplyLog(prev => [...prev, { step: 'done', label: '✅ 전체 완료 — 견적서 재로딩 중...' }]);

      // 재로딩 — 좌측 출고목록(합계금액) + 우측 견적 상세 둘 다
      if (selectedShip) {
        await new Promise(res => setTimeout(res, 400));
        load(true); // 좌측 shipments 재조회 (총 합계금액 갱신)
        selectShipment(selectedId, selectedShip.CustKey, selectedShip.ShipmentKeys);
      }

      setCostResult({
        success: true,
        changedCount: allChanges.length,
        totalDiff,
      });
      // 성공 시 편집 상태 초기화
      setCostEdits({});
    } catch (err) {
      setCostApplyLog(prev => [...prev, { step: 'error', label: `❌ 오류: ${err.message}` }]);
      setCostResult({ success: false, error: err.message });
      // STALE_DATA = 화면이 옛 단가를 들고 있음(앞선 시도가 이미 저장됐거나 타인이 수정)
      // → 최신 단가로 화면 자동 갱신. 입력한 수정값(costEdits)은 유지되므로 바로 재적용 가능.
      if (err.isStaleData) {
        setCostApplyLog(prev => [...prev, { step: 'cycle', label: '최신 단가로 화면 갱신 중 — 이미 반영된 항목은 값이 일치하게 보입니다' }]);
        try { await reloadSelectedShipmentItems(); load(true); } catch { /* 갱신 실패는 무시 */ }
      }
    } finally {
      // 모달은 수동 닫기 — 사용자가 결과를 볼 수 있도록
      setTimeout(() => {
        // 자동 닫기는 3초 후에만 (성공 시)
      }, 0);
    }
  }

  async function applyAllEdits() {
    if (editedCount === 0 && editedQtyCount === 0) return;
    if (!selectedShipmentKeys.length) { setErr('선택된 견적서 없음'); return; }

    setQtyApplying(true);
    setCostApplying(true);
    setEditApplyTitle('단가/수량 수정 저장');
    setQtyResult(null);
    setCostResult(null);
    setCostApplyLog([{ step: 'start', label: `${weekNum}차 견적서 단가/수량 수정 시작` }]);

    try {
      const qtyPending = [];
      for (const [editKey, newVal] of Object.entries(qtyEdits)) {
        if (newVal === '' || newVal == null) continue;
        const item = filteredItems.find(it => getItemEditKey(it) === editKey);
        if (!item) continue;
        const isEstimate = isEstimateEditKey(editKey);
        const keyNumber = parseEditKeyNumber(editKey);
        const oldQty = parseFloat(item.Quantity) || 0;
        const newQty = parseFloat(newVal);
        if (Number.isNaN(newQty) || (!isEstimate && newQty < 0)) continue;
        const effectiveNewQty = isEstimate && oldQty < 0 ? -Math.abs(newQty) : newQty;
        if (Math.abs(effectiveNewQty - oldQty) < 0.001) continue;
        qtyPending.push({ keyNumber, isEstimate, item, oldQty, newQty });
      }

      const editedSdKeys = Object.keys(costEdits)
        .filter(k => costEdits[k] !== '' && costEdits[k] !== undefined && costEdits[k] !== null)
        .filter(k => !isEstimateEditKey(k))
        .map(k => parseEditKeyNumber(k));
      const editedEstimateKeys = Object.keys(costEdits)
        .filter(k => costEdits[k] !== '' && costEdits[k] !== undefined && costEdits[k] !== null)
        .filter(k => isEstimateEditKey(k))
        .map(k => parseEditKeyNumber(k));
      const sdkToShipment = Object.fromEntries(
        filteredItems
          .filter(it => it.SdetailKey && editedSdKeys.includes(it.SdetailKey) && it.ShipmentKey)
          .map(it => [it.SdetailKey, { sk: it.ShipmentKey, cost: it.Cost }])
      );
      const costItems = [];
      filteredItems.forEach(it => {
        if (it.SdetailKey && editedSdKeys.includes(it.SdetailKey) && sdkToShipment[it.SdetailKey]) {
          const cost = parseFloat(costEdits[getItemEditKey(it)]);
          if (!Number.isNaN(cost) && cost >= 0) {
            costItems.push({
              shipmentKey: sdkToShipment[it.SdetailKey].sk,
              sdetailKey: it.SdetailKey,
              cost,
              OrderWeek: it.OrderWeek,
              ProdName: it.ProdName,
              CountryFlower: it.CountryFlower,
              expectedOldCost: it.Cost,
            });
          }
        } else if (it.EstimateKey && editedEstimateKeys.includes(it.EstimateKey)) {
          const cost = parseFloat(costEdits[getItemEditKey(it)]);
          if (!Number.isNaN(cost) && cost >= 0) {
            costItems.push({
              shipmentKey: it.ShipmentKey,
              estimateKey: it.EstimateKey,
              cost,
              OrderWeek: it.OrderWeek,
              ProdName: it.ProdName,
              CountryFlower: it.CountryFlower,
              expectedOldCost: it.Cost,
            });
          }
        }
      });

      if (qtyPending.length === 0 && costItems.length === 0) throw new Error('수정 대상이 없습니다.');

      const cycleWeeks = getFixCycleWeeksForEditedItems([
        ...qtyPending.filter(p => !p.isEstimate).map(p => p.item),
      ], selectedShip);
      const cycleCountryFlowers = getCountryFlowersForEditedItems([
        ...qtyPending.filter(p => !p.isEstimate).map(p => p.item),
      ]);
      const cycleStockProdKeys = getProdKeysForEditedItems(qtyPending.filter(p => !p.isEstimate).map(p => p.item));
      if (cycleWeeks.length > 0) {
        setCostApplyLog(prev => [...prev, {
          step: 'cycle',
          label: `확정 사이클 대상: ${sortWeeksDesc(cycleWeeks).join(' 해제 → ')} 해제 후 ${sortWeeksAsc(cycleWeeks).join(' 확정 → ')} 확정${cycleCountryFlowers.length ? ` / 카테고리 ${cycleCountryFlowers.join(', ')}` : ''}`,
        }]);
      }

      const runCombinedUpdate = async () => {
        const qtyResults = await runLimited(qtyPending, 4, async (p) => {
          setCostApplyLog(prev => [...prev, {
            step: 'save',
            label: `${p.item.OrderWeek} ${p.item.ProdName} 수량 저장 — ${p.oldQty}${p.item.Unit} → ${p.newQty}${p.item.Unit}`,
          }]);
          const r = await fetch('/api/estimate/update-quantity', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
              sdetailKey: p.isEstimate ? undefined : p.keyNumber,
              estimateKey: p.isEstimate ? p.keyNumber : undefined,
              shipmentKey: p.item.ShipmentKey,
              quantity: p.newQty,
              unit: p.item.Unit,
              expectedOldQuantity: p.oldQty,
            }),
          });
          const d = await r.json();
          const result = { key: p.keyNumber, ok: d.success, oldQty: p.oldQty, newQty: p.newQty, orderWeek: p.item.OrderWeek, error: d.error };
          if (!d.success) throw new Error(d.error || `${p.item.OrderWeek} 수량 수정 실패`);
          return result;
        });

        let costResultData = { changedCount: 0, diffAmount: 0, changes: [] };
        if (costItems.length > 0) {
          costItems.forEach(it => {
            setCostApplyLog(prev => [...prev, {
              step: 'save',
              label: `${it.OrderWeek} ${it.ProdName} 단가 저장 — ${it.expectedOldCost} → ${it.cost}`,
            }]);
          });
          const r = await fetch('/api/estimate/update-cost', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              items: costItems.map(({ OrderWeek, ProdName, CountryFlower, ...it }) => it),
              mode: costMode,
              week: selectedShip.SubWeeks?.split(',')[0] || `${selectedShip.ParentWeek}-01`,
              custKey: selectedShip.CustKey,
            }),
          });
          const d = await r.json();
          if (!d.success) throw new Error(d.error || '단가 수정 실패');
          costResultData = d;
        }
        return { qtyResults, costResultData };
      };

      const { qtyResults, costResultData } = cycleWeeks.length > 0
        ? await runEditWithFixCycle({
            weeks: cycleWeeks,
            countryFlowers: cycleCountryFlowers,
            stockProdKeys: cycleStockProdKeys,
            progress: label => setCostApplyLog(prev => [...prev, { step: 'cycle', label }]),
            apply: runCombinedUpdate,
          })
        : await runCombinedUpdate();

      const okQty = qtyResults.filter(r => r.ok).length;
      setQtyResult({ results: qtyResults, okCount: okQty, failCount: qtyResults.length - okQty });
      setCostApplyLog(prev => [...prev, { step: 'done', label: '완료 — 단가/수량 반영 후 견적서 재조회 중' }]);
      setCostResult({
        success: true,
        type: 'combined',
        changedCount: okQty + Number(costResultData.changedCount || 0),
        totalDiff: Number(costResultData.diffAmount || 0),
      });
      setQtyEdits({});
      setCostEdits({});
      await load(true);
      if (selectedShip) selectShipment(selectedId, selectedShip.CustKey, selectedShip.ShipmentKeys);
    } catch (err) {
      setCostApplyLog(prev => [...prev, { step: 'error', label: `오류 — ${err.message}` }]);
      setCostResult({ success: false, error: err.message });
      setQtyResult({ error: err.message });
    } finally {
      setQtyApplying(false);
      setCostApplying(false);
    }
  }

  function closeCostModal() {
    setCostApplying(false);
    setCostApplyLog([]);
    setCostResult(null);
  }

  // ── WeekDay 필터 (exe ActiveFilterString — filterItemsByWeekday 위에서 정의)
  const ALL_WD = ['월','화','수','목','금','토','일'];
  const filteredItems = filterItemsByWeekday(items);

  const printPreviewItems = useMemo(() => {
    if (!showPrintDialog) return [];
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

  // ── 불량/검역 등록 저장
  const handleDefectSave = async () => {
    if (!selectedId)              { alert('출고 거래처를 선택하세요.'); return; }
    if (!defectForm.estimateType) { alert('구분을 선택하세요.'); return; }
    if (!defectForm.prodKey)      { alert('품목명을 선택하세요.'); return; }
    if (!defectForm.quantity || parseFloat(defectForm.quantity) <= 0) { alert('수량을 입력하세요.'); return; }
    const shipmentKeyForEstimate = selectedShip?.firstShipmentKey
      || Number((selectedShip?.ShipmentKeys || '').split(',').find(Boolean));
    if (!shipmentKeyForEstimate) { alert('견적을 등록할 출고번호를 찾지 못했습니다. 다시 조회 후 선택하세요.'); return; }
    setSaving(true);
    try {
      await apiPost('/api/estimate', {
        shipmentKey:  shipmentKeyForEstimate,
        prodKey:      parseInt(defectForm.prodKey),
        estimateType: defectForm.estimateType,
        unit:         defectForm.unit,
        quantity:     parseFloat(defectForm.quantity),
        cost:         parseFloat(defectForm.cost) || 0,
        estimateDate: defectForm.estimateDate,
        descr:        defectForm.descr || '',
      });
      setShowDefect(false);
      setDefectForm({ estimateType:'', estimateDate: new Date().toISOString().slice(0,10), prodKey:'', unit:'단', quantity:'', cost:'', descr:'' });
      setSuccessMsg('✅ 불량/검역 등록 완료');
      setTimeout(() => setSuccessMsg(''), 3000);
      selectShipment(selectedId, selectedCustKey);
    } catch(e) { alert(e.message); } finally { setSaving(false); }
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
        .map((id) => shipments.find((s) => `${s.ParentWeek}_${s.CustKey}` === id))
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

    // ── 한 거래처분 인쇄 페이지 생성 — rows 와 custName 받아 splitMode 에 따라 페이지 배열 반환
    const buildCustomerPrintPages = (oneCustName, oneRows) => {
      const printRows = filterPrintTargetItems(oneRows, activeWD, opts.outType);
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

      const groups = {};
      printRows.forEach(r => {
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
      const orderedGroups = [
        ...groupOrder.filter(g => groups[g]?.length > 0),
        ...Object.keys(groups).filter(g => !groupOrder.includes(g)).sort((a, b) => a.localeCompare(b, 'ko')),
      ];
      const activeGroups = orderedGroups;
      if (activeGroups.length === 0) return [];

      const pages = [
        ...activeGroups.map(g => ({
          bigoLabel: `${week}차 ${g}`,
          rows: groups[g],
        })),
      ];
      return pages.map(({ bigoLabel, rows, aggregate }) => buildEstimateHtml({
        bigoLabel, rows, aggregate,
        ...htmlOpts,
      }));
    };

    // ── 다중 선택 모드: 각 거래처별로 순차 인쇄
    if (selectedGroups.size > 0) {
      // selectedGroups 의 각 그룹에 대해 items 가져와서 인쇄
      const groupArr = Array.from(selectedGroups);
      const printPages = [];
      const selectedShips = groupArr
        .map(groupId => shipments.find(s => `${s.ParentWeek}_${s.CustKey}` === groupId))
        .filter(Boolean);
      // 담당자 순으로 정렬해 인쇄물이 담당자별로 모이게 한다(구분 표지는 종이 낭비라 미삽입).
      const printShips = [...selectedShips].sort(compareShipmentsByManager);
      for (const ship of printShips) {
        const keys = (ship.ShipmentKeys || '').split(',').map(Number).filter(Boolean);
        let custPages = [];
        try {
          const fetchPromises = keys.map(k =>
            fetch(`/api/estimate?shipmentKey=${k}&byDate=1`, { credentials: 'same-origin' })
              .then(r => r.json())
              .then(d => d.success ? (d.items || []) : [])
          );
          const allItems = await Promise.all(fetchPromises);
          // 견적서 관리의 요일(출고일) 필터를 일괄 인쇄에도 동일 적용 —
          // nenova.exe 처럼 선택한 요일에 지정된 출고분만 견적에 포함.
          const rows = filterItemsByWeekday(allItems.flat());
          custPages = buildCustomerPrintPages(ship.CustName, rows);
        } catch (e) {
          console.error(`[print] ${ship.CustName} 실패:`, e);
        }
        // 요일 필터로 해당 거래처에 출력할 항목이 없으면 생략
        if (custPages.length === 0) continue;
        printPages.push(...custPages);
      }
      if (printPages.length === 0) {
        alert('출력할 데이터가 없습니다.');
        return;
      }
      await printInIframe(buildEstimatePrintBundle(printPages, opts.printFormat));
    } else {
      // 단일 선택 — 출고일별(byDate) 항목으로 요일필터 적용 후 인쇄
      const custName = selectedShip?.CustName || '';
      const keys = (selectedShip?.ShipmentKeys || '').split(',').map(Number).filter(Boolean);
      let refreshedItems = [];
      if (keys.length > 0) {
        const results = await Promise.all(keys.map(k =>
          fetch(`/api/estimate?shipmentKey=${k}&byDate=1`, { credentials: 'same-origin' })
            .then(r => r.json())
            .then(d => d.success ? (d.items || []) : [])
        ));
        refreshedItems = results.flat();
      } else {
        refreshedItems = await reloadSelectedShipmentItems();
      }
      const printPages = buildCustomerPrintPages(custName, filterItemsByWeekday(refreshedItems));
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
    };

    const appendSheet = (sheets, custName, oneRows, bigoLabel) => {
      const printRows = filterPrintTargetItems(oneRows, activeWD, opts.outType);
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
      const printShips = groupArr
        .map(groupId => shipments.find(s => `${s.ParentWeek}_${s.CustKey}` === groupId))
        .filter(Boolean)
        .sort(compareShipmentsByManager);
      for (const ship of printShips) {
        const keys = (ship.ShipmentKeys || '').split(',').map(Number).filter(Boolean);
        try {
          const results = await Promise.all(keys.map(k =>
            fetch(`/api/estimate?shipmentKey=${k}&byDate=1`, { credentials: 'same-origin' })
              .then(r => r.json())
              .then(d => d.success ? (d.items || []) : [])
          ));
          const rows = filterItemsByWeekday(results.flat());
          if (opts.splitMode === 'combined') {
            appendSheet(sheets, ship.CustName, rows, `${week}차 ${bigoSuffix}`);
          } else {
            const groups = {};
            filterPrintTargetItems(rows, activeWD, opts.outType).forEach(r => {
              const g = getFlowerGroup(r);
              if (!groups[g]) groups[g] = [];
              groups[g].push(r);
            });
            Object.entries(groups).forEach(([g, gRows]) => {
              appendSheet(sheets, `${ship.CustName}_${g}`, gRows, `${week}차 ${g}`);
            });
          }
        } catch (e) {
          console.error(`[excel] ${ship.CustName} 실패:`, e);
        }
      }
    } else {
      const custName = selectedShip?.CustName || '';
      const keys = (selectedShip?.ShipmentKeys || '').split(',').map(Number).filter(Boolean);
      let refreshedItems = [];
      if (keys.length > 0) {
        const results = await Promise.all(keys.map(k =>
          fetch(`/api/estimate?shipmentKey=${k}&byDate=1`, { credentials: 'same-origin' })
            .then(r => r.json())
            .then(d => d.success ? (d.items || []) : [])
        ));
        refreshedItems = results.flat();
      } else {
        refreshedItems = await reloadSelectedShipmentItems();
      }
      const rows = filterItemsByWeekday(refreshedItems);
      if (opts.splitMode === 'combined') {
        appendSheet(sheets, custName, rows, `${week}차 ${bigoSuffix}`);
      } else {
        const groups = {};
        filterPrintTargetItems(rows, activeWD, opts.outType).forEach(r => {
          const g = getFlowerGroup(r);
          if (!groups[g]) groups[g] = [];
          groups[g].push(r);
        });
        Object.entries(groups).forEach(([g, gRows]) => {
          appendSheet(sheets, `${custName}_${g}`, gRows, `${week}차 ${g}`);
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
        .map(g => shipments.find(s => `${s.ParentWeek}_${s.CustKey}` === g))
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
      ? Array.from(selectedGroups).map(g => shipments.find(s => `${s.ParentWeek}_${s.CustKey}` === g)).filter(Boolean)
      : (selectedShip ? [selectedShip] : []);
    const keys = ships.flatMap(s => (s.ShipmentKeys || '').split(',').map(Number).filter(Boolean));
    if (keys.length === 0) {
      setPrintDayInfo({ loading: false, days: [] });
      setPrintDialogItems([]);
      return;
    }
    setPrintDayInfo({ loading: true, days: [] });
    setPrintDialogItems([]);
    (async () => {
      try {
        const results = await Promise.all(keys.map(k =>
          fetch(`/api/estimate?shipmentKey=${k}&byDate=1`, { credentials: 'same-origin' })
            .then(r => r.json()).then(d => d.success ? (d.items || []) : [])
        ));
        if (cancelled) return;
        const flatItems = results.flat();
        setPrintDialogItems(flatItems);
        const map = new Map();
        flatItems
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
  }, [showPrintDialog, selectedGroups, selectedShip, shipments]);

  // 품목 옵션 (검색 가능 드롭다운용)
  const prodOptions = products.map(p => ({
    value: String(p.ProdKey),
    label: p.ProdName,
    sub: `${p.CounName} · ${p.FlowerName} · ${p.OutUnit}`,
  }));

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
            action: 'unfix',
            force: true,
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
          body: JSON.stringify({ week: wk, forceFullWeekRecalc: true }),
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
    <div>
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
            className="filter-input"
            placeholder="거래처 검색... (↓↑ 이동, Enter 선택)"
            value={custSearch}
            onChange={e => { setCustSearch(e.target.value); setSelectedCust(null); custNav.reset(); }}
            onFocus={() => custList.length > 0 && setShowCustDrop(true)}
            onKeyDown={custNav.onKeyDown}
            style={{ minWidth: 160, borderColor: selectedCust ? 'var(--blue)' : undefined }}
          />
          {showCustDrop && custList.length > 0 && (
            <div style={{ position:'absolute', top:'100%', left:0, zIndex:200, background:'#fff', border:'2px solid var(--border2)', width:300, maxHeight:200, overflowY:'auto', boxShadow:'2px 2px 6px rgba(0,0,0,0.2)' }}>
              {custList.map((c, i) => (
                <div key={c.CustKey}
                  onClick={() => { setSelectedCust(c); setCustSearch(c.CustName); setShowCustDrop(false); custNav.reset(); }}
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
        {selectedCust && (
          <button className="btn btn-sm" onClick={() => { setSelectedCust(null); setCustSearch(''); }}>✕</button>
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
        <button type="button" onClick={checkFixStatus} disabled={fixStatusLoading || fixWorking || rangeUnfixWorking || !weekNum}
          title={`${weekNum}차 기준 확정/미확정/음수재고 현황 확인 후 확정 또는 구간 확정취소`}
          style={{
            padding: '3px 12px', fontSize: 11, fontWeight: 700, cursor: fixStatusLoading ? 'wait' : 'pointer',
            borderRadius: 14, marginLeft: 4,
            border: '1.5px solid #1565c0', background: fixStatusLoading ? '#90caf9' : '#1565c0', color: '#fff',
          }}>
          {fixStatusLoading ? '⏳ 확인중...' : '🔎 확정 현황 확인'}
        </button>

        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => load(false)}>🔄 조회 / Buscar</button>
          <button className="btn" disabled title="불량/검역 등록 버튼으로 저장하세요">💾 저장 (불량/검역 등록 사용)</button>
          <button className="btn" onClick={handlePrint}>🖨️ 견적서 출력</button>
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
        <div className="card" style={{overflow:'hidden', display:'flex', flexDirection:'column'}}>
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
                          ref={el => { if (el) el.indeterminate = selectedGroups.size > 0 && selectedGroups.size < shipments.length; }}
                          checked={shipments.length > 0 && selectedGroups.size === shipments.length}
                          onChange={() => {
                            if (selectedGroups.size === shipments.length) setSelectedGroups(new Set());
                            else setSelectedGroups(new Set(shipments.map(s => `${s.ParentWeek}_${s.CustKey}`)));
                          }}
                          title="전체 선택/해제"/>
                      </th>
                      <th>차수</th><th>거래처</th><th>담당자</th>
                      <th style={{textAlign:'right'}}>총 합계금액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      // 최근 2개 부모차수만 필터 (recentOnly=true 시)
                      let displayShips = shipments;
                      if (recentOnly && shipments.length > 0) {
                        const uniqueParents = [...new Set(shipments.map(s => s.ParentWeek))]
                          .sort((a, b) => String(b).localeCompare(String(a))).slice(0, 2);
                        displayShips = shipments.filter(s => uniqueParents.includes(s.ParentWeek));
                      }
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
                        const groupId = `${s.ParentWeek}_${s.CustKey}`;
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
        <div className="card" style={{overflow:'hidden', display:'flex', flexDirection:'column'}}>
          <div className="card-header" style={{flexWrap:'wrap', gap:6}}>
            <span className="card-title">■ 견적서 목록</span>
            {selectedShip && <span style={{fontSize:12, color:'var(--blue)', fontWeight:'bold'}}>{selectedShip.CustName}</span>}
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
              {/* ── 단가 수정 모드 선택 + 적용 버튼 (P3) ── */}
              {(editedCount > 0 || editedQtyCount > 0) && (
                <button
                  className="btn btn-sm"
                  style={{background:'#6a1b9a', color:'#fff', borderColor:'#4a148c', fontWeight:'bold'}}
                  disabled={costApplying || qtyApplying}
                  onClick={applyAllEdits}
                  title="단가와 수량 변경분을 한 번의 확정해제/저장/재확정 흐름으로 처리"
                >
                  수정 저장 ({editedCount + editedQtyCount})
                </button>
              )}
              {editedCount > 0 && editedQtyCount === 0 && (
                <>
                  <select
                    value={costMode}
                    onChange={e => setCostMode(e.target.value)}
                    style={{fontSize:11, padding:'3px 6px', borderRadius:4, border:'1px solid #CBD5E0'}}
                    disabled={costApplying}
                    title="수정한 단가를 어떻게 저장할지 선택"
                  >
                    <option value="once">① 1회성 (이 견적서만)</option>
                    <option value="fixed">② 거래처 고정 (이후 모든 차수)</option>
                    <option value="weekFav">③ 이 차수 즐겨찾기</option>
                  </select>
                  <button
                    className="btn btn-sm"
                    style={{background:'#2b6cb0', color:'#fff', borderColor:'#1e4e8c', fontWeight:'bold'}}
                    disabled={costApplying}
                    onClick={applyCostEdits}
                  >
                    단가 적용하기 ({editedCount})
                  </button>
                  <button
                    className="btn btn-sm"
                    disabled={costApplying}
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
                    disabled={qtyApplying}
                    onClick={applyQtyEdits}
                    title="수량 변경분을 ADD/CANCEL 로 자동 분기 적용 (이력 기록됨)"
                  >
                    📦 수량 수정 적용 ({editedQtyCount})
                  </button>
                  <button
                    className="btn btn-sm"
                    disabled={qtyApplying}
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
                onClick={() => {
                  setDefectForm({ estimateType:'', estimateDate:new Date().toISOString().slice(0,10), prodKey:'', unit:'단', quantity:'', cost:'', descr:'' });
                  setShowDefect(true);
                }}>
                ＋ 불량/검역 등록 / Reg. Defecto
              </button>
              <button className="btn btn-sm" disabled title="견적 품목은 표 안의 수량/단가 수정 적용 버튼으로 변경하세요.">✏️ 수정 / Editar</button>
              <button className="btn btn-sm" disabled title="견적 품목 삭제 API는 아직 연결되어 있지 않습니다." style={{color:'var(--red)'}}>🗑️ 삭제 / Eliminar</button>
            </div>
          </div>

          {/* 견적서 테이블 */}
          <div style={{overflowY:'auto', flex:1}}>
            {itemLoading
              ? <div className="skeleton" style={{height:200, margin:12}}></div>
              : (
                <table className="tbl">
                  <thead>
                    <tr>
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
                      ? <tr><td colSpan={10} style={{textAlign:'center', padding:32, color:'var(--text3)'}}>
                          {selectedId ? '견적서 데이터 없음' : '거래처를 선택하세요'}
                        </td></tr>
                      : filteredItems.map((item, i) => {
                          const isDed = isEstimateDeductionRow(item);
                          const sdk = item.SdetailKey;
                          const editKey = getItemEditKey(item);
                          const editVal = editKey ? (costEdits[editKey] ?? '') : '';
                          const isEdited = editVal !== '' && !isNaN(parseFloat(editVal)) && parseFloat(editVal) !== item.Cost;
                          return (
                          <tr key={i} style={{background: isEdited ? '#E6F7FF' : (isDed ? '#FFF8DC' : '')}}>
                            <td style={{fontSize:12, fontWeight:500, color: isDed ? '#A0522D' : ''}}>
                              {isDed && <span style={{fontSize:10, color:'#B8860B', marginRight:3}}>
                                [{mapEstimateType(item.EstimateType)}]
                              </span>}
                              {item.ProdName}
                            </td>
                            <td style={{fontSize:12}}>{item.Unit}</td>
                            <td style={{fontFamily:'var(--mono)', fontSize:12}}>{fmtDate(item.outDate)}</td>
                            <td className="num" style={{color: isDed ? '#C0392B' : ''}}>{fmt(item.Quantity)}</td>
                            <td style={{textAlign:'right', padding:'2px 4px', background:'#F0FFFE'}}>
                              {!editKey ? (
                                <span style={{fontSize:10, color:'var(--text3)'}}>—</span>
                              ) : (
                                <input
                                  type="number"
                                  value={editKey ? (qtyEdits[editKey] ?? '') : ''}
                                  onChange={e => {
                                    const v = e.target.value;
                                    setQtyEdits(prev => {
                                      const next = { ...prev };
                                      if (v === '') delete next[editKey];
                                      else next[editKey] = v;
                                      return next;
                                    });
                                  }}
                                  placeholder={isDed ? fmt(Math.abs(Number(item.Quantity || 0))) : fmt(item.Quantity)}
                                  style={{
                                    width: 70,
                                    padding: '2px 5px',
                                    textAlign: 'right',
                                    fontSize: 12,
                                    border: (editKey && qtyEdits[editKey] !== undefined && qtyEdits[editKey] !== '') ? '2px solid #00897b' : '1px solid #CBD5E0',
                                    borderRadius: 3,
                                    fontFamily: 'var(--mono)',
                                    background: (editKey && qtyEdits[editKey] !== undefined && qtyEdits[editKey] !== '') ? '#E0F2F1' : '#fff',
                                  }}
                                  disabled={qtyApplying || !editKey}
                                  title="수량 변경: ADD(증가) / CANCEL(감소)"
                                />
                              )}
                            </td>
                            <td className="num">{fmt(item.Cost)}</td>
                            <td style={{textAlign:'right', padding:'2px 4px', background:'#FFFDF5'}}>
                              {!editKey ? (
                                <span style={{fontSize:10, color:'var(--text3)'}}>—</span>
                              ) : (
                                <input
                                  type="number"
                                  value={editVal}
                                  onChange={e => {
                                    const v = e.target.value;
                                    setCostEdits(prev => {
                                      const next = { ...prev };
                                      if (v === '') delete next[editKey];
                                      else next[editKey] = v;
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
                                  disabled={costApplying || !editKey}
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
                      <td colSpan={3} style={{fontWeight:'bold', padding:'3px 6px', fontSize:12}}>합계</td>
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
          </div>
        </div>
      </div>

      {/* ── 단가 적용 로딩/결과 모달 (P3) ── */}
      {(costApplying || costResult) && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                {costApplying && !costResult ? `🔄 ${editApplyTitle} 중...` : (costResult?.success ? `✅ ${editApplyTitle} 완료` : '❌ 오류')}
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

              {costResult && costResult.success && (
                <div style={{ padding: 12, background: '#F0FFF4', border: '1px solid #9AE6B4', borderRadius: 6, fontSize: 12 }}>
                  <div><strong>수정된 품목:</strong> {costResult.changedCount}건</div>
                  {costResult.type !== 'quantity' && (
                    <div><strong>공급가 변동:</strong> {costResult.totalDiff >= 0 ? '+' : ''}{(costResult.totalDiff || 0).toLocaleString()}원</div>
                  )}
                  <div style={{ marginTop: 6, color: '#2f855a' }}>
                    견적서가 재로딩되었습니다. 새 {costResult.type === 'quantity' ? '수량' : '단가'}가 반영된 것을 확인하세요.
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

      {/* ── 견적서 출력 다이얼로그 ── */}
      {showPrintDialog && (
        <div className="modal-overlay" onClick={() => setShowPrintDialog(false)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                🖨️ {isStatementPrintFormat(printOpts.printFormat) ? '거래명세표' : '견적서'} 출력 옵션
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
                    [ESTIMATE_PRINT_FORMAT.ESTIMATE, '견적서 (기존)'],
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
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input type="checkbox"
                      checked={printOpts.showBoxQty !== false}
                      onChange={e => setPrintOpts(o => ({ ...o, showBoxQty: e.target.checked }))}
                    />
                    박스수량 표시
                  </label>
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
                </div>
              </div>

              {/* 미리보기 요약 — 인쇄와 동일 byDate 데이터 + 출고구분(outType) 반영 */}
              <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '8px 12px', fontSize: 11, color: 'var(--text2)' }}>
                {printDayInfo.loading ? (
                  <div>미리보기 계산 중…</div>
                ) : selectedGroups.size > 0 ? (
                  <>
                    <div>선택 거래처: <b>{selectedGroups.size}건</b></div>
                    <div>양식: <b>{isStatementPrintFormat(printOpts.printFormat) ? '거래명세표' : '견적서'}</b></div>
                    <div>출고 구분: <b>{printOpts.outType === 'select' ? '선출고 (정상출고만)' : '종합출고 (전체)'}</b></div>
                    <div>인쇄 항목: <b>{printPreviewItems.length}건</b>
                      {printOpts.outType === 'total' && printPreviewDedCount > 0 && (
                        <span style={{ color: '#A0522D' }}> (정상 {printPreviewShipCount} + 차감 {printPreviewDedCount})</span>
                      )}
                    </div>
                    <div>합계: <b>₩{(printPreviewSupply + printPreviewVat).toLocaleString()}</b>
                      {' '}(공급가 ₩{printPreviewSupply.toLocaleString()} + 세액 ₩{printPreviewVat.toLocaleString()})
                      {printPreviewTotals.approximate && (
                        <span style={{ color: 'var(--text3)' }}> · 거래명세표 합계는 인쇄 시 품목 합산 후 재계산</span>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <div>거래처: <b>{selectedShip?.CustName || '-'}</b></div>
                    <div>차수: <b>{weekNum || '-'}</b></div>
                    <div>양식: <b>{isStatementPrintFormat(printOpts.printFormat) ? '거래명세표' : '견적서'}</b></div>
                    <div>출고 구분: <b>{printOpts.outType === 'select' ? '선출고 (정상출고만)' : '종합출고 (전체)'}</b></div>
                    <div>인쇄 항목: <b>{printPreviewItems.length}건</b>
                      {printOpts.outType === 'total' && printPreviewDedCount > 0 && (
                        <span style={{ color: '#A0522D' }}> (정상 {printPreviewShipCount} + 차감 {printPreviewDedCount})</span>
                      )}
                    </div>
                    <div>합계: <b>₩{(printPreviewSupply + printPreviewVat).toLocaleString()}</b>
                      {' '}(공급가 ₩{printPreviewSupply.toLocaleString()} + 세액 ₩{printPreviewVat.toLocaleString()})
                      {printPreviewTotals.approximate && (
                        <span style={{ color: 'var(--text3)' }}> · 거래명세표 합계는 인쇄 시 품목 합산 후 재계산</span>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => doActualPrint(printOpts)}>
                🖨️ {isStatementPrintFormat(printOpts.printFormat) ? '거래명세표' : '견적서'} 출력 실행
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
                        const res = await fetch(`/api/shipment/fix-status?fromWeek=${encodeURIComponent(range.fromWeek)}&toWeek=${encodeURIComponent(range.toWeek)}`, { credentials: 'same-origin' });
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
                    ? ' 음수재고 경고가 포함되어 있습니다. 전산 SP 기준으로 가능한 품목군만 확정 시도합니다.'
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
                              {' '}— <b style={{ color: '#c62828' }}>부족 {Math.abs(Number(n.remain) || 0)}</b>
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
                    <div style={{ fontSize: 11, marginTop: 4, color: '#555' }}>
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
                    if (true) return null; // [비활성화 2026-07-07] 재고조정이 앞차수 부풀림 유발 — 재설계 전까지 숨김
                    if (!negRows.length) return null;
                    return (
                      <button
                        className="btn"
                        style={{ background: '#2e7d32', color: '#fff', borderColor: '#1b5e20', fontWeight: 700 }}
                        onClick={() => {
                          const lines = negRows.slice(0, 30).map(n =>
                            `· ${n.FlowerName || ''} ${n.ProdName} : 부족 ${Math.abs(Number(n.remain) || 0)}`);
                          const more = negRows.length > 30 ? `\n… 외 ${negRows.length - 30}건` : '';
                          if (!confirm(`음수 잔량 ${negRows.length}건에 부족분만큼 재고를 자동 추가한 뒤 확정합니다.\n\n${lines.join('\n')}${more}\n\n진행하시겠습니까?`)) return;
                          doFixAll(fixModal.weekList, false, [], { autoStockAdd: true });
                        }}
                        disabled={fixWorking}
                      >
                        📦 재고 추가 후 확정 (음수 {negRows.length}건)
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
                    {false && negFail && !fixModal.autoStockAddUsed && (/* [비활성화 2026-07-07] 재고추가후확정 부풀림 문제 */
                      <button
                        className="btn"
                        style={{ background: '#2e7d32', color: '#fff', borderColor: '#1b5e20', fontWeight: 700 }}
                        disabled={fixWorking}
                        onClick={() => {
                          if (!confirm('음수 잔량으로 확정 실패한 차수에 부족분만큼 재고를 자동 추가한 뒤 다시 확정합니다.\n\n(전산과 동일한 재고조정 → 재고재계산 → 확정)\n\n진행하시겠습니까?')) return;
                          doFixAll(fixModal.weekList, false, fixModal.countryFlowers || [], {
                            autoStockAdd: true,
                            resultTitle: fixModal.resultTitle || '재고 추가 후 재확정 결과',
                          });
                        }}
                      >
                        📦 재고 추가 후 재확정
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

      {/* ── 불량/검역 등록 모달 ── */}
      {showDefect && (
        <div className="modal-overlay" onClick={() => setShowDefect(false)}>
          <div className="modal" style={{maxWidth:480}} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">불량/검역 등록</span>
              <button className="btn btn-sm" onClick={() => setShowDefect(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{fontWeight:'bold', fontSize:12, marginBottom:10, borderBottom:'1px solid var(--border)', paddingBottom:6}}>
                ■ 불량/검역 정보
              </div>

              {/* 구분 + 견적일자 */}
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">구 분</label>
                  {/* 검색 가능 드롭다운 */}
                  <SearchableSelect
                    options={estimateTypeOptions}
                    value={defectForm.estimateType}
                    onChange={v => setDefectForm(f => ({...f, estimateType: v}))}
                    placeholder="구분 검색..."
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">견적일자</label>
                  <input type="date" className="form-control"
                    value={defectForm.estimateDate}
                    onChange={e => setDefectForm(f => ({...f, estimateDate: e.target.value}))}
                  />
                </div>
              </div>

              {/* 품목명 — 검색 가능 드롭다운 */}
              <div className="form-row form-row-1">
                <div className="form-group">
                  <label className="form-label">품목명</label>
                  <SearchableSelect
                    options={prodOptions}
                    value={defectForm.prodKey}
                    onChange={v => setDefectForm(f => ({...f, prodKey: v}))}
                    placeholder="품목명 검색... (예: CARNATION)"
                  />
                </div>
              </div>

              {/* 수량 + 단가 */}
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
                  <label className="form-label">단 가</label>
                  <input type="number" min={0} className="form-control"
                    value={defectForm.cost}
                    onChange={e => setDefectForm(f => ({...f, cost: e.target.value}))}
                    placeholder="0"
                  />
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
              <button className="btn btn-primary" onClick={handleDefectSave} disabled={saving}>
                💾 {saving ? '저장 중... / Guardando' : '저장'}
              </button>
              <button className="btn" onClick={() => setShowDefect(false)}>{t('닫기')}</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
