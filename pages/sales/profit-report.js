// 주차별 매출이익 보고서 — "매출원가 양식.xlsx" 첫 시트와 동일 셀 구조.
// 자동(SQL/수식): N순수매출·L불량·O그외매출·Q구매외화·E/F재고·H통관비·R환율·S포워딩USD / 수기 보정: E·F·H·R·S·비고
// 계산열은 엑셀 수식 그대로: C=N+L+O, G=P+T, P=Q×R, T=S×R, I=E+G+H−F, J=C−I, K=J/C, M=−L/C, D=C/ΣC, U=P/ΣP
// (이스라엘·뉴질랜드·일본: I=E+G+H, J=C−I+F, K=J/(C+F) — 원본 수식 변형 유지)
import { Fragment, useEffect, useMemo, useState } from 'react';
// Layout 은 _app.js 가 전역 래핑 — 페이지 자체 래핑 금지(이중 사이드바 원인)
import { getCurrentWeek, useWeekInput } from '../../lib/useWeekInput';
import { computeProfitRow, computeProfitTotals } from '../../lib/profitReportCalc';
import CustomsClearancePanel from '../../components/CustomsClearancePanel';
import ForwardingClearancePanel from '../../components/ForwardingClearancePanel';

function getDefaultMajor() {
  const m = String(getCurrentWeek() || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? m[2] : '';
}
const fmt = v => (v == null || Number.isNaN(v) ? '' : Math.round(v).toLocaleString());
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
  const warn = needsCheck(row, col);
  const titles = {
    R: `비우면 BILL 환율 스냅샷(${row.currency || '-'} · FreightCost) 또는 CurrencyMaster 적용 — 청구서 환율과 다르면 입력`,
    S: '비우면 입고관리 자동감지(운송료/SERVICE FEE 라인) 사용 — [🚢 포워딩 입력]에서 확인/override 가능, 입력하면 수기값 우선',
    H: '비우면 [📦 그외통관비 입력] 화면 저장값 사용(백상창고료+관세+선율+월드운송료+한국방역, 콜롬비아 4품목은 무게비율 자동배분), 입력하면 수기값 우선',
    E: row.inheritedE ? '전차수 저장 기말재고에서 이월됨 (비우면 전차수 자동계산값 사용)' : '전차수 기말재고 이월 — 비우면 전차수 F를 같은 공식으로 자동계산',
    F: `${row.stock?.week || '마지막 확정 세부차수'} EXE 재고현황 기준 자동: (구매금액×환율+포워딩×환율+그외통관비)÷매입총수량×기말재고수량 — 직접 입력하면 수기값 우선`,
  };
  const title = warn ? `⚠ 확인 필요 — 실사 시작재고 없이 재고 스냅샷에만 의존 중(부정확할 수 있음). ${titles[col] || ''}` : (titles[col] || '');
  return (
    <NumericInput
      style={{ ...st.cellInput, width, background: e !== undefined ? '#fef9c3' : (base != null ? '#ecfdf5' : (warn ? '#fef2f2' : '#fff')), border: warn ? '1px solid #f87171' : undefined }}
      value={val}
      placeholder={placeholder}
      title={title}
      onChange={value => setEdit(row.category, col, value)}
    />
  );
}

