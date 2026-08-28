// 주차별 매출이익 보고서 — "매출원가 양식.xlsx" 첫 시트와 동일 셀 구조.
// 자동(SQL/수식): N순수매출·L불량·O그외매출·Q구매외화·E/F 확정재고·H통관비·R환율·S포워딩USD
// 직접 입력은 현재 차수에 매입이 있는데 정확한 과세환율(R) 원천이 없을 때만 본표에 연다.
// 매입이 없는 차수는 최근 이전 차수의 정확한 환율을 이어 사용한다. H/S는 각 원천 화면에서 관리한다.
// 계산열은 엑셀 수식 그대로: C=N+L+O, G=P+T, P=Q×R, T=S×R, I=E+G+H−F, J=C−I, K=J/C, M=−L/C, D=C/ΣC, U=P/ΣP
// (이스라엘·뉴질랜드·일본: I=E+G+H, J=C−I+F, K=J/(C+F) — 원본 수식 변형 유지)
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
// Layout 은 _app.js 가 전역 래핑 — 페이지 자체 래핑 금지(이중 사이드바 원인)
import { getCurrentWeek, useWeekInput } from '../../lib/useWeekInput';
import { getPreviousProfitReportPeriod } from '../../lib/profitReportDefaultPeriod.mjs';
import { computeProfitRow, computeProfitTotals, calcRevenueRatio, calcPurchaseRatio } from '../../lib/profitReportCalc';
import CustomsClearancePanel from '../../components/CustomsClearancePanel';
import ForwardingClearancePanel from '../../components/ForwardingClearancePanel';
import ProfitReportSourceGuide from '../../components/ProfitReportSourceGuide';

function getDefaultYear() {
  const m = String(getCurrentWeek() || '').match(/^(\d{4})-/);
  return m ? m[1] : String(new Date().getFullYear());
}
function getDefaultWeeklyPeriod() {
  const previous = getPreviousProfitReportPeriod(getCurrentWeek());
  return previous.year && previous.major
    ? previous
    : { year: getDefaultYear(), major: '' };
}
const fmt = v => (v == null || Number.isNaN(v) ? '' : Math.round(v).toLocaleString());
const fmtMonthly = (v, hasData = true) => (!hasData || v == null || Number.isNaN(Number(v)) ? '—' : Math.round(Number(v)).toLocaleString());
const pct = v => (v == null || !Number.isFinite(v) ? '' : `${(v * 100).toFixed(1)}%`);
const fmtInput = v => {
  if (v == null || v === '') return '';
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n).toLocaleString() : '';
};

// 컬럼 정의 — 표시/숨김 토글 + 엑셀 다운로드 필터에 공용으로 쓰는 단일 소스
const COLUMN_DEFS = [
  { key: 'category', label: '품명' },
  { key: 'C', label: '매출액' },
  // 차수귀속 조정(2026-08-26) — 원본 엑셀이 하던 수동 조정을 근거와 함께 입력하는 열.
  // AC는 C·J에, AJ는 J에만 반영된다(lib/profitReportCalc.js computeProfitRow).
  { key: 'AC', label: '매출조정', editable: true, editWidth: 90 },
  { key: 'D', label: '매출비율' },
  { key: 'E', label: '기초상품재고액' },
  { key: 'F', label: '기말상품재고액' },
  { key: 'G', label: '매입액(상품+포워딩)' },
  { key: 'H', label: '그외통관비' },
  { key: 'I', label: '매출원가', bold: true },
  { key: 'J', label: '매출이익', bold: true },
  { key: 'AJ', label: '이익조정', editable: true, editWidth: 90 },
  { key: 'K', label: '이익률' },
  { key: 'L', label: '불량금액', color: '#1d4ed8' },
  { key: 'M', label: '불량율' },
  { key: 'N', label: '순수매출액', color: '#1d4ed8' },
  { key: 'O', label: '그 외 매출액', color: '#1d4ed8' },
  { key: 'P', label: '상품 금액(구매)' },
  { key: 'Q', label: '구매금액(외화)', color: '#1d4ed8' },
  { key: 'R', label: '환율', editable: true, editWidth: 70 },
  { key: 'S', label: '포워딩(USD)' },
  { key: 'T', label: '포워딩 원화환산' },
  { key: 'U', label: '상품구매비율' },
];
const ALL_COL_KEYS = COLUMN_DEFS.map(c => c.key);
// v2(2026-08-26): 매출조정(AC)/이익조정(AJ) 컬럼 추가 — 기존 저장 프리퍼런스에 새 컬럼이
// 영영 숨겨지지 않도록 키를 올려 1회 기본값(전체표시)으로 리셋한다.
const LS_KEY = 'nenova_profitReport_visibleCols_v2';
const LS_PRESET_KEY = 'nenova_profitReport_colPresets_v1';
const VALIDATION_PANEL_ID = 'profit-report-validation-panel';
const ANALYSIS_PANEL_ID = 'profit-report-analysis-panel';
// 이익률 분석의 변동요인(drivers) 컬럼 라벨 — COLUMN_DEFS 라벨과 동일한 용어를 그대로 재사용.
const DRIVER_LABELS = { C: '매출액', E: '기초상품재고액', F: '기말상품재고액', P: '상품 금액(구매)', H: '그외통관비', T: '포워딩 원화환산' };
// 검증 안내(audit issue) 렌더링 전용 — 내부 열 문자(E/F/H/S/R 등)를 그대로 보여주지 않고
// 사람이 읽는 한글로 바꾼다. audit 객체 자체(code/columns/message)는 서버 값 그대로 두고 UI 출력 단계에서만 변환.
const ISSUE_COLUMN_LABELS = {
  ...Object.fromEntries(COLUMN_DEFS.filter(cd => cd.key !== 'category').map(cd => [cd.key, cd.label])),
  E: '기초재고 매입단가', F: '기말재고 매입단가', H: '그외통관비', S: '항공료·포워딩', R: '과세환율',
};

// 서버 감사 메시지는 계산 계약을 위해 내부 열 문자를 유지한다. 화면에 표시할 때만
// 사용자가 바로 이해할 수 있는 업무 용어로 바꾸며 원본 응답과 저장값은 변경하지 않는다.
function humanizeAuditMessage(message) {
  return String(message || '')
    .replace(/VERIFIED/g, '확인된')
    .replace(/기초 재고수량은 있지만 전차수 확정 스냅샷 시점의 확인된 품목 단가 근거가 없습니다:/g,
      '기초재고에 포함된 다음 품목의 매입단가를 자동으로 찾지 못했습니다:')
    .replace(/기말 재고수량은 있지만 동일 스냅샷 시점의 확인된 품목 단가 근거가 없습니다:/g,
      '기말재고에 포함된 다음 품목의 매입단가를 자동으로 찾지 못했습니다:')
    .replace(/기초 재고수량은 있지만 전차수 확정 스냅샷 시점의 확인된 품목 단가 근거가 부족합니다\./g,
      '기초재고 수량은 있으나 매입단가를 자동으로 찾지 못했습니다.')
    .replace(/기말 재고수량은 있지만 동일 스냅샷 시점의 확인된 품목 단가 근거가 (\d+)건 부족합니다\./g,
      '기말재고 수량은 있으나 매입단가를 자동으로 찾지 못한 품목이 $1건 있습니다.')
    .replace(/\[E\]/g, '[기초재고 매입단가]')
    .replace(/\[F\]/g, '[기말재고 매입단가]')
    .replace(/\[H\]/g, '[그외통관비]')
    .replace(/\[S\]/g, '[항공료·포워딩]')
    .replace(/\[R\]/g, '[과세환율]')
    .replace(/E 최종값/g, '기초상품재고액')
    .replace(/F 최종값/g, '기말상품재고액')
    .replace(/기초상품재고액을 직접 입력하지 말고 해당 품목 단가 근거를 등록해야 합니다\./g,
      '위의 ‘재고 매입단가 입력’에서 해당 품목의 매입단가를 입력하세요.')
    .replace(/기말상품재고액을 직접 입력하지 말고 해당 품목 단가 근거를 등록해야 합니다\./g,
      '위의 ‘재고 매입단가 입력’에서 해당 품목의 매입단가를 입력하세요.')
    .replace(/S 원천/g, '항공료·포워딩 원천')
    .replace(/R 입력칸/g, '과세환율 입력칸')
    .replace(/과세환율\(R\)/g, '과세환율')
    .replace(/그외통관비 원천값이 없어 H가 0으로 계산됩니다\./g,
      '그외통관비 입력값이 없어 0원으로 계산했습니다.')
    .replace(/입고 반차수:/g, '입고 세부차수:')
    .replace(/([가-힣]+)은\(는\)/g, '$1의 경우')
    .replace(/GW2=0/g, '두 번째 입고의 총중량이 0')
    .replace(/-02가 없다고 H를 비우지 말고,/g,
      '두 번째 입고가 없더라도 그외통관비를 비워두지 말고,')
    .replace(/Gross weight\(또는 입고 마스터 GW\)/g, '입고 총중량')
    .replace(/품목 마스터/g, '품목정보')
    .replace(/자동 분류된 항공료 전표/g, '자동 연결된 항공료 내역')
    .replace(/품목명·BILL·AWB 국가 매칭/g, '품목명·청구서·항공운송장의 국가 연결')
    .replace(/C\/D\/I\/J\/K|C·D·I·J·K/g, '매출액·매출비율·매출원가·매출이익·이익률');
}

// 읽기전용 표시값 — 합계행 / 차수별 뷰의 차수 합계행 / 세부표(읽기전용)에 공용
function readonlyValue(key, obj, ctx) {
  switch (key) {
    case 'C': return fmt(obj.C);
    case 'AC': return obj.AC != null && Number(obj.AC) !== 0 ? fmt(obj.AC) : '';
    case 'AJ': return obj.AJ != null && Number(obj.AJ) !== 0 ? fmt(obj.AJ) : '';
    case 'D': return pct(ctx.D);
    case 'E': return fmt(obj.E);
    case 'F': return fmt(obj.F);
    case 'G': return fmt(obj.G);
    case 'H': return fmt(obj.H);
    case 'I': return fmt(obj.I);
    case 'J': return fmt(obj.J);
    case 'K': return pct(obj.K);
    case 'L': return fmt(obj.L);
    case 'M': return pct(obj.M);
    case 'N': return fmt(obj.N);
    case 'O': return fmt(obj.O);
    case 'P': return fmt(obj.P);
    case 'Q': return fmt(obj.Q);
    case 'R': return obj.R ? fmt(obj.R) : '';
    case 'S': return fmt(obj.S);
    case 'T': return fmt(obj.T);
    case 'U': return pct(ctx.U);
    default: return '';
  }
}

// 재고 스냅샷 확인 필요 — 수기입력도 없고, 앵커(실사 시작재고)도 없이 오염 가능성 있는 ProductStock
// 스냅샷에만 의존 중인 E/F. lib/profitReport.js stockSnapshotByCategory 의 anchored 플래그 기반.
function needsCheck(row, col) {
  if (col !== 'E' && col !== 'F') return false;
  if (row.manual[col] != null) return false; // 수기입력 있으면 확인 불필요(사용자가 이미 확정)
  const anchored = col === 'E' ? row.stockAnchored?.begin : row.stockAnchored?.end;
  return anchored === false;
}
const attentionRows = rows => rows.filter(r => needsCheck(r, 'E') || needsCheck(r, 'F'));

// 자동 환율 원천이 없고 매입/포워딩 금액이 있는 행은 사용자가 바로 R을 입력할 수 있어야 한다.
// 검증 배너만 표시하고 입력 경로를 숨기면 보고서 저장이 막히므로, 해당 행의 R 셀을 자동 편집칸으로 노출한다.
function needsRateInput(row) {
  // approximate_currency_master(2026-08-26): 정확 원천이 없어 통화마스터 근사치를 임시 적용한
  // 상태 — 값은 채워져 있지만 입력칸을 계속 열어 통관 신고 환율로 수정·확정할 수 있게 한다.
  if (!row || row.manual?.R != null
    || !['missing', 'approximate_currency_master'].includes(row.source?.R)) return false;
  return Math.abs(Number(row.auto?.Q || 0)) > 0.001 || Math.abs(Number(row.auto?.S || 0)) > 0.001;
}

// 모듈 스코프에 고정 — 컴포넌트 내부에 정의하면 렌더될 때마다 새 함수 identity 가 생겨
// React 가 매번 다른 컴포넌트로 취급해 <input> 을 언마운트시킴(입력 중 포커스 튕김 버그의 원인).
function NumericInput({ value, onChange, style, placeholder, title }) {
  const [focused, setFocused] = useState(false);
  const raw = value == null ? '' : String(value).replace(/,/g, '');
  return (
    <input
      style={style}
      value={focused ? raw : fmtInput(raw)}
      placeholder={placeholder}
      title={title}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        if (raw !== '' && Number.isFinite(Number(raw))) onChange(String(Math.round(Number(raw))));
      }}
      onChange={ev => onChange(ev.target.value.replace(/[^0-9.\-]/g, ''))}
    />
  );
}

