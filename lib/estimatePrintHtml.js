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
  custTel = '',
  rows,
  logoDataUrl,
  aggregate = false,
  showBoxQty = true,
  showDistribDesc = false,
  showDeductionOutDay = false,
  showDeductionDescr = false,
  printFormat = ESTIMATE_PRINT_FORMAT.ESTIMATE,
  nativeLayout = false,
  editableRemarks = false,
  headerNoteId = '',
}) {
  const docTitle = getPrintFormatDocTitle(printFormat);
  const prepared = prepareEstimatePrintRows(rows, {
    printFormat,
    showDistribDesc,
    showDeductionOutDay,
    showDeductionDescr,
  });
  const { rows: printRows, totals, statementFormat, descLabel } = prepared;
  const native = nativeLayout === true && !statementFormat;
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
      const descr = r._printNoteOverride === true ? r.Descr : descLabel(r);
      return `
    <tr>
      ${td(i + 1, `${rowBg}text-align:center;padding:2px 3px;`)}
      ${td(productName, `${rowBg}padding:2px 10px;`)}
      ${native ? `<td style="border:1px solid #bbb;vertical-align:middle;${rowBg}text-align:right;">${escapeHtml(unitQuantity).replace(/\(/g,'<wbr>(')}</td>` : td(unitQuantity, `${rowBg}text-align:right;white-space:nowrap;padding:2px 10px 2px 5px;`)}
      ${td(fmtN(r.Cost), `${rowBg}text-align:right;white-space:nowrap;padding:2px 10px 2px 5px;`)}
      ${td(fmtN(r.Amount), `${rowBg}text-align:right;white-space:nowrap;padding:2px 10px 2px 5px;`)}
      ${td(fmtN(r.Vat), `${rowBg}text-align:right;white-space:nowrap;padding:2px 10px 2px 5px;`)}
      ${editableRemarks && r._printNoteId ? `<td style="border:1px solid #bbb;${rowBg}padding:2px 10px;font-size:8pt;"><textarea class="print-note-input" data-print-note-id="${escapeHtml(r._printNoteId)}" aria-label="${escapeHtml(productName)} 적요" maxlength="1000" rows="2">${escapeHtml(descr)}</textarea><span class="print-note-value" style="white-space:pre-wrap">${escapeHtml(descr)}</span></td>` : td(descr, `${rowBg}padding:2px 10px;font-size:8pt;`)}
    </tr>`;
    }).join('');

    // ReportEstimate.cs item table: 7열·weight 합계 3.0 (1800 tenths mm).
    itemColGroup = `
      <colgroup>
        <col style="width:5.882%"><col style="width:32.353%"><col style="width:9.444%">
        <col style="width:8.791%"><col style="width:12.941%"><col style="width:11.765%">
        <col style="width:18.824%">
      </colgroup>`;
    if(native) itemColGroup='<colgroup>'+[10.588235,58.235287,17,15.823528,23.294115,21.176469,33.882366].map(width=>`<col style="width:${width/180*100}%">`).join('')+'</colgroup>';
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
  // ReportEstimate (254 dpi / TenthsOfAMillimeter), opt-in for weekday allocation output.
  const nativeCss = native ? `
.native-estimate { width:180mm; }
.native-report-header { position:relative; width:180mm; height:88.23121mm; break-inside:avoid; }
.native-estimate h1 { position:absolute; inset:0 auto auto 0; width:180mm; height:12.7mm; display:flex; align-items:center; justify-content:center; margin:0; padding:0 .5mm; }
.native-estimate .hdr-outer { position:absolute; top:17.43791mm; left:0; width:180mm; height:60.58958mm; display:block; border:0; }
.native-estimate .hdr-outer > tbody > tr { display:block; }
.native-estimate .hdr-left, .native-estimate .hdr-right { position:absolute; top:0; display:block; height:60.58958mm; padding:0; border:0; }
.native-estimate .hdr-left { left:0; width:86.17325mm; }
.native-estimate .hdr-right { left:87.6817mm; width:92.31828mm; }
.native-estimate .info-table td { padding:0 .5mm 0 1mm; border-color:#000; line-height:1.15; text-overflow:clip; }
.native-estimate .hdr-left .info-table tr { height:6.35mm; }
.native-estimate .hdr-left .info-table col:first-child, .native-estimate .hdr-left .info-key { width:27.302416mm !important; }
.native-estimate .hdr-right .info-table tr { height:6.670413mm; }
.native-estimate .hdr-right .info-table tr:nth-child(3) { height:9.037mm; }
.native-estimate .hdr-right .info-table tr:not(:nth-child(3)) { height:6.197mm; }
.native-estimate .hdr-right .info-table col:first-child, .native-estimate .hdr-right .info-key { width:29.249356mm !important; }
.native-estimate .info-key { text-align:center; }
.native-estimate .info-val { white-space:normal; overflow-wrap:anywhere; }
.native-estimate .greet { height:16.13958mm; border:1px solid #000; border-top:0; padding:0 .5mm 0 1mm; display:flex; align-items:center; font-size:9pt; line-height:1.5; }
.native-estimate .logo-area { position:relative; height:20.5671mm; padding:0; border:1px solid #000; border-bottom:0; display:block; }
.native-estimate .logo-area img { position:absolute; left:22.37018mm; top:1.058333mm; width:55.54119mm; height:17.99167mm; max-width:none; max-height:none; object-fit:contain; }
.native-estimate .native-amount { position:absolute; top:79.5mm; left:0; width:180mm; height:7.5mm; table-layout:fixed; border:1px solid #000; font-size:9.75pt; }
.native-estimate .native-amount td { padding:0 .529167mm; vertical-align:middle; }
.native-estimate .item-table { width:180mm; table-layout:fixed; }
.native-estimate .item-th { width:auto !important; height:6.35mm; padding:0 .529167mm; border-color:#000; background:#fff; }
.native-estimate .item-table tbody td { height:6.35mm; padding:0 1mm 0 .5mm !important; border-color:#000 !important; line-height:1.15; }
.native-estimate .item-table tbody td:first-child { padding:0 .529167mm !important; }
.native-estimate .item-table tbody td:nth-child(3) { white-space:normal; overflow-wrap:anywhere; }
.native-estimate .item-table tbody td:nth-child(2), .native-estimate .item-table tbody td:nth-child(7) { padding:0 .5mm 0 1mm !important; overflow-wrap:anywhere; }
.native-estimate .native-footer { width:180mm; table-layout:fixed; margin-top:1.058333mm; break-inside:avoid; }
.native-estimate .native-footer td { height:7.5mm; padding:0 1mm 0 .5mm; border:1px solid #000; font-size:9pt; text-align:right; }
.native-estimate .native-footer td:nth-child(odd) { font-size:10pt; font-weight:bold; text-align:center; border-right:0; white-space:nowrap; background:#f5f5f5; }
.native-estimate .native-footer td:nth-child(even) { border-left:0; }
/* Native page margins must repeat on every sheet, not just at body edges. */
@media print {
  @page { size:A4; margin:10mm 15mm; }
  body { padding:0; }
  .native-estimate .item-table thead { display:table-header-group; }
  .native-estimate .item-table tr { break-inside:avoid; page-break-inside:avoid; }
  .native-estimate .item-table td { break-inside:avoid; page-break-inside:avoid; }
  .native-estimate .logo-area { height:20.5671mm; padding:0; }
  .native-estimate .logo-area img { height:17.99167mm; max-height:none; }
}
` : '';
  const nativeFooter=native?`<table class="native-footer"><colgroup>${[15.882357,37.058831,15.882356,37.05883,15.882357,58.235269].map(width=>`<col style="width:${width/180*100}%">`).join('')}</colgroup><tbody><tr><td>공급가액</td><td>${fmtN(totalSupply)}</td><td>VAT</td><td>${fmtN(totalVat)}</td><td>합계</td><td>${fmtN(totalAmt)}</td></tr></tbody></table>`:'';

  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<title>${escapeHtml(docTitle)} — ${escapeHtml(custName)}</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:Gulim,'굴림','Malgun Gothic','맑은 고딕',sans-serif; font-size:9pt; padding:10mm 15mm; }
