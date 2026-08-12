// 주차별 매출이익 보고서 — "매출원가 양식.xlsx" 첫 시트와 동일 셀 구조.
// 자동(SQL/수식): N순수매출·L불량·O그외매출·Q구매외화·E/F재고·H통관비·R환율·S포워딩USD / 수기 보정: E·F·H·R·S·비고
// 계산열은 엑셀 수식 그대로: C=N+L+O, G=P+T, P=Q×R, T=S×R, I=E+G+H−F, J=C−I, K=J/C, M=−L/C, D=C/ΣC, U=P/ΣP
// (이스라엘·뉴질랜드·일본: I=E+G+H, J=C−I+F, K=J/(C+F) — 원본 수식 변형 유지)
import { Fragment, useEffect, useMemo, useState } from 'react';
// Layout 은 _app.js 가 전역 래핑 — 페이지 자체 래핑 금지(이중 사이드바 원인)
import { getCurrentWeek, useWeekInput } from '../../lib/useWeekInput';
import { computeProfitRow, computeProfitTotals, calcRevenueRatio, calcPurchaseRatio } from '../../lib/profitReportCalc';
import CustomsClearancePanel from '../../components/CustomsClearancePanel';
import ForwardingClearancePanel from '../../components/ForwardingClearancePanel';
import ProfitReportSourceGuide from '../../components/ProfitReportSourceGuide';

