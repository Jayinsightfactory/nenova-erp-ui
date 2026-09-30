// 견적서/거래명세표 공통 순수 HTML 빌더 — DB/DOM/인쇄 부작용 없음.
import {
  ESTIMATE_PRINT_FORMAT,
  getEstimateOriginCountry,
  getEstimateSpecLabel,
  getStatementProductName,
  getPrintFormatDocTitle,
  isSupplyPrintFormat,
} from './estimatePrintFormats.js';
import { estimateTypeLabel, prepareEstimatePrintRows } from './estimatePrintPrepare.js';
import { isEstimateDeductionRow } from './estimateInvariants.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── 한글 금액 변환 (52,434,150 → "오천이백사십삼만사천일백오십원 정")
export function numToKorean(n) {
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
export function formatExePrintDate(value) {
  const text = String(value || '').trim();
  const m = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}/${String(m[2]).padStart(2, '0')}/${String(m[3]).padStart(2, '0')}`;
  return text;
}

/** Output-only HTML; the caller owns iframe loading, printing, and cleanup. */
export function buildEstimateHtml({
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
    const esc = escapeHtml(content);
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
<title>${escapeHtml(docTitle)} — ${escapeHtml(custName)}</title>
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
.info-table td.info-key { font-size:9pt; background:#f5f5f5; font-weight:bold; color:#333; width:27.3mm; }
.info-table td.info-val { width:auto; font-size:8pt; }
/* 로고: exe xrPictureBox1 약 55.5×18mm, Zoom */
.logo-area { text-align:center; border-bottom:1px solid #555; padding:2mm 3mm; margin:0; line-height:0; background:#fff;
             height:18mm; overflow:hidden; display:flex; align-items:center; justify-content:center; }
.logo-area img { display:block; height:16mm; max-height:16mm; max-width:92%; object-fit:contain; }
.greet     { font-size:8pt; padding:6px 8px; border-top:1px solid #ddd; line-height:1.7; }
.amt-row   { border:1px solid #555; border-top:none; padding:5px 10px;
             display:flex; justify-content:space-between; align-items:center; margin-bottom:0; }
.amt-ko    { font-weight:bold; font-size:10pt; }
.amt-num   { font-size:10pt; font-weight:bold; }
.item-th   { background:#e8e8e8; border:1px solid #888; padding:3px 5px; font-size:9pt; font-weight:bold; height:6.35mm; text-align:center; }
/* xrTable5: 63.5 tenths mm; table-cell height is a minimum for wrapped content. */
.item-table tbody td { font-size:8pt; height:6.35mm; }
.foot-row td { background:#f5f5f5; border:1px solid #888; padding:3px 8px; font-size:9pt; font-weight:bold; }
@media print { @page{size:A4;margin:0;} body{padding:10mm 15mm;}
  .logo-area{height:18mm;padding:1.5mm 2mm;} .logo-area img{height:16mm;max-height:16mm;} }
</style>
</head><body>
<h1>${escapeHtml(heading)}</h1>

<table class="hdr-outer">
  <tr>
    <td class="hdr-left">
      <!-- 왼쪽: 수신/청조 그리드 (exe xrTable2) -->
      <table class="info-table">
        <colgroup><col style="width:27.3mm"><col></colgroup>
        <tr><td class="info-key">일련번호</td><td class="info-val">${escapeHtml(serialDisplay)}</td></tr>
        <tr><td class="info-key">수&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;신</td><td class="info-val"><b>${escapeHtml(custName)}</b></td></tr>
        <tr><td class="info-key">참&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;조</td><td class="info-val"></td></tr>
        <tr><td class="info-key">TEL/FAX</td><td class="info-val"></td></tr>
        <tr><td class="info-key">결제조건</td><td class="info-val"></td></tr>
        <tr><td class="info-key">유효기간</td><td class="info-val"></td></tr>
        <tr><td class="info-key">비&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;고</td><td class="info-val">${escapeHtml(bigoLabel)}</td></tr>
      </table>
      <div class="greet">
        1. 귀사의 일익 번창하심을 기원합니다.<br>
        ${greetLine2}
      </div>
    </td>
    <td class="hdr-right">
      <!-- 오른쪽: NENOVA 로고 (로컬 base64 인라인) + 회사정보 -->
      <div class="logo-area">
        <img src="${escapeHtml(logoDataUrl)}" alt="NENOVA"
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
</body></html>`;
}