.print-note-input { width:100%; min-height:2.3em; resize:vertical; border:1px solid #91abc9; background:#f6faff; font:inherit; padding:2px; }
.print-note-input:focus { outline:2px solid #2563eb; outline-offset:1px; }
.print-note-value { display:none; }
.print-note-value { white-space:pre-wrap; overflow-wrap:anywhere; }
input.print-note-input { min-height:0; height:5mm; }
@media print { .print-note-input { display:none !important; } .print-note-value { display:inline !important; } }
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
${nativeCss}
</style>
</head><body>
${native?'<div class="native-estimate"><div class="native-report-header">':''}
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
        <tr><td class="info-key">TEL/FAX</td><td class="info-val">${escapeHtml(custTel)}</td></tr>
        <tr><td class="info-key">결제조건</td><td class="info-val"></td></tr>
        <tr><td class="info-key">유효기간</td><td class="info-val"></td></tr>
        <tr><td class="info-key">비&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;고</td><td class="info-val">${editableRemarks&&headerNoteId?`<input class="print-note-input" aria-label="견적서 차수 표시" data-print-note-id="${escapeHtml(headerNoteId)}" maxlength="100" value="${escapeHtml(bigoLabel)}"><span class="print-note-value">${escapeHtml(bigoLabel)}</span>`:escapeHtml(bigoLabel)}</td></tr>
      </table>
      <div class="greet">
        ${native?'<div>':''}
        1. 귀사의 일익 번창하심을 기원합니다.<br>
        ${greetLine2}
        ${native?'</div>':''}
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
${native?`<table class="native-amount"><colgroup>${[16.857358,69.315914,68.869361,24.957366].map(width=>`<col style="width:${width/180*100}%">`).join('')}</colgroup><tbody><tr><td style="text-align:right">금 액 :</td><td>${numToKorean(totalAmt)}</td><td style="text-align:right">(￦ ${fmtN(totalAmt)}원)</td><td>/ VAT 포함</td></tr></tbody></table></div>`:`
<div class="amt-row">
  <span class="amt-ko">금 액 : ${numToKorean(totalAmt)}</span>
  <span class="amt-num">(￦ ${fmtN(totalAmt)}원${amtSuffix})</span>
</div>`}

<!-- 품목 테이블 -->
<table class="item-table">
  ${itemColGroup}
  <thead>
    ${tableHead}
  </thead>
  <tbody>${itemRows}</tbody>
  ${native?'':`<tfoot>
    ${tableFoot}
  </tfoot>`}
</table>
${nativeFooter}${native?'</div>':''}
</body></html>`;
}
