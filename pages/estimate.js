// pages/estimate.js
// 견적서 관리
// 수정이력: 2026-03-27 — 차수/업체 검색 추가, 불량/검역 모달 품목 검색 드롭다운, 검색가능 드롭다운 컴포넌트 추가

import { useState, useEffect, useRef, useCallback } from 'react';
import { apiGet, apiPost } from '../lib/useApi';
import { getCurrentWeek } from '../lib/useWeekInput';
import { useLang } from '../lib/i18n';
import { useDropdownNav } from '../lib/useDropdownNav';

// 오늘 날짜 기준 차수(주차 번호)만 반환 — "14-01" → "14"
function getCurrentWeekNum() {
  return getCurrentWeek().split('-')[0];
}

// 출고일자 포맷: "2026-04-03" → "03(금)" (기존 전산 프로그램 형식)
const DAY_KR = ['일','월','화','수','목','금','토'];
function fmtDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${String(d.getDate()).padStart(2,'0')}(${DAY_KR[d.getDay()]})`;
}

const fmt = n => Number(n || 0).toLocaleString();
const WEEKDAYS = ['월','화','수','목','금','토','일'];

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

// ── FlowerName → 분할 그룹 이름
function getFlowerGroup(flowerName) {
  const f = (flowerName || '').toUpperCase();
  if (f.includes('HYDRANGEA') || f.includes('수국') || f.includes('ALSTRO')) return '수국/알스트로';
  if (f.includes('CARNATION') || f.includes('카네이션')) return '카네이션';
  if (f.includes('ROSE') || f.includes('장미')) return '장미';
  if (f.includes('ECUADOR') || f.includes('에콰도르')) return '에콰도르';
  return '기타';
}

// ── EstimateType 코드 → 한글명 매핑 (레거시 코드 fallback)
// 실제 DB 값은 이미 한글(불량차감/박스 등)이지만, 과거 데이터가 fee03-kr0010 같은
// 전산 코드로 남아있을 경우를 위한 안전 매핑
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
function buildEstimateHtml({ bigoLabel, serialNo, printDate, custName, rows }) {
  // ── 차감 항목을 최하단으로 정렬 (정상출고 먼저, 차감은 뒤)
  const isDeductRow = r => r.EstimateType && r.EstimateType !== '정상출고';
  const sortedRows = [...rows].sort((a, b) => {
    const ad = isDeductRow(a) ? 1 : 0;
    const bd = isDeductRow(b) ? 1 : 0;
    if (ad !== bd) return ad - bd;
    // 같은 그룹 내: 기존 순서 유지 (outDate/ProdName)
    const adt = a.outDate || ''; const bdt = b.outDate || '';
    if (adt !== bdt) return adt.localeCompare(bdt);
    return (a.ProdName || '').localeCompare(b.ProdName || '');
  });
  rows = sortedRows;

  const totalSupply = rows.reduce((a, r) => a + (r.Amount || 0), 0);
  const totalVat    = rows.reduce((a, r) => a + (r.Vat || 0), 0);
  const totalAmt    = totalSupply + totalVat;
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
    return r.Descr || '';
  };

  const itemRows = rows.map((r, i) => {
    const deduct = isDeduct(r);
    const rowBg  = deduct ? 'background:#FFF8DC;' : '';
    const amtClr = deduct ? 'color:#c0392b;' : '';
    return `
    <tr>
      <td style="${rowBg}text-align:center;border:1px solid #bbb;padding:2px 3px;width:28px">${i + 1}</td>
      <td style="${rowBg}border:1px solid #bbb;padding:2px 6px;${deduct ? 'color:#c0392b;font-weight:bold;' : ''}">${typeLabel(r.EstimateType)}${r.ProdName || ''}</td>
      <td style="${rowBg}${amtClr}text-align:right;border:1px solid #bbb;padding:2px 5px;white-space:nowrap">${fmtN(r.Quantity)}${r.Unit || ''}</td>
      <td style="${rowBg}text-align:right;border:1px solid #bbb;padding:2px 6px">${fmtN(r.Cost)}</td>
      <td style="${rowBg}${amtClr}text-align:right;border:1px solid #bbb;padding:2px 6px">${fmtN(r.Amount)}</td>
      <td style="${rowBg}${amtClr}text-align:right;border:1px solid #bbb;padding:2px 6px">${fmtN(r.Vat)}</td>
      <td style="${rowBg}border:1px solid #bbb;padding:2px 5px;font-size:7.5pt;color:#555">${descLabel(r)}</td>
    </tr>`;
  }).join('');

  const serialDisplay = serialNo || printDate;

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
/* 로고: 타이트하게 칸에 꽉 차게 */
.logo-area { text-align:left; border-bottom:1px solid #555; padding:0; margin:0; line-height:0; background:#fff; }
.logo-area img { display:block; width:100%; height:auto; max-height:64px; object-fit:cover; object-position:left center; }
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
        <tr class="hdr-row"><td class="hdr-key">청&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;조</td><td></td></tr>
        <tr class="hdr-row"><td class="hdr-key">TEL/FAX</td><td></td></tr>
        <tr class="hdr-row"><td class="hdr-key">결제조건</td><td></td></tr>
        <tr class="hdr-row"><td class="hdr-key">출고기간</td><td></td></tr>
        <tr class="hdr-row"><td class="hdr-key">비&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;고</td><td>${bigoLabel}</td></tr>
      </table>
      <div class="greet">
        1. 귀사의 일익 번창하심을 기원합니다.<br>
        2. 하기와 같이 견적드리오니 검토하기 바랍니다.
      </div>
    </td>
    <td class="hdr-right">
      <!-- 오른쪽: NENOVA 로고 (칸 꽉차게) + 회사정보 (2셀 테이블, 왼쪽정렬, 줄바꿈 방지) -->
      <div class="logo-area">
        <img src="https://nenovaweb.com/nenova-logo.png" alt="NENOVA"
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
      <th class="item-th" style="width:28px">순번</th>
      <th class="item-th">품목명[규격]</th>
      <th class="item-th" style="width:68px">수량</th>
      <th class="item-th" style="width:62px">단가</th>
      <th class="item-th" style="width:80px">공급가액</th>
      <th class="item-th" style="width:68px">부가세</th>
      <th class="item-th" style="width:80px">적요</th>
    </tr>
  </thead>
  <tbody>${itemRows}</tbody>
  <tfoot>
    <tr class="foot-row">
      <td colspan="4" style="text-align:right;padding-right:12px">공급가액 합계</td>
      <td style="text-align:right">${fmtN(totalSupply)}</td>
      <td style="text-align:right">${fmtN(totalVat)}</td>
      <td style="text-align:right;font-size:10pt;background:#dce8f5">${fmtN(totalAmt)}</td>
    </tr>
  </tfoot>
</table>
<script>window.onload=()=>{window.print();window.onafterprint=()=>window.close();}</script>
</body></html>`;
}
const ESTIMATE_TYPES = [
  '불량차감/박스','불량차감/단','불량차감/송이',
  '검역차감/박스','검역차감/단','검역차감/송이',
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
  const weekPrev = () => setWeekNum(w => String(Math.max(1, parseInt(w)||1) - 1));
  const weekNext = () => setWeekNum(w => String(Math.min(52, parseInt(w)||1) + 1));

  // 왼쪽 패널 - 출고 목록
  const [shipments, setShipments] = useState([]);
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

  // WeekDay 필터 — 기본값: 전체 요일 선택
  const [activeWD, setActiveWD] = useState(new Set(['월','화','수','목','금','토','일']));

  // 불량/검역 모달
  const [showDefect, setShowDefect] = useState(false);
  const [products, setProducts] = useState([]);  // 품목 전체 목록 (드롭다운용)
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // ── 단가 수정 상태 (P3) ─────────────────────────
  // costEdits[sdetailKey] = 수정된 단가 (string)
  const [costEdits, setCostEdits] = useState({});
  const [costMode, setCostMode] = useState('once'); // 'once' | 'fixed' | 'weekFav'
  const [costApplying, setCostApplying] = useState(false);
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

  // ── 조회 (차수 + 업체 기준) — 차수 단위 그룹핑 (14 → 14-01, 14-02 … 모두 포함)
  const load = () => {
    if (!weekNum && !selectedCust) { setErr('차수 또는 업체를 입력하세요.'); return; }
    setLoading(true); setErr('');
    apiGet('/api/estimate', {
      week: weekNum,        // "14" 전달 → API에서 14-01, 14-02 등 자동 매칭
      custKey: selectedCust?.CustKey || '',
    })
      .then(d => {
        setShipments(d.shipments || []);
        setItems(d.items || []);
        if (d.shipments?.length > 0) {
          // 그룹 기준: ParentWeek + CustKey
          const first = d.shipments[0];
          setSelectedId(`${first.ParentWeek}_${first.CustKey}`);
          setSelectedCustKey(first.CustKey);
        }
      })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  };

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
  };

  const selectedShip = shipments.find(s => `${s.ParentWeek}_${s.CustKey}` === selectedId);

  // ── 단가 수정 관련 함수 (P3) ─────────────────────────
  // 현재 선택된 그룹의 ShipmentKey 목록
  const selectedShipmentKeys = selectedShip
    ? (selectedShip.ShipmentKeys || '').split(',').map(Number).filter(Boolean)
    : [];
  // 수정된 단가 개수
  const editedCount = Object.keys(costEdits).filter(k => {
    const v = costEdits[k];
    return v !== '' && v !== undefined && v !== null;
  }).length;

  // "확정풀고 단가 적용하기" — 실제 적용 함수
  async function applyCostEdits() {
    if (editedCount === 0) return;
    if (!selectedShipmentKeys.length) { setErr('선택된 견적서 없음'); return; }

    // 차수/거래처 정보
    const week = selectedShip.SubWeeks?.split(',')[0] || `${selectedShip.ParentWeek}-01`;

    // SdetailKey → 소속 ShipmentKey 매핑 (items 에서 조회)
    const itemByKey = {};
    filteredItems.forEach(it => {
      if (it.SdetailKey) itemByKey[it.SdetailKey] = it;
    });

    // ShipmentKey 별로 items 그룹핑 — 여러 sm 중 해당 sd 가 속한 것 찾기
    // 견적서 그룹은 여러 ShipmentKey 를 합쳐 보여주므로, 각 sd 의 소속을 결정해야 함
    // 간단 전략: 모든 sd 가 각 ShipmentKey 에 대해 한 번씩 UPDATE 시도 (존재하지 않으면 API 가 무시하거나 에러)
    // 더 안전: API 가 SdetailKey 로 ShipmentKey 를 자동 조회
    // 현재 API 는 shipmentKey+sdetailKey 쌍으로 검증하므로, 각 ShipmentKey 별로 해당 sd 만 묶어서 전송

    setCostApplying(true);
    setCostResult(null);
    setCostApplyLog([
      { step: 'start', label: '시작 — 단가 적용 준비 중...' },
    ]);

    try {
      const editedSdKeys = Object.keys(costEdits)
        .filter(k => costEdits[k] !== '' && costEdits[k] !== undefined)
        .map(k => parseInt(k));

      // 각 ShipmentKey 별 atomic 호출 (확정 해제 → 수정 → 재확정)
      const allChanges = [];
      let totalDiff = 0;

      for (const sk of selectedShipmentKeys) {
        // 해당 sk 에 속한 sdetailKey 만 수집
        // API 가 SdetailKey + ShipmentKey 쌍 검증 후 속하지 않은 건 throw 하므로,
        // 먼저 이 sk 에 속하는지 체크하는 items API 재조회 대신, 단순히 속한 것들만 전송
        const skItems = filteredItems.filter(it =>
          it.SdetailKey && editedSdKeys.includes(it.SdetailKey)
        );
        // items.SdetailKey 가 어느 ShipmentKey 에 속하는지 모르므로, 전부 시도 → API 가 검증 실패 시 throw
        // 개선: GET /api/estimate?shipmentKey=sk 로 한 번 더 조회해서 해당 sk 의 sdKey 만 추림
        const skDetail = await fetch(`/api/estimate?shipmentKey=${sk}`).then(r => r.json());
        const skSdKeys = new Set((skDetail.items || []).map(it => it.SdetailKey).filter(Boolean));
        const itemsForSk = skItems
          .filter(it => skSdKeys.has(it.SdetailKey))
          .map(it => ({ sdetailKey: it.SdetailKey, cost: parseFloat(costEdits[it.SdetailKey]) }));

        if (itemsForSk.length === 0) continue;

        setCostApplyLog(prev => [...prev, {
          step: `sk-${sk}`,
          label: `견적서 #${sk} 처리 중 (${itemsForSk.length}건) — 확정 해제 → 단가 수정 → 재확정...`,
        }]);

        const body = {
          shipmentKey: sk,
          items: itemsForSk,
          mode: costMode,
          week,
          custKey: selectedShip.CustKey,
        };
        const r = await fetch('/api/estimate/update-cost', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.error || `견적서 #${sk} 처리 실패`);

        allChanges.push(...(d.changes || []));
        totalDiff += (d.diffAmount || 0);

        setCostApplyLog(prev => [...prev, {
          step: `sk-${sk}-done`,
          label: `견적서 #${sk} 완료 — ${d.changedCount}건 수정, 공급가 ${d.diffAmount >= 0 ? '+' : ''}${(d.diffAmount || 0).toLocaleString()}원`,
        }]);
      }

      setCostApplyLog(prev => [...prev, { step: 'done', label: '✅ 전체 완료 — 견적서 재로딩 중...' }]);

      // 재로딩
      if (selectedShip) {
        await new Promise(res => setTimeout(res, 400)); // 잠시 로딩 메시지 보이게
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

  function closeCostModal() {
    setCostApplying(false);
    setCostApplyLog([]);
    setCostResult(null);
  }

  // ── WeekDay 필터 적용 (7개 전체 선택 = 모두 표시, 일부 선택 = 해당 요일만)
  const ALL_WD = ['월','화','수','목','금','토','일'];
  const filteredItems = items.filter(item => {
    if (activeWD.size === 0 || activeWD.size === 7) return true;  // 전체 or 0개 → 모두 표시
    const dayMap = {'월':1,'화':2,'수':3,'목':4,'금':5,'토':6,'일':0};
    if (!item.outDate) return false;
    return [...activeWD].some(wd => dayMap[wd] === new Date(item.outDate).getDay());
  });

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
    setSaving(true);
    try {
      await apiPost('/api/estimate', {
        shipmentKey:  selectedId,
        prodKey:      parseInt(defectForm.prodKey),
        estimateType: defectForm.estimateType,
        unit:         defectForm.unit,
        quantity:     parseFloat(defectForm.quantity),
        cost:         parseFloat(defectForm.cost) || 0,
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
    if (!filteredItems.length) { alert('출력할 데이터가 없습니다. 먼저 조회하세요.'); return; }
    setShowPrintDialog(true);
  };

  // ── 실제 인쇄 실행
  const doActualPrint = useCallback((opts) => {
    const custName = selectedShip?.CustName || '';
    const week = weekNum || '';

    // 선출고 = 정상출고 품목만, 종합 = 전체
    const printRows = filteredItems.filter(i =>
      opts.outType === 'select' ? i.EstimateType === '정상출고' : true
    );

    if (opts.splitMode === 'combined') {
      // ── 종합 출력 (1장) — 비고: "13차 종합견적서"
      const bigoLabel = `${week}차 종합견적서`;
      const html = buildEstimateHtml({
        bigoLabel,
        serialNo:  opts.serialNo,
        printDate: opts.printDate,
        custName,
        rows: printRows,
      });
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    } else {
      // ── 품목별 분할 출력 (수국→카네이션→장미→에콰도르→기타 → 마지막 종합 1장)
      // PDF 비고 형식: "13차 수국/알스트로메리아" 등
      const GROUP_LABEL = {
        '수국/알스트로': '수국/알스트로메리아',
        '카네이션':     '카네이션',
        '장미':         '장미',
        '에콰도르':     '에콰도르 분화',
        '기타':         '기타',
      };
      const groups = {};
      printRows.forEach(r => {
        const g = getFlowerGroup(r.FlowerName);
        if (!groups[g]) groups[g] = [];
        groups[g].push(r);
      });
      const groupOrder = ['수국/알스트로','카네이션','장미','에콰도르','기타'];
      const activeGroups = groupOrder.filter(g => groups[g]?.length > 0);

      if (activeGroups.length === 0) { alert('출력할 품목이 없습니다.'); return; }

      // 그룹별 페이지 + 마지막에 종합 페이지
      const pages = [
        ...activeGroups.map(g => ({
          bigoLabel: `${week}차 ${GROUP_LABEL[g] || g}`,
          rows: groups[g],
        })),
        // 마지막: 종합 (PDF 마지막 페이지)
        {
          bigoLabel: `${week}차 종합견적서`,
          rows: printRows,
        },
      ];

      pages.forEach(({ bigoLabel, rows }, idx) => {
        const html = buildEstimateHtml({
          bigoLabel,
          serialNo:  opts.serialNo,
          printDate: opts.printDate,
          custName,
          rows,
        });
        setTimeout(() => {
          const blob = new Blob([html], { type: 'text/html' });
          const url = URL.createObjectURL(blob);
          window.open(url, '_blank');
        }, idx * 500);
      });
    }

    setShowPrintDialog(false);
  }, [filteredItems, selectedShip, weekNum]);

  const toggleWD = d => { const n = new Set(activeWD); n.has(d) ? n.delete(d) : n.add(d); setActiveWD(n); };

  // 품목 옵션 (검색 가능 드롭다운용)
  const prodOptions = products.map(p => ({
    value: String(p.ProdKey),
    label: p.ProdName,
    sub: `${p.CounName} · ${p.FlowerName} · ${p.OutUnit}`,
  }));

  // 견적 유형 옵션
  const estimateTypeOptions = ESTIMATE_TYPES.map(t => ({ value: t, label: t }));

  return (
    <div>
      {/* ── 필터 바 ── */}
      <div className="filter-bar">
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

        <div className="page-actions">
          <button className="btn btn-primary" onClick={load}>🔄 조회 / Buscar</button>
          <button className="btn" disabled title="불량/검역 등록 버튼으로 저장하세요">💾 저장 (불량/검역 등록 사용)</button>
          <button className="btn" onClick={handlePrint}>🖨️ 견적서 출력</button>
          <button className="btn" onClick={handleExcel}>📊 엑셀 다운</button>
          <button className="btn" onClick={() => window.opener ? window.close() : history.back()}>✖️ 닫기 / Cerrar</button>
        </div>
      </div>

      {err      && <div className="banner-err">⚠️ {err}</div>}
      {successMsg && <div className="banner-ok">{successMsg}</div>}

      {/* ── 2분할 ── */}
      <div className="split-panel">

        {/* 왼쪽: 출고 목록 */}
        <div className="card" style={{overflow:'hidden', display:'flex', flexDirection:'column'}}>
          <div className="card-header">
            <span className="card-title">■ 출고 목록</span>
            <span style={{fontSize:11, color:'var(--text3)'}}>{shipments.length}건</span>
          </div>
          <div style={{overflowY:'auto', flex:1}}>
            {loading
              ? <div className="skeleton" style={{height:200, margin:12}}></div>
              : (
                <table className="tbl">
                  <thead>
                    <tr>
                      <th style={{width:28}}><input type="checkbox"/></th>
                      <th>차수</th><th>거래처</th>
                      <th style={{textAlign:'right'}}>총 합계금액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shipments.length === 0
                      ? <tr><td colSpan={4} style={{textAlign:'center', padding:32, color:'var(--text3)'}}>차수 또는 거래처 입력 후 조회하세요</td></tr>
                      : shipments.map(s => {
                          const groupId = `${s.ParentWeek}_${s.CustKey}`;
                          const subWeeks = (s.SubWeeks || '').split(',').filter(Boolean).join(', ');
                          return (
                            <tr key={groupId}
                              className={selectedId === groupId ? 'selected' : ''}
                              onClick={() => selectShipment(groupId, s.CustKey, s.ShipmentKeys)}
                              style={{cursor:'pointer'}}
                            >
                              <td><input type="checkbox" readOnly checked={selectedId === groupId}/></td>
                              <td style={{fontFamily:'var(--mono)', fontWeight:'bold', fontSize:12}}>
                                {s.ParentWeek}
                                <div style={{fontSize:9, color:'var(--text3)', fontWeight:'normal'}}>{subWeeks}</div>
                              </td>
                              <td style={{fontWeight:500}}>{s.CustName}</td>
                              <td className="num">{fmt(s.totalAmount)}</td>
                            </tr>
                          );
                        })}
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
            <div style={{marginLeft:'auto', display:'flex', gap:4, alignItems:'center', flexWrap:'wrap'}}>
              {/* ── 단가 수정 모드 선택 + 적용 버튼 (P3) ── */}
              {editedCount > 0 && (
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
                    🔓 확정풀고 단가 적용하기 ({editedCount})
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
              <button className="btn btn-sm" style={{background:'#006600', color:'#fff', borderColor:'#004400'}}
                onClick={() => {
                  setDefectForm({ estimateType:'', estimateDate:new Date().toISOString().slice(0,10), prodKey:'', unit:'단', quantity:'', cost:'', descr:'' });
                  setShowDefect(true);
                }}>
                ＋ 불량/검역 등록 / Reg. Defecto
              </button>
              <button className="btn btn-sm">✏️ 수정 / Editar</button>
              <button className="btn btn-sm" style={{color:'var(--red)'}}>🗑️ 삭제 / Eliminar</button>
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
                      <th style={{textAlign:'right'}}>단가</th>
                      <th style={{textAlign:'right', background:'#FFF9E6'}}>단가 수정</th>
                      <th style={{textAlign:'right'}}>공급가액</th>
                      <th style={{textAlign:'right'}}>부가세</th>
                      <th>비고</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.length === 0
                      ? <tr><td colSpan={9} style={{textAlign:'center', padding:32, color:'var(--text3)'}}>
                          {selectedId ? '견적서 데이터 없음' : '거래처를 선택하세요'}
                        </td></tr>
                      : filteredItems.map((item, i) => {
                          const isDed = item.EstimateType && item.EstimateType !== '정상출고';
                          const sdk = item.SdetailKey;
                          const editVal = sdk != null ? (costEdits[sdk] ?? '') : '';
                          const isEdited = editVal !== '' && !isNaN(parseFloat(editVal)) && parseFloat(editVal) !== item.Cost;
                          return (
                          <tr key={i} style={{background: isEdited ? '#E6F7FF' : (isDed ? '#FFF8DC' : '')}}>
                            <td style={{fontSize:12, fontWeight:500, color: isDed ? '#A0522D' : ''}}>
                              {isDed && <span style={{fontSize:10, color:'#B8860B', marginRight:3}}>
                                [{item.EstimateType.replace(/\/(박스|단|송이)$/,'')}]
                              </span>}
                              {item.ProdName}
                            </td>
                            <td style={{fontSize:12}}>{item.Unit}</td>
                            <td style={{fontFamily:'var(--mono)', fontSize:12}}>{fmtDate(item.outDate)}</td>
                            <td className="num" style={{color: isDed ? '#C0392B' : ''}}>{fmt(item.Quantity)}</td>
                            <td className="num">{fmt(item.Cost)}</td>
                            <td style={{textAlign:'right', padding:'2px 4px', background:'#FFFDF5'}}>
                              {isDed ? (
                                <span style={{fontSize:10, color:'var(--text3)'}}>—</span>
                              ) : (
                                <input
                                  type="number"
                                  value={editVal}
                                  onChange={e => {
                                    const v = e.target.value;
                                    setCostEdits(prev => {
                                      const next = { ...prev };
                                      if (v === '') delete next[sdk];
                                      else next[sdk] = v;
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
                                  disabled={costApplying}
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
                {costApplying && !costResult ? '🔄 단가 적용 중...' : (costResult?.success ? '✅ 단가 적용 완료' : '❌ 오류')}
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
                  <div><strong>공급가 변동:</strong> {costResult.totalDiff >= 0 ? '+' : ''}{(costResult.totalDiff || 0).toLocaleString()}원</div>
                  <div style={{ marginTop: 6, color: '#2f855a' }}>
                    견적서가 재로딩되었습니다. 새 단가가 반영된 것을 확인하세요.
                  </div>
                </div>
              )}

              {costResult && !costResult.success && (
                <div style={{ padding: 12, background: '#FFF5F5', border: '1px solid #FEB2B2', borderRadius: 6, fontSize: 12, color: '#c53030' }}>
                  <strong>오류:</strong> {costResult.error}
                  <div style={{ marginTop: 4, fontSize: 11 }}>
                    트랜잭션이 롤백되었습니다. DB 는 변경되지 않았습니다.
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
              <span className="modal-title">🖨️ 견적서 출력 옵션</span>
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
                    수국/알스트로 · 카네이션 · 장미 · 에콰도르 · 기타 로 분리 출력됩니다
                  </div>
                )}
              </div>

              {/* 미리보기 요약 */}
              <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '8px 12px', fontSize: 11, color: 'var(--text2)' }}>
                <div>거래처: <b>{selectedShip?.CustName || '—'}</b></div>
                <div>차수: <b>{weekNum || '—'}</b></div>
                <div>품목수: <b>{filteredItems.length}건</b></div>
                <div>합계: <b>₩{(totalSupply + totalVat).toLocaleString()}</b> (공급가액 ₩{totalSupply.toLocaleString()} + 세액 ₩{totalVat.toLocaleString()})</div>
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