function EditCell({ row, col, width = 86, edits, setEdit, autoValue }) {
  const e = edits[row.category]?.[col];
  const base = row.manual[col];
  const auto = autoValue !== undefined ? autoValue
    : col === 'S' ? row.auto.S : col === 'E' ? row.auto.E : col === 'F' ? row.auto.F : col === 'R' ? row.auto.R : col === 'H' ? row.auto.H : null;
  const displayedAuto = fmtInput(auto);
  const val = e !== undefined ? e : (base != null ? base : auto);
  const placeholder = e === '' ? displayedAuto : '';
  const missingRate = col === 'R' && needsRateInput(row);
  const warn = needsCheck(row, col) || missingRate;
  const suggestionText = (row.rateSuggestions || [])
    .map(sg => `${sg.label} ${Number(sg.rate).toLocaleString()}`).join(' / ');
  const carryText = col === 'R' && row.rateCarry?.note ? row.rateCarry.note : '';
  const stockEvidenceText = (stock) => Array.isArray(stock?.priceEvidenceSources) && stock.priceEvidenceSources.length
    ? ` 근거: ${stock.priceEvidenceSources.join(' / ')}` : '';
  const F_SOURCE_TEXT = {
    verified_product_stock_price: 'EXE ProductStock 수량 × 동일 OrderYear+OrderWeek의 확인된 품목 단가 근거',
    verified_arrival_cost: 'EXE ProductStock 수량 × 동일 연도·차수·품목·단위의 사용자 확정 도착원가',
    verified_freight_arrival_calc: 'EXE ProductStock 수량 × 동일 연도·세부차수 입고·항공료 원장으로 계산한 도착원가',
    verified_carried_acquisition_cost: 'EXE ProductStock 수량 × 같은 연도·품목·단위의 이전 확인된 매입원가(근거 이후 새 매입이 없을 때만 이월)',
    verified_mixed_price_evidence: 'EXE ProductStock 수량 × 직접 확정 단가와 사용자 확정 도착원가의 품목별 혼합 근거',
    verified_category_average: '원본 엑셀 공식: (매입액+그외통관비) ÷ 매입수량 × 마지막 EXE ProductStock 수량',
    verified_sample_average: '명시적 샘플 품목: 같은 ProductStock 시점·동일 단위의 비샘플 검증 매입원가 수량가중평균',
    verified_historical_workbook: '2026년 22~28차 원본 엑셀의 기말재고 확정 근거(파일 해시·셀 위치 보존)',
    category_average_fallback: '근사치(원본공식 확대): 품목별 검증 단가가 없어 (매입액+그외통관비) ÷ 매입수량 × ProductStock 수량으로 채움 — 단가 근거 입력 시 정확값으로 대체',
    carried_category_unit_cost: '근사치(단가 이월): 이번 차수 매입이 없어 전차수 재고 평가단가 × 이번 수량으로 채움 — 단가 근거 입력 시 정확값으로 대체',
    sales_price_auto: '판매단가 기준 자동평가(2026-08-27 확정): 검증된 매입근거가 없어 최근 확정 판매단가(×1.1) 또는 최근 매입 근사로 자동 평가 — 실제 매입근거 입력 시 대체',
    missing_price_evidence: '⚠ 재고수량은 있으나 동일 스냅샷의 확인된 단가 근거가 부족합니다',
    missing_stock_snapshot: '⚠ EXE ProductStock 차수 스냅샷이 없습니다',
    no_stock: '이 차수 기말재고 수량이 없습니다',
  };
  const titles = {
    R: missingRate
      ? `⚠ 이 차수의 ${row.currency || '-'} 과세환율(관세청 신고환율) 원천이 없습니다. 통관 신고 환율을 이 칸에 입력하고 저장하세요.${suggestionText ? ` (참고값: ${suggestionText} — 참고값은 적용·저장해야 계산에 들어갑니다)` : ''}`
      : carryText
        ? `과세환율(관세청 신고환율, ${row.currency || '-'}) — ${carryText}. 현재 차수에 새 매입이 생기면 이월값을 쓰지 않고 해당 차수의 정확한 과세환율을 요구합니다.`
        : `과세환율(관세청 신고환율, ${row.currency || '-'}) — 당주 통관 스냅샷(FreightCost) → 이 차수에 저장/캐시된 과세환율 → 2026 22~27차 원본 엑셀값 → 관세청 공식 환율 순으로 적용합니다. 현재 차수에 매입이 없을 때만 가장 최근의 정확한 과세환율을 이어 사용하며, 통화마스터 현재 환율은 자동 적용하지 않습니다.`,
    S: '비우면 입고관리 자동감지(운송료/SERVICE FEE 라인) 사용 — [🚢 포워딩 입력]에서 확인/override 가능, 입력하면 수기값 우선',
    H: '비우면 [📦 그외통관비 입력] 화면 값 사용 — (1차GW+2차GW)×백상단가 + 관세1+관세2 + (선율1+선율2+월드운송료1+월드운송료2+한국방역1+한국방역2)÷1.1. 콜롬비아 4품목은 반차수 TOTAL을 박스당무게×박스수량 비율로 배분. 입력하면 수기값 우선',
    AC: '매출조정 — 다른 차수 귀속 매출(견적 누락분·차수 이동분)을 이 차수 매출에 가감합니다. 매출액(C)과 매출이익(J)에 함께 반영되며, 저장 시 근거(원본 보고서·사유)가 필요합니다.',
    AJ: '이익조정 — 매출은 그대로 두고 매출이익(J)만 가감합니다(원본 엑셀의 J셀 수동 수정과 동일). 저장 시 근거가 필요합니다.',
    E: `기초재고 — 같은 매출연도 전차수(01차만 전년도 52차)의 마지막 EXE ProductStock와 검증된 품목 단가로만 계산합니다.${stockEvidenceText(row.beginStock)} 최종값 직접입력은 허용하지 않습니다.`,
    F: `기말재고 — ${row.stock?.week || '마지막 ProductStock 세부차수'} 기준. ${F_SOURCE_TEXT[row.stockSourceKind?.end] || F_SOURCE_TEXT.missing_stock_snapshot}.${stockEvidenceText(row.stock)} 최종값 직접입력은 허용하지 않습니다.`,
  };
  const title = missingRate
    ? titles[col]
    : needsCheck(row, col)
      ? `⚠ 확인 필요 — 실사 시작재고 없이 재고 스냅샷에만 의존 중(부정확할 수 있음). ${titles[col] || ''}`
      : (titles[col] || '');
  const suggestions = col === 'R' ? (row.rateSuggestions || []) : [];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
      <NumericInput
        style={{ ...st.cellInput, width, background: e !== undefined ? '#fef9c3' : (base != null ? '#ecfdf5' : (warn ? '#fef2f2' : '#fff')), border: warn ? '1px solid #f87171' : undefined }}
        value={val}
        placeholder={placeholder}
        title={title}
        onChange={value => setEdit(row.category, col, value)}
      />
      {suggestions.map((sg) => (
        <button
          key={sg.kind}
          type="button"
          onClick={() => setEdit(row.category, 'R', String(sg.rate))}
          title={`${sg.note || ''} — 클릭하면 이 칸에 채워집니다(저장해야 반영, 이 차수 캐시로도 함께 저장됩니다)`}
          style={{
            fontSize: 9, fontWeight: 700, whiteSpace: 'nowrap', cursor: 'pointer',
            border: 'none', background: 'none', padding: 0, color: '#b45309',
          }}>
          {sg.label} {Number(sg.rate).toLocaleString()} ↵
        </button>
      ))}
    </div>
  );
}

