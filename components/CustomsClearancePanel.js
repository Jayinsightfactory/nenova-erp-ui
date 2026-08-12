// components/CustomsClearancePanel.js — 그외통관비 입력 패널 (재사용 컴포넌트)
// 국가별(백상창고료/관세/선율/월드운송료/한국방역) + 콜롬비아 4품목 무게배분 공유값 입력.
// H(그외통관비) 자동값의 소스. week 는 부모가 제어(주차별 매출이익보고서에 임베드되거나 단독 페이지로 사용).
// 저장 시 onSaved() 호출 — 부모가 이걸로 매출이익보고서를 재조회해 자동 재계산에 반영한다.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { COUNTRY_INPUT_FIELDS, vatInclusiveToNet, vatNetToInclusive } from '../lib/customsFields';
// 그외통관비/콜롬비아 배분 순수 계산식(DB 의존 없음) — 서버(lib/customsForwarding.js 실계산)와
// 정확히 같은 함수를 이 화면의 수기 편집 중 미리보기 합계에도 재사용한다(2026-08-12 결함수정:
// 이전에는 입력칸을 고쳐도 "합계"·"저장" 버튼 옆 합계가 마지막 조회 시점 값에 멈춰 있어, 화면에
// 보이는 값과 저장하면 실제로 반영될 값이 저장 전까지 서로 달랐다).
import {
  effectiveRatesForWeek, computeCountryCustomsTotal, computeColombiaCustomsTotal, computeColombiaAllocation,
} from '../lib/customsForwardingCalc';

const n0 = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? 0 : Number(v));
const fmt = (v) => Math.round(n0(v)).toLocaleString();

const RATE_FIELDS = [
  ['BakSangRate', '백상 창고료 (원/kg)'], ['Truck1t', '월드운송료 1t (원)'], ['Truck2_5t', '월드운송료 2.5t (원)'],
  ['Truck5t', '월드운송료 5t (원)'], ['QuarantinePerItemRate', '검역대행수수료 (원/품목)'],
];
const COLOMBIA_RATE_FIELDS = [
  ['BoxWeight_콜롬비아장미', '장미 박스당무게(kg)'], ['BoxWeight_콜롬비아카네이션', '카네이션 박스당무게'],
  ['BoxWeight_콜롬비아알스트로', '알스트로 박스당무게'], ['BoxWeight_콜롬비아루스커스', '루스커스 박스당무게'],
  ['BoxCBM_콜롬비아장미', '장미 박스당CBM'], ['BoxCBM_콜롬비아카네이션', '카네이션 박스당CBM'],
  ['BoxCBM_콜롬비아알스트로', '알스트로 박스당CBM'], ['BoxCBM_콜롬비아루스커스', '루스커스 박스당CBM'],
];
const COUNTRY_FIELD_GROUPS = [
  { label: '백상창고료 GW(kg)', phases: [{ label: '1차', keys: ['GW1'] }, { label: '2차', keys: ['GW2'] }] },
  { label: '관세', phases: [
    { label: '1차', keys: ['Customs1_1', 'Customs1_2', 'Customs1_3'], total: 'Customs1' },
    { label: '2차', keys: ['Customs2_1', 'Customs2_2', 'Customs2_3'], total: 'Customs2' },
  ] },
  { label: '선율', phases: [
    { label: '1차', keys: ['SunYul1_1', 'SunYul1_2', 'SunYul1_3'], total: 'SunYul1' },
    { label: '2차', keys: ['SunYul2_1', 'SunYul2_2', 'SunYul2_3'], total: 'SunYul2' },
  ] },
  { label: '월드운송료', phases: [{ label: '1차', keys: ['WorldFreight1'] }, { label: '2차', keys: ['WorldFreight2'] }] },
  { label: '한국방역', phases: [{ label: '1차', keys: ['Quarantine1'] }, { label: '2차', keys: ['Quarantine2'] }] },
];
const COUNTRY_PHASES = COUNTRY_FIELD_GROUPS.flatMap((g) => g.phases.map((phase) => ({ ...phase, groupLabel: g.label })));
const COUNTRY_FIELD_KEYS = COUNTRY_INPUT_FIELDS;
const COLOMBIA_FIELDS = [
  ['GW', 'GW(kg)'], ['CW', 'CW(kg)'], ['HandlingFee', '선율 통관수수료'], ['ItemCount', '품목수'],
  ['Truck1t', '트럭 1t 대수'], ['Truck2_5t', '트럭 2.5t 대수'], ['Truck5t', '트럭 5t 대수'],
  ['CustomsFee', '관세료'], ['DisinfectFee', '소독비용'], ['QuarantineDeductFee', '검역비용(차감stems)'],
];
const COLOMBIA_TRUCK_FIELDS = new Set(['Truck1t', 'Truck2_5t', 'Truck5t']);

function focusNextCustomsInput(event) {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  const root = event.currentTarget.closest('[data-customs-clearance-panel]');
  const inputs = Array.from(root?.querySelectorAll('input:not([disabled])') || []);
  const currentIndex = inputs.indexOf(event.currentTarget);
  inputs[currentIndex + 1]?.focus();
}

// 필드명 → 화면표시 라벨 (이력 팝업용)
const FIELD_LABEL = Object.fromEntries([
  ...COUNTRY_FIELD_GROUPS.flatMap((g) => g.phases.flatMap((p) => p.keys.map((k, i) => [k, `${g.label}(${p.label})${p.keys.length > 1 ? `-${i + 1}` : ''}`]))),
  ...COLOMBIA_FIELDS,
]);