function getDefaultMajor() {
  const m = String(getCurrentWeek() || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? m[2] : '';
}
function getDefaultYear() {
  const m = String(getCurrentWeek() || '').match(/^(\d{4})-/);
  return m ? m[1] : String(new Date().getFullYear());
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
  { key: 'D', label: '매출비율' },
  { key: 'E', label: '기초상품재고액', editable: true },
  { key: 'F', label: '기말상품재고액', editable: true },
  { key: 'G', label: '매입액(상품+포워딩)' },
  { key: 'H', label: '그외통관비', editable: true, editWidth: 74 },
  { key: 'I', label: '매출원가', bold: true },
  { key: 'J', label: '매출이익', bold: true },
  { key: 'K', label: '이익률' },
  { key: 'L', label: '불량금액', color: '#1d4ed8' },
  { key: 'M', label: '불량율' },
  { key: 'N', label: '순수매출액', color: '#1d4ed8' },
  { key: 'O', label: '그 외 매출액', color: '#1d4ed8' },
  { key: 'P', label: '상품 금액(구매)' },
  { key: 'Q', label: '구매금액(외화)', color: '#1d4ed8' },
  { key: 'R', label: '환율', editable: true, editWidth: 70 },
  { key: 'S', label: '포워딩(USD)', editable: true, editWidth: 86 },
  { key: 'T', label: '포워딩 원화환산' },
  { key: 'U', label: '상품구매비율' },
];
const ALL_COL_KEYS = COLUMN_DEFS.map(c => c.key);
const LS_KEY = 'nenova_profitReport_visibleCols_v1';
const LS_PRESET_KEY = 'nenova_profitReport_colPresets_v1';

// 읽기전용 표시값 — 합계행 / 차수별 뷰의 차수 합계행 / 세부표(읽기전용)에 공용
function readonlyValue(key, obj, ctx) {
  switch (key) {
    case 'C': return fmt(obj.C);
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
  if (!row || row.manual?.R != null || row.source?.R !== 'missing') return false;
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
  const F_SOURCE_TEXT = {
    stock_price_table: '재고평가단가 기준: 마지막 확정 세부차수 ProductStock 수량 × 품목별 재고평가단가 ÷1.1',
    recent_purchase_cost: '재고평가단가가 없어 폴백: 품목별 최근 매입 외화단가 × 기말수량 × 환율',
    landed_cost_average: '재고평가단가·최근단가가 없어 폴백: (구매금액×환율+포워딩×환율+그외통관비)÷매입총수량×기말수량',
    missing: '⚠ 재고수량은 있으나 평가단가를 구할 수 없어 계산하지 못했습니다 — 재고단가표에서 단가를 지정하세요',
    no_stock: '이 차수 기말재고 수량이 없습니다',
  };
  const titles = {
    R: missingRate
      ? `⚠ 이 차수의 ${row.currency || '-'} 과세환율(관세청 신고환율) 원천이 없습니다. 통관 신고 환율을 이 칸에 입력하고 저장하세요.${suggestionText ? ` (참고값: ${suggestionText} — 참고값은 적용·저장해야 계산에 들어갑니다)` : ''}`
      : `과세환율(관세청 신고환율, ${row.currency || '-'}) — 자동 적용은 "정확히 이 차수" 원천만 합니다: 당주 통관 스냅샷(FreightCost) → 이 차수에 저장/캐시된 과세환율 → 2026 22~27차 원본 엑셀값. 통화마스터 현재 환율과 전차수 값은 참고 제안일 뿐 자동 적용하지 않습니다. 인보이스 과세환율과 다르면 직접 입력하세요.`,
    S: '비우면 입고관리 자동감지(운송료/SERVICE FEE 라인) 사용 — [🚢 포워딩 입력]에서 확인/override 가능, 입력하면 수기값 우선',
    H: '비우면 [📦 그외통관비 입력] 화면 값 사용 — (1차GW+2차GW)×백상단가 + 관세1+관세2 + (선율1+선율2+월드운송료1+월드운송료2+한국방역1+한국방역2)÷1.1. 콜롬비아 4품목은 반차수 TOTAL을 박스당무게×박스수량 비율로 배분. 입력하면 수기값 우선',
    E: row.inheritedE
      ? '기초재고 — 전차수 기말재고(F)에서 이월됨. 우선순위: 전차수 확정 스냅샷 F > 전차수 저장 F > 전차수 자동계산. 비우면 자동값으로 돌아갑니다'
      : '기초재고 — 같은 매출연도 전차수의 기말재고를 이월합니다(01차만 전년도 52차). 비우면 자동계산값 사용',
    F: `기말재고 — ${row.stock?.week || '마지막 확정 세부차수'} ProductStock 기준. ${F_SOURCE_TEXT[row.stockSourceKind?.end] || F_SOURCE_TEXT.stock_price_table}. 직접 입력하면 수기값 우선이며, 보고서를 확정하면 그 값으로 고정됩니다`,
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
  const weekInput = useWeekInput(getDefaultMajor());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [moyiSending, setMoyiSending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [data, setData] = useState(null);
  const [edits, setEdits] = useState({});   // { category: { colKey: 'value' } }
  const [note, setNote] = useState('');
  const [noteDirty, setNoteDirty] = useState(false);
  // 보고서 진입 시에는 자동값만 읽기전용으로 보여준다. 입력 패널은 필요한 경우에만 연다.
  const [showCustoms, setShowCustoms] = useState(false);
  const [showForwarding, setShowForwarding] = useState(false);
  const [showOverrides, setShowOverrides] = useState(false);

  // ── 보고서 기준 확정/취소/이력
  const [confirmHistory, setConfirmHistory] = useState([]);
  const [confirmSchemaInitialized, setConfirmSchemaInitialized] = useState(true);
  const [showConfirmPanel, setShowConfirmPanel] = useState(false);
  const [showConfirmHistory, setShowConfirmHistory] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [forceReason, setForceReason] = useState('');
  const loadConfirmStatus = async (weekOverride) => {
    const wk = weekOverride ?? weekInput.value;
    try {
      const res = await fetch(`/api/sales/profit-report-confirm?week=${encodeURIComponent(wk)}`, { credentials: 'same-origin' });
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

  const load = async (weekOverride) => {
    const wk = weekOverride ?? weekInput.value;
    setLoading(true); setError(''); setMessage(''); setEdits({});
    try {
      const res = await fetch(`/api/sales/profit-report?week=${encodeURIComponent(wk)}`, { credentials: 'same-origin' });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || '조회 실패');
      setData(d);
      setNote(d.note || '');
      setNoteDirty(false);
      loadConfirmStatus(wk);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const stepWeek = delta => {
    const cur = Number(weekInput.value) || Number(getDefaultMajor()) || 1;
    const next = String(Math.max(1, cur + delta)).padStart(2, '0');
    weekInput.setValue(next);
    load(next);
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
          const res = await fetch(`/api/sales/profit-report?week=${mj}`, { credentials: 'same-origin' });
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
      const cur = Number(weekInput.value) || Number(getDefaultMajor()) || 1;
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

  const save = async () => {
    setSaving(true); setError(''); setMessage('');
    try {
      const values = {};
      for (const row of data?.rows || []) {
        const e = edits[row.category] || {};
        const out = {};
        for (const col of ['E', 'F', 'H', 'R', 'S']) {
          if (e[col] !== undefined) out[col] = e[col] === '' ? null : Number(e[col]);
          else if (row.manual[col] != null) out[col] = row.manual[col];
        }
        if (Object.keys(out).length) values[row.category] = out;
      }
      const res = await fetch('/api/sales/profit-report', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ week: weekInput.value, values, note }),
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
              week: weekInput.value, action: 'saveTaxableRate',
              currency: row.currency || 'USD', category: row.category,
              rate: values[row.category].R, rateSource: 'manual_input',
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
      setMessage('저장 완료 — 수기값(기초/기말/통관비/환율/포워딩)과 비고가 보관되었습니다.');
      return true;
    } catch (e) { setError(e.message); return false; } finally { setSaving(false); }
  };

  const saveNote = async () => {
    setSaving(true); setError(''); setMessage('');
    try {
      const res = await fetch('/api/sales/profit-report', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ week: weekInput.value, action: 'saveNote', note }),
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
        body: JSON.stringify({ week: weekInput.value, action: force ? 'force' : 'confirm', reason: force ? forceReason : undefined }),
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
        body: JSON.stringify({ week: weekInput.value, action: 'cancel' }),
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
    window.location.href = `/api/sales/profit-report?week=${encodeURIComponent(weekInput.value)}&excel=1&cols=${encodeURIComponent(colsParam)}`;
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

  // ── 재고 평가단가표 모달
  const [priceModal, setPriceModal] = useState(null);   // { beginWeek, endWeek, rows }
  const [priceEdits, setPriceEdits] = useState({});
  const openPriceModal = async () => {
    setPriceEdits({});
    try {
      const res = await fetch(`/api/sales/profit-report?week=${encodeURIComponent(weekInput.value)}&stockPrices=1`, { credentials: 'same-origin' });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || '단가표 조회 실패');
      setPriceModal(d);
    } catch (e) { setError(e.message); }
  };
  const savePrices = async () => {
    try {
      const res = await fetch('/api/sales/profit-report', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ action: 'stockPrices', week: weekInput.value, prices: priceEdits }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || '저장 실패');
      setPriceModal(null);
      setMessage('재고단가표 저장 — 기초/기말 자동 평가액이 갱신되었습니다.');
      await load();
    } catch (e) { setError(e.message); }
  };

  const setEdit = (cat, col, val) => setEdits(prev => ({ ...prev, [cat]: { ...(prev[cat] || {}), [col]: val } }));
  const dirty = Object.keys(edits).length > 0 || noteDirty;
  const { rows, totals } = rowsCalc;
  const needsAttention = attentionRows(rows);

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
                  title={row.category === '기타(미분류)' ? '국가·화종 매핑에 들지 않은 거래입니다. 아래 합계(C/D/I/J/K)에 포함되지 않는 검증 전용 행이며, 품목의 국가/화종을 정정해야 정식 카테고리로 반영됩니다.' : undefined}>
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
              {readonlyValue(cd.key, wTotals, { D: 1, U: 1 })}
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
              <button style={st.secondaryBtn} onClick={openPriceModal} disabled={!data || data?.confirmed}
                title={data?.confirmed ? '확정된 차수입니다 — 수정하려면 먼저 확정을 취소하세요' : '재고가 있는 품목의 평가단가를 관리합니다 (지정 > 수국표 > 품목Cost 순 적용)'}>
                🏷 재고단가표
              </button>
              <button style={showOverrides ? st.toggleBtnOn : st.secondaryBtn} onClick={() => setShowOverrides(v => !v)} disabled={!data || data?.confirmed}
                title={data?.confirmed ? '확정된 차수입니다 — 수정하려면 먼저 확정을 취소하세요' : '자동값을 우선 사용합니다. 청구서·실사와 다른 예외 행을 수정할 때만 수기 보정을 엽니다'}>
                🛠 수기 보정{showOverrides ? ' ▲' : ' ▼'}
              </button>
              <button style={showCustoms ? st.toggleBtnOn : st.secondaryBtn} onClick={() => setShowCustoms(v => !v)} disabled={!data || data?.confirmed}
                title={data?.confirmed ? '확정된 차수입니다 — 수정하려면 먼저 확정을 취소하세요' : '백상창고료·관세·선율·월드운송료·한국방역·콜롬비아 무게배분 입력 — H(그외통관비) 자동값의 소스, 저장하면 아래 표가 바로 재계산됩니다'}>
                📦 그외통관비 입력{showCustoms ? ' ▲' : ' ▼'}
              </button>
              <button style={showForwarding ? st.toggleBtnOn : st.secondaryBtn} onClick={() => setShowForwarding(v => !v)} disabled={!data || data?.confirmed}
                title={data?.confirmed ? '확정된 차수입니다 — 수정하려면 먼저 확정을 취소하세요' : '네덜란드·중국·콜롬비아·에콰도르·태국 항공/포워딩 비용 입력 — S(포워딩) 자동값의 소스, 저장하면 아래 표가 바로 재계산됩니다'}>
                🚢 포워딩 입력{showForwarding ? ' ▲' : ' ▼'}
              </button>
            </>
          ) : viewMode === 'weeks' ? (
            <>
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
          <>자동(파랑): 순수매출·불량·그외매출·구매금액 = 전산 DB / <b>기말재고(F) = 선택 차수 마지막 확정 세부차수 재고수량 × 품목별 재고평가단가</b>
          (평가단가가 없을 때만 최근 매입단가, 그것도 없고 단위가 일치할 때만 매입·포워딩·통관비 평균단가 사용 · 기초(E)=전차수 마지막 확정 기말재고 이월) — E/F/H/R/S는 자동값이 기본이며 표에는 읽기전용으로 표시됩니다.
          청구서 환율·실사재고·특수 통관비처럼 예외값을 넣을 때만 <b>🛠 수기 보정</b>을 열어 입력하면 해당 값이 우선합니다.
          환율(R)은 정확히 그 차수의 입고별 과세환율 스냅샷 → 그 차수에 저장한 과세환율 → 2026년 22~27차 원본 엑셀값 순서로 사용합니다. 전차수 환율과 CurrencyMaster 현재 환율은 참고 제안일 뿐 자동 계산에는 넣지 않습니다. 구매현황의 상업(환전)환율과는 다른 값이니 혼동하지 마세요. 원천이 없으면 해당 행에 R 입력칸이 자동 표시되며, 인보이스 과세환율을 입력 후 저장하면 됩니다. 금액·수량은 소수점 없이 천 단위 콤마로 표시합니다.
          포워딩(USD)은 입고관리(운송료/SERVICE FEE 라인)에서 자동감지(노랑=수정중·초록=저장됨).
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
                <b>검증 오류 {data.audit.errorCount}건이 남아 있어 일반 확정은 저장할 수 없습니다.</b> 위 검증 안내의 각 항목을 먼저 해결하세요(원천 데이터 보정, 재고 스냅샷 확인 등).
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

      {viewMode !== 'months' && data?.audit?.issues?.length > 0 && (
        <div style={data.audit.status === 'needs_input' ? st.auditError : st.auditWarning}>
          <strong>{data.audit.errorCount > 0 ? '검증 필요' : '자동값 확인 안내'}: 오류 {data.audit.errorCount}건 · 확인 {data.audit.warningCount}건</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
            {data.audit.issues.slice(0, 10).map((issue, i) => (
              <li key={`${issue.code}-${issue.category}-${i}`}>
                <b>{issue.category}</b> [{issue.columns.join('/')}] {issue.message}
              </li>
            ))}
          </ul>
          {data.audit.issues.length > 10 && <div style={{ marginTop: 4 }}>외 {data.audit.issues.length - 10}건 — API audit.issues에서 전체 확인</div>}
        </div>
      )}

      {viewMode === 'category' && data && needsAttention.length > 0 && (
        <div style={st.attentionBanner}>
          ⚠ <b>확인 필요</b> — 실사 시작재고(차수피벗) 없이 재고 스냅샷에만 의존 중이라 기초/기말재고가 부정확할 수 있습니다:{' '}
          {needsAttention.map(r => r.category).join(', ')}
        </div>
      )}

      {viewMode === 'category' && data && data.rows?.some(needsRateInput) && (
        <div style={st.attentionBanner}>
          ⚠ <b>과세환율(R) 입력 필요</b> — 구매·포워딩 금액은 있는데 <b>이 차수</b>의 관세청 과세환율 원천이 없는 행이 있습니다.
          해당 행의 R 입력칸이 자동으로 열렸으니 통관 신고 환율을 입력한 뒤 저장하세요.
          <div style={{ marginTop: 4, fontSize: 11, color: '#7c2d12' }}>
            자동으로 채우지 않는 이유: 통화마스터 현재 환율이나 전차수 환율을 과거 차수에 그대로 넣으면 확정된 손익이 조용히 바뀝니다.
            입력칸에 마우스를 올리면 참고값(전차수·통화마스터)을 볼 수 있고, 적용·저장해야 계산에 반영됩니다.
          </div>
        </div>
      )}

      {viewMode === 'category' && data && rows.some(r => r.category === '기타(미분류)') && (
        <div style={st.attentionBanner}>
          ⚠ <b>기타(미분류) 검증 영역</b> — 국가·화종 매핑에 들지 않은 거래가 있습니다.
          이 행은 <b>본표 합계(C·D·I·J·K)와 엑셀 다운로드 합계에 포함되지 않으며</b>, 임의로 다른 카테고리에 합산하지도 않습니다.
          품목마스터의 국가(CounName)/화종(FlowerName)을 정정하면 정식 카테고리로 반영됩니다. 상세 품목은 아래 비고사항에 자동 기록됩니다.
        </div>
      )}

      {viewMode === 'category' && data && showCustoms && (
        <div style={st.embedPanel}>
          <div style={st.embedPanelHead}>
            <strong>📦 그외통관비 입력 — {data.major}차</strong>
            <button style={st.tinyCloseBtn} onClick={() => setShowCustoms(false)}>접기 ▲</button>
          </div>
          <div style={st.embedPanelBody}>
            <CustomsClearancePanel week={weekInput.value} onSaved={load} />
          </div>
        </div>
      )}
      {viewMode === 'category' && data && showForwarding && (
        <div style={st.embedPanel}>
          <div style={st.embedPanelHead}>
            <strong>🚢 포워딩 입력 — {data.major}차</strong>
            <button style={st.tinyCloseBtn} onClick={() => setShowForwarding(false)}>접기 ▲</button>
          </div>
          <div style={st.embedPanelBody}>
            <ForwardingClearancePanel week={weekInput.value} onSaved={load} />
          </div>
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
                        title={row.category === '기타(미분류)' ? '국가·화종 매핑에 들지 않은 거래입니다. 아래 합계(C/D/I/J/K)에 포함되지 않는 검증 전용 행이며, 품목의 국가/화종을 정정해야 정식 카테고리로 반영됩니다.' : undefined}>
                        {row.category}{row.category === '기타(미분류)' ? ' ※합계 제외' : ''}
                      </td>
                    )}
                    {shownColumns.map(cd => (
                      <td key={cd.key} style={{ ...st.tdNum, fontWeight: cd.bold ? 700 : undefined, color: cd.key === 'J' ? (c.J < 0 ? '#dc2626' : '#166534') : cd.color }}>
                        {!data.confirmed && (showOverrides || (cd.key === 'R' && needsRateInput(row))) && cd.editable ? <EditCell row={row} col={cd.key} width={cd.editWidth || 86} edits={edits} setEdit={setEdit} autoValue={cd.key === 'F' ? c.F : undefined} /> : readonlyValue(cd.key, c, { D, U })}
                      </td>
                    ))}
                  </tr>
                );
              })}
              <tr style={{ background: '#e2e8f0', fontWeight: 800 }}>
                {isVisible('category') && <td style={{ ...st.td, ...st.stickyCol, background: '#e2e8f0' }}>합계</td>}
                {shownColumns.map(cd => (
                  <td key={cd.key} style={{ ...st.tdNum, color: cd.key === 'J' ? (totals.J < 0 ? '#dc2626' : '#166534') : undefined }}>
                    {readonlyValue(cd.key, totals, { D: 1, U: 1 })}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
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
                          {readonlyValue(cd.key, w.totals, { D: 1, U: 1 })}
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
              <strong>🏷 재고 평가단가표 — 기초({priceModal.beginWeek || '-'}말) · 기말({priceModal.endWeek || '-'}말)에 재고 있는 품목</strong>
              <button style={st.secondaryBtn} onClick={() => setPriceModal(null)}>닫기</button>
            </div>
            <div style={{ fontSize: 11.5, color: '#64748b', padding: '6px 12px' }}>
              단가를 입력하면 <b>지정단가</b>로 저장되어 이후 매주 자동 적용됩니다. 비우면 지정 해제(수국표/품목Cost로 복귀).
              평가액 = ProductStock 재고수량(출고단위) × 적용단가 ÷ 1.1
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              <table style={st.table}>
                <thead>
                  <tr><th>품종</th><th>품목</th><th style={{ textAlign: 'right' }}>기초수량</th><th style={{ textAlign: 'right' }}>기말수량</th><th style={{ textAlign: 'right' }}>박스당</th><th style={{ textAlign: 'right' }}>품목Cost</th><th>적용단가(출처)</th><th style={{ textAlign: 'right' }}>지정단가 입력</th></tr>
                </thead>
                <tbody>
                  {(priceModal.rows || []).map(r => {
                    const edit = priceEdits[r.ProdKey];
                    const shown = edit !== undefined ? edit : (r.SetPrice ?? '');
                    return (
                      <tr key={r.ProdKey}>
                        <td>{r.Category}</td>
                        <td>{r.ProdName}</td>
                        <td style={{ textAlign: 'right' }}>{fmt(r.StockBegin)}</td>
                        <td style={{ textAlign: 'right' }}>{fmt(r.StockEnd)}</td>
                        <td style={{ textAlign: 'right' }}>{fmt(r.UnitPerBox)}</td>
                        <td style={{ textAlign: 'right', color: r.Cost ? undefined : '#dc2626' }}>{fmt(r.Cost)}</td>
                        <td>
                          {fmt(r.AppliedPrice)}
                          <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, color: r.AppliedSource === '지정' ? '#166534' : r.AppliedSource === '수국표' ? '#1d4ed8' : '#64748b' }}>
                            {r.AppliedSource}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <NumericInput
                            style={{ ...st.cellInput, width: 90, background: edit !== undefined ? '#fef9c3' : (r.SetPrice != null ? '#ecfdf5' : '#fff') }}
                            value={shown}
                            onChange={value => setPriceEdits(prev => ({ ...prev, [r.ProdKey]: value }))}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '10px 12px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button style={st.secondaryBtn} onClick={() => setPriceModal(null)}>취소</button>
              <button style={{ ...st.primaryBtn, background: '#16a34a' }} onClick={savePrices} disabled={Object.keys(priceEdits).length === 0}>
                단가 저장 ({Object.keys(priceEdits).length}건)
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
  modalCard: { width: 'min(1000px, 96vw)', maxHeight: '86vh', background: '#fff', borderRadius: 12, boxShadow: '0 24px 80px rgba(15,23,42,0.3)', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
};