export default function ProfitReportPage() {
  const weekInput = useWeekInput(getDefaultMajor());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [data, setData] = useState(null);
  const [edits, setEdits] = useState({});   // { category: { colKey: 'value' } }
  const [note, setNote] = useState('');
  // 보고서 진입 시에는 자동값만 읽기전용으로 보여준다. 입력 패널은 필요한 경우에만 연다.
  const [showCustoms, setShowCustoms] = useState(false);
  const [showForwarding, setShowForwarding] = useState(false);
  const [showOverrides, setShowOverrides] = useState(false);

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
  const shownColumns = COLUMN_DEFS.filter(cd => cd.key !== 'category' && isVisible(cd.key));

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

  const load = async (weekOverride) => {
    const wk = weekOverride ?? weekInput.value;
    setLoading(true); setError(''); setMessage(''); setEdits({});
    try {
      const res = await fetch(`/api/sales/profit-report?week=${encodeURIComponent(wk)}`, { credentials: 'same-origin' });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || '조회 실패');
      setData(d);
      setNote(d.note || '');
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
          const rows = (d.rows || []).map(r => ({ ...r, calc: computeProfitRow(r) }));
          const totals = computeProfitTotals(rows);
          return { major: mj, rows, totals };
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
  useEffect(() => {
    if (viewMode === 'weeks' && rangeFrom && rangeTo && weeksData.length === 0 && !weeksLoading) loadWeeksRange();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);
  const toggleExpand = mj => setExpandedWeeks(prev => {
    const n = new Set(prev);
    n.has(mj) ? n.delete(mj) : n.add(mj);
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
      setMessage('저장 완료 — 수기값(기초/기말/통관비/환율/포워딩)과 비고가 보관되었습니다.');
      await load();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  const rowsCalc = useMemo(() => {
    const rows = (data?.rows || []).map(r => ({ ...r, calc: computeProfitRow(r, edits) }));
    return { rows, totals: computeProfitTotals(rows) };
  }, [data, edits]);

  const downloadExcel = async () => {
    if (Object.keys(edits).length > 0) await save();  // 수정 중이던 값을 먼저 저장해 파일에 반영
    const colsParam = visibleCols.filter(k => k !== 'category').join(',');
    window.location.href = `/api/sales/profit-report?week=${encodeURIComponent(weekInput.value)}&excel=1&cols=${encodeURIComponent(colsParam)}`;
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
  const dirty = Object.keys(edits).length > 0;
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
          const D = wTotals.C !== 0 ? c.C / wTotals.C : null;
          const U = wTotals.P !== 0 ? c.P / wTotals.P : null;
          return (
            <tr key={row.category} style={row.category === '기타(미분류)' ? { background: '#fffbeb' } : undefined}>
              {isVisible('category') && <td style={{ ...st.td, ...st.stickyCol, fontWeight: 700 }}>{row.category}</td>}
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
        <h1 style={st.h1}>📈 주차별 매출이익 보고서{data ? ` — ${data.major}차 (${data.orderYear})` : ''}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
          <div style={st.viewToggleWrap}>
            <button style={viewMode === 'category' ? st.viewToggleOn : st.viewToggleOff} onClick={() => setViewMode('category')}>카테고리별</button>
            <button style={viewMode === 'weeks' ? st.viewToggleOn : st.viewToggleOff} onClick={switchToWeeksView}>차수별</button>
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
              <button style={{ ...st.primaryBtn, background: dirty ? '#16a34a' : '#94a3b8' }} onClick={save} disabled={saving || !data}>
                {saving ? '저장 중…' : `저장${dirty ? ' *' : ''}`}
              </button>
              <button style={{ ...st.primaryBtn, background: '#0f766e' }} onClick={downloadExcel} disabled={!data || saving}
                title="원본 양식과 동일한 첫 시트 + 현재 화면에 표시된 컬럼만 담은 두번째 시트, 총 2개 시트로 다운로드">
                📥 엑셀 다운로드
              </button>
              <button style={st.secondaryBtn} onClick={openPriceModal} disabled={!data}
                title="재고가 있는 품목의 평가단가를 관리합니다 (지정 > 수국표 > 품목Cost 순 적용)">
                🏷 재고단가표
              </button>
              <button style={showOverrides ? st.toggleBtnOn : st.secondaryBtn} onClick={() => setShowOverrides(v => !v)} disabled={!data}
                title="자동값을 우선 사용합니다. 청구서·실사와 다른 예외 행을 수정할 때만 수기 보정을 엽니다">
                🛠 수기 보정{showOverrides ? ' ▲' : ' ▼'}
              </button>
              <button style={showCustoms ? st.toggleBtnOn : st.secondaryBtn} onClick={() => setShowCustoms(v => !v)} disabled={!data}
                title="백상창고료·관세·선율·월드운송료·한국방역·콜롬비아 무게배분 입력 — H(그외통관비) 자동값의 소스, 저장하면 아래 표가 바로 재계산됩니다">
                📦 그외통관비 입력{showCustoms ? ' ▲' : ' ▼'}
              </button>
              <button style={showForwarding ? st.toggleBtnOn : st.secondaryBtn} onClick={() => setShowForwarding(v => !v)} disabled={!data}
                title="네덜란드·중국·콜롬비아·에콰도르·태국 항공/포워딩 비용 입력 — S(포워딩) 자동값의 소스, 저장하면 아래 표가 바로 재계산됩니다">
                🚢 포워딩 입력{showForwarding ? ' ▲' : ' ▼'}
              </button>
            </>
          ) : (
            <>
              <label style={st.label}>차수범위</label>
              <input style={{ ...st.weekInput, width: 50 }} value={rangeFrom} onChange={e => setRangeFrom(e.target.value.replace(/\D/g, ''))} placeholder="25" />
              <span style={{ color: '#94a3b8' }}>~</span>
              <input style={{ ...st.weekInput, width: 50 }} value={rangeTo} onChange={e => setRangeTo(e.target.value.replace(/\D/g, ''))} placeholder="30" />
              <button style={st.primaryBtn} onClick={loadWeeksRange} disabled={weeksLoading}>{weeksLoading ? '조회 중…' : '조회'}</button>
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
        자동(파랑): 순수매출·불량·그외매출·구매금액 = 전산 DB / <b>기말재고(F) = 엑셀 원본 공식: (구매금액×환율+포워딩×환율+그외통관비) ÷ 매입총수량 × 기말재고수량</b>
        (매입 없는 주는 품목별 최근 매입단가×환율, 그것도 없으면 [🏷 재고단가표] 평가 · 기초(E)=전차수 기말 이월) — E/F/H/R/S는 자동값이 기본이며 표에는 읽기전용으로 표시됩니다.
        청구서 환율·실사재고·특수 통관비처럼 예외값을 넣을 때만 <b>🛠 수기 보정</b>을 열어 입력하면 해당 값이 우선합니다.
        환율(R)은 BILL 시점 FreightCost 환율 스냅샷을 우선 적용하고, 없으면 CurrencyMaster 기준환율(USD 기본 · 네덜란드=EUR · 호주=AUD · 중국=CNY · 일본=JPY)을 사용합니다. 금액·수량은 소수점 없이 천 단위 콤마로 표시합니다.
        포워딩(USD)은 입고관리(운송료/SERVICE FEE 라인)에서 자동감지(노랑=수정중·초록=저장됨).
        {data?.stockWeeks?.end ? ` · 재고 스냅샷: 기말=${data.stockWeeks.end}${data.stockWeeks.begin ? `, 기초=${data.stockWeeks.begin}말` : ''}` : ''}
        {data?.rates?.length ? ` · 참고 환율: ${data.rates.map(r => `${r.CurrencyCode} ${fmt(r.ExchangeRate)}`).join(' · ')}` : ''}
      </div>

      {error && <div style={st.error}>{error}</div>}
      {message && <div style={st.message}>{message}</div>}
      {data?.audit?.issues?.length > 0 && (
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
                const D = totals.C !== 0 ? c.C / totals.C : null;
                const U = totals.P !== 0 ? c.P / totals.P : null;
                return (
                  <tr key={row.category} style={row.category === '기타(미분류)' ? { background: '#fffbeb' } : undefined}>
                    {isVisible('category') && <td style={{ ...st.td, ...st.stickyCol, fontWeight: 700 }}>{row.category}</td>}
                    {shownColumns.map(cd => (
                      <td key={cd.key} style={{ ...st.tdNum, fontWeight: cd.bold ? 700 : undefined, color: cd.key === 'J' ? (c.J < 0 ? '#dc2626' : '#166534') : cd.color }}>
                        {showOverrides && cd.editable ? <EditCell row={row} col={cd.key} width={cd.editWidth || 86} edits={edits} setEdit={setEdit} autoValue={cd.key === 'F' ? c.F : undefined} /> : readonlyValue(cd.key, c, { D, U })}
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

      {viewMode === 'category' && data && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#334155', marginBottom: 4 }}>비고사항</div>
          <textarea
            style={st.noteArea}
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="예: 콜롬비아 수국: 냉해 21박스 (약 1,644,545원) …"
          />
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