// 입고관리 GW 기준값 힌트 — 있으면 클릭 적용, 없으면 '확인 필요' 표시만(입고 자체가 없을 수 있음: 사용자 방침)
function GwHint({ auto, current, onApply }) {
  const a = auto == null ? null : Math.round(Number(auto) * 10) / 10;
  const cur = current === '' || current == null ? null : Number(current);
  if (!a) {
    // 입고 GW 없음 — 수기값이 있을 때만 체크 배지 (미사용 국가 노이즈 방지)
    if (cur == null || cur === 0) return null;
    return <span style={{ fontSize: 9, color: '#b45309', fontWeight: 700, whiteSpace: 'nowrap' }} title="입고관리에 Gross weight 라인이 없어 대조 불가 — 값 직접 확인 필요">⚠ 입고GW없음·확인</span>;
  }
  const match = cur != null && Math.abs(cur - a) < 1;
  return (
    <button
      type="button"
      onClick={onApply}
      title={match ? '입고관리 Gross weight와 일치' : '클릭 → 입고관리 Gross weight 값 적용'}
      style={{
        fontSize: 9, fontWeight: 700, whiteSpace: 'nowrap', cursor: 'pointer',
        border: 'none', background: 'none', padding: 0,
        color: match ? '#059669' : '#dc2626',
      }}>
      입고 {a.toLocaleString()}{match ? ' ✓' : ' ↵'}
    </button>
  );
}

// 전차수 참고값 힌트 — 저장값·자동값이 없을 때만 보여주는 제안이다. 클릭(=명시적 적용)해야
// 편집 상태(countryEdits/colombiaEdits)로 들어가며, 그 전까지는 입력칸/합계 어디에도 반영되지
// 않는다(2026-08-12 결함수정: 이전에는 참고값이 입력칸에 자동으로 채워져 "화면에 보이는 값"과
// "실제 합계에 쓰인 값"이 달랐다).
function CarryHint({ value, onApply }) {
  if (value == null || value === '' || Number(value) === 0) return null;
  return (
    <button
      type="button"
      onClick={onApply}
      title="전차수 참고값 — 클릭하면 이번 차수 입력값으로 적용됩니다(적용 후 저장해야 반영). 적용 전까지는 합계에 포함되지 않습니다."
      style={{
        fontSize: 9, fontWeight: 700, whiteSpace: 'nowrap', cursor: 'pointer',
        border: 'none', background: 'none', padding: 0, color: '#b45309',
      }}>
      전차수 {fmt(value)} ↵
    </button>
  );
}

function HistoryButton({ orderYear, scopeType, scopeKey }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const toggle = async () => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (rows == null) {
      try {
        const r = await fetch(`/api/sales/customs-history?year=${encodeURIComponent(orderYear)}&scopeType=${encodeURIComponent(scopeType)}&scopeKey=${encodeURIComponent(scopeKey)}`, { credentials: 'same-origin' });
        const d = await r.json();
        setRows(d.success ? d.rows : []);
      } catch { setRows([]); }
    }
  };
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" style={hst.histBtn} onClick={toggle} title="수정 이력">🕘</button>
      {open && (
        <div style={hst.histPop}>
          <div style={{ fontWeight: 700, marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
            수정 이력 <span style={{ cursor: 'pointer', color: '#94a3b8' }} onClick={() => setOpen(false)}>✕</span>
          </div>
          {rows == null && <div style={{ color: '#94a3b8' }}>불러오는 중…</div>}
          {rows && rows.length === 0 && <div style={{ color: '#94a3b8' }}>수정 이력 없음</div>}
          {rows && rows.map((h, i) => (
            <div key={i} style={hst.histRow}>
              <b>{FIELD_LABEL[h.FieldName] || h.FieldName}</b>: {h.OldValue == null ? '(없음)' : fmt(h.OldValue)} → {h.NewValue == null ? '(없음)' : fmt(h.NewValue)}
              <div style={{ color: '#94a3b8', fontSize: 10 }}>{h.ChangedBy || '?'} · {h.ChangedAt}</div>
            </div>
          ))}
        </div>
      )}
    </span>
  );
}

