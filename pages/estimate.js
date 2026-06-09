// pages/estimate.js
// 견적서 관리
// 수정이력: 2026-03-27 — 차수/업체 검색 추가, 불량/검역 모달 품목 검색 드롭다운, 검색가능 드롭다운 컴포넌트 추가

import { useState, useEffect, useRef, useCallback } from 'react';
import { apiGet, apiPost } from '../lib/useApi';
import { getCurrentWeek } from '../lib/useWeekInput';
import { useLang } from '../lib/i18n';
import { useDropdownNav } from '../lib/useDropdownNav';

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
function fmtDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${String(d.getDate()).padStart(2,'0')}(${DAY_KR[d.getDay()]})`;
}

const fmt = n => Number(n || 0).toLocaleString();
const WEEKDAYS = ['월','화','수','목','금','토','일'];

function parseAppLogTime(value) {
  const text = String(value || '').trim();
  if (!text) return 0;
  const dt = new Date(`${text.replace(' ', 'T')}+09:00`);
  const ms = dt.getTime();
  return Number.isFinite(ms) ? ms : 0;
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
function isPrintableEstimateRow(row) {
  const qty = Number(row?.Quantity) || 0;
  return qty !== 0;
}

function buildEstimateHtml({
  bigoLabel,
  serialNo,
  printDate,
  custName,
  rows,
  logoDataUrl,
  aggregate = false,
  showBoxQty = true,
  showDistribDesc = true,
}) {
  // ── 인쇄용: 수량 또는 단가가 0인 행 제거
  rows = rows.map(normalizeEstimatePrintRow).filter(isPrintableEstimateRow);

  // ── 사장님 지정 정렬 우선순위
  // 콜롬비아 수국→알스트로→루스커스→카네이션→장미 → 네덜란드 → 호주 → 중국 → 에콰도르
  // → 운송료 → 운임 → 그 외 차감
  const isDeductRow = r => r.EstimateType && r.EstimateType !== '정상출고';
  const priorityOf = r => {
    const isDed = isDeductRow(r);
    const country = r.CounName || '';
    const flower = r.FlowerName || '';
    const prod = r.ProdName || '';
    if (!isDed) {
      if (/콜롬비아/.test(country)) {
        if (/수국/.test(flower)) return 1;
        if (/알스트로/.test(flower)) return 2;
        if (/루스커스/.test(flower)) return 3;
        if (/카네이션/.test(flower)) return 4;
        if (/장미/.test(flower)) return 5;
        return 6;
      }
      if (/네덜란드/.test(country)) return 10;
      if (/호주/.test(country)) return 11;
      if (/중국/.test(country)) return 12;
      if (/에콰도르/.test(country)) return 13;
      return 50;
    }
    if (/운송/.test(prod)) return 79;
    if (/운임/.test(prod)) return 80;
    return 99;
  };
  const sortedRows = [...rows].sort((a, b) => {
    const pa = priorityOf(a); const pb = priorityOf(b);
    if (pa !== pb) return pa - pb;
    const adt = a.outDate || ''; const bdt = b.outDate || '';
    if (adt !== bdt) return adt.localeCompare(bdt);
    return (a.ProdName || '').localeCompare(b.ProdName || '');
  });
  rows = sortedRows;
  const fmtN = n => Number(n || 0).toLocaleString();

  // 품목명: [차감유형] ProdName (정상출고는 prefix 없음)
  const typeLabel = t => {
    if (!t || t === '정상출고') return '';
    return '[' + mapEstimateType(t) + '] ';
  };

  // 차감 여부 판별
  const isDeduct = isDeductRow;

  // 적요: 차감 행은 출고일(DD일), 정상출고는 Descr 또는 빈 값
  const descLabel = r => {
    if (isDeduct(r) && r.outDate) return new Date(r.outDate).getDate() + '일';
    if (showDistribDesc && r._distribDesc) return r._distribDesc;  // 차수별 분배 표시 (1차 N단, 2차 M단)
    return r.Descr || '';
  };

  // ── 같은 ProdKey 끼리 항상 합산 + 차수별 breakdown 적요에 표시 (1차/2차 모두 보이게)
  // aggregate 옵션 제거 — 항상 활성화 (옛 명세 사장님 요구사항)
  {
    const groups = {};   // key = `${EstimateType}|${ProdKey}|${Unit}|${Cost}`
    rows.forEach(r => {
      const costKey = Number(r.Cost || 0).toFixed(4);
      const key = `${r.EstimateType || '정상출고'}|${r.ProdKey || r.ProdName}|${r.Unit || ''}|${costKey}`;
      if (!groups[key]) groups[key] = { ...r, Quantity: 0, BoxQty: 0, Amount: 0, Vat: 0, _breakdown: {}, _outDates: new Set() };
      const g = groups[key];
      g.Quantity += (Number(r.Quantity) || 0);
      g.BoxQty   += (Number(r.BoxQty)   || 0);
      g.Amount   += (Number(r.Amount)   || 0);
      g.Vat      += (Number(r.Vat)      || 0);
      // OrderWeek 형식 "14-01" → "1차" / "14-02" → "2차"
      const ow = r.OrderWeek || '';
      const subM = ow.match(/-(\d+)$/);
      const subLabel = subM ? `${parseInt(subM[1])}차` : (ow || '');
      if (subLabel) {
        g._breakdown[subLabel] = (g._breakdown[subLabel] || 0) + (Number(r.Quantity) || 0);
      }
      if (r.outDate) g._outDates.add(r.outDate);
    });
    rows = Object.values(groups).map(g => {
      const qty = Number(g.Quantity) || 0;
      const supply = Number(g.Amount) || 0;
      const vat = Number(g.Vat) || 0;
      // 23-01/23-02 등 차수 합산 후에도 단가×수량=공급가가 맞도록 실효 단가 재계산
      // (Freedom 장미처럼 출고분배는 맞는데 견적 출력 합계만 틀리던 케이스)
      // 단가 = nenova.exe 견적과 동일: 저장된 Cost(부가세 포함 단가) = (공급가액+부가세)/수량.
      // (차수 합산 후에도 단가×수량 = 공급가액+부가세 유지. 과거엔 정상출고를 공급가액/수량으로
      //  계산해 부가세가 빠진 단가가 표시돼 nenova 와 어긋났음.)
      if (qty > 0 && (supply + vat) > 0) {
        g.Cost = Math.round((supply + vat) / qty);
      }
      const parts = Object.entries(g._breakdown)
        .filter(([_, v]) => v > 0)
        .sort(([a],[b]) => a.localeCompare(b))
        .map(([k, v]) => `${k} ${fmtN(v)}${g.Unit||''}`);
      g._distribDesc = parts.join(', ');
      return g;
    });
  }

  // ── 최종 정렬: 품종(국가+꽃) 우선순위 1차 → 같은 품종 안에서는 품목명 ABC 순.
  // (합산 전 정렬은 출고일을 품목명보다 먼저 보므로, 같은 품종에서 출고일이 빠른 품목이
  //  앞서는 문제가 있었음. 예: CARNATION Brut(06-03) 가 CARNATION Apple Tea(06-07) 보다 먼저.)
  rows.sort((a, b) => {
    const pa = priorityOf(a); const pb = priorityOf(b);
    if (pa !== pb) return pa - pb;
    return (a.ProdName || '').localeCompare(b.ProdName || '', 'en', { numeric: true, sensitivity: 'base' });
  });

  const totalSupply = rows.reduce((a, r) => a + (Number(r.Amount) || 0), 0);
  const totalVat    = rows.reduce((a, r) => a + (Number(r.Vat) || 0), 0);
  const totalAmt    = totalSupply + totalVat;

  const itemRows = rows.map((r, i) => {
    const deduct = isDeduct(r);
    const rowBg  = deduct ? 'background:#FFF8DC;' : '';
    const amtClr = '';
    const boxCell = showBoxQty
      ? `<td style="${rowBg}${amtClr}text-align:right;border:1px solid #bbb;padding:2px 5px;white-space:nowrap;color:#555">${fmtN(r.BoxQty || 0)}박스</td>`
      : '';
    return `
    <tr>
      <td style="${rowBg}text-align:center;border:1px solid #bbb;padding:2px 3px;width:28px">${i + 1}</td>
      <td style="${rowBg}border:1px solid #bbb;padding:2px 6px;">${typeLabel(r.EstimateType)}${r.ProdName || ''}</td>
      <td style="${rowBg}${amtClr}text-align:right;border:1px solid #bbb;padding:2px 5px;white-space:nowrap">${fmtN(r.Quantity)}${r.Unit || ''}</td>
      ${boxCell}
      <td style="${rowBg}text-align:right;border:1px solid #bbb;padding:2px 6px">${fmtN(r.Cost)}</td>
      <td style="${rowBg}${amtClr}text-align:right;border:1px solid #bbb;padding:2px 6px">${fmtN(r.Amount)}</td>
      <td style="${rowBg}${amtClr}text-align:right;border:1px solid #bbb;padding:2px 6px">${fmtN(r.Vat)}</td>
      <td style="${rowBg}border:1px solid #bbb;padding:2px 5px;font-size:7.5pt;color:#555">${descLabel(r)}</td>
    </tr>`;
  }).join('');

  const serialDisplay = serialNo || printDate;
  const boxHeader = showBoxQty ? '<th class="item-th" style="width:46px">박스</th>' : '';
  const footerLabelColspan = showBoxQty ? 5 : 4;

  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<title>견적서 — ${custName}</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:'Malgun Gothic','맑은 고딕',sans-serif; font-size:9pt; padding:10mm 12mm; }
h1 { text-align:center; font-size:20pt; font-weight:bold; letter-spacing:16px; text-decoration:underline; margin-bottom:10px; }
table { width:100%; border-collapse:collapse; }
.hdr-outer { border:1px solid #555; }
.hdr-left  { width:48%; vertical-align:top; border-right:1px solid #555; }
.hdr-right { width:52%; vertical-align:top; padding:0; }
.hdr-row td { border:1px solid #ccc; padding:3px 8px; font-size:8.5pt; }
.hdr-key   { background:#f5f5f5; font-weight:bold; width:68px; }
/* 로고: 헤더 영역 가운데 정렬 + 사장님 양식과 동일한 사이즈 */
.logo-area { text-align:center; border-bottom:1px solid #555; padding:6px 8px; margin:0; line-height:0; background:#fff; height:64px; overflow:hidden;
             display:flex; align-items:center; justify-content:center; }
.logo-area img { display:block; height:52px; max-height:52px; max-width:90%; object-fit:contain; }
@media print { .logo-area { height:58px; padding:4px 6px; } .logo-area img { height:48px; max-height:48px; } }
/* 회사정보: 실제 테이블 2셀 (왼쪽정렬, 줄바꿈 방지, 셀 경계선) */
.co-table { width:100%; border-collapse:collapse; table-layout:fixed; }
.co-table td { border:1px solid #999; padding:4px 6px; font-size:7.5pt;
               white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
               text-align:left; vertical-align:middle; }
.co-table td.co-key { background:#f5f5f5; font-weight:bold; color:#333; width:40%; }
.co-table td.co-val { width:60%; }
.greet     { font-size:8pt; padding:6px 8px; border-top:1px solid #ddd; line-height:1.7; }
.amt-row   { border:1px solid #555; border-top:none; padding:5px 10px;
             display:flex; justify-content:space-between; align-items:center; margin-bottom:0; }
.amt-ko    { font-weight:bold; font-size:9pt; }
.amt-num   { font-size:8.5pt; }
.item-th   { background:#e8e8e8; border:1px solid #888; padding:3px 5px; font-size:8.5pt; text-align:center; }
.item-td   { border:1px solid #ccc; padding:2px 5px; font-size:8.5pt; vertical-align:middle; }
.foot-row td { background:#f5f5f5; border:1px solid #888; padding:3px 8px; font-size:8.5pt; font-weight:bold; }
@media print { body{padding:5mm 8mm;} @page{size:A4;margin:8mm;} }
</style>
</head><body>
<h1>견 &nbsp; 적 &nbsp; 서</h1>

<table class="hdr-outer">
  <tr>
    <td class="hdr-left">
      <!-- 왼쪽: 수신/청조 그리드 -->
      <table style="width:100%;border-collapse:collapse;">
        <tr class="hdr-row"><td class="hdr-key">일련번호</td><td>${serialDisplay}</td></tr>
        <tr class="hdr-row"><td class="hdr-key">수&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;신</td><td><b>${custName}</b></td></tr>
        <tr class="hdr-row"><td class="hdr-key">참&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;조</td><td></td></tr>
        <tr class="hdr-row"><td class="hdr-key">TEL/FAX</td><td></td></tr>
        <tr class="hdr-row"><td class="hdr-key">결제조건</td><td></td></tr>
        <tr class="hdr-row"><td class="hdr-key">유효기간</td><td></td></tr>
        <tr class="hdr-row"><td class="hdr-key">비&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;고</td><td>${bigoLabel}</td></tr>
      </table>
      <div class="greet">
        1. 귀사의 일익 번창하심을 기원합니다.<br>
        2. 하기와 같이 견적드리오니 검토하기 바랍니다.
      </div>
    </td>
    <td class="hdr-right">
      <!-- 오른쪽: NENOVA 로고 (로컬 base64 인라인) + 회사정보 -->
      <div class="logo-area">
        <img src="${logoDataUrl || '/nenova-logo.png'}" alt="NENOVA"
             onerror="this.style.display='none';this.nextElementSibling.style.display='block'"/>
        <div style="display:none;padding:8px 10px;font-size:18pt;font-weight:900;letter-spacing:4px;color:#1a3a6b;font-family:'Arial Black',Arial,sans-serif;text-align:left;">NENOVA</div>
      </div>
      <table class="co-table">
        <tr><td class="co-key">사업자등록번호</td><td class="co-val">134-86-94367</td></tr>
        <tr><td class="co-key">회사명/대표</td><td class="co-val">(주)네노바 / 김원배</td></tr>
        <tr><td class="co-key">주소</td><td class="co-val">서울 서초구 언남길 15-7, 102호</td></tr>
        <tr><td class="co-key">업태/종목</td><td class="co-val">도매 / 무역</td></tr>
        <tr><td class="co-key">계좌번호</td><td class="co-val">하나 630-008129-149</td></tr>
        <tr><td class="co-key">TEL / FAX</td><td class="co-val">02-575-8003 / 02-576-8003</td></tr>
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
    <tr>
      <th class="item-th" style="width:24px">순번</th>
      <th class="item-th">품목명[규격]</th>
      <th class="item-th" style="width:54px">수량</th>
      ${boxHeader}
      <th class="item-th" style="width:54px">단가</th>
      <th class="item-th" style="width:74px">공급가액</th>
      <th class="item-th" style="width:60px">부가세</th>
      <th class="item-th" style="width:108px">적요</th>
    </tr>
  </thead>
  <tbody>${itemRows}</tbody>
  <tfoot>
    <tr class="foot-row">
      <td colspan="${footerLabelColspan}" style="text-align:right;padding-right:12px">공급가액 합계</td>
      <td style="text-align:right">${fmtN(totalSupply)}</td>
      <td style="text-align:right">${fmtN(totalVat)}</td>
      <td style="text-align:right;font-size:10pt;background:#dce8f5">${fmtN(totalAmt)}</td>
    </tr>
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

function buildEstimatePrintBundle(htmlPages) {
  const pages = (htmlPages || []).filter(Boolean);
  if (pages.length === 0) return '';
  const style = [...new Set(pages.map(extractEstimateStyle).filter(Boolean))].join('\n');
  const sections = pages
    .map(html => `<section class="print-page">${extractEstimateBody(html)}</section>`)
    .join('\n');
  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<title>견적서 일괄 인쇄</title>
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

// ── 담당자별 인쇄 구분 표지(간지) — 전체 업체 일괄 인쇄 시 담당자 단위로 묶어
//    각 담당자 시작 위치에 한 장 삽입. 인쇄물을 담당자별로 분류하기 쉬워진다.
function buildManagerCoverPage(manager, custNames = [], weekLabel = '') {
  const escHtml = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const names = (custNames || []).filter(Boolean);
  const list = names.map(n => `<li>${escHtml(n)}</li>`).join('');
  const sub = weekLabel ? `${escHtml(weekLabel)}차 · 거래처 ${names.length}곳` : `거래처 ${names.length}곳`;
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<style>
.mgr-cover{display:flex;flex-direction:column;justify-content:center;align-items:center;min-height:235mm;text-align:center;font-family:'Malgun Gothic','맑은 고딕',sans-serif;}
.mgr-cover .mgr-label{font-size:13pt;color:#666;letter-spacing:.4em;margin-bottom:7mm;}
.mgr-cover .mgr-name{font-size:38pt;font-weight:800;color:#10243b;margin-bottom:5mm;}
.mgr-cover .mgr-sub{font-size:12pt;color:#1a4f8b;margin-bottom:9mm;}
.mgr-cover ul.mgr-list{columns:2;column-gap:16mm;list-style:none;padding:0;margin:0;font-size:10.5pt;color:#333;text-align:left;max-width:155mm;width:100%;}
.mgr-cover ul.mgr-list li{padding:1.4mm 2mm;border-bottom:1px dotted #cfd8e3;break-inside:avoid;}
</style></head><body>
<div class="mgr-cover">
  <div class="mgr-label">담 당 자</div>
  <div class="mgr-name">${escHtml(manager)}</div>
  <div class="mgr-sub">${sub}</div>
  <ul class="mgr-list">${list}</ul>
</div>
</body></html>`;
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
        const data = await apiGet('/api/dev/app-log', { limit: 40, category: 'shipmentFix' });
        if (stopped) return;
        const logs = (data.logs || [])
          .filter(l => !fixLogSince || parseAppLogTime(l.CreateDtm) >= fixLogSince)
          .filter(l => logWeeks.some(wk => String(l.Detail || '').includes(wk)))
          .slice(0, 12)
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
        const data = await apiGet('/api/dev/app-log', { limit: 60, category: 'shipmentFix' });
        if (stopped) return;
        const logs = (data.logs || [])
          .filter(l => !fixLogSince || parseAppLogTime(l.CreateDtm) >= fixLogSince)
          .filter(l => String(l.Step || '').startsWith('unfix_'))
          .filter(l => logWeeks.length === 0 || logWeeks.some(wk => String(l.Detail || '').includes(wk)))
          .slice(0, 12)
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
    try {
      const r = await fetch('/api/shipment/fix', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ week: subWeek, action: 'unfix', force }),
      });
      const d = await r.json();
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
    return getRecentFixStatusRange(selectedParent, FIX_STATUS_COUNT);
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
        body: JSON.stringify({ fromWeek, toWeek, force }),
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

  // 견적서 로고 (base64 데이터 URL) — iframe srcdoc 내에서도 안정적으로 표시되도록 인라인 삽입.
  // 외부 URL 의존시 CORS/HTTPS 제한으로 로고 누락될 수 있음.
  const [logoDataUrl, setLogoDataUrl] = useState(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    fetch('/nenova-logo.png')
      .then(r => r.ok ? r.blob() : null)
      .then(b => {
        if (!b) return null;
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(b);
        });
      })
      .then(dataUrl => { if (dataUrl) setLogoDataUrl(dataUrl); })
      .catch(() => { /* 실패시 buildEstimateHtml 의 /nenova-logo.png fallback 사용 */ });
  }, []);

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
    docTitle:  '견 적 서',
    outType:   'total',      // 'total' | 'select'
    serialNo:  '',
    showBoxQty: true,
    showDistribDesc: true,
    printByManager: true,    // 전체 업체 일괄 인쇄 시 담당자별로 묶고 구분 표지 삽입
  });

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
  }, [weekNum, selectedCust?.CustKey, autoLoad, includeUnfixed]);

  // ── 출고 목록 행 클릭 → 해당 그룹의 모든 ShipmentKey 견적 상세 로드
  const selectShipment = (groupId, custKey, shipmentKeys) => {
    setSelectedId(groupId);
    setSelectedCustKey(custKey);
    setItemLoading(true);
    // ShipmentKeys가 여러 개인 경우 모두 로드 후 합산
    const keys = (shipmentKeys || '').split(',').map(Number).filter(Boolean);
    Promise.all(keys.map(sk => apiGet('/api/estimate', { shipmentKey: sk }).then(d => d.items || [])))
      .then(results => setItems(results.flat()))
      .catch(() => setItems([]))
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
    const keys = (ship.ShipmentKeys || '').split(',').map(Number).filter(Boolean);
    const results = await Promise.all(keys.map(sk => apiGet('/api/estimate', { shipmentKey: sk }).then(d => d.items || [])));
    const nextItems = results.flat();
    setItems(nextItems);
    return nextItems;
  }, [selectedId, shipments]);

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

  const getFixCycleWeeksForEditedItems = (editedItems, ship) => {
    const editedWeeks = sortWeeksAsc((editedItems || []).map(it => it.OrderWeek).filter(Boolean));
    if (editedWeeks.length === 0) return [];
    const firstEditedWeek = editedWeeks[0];
    return getFixedWeeksFromShip(ship)
      .filter(wk => String(wk).localeCompare(String(firstEditedWeek)) >= 0);
  };

  const getCountryFlowersForEditedItems = (editedItems) => [...new Set((editedItems || [])
    .map(it => String(it.CountryFlower || '').trim())
    .filter(Boolean))];

  const getItemEditKey = (item) => {
    if (item?.SdetailKey != null) return `sd:${item.SdetailKey}`;
    if (item?.EstimateKey != null) return `est:${item.EstimateKey}`;
    return '';
  };

  const isEstimateEditKey = (key) => String(key || '').startsWith('est:');
  const parseEditKeyNumber = (key) => parseInt(String(key || '').split(':')[1] || key, 10);

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

  const runShipmentFixAction = async (week, action, countryFlowers = [], stockProdKeys = []) => {
    const r = await fetch('/api/shipment/fix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ week, action, force: true, countryFlowers, stockProdKeys }),
    });
    const d = await r.json();
    if (!d.success) {
      throw new Error(d.error || d.message || `${week} ${action === 'unfix' ? '확정취소' : '재확정'} 실패`);
    }
    return d;
  };

  const runEditWithFixCycle = async ({ weeks, countryFlowers = [], stockProdKeys = [], progress, apply }) => {
    const targetWeeks = sortWeeksAsc(weeks);
    const unfixedWeeks = [];
    let applyResult = null;
    let applyError = null;
    try {
      for (const wk of sortWeeksDesc(targetWeeks)) {
        progress?.(`${wk} 확정해제 중`);
        await runShipmentFixAction(wk, 'unfix', countryFlowers, stockProdKeys);
        unfixedWeeks.push(wk);
      }
    } catch (err) {
      progress?.(`확정해제 오류 — ${err.message}`);
      for (const wk of sortWeeksAsc(unfixedWeeks)) {
        progress?.(`${wk} 원상복구 재확정 중`);
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

    for (const wk of sortWeeksAsc(unfixedWeeks)) {
      progress?.(`${wk} 재확정 중`);
      await runShipmentFixAction(wk, 'fix', countryFlowers, stockProdKeys);
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

  const doFixAll = async (weekList, force = false) => {
    setFixWorking(true);
    setFixServerLogs([]);
    setFixLogWeeks(weekList || []);
    setFixLogSince(Date.now() - 3000);
    const results = [];
    setFixProgress({
      phase: 'fixing',
      title: `${weekNum}차 및 하위차수 출고 확정 진행 중`,
      currentWeek: '',
      total: weekList.length,
      done: 0,
      success: 0,
      failed: 0,
      message: `${weekList.length}개 세부차수를 낮은 차수부터 순서대로 확정합니다.`,
      results: [],
    });
    for (let i = 0; i < weekList.length; i += 1) {
      const wk = weekList[i];
      setFixProgress(prev => ({
        ...(prev || {}),
        currentWeek: wk,
        done: i,
        message: `${wk} 확정 중입니다. 재고 계산까지 함께 처리합니다.`,
      }));
      try {
        const r = await fetch('/api/shipment/fix', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ week: wk, action: 'fix', force }),
        });
        const d = await r.json();
        results.push({ week: wk, ok: d.success, message: d.message, error: d.error, count: d.updatedCount });
      } catch (e) {
        results.push({ week: wk, ok: false, error: e.message });
      }
      const success = results.filter(x => x.ok).length;
      const failed = results.length - success;
      setFixProgress(prev => ({
        ...(prev || {}),
        done: i + 1,
        success,
        failed,
        results: results.slice(-5),
        message: `${wk} 처리 완료. 남은 차수 ${Math.max(weekList.length - i - 1, 0)}개`,
      }));
    }
    setFixModal({ stage: 'done', results });
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

      const shipmentPending = pending.filter(p => !p.isEstimate);
      const cycleWeeks = getFixCycleWeeksForEditedItems(shipmentPending.map(p => p.item), selectedShip);
      const cycleCountryFlowers = getCountryFlowersForEditedItems(shipmentPending.map(p => p.item));
      const cycleStockProdKeys = getProdKeysForEditedItems(shipmentPending.map(p => p.item));
      if (cycleWeeks.length > 0) {
        setCostApplyLog(prev => [...prev, {
          step: 'cycle',
          label: `확정 사이클 대상: ${sortWeeksDesc(cycleWeeks).join(' 해제 → ')} 해제 후 ${sortWeeksAsc(cycleWeeks).join(' 확정 → ')} 확정${cycleCountryFlowers.length ? ` / 카테고리 ${cycleCountryFlowers.join(', ')}` : ''}`,
        }]);
      }

      const runQuantityUpdate = async () => {
        return await runLimited(pending, 4, async (p) => {
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
      };

      const results = cycleWeeks.length > 0
        ? await runEditWithFixCycle({
            weeks: cycleWeeks,
            countryFlowers: cycleCountryFlowers,
            stockProdKeys: cycleStockProdKeys,
            progress: label => setCostApplyLog(prev => [...prev, { step: 'cycle', label }]),
            apply: runQuantityUpdate,
          })
        : await runQuantityUpdate();

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
      const cycleWeeks = [];
      const cycleCountryFlowers = [];
      if (cycleWeeks.length > 0) {
        setCostApplyLog(prev => [...prev, {
          step: 'cycle',
          label: `확정 사이클 대상: ${sortWeeksDesc(cycleWeeks).join(' 해제 → ')} 해제 후 ${sortWeeksAsc(cycleWeeks).join(' 확정 → ')} 확정${cycleCountryFlowers.length ? ` / 카테고리 ${cycleCountryFlowers.join(', ')}` : ''}`,
        }]);
      }
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

      const d = cycleWeeks.length > 0
        ? await runEditWithFixCycle({
            weeks: cycleWeeks,
            countryFlowers: cycleCountryFlowers,
            stockProdKeys: [],
            progress: label => setCostApplyLog(prev => [...prev, { step: 'cycle', label }]),
            apply: postCostUpdate,
          })
        : await postCostUpdate();

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

  // ── WeekDay 필터 적용 (7개 전체 선택 = 모두 표시, 일부 선택 = 해당 요일만)
  const ALL_WD = ['월','화','수','목','금','토','일'];
  const filterItemsByWeekday = useCallback((sourceItems) => sourceItems.filter(item => {
    if (activeWD.size === 0 || activeWD.size === 7) return true;  // 전체 or 0개 → 모두 표시
    const dayMap = {'월':1,'화':2,'수':3,'목':4,'금':5,'토':6,'일':0};
    if (!item.outDate) return false;
    return [...activeWD].some(wd => dayMap[wd] === new Date(item.outDate).getDay());
  }), [activeWD]);
  const filteredItems = filterItemsByWeekday(items);

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

  // ── 엑셀 다운 (쿼리 데이터 기반)
  const handleExcel = () => {
    if (!filteredItems.length) { alert('출력할 데이터가 없습니다. 먼저 조회하세요.'); return; }
    const custName = selectedShip?.CustName || '';
    const week = weekNum || '';
    const rows = [
      [`견적서 — ${custName} / ${week}`],
      [],
      ['품목명','단위','출고일','수량','단가','공급가액','부가세','구분'],
    ];
    filteredItems.forEach(i => rows.push([
      i.ProdName, i.Unit, i.outDate||'', i.Quantity, i.Cost, i.Amount, i.Vat, i.EstimateType||''
    ]));
    rows.push([]);
    rows.push(['합계','','', totalQty, '', totalSupply, totalVat, '']);
    const csv = rows.map(r => r.map(v => `"${v||''}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF'+csv], {type:'text/csv'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `견적서_${custName}_${week}.csv`;
    a.click();
  };

  // ── 견적서 출력 버튼 → 출력 다이얼로그 열기
  const handlePrint = () => {
    // 다중 선택이 있으면 그것만 사용, 없으면 현재 단일 선택 사용
    if (selectedGroups.size > 0) {
      setShowPrintDialog(true);
      return;
    }
    if (!filteredItems.length) { alert('출력할 데이터가 없거나 행이 선택되지 않았습니다. 좌측에서 행 클릭 또는 체크박스 선택 후 다시 시도하세요.'); return; }
    setShowPrintDialog(true);
  };

  // ── 실제 인쇄 실행
  //
  // [구조 변경] Blob URL + window.open(_blank) 방식 →  iframe srcdoc 방식으로 전환.
  // 이유: Blob URL + _blank 가 일부 Chrome 버전/조건에서 현재 탭으로 navigate 되어
  //       견적서 관리 페이지가 사라지던 문제.  iframe 은 팝업 차단 이슈도 없음.
  //       부모 페이지는 절대 영향 받지 않음.
  const doActualPrint = useCallback(async (opts) => {
    const week = weekNum || '';

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
      const printRows = oneRows.filter(i => {
        if (!isPrintableEstimateRow(i)) return false;
        return opts.outType === 'select' ? i.EstimateType === '정상출고' : true;
      });
      if (!printRows.length) return [];

      if (opts.splitMode === 'combined') {
        const bigoLabel = `${week}차 종합견적서`;
        return [buildEstimateHtml({
          bigoLabel, serialNo: opts.serialNo, printDate: opts.printDate,
          custName: oneCustName, rows: printRows, logoDataUrl,
          aggregate: true,
          showBoxQty: opts.showBoxQty !== false,
          showDistribDesc: opts.showDistribDesc !== false,
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
        bigoLabel, serialNo: opts.serialNo, printDate: opts.printDate,
        custName: oneCustName, rows, logoDataUrl, aggregate,
        showBoxQty: opts.showBoxQty !== false,
        showDistribDesc: opts.showDistribDesc !== false,
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
      const printShips = [...selectedShips].sort(compareShipmentsByManager);
      const byManager = opts.printByManager !== false;
      // 담당자별 거래처 목록(표지에 표시) 사전 집계
      const mgrCusts = {};
      if (byManager) {
        for (const s of printShips) {
          const m = getShipmentManager(s);
          (mgrCusts[m] = mgrCusts[m] || []).push(s.CustName);
        }
      }
      let lastManager = null;
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
        // 요일 필터로 해당 거래처에 출력할 항목이 없으면 표지/페이지 모두 생략
        if (custPages.length === 0) continue;
        if (byManager) {
          const m = getShipmentManager(ship);
          if (m !== lastManager) {
            printPages.push(buildManagerCoverPage(m, mgrCusts[m], week));
            lastManager = m;
          }
        }
        printPages.push(...custPages);
      }
      if (printPages.length === 0) {
        alert('출력할 데이터가 없습니다.');
        return;
      }
      await printInIframe(buildEstimatePrintBundle(printPages));
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
      await printInIframe(buildEstimatePrintBundle(printPages));
    }

    setShowPrintDialog(false);
  }, [filteredItems, selectedShip, weekNum, logoDataUrl, selectedGroups, shipments, reloadSelectedShipmentItems, filterItemsByWeekday]);

  const toggleWD = d => { const n = new Set(activeWD); n.has(d) ? n.delete(d) : n.add(d); setActiveWD(n); };

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
  const fixStatusTargetRows = fixStatusActionBaseRows
    .filter(w => w.status === 'FIXED' || w.status === 'PARTIAL');
  const fixStatusFixTargetRows = fixStatusActionBaseRows
    .filter(w => Number(w.detailCount || 0) > 0)
    .filter(w => w.status === 'UNFIXED' || w.status === 'PARTIAL');
  const fixStatusNegativeCount = fixStatusRows.reduce((sum, w) => sum + (Number(w.negativeCount) || 0), 0);
  const fixStatusBadge = (status) => {
    if (status === 'FIXED') return { text: '확정', bg: '#e8f5e9', color: '#2e7d32' };
    if (status === 'PARTIAL') return { text: '부분확정', bg: '#fff8e1', color: '#ef6c00' };
    if (status === 'UNFIXED') return { text: '미확정', bg: '#e3f2fd', color: '#1565c0' };
    return { text: '출고없음', bg: '#f5f5f5', color: '#777' };
  };

  const unfixSelectedFixStatusWeeks = async (force = false) => {
    const rows = fixStatusTargetRows;
    if (!rows.length) {
      alert('확정취소할 차수를 선택하거나, 확정/부분확정 차수가 있어야 합니다.');
      return;
    }
    const ordered = [...rows].sort((a, b) => String(b.WeekKey || b.OrderWeek).localeCompare(String(a.WeekKey || a.OrderWeek)));
    const weekLabels = ordered.map(w => w.OrderWeek);
    if (!force && !confirm(`선택한 ${ordered.length}개 차수를 확정취소할까요?\n\n${weekLabels.join(', ')}\n\n높은 차수부터 낮은 차수 순서로 처리됩니다.`)) {
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
        const res = await fetch('/api/shipment/fix', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ week: row.OrderWeek, action: 'unfix', force: true }),
        });
        const data = await res.json();
        if (!data.success) errors.push(`${row.OrderWeek}: ${data.error || data.message || '실패'}`);
        else if (data.stockWarning) warnings.push(`${row.OrderWeek}: 재고 재계산 경고 ${data.stockErrors?.length || 0}건`);
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
    const rows = fixStatusFixTargetRows;
    if (!rows.length) {
      alert('확정할 차수를 선택하거나, 미확정/부분확정 차수가 있어야 합니다.');
      return;
    }
    const ordered = [...rows].sort((a, b) => String(a.WeekKey || a.OrderWeek).localeCompare(String(b.WeekKey || b.OrderWeek)));
    const weekLabels = ordered.map(w => w.OrderWeek).filter(Boolean);
    if (!confirm(`선택한 ${weekLabels.length}개 차수를 확정할까요?\n\n${weekLabels.join(', ')}\n\n낮은 차수부터 높은 차수 순서로 처리됩니다.`)) {
      return;
    }
    setFixStatusModal(null);
    await doFixAll(weekLabels);
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
          <button className="btn" onClick={handleExcel}>📊 엑셀 다운</button>
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
                <table className="tbl">
                  <thead>
                    <tr>
                      <th style={{width:28}}>
                        <input type="checkbox"
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
                            <td onClick={e => e.stopPropagation()}>
                              <input type="checkbox" checked={checked}
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
                          const isDed = item.EstimateType && item.EstimateType !== '정상출고';
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
                            <td style={{fontSize:11, color:'var(--text3)'}}>{item.Descr||''}</td>
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
          <div style={{padding:'5px 10px', borderTop:'1px solid var(--border)', display:'flex', alignItems:'center', gap:5, flexWrap:'wrap', background:'var(--bg)'}}>
            <span style={{fontSize:11, color:'var(--text3)'}}>출고요일 필터:</span>
            {WEEKDAYS.map(d => (
              <span key={d} className={`chip ${activeWD.has(d)?'chip-active':'chip-inactive'}`} onClick={() => toggleWD(d)}>{d}</span>
            ))}
            {activeWD.size < 7 && (
              <button className="btn btn-sm" style={{height:20, fontSize:10}} onClick={() => setActiveWD(new Set(['월','화','수','목','금','토','일']))}>전체선택</button>
            )}
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
                🖨️ 견적서 출력 옵션
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
                      checked={printOpts.showDistribDesc !== false}
                      onChange={e => setPrintOpts(o => ({ ...o, showDistribDesc: e.target.checked }))}
                    />
                    적요에 차수별 수량 표시
                  </label>
                  {selectedGroups.size > 0 && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                      <input type="checkbox"
                        checked={printOpts.printByManager !== false}
                        onChange={e => setPrintOpts(o => ({ ...o, printByManager: e.target.checked }))}
                      />
                      담당자별로 모아서 인쇄 (담당자 구분 표지 삽입)
                    </label>
                  )}
                </div>
              </div>

              {/* 미리보기 요약 */}
              <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '8px 12px', fontSize: 11, color: 'var(--text2)' }}>
                {selectedGroups.size > 0 ? (
                  <>
                    <div>선택 거래처: <b>{selectedGroups.size}건</b></div>
                  </>
                ) : (
                  <>
                    <div>거래처: <b>{selectedShip?.CustName || '-'}</b></div>
                    <div>차수: <b>{weekNum || '-'}</b></div>
                    <div>항목수: <b>{filteredItems.length}건</b></div>
                    <div>합계: <b>₩{(totalSupply + totalVat).toLocaleString()}</b> (공급가 ₩{totalSupply.toLocaleString()} + 세액 ₩{totalVat.toLocaleString()})</div>
                  </>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => doActualPrint(printOpts)}>
                🖨️ 출력 실행
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
          <div className="modal" style={{ maxWidth: 760, maxHeight: '82vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
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
              </div>
              <div style={{ fontSize:12, color:'#555', marginBottom:10, lineHeight:1.5 }}>
                먼저 현황을 확인한 뒤, 현재 선택 차수는 확정하고 과거 차수 수정이 필요하면 구간 확정취소를 진행합니다.
                음수재고가 있으면 확정 버튼을 눌러도 서버에서 확정이 차단됩니다.
              </div>
              {(rangeUnfixWorking || rangeUnfixStatus) && (
                <div style={{ marginBottom:10, padding:'8px 10px', background:'#fff7ed', border:'1px solid #fed7aa', borderRadius:8, color:'#9a3412', fontSize:12, fontWeight:800 }}>
                  {rangeUnfixStatus || '확정취소 처리 중'}
                </div>
              )}
              {(rangeUnfixWorking || rangeUnfixStatus) && (
                <div style={{ marginBottom:10, border:'1px solid #e0e0e0', borderRadius:8, overflow:'hidden' }}>
                  <div style={{ padding:'7px 10px', background:'#fafafa', borderBottom:'1px solid #e0e0e0', fontSize:12, fontWeight:800, color:'#333' }}>
                    확정취소 서버 로그
                  </div>
                  <div style={{ maxHeight:150, overflowY:'auto', background:'#fff' }}>
                    {fixServerLogs.length === 0 ? (
                      <div style={{ padding:'10px', fontSize:12, color:'#777' }}>서버 로그 수신 대기 중입니다.</div>
                    ) : fixServerLogs.map((l, i) => {
                      const isError = Boolean(l.IsError);
                      return (
                        <div key={`${l.CreateDtm}-${l.Step}-${i}`} style={{
                          display:'grid',
                          gridTemplateColumns:'82px 135px 1fr',
                          gap:8,
                          alignItems:'center',
                          padding:'6px 10px',
                          borderBottom:'1px solid #f1f1f1',
                          fontSize:11,
                          color: isError ? '#c62828' : '#333',
                        }}>
                          <span style={{ color:'#777', fontFamily:'var(--mono)' }}>{String(l.CreateDtm || '').slice(11, 19)}</span>
                          <span style={{ fontWeight:800 }}>{l.Step || '-'}</span>
                          <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{l.Detail || ''}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
                <thead>
                  <tr style={{ background:'#f5f5f5', borderBottom:'2px solid #999' }}>
                    <th style={{ padding:'6px', textAlign:'center', width:42 }}>선택</th>
                    <th style={{ padding:'6px', textAlign:'center', width:80 }}>차수</th>
                    <th style={{ padding:'6px', textAlign:'center', width:90 }}>상태</th>
                    <th style={{ padding:'6px', textAlign:'left' }}>미확정 카테고리</th>
                    <th style={{ padding:'6px', textAlign:'right' }}>음수재고</th>
                  </tr>
                </thead>
                <tbody>
                  {fixStatusRows.map(w => {
                    const badge = fixStatusBadge(w.status);
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
                      <td colSpan={5} style={{ padding:16, textAlign:'center', color:'#777' }}>
                        조회된 차수 현황이 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div style={{ display:'flex', gap:8, padding:12, justifyContent:'flex-end', borderTop:'1px solid var(--border)' }}>
              <button className="btn" onClick={() => setFixStatusModal(null)} disabled={fixWorking || rangeUnfixWorking}>닫기</button>
              <button
                className="btn"
                onClick={async () => { await unfixSelectedFixStatusWeeks(false); }}
                disabled={rangeUnfixWorking || fixStatusTargetRows.length === 0}
                style={{ background:'#fff7ed', color:'#bf360c', borderColor:'#ef6c00', fontWeight:700 }}
              >
                {rangeUnfixWorking ? (rangeUnfixStatus || '취소중...') : `선택 확정취소 (${fixStatusTargetRows.length}차수)`}
              </button>
              <button
                className="btn"
                onClick={async () => { await fixSelectedFixStatusWeeks(); }}
                disabled={fixWorking || rangeUnfixWorking || fixStatusFixTargetRows.length === 0}
                style={{ background:'#2e7d32', color:'#fff', borderColor:'#2e7d32', fontWeight:700 }}
              >
                {fixWorking ? '확정중...' : `선택 차수 확정하기 (${fixStatusFixTargetRows.length}차수)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {fixProgress && (
        <div className="modal-overlay" onClick={e => e.stopPropagation()}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{fixProgress.title || '출고 확정 진행 중'}</span>
            </div>
            <div className="modal-body">
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
              <div style={{ marginTop:12, border:'1px solid #e0e0e0', borderRadius:8, overflow:'hidden' }}>
                <div style={{ padding:'7px 10px', background:'#fafafa', borderBottom:'1px solid #e0e0e0', fontSize:12, fontWeight:800, color:'#333' }}>
                  서버 처리 로그
                </div>
                <div style={{ maxHeight:150, overflowY:'auto', background:'#fff' }}>
                  {fixServerLogs.length === 0 ? (
                    <div style={{ padding:'10px', fontSize:12, color:'#777' }}>
                      서버 로그 수신 대기 중입니다.
                    </div>
                  ) : fixServerLogs.map((l, i) => {
                    const isError = Boolean(l.IsError);
                    return (
                      <div key={`${l.CreateDtm}-${l.Step}-${i}`} style={{
                        display:'grid',
                        gridTemplateColumns:'82px 110px 1fr',
                        gap:8,
                        alignItems:'center',
                        padding:'6px 10px',
                        borderBottom:'1px solid #f1f1f1',
                        fontSize:11,
                        color: isError ? '#c62828' : '#333',
                      }}>
                        <span style={{ color:'#777', fontFamily:'var(--mono)' }}>{String(l.CreateDtm || '').slice(11, 19)}</span>
                        <span style={{ fontWeight:800 }}>{l.Step || '-'}</span>
                        <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{l.Detail || ''}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
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
        </div>
      )}

      {/* ── 차수 확정 모달 (사전검증 결과 + 강제진행 + 결과) ── */}
      {fixModal && (
        <div className="modal-overlay" onClick={() => !fixWorking && setFixModal(null)}>
          <div className="modal" style={{ maxWidth: 600, maxHeight: '80vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                {fixModal.stage === 'preview' && `🔍 ${fixModal.week}차 확정 — 사전검증 결과`}
                {fixModal.stage === 'done'    && `📋 ${weekNum}차 확정 결과`}
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
                          {iss.negative.slice(0, 5).map((n, i) => (
                            <li key={i}>{n.ProdName} (전재고 {n.prevStock} + 입고 {n.inQty} - 출고 {n.outQty} = {n.remain})</li>
                          ))}
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
              {fixModal.stage === 'done' && (
                <button className="btn btn-primary" onClick={() => setFixModal(null)}>닫기</button>
              )}
              {fixModal.stage === 'error' && (
                <button className="btn" onClick={() => setFixModal(null)}>닫기</button>
              )}
            </div>
          </div>
        </div>
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