export default function ProfitReportPage() {
  const defaultWeeklyPeriod = useMemo(() => getDefaultWeeklyPeriod(), []);
  const weekInput = useWeekInput(defaultWeeklyPeriod.major);
  const [reportYear, setReportYear] = useState(defaultWeeklyPeriod.year);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [moyiSending, setMoyiSending] = useState(false);
  const [moyiDriveSyncing, setMoyiDriveSyncing] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [data, setData] = useState(null);
  const [edits, setEdits] = useState({});   // { category: { colKey: 'value' } }
  const [note, setNote] = useState('');
  const [noteDirty, setNoteDirty] = useState(false);
  // 보고서 진입 시에는 자동값만 읽기전용으로 보여준다. 입력 패널은 필요한 경우에만 연다.
  const [showCustoms, setShowCustoms] = useState(false);
  const [showForwarding, setShowForwarding] = useState(false);

  // ── 검증·입력(표 아래 접기 영역) — 문제가 있으면 새 차수 조회 때마다 기본으로 펼친다.
  const [showValidation, setShowValidation] = useState(false);

  // ── 이익률 분석(표 아래 접기 영역) — 본표(load)와 완전히 분리된 별도 fetch, 펼쳤을 때만 호출.
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [analysisData, setAnalysisData] = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState('');

  // ── 보고서 기준 확정/취소/이력
  const [confirmHistory, setConfirmHistory] = useState([]);
  const [confirmSchemaInitialized, setConfirmSchemaInitialized] = useState(true);
  const [showConfirmPanel, setShowConfirmPanel] = useState(false);
  const [showConfirmHistory, setShowConfirmHistory] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [forceReason, setForceReason] = useState('');
  const loadConfirmStatus = async (weekOverride, yearOverride) => {
    const wk = weekOverride ?? weekInput.value;
    const yr = yearOverride ?? reportYear;
    try {
      const res = await fetch(`/api/sales/profit-report-confirm?week=${encodeURIComponent(wk)}&year=${encodeURIComponent(yr)}`, { credentials: 'same-origin' });
      const d = await res.json();
      if (!d.success) return;
      setConfirmSchemaInitialized(Boolean(d.initialized));
      setConfirmHistory(d.history || []);
    } catch { /* 확정 이력 조회 실패는 화면 진입을 막지 않는다 */ }
  };

  // ── 컬럼 표시/숨김 (localStorage 에 저장 — 다음에 열어도 유지)
  const [visibleCols, setVisibleCols] = useState(ALL_COL_KEYS);
  const [showColPicker, setShowColPicker] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      if (Array.isArray(saved) && saved.length) setVisibleCols(saved.filter(k => ALL_COL_KEYS.includes(k)));
    } catch { /* 무시 — 기본값(전체표시) 유지 */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(visibleCols)); } catch { /* 저장 불가 환경 무시 */ }
  }, [visibleCols]);
  const isVisible = key => visibleCols.includes(key);
  const toggleCol = key => setVisibleCols(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  const shownColumns = COLUMN_DEFS.filter(cd => cd.key !== 'category' && (isVisible(cd.key) || (cd.key === 'R' && data?.rows?.some(needsRateInput))));

  // ── 컬럼 프리셋 — 이름 붙여 여러 개 저장, 목록에서 골라 바로 전환
  const [colPresets, setColPresets] = useState({}); // { 프리셋이름: [colKey, ...] }
  const [newPresetName, setNewPresetName] = useState('');
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_PRESET_KEY) || 'null');
      if (saved && typeof saved === 'object') setColPresets(saved);
    } catch { /* 무시 */ }
  }, []);
  const savePreset = () => {
    const name = newPresetName.trim();
    if (!name) return;
    setColPresets(prev => {
      const next = { ...prev, [name]: visibleCols };
      try { localStorage.setItem(LS_PRESET_KEY, JSON.stringify(next)); } catch { /* 저장 불가 환경 무시 */ }
      return next;
    });
    setNewPresetName('');
  };
  const applyPreset = name => { if (colPresets[name]) setVisibleCols(colPresets[name]); };
  const deletePreset = name => setColPresets(prev => {
    const next = { ...prev };
    delete next[name];
    try { localStorage.setItem(LS_PRESET_KEY, JSON.stringify(next)); } catch { /* 저장 불가 환경 무시 */ }
    return next;
  });

  // ── 보기 모드: 카테고리별(기본, 편집가능) / 차수별(비교, 읽기전용+펼치기)
  const [viewMode, setViewMode] = useState('category');
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const [weeksLoading, setWeeksLoading] = useState(false);
  const [weeksData, setWeeksData] = useState([]); // [{ major, rows, totals, error }]
  const [expandedWeeks, setExpandedWeeks] = useState(new Set());
  const [monthlyYear, setMonthlyYear] = useState(getDefaultYear());
  const [monthlyLoading, setMonthlyLoading] = useState(false);
  const [monthlyData, setMonthlyData] = useState(null);
  const [expandedMonths, setExpandedMonths] = useState(new Set());

  const load = async (weekOverride, yearOverride) => {
    const wk = weekOverride ?? weekInput.value;
    const yr = yearOverride ?? reportYear;
    setLoading(true); setError(''); setMessage(''); setEdits({});
    try {
      const res = await fetch(`/api/sales/profit-report?week=${encodeURIComponent(wk)}&year=${encodeURIComponent(yr)}`, { credentials: 'same-origin' });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || '조회 실패');
      setData(d);
      setReportYear(String(d.orderYear || yr));
      setNote(d.note || '');
      setNoteDirty(false);
      loadConfirmStatus(wk, yr);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // 이익률 분석 — /api/sales/profit-analysis 를 본표 load()와 완전히 분리해서 부른다.
  // 패널을 펼친 상태에서만 호출하고, 느리거나 실패해도 본표 조회/렌더는 절대 막지 않는다.
  useEffect(() => {
    if (!showAnalysis || viewMode !== 'category' || !data?.major || !data?.orderYear) return;
    let cancelled = false;
    setAnalysisLoading(true); setAnalysisError(''); setAnalysisData(null);
    (async () => {
      try {
        const res = await fetch(`/api/sales/profit-analysis?year=${encodeURIComponent(data.orderYear)}&week=${encodeURIComponent(data.major)}`, { credentials: 'same-origin' });
        const d = await res.json();
        if (cancelled) return;
        if (!d.ok) { setAnalysisError(d.message || '이익률 분석 조회 실패'); return; }
        setAnalysisData(d);
      } catch (e) {
        if (!cancelled) setAnalysisError(e.message || '이익률 분석 조회 실패');
      } finally {
        if (!cancelled) setAnalysisLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAnalysis, viewMode, data?.major, data?.orderYear]);
  const stepWeek = delta => {
    const cur = Number(weekInput.value) || Number(defaultWeeklyPeriod.major) || 1;
    const next = String(Math.max(1, cur + delta)).padStart(2, '0');
    weekInput.setValue(next);
    load(next, reportYear);
  };

  const loadWeeksRange = async () => {
    const from = Number(rangeFrom), to = Number(rangeTo);
    if (!from || !to || from > to) { setError('차수 범위를 확인하세요 (예: 25 ~ 30)'); return; }
    setWeeksLoading(true); setError('');
    try {
      const majors = [];
      for (let m = to; m >= from; m--) majors.push(String(m).padStart(2, '0')); // 최신 차수가 위로
      const results = await Promise.all(majors.map(async (mj) => {
        try {
          const res = await fetch(`/api/sales/profit-report?week=${mj}&year=${encodeURIComponent(reportYear)}`, { credentials: 'same-origin' });
          const d = await res.json();
          if (!d.success) return { major: mj, error: d.error || '조회 실패' };
          // 확정된 차수는 저장된 calc를 그대로 쓴다(재계산 금지 — 계산식이 나중에 바뀌어도 과거 확정본은 불변).
          const rows = d.confirmed
            ? (d.rows || []).map(r => ({ ...r, calc: r.calc || {} }))
            : (d.rows || []).map(r => ({ ...r, calc: computeProfitRow(r) }));
          const totals = d.confirmed ? (d.confirmedTotals || {}) : computeProfitTotals(rows);
          return { major: mj, rows, totals, confirmed: Boolean(d.confirmed) };
        } catch (e) { return { major: mj, error: e.message }; }
      }));
      setWeeksData(results);
    } finally { setWeeksLoading(false); }
  };

  const switchToWeeksView = () => {
    setViewMode('weeks');
    if (!rangeFrom || !rangeTo) {
      const cur = Number(weekInput.value) || Number(defaultWeeklyPeriod.major) || 1;
      setRangeFrom(String(Math.max(1, cur - 5)).padStart(2, '0'));
      setRangeTo(String(cur).padStart(2, '0'));
    }
  };
  const loadMonthly = async (yearOverride) => {
    const year = String(yearOverride ?? monthlyYear).replace(/\D/g, '').slice(0, 4);
    if (!/^\d{4}$/.test(year)) { setError('연도를 확인하세요 (예: 2026)'); return; }
    setMonthlyYear(year);
    setMonthlyData(null); setMonthlyLoading(true); setError(''); setMessage('');
    try {
      const res = await fetch(`/api/sales/profit-report?period=annual&year=${encodeURIComponent(year)}`, { credentials: 'same-origin' });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || '월별 보고서 조회 실패');
      setMonthlyData(d);
    } catch (e) { setError(e.message); } finally { setMonthlyLoading(false); }
  };
  const switchToMonthsView = () => {
    setViewMode('months');
    if (!monthlyData || String(monthlyData.year) !== String(monthlyYear)) loadMonthly(monthlyYear);
  };
  useEffect(() => {
    if (viewMode === 'weeks' && rangeFrom && rangeTo && weeksData.length === 0 && !weeksLoading) loadWeeksRange();
    if (viewMode === 'months' && !monthlyData && !monthlyLoading) loadMonthly(monthlyYear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);
  const toggleExpand = mj => setExpandedWeeks(prev => {
    const n = new Set(prev);
    n.has(mj) ? n.delete(mj) : n.add(mj);
    return n;
  });
  const toggleMonthExpand = month => setExpandedMonths(prev => {
    const n = new Set(prev);
    n.has(month) ? n.delete(month) : n.add(month);
    return n;
  });

  // 확정엑셀 대조(2026-08-26) — 대표 확정 "매출원가 양식" 파일을 올리면 이 차수 웹 계산과
  // 셀 단위 대조 후 규칙 분류 + LLM 소견을 보여준다. 저장/수정 없음(읽기 전용 진단).
  const [excelAudit, setExcelAudit] = useState(null);
  const [excelAuditBusy, setExcelAuditBusy] = useState(false);
  const excelAuditFileRef = useRef(null);
  const runExcelAudit = async (file) => {
    setExcelAuditBusy(true); setError(''); setMessage('');
    try {
      const body = new FormData();
      body.append('week', weekInput.value);
      body.append('year', data?.orderYear || reportYear);
      body.append('file', file, file.name);
      const res = await fetch('/api/sales/profit-report-excel-audit', { method: 'POST', credentials: 'same-origin', body });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || '대조 실패');
      setExcelAudit(d);
      setMessage(`확정엑셀 대조 완료 — 확인 필요 ${d.counts.review}건 · 구조적 차이 ${d.counts.expected}건`);
    } catch (e) { setError(`확정엑셀 대조 실패: ${e.message}`); } finally { setExcelAuditBusy(false); }
  };

  const save = async () => {
    setSaving(true); setError(''); setMessage('');
    try {
      const values = {};
      const evidence = {};
      for (const row of data?.rows || []) {
        const e = edits[row.category] || {};
        const out = {};
        for (const col of ['R', 'AC', 'AJ']) {
          if (e[col] === undefined) continue;
          out[col] = e[col] === '' ? null : Number(e[col]);
          const rawEvidence = window.prompt(`${row.category} ${col} 외부 근거를 'sourceRef|YYYY-MM-DD' 형식으로 입력하세요.`, 'invoice:|');
          if (!rawEvidence) throw new Error(`${row.category}.${col} 외부 근거 입력이 취소되었습니다.`);
          const [sourceRef, effectiveAt] = rawEvidence.split('|').map(value => value.trim());
          if (!sourceRef || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveAt || '')) throw new Error(`${row.category}.${col} 근거 형식이 올바르지 않습니다.`);
          if (!evidence[row.category]) evidence[row.category] = {};
          evidence[row.category][col] = { sourceRef, effectiveAt };
        }
        if (Object.keys(out).length) values[row.category] = out;
      }
      const res = await fetch('/api/sales/profit-report', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ week: weekInput.value, year: data?.orderYear || reportYear, values, evidence, note }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || '저장 실패');
      // R을 직접 입력/적용한 카테고리는 이 차수(OrderYear+MajorWeek+통화+카테고리)의 과세환율
      // 캐시(WebTaxableExchangeRate)에도 함께 저장한다 — 같은 통화의 다른 카테고리·다음 조회에
      // "정확히 이 차수" 원천으로 재사용되도록(자동 상속이 아니라 사람이 확정한 값의 저장).
      const rateSaves = (data?.rows || [])
        .filter((row) => values[row.category]?.R != null)
        .map(async (row) => {
          const rateRes = await fetch('/api/sales/profit-report', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
            body: JSON.stringify({
              week: weekInput.value, year: reportYear, action: 'saveTaxableRate',
              currency: row.currency || 'USD', category: row.category,
              rate: values[row.category].R, rateSource: 'manual_input',
              sourceDate: evidence[row.category]?.R?.effectiveAt || null,
              sourceNote: evidence[row.category]?.R?.sourceRef || null,
            }),
          });
          const rateBody = await rateRes.json().catch(() => ({}));
          if (!rateRes.ok || !rateBody.success) {
            throw new Error(`${row.category} 과세환율 별도 저장 실패: ${rateBody.error || `HTTP ${rateRes.status}`}`);
          }
          return rateBody;
        });
      if (rateSaves.length) {
        try {
          await Promise.all(rateSaves);
        } catch (rateError) {
          await load();
          setMessage('보고서 수기값은 저장되었습니다.');
          setError(`${rateError.message} — 과세환율을 확인해 다시 저장하세요.`);
          return false;
        }
      }
      await load();
      setMessage('저장 완료 — 외부 근거가 연결된 통관비/환율/포워딩 값과 비고가 보관되었습니다.');
      return true;
    } catch (e) { setError(e.message); return false; } finally { setSaving(false); }
  };

  const saveNote = async () => {
    setSaving(true); setError(''); setMessage('');
    try {
      const res = await fetch('/api/sales/profit-report', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ week: weekInput.value, year: reportYear, action: 'saveNote', note }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || '비고 저장 실패');
      await load();
      setMessage('비고사항 저장 완료');
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  // 확정된 주차는 저장된 calc를 그대로 쓴다(재계산 금지 — 이후 계산식이 바뀌어도 과거 확정본은 불변).
  // edits는 확정 화면에서는 애초에 입력칸이 잠겨 있어 채워지지 않지만, 방어적으로도 무시한다.
  const rowsCalc = useMemo(() => {
    if (data?.confirmed) {
      const rows = (data?.rows || []).map(r => ({ ...r, calc: r.calc || {} }));
      return { rows, totals: data.confirmedTotals || {} };
    }
    const rows = (data?.rows || []).map(r => ({ ...r, calc: computeProfitRow(r, edits) }));
    return { rows, totals: computeProfitTotals(rows) };
  }, [data, edits]);

  const confirmReport = async (force) => {
    setConfirmBusy(true); setError(''); setMessage('');
    try {
      if (force && !forceReason.trim()) throw new Error('강제 확정 사유를 입력해야 합니다.');
      const res = await fetch('/api/sales/profit-report-confirm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ week: weekInput.value, year: reportYear, action: force ? 'force' : 'confirm', reason: force ? forceReason : undefined }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || '확정 실패');
      setShowConfirmPanel(false); setForceReason('');
      await load();
      setMessage(`보고서 기준 확정 완료 — Revision ${d.revisionNo}${force ? ' (강제 확정)' : ''}. 이 차수는 이제 저장된 확정값만 표시됩니다.`);
    } catch (e) { setError(e.message); } finally { setConfirmBusy(false); }
  };

  const cancelConfirmReport = async () => {
    if (!window.confirm(`${data?.orderYear}년 ${data?.major}차 확정을 취소할까요? 취소 후 다시 확정하면 새 revision으로 저장되며, 이전 확정 기록은 이력에 남습니다.`)) return;
    setConfirmBusy(true); setError(''); setMessage('');
    try {
      const res = await fetch('/api/sales/profit-report-confirm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ week: weekInput.value, year: reportYear, action: 'cancel' }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || '확정 취소 실패');
      await load();
      setMessage('확정 취소 완료 — 다시 라이브 자동값으로 계산합니다. 필요하면 값을 확인한 뒤 다시 확정하세요.');
    } catch (e) { setError(e.message); } finally { setConfirmBusy(false); }
  };

  const downloadExcel = async () => {
    if (dirty && !(await save())) return;  // 수정 중이던 수기값/비고를 먼저 저장해 파일에 반영
    const colsParam = visibleCols.filter(k => k !== 'category').join(',');
    window.location.href = `/api/sales/profit-report?week=${encodeURIComponent(weekInput.value)}&year=${encodeURIComponent(reportYear)}&excel=1&cols=${encodeURIComponent(colsParam)}`;
  };

  const sendToMoyi = async () => {
    if (!data || moyiSending) return;
    if (dirty && !(await save())) return;
    if (!window.confirm(`${data.orderYear}년 ${data.major}차 주차별 매출이익 보고서를 MOYI Drive로 전송할까요?`)) return;
    setMoyiSending(true); setError(''); setMessage('');
    try {
      const res = await fetch('/api/moyi/report-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ week: weekInput.value, year: data.orderYear }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.success) throw new Error(d.error || 'MOYI 전송에 실패했습니다.');
      setMessage(`MOYI Drive 전송 완료 — ${d.fileName} · ${Number(d.sizeBytes || 0).toLocaleString()} bytes`);
    } catch (e) {
      setError(e.message);
    } finally {
      setMoyiSending(false);
    }
  };

  const syncDriveToMoyi = async () => {
    if (moyiDriveSyncing) return;
    if (dirty && !(await save())) return;
    if (!window.confirm(`${reportYear}년 전체 차수의 주차별 매출이익 엑셀(2번째 시트=월별)을 MOYI 회사 드라이브 경영지원/보고 폴더로 동기화할까요?`)) return;
    setMoyiDriveSyncing(true); setError(''); setMessage('');
    try {
      const res = await fetch('/api/moyi/drive-report-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ year: reportYear }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || (!d.success && !d.sent)) throw new Error(d.error || 'MOYI 드라이브 동기화에 실패했습니다.');
      const failNote = d.failed ? ` · 실패 ${d.failed}건 (전송 이력 확인)` : '';
      setMessage(`MOYI 드라이브 동기화 완료 — ${d.folder} 폴더에 ${d.sent}개 차수 파일 갱신${failNote}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setMoyiDriveSyncing(false);
    }
  };

  // ── 재고 평가단가표 모달
  const [priceModal, setPriceModal] = useState(null);   // { beginOrderYear, beginWeek, endOrderYear, endWeek, rows }
  const [priceEdits, setPriceEdits] = useState({});
  const priceInputRows = useMemo(() => (priceModal?.rows || []).flatMap(row => [
    row.BeginRequiresInput ? {
      ...row,
      Scope: 'begin',
      ScopeLabel: '기초',
      ScopeOrderYear: priceModal.beginOrderYear,
      ScopeOrderWeek: priceModal.beginWeek,
      ScopeStock: row.StockBegin,
      ScopeStockEst: row.StockBeginEst,
      EditKey: `begin:${row.ProdKey}`,
    } : null,
    row.EndRequiresInput ? {
      ...row,
      Scope: 'end',
      ScopeLabel: '기말',
      ScopeOrderYear: priceModal.endOrderYear,
      ScopeOrderWeek: priceModal.endWeek,
      ScopeStock: row.StockEnd,
      ScopeStockEst: row.StockEndEst,
      EditKey: `end:${row.ProdKey}`,
    } : null,
  ].filter(Boolean)), [priceModal]);
  // 제안 적용 흐름(2026-08-27) — 제안가를 그대로 적용한 행은 제안 출처가 근거로 자동 기록되고,
  // 값을 고친 행은 기존처럼 근거를 직접 입력한다.
  const [priceAutoEvidence, setPriceAutoEvidence] = useState({});
  const applySuggestion = (row) => {
    if (row.SuggestedPrice == null) return;
    setPriceEdits(prev => ({ ...prev, [row.EditKey]: String(row.SuggestedPrice) }));
    setPriceAutoEvidence(prev => ({
      ...prev,
      [row.EditKey]: {
        price: Number(row.SuggestedPrice),
        sourceRef: `자동제안(${row.SuggestedSource === 'recent_sales_price' ? '판매단가' : '최근 매입원가 근사'}) — ${row.SuggestedDetail} · 사장님 방침 2026-08-27(26~31차 백테스트 오차율 판매단가 7.3%)`,
        effectiveAt: row.SuggestedEffectiveAt || new Date().toISOString().slice(0, 10),
      },
    }));
  };
  const applyAllSuggestions = () => { for (const row of priceInputRows) applySuggestion(row); };
  const openPriceModal = async () => {
    setPriceEdits({});
    setPriceAutoEvidence({});
    try {
      const res = await fetch(`/api/sales/profit-report?week=${encodeURIComponent(weekInput.value)}&year=${encodeURIComponent(reportYear)}&stockPrices=1`, { credentials: 'same-origin' });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || '단가표 조회 실패');
      setPriceModal(d);
    } catch (e) { setError(e.message); }
  };
  const savePrices = async () => {
    try {
      const batches = new Map();
      for (const row of priceInputRows) {
        const price = priceEdits[row.EditKey];
        if (price == null || price === '') continue;
        // 제안을 그대로 적용한 행은 제안 출처를 근거로 자동 사용한다(값을 고치면 직접 입력으로 전환).
        const auto = priceAutoEvidence[row.EditKey];
        let sourceRef; let effectiveAt;
        if (auto && Number(price) === Number(auto.price)) {
          sourceRef = auto.sourceRef; effectiveAt = auto.effectiveAt;
        } else {
          const rawEvidence = window.prompt(`${row.ScopeLabel} ${row.ProdName} 매입단가 근거를 'sourceRef|YYYY-MM-DD' 형식으로 입력하세요.`, 'invoice:|');
          if (!rawEvidence) throw new Error(`${row.ScopeLabel} ${row.ProdName} 단가 근거 입력이 취소되었습니다.`);
          [sourceRef, effectiveAt] = rawEvidence.split('|').map(value => value.trim());
        }
        if (!sourceRef || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveAt || '')) throw new Error(`${row.ScopeLabel} ${row.ProdName} 근거 형식이 올바르지 않습니다.`);
        const batchKey = `${row.ScopeOrderYear}:${row.ScopeOrderWeek}`;
        if (!batches.has(batchKey)) batches.set(batchKey, { orderYear: row.ScopeOrderYear, orderWeek: row.ScopeOrderWeek, prices: {} });
        batches.get(batchKey).prices[row.ProdKey] = { price: Number(price), sourceRef, effectiveAt };
      }
      if (!batches.size) throw new Error('입력한 매입단가가 없습니다.');
      for (const batch of batches.values()) {
        const res = await fetch('/api/sales/profit-report', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
          body: JSON.stringify({
            action: 'stockPrices', week: String(batch.orderWeek || '').slice(0, 2), year: batch.orderYear,
            orderWeek: batch.orderWeek, prices: batch.prices,
          }),
        });
        const d = await res.json();
        if (!d.success) throw new Error(d.error || `${batch.orderYear}년 ${batch.orderWeek} 단가 저장 실패`);
      }
      setPriceModal(null);
      setMessage('재고 매입단가 근거 저장 — 기초·기말 평가액을 다시 계산했습니다.');
      await load();
    } catch (e) { setError(e.message); }
  };

  const setEdit = (cat, col, val) => setEdits(prev => ({ ...prev, [cat]: { ...(prev[cat] || {}), [col]: val } }));
  const dirty = Object.keys(edits).length > 0 || noteDirty;
  const { rows, totals } = rowsCalc;
  const needsAttention = attentionRows(rows);

  // ── 검증·입력 접기 영역 요약 — 배너 4종(감사 오류/실사 확인/과세환율 입력/기타미분류)의
  // 개수를 모아 접힌 헤더에도 문제 여부를 보여준다. 조건식 자체는 각 배너 렌더 위치에서
  // 그대로 재사용하며 여기서는 개수 집계·기본 펼침 판단에만 쓴다.
  const validationUnclassified = rows.some(r => r.category === '기타(미분류)');
  const validationRateRows = data?.rows ? data.rows.filter(needsRateInput) : [];
  const hasValidationIssues = Boolean(
    (data?.audit?.issues?.length > 0) ||
    needsAttention.length > 0 ||
    validationRateRows.length > 0 ||
    validationUnclassified
  );
  const auditIssues = data?.audit?.issues || [];
  const directInputCodes = new Set([
    'STOCK_BEGIN_PRICE_EVIDENCE_MISSING',
    'STOCK_END_PRICE_EVIDENCE_MISSING',
    'CUSTOMS_INCOMPLETE',
    'TAXABLE_RATE_MISSING',
  ]);
  const directInputIssues = auditIssues.filter(issue => issue.severity === 'error' && directInputCodes.has(issue.code));
  const sourceReviewIssues = auditIssues.filter(issue => issue.severity === 'error' && !directInputCodes.has(issue.code));
  const noticeIssues = auditIssues.filter(issue => issue.severity !== 'error');
  // 과세환율·미분류는 이미 audit issue에 포함되므로 별도 배너 수를 다시 더하지 않는다.
  const validationCount = auditIssues.length + needsAttention.length;
  const stockPriceInputNeeded = auditIssues.some(issue => [
    'STOCK_BEGIN_PRICE_EVIDENCE_MISSING',
    'STOCK_END_PRICE_EVIDENCE_MISSING',
    'STOCK_BEGIN_UNIT_MIXED',
    'STOCK_END_UNIT_MIXED',
  ].includes(issue.code));
  const customsInputNeeded = auditIssues.some(issue => issue.code === 'CUSTOMS_INCOMPLETE');
  const forwardingSourceReviewNeeded = auditIssues.some(issue => String(issue.code || '').startsWith('FORWARDING_'));
  const requiredInputCount = validationRateRows.length
    + (stockPriceInputNeeded ? 1 : 0)
    + (customsInputNeeded ? 1 : 0)
    + (forwardingSourceReviewNeeded ? 1 : 0);
  // 차수를 새로 조회할 때마다 문제 유무로 기본 펼침을 다시 판단한다(사용자가 그 뒤 수동으로
  // 접고 펼치는 것은 다음 조회 전까지 유지).
  useEffect(() => {
    setShowValidation(hasValidationIssues);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // 읽기전용 세부표 — 차수별 뷰에서 펼쳤을 때 쓰는 카테고리별 내역(편집 불가)
  const ReadonlyDetailTable = ({ rows: wRows, totals: wTotals }) => (
    <table style={st.table}>
      <thead>
        <tr>
          {isVisible('category') && <th style={{ ...st.th, ...st.stickyCol, background: '#334155', zIndex: 3 }}>품명</th>}
          {shownColumns.map(cd => <th key={cd.key} style={st.th}>{cd.label}</th>)}
        </tr>
      </thead>
      <tbody>
        {wRows.map(row => {
          const c = row.calc;
          // 확정 스냅샷 행은 저장된 D/U를 그대로 쓴다(재계산 금지 — 비율 공식이 나중에 바뀌어도
          // 과거 확정본은 불변이어야 한다. 2026-08-11 결함수정).
          const D = row.confirmed ? c.D : calcRevenueRatio(c, wTotals);
          const U = row.confirmed ? c.U : calcPurchaseRatio(c, wTotals);
          return (
            <tr key={row.category} style={row.category === '기타(미분류)' ? { background: '#fffbeb' } : undefined}>
              {isVisible('category') && (
                <td style={{ ...st.td, ...st.stickyCol, fontWeight: 700 }}
                  title={row.category === '기타(미분류)' ? '국가·화종 매핑에 들지 않은 거래입니다. 아래 합계(매출액·매출비율·매출원가·매출이익·이익률)에 포함되지 않는 검증 전용 행이며, 품목의 국가/화종을 정정해야 정식 카테고리로 반영됩니다.' : undefined}>
                  {row.category}{row.category === '기타(미분류)' ? ' ※합계 제외' : ''}
                </td>
              )}
              {shownColumns.map(cd => (
                <td key={cd.key} style={{ ...st.tdNum, fontWeight: cd.bold ? 700 : undefined, color: cd.key === 'J' ? (c.J < 0 ? '#dc2626' : '#166534') : cd.color }}>
                  {readonlyValue(cd.key, c, { D, U })}
                </td>
              ))}
            </tr>
          );
        })}
        <tr style={{ background: '#e2e8f0', fontWeight: 800 }}>
          {isVisible('category') && <td style={{ ...st.td, ...st.stickyCol, background: '#e2e8f0' }}>합계</td>}
          {shownColumns.map(cd => (
            <td key={cd.key} style={{ ...st.tdNum, color: cd.key === 'J' ? (wTotals.J < 0 ? '#dc2626' : '#166534') : undefined }}>
              {readonlyValue(cd.key, wTotals, { D: wTotals.D ?? 1, U: wTotals.U ?? 1 })}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );

  return (
    <div style={st.page}>
      <div style={st.bar}>
        <h1 style={st.h1}>📈 {viewMode === 'months' ? '월별 매출이익 보고서' : '주차별 매출이익 보고서'}{viewMode === 'months' && monthlyData ? ` — ${monthlyData.year}` : data ? ` — ${data.major}차 (${data.orderYear})` : ''}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
          <div style={st.viewToggleWrap}>
            <button style={viewMode === 'category' ? st.viewToggleOn : st.viewToggleOff} onClick={() => setViewMode('category')}>카테고리별</button>
            <button style={viewMode === 'weeks' ? st.viewToggleOn : st.viewToggleOff} onClick={switchToWeeksView}>차수별</button>
            <button style={viewMode === 'months' ? st.viewToggleOn : st.viewToggleOff} onClick={switchToMonthsView}>월별</button>
          </div>
          {viewMode === 'category' ? (
            <>
              <label style={st.label}>연도</label>
              <input
                style={{ ...st.weekInput, borderRight: '1px solid #cbd5e1', borderRadius: 8, width: 66 }}
                value={reportYear}
                onChange={e => setReportYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
                onKeyDown={e => { if (e.key === 'Enter') load(undefined, reportYear); }}
                placeholder="2026"
                aria-label="보고서 연도"
              />
              <label style={st.label}>차수</label>
              <div style={st.weekStepperWrap}>
                <input style={st.weekInput} value={weekInput.value} onChange={e => weekInput.setValue(e.target.value)} placeholder="27" />
                <div style={st.weekStepperBtns}>
                  <button style={st.weekStepperBtn} onClick={() => stepWeek(1)} disabled={loading} title="다음 차수">▲</button>
                  <button style={st.weekStepperBtn} onClick={() => stepWeek(-1)} disabled={loading} title="이전 차수">▼</button>
                </div>
              </div>
              <button style={st.primaryBtn} onClick={() => load()} disabled={loading}>{loading ? '조회 중…' : '조회'}</button>
              <button style={{ ...st.primaryBtn, background: dirty ? '#16a34a' : '#94a3b8' }} onClick={save} disabled={saving || !data || data?.confirmed}
                title={data?.confirmed ? '확정된 차수입니다 — 수정하려면 먼저 확정을 취소하세요' : undefined}>
                {saving ? '저장 중…' : `저장${dirty ? ' *' : ''}`}
              </button>
              <button style={{ ...st.primaryBtn, background: '#0f766e' }} onClick={downloadExcel} disabled={!data || saving}
                title="원본 양식과 동일한 첫 시트 + 현재 화면에 표시된 컬럼만 담은 두번째 시트, 총 2개 시트로 다운로드">
                📥 엑셀 다운로드
              </button>
              <button style={{ ...st.primaryBtn, background: '#7c3aed' }} onClick={sendToMoyi} disabled={!data || saving || moyiSending}
                title="현재 주차별 매출이익 보고서 원본 XLSX를 MOYI Drive로 전송하고 성공·실패·재시도 이력을 남깁니다">
                {moyiSending ? '📤 MOYI 전송 중…' : '📤 MOYI 전송'}
              </button>
              <button style={{ ...st.primaryBtn, background: '#4338ca' }} onClick={syncDriveToMoyi} disabled={moyiDriveSyncing}
                title="올해 전체 차수의 매출이익 엑셀(첫 시트=주차, 2번째 시트=월별)을 MOYI 회사 드라이브 경영지원/보고 폴더에 차수별 파일로 동기화합니다">
                {moyiDriveSyncing ? '📲 드라이브 동기화 중…' : '📲 MOYI 드라이브 동기화'}
              </button>
              <button style={{ ...st.primaryBtn, background: '#b45309' }} onClick={() => excelAuditFileRef.current?.click()} disabled={!data || excelAuditBusy}
                title="확정 매출원가 양식 엑셀을 업로드하면 이 차수의 웹 계산과 셀 단위로 대조해, 규칙 분류와 AI 소견으로 오류값 여부를 알려줍니다(저장·수정 없음)">
                {excelAuditBusy ? '📑 대조 중…' : '📑 확정엑셀 대조'}
              </button>
              <input ref={excelAuditFileRef} type="file" accept=".xlsx,.xlsm,.xls" style={{ display: 'none' }} aria-label="확정엑셀 대조 파일 선택"
                onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) runExcelAudit(f); }} />
              {data?.confirmed ? (
                <button style={{ ...st.primaryBtn, background: '#b91c1c' }} onClick={cancelConfirmReport} disabled={confirmBusy}
                  title="확정을 취소하면 다시 라이브 자동값으로 계산합니다. 취소해도 이전 확정 기록은 이력에 남습니다">
                  {confirmBusy ? '처리 중…' : '↩ 확정 취소 후 다시 계산'}
                </button>
              ) : (
                <button style={{ ...st.primaryBtn, background: '#0369a1' }} onClick={() => setShowConfirmPanel(v => !v)} disabled={!data || confirmBusy}
                  title="현재 계산값을 이 차수의 확정본으로 저장합니다 — 이후 원천이 바뀌어도 이 값은 그대로 유지됩니다">
                  📌 보고서 기준 확정
                </button>
              )}
              <button style={showConfirmHistory ? st.toggleBtnOn : st.secondaryBtn} onClick={() => setShowConfirmHistory(v => !v)} disabled={!data}
                title="이 차수의 확정/취소 이력(revision·확정자·시각)을 봅니다">
                🕘 확정 이력{showConfirmHistory ? ' ▲' : ' ▼'}
              </button>
            </>
          ) : viewMode === 'weeks' ? (
            <>
              <label style={st.label}>연도</label>
              <input
                style={{ ...st.weekInput, borderRight: '1px solid #cbd5e1', borderRadius: 8, width: 66 }}
                value={reportYear}
                onChange={e => setReportYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="2026"
                aria-label="차수별 보고서 연도"
              />
              <label style={st.label}>차수범위</label>
              <input style={{ ...st.weekInput, width: 50 }} value={rangeFrom} onChange={e => setRangeFrom(e.target.value.replace(/\D/g, ''))} placeholder="25" />
              <span style={{ color: '#94a3b8' }}>~</span>
              <input style={{ ...st.weekInput, width: 50 }} value={rangeTo} onChange={e => setRangeTo(e.target.value.replace(/\D/g, ''))} placeholder="30" />
              <button style={st.primaryBtn} onClick={loadWeeksRange} disabled={weeksLoading}>{weeksLoading ? '조회 중…' : '조회'}</button>
            </>
          ) : (
            <>
              <label style={st.label}>연도</label>
              <input
                style={{ ...st.weekInput, borderRight: '1px solid #cbd5e1', borderRadius: 8, width: 78 }}
                value={monthlyYear}
                onChange={e => setMonthlyYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
                onKeyDown={e => { if (e.key === 'Enter') loadMonthly(); }}
                placeholder="2026"
              />
              <button style={st.primaryBtn} onClick={() => loadMonthly()} disabled={monthlyLoading}>{monthlyLoading ? '조회 중…' : '조회'}</button>
            </>
          )}
          <div style={{ position: 'relative' }}>
            <button style={st.secondaryBtn} onClick={() => setShowColPicker(v => !v)} title="표시할 컬럼을 선택합니다 — 선택은 브라우저에 저장돼 다음에 열어도 유지됩니다">
              ⚙ 컬럼 ({visibleCols.length}/{ALL_COL_KEYS.length})
            </button>
            {showColPicker && (
              <div style={st.colPicker}>
                <div style={st.colPickerHead}>
                  <span>표시할 컬럼</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button style={st.colPickerMiniBtn} onClick={() => setVisibleCols(ALL_COL_KEYS)}>전체</button>
                    <button style={st.colPickerMiniBtn} onClick={() => setVisibleCols(['category'])}>해제</button>
                  </div>
                </div>
                {COLUMN_DEFS.map(cd => (
                  <label key={cd.key} style={st.colPickerRow}>
                    <input type="checkbox" checked={isVisible(cd.key)} onChange={() => toggleCol(cd.key)} />
                    {cd.label}
                  </label>
                ))}

                <div style={st.colPickerDivider} />
                <div style={st.colPickerHead}><span>프리셋</span></div>
                {Object.keys(colPresets).length === 0 && (
                  <div style={{ fontSize: 11, color: '#94a3b8', padding: '2px 2px 6px' }}>저장된 프리셋이 없습니다</div>
                )}
                {Object.keys(colPresets).map(name => (
                  <div key={name} style={st.presetRow}>
                    <button style={st.presetApplyBtn} onClick={() => applyPreset(name)} title={`이 프리셋 적용 (${(colPresets[name] || []).length}개 컬럼)`}>
                      ★ {name}
                    </button>
                    <button style={st.presetDelBtn} onClick={() => deletePreset(name)} title="프리셋 삭제">✕</button>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                  <input
                    style={st.presetNameInput}
                    value={newPresetName}
                    onChange={e => setNewPresetName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') savePreset(); }}
                    placeholder="새 프리셋 이름"
                  />
                  <button style={st.colPickerMiniBtn} onClick={savePreset} disabled={!newPresetName.trim()} title="지금 체크한 컬럼 구성을 이 이름으로 저장">저장</button>
                </div>

                <button style={{ ...st.primaryBtn, width: '100%', marginTop: 8 }} onClick={() => setShowColPicker(false)}>닫기</button>
              </div>
            )}
          </div>
        </div>
      </div>
      <div style={st.hint}>
        {viewMode === 'months' ? (
          <>월별 화면은 <b>PeriodDay의 실제 차수 기간</b>으로 분류합니다. 한 달 안에 완전히 들어오는 차수만 월별 합계에 포함하고, 월경계 차수는 별도 확인목록에 남깁니다. 기초·기말재고는 기존 주차 원장 기준을 유지하며 월 단위로 재계산하지 않습니다.</>
        ) : (
          <>자동 입력: 매출·구매·재고수량·항공료는 전산에서 불러옵니다. <b>기초·기말상품재고액은 확정 재고수량에 확인된 매입원가를 적용</b>합니다.
          그외통관비와 원천이 없는 과세환율만 아래 <b>입력·확인 필요</b> 영역에서 입력하세요. 재고 매입단가는 검증된 매입근거가 없으면 최근 판매단가 기준으로 자동 평가되며(2026-08-27 확정), 실제 매입근거를 입력하면 그 값이 우선합니다.
          과세환율은 해당 차수의 입고별 과세환율 → 해당 차수에 저장한 과세환율 → 2026년 22~27차 원본 엑셀값 → 28차 이후 관세청 공식 환율 순서로 사용합니다. 이번 차수에 매입이 없으면 최근 이전 차수의 정확한 환율을 이어 사용하고, 매입이 있는데 원천이 없을 때만 표의 환율 입력칸이 열립니다. 금액·수량은 소수점 없이 천 단위 콤마로 표시합니다.
          {data?.stockWeeks?.end ? ` · 재고 스냅샷: 기말=${data.stockWeeks.end}${data.stockWeeks.begin ? `, 기초=${data.stockWeeks.begin}말` : ''}` : ''}
          {data?.rates?.length ? ` · 참고 환율: ${data.rates.map(r => `${r.CurrencyCode} ${fmt(r.ExchangeRate)}`).join(' · ')}` : ''}</>
        )}
      </div>

      <ProfitReportSourceGuide />

      {error && <div style={st.error}>{error}</div>}
      {message && <div style={st.message}>{message}</div>}

      {viewMode === 'category' && data?.confirmed && (
        <div style={st.confirmBanner}>
          ✅ <b>확정됨</b> — Revision {data.confirmed.revisionNo} · 확정자 {data.confirmed.confirmedByName || data.confirmed.confirmedBy || '-'} ·{' '}
          {data.confirmed.confirmedAt ? new Date(data.confirmed.confirmedAt).toLocaleString('ko-KR') : '-'}
          {data.confirmed.isForced && <span style={{ marginLeft: 6, color: '#b91c1c', fontWeight: 800 }}>· 강제 확정 (사유: {data.confirmed.forceReason || '-'})</span>}
          <div style={{ marginTop: 4, fontSize: 11.5, fontWeight: 400 }}>
            이 차수는 확정 시점에 저장된 값만 표시합니다(원천이 나중에 바뀌어도 재계산하지 않음). 값을 다시 계산하려면 위 <b>확정 취소 후 다시 계산</b>을 누르세요.
          </div>
        </div>
      )}
      {viewMode === 'category' && data && !data.confirmed && !confirmSchemaInitialized && (
        <div style={st.attentionBanner}>
          ℹ 보고서 기준 확정 기능은 아직 <b>초기 설정 필요</b> 상태입니다 — 이 차수의 조회/저장/엑셀 다운로드는 평소대로 동작합니다. 처음 확정을 누르면 Web 전용 확정 테이블이 자동으로 준비됩니다.
        </div>
      )}

      {viewMode === 'category' && data && showConfirmPanel && !data.confirmed && (
        <div style={st.embedPanel}>
          <div style={st.embedPanelHead}>
            <strong>📌 보고서 기준 확정 — {data.major}차</strong>
            <button style={st.tinyCloseBtn} onClick={() => setShowConfirmPanel(false)}>접기 ▲</button>
          </div>
          <div style={{ ...st.embedPanelBody, fontSize: 12.5, lineHeight: 1.7 }}>
            현재 화면에 표시된 계산값을 그대로 이 차수의 확정본(Revision {(confirmHistory[0]?.revisionNo || 0) + 1})으로 저장합니다.
            확정 후에는 원천 데이터가 바뀌어도 이 값이 자동으로 바뀌지 않습니다 — 값을 다시 반영하려면 확정을 취소한 뒤 다시 확정해야 합니다.
            {data.audit?.errorCount > 0 ? (
              <div style={{ marginTop: 8, padding: 9, background: '#fff7ed', border: '1px solid #f97316', borderRadius: 8, color: '#9a3412' }}>
                <b>확인할 항목 {data.audit.errorCount}건이 남아 있어 일반 확정은 저장할 수 없습니다.</b> 아래 상세 확인 내역의 각 항목을 먼저 해결하세요.
                불가피하게 오류가 있는 상태로 확정해야 한다면 아래 강제 확정을 관리자 권한으로 사유와 함께 사용하세요.
                <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <textarea style={{ ...st.noteArea, minHeight: 44, flex: 1, minWidth: 220 }} placeholder="강제 확정 사유(필수) — 예: 재고조정 이력 반영 지연, 담당자 확인 완료 등" value={forceReason} onChange={e => setForceReason(e.target.value)} />
                  <button style={{ ...st.primaryBtn, background: '#b91c1c' }} onClick={() => confirmReport(true)} disabled={confirmBusy || !forceReason.trim()}>
                    {confirmBusy ? '처리 중…' : '🔒 강제 확정(관리자 전용)'}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 8 }}>
                {data.audit?.warningCount > 0 && <div style={{ marginBottom: 6, color: '#92400e' }}>⚠ 확인 안내 {data.audit.warningCount}건이 있지만 오류는 아니므로 그대로 확정할 수 있습니다.</div>}
                <button style={{ ...st.primaryBtn, background: '#16a34a' }} onClick={() => confirmReport(false)} disabled={confirmBusy}>
                  {confirmBusy ? '확정 중…' : '✅ 이 값으로 확정'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {viewMode === 'category' && data && showConfirmHistory && (
        <div style={st.embedPanel}>
          <div style={st.embedPanelHead}>
            <strong>🕘 확정 이력 — {data.major}차</strong>
            <button style={st.tinyCloseBtn} onClick={() => setShowConfirmHistory(false)}>접기 ▲</button>
          </div>
          <div style={st.embedPanelBody}>
            {confirmHistory.length === 0 ? (
              <div style={{ fontSize: 12.5, color: '#64748b' }}>확정 이력이 없습니다.</div>
            ) : (
              <table style={st.table}>
                <thead>
                  <tr>
                    <th style={st.th}>Revision</th><th style={st.th}>상태</th><th style={st.th}>확정자</th><th style={st.th}>확정시각</th>
                    <th style={st.th}>취소자</th><th style={st.th}>취소시각</th><th style={st.th}>강제확정 사유</th>
                  </tr>
                </thead>
                <tbody>
                  {confirmHistory.map(rev => (
                    <tr key={rev.confirmKey}>
                      <td style={st.td}>{rev.revisionNo}</td>
                      <td style={{ ...st.td, color: rev.isActive ? '#166534' : '#94a3b8', fontWeight: 700 }}>{rev.isActive ? '활성' : '취소됨'}</td>
                      <td style={st.td}>{rev.confirmedByName || rev.confirmedBy || '-'}</td>
                      <td style={st.td}>{rev.confirmedAt ? new Date(rev.confirmedAt).toLocaleString('ko-KR') : '-'}</td>
                      <td style={st.td}>{rev.cancelledByName || rev.cancelledBy || '-'}</td>
                      <td style={st.td}>{rev.cancelledAt ? new Date(rev.cancelledAt).toLocaleString('ko-KR') : '-'}</td>
                      <td style={st.td}>{rev.isForced ? (rev.forceReason || '(사유 없음)') : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {viewMode === 'category' && data && (
        <div style={st.requiredWrap}>
          <div style={st.requiredHead}>
            <span style={st.requiredTitle}>📝 입력·확인 필요</span>
            <span style={requiredInputCount > 0 ? st.collapseBadgeWarn : st.collapseBadgeOk}>
              {requiredInputCount > 0 ? `⚠ ${requiredInputCount}건` : '문제 없음'}
            </span>
          </div>
          <div style={st.requiredActions}>
            {stockPriceInputNeeded && (
              <button style={st.secondaryBtn} onClick={openPriceModal} disabled={data?.confirmed}
                title={data?.confirmed ? '확정된 차수입니다 — 수정하려면 먼저 확정을 취소하세요' : '자동으로 찾지 못한 재고 매입단가만 입력합니다'}>
                🏷 재고 매입단가 입력
              </button>
            )}
            {customsInputNeeded && (
              <button style={showCustoms ? st.toggleBtnOn : st.secondaryBtn} onClick={() => setShowCustoms(v => !v)} disabled={data?.confirmed}
                title={data?.confirmed ? '확정된 차수입니다 — 수정하려면 먼저 확정을 취소하세요' : '백상창고료·관세·선율·월드운송료·한국방역·콜롬비아 무게배분 입력 — 그외통관비 자동값의 소스, 저장하면 아래 표가 바로 재계산됩니다'}>
                📦 그외통관비 입력{showCustoms ? ' ▲' : ' ▼'}
              </button>
            )}
            {forwardingSourceReviewNeeded && (
              <button style={showForwarding ? st.toggleBtnOn : st.secondaryBtn} onClick={() => setShowForwarding(v => !v)} disabled={data?.confirmed}
                title={data?.confirmed ? '확정된 차수입니다 — 수정하려면 먼저 확정을 취소하세요' : '금액을 임의 입력하지 않고 누락된 항공료 전표 연결을 확인합니다'}>
                🚢 항공료 연결 확인{showForwarding ? ' ▲' : ' ▼'}
              </button>
            )}
            {validationRateRows.length > 0 && (
              <span style={st.requiredNotice}>⚠ 과세환율 입력 필요 {validationRateRows.length}건 — 아래 표의 환율 칸이 자동으로 열렸습니다</span>
            )}
            {requiredInputCount === 0 && (
              <span style={st.requiredOkNotice}>입력·확인이 필요한 항목이 없습니다</span>
            )}
          </div>
          {showCustoms && (
            <div style={st.embedPanel}>
              <div style={st.embedPanelHead}>
                <strong>📦 그외통관비 입력 — {data.major}차</strong>
                <button style={st.tinyCloseBtn} onClick={() => setShowCustoms(false)}>접기 ▲</button>
              </div>
              <div style={st.embedPanelBody}>
                <CustomsClearancePanel week={weekInput.value} year={reportYear} onSaved={load} />
              </div>
            </div>
          )}
          {showForwarding && (
            <div style={st.embedPanel}>
              <div style={st.embedPanelHead}>
                <strong>🚢 포워딩 입력 — {data.major}차</strong>
                <button style={st.tinyCloseBtn} onClick={() => setShowForwarding(false)}>접기 ▲</button>
              </div>
              <div style={st.embedPanelBody}>
                <ForwardingClearancePanel week={weekInput.value} year={reportYear} onSaved={load} />
              </div>
            </div>
          )}
        </div>
      )}

      {viewMode === 'category' && excelAudit && (
        <div style={{ background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: 10, padding: '12px 14px', margin: '10px 0', fontSize: 13 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <strong>📑 확정엑셀 대조 — {Number(excelAudit.major)}차 · {excelAudit.fileName}</strong>
            <span style={{ color: excelAudit.counts.review ? '#b91c1c' : '#166534', fontWeight: 700 }}>
              확인 필요 {excelAudit.counts.review}건 · 구조적 차이 {excelAudit.counts.expected}건
            </span>
            <button style={{ ...st.secondaryBtn, marginLeft: 'auto' }} onClick={() => setExcelAudit(null)}>닫기</button>
          </div>
          <div style={{ whiteSpace: 'pre-wrap', margin: '8px 0', lineHeight: 1.6 }}>
            {excelAudit.llmOpinion
              ? <><b>AI 소견({excelAudit.llmModel}):</b> {excelAudit.llmOpinion}</>
              : <><b>요약:</b> {excelAudit.ruleSummary}</>}
          </div>
          {excelAudit.diffs.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: 12.5, minWidth: 720 }}>
                <thead><tr>
                  {['품명', '항목', '엑셀 확정값', '웹 계산값', '차이(웹−엑셀)', '분류'].map(h => (
                    <th key={h} style={{ border: '1px solid #e2e8f0', padding: '4px 8px', background: '#f8fafc', textAlign: 'left' }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {excelAudit.diffs
                    .filter(d => d.col !== 'I')
                    .sort((a, b) => (a.severity === b.severity ? Math.abs(b.diff || 0) - Math.abs(a.diff || 0) : a.severity === 'review' ? -1 : 1))
                    .map((d, i) => (
                      <tr key={i} style={d.severity === 'review' ? { background: '#fef2f2' } : undefined}>
                        <td style={{ border: '1px solid #e2e8f0', padding: '3px 8px' }}>{d.category}</td>
                        <td style={{ border: '1px solid #e2e8f0', padding: '3px 8px' }}>{d.label}</td>
                        <td style={{ border: '1px solid #e2e8f0', padding: '3px 8px', textAlign: 'right' }}>{d.excel == null ? '' : Math.round(d.excel).toLocaleString()}</td>
                        <td style={{ border: '1px solid #e2e8f0', padding: '3px 8px', textAlign: 'right' }}>{d.web == null ? '' : Math.round(d.web).toLocaleString()}</td>
                        <td style={{ border: '1px solid #e2e8f0', padding: '3px 8px', textAlign: 'right', fontWeight: 700 }}>{d.diff == null ? '' : Math.round(d.diff).toLocaleString()}</td>
                        <td style={{ border: '1px solid #e2e8f0', padding: '3px 8px' }}>{d.severity === 'review' ? '⚠ ' : '· '}{d.causeLabel}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {viewMode === 'category' && data && (
        <div style={st.tableWrap}>
          <table style={st.table}>
            <thead>
              <tr>
                {isVisible('category') && <th style={{ ...st.th, ...st.stickyCol, background: '#1e293b', zIndex: 3 }}>품명</th>}
                {shownColumns.map(cd => <th key={cd.key} style={st.th}>{cd.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const c = row.calc;
                // 확정 스냅샷 행은 저장된 D/U를 그대로 쓴다(재계산 금지 — 2026-08-11 결함수정).
                const D = row.confirmed ? c.D : calcRevenueRatio(c, totals);
                const U = row.confirmed ? c.U : calcPurchaseRatio(c, totals);
                return (
                  <tr key={row.category} style={row.category === '기타(미분류)' ? { background: '#fffbeb' } : undefined}>
                    {isVisible('category') && (
                      <td style={{ ...st.td, ...st.stickyCol, fontWeight: 700 }}
                        title={row.category === '기타(미분류)' ? '국가·화종 매핑에 들지 않은 거래입니다. 아래 합계(매출액·매출비율·매출원가·매출이익·이익률)에 포함되지 않는 검증 전용 행이며, 품목의 국가/화종을 정정해야 정식 카테고리로 반영됩니다.' : undefined}>
                        {row.category}{row.category === '기타(미분류)' ? ' ※합계 제외' : ''}
                      </td>
                    )}
                    {shownColumns.map(cd => (
                      <td key={cd.key} style={{ ...st.tdNum, fontWeight: cd.bold ? 700 : undefined, color: cd.key === 'J' ? (c.J < 0 ? '#dc2626' : '#166534') : cd.color }}>
                        {!data.confirmed && cd.editable && row.category !== '기타(미분류)'
                          && (cd.key === 'R' ? needsRateInput(row) : (cd.key === 'AC' || cd.key === 'AJ'))
                          ? <EditCell row={row} col={cd.key} width={cd.editWidth || 86} edits={edits} setEdit={setEdit} />
                          : readonlyValue(cd.key, c, { D, U })}
                      </td>
                    ))}
                  </tr>
                );
              })}
              <tr style={{ background: '#e2e8f0', fontWeight: 800 }}>
                {isVisible('category') && <td style={{ ...st.td, ...st.stickyCol, background: '#e2e8f0' }}>합계</td>}
                {shownColumns.map(cd => (
                  <td key={cd.key} style={{ ...st.tdNum, color: cd.key === 'J' ? (totals.J < 0 ? '#dc2626' : '#166534') : undefined }}>
                    {readonlyValue(cd.key, totals, { D: totals.D ?? 1, U: totals.U ?? 1 })}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {viewMode !== 'months' && data && (
        <div style={st.collapseWrap}>
          <button
            type="button"
            onClick={() => setShowValidation(v => !v)}
            aria-expanded={showValidation}
            aria-controls={VALIDATION_PANEL_ID}
            style={st.collapseToggle}
            title="감사 오류·재고 확인 필요 등 계산에 사용된 자동값의 상세 진단 내역입니다 — 계산 전 필수 입력이 아닙니다"
          >
            <span aria-hidden="true" style={st.caret}>{showValidation ? '▾' : '▸'}</span>
            상세 확인 내역
            <span style={validationCount > 0 ? st.collapseBadgeWarn : st.collapseBadgeOk}>
              {validationCount > 0 ? `상세 확인 ${validationCount}건` : '상세 확인 (문제 없음)'}
            </span>
            <span style={st.toggleHint}>{showValidation ? '접기' : '펼치기'}</span>
          </button>
          <div id={VALIDATION_PANEL_ID} hidden={!showValidation} style={showValidation ? st.collapsePanel : undefined}>
            {showValidation && (
              <>
                {viewMode !== 'months' && data?.audit?.issues?.length > 0 && (
                  <div style={data.audit.status === 'needs_input' ? st.auditError : st.auditWarning}>
                    <strong>처리할 항목: 직접 입력 {directInputIssues.length}건 · 자동 연결 확인 {sourceReviewIssues.length}건 · 안내 {noticeIssues.length}건</strong>
                    {[
                      ['직접 입력 필요', directInputIssues, '#9a3412'],
                      ['자동 연결 확인 필요', sourceReviewIssues, '#9a3412'],
                      ['안내', noticeIssues, '#92400e'],
                    ].map(([label, items, color]) => items.length > 0 && (
                      <div key={label} style={{ marginTop: 8 }}>
                        <b style={{ color }}>{label} ({items.length})</b>
                        <ul style={{ margin: '4px 0 0', paddingLeft: 20, maxHeight: 190, overflowY: 'auto' }}>
                          {items.map((issue, i) => (
                            <li key={`${issue.code}-${issue.category}-${i}`}>
                              <b>{issue.category}</b>
                              {issue.columns?.length > 0 && (
                                <span style={{ color: '#78716c' }}> ({(issue.columns || []).map(col => ISSUE_COLUMN_LABELS[col] || col).join(' · ')})</span>
                              )} {humanizeAuditMessage(issue.message)}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}

                {viewMode === 'category' && data && needsAttention.length > 0 && (
                  <div style={st.attentionBanner}>
                    ⚠ <b>확인 필요</b> — 실사 시작재고(차수피벗)가 없어 전산의 차수별 재고만 사용했습니다. 기초·기말재고가 실제 수량과 다를 수 있습니다:{' '}
                    {needsAttention.map(r => r.category).join(', ')}
                  </div>
                )}

                {viewMode === 'category' && data && data.rows?.some(needsRateInput) && (
                  <div style={st.attentionBanner}>
                    ⚠ <b>과세환율 입력 필요</b> — 이번 차수에 매입이 있는데 <b>이 차수</b>의 관세청 과세환율 원천이 없는 행이 있습니다. 매입이 없는 행은 최근 이전 차수의 정확한 환율을 자동으로 이어 사용합니다.
                    해당 행의 환율 입력칸이 자동으로 열렸으니 통관 신고 환율을 입력한 뒤 저장하세요.
                    <div style={{ marginTop: 4, fontSize: 11, color: '#7c2d12' }}>
                      자동으로 채우지 않는 이유: 통화마스터 현재 환율이나 전차수 환율을 과거 차수에 그대로 넣으면 확정된 손익이 조용히 바뀝니다.
                      입력칸에 마우스를 올리면 참고값(전차수·통화마스터)을 볼 수 있고, 적용·저장해야 계산에 반영됩니다.
                    </div>
                  </div>
                )}

                {viewMode === 'category' && data && rows.some(r => r.category === '기타(미분류)') && (
                  <div style={st.attentionBanner}>
                    ⚠ <b>기타(미분류) 검증 영역</b> — 국가·화종 매핑에 들지 않은 거래가 있습니다.
                    이 행은 <b>본표 합계(매출액·매출비율·매출원가·매출이익·이익률)와 엑셀 다운로드 합계에 포함되지 않으며</b>, 임의로 다른 카테고리에 합산하지도 않습니다.
                    품목마스터의 국가(CounName)/화종(FlowerName)을 정정하면 정식 카테고리로 반영됩니다. 상세 품목은 아래 비고사항에 자동 기록됩니다.
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {viewMode === 'category' && data && (
        <div style={st.collapseWrap}>
          <button
            type="button"
            onClick={() => setShowAnalysis(v => !v)}
            aria-expanded={showAnalysis}
            aria-controls={ANALYSIS_PANEL_ID}
            style={st.collapseToggle}
            title="이 차수의 이익률(K)을 직전 차수 평균과 비교하고 변동 요인을 보여줍니다 — 본표 조회와 별도로 불러옵니다"
          >
            <span aria-hidden="true" style={st.caret}>{showAnalysis ? '▾' : '▸'}</span>
            📈 이익률 분석
            <span style={st.toggleHint}>{showAnalysis ? '접기' : '펼치기'}</span>
          </button>
          <div id={ANALYSIS_PANEL_ID} hidden={!showAnalysis} style={showAnalysis ? st.collapsePanel : undefined}>
            {showAnalysis && (
              <>
                {analysisLoading && <div style={st.message}>이익률 분석을 불러오는 중…</div>}
                {analysisError && <div style={st.error}>{analysisError}</div>}
                {!analysisLoading && !analysisError && analysisData && (
                  <>
                    {analysisData.provisional && (
                      <div style={st.attentionBanner}>
                        ⚠ <b>잠정 분석</b> — 아래 값은 최종이 아닐 수 있습니다.
                        {analysisData.provisionalReasons?.length > 0 && (
                          <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                            {analysisData.provisionalReasons.map((reason, i) => <li key={i}>{reason}</li>)}
                          </ul>
                        )}
                      </div>
                    )}

                    {(() => {
                      const t = analysisData.trend?.trend || {};
                      const improved = t.ppDiff != null && t.ppDiff >= 0;
                      return (
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 10 }}>
                          이번 {analysisData.major}차 이익률 {t.currentK != null ? pct(t.currentK) : '—'} vs 직전 {t.priorCount ?? 0}개 차수 평균 {t.avgPriorK != null ? pct(t.avgPriorK) : '—'}
                          {t.priorCount != null && t.priorCount < 4 ? ` (직전 ${t.priorCount}개 차수 평균 — 4개 미만)` : ''}
                          {t.ppDiff != null && (
                            <span style={{ marginLeft: 8, fontWeight: 800, color: improved ? '#166534' : '#dc2626' }}>
                              {improved ? '+' : ''}{t.ppDiff.toFixed(2)}pp
                            </span>
                          )}
                        </div>
                      );
                    })()}

                    <div style={{ fontSize: 12.5, fontWeight: 800, color: '#334155', marginBottom: 4 }}>차수별 이익률</div>
                    <table style={{ ...st.table, minWidth: 0, marginBottom: 12 }}>
                      <thead>
                        <tr><th style={st.th}>차수</th><th style={st.th}>이익률</th><th style={st.th}>원천</th></tr>
                      </thead>
                      <tbody>
                        {[analysisData.trend?.currentWeek, ...(analysisData.trend?.priorWeeks || [])].filter(Boolean).map((w, i) => (
                          <tr key={`${w.major}-${i}`}>
                            <td style={st.td}>{Number(w.major)}차{i === 0 ? ' (이번 차수)' : ''}</td>
                            <td style={st.tdNum}>{w.K != null ? pct(w.K) : '—'}</td>
                            <td style={st.td}>
                              <span style={w.source === 'snapshot' ? st.collapseBadgeOk : w.source === 'live' ? st.sourceBadgeLive : st.sourceBadgeMissing}>
                                {w.source === 'snapshot' ? '확정' : w.source === 'live' ? '실시간 계산' : '데이터 없음'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <div style={{ fontSize: 12.5, fontWeight: 800, color: '#334155', marginBottom: 4 }}>변동 요인 (매출이익에 미친 영향)</div>
                    <table style={{ ...st.table, minWidth: 0, marginBottom: 12 }}>
                      <thead>
                        <tr>
                          <th style={st.th}>항목</th><th style={st.th}>이번 차수</th><th style={st.th}>직전 평균</th>
                          <th style={st.th}>금액 증감</th><th style={st.th}>증감률</th><th style={st.th}>이익 영향</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(analysisData.drivers || []).map(d => (
                          <tr key={d.column}>
                            <td style={st.td}>{DRIVER_LABELS[d.column] || d.column}</td>
                            <td style={st.tdNum}>{d.currentValue != null ? fmt(d.currentValue) : '—'}</td>
                            <td style={st.tdNum}>{d.priorAvgValue != null ? fmt(d.priorAvgValue) : '—'}</td>
                            <td style={st.tdNum}>{d.delta != null ? fmt(d.delta) : '—'}</td>
                            <td style={st.tdNum}>{d.pctDelta != null ? pct(d.pctDelta) : '—'}</td>
                            <td style={{ ...st.tdNum, fontWeight: 800, color: d.profitImpact > 0 ? '#166534' : d.profitImpact < 0 ? '#dc2626' : undefined }}>
                              {d.profitImpact != null ? (d.profitImpact > 0 ? '+' : '') + fmt(d.profitImpact) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <div style={{ fontSize: 12.5, fontWeight: 800, color: '#334155', marginBottom: 4 }}>단가 하락 후보</div>
                    {analysisData.priceMixStatus === 'failed' ? (
                      <div style={{ ...st.attentionBanner, marginBottom: 12 }}>⚠ 분석 실패·확인 필요 — {analysisData.priceMixFailureReason || '단가 후보를 불러오지 못했습니다.'}</div>
                    ) : (analysisData.priceDecreaseCandidates || []).length === 0 ? (
                      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>해당 없음</div>
                    ) : (
                      <table style={{ ...st.table, minWidth: 0, marginBottom: 12 }}>
                        <thead>
                          <tr><th style={st.th}>거래처</th><th style={st.th}>품목</th><th style={st.th}>이번 단가</th><th style={st.th}>직전 단가</th><th style={st.th}>변화율</th><th style={st.th}>비고</th></tr>
                        </thead>
                        <tbody>
                          {analysisData.priceDecreaseCandidates.map((c, i) => (
                            <tr key={`${c.custKey}-${c.prodKey}-${i}`}>
                              <td style={st.td}>{c.custName}</td>
                              <td style={st.td}>{c.productName || `품목 #${c.prodKey}`}</td>
                              <td style={st.tdNum}>{c.currentPrice != null ? fmt(c.currentPrice) : '—'}</td>
                              <td style={st.tdNum}>{c.priorPrice != null ? fmt(c.priorPrice) : '—'}</td>
                              <td style={st.tdNum}>{c.pctChange != null ? pct(c.pctChange) : '—'}</td>
                              <td style={st.td}>{c.note}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    <div style={{ fontSize: 12.5, fontWeight: 800, color: '#334155', marginBottom: 4 }}>저가 구성비 후보</div>
                    {analysisData.priceMixStatus === 'failed' ? (
                      <div style={st.attentionBanner}>⚠ 분석 실패·확인 필요 — 정상 조회 후 판단할 수 있습니다.</div>
                    ) : (analysisData.lowPriceMixCandidates || []).length === 0 ? (
                      <div style={{ fontSize: 12, color: '#64748b' }}>해당 없음</div>
                    ) : (
                      <table style={{ ...st.table, minWidth: 0 }}>
                        <thead>
                          <tr><th style={st.th}>거래처</th><th style={st.th}>품목</th><th style={st.th}>이번 단가</th><th style={st.th}>동종 가중평균</th><th style={st.th}>동종 중앙값</th><th style={st.th}>비중 변화(pp)</th><th style={st.th}>비고</th></tr>
                        </thead>
                        <tbody>
                          {analysisData.lowPriceMixCandidates.map((c, i) => (
                            <tr key={`${c.custKey}-${c.prodKey}-${i}`}>
                              <td style={st.td}>{c.custName}</td>
                              <td style={st.td}>{c.productName || `품목 #${c.prodKey}`}</td>
                              <td style={st.tdNum}>{c.currentPrice != null ? fmt(c.currentPrice) : '—'}</td>
                              <td style={st.tdNum}>{c.peerWeightedAvg != null ? fmt(c.peerWeightedAvg) : '—'}</td>
                              <td style={st.tdNum}>{c.peerMedian != null ? fmt(c.peerMedian) : '—'}</td>
                              <td style={st.tdNum}>{c.shareDeltaPp != null ? c.shareDeltaPp.toFixed(2) : '—'}</td>
                              <td style={st.td}>{c.note}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {viewMode === 'weeks' && (
        <div style={st.tableWrap}>
          <table style={st.table}>
            <thead>
              <tr>
                <th style={{ ...st.th, ...st.stickyCol, background: '#1e293b', zIndex: 3 }}>차수</th>
                {shownColumns.map(cd => <th key={cd.key} style={st.th}>{cd.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {weeksData.map(w => {
                if (w.error) {
                  return (
                    <tr key={w.major}>
                      <td style={{ ...st.td, ...st.stickyCol, fontWeight: 700 }}>{Number(w.major)}차</td>
                      <td style={{ ...st.td, color: '#dc2626' }} colSpan={shownColumns.length}>조회 실패: {w.error}</td>
                    </tr>
                  );
                }
                const expanded = expandedWeeks.has(w.major);
                return (
                  <Fragment key={w.major}>
                    <tr style={{ cursor: 'pointer', background: expanded ? '#eff6ff' : undefined }} onClick={() => toggleExpand(w.major)}>
                      <td style={{ ...st.td, ...st.stickyCol, fontWeight: 700, background: expanded ? '#eff6ff' : '#f8fafc' }}>
                        {expanded ? '▼' : '▶'} {Number(w.major)}차
                      </td>
                      {shownColumns.map(cd => (
                        <td key={cd.key} style={{ ...st.tdNum, fontWeight: cd.bold ? 700 : undefined, color: cd.key === 'J' ? (w.totals.J < 0 ? '#dc2626' : '#166534') : cd.color }}>
                          {readonlyValue(cd.key, w.totals, { D: w.totals.D ?? 1, U: w.totals.U ?? 1 })}
                        </td>
                      ))}
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={shownColumns.length + 1} style={{ padding: 0, border: '1px solid #e2e8f0' }}>
                          <div style={{ padding: 8, background: '#f8fafc' }}>
                            <ReadonlyDetailTable rows={w.rows} totals={w.totals} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {weeksData.length === 0 && !weeksLoading && (
                <tr><td style={st.td} colSpan={shownColumns.length + 1}>차수 범위를 입력하고 조회하세요.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {viewMode === 'months' && monthlyData && (
        <>
          <div style={st.monthlyInfo}>
            <b>{monthlyData.year}년 월별 관리손익</b> — 기존 주차별 계산 결과를 <b>PeriodDay 종료일이 속한 달</b>에 차수 단위로 귀속합니다.
            월경계를 넘는 차수도 종료일 기준 다음 달에 한 번만 포함하며, 기초·기말재고는 월 단위로 재계산하거나 합산하지 않습니다.
          </div>
          <div style={st.tableWrap}>
            <table style={{ ...st.table, minWidth: 980 }}>
              <thead>
                <tr>
                  <th style={{ ...st.th, ...st.stickyCol, background: '#1e293b', zIndex: 3 }}>월</th>
                  <th style={st.th}>포함 차수</th>
                  <th style={st.th}>월경계 차수(종료일 기준 귀속)</th>
                  <th style={st.th}>매출액</th>
                  <th style={st.th}>매출원가</th>
                  <th style={st.th}>매출이익</th>
                  <th style={st.th}>이익률</th>
                  <th style={st.th}>상태</th>
                </tr>
              </thead>
              <tbody>
                {(monthlyData.months || []).map(month => {
                  const expanded = expandedMonths.has(month.month);
                  const hasData = month.includedWeeks?.length > 0;
                  const status = month.status === 'included_with_boundary'
                    ? '포함 차수 + 월경계 귀속'
                    : month.status === 'included'
                      ? '포함 완료'
                      : month.status === 'boundary_only'
                        ? '월경계 귀속 차수만 있음'
                        : '포함 차수 없음';
                  const canExpand = Boolean(month.includedWeeks?.length || month.boundaryWeeks?.length);
                  return (
                    <Fragment key={month.month}>
                      <tr
                        style={{ cursor: canExpand ? 'pointer' : undefined, background: expanded ? '#eff6ff' : undefined }}
                        onClick={() => canExpand && toggleMonthExpand(month.month)}
                      >
                        <td style={{ ...st.td, ...st.stickyCol, fontWeight: 800, background: expanded ? '#eff6ff' : '#f8fafc' }}>
                          {canExpand ? (expanded ? '▼' : '▶') : '·'} {month.month}월
                        </td>
                        <td style={st.td}>{month.includedWeeks?.map(w => `${Number(w.major)}차`).join(', ') || '—'}</td>
                        <td style={{ ...st.td, color: month.boundaryWeeks?.length ? '#b45309' : '#64748b' }}>{month.boundaryWeeks?.map(w => `${Number(w.major)}차`).join(', ') || '—'}</td>
                        <td style={st.tdNum}>{fmtMonthly(month.totals?.C, hasData)}</td>
                        <td style={st.tdNum}>{fmtMonthly(month.totals?.I, hasData)}</td>
                        <td style={{ ...st.tdNum, color: hasData && month.totals.J < 0 ? '#dc2626' : hasData ? '#166534' : '#64748b', fontWeight: 800 }}>{fmtMonthly(month.totals?.J, hasData)}</td>
                        <td style={st.tdNum}>{hasData ? pct(month.totals?.K) : '—'}</td>
                        <td style={{ ...st.td, color: month.status === 'boundary_only' ? '#b45309' : month.status === 'no_data' ? '#64748b' : '#166534' }}>{status}</td>
                      </tr>
                      {expanded && (
                        <tr>
                          <td colSpan={8} style={{ padding: 0, border: '1px solid #e2e8f0' }}>
                            <div style={st.monthDetail}>
                              <div style={st.monthDetailTitle}>{month.month}월 연결 차수 상세</div>
                              {(month.includedWeeks || []).map(w => (
                                <div key={`i-${w.major}`} style={st.monthWeekRow}>
                                  <span style={w.period?.kind === 'boundary' ? st.monthBadgeBoundary : st.monthBadgeIncluded}>{w.period?.kind === 'boundary' ? '경계 귀속' : '포함'}</span>
                                  <b>{Number(w.major)}차</b>
                                  <span>{w.period?.startDate} ~ {w.period?.endDate}</span>
                                  {w.period?.kind === 'boundary' && <span>{w.assignmentMonth} 귀속</span>}
                                  <span>매출 {fmt(w.totals?.C)}</span>
                                  <span>원가 {fmt(w.totals?.I)}</span>
                                  <span style={{ color: w.totals?.J < 0 ? '#dc2626' : '#166534' }}>이익 {fmt(w.totals?.J)}</span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={st.monthlyBoundaryPanel}>
            <div style={st.monthlyBoundaryTitle}>월경계 차수 — 종료일 기준 다음 달에 귀속된 주차</div>
            {(monthlyData.boundaryWeeks || []).length === 0 ? (
              <div style={st.monthlyEmpty}>월경계 차수가 없습니다.</div>
            ) : (monthlyData.boundaryWeeks || []).map(w => (
              <div key={w.major} style={st.monthBoundaryGlobalRow}>
                <span style={st.monthBadgeBoundary}>귀속</span>
                <b>{Number(w.major)}차</b>
                <span>{w.period?.startDate} ~ {w.period?.endDate}</span>
                <span>{w.assignmentMonth} 귀속</span>
                <span>매출 {fmt(w.totals?.C)}</span>
                <span>원가 {fmt(w.totals?.I)}</span>
                <span>이익 {fmt(w.totals?.J)}</span>
              </div>
            ))}
            {(monthlyData.missingWeeks || []).length > 0 && (
              <div style={st.monthlyMissing}>
                <b>기간 확인 필요(0으로 합산하지 않음):</b>{' '}
                {monthlyData.missingWeeks.map(w => `${Number(w.major)}차${w.error ? `(${w.error})` : ''}`).join(', ')}
              </div>
            )}
          </div>
        </>
      )}
      {viewMode === 'months' && monthlyLoading && <div style={st.message}>연간 주차 원장과 PeriodDay를 읽어 월별로 분류하는 중입니다…</div>}

      {viewMode === 'category' && data && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#334155', marginBottom: 4 }}>비고사항</div>
          {data.autoNote && (
            <div style={{ marginBottom: 6, padding: 9, whiteSpace: 'pre-wrap', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 6, color: '#92400e', fontSize: 12 }}>
              {data.autoNote}
            </div>
          )}
          <textarea
            style={st.noteArea}
            value={note}
            maxLength={2000}
            onChange={e => { setNote(e.target.value); setNoteDirty(true); }}
            placeholder="예: 콜롬비아 수국: 냉해 21박스 (약 1,644,545원) …"
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginTop: 5 }}>
            <span style={{ fontSize: 11, color: noteDirty ? '#b45309' : '#64748b' }}>
              {note.length.toLocaleString()}/2,000자{noteDirty ? ' · 저장되지 않음' : ' · 저장됨'}
            </span>
            <button style={{ ...st.primaryBtn, background: noteDirty ? '#16a34a' : '#94a3b8' }} onClick={saveNote} disabled={saving || !data}>
              {saving ? '저장 중…' : '비고 저장'}
            </button>
          </div>
        </div>
      )}

      {priceModal && (
        <div style={st.modalOverlay}>
          <div style={st.modalCard}>
            <div style={st.panelHead}>
              <strong>🏷 재고 매입단가 입력 — 기초({priceModal.beginWeek || '-'}말) · 기말({priceModal.endWeek || '-'}말)</strong>
              <button style={st.secondaryBtn} onClick={() => setPriceModal(null)}>닫기</button>
            </div>
            <div style={{ padding: '8px 12px 4px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', borderBottom: '1px solid #e2e8f0' }}>
              <span style={priceInputRows.length > 0 ? st.collapseBadgeWarn : st.collapseBadgeOk}>
                입력 필요 {priceInputRows.length}건
              </span>
              <span style={st.collapseBadgeOk}>입력한 값 {Object.keys(priceEdits).length}건</span>
              <button style={{ ...st.secondaryBtn, marginLeft: 'auto' }} onClick={applyAllSuggestions}
                disabled={!priceInputRows.some(r => r.SuggestedPrice != null)}
                title="판매단가(없으면 최근 매입원가 근사) 자동제안을 전 품목에 채웁니다 — 26~31차 백테스트에서 확정 엑셀 대비 오차율 7.3%로 검증된 기준입니다. 채운 뒤 개별 수정 가능하며, 저장 시 제안 출처가 근거로 기록됩니다">
                ✨ 제안 모두 적용
              </button>
              <button style={{ ...st.primaryBtn, background: '#16a34a' }} onClick={savePrices} disabled={Object.keys(priceEdits).length === 0}>
                매입단가 근거 저장 ({Object.keys(priceEdits).length}건)
              </button>
            </div>
            <div style={{ fontSize: 11.5, color: '#64748b', padding: '6px 12px 0', lineHeight: 1.6 }}>
              엑셀 수식·도착원가·확인된 매입원가로 자동 계산할 수 없는 품목만 표시합니다.
              입력 단가는 표시된 <b>기초 또는 기말 재고 기준일에만</b> 연결되며, 저장할 때 근거 문서와 기준일이 필요합니다.
            </div>
            <details style={{ margin: '4px 12px 6px', fontSize: 11, color: '#64748b' }}>
              <summary style={{ cursor: 'pointer' }}>계산 기준 보기</summary>
              <div style={{ padding: '4px 0', lineHeight: 1.6 }}>
                검증된 매입근거가 없는 품목은 최근 확정 판매단가(×1.1) → 최근 매입 근사 순으로 자동 평가됩니다(2026-08-27 확정, 26~31차 백테스트 오차율 7.3%). 실제 매입근거를 저장하면 항상 그 값이 우선합니다.
                콜롬비아 5품종·베트남은 원본 엑셀의 카테고리 평균매입원가 공식으로 자동 계산됩니다.
                명시적 샘플 품목은 같은 재고시점·동일 단위의 검증된 매입원가만 평균합니다.
              </div>
            </details>
            <div style={{ flex: 1, overflow: 'auto', padding: '0 12px' }}>
              <table style={st.priceModalTable}>
                <colgroup>
                  <col style={{ width: 84 }} />
                  <col style={{ width: 110 }} />
                  <col />
                  <col style={{ width: 80 }} />
                  <col style={{ width: 90 }} />
                  <col style={{ width: 170 }} />
                  <col style={{ width: 150 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th style={st.priceModalTh}>재고 기준</th>
                    <th style={st.priceModalTh}>국가·품종</th>
                    <th style={st.priceModalTh}>품목명</th>
                    <th style={{ ...st.priceModalTh, textAlign: 'right' }}>재고수량</th>
                    <th style={{ ...st.priceModalTh, textAlign: 'right' }}>환산수량</th>
                    <th style={{ ...st.priceModalTh, textAlign: 'right' }}>자동제안</th>
                    <th style={{ ...st.priceModalTh, textAlign: 'right' }}>매입단가(원)</th>
                  </tr>
                </thead>
                <tbody>
                  {priceInputRows.map(r => {
                    const edit = priceEdits[r.EditKey];
                    const shown = edit !== undefined ? edit : '';
                    return (
                      <tr key={r.EditKey}>
                        <td style={st.priceModalTd}>{r.ScopeLabel}<br /><small>{r.ScopeOrderYear}-{r.ScopeOrderWeek}</small></td>
                        <td style={st.priceModalTd}>{r.Category}</td>
                        <td style={{ ...st.priceModalTd, whiteSpace: 'normal', wordBreak: 'break-word' }}>{r.ProdName}</td>
                        <td style={{ ...st.priceModalTd, textAlign: 'right' }}>{fmt(r.ScopeStock)}</td>
                        <td style={{ ...st.priceModalTd, textAlign: 'right' }}>{fmt(r.ScopeStockEst)} {r.EstUnit || ''}</td>
                        <td style={{ ...st.priceModalTd, textAlign: 'right' }}>
                          {r.SuggestedPrice != null ? (
                            <button
                              style={{ ...st.secondaryBtn, padding: '2px 8px', fontSize: 12 }}
                              onClick={() => applySuggestion(r)}
                              title={`${r.SuggestedSource === 'recent_sales_price' ? '판매단가' : '최근 매입원가 근사'} — ${r.SuggestedDetail || ''}. 클릭하면 입력칸에 채워지고, 저장 시 이 출처가 근거로 기록됩니다`}
                            >
                              {fmt(r.SuggestedPrice)} 적용
                            </button>
                          ) : <span style={{ color: '#94a3b8' }}>—</span>}
                        </td>
                        <td style={{ ...st.priceModalTd, textAlign: 'right' }}>
                          <NumericInput
                            style={{ ...st.cellInput, width: '100%', minWidth: 140, background: edit !== undefined ? '#fef9c3' : '#fff' }}
                            value={shown}
                            onChange={value => setPriceEdits(prev => ({ ...prev, [r.EditKey]: value }))}
                          />
                        </td>
                      </tr>
                    );
                  })}
                  {!priceInputRows.length && (
                    <tr><td colSpan={7} style={{ padding: 16, textAlign: 'center', color: '#166534', fontWeight: 800 }}>입력할 재고 매입단가가 없습니다. 모두 자동완성되었습니다.</td></tr>
                  )}
                </tbody>
              </table>
              <details style={{ margin: '8px 0', fontSize: 11, color: '#64748b' }}>
                <summary style={{ cursor: 'pointer' }}>자동완성·검증 완료 품목 {(priceModal.rows || []).filter(r => !r.RequiresInput).length}건 보기</summary>
                <div style={{ padding: '6px 0' }}>
                  {(priceModal.rows || []).filter(r => !r.RequiresInput).map(r => (
                    <div key={`auto-${r.ProdKey}`}>{r.Category} · {r.ProdName} — {r.InputReason || r.AppliedSource || '자동완성'}</div>
                  ))}
                </div>
              </details>
            </div>
            <div style={{ padding: '10px 12px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button style={st.secondaryBtn} onClick={() => setPriceModal(null)}>취소</button>
              <button style={{ ...st.primaryBtn, background: '#16a34a' }} onClick={savePrices} disabled={Object.keys(priceEdits).length === 0}>
                매입단가 근거 저장 ({Object.keys(priceEdits).length}건)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const st = {
  page: { padding: 14, maxWidth: 1900, margin: '0 auto' },
  bar: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' },
  h1: { fontSize: 18, fontWeight: 800, margin: 0 },
  label: { fontSize: 13, fontWeight: 700, color: '#334155' },
  weekInput: { border: '1px solid #cbd5e1', borderRight: 'none', borderRadius: '8px 0 0 8px', padding: '7px 10px', fontSize: 14, width: 70 },
  weekStepperWrap: { display: 'flex', alignItems: 'stretch' },
  weekStepperBtns: { display: 'flex', flexDirection: 'column', border: '1px solid #cbd5e1', borderRadius: '0 8px 8px 0', overflow: 'hidden' },
  weekStepperBtn: { background: '#f8fafc', border: 'none', borderBottom: '1px solid #e2e8f0', color: '#334155', fontSize: 9, padding: '0 6px', cursor: 'pointer', lineHeight: 1, flex: 1 },
  primaryBtn: { background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  secondaryBtn: { background: '#fff', color: '#334155', border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  toggleBtnOn: { background: '#1d4ed8', color: '#fff', border: '1px solid #1d4ed8', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  viewToggleWrap: { display: 'flex', border: '1px solid #cbd5e1', borderRadius: 8, overflow: 'hidden' },
  viewToggleOn: { background: '#1e293b', color: '#fff', border: 'none', padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  viewToggleOff: { background: '#fff', color: '#334155', border: 'none', padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  colPicker: { position: 'absolute', top: '110%', right: 0, background: '#fff', border: '1px solid #cbd5e1', borderRadius: 10, boxShadow: '0 12px 32px rgba(15,23,42,0.18)', padding: 10, width: 220, maxHeight: '60vh', overflow: 'auto', zIndex: 20 },
  colPickerHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, fontWeight: 800, color: '#334155', marginBottom: 6, paddingBottom: 6, borderBottom: '1px solid #e2e8f0' },
  colPickerMiniBtn: { background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 5, padding: '2px 7px', fontSize: 10, cursor: 'pointer' },
  colPickerRow: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: '#334155', padding: '3px 2px', cursor: 'pointer' },
  colPickerDivider: { borderTop: '1px solid #e2e8f0', margin: '8px 0 6px' },
  presetRow: { display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 },
  presetApplyBtn: { flex: 1, textAlign: 'left', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 5, padding: '4px 7px', fontSize: 12, color: '#334155', cursor: 'pointer' },
  presetDelBtn: { background: 'transparent', border: 'none', color: '#94a3b8', fontSize: 12, cursor: 'pointer', padding: '2px 5px' },
  presetNameInput: { flex: 1, border: '1px solid #cbd5e1', borderRadius: 5, padding: '4px 7px', fontSize: 12, minWidth: 0 },
  embedPanel: { border: '2px solid #1d4ed8', borderRadius: 10, marginBottom: 12, overflow: 'hidden', background: '#fff' },
  embedPanelHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', background: '#1d4ed8', color: '#fff' },
  embedPanelBody: { padding: 12, maxHeight: '46vh', overflow: 'auto' },
  tinyCloseBtn: { background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.4)', borderRadius: 5, padding: '3px 10px', fontSize: 11, cursor: 'pointer' },
  // 본표 위 "입력·확인 필요" 요약 — 재고 매입단가/그외통관비/항공료/과세환율 입력 진입점을 한곳에 모은다.
  requiredWrap: { border: '1px solid #cbd5e1', borderRadius: 10, background: '#f8fafc', padding: '10px 12px', marginBottom: 10 },
  requiredHead: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 },
  requiredTitle: { fontSize: 13, fontWeight: 800, color: '#334155' },
  requiredActions: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  requiredNotice: { fontSize: 12, fontWeight: 700, color: '#9a3412' },
  requiredOkNotice: { fontSize: 12, fontWeight: 600, color: '#166534' },
  // 표 아래 접기 영역(상세 확인 내역 / 이익률 분석) — components/ProfitReportSourceGuide.js 와 동일한 토글 패턴.
  collapseWrap: { marginTop: 12 },
  collapseToggle: {
    display: 'inline-flex', alignItems: 'center', gap: 8,
    background: '#f8fafc', color: '#334155', border: '1px solid #cbd5e1', borderRadius: 8,
    padding: '7px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', lineHeight: 1.4,
  },
  caret: { fontSize: 10, color: '#64748b' },
  toggleHint: { fontSize: 10.5, fontWeight: 600, color: '#94a3b8' },
  collapsePanel: { marginTop: 8, border: '1px solid #cbd5e1', borderRadius: 10, background: '#fff', padding: 12 },
  collapseBadgeWarn: { fontSize: 11, fontWeight: 800, color: '#9a3412', background: '#fff7ed', border: '1px solid #fb923c', borderRadius: 5, padding: '1px 7px' },
  collapseBadgeOk: { fontSize: 11, fontWeight: 800, color: '#166534', background: '#ecfdf5', border: '1px solid #86efac', borderRadius: 5, padding: '1px 7px' },
  sourceBadgeLive: { fontSize: 11, fontWeight: 800, color: '#1e40af', background: '#dbeafe', border: '1px solid #93c5fd', borderRadius: 5, padding: '1px 7px' },
  sourceBadgeMissing: { fontSize: 11, fontWeight: 800, color: '#64748b', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 5, padding: '1px 7px' },
  hint: { fontSize: 11.5, color: '#64748b', marginBottom: 10, lineHeight: 1.6 },
  error: { background: '#fef2f2', border: '1px solid #ef4444', color: '#b91c1c', borderRadius: 8, padding: '9px 12px', fontSize: 13, marginBottom: 8 },
  message: { background: '#ecfdf5', border: '1px solid #34d399', color: '#065f46', borderRadius: 8, padding: '9px 12px', fontSize: 13, marginBottom: 8 },
  auditError: { background: '#fff7ed', border: '1px solid #f97316', color: '#9a3412', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, marginBottom: 10, lineHeight: 1.5 },
  auditWarning: { background: '#fffbeb', border: '1px solid #f59e0b', color: '#92400e', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, marginBottom: 10, lineHeight: 1.5 },
  attentionBanner: { background: '#fff7ed', border: '1px solid #fb923c', color: '#9a3412', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, marginBottom: 8, lineHeight: 1.6 },
  confirmBanner: { background: '#ecfdf5', border: '1px solid #16a34a', color: '#065f46', borderRadius: 8, padding: '9px 12px', fontSize: 13, fontWeight: 700, marginBottom: 8, lineHeight: 1.6 },
  monthlyInfo: { background: '#eff6ff', border: '1px solid #93c5fd', color: '#1e3a8a', borderRadius: 8, padding: '10px 12px', fontSize: 12.5, marginBottom: 10, lineHeight: 1.6 },
  monthDetail: { padding: 9, background: '#f8fafc' },
  monthDetailTitle: { fontWeight: 800, color: '#334155', fontSize: 12, marginBottom: 5 },
  monthWeekRow: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '5px 7px', marginBottom: 3, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 5, fontSize: 11.5, color: '#475569' },
  monthBadgeIncluded: { color: '#166534', background: '#dcfce7', border: '1px solid #86efac', borderRadius: 4, padding: '2px 5px', fontWeight: 800 },
  monthBadgeBoundary: { color: '#92400e', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 4, padding: '2px 5px', fontWeight: 800 },
  monthlyBoundaryPanel: { marginTop: 10, border: '1px solid #f59e0b', borderRadius: 8, background: '#fffbeb', padding: 10 },
  monthlyBoundaryTitle: { color: '#92400e', fontWeight: 800, fontSize: 13, marginBottom: 6 },
  monthBoundaryGlobalRow: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '5px 7px', marginBottom: 3, background: '#fff', border: '1px solid #fde68a', borderRadius: 5, fontSize: 11.5, color: '#475569' },
  monthlyEmpty: { color: '#78716c', fontSize: 12 },
  monthlyMissing: { marginTop: 8, paddingTop: 8, borderTop: '1px solid #fcd34d', color: '#b91c1c', fontSize: 11.5 },
  tableWrap: { overflow: 'auto', maxHeight: 'calc(100vh - 220px)', border: '1px solid #cbd5e1', borderRadius: 10, background: '#fff' },
  table: { borderCollapse: 'collapse', fontSize: 12, minWidth: 1800 },
  th: { position: 'sticky', top: 0, background: '#1e293b', color: '#fff', padding: '7px 8px', fontSize: 11, whiteSpace: 'nowrap', zIndex: 2 },
  stickyCol: { position: 'sticky', left: 0, background: '#f8fafc', zIndex: 1, minWidth: 130 },
  td: { border: '1px solid #e2e8f0', padding: '5px 8px', whiteSpace: 'nowrap' },
  tdNum: { border: '1px solid #e2e8f0', padding: '5px 8px', textAlign: 'right', whiteSpace: 'nowrap' },
  cellInput: { border: '1px solid #cbd5e1', borderRadius: 5, padding: '3px 6px', fontSize: 12, textAlign: 'right' },
  noteArea: { width: '100%', minHeight: 90, border: '1px solid #cbd5e1', borderRadius: 8, padding: 10, fontSize: 13, boxSizing: 'border-box' },
  panelHead: { minHeight: 44, padding: '6px 12px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 },
  modalCard: { width: 'min(1320px, 98vw)', height: '92vh', maxHeight: '92vh', background: '#fff', borderRadius: 12, boxShadow: '0 24px 80px rgba(15,23,42,0.3)', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  // 재고 매입단가 모달 전용 표 — 공용 st.table(minWidth 1800)을 쓰지 않고 tableLayout:fixed로 모달 폭에 맞춰 가로 스크롤을 없앤다.
  priceModalTable: { borderCollapse: 'collapse', fontSize: 12, width: '100%', tableLayout: 'fixed' },
  priceModalTh: { position: 'sticky', top: 0, background: '#1e293b', color: '#fff', padding: '7px 8px', fontSize: 11, textAlign: 'left', zIndex: 1 },
  priceModalTd: { border: '1px solid #e2e8f0', padding: '5px 8px', whiteSpace: 'nowrap', verticalAlign: 'top' },
};