export default function CustomsClearancePanel({ week, onSaved }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [data, setData] = useState(null);
  const [countryEdits, setCountryEdits] = useState({});
  const [colombiaEdits, setColombiaEdits] = useState({});
  const [rateEdits, setRateEdits] = useState({});
  const [showRates, setShowRates] = useState(false);
  const [showAllCats, setShowAllCats] = useState(false);
  const [editWeights, setEditWeights] = useState(false); // 무게는 입고 GW 자동 — 수기 교정할 때만 입력칸 노출
  const [saving, setSaving] = useState('');

  const load = useCallback(async () => {
    if (!week) return;
    setLoading(true); setError(''); setMessage('');
    try {
      const r = await fetch(`/api/sales/customs-clearance?week=${encodeURIComponent(week)}`, { credentials: 'same-origin' });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || '조회 실패');
      setData(d);
      setCountryEdits({}); setColombiaEdits({}); setRateEdits({});
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [week]);
  useEffect(() => { if (week) load(); }, [week, load]);

  // 화면에 보여줄 "현재 유효값"(=합계 계산에 실제로 쓰이는 값)이다. 전차수 참고값(carry)은 여기
  // 포함하지 않는다 — carry는 아래 CarryHint로만 보여주는 제안이며, 사용자가 명시적으로 "적용"을
  // 눌러야만(=수기 편집이 되어야만) countryOut()의 저장 대상에 들어간다. 이렇게 해야 입력칸에
  // 보이는 값과 서버가 실제로 총액에 반영한 값(row.total, totalSource)이 항상 일치한다.
  const countryValue = (row, field) => {
    if (countryEdits[row.category]?.[field] !== undefined) return countryEdits[row.category][field];
    const isWorldFreight = field === 'WorldFreight1' || field === 'WorldFreight2';
    const manualField = isWorldFreight ? `${field}Manual` : '';
    if (isWorldFreight && Number(row.saved?.[manualField]) === 1 && row.saved?.[field] != null) return vatInclusiveToNet(row.saved[field]);
    // 원본 엑셀 historical snapshot(22~27차)의 월드운송료는 그 주 실제 청구액이므로 추천값보다 우선.
    if (isWorldFreight && row.historical?.[field] != null) return vatInclusiveToNet(row.historical[field]);
    if (isWorldFreight && Number(row.worldFreightAuto?.[field]) > 0) return row.worldFreightAuto[field];
    if (row.saved?.[field] != null) return row.saved[field];
    // historical snapshot 구성요소는 이미 서버 합계(row.total)에 반영되어 있으므로 입력칸에도 그대로 보인다.
    if (row.historical?.[field] != null) return row.historical[field];
    return '';
  };
  const setCountryEdit = (cat, field, val) => setCountryEdits((prev) => ({ ...prev, [cat]: { ...(prev[cat] || {}), [field]: val } }));
  const countryOut = (row) => {
    const out = {};
    COUNTRY_FIELD_KEYS.forEach((field) => {
      const isWorldFreight = field === 'WorldFreight1' || field === 'WorldFreight2';
      const manualField = isWorldFreight ? `${field}Manual` : '';
      const hasManualEdit = countryEdits[row.category]?.[field] !== undefined;
      const hasSavedValue = row.saved?.[field] != null;
      const hasAutoValue = isWorldFreight && Number(row.worldFreightAuto?.[field]) > 0;
      // 레거시 리터럴/입고 GW 자동값은 저장하지 않는다. 사용자가 직접 수정한 경우에만 override 플래그를 함께 저장한다.
      if (isWorldFreight && !hasManualEdit && hasAutoValue && Number(row.saved?.[manualField]) !== 1) return;
      if (isWorldFreight && hasManualEdit) {
        out[manualField] = 1;
      } else if (isWorldFreight && row.saved?.[manualField] != null) {
        out[manualField] = row.saved[manualField];
      }
      // carry(전차수 참고값)만 있고 수기 편집·저장값·자동값·historical 값이 없으면 저장 대상에서
      // 제외한다 — 참고값을 사용자 확인 없이 조용히 저장하면 안 된다(2026-08-12 결함수정).
      const hasHistoricalValue = row.historical?.[field] != null;
      if (!hasManualEdit && !hasSavedValue && !hasAutoValue && !hasHistoricalValue) return;
      out[field] = isWorldFreight ? vatNetToInclusive(countryValue(row, field)) : countryValue(row, field);
    });
    // historical snapshot 행을 편집해 저장하는 순간 그 행은 "운영자 저장행"이 되어 이후 snapshot
    // 폴백이 적용되지 않는다. 편집하지 않은 나머지 구성요소까지 함께 저장해야 총액이 보존된다.
    if (row.historical) {
      out.WorldFreight1Manual = 1;
      out.WorldFreight2Manual = 1;
      if (row.historical.BakSangRateApplied != null) out.BakSangRateApplied = row.historical.BakSangRateApplied;
    }
    return out;
  };

  // 콜롬비아도 동일 원칙 — carry는 표시하되 유효값/저장 대상에 자동 포함하지 않는다.
  // 트럭 대수는 "실제값 우선" — 저장된 실제 대수 > historical snapshot 실제 대수 > 합산 GW 용량분해
  // 추천값. 이전 구현은 추천값이 저장값을 덮어써서 과거 차수의 실제 차량·비용이 사라졌다(2026-08-12 결함수정).
  const colValue = (c, field) => {
    if (colombiaEdits[c.orderWeek]?.[field] !== undefined) return colombiaEdits[c.orderWeek][field];
    if (c.saved?.[field] != null) return c.saved[field];
    if (c.historical?.[field] != null) return c.historical[field];
    if (COLOMBIA_TRUCK_FIELDS.has(field) && c.truckAuto) return c.truckAuto[field] || 0;
    return '';
  };
  const setColEdit = (wk, field, val) => setColombiaEdits((prev) => ({ ...prev, [wk]: { ...(prev[wk] || {}), [field]: val } }));
  // 저장 시 전송할 필드 — 실제로 수기 편집됐거나 이미 저장돼 있던 값만 보낸다(트럭 수량은 GW
  // 자동값을 그대로 스냅샷). carry(전차수 참고값)만 있는 필드는 사용자가 명시적으로 편집(적용)하기
  // 전까지 저장 대상에서 제외한다 — 빈 "저장" 클릭이 감사 기준값/전차수 참고값을 조용히 이번
  // 반차수 저장행으로 굳혀버리는 사고를 막기 위함이다.
  const colombiaOut = (c) => {
    const out = {};
    COLOMBIA_FIELDS.forEach(([f]) => {
      const hasEdit = colombiaEdits[c.orderWeek]?.[f] !== undefined;
      const hasSaved = c.saved?.[f] != null;
      const hasHistorical = c.historical?.[f] != null;
      if (COLOMBIA_TRUCK_FIELDS.has(f)) {
        // 실제 대수(편집/저장/historical)가 있으면 그 값을, 하나도 없을 때만 추천값을 스냅샷한다.
        if (hasEdit || hasSaved || hasHistorical) out[f] = colValue(c, f);
        else if (c.truckAuto) out[f] = c.truckAuto[f] || 0;
        return;
      }
      if (!hasEdit && !hasSaved && !hasHistorical) return;
      out[f] = colValue(c, f);
    });
    if (c.historical?.BakSangRateApplied != null) out.BakSangRateApplied = c.historical.BakSangRateApplied;
    return out;
  };

  // 저장 시점에 적용될 유효 백상 창고료 요율 — 서버 resolver와 동일 함수를 재사용해 미리보기 총액도
  // 서버가 실제로 계산할 값과 같은 요율을 쓴다. scope를 반드시 나눈다: 원본 엑셀에서 국가 시트는
  // 22~27차 모두 460원/kg이고 콜롬비아 4품목 반차수 시트만 22차 370원/kg이다(2026-08-12 결함수정).
  const countryRates = data ? effectiveRatesForWeek(data.rates, data.orderYear, data.major, 'country') : null;
  const colombiaRates = data ? effectiveRatesForWeek(data.rates, data.orderYear, data.major, 'colombia') : null;

  // 이 국가행의 "지금 화면에 보이는" 합계 — 수기 편집이 없으면 서버가 마지막 조회 시 계산해 준
  // row.total(저장값/자동값/감사기준값 중 하나)을 그대로 쓴다. 편집이 있으면 countryValue()가
  // 반환하는 현재 유효값들로 서버와 같은 공식(computeCountryCustomsTotal)을 즉시 다시 계산해,
  // 입력칸에 보이는 값과 합계·저장 버튼 옆 합계가 항상 같은 값을 가리키게 한다.
  const countryTotal = (row) => {
    const hasEdit = Boolean(countryEdits[row.category] && Object.keys(countryEdits[row.category]).length);
    if (!hasEdit || !countryRates) return n0(row.total);
    const liveRow = {};
    COUNTRY_FIELD_KEYS.forEach((field) => {
      const isWorldFreight = field === 'WorldFreight1' || field === 'WorldFreight2';
      const v = countryValue(row, field);
      liveRow[field] = isWorldFreight ? vatNetToInclusive(v) : v;
    });
    const rateSnapshot = row.saved?.BakSangRateApplied ?? row.historical?.BakSangRateApplied;
    if (rateSnapshot != null) liveRow.BakSangRateApplied = rateSnapshot;
    return computeCountryCustomsTotal(liveRow, countryRates, row.category);
  };

  // 콜롬비아 반차수의 "지금 화면에 보이는" TOTAL/카테고리별 배분 — 국가행과 동일 원칙.
  const colombiaLiveRow = (c) => {
    const liveRow = {};
    COLOMBIA_FIELDS.forEach(([f]) => { liveRow[f] = colValue(c, f); });
    const rateSnapshot = c.saved?.BakSangRateApplied ?? c.historical?.BakSangRateApplied;
    if (rateSnapshot != null) liveRow.BakSangRateApplied = rateSnapshot;
    return liveRow;
  };
  const colombiaHasEdit = (c) => Boolean(colombiaEdits[c.orderWeek] && Object.keys(colombiaEdits[c.orderWeek]).length);
  const colombiaTotal = (c) => {
    if (!colombiaHasEdit(c) || !colombiaRates) return n0(c.total);
    return computeColombiaCustomsTotal(colombiaLiveRow(c), colombiaRates);
  };
  const colombiaAllocationH = (c) => {
    if (!colombiaHasEdit(c) || !colombiaRates) return c.allocationH || {};
    const alloc = computeColombiaAllocation({ ...colombiaLiveRow(c), AirRateUSD: 0 }, c.boxQty, colombiaRates);
    return Object.fromEntries(Object.entries(alloc).map(([cat, v]) => [cat, Math.round(v.H)]));
  };

  const saveCountry = async (row) => {
    if (!Object.keys(countryEdits[row.category] || {}).length) {
      setMessage(`${row.category}: 변경된 입력값이 없습니다 — 참고값은 적용(편집) 후 저장하세요`);
      return;
    }
    setSaving(row.category); setError('');
    try {
      const r = await fetch('/api/sales/customs-clearance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ week, action: 'saveCountry', category: row.category, row: countryOut(row) }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      setMessage(`${row.category} 저장 완료 — 매출이익보고서에 자동 반영됩니다`);
      await load();
      onSaved?.();
    } catch (e) { setError(e.message); } finally { setSaving(''); }
  };

  const saveAllCountries = async () => {
    const editedCategories = Object.keys(countryEdits);
    if (!editedCategories.length) {
      setMessage('변경된 국가 입력값이 없습니다');
      return;
    }
    setSaving('countries'); setError('');
    try {
      const rows = editedCategories
        .map((category) => data?.countries.find((row) => row.category === category))
        .filter(Boolean)
        .map((row) => ({ category: row.category, row: countryOut(row) }));
      const r = await fetch('/api/sales/customs-clearance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ week, action: 'saveCountries', rows }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      setMessage(`${d.saved || rows.length}개 국가 입력값 일괄 저장 완료 — 매출이익보고서에 자동 반영됩니다`);
      await load();
      onSaved?.();
    } catch (e) { setError(e.message); } finally { setSaving(''); }
  };

  const saveColombia = async (c) => {
    if (!Object.keys(colombiaEdits[c.orderWeek] || {}).length) {
      setMessage(`${c.orderWeek}: 변경된 입력값이 없습니다 — 참고값은 적용(편집) 후 저장하세요`);
      return;
    }
    setSaving(c.orderWeek); setError('');
    try {
      const out = colombiaOut(c);
      const r = await fetch('/api/sales/customs-clearance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ week, action: 'saveColombia', orderWeek: c.orderWeek, row: out }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      setMessage(`${c.orderWeek} 콜롬비아 배분값 저장 완료 — 매출이익보고서에 자동 반영됩니다`);
      await load();
      onSaved?.();
    } catch (e) { setError(e.message); } finally { setSaving(''); }
  };

  const saveRates = async () => {
    setSaving('rates'); setError('');
    try {
      const merged = { ...data.rates, ...rateEdits };
      const r = await fetch('/api/sales/customs-clearance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ week, action: 'saveRates', rates: merged }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      setMessage('단가표 저장 완료');
      await load();
      onSaved?.();
    } catch (e) { setError(e.message); } finally { setSaving(''); }
  };

  // 화면 맨 위 "합계" — 국가행·콜롬비아 반차수 각각의 현재 유효 합계(countryTotal/colombiaAllocationH,
  // 수기 편집이 있으면 즉시 재계산됨)를 그대로 더한다. 저장 전 미리보기와 저장 후 값이 항상 같은
  // 계산식을 거치므로, 이 합계가 실제로 저장하면 반영될 값과 어긋나지 않는다.
  const totalAll = useMemo(() => {
    if (!data) return 0;
    const countrySum = data.countries.reduce((s, r) => s + n0(countryTotal(r)), 0);
    const colSum = (data.colombia || []).reduce((s, c) => s + Object.values(colombiaAllocationH(c)).reduce((a, b) => a + n0(b), 0), 0);
    return countrySum + colSum;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, countryEdits, colombiaEdits]);

  // 이 차수에 입고가 있거나 저장값이 있는 국가만 기본 노출 — 입력칸 다이어트 (나머지는 펼치기)
  const isRelevantCountry = useCallback((row) => {
    if ((data?.activeCategories || []).includes(row.category)) return true;
    const hasVal = (obj) => obj && COUNTRY_FIELD_KEYS.some((f) => n0(obj[f]) !== 0);
    return hasVal(row.saved) || hasVal(row.historical) || hasVal(row.carry);
  }, [data]);
  const visibleCountries = useMemo(() => {
    if (!data) return [];
    return showAllCats ? data.countries : data.countries.filter(isRelevantCountry);
  }, [data, showAllCats, isRelevantCountry]);
  const hiddenCatCnt = data ? data.countries.length - data.countries.filter(isRelevantCountry).length : 0;

  if (!week) return <div style={{ padding: 16, color: '#94a3b8', fontSize: 12 }}>차수를 먼저 조회하세요.</div>;

  return (
    <div data-customs-clearance-panel>
      <div style={st.hint}>
        <b>이 화면이 만드는 값</b> — 매출이익 보고서 H열(그외통관비)입니다. 국가별 계산식은
        <b> (1차GW+2차GW)×백상 창고료 단가 + 관세1+관세2 + (선율1+선율2+월드운송료1+월드운송료2+한국방역1+한국방역2)÷1.1</b> 입니다.
        백상창고료·관세는 부가세를 빼지 않고, 선율·월드운송료·한국방역만 ÷1.1(공급가)로 바꿉니다(베트남 선율만 예외 — 원본이 이미 공급가).
        월드 운송료 추천값은 <b>그 대차수 1차+2차 GW를 합산해 용량 단위로 분해</b>합니다(예: 3,000kg → 2.5t 1대 + 1t 1대).
        <u>과거에 실제로 쓴 차량·비용이 저장돼 있으면 추천값으로 덮지 않습니다.</u> 직접 입력하면 그 차수의 실제값으로 저장됩니다(부가세 제외 금액 표시).
        관세·선율은 청구가 나뉘어 오므로 1차/2차를 각각 1·2·3번으로 나눠 입력하고, 화면 합계가 관세1차/2차·선율1차/2차로 자동 합산됩니다.
        콜롬비아 4품목(카네이션·장미·알스트로·루스커스)은 <b>반차수(1차/2차)마다 각각</b> TOTAL(=GW×백상단가 + 통관수수료 + 품목수×검역대행단가 + 실제 트럭비 + 관세료 + 소독비용 + 검역비용)을 구한 뒤 박스당무게×박스수량 비율로 배분합니다(항상 무게비율).
        <br />
        <b>값의 출처 3가지</b> —
        <b style={{ color: '#0f766e' }}> 원본 엑셀값</b>: 2026년 22~27차처럼 운영 DB에 입력 이력이 없는 차수에, 원본 "매출원가 양식" 시트의 <u>구성요소 그대로</u>를 자동 적용한 값입니다(합계에 이미 반영). 한 칸이라도 저장하면 그 행 전체가 운영자 저장값으로 바뀝니다.
        <b style={{ color: '#e65100' }}> 전차수 참고값(↵)</b>: 저장값·원본 엑셀값이 모두 없을 때만 보이는 제안이며, <u>클릭해 적용하고 저장하기 전까지 합계에 전혀 반영되지 않습니다</u>.
        <b> 저장값</b>: 담당자가 이 차수에 직접 입력한 값으로 항상 최우선입니다.
        <br />
        <b>값이 없을 때 할 일</b> — 관세·선율은 통관사 청구서 금액을 그대로 입력하고, GW는 입고관리의 Gross weight 라인을 확인하세요(입고 GW 힌트를 클릭하면 그대로 들어갑니다).
        🕘 아이콘으로 수정 이력(누가·언제·얼마→얼마)을 볼 수 있습니다.
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button style={st.secondaryBtn} onClick={() => setShowRates((v) => !v)}>{showRates ? '단가표 닫기' : '⚙ 단가표'}</button>
        {loading && <span style={{ fontSize: 12, color: '#64748b', alignSelf: 'center' }}>로딩중…</span>}
      </div>

      {error && <div style={st.error}>{error}</div>}
      {message && <div style={st.message}>{message}</div>}

      {showRates && data && (
        <div style={st.panel}>
          <div style={st.panelHead}><strong>⚙ 단가표 (관리자 수정 — 백상/트럭/검역대행/콜롬비아 박스당무게·CBM)</strong></div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, padding: 12 }}>
            {[...RATE_FIELDS, ...COLOMBIA_RATE_FIELDS].map(([key, label]) => (
              <label key={key} style={st.rateField}>
                <span style={{ fontSize: 11, color: '#64748b', display: 'flex', gap: 3, alignItems: 'center' }}>
                  {label} <HistoryButton orderYear="_global" scopeType="Rate" scopeKey={key} />
                </span>
                <input style={st.input} type="text"
                  value={rateEdits[key] !== undefined ? rateEdits[key] : (data.rates[key] ?? '')}
                  onKeyDown={focusNextCustomsInput}
                  onChange={(e) => setRateEdits((p) => ({ ...p, [key]: e.target.value.replace(/[^0-9.]/g, '') }))} />
              </label>
            ))}
          </div>
          <div style={{ padding: '0 12px 12px' }}>
            <button style={st.primaryBtn} onClick={saveRates} disabled={saving === 'rates'}>단가표 저장</button>
          </div>
        </div>
      )}

      {data && (
        <>
          <div style={st.panel}>
            <div style={st.panelHead}>
              <strong>국가별 그외통관비</strong>
              <button
                type="button"
                style={st.primaryBtn}
                onClick={saveAllCountries}
                disabled={saving === 'countries' || Object.keys(countryEdits).length === 0}
                title="입력값이 변경된 국가들을 하나의 트랜잭션으로 저장합니다">
                {saving === 'countries' ? '일괄 저장중…' : `💾 입력값 일괄 저장${Object.keys(countryEdits).length ? ` (${Object.keys(countryEdits).length})` : ''}`}
              </button>
              <button
                type="button"
                style={{ marginLeft: 8, fontSize: 11, border: editWeights ? '1px solid #b45309' : '1px dashed #94a3b8', background: editWeights ? '#fff7ed' : '#fff', color: editWeights ? '#b45309' : '#475569', borderRadius: 5, padding: '2px 8px', cursor: 'pointer' }}
                onClick={() => setEditWeights((v) => !v)}
                title="무게(GW/CW)는 입고관리 Gross weight 자동값이 기준 — 교정이 필요할 때만 입력칸을 엽니다">
                {editWeights ? '무게 교정 닫기 \u25b2' : '\u2696 무게 수기교정'}
              </button>
              {hiddenCatCnt > 0 && (
                <button
                  type="button"
                  style={{ marginLeft: 8, fontSize: 11, border: '1px dashed #94a3b8', background: '#fff', color: '#475569', borderRadius: 5, padding: '2px 8px', cursor: 'pointer' }}
                  onClick={() => setShowAllCats((v) => !v)}
                  title="이 차수에 입고·저장값이 없는 국가는 기본 숨김">
                  {showAllCats ? '입고 있는 국가만 보기 ▲' : `입고 없는 국가 ${hiddenCatCnt}개 펼치기 ▼`}
                </button>
              )}
              <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>합계(콜롬비아 4품목 포함) {fmt(totalAll)}원</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={st.table}>
                <thead>
                  <tr>
                    <th style={st.th}>국가</th>
                    {COUNTRY_PHASES.map((phase) => <th key={`${phase.groupLabel}-${phase.label}`} style={st.th}>
                      {phase.groupLabel} {phase.label}{phase.keys.length > 1 ? ' (1/2/3)' : ''}
                    </th>)}
                    <th style={st.th}>합계</th><th style={st.th}></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleCountries.map((row) => {
                    const isHistorical = row.totalSource === 'excel_historical_snapshot';
                    const carried = !row.saved && !isHistorical && row.carry;
                    return (
                      <tr key={row.category} style={{ background: isHistorical ? '#ecfdf5' : carried ? '#fff7ed' : '#fff' }}>
                        <td style={st.tdLabel}>
                          {row.category}
                          {isHistorical && <span style={st.baselineBadge} title="운영 DB에 이 차수 입력 이력이 없어, 원본 '매출원가 양식' 엑셀의 구성요소(GW/관세/선율/월드운송료/방역)를 그대로 자동 적용 중입니다. 한 칸이라도 저장하면 이 행 전체가 저장값으로 바뀝니다.">원본 엑셀값</span>}
                        </td>
                        {COUNTRY_PHASES.map((phase) => {
                          const isSplit = phase.keys.length > 1;
                          if (isSplit) {
                            const values = phase.keys.map((field) => countryValue(row, field));
                            const total = values.reduce((sum, value) => sum + n0(value), 0);
                            const carryTotal = row.carry?.[phase.total];
                            return (
                              <td key={`${phase.groupLabel}-${phase.label}`} style={{ ...st.tdNum, minWidth: 235 }}>
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 3 }}>
                                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 3 }}>
                                    {phase.keys.map((field, i) => (
                                      <label key={field} style={{ display: 'flex', alignItems: 'center', gap: 2 }} title={`${phase.groupLabel} ${phase.label} ${i + 1}차 분할금액`}>
                                        <span style={{ fontSize: 9, color: '#64748b' }}>{i + 1}</span>
                                        <input style={st.splitInput} value={countryValue(row, field)}
                                          onKeyDown={focusNextCustomsInput}
                                          onChange={(e) => setCountryEdit(row.category, field, e.target.value.replace(/[^0-9.\-]/g, ''))} />
                                      </label>
                                    ))}
                                  </div>
                                  <span style={st.splitTotal}>{phase.groupLabel} {phase.label} 합계: <b>{fmt(total)}</b></span>
                                  {total === 0 && !isHistorical && (
                                    <CarryHint value={carryTotal}
                                      onApply={() => setCountryEdit(row.category, phase.keys[0], String(n0(carryTotal)))} />
                                  )}
                                </div>
                              </td>
                            );
                          }
                          const f = phase.keys[0];
                          const isGw = f === 'GW1' || f === 'GW2';
                          const isWorldFreight = f === 'WorldFreight1' || f === 'WorldFreight2';
                          const auto = isGw ? data.autoGw?.countries?.[row.category]?.[f] : null;
                          const cur = countryValue(row, f);
                          const worldAuto = isWorldFreight ? row.worldFreightAuto?.[f] : null;
                          // 무게(GW)는 입고 자동이 기준 — 기본 화면에선 값 표시만, 값이 아예 없으면 입력칸(⚠)
                          if (isGw && !editWeights) {
                            const manualVal = n0(cur);
                            const autoVal = n0(auto);
                            const eff = manualVal > 0 ? manualVal : autoVal;
                            if (eff > 0) {
                              return (
                                <td key={f} style={st.tdNum}>
                                  <span
                                    title={manualVal > 0 ? '수기 저장값 (입고 자동보다 우선)' : '입고관리 Gross weight 자동값 — 교정은 [무게 수기교정]'}
                                    style={{ fontSize: 11.5, fontWeight: 700, color: manualVal > 0 ? '#b45309' : '#059669' }}>
                                    {Math.round(eff * 10) / 10}{manualVal > 0 ? '\u270e' : ''}
                                  </span>
                                </td>
                              );
                            }
                          }
                          return (
                            <td key={f} style={st.tdNum}>
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                                <input style={st.cellInput} value={cur}
                                  onKeyDown={focusNextCustomsInput}
                                  title={isWorldFreight && Number(worldAuto) > 0 && row.worldFreightSource?.[f] !== 'manual_override'
                                    ? '입고 GW 기반 자동계산값 — 수정하면 수기 override로 저장됩니다' : undefined}
                                  onChange={(e) => setCountryEdit(row.category, f, e.target.value.replace(/[^0-9.\-]/g, ''))} />
                                {isWorldFreight && Number(worldAuto) > 0 && row.worldFreightSource?.[f] !== 'manual_override' && (
                                  <span style={{ fontSize: 9, color: '#059669' }}>GW 자동</span>
                                )}
                                {isGw && (
                                  <GwHint auto={auto} current={cur}
                                    onApply={() => setCountryEdit(row.category, f, String(Math.round(Number(auto) * 10) / 10))} />
                                )}
                                {!isGw && !isWorldFreight && !isHistorical && n0(cur) === 0 && (
                                  <CarryHint value={row.carry?.[f]} onApply={() => setCountryEdit(row.category, f, String(n0(row.carry?.[f])))} />
                                )}
                              </div>
                            </td>
                          );
                        })}
                        <td style={st.tdNum} title={Object.keys(countryEdits[row.category] || {}).length ? '수기 편집 중 — 저장 전 미리보기 합계(저장하면 이 값 그대로 반영)' : undefined}>
                          {fmt(countryTotal(row))}
                        </td>
                        <td style={st.tdNum}>
                          <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                            <button style={st.tinyBtn} onClick={() => saveCountry(row)} disabled={saving === row.category}>
                              {saving === row.category ? '저장중' : '저장'}
                            </button>
                            <HistoryButton orderYear={data.orderYear} scopeType="Country" scopeKey={`${data.major}|${row.category}`} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div style={st.panel}>
            <div style={st.panelHead}><strong>콜롬비아 4품목 무게배분 (반차수별 — 카네이션·장미·알스트로·루스커스 공유)</strong></div>
            {(data.colombia || []).map((c) => {
              const isHistorical = c.totalSource === 'excel_historical_snapshot';
              const carried = !c.saved && !isHistorical && c.carry;
              return (
                <div key={c.orderWeek} style={{ padding: 12, borderBottom: '1px solid #eef2f7', background: isHistorical ? '#ecfdf5' : carried ? '#fff7ed' : '#fff' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <b style={{ fontSize: 13 }}>{c.orderWeek}</b>
                    {isHistorical && <span style={st.baselineBadge} title="운영 DB에 이 반차수 입력 이력이 없어, 원본 '매출원가 양식' 콜롬비아 시트의 구성요소(GW/통관수수료/품목수/실제 트럭 대수/관세료/소독/검역)와 원본 박스수량을 그대로 자동 적용 중입니다.">원본 엑셀값</span>}
                    <span style={{ fontSize: 11, color: '#64748b' }} title={isHistorical ? '배분에 쓰인 박스수량은 원본 엑셀값입니다(현재 입고 DB 값과 다를 수 있음).' : '현재 입고관리(WarehouseDetail) 자동 집계값'}>
                      박스수량({isHistorical ? '원본 엑셀' : '입고 자동'}): 장미{c.boxQty['콜롬비아 장미'] || 0} · 카네이션{c.boxQty['콜롬비아 카네이션'] || 0} · 알스트로{c.boxQty['콜롬비아 알스트로'] || 0} · 루스커스{c.boxQty['콜롬비아 루스커스'] || 0}
                    </span>
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
                      <button style={st.tinyBtn} onClick={() => saveColombia(c)} disabled={saving === c.orderWeek}>
                        {saving === c.orderWeek ? '저장중' : '저장'}
                      </button>
                      <HistoryButton orderYear={data.orderYear} scopeType="Colombia" scopeKey={c.orderWeek} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {COLOMBIA_FIELDS.map(([f, label]) => {
                      const isGw = f === 'GW' || f === 'CW';
                      const isTruck = COLOMBIA_TRUCK_FIELDS.has(f);
                      const auto = isGw ? data.autoGw?.colombia?.[c.orderWeek]?.[f] : null;
                      const cur = colValue(c, f);
                      if (isTruck) {
                        // 실제 차량 대수는 항상 입력 가능하다(사용자 수정·차수별 저장 지원).
                        // 추천값(합산 GW 용량분해)은 아래에 참고로만 보여주고, 실제값을 덮지 않는다.
                        const autoCount = c.truckAuto ? (c.truckAuto[f] || 0) : 0;
                        const actualCount = n0(cur);
                        return (
                          <label key={f} style={st.rateField}>
                            <span style={{ fontSize: 10, color: '#64748b' }}>{label}(실제)</span>
                            <input style={st.input} value={cur}
                              title="그 반차수에 실제로 사용한 차량 대수입니다. 비우면 아래 추천값이 저장 시 적용됩니다."
                              onChange={(e) => setColEdit(c.orderWeek, f, e.target.value.replace(/[^0-9.]/g, ''))} />
                            {c.truckAuto && (
                              <button type="button"
                                onClick={() => setColEdit(c.orderWeek, f, String(autoCount))}
                                title="합산 GW 용량분해 추천값 — 클릭하면 실제값 칸에 넣습니다(저장해야 반영)"
                                style={{
                                  fontSize: 9, fontWeight: 700, whiteSpace: 'nowrap', cursor: 'pointer',
                                  border: 'none', background: 'none', padding: 0,
                                  color: actualCount === autoCount ? '#059669' : '#dc2626',
                                }}>
                                추천 {autoCount}{actualCount === autoCount ? ' ✓' : ' ↵'}
                              </button>
                            )}
                          </label>
                        );
                      }
                      if (isGw && !editWeights) {
                        const manualVal = n0(cur);
                        const autoVal = n0(auto);
                        const eff = manualVal > 0 ? manualVal : autoVal;
                        if (eff > 0) {
                          return (
                            <label key={f} style={st.rateField}>
                              <span style={{ fontSize: 10, color: '#64748b' }}>{label}</span>
                              <span
                                title={manualVal > 0 ? '수기 저장값 (입고 자동보다 우선)' : '입고관리 자동값 — 교정은 [무게 수기교정]'}
                                style={{ fontSize: 13, fontWeight: 700, padding: '5px 0', color: manualVal > 0 ? '#b45309' : '#059669' }}>
                                {Math.round(eff * 10) / 10}{manualVal > 0 ? ' \u270e' : ' (자동)'}
                              </span>
                            </label>
                          );
                        }
                      }
                      return (
                        <label key={f} style={st.rateField}>
                          <span style={{ fontSize: 10, color: '#64748b' }}>{label}{isGw ? ' \u26a0직접확인' : ''}</span>
                          <input style={st.input} value={cur}
                            onChange={(e) => setColEdit(c.orderWeek, f, e.target.value.replace(/[^0-9.\-]/g, ''))} />
                          {isGw && (
                            <GwHint auto={auto} current={cur}
                              onApply={() => setColEdit(c.orderWeek, f, String(Math.round(Number(auto) * 10) / 10))} />
                          )}
                          {!isGw && !isHistorical && n0(cur) === 0 && (
                            <CarryHint value={c.carry?.[f]} onApply={() => setColEdit(c.orderWeek, f, String(n0(c.carry?.[f])))} />
                          )}
                        </label>
                      );
                    })}
                  </div>
                  <div style={{ marginTop: 8, fontSize: 12, color: '#334155' }} title={colombiaHasEdit(c) ? '수기 편집 중 — 저장 전 미리보기(저장하면 이 값 그대로 반영)' : undefined}>
                    배분 미리보기(H): 장미 {fmt(colombiaAllocationH(c)['콜롬비아 장미'])} · 카네이션 {fmt(colombiaAllocationH(c)['콜롬비아 카네이션'])} ·
                    알스트로 {fmt(colombiaAllocationH(c)['콜롬비아 알스트로'])} · 루스커스 {fmt(colombiaAllocationH(c)['콜롬비아 루스커스'])}
                  </div>
                </div>
              );
            })}
            {(!data.colombia || data.colombia.length === 0) && <div style={{ padding: 16, color: '#94a3b8', fontSize: 12 }}>이 차수에 콜롬비아 입고 데이터가 없습니다.</div>}
          </div>
        </>
      )}
    </div>
  );
}

const st = {
  hint: { fontSize: 11.5, color: '#64748b', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 8, padding: '8px 10px', marginBottom: 10, lineHeight: 1.5 },
  primaryBtn: { padding: '7px 16px', background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 12.5 },
  secondaryBtn: { padding: '7px 14px', background: '#fff', color: '#1d4ed8', border: '1px solid #1d4ed8', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 12.5 },
  tinyBtn: { padding: '4px 10px', background: '#0f766e', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer', fontWeight: 700, fontSize: 11 },
  error: { background: '#fee2e2', color: '#b91c1c', padding: '8px 12px', borderRadius: 6, marginBottom: 8, fontSize: 12.5 },
  message: { background: '#dcfce7', color: '#166534', padding: '8px 12px', borderRadius: 6, marginBottom: 8, fontSize: 12.5 },
  panel: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, marginBottom: 12, overflow: 'hidden' },
  panelHead: { display: 'flex', alignItems: 'center', padding: '9px 12px', background: '#f1f5f9', borderBottom: '1px solid #e2e8f0', fontSize: 13 },
  table: { borderCollapse: 'collapse', width: '100%', minWidth: 1500, fontSize: 12 },
  th: { padding: '6px 8px', background: '#f8fafc', borderBottom: '2px solid #e2e8f0', fontSize: 11, color: '#475569', whiteSpace: 'nowrap' },
  tdLabel: { padding: '4px 8px', fontWeight: 700, whiteSpace: 'nowrap', borderBottom: '1px solid #f1f5f9' },
  tdNum: { padding: '3px 6px', textAlign: 'right', borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap' },
  cellInput: { width: 68, textAlign: 'right', border: '1px solid #cbd5e1', borderRadius: 4, padding: '3px 5px', fontSize: 11.5 },
  splitInput: { width: 68, textAlign: 'right', border: '1px solid #cbd5e1', borderRadius: 4, padding: '3px 5px', fontSize: 11.5 },
  splitTotal: { color: '#0f766e', fontSize: 10.5, textAlign: 'right', borderTop: '1px dashed #99f6e4', paddingTop: 2 },
  rateField: { display: 'flex', flexDirection: 'column', gap: 2 },
  baselineBadge: { marginLeft: 6, fontSize: 9, fontWeight: 700, color: '#0f766e', background: '#d1fae5', border: '1px solid #6ee7b7', borderRadius: 4, padding: '1px 5px' },
  input: { width: 100, padding: '5px 7px', border: '1px solid #cbd5e1', borderRadius: 5, fontSize: 12, textAlign: 'right' },
};

const hst = {
  histBtn: { border: '1px solid #cbd5e1', background: '#fff', borderRadius: 4, cursor: 'pointer', fontSize: 11, padding: '2px 5px', lineHeight: 1 },
  histPop: { position: 'absolute', top: '110%', right: 0, zIndex: 50, width: 260, maxHeight: 260, overflow: 'auto', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,0.15)', padding: 10, fontSize: 11, textAlign: 'left' },
  histRow: { padding: '4px 0', borderTop: '1px solid #f1f5f9' },
};
