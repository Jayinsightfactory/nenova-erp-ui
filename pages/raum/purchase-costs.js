import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { PNL_PARTNERS } from '../../lib/raumPnlPartner';
import { buildRaumPnlCombinedPurchaseCostMatrix, isRaumPnlSharedDraftUnchanged } from '../../lib/raumPnlCostComparison';
import { isShillaPurchaseCostDraftUnchanged } from '../../components/raum/ShillaPurchaseCosts';
import CombinedPurchaseCostCell from '../../components/raum/CombinedPurchaseCostCell';

const border = '1px solid #cbd5e1';
const btn = { height: 28, padding: '0 9px', border, borderRadius: 4, background: '#fff', color: '#1e293b', cursor: 'pointer', fontSize: 12 };
const primary = { ...btn, background: '#1d4ed8', borderColor: '#1d4ed8', color: '#fff', fontWeight: 700 };
const shillaPrimary = { ...btn, background: '#0f766e', borderColor: '#0f766e', color: '#fff', fontWeight: 700 };

function messageOf(cause, fallback) {
  return cause?.message || fallback;
}

function invalidEntries(entries) {
  return entries.find(entry => {
    const text = String(entry.value ?? '').trim();
    if (!text) return false;
    const number = Number(text.replace(/,/g, ''));
    return !Number.isFinite(number) || number < 0;
  });
}

export default function RaumPurchaseCostsPage() {
  const router = useRouter();
  const requestSequence = useRef(0);
  const [ready, setReady] = useState(false);
  const [orderYear, setOrderYear] = useState('');
  const [sharedRows, setSharedRows] = useState([]);
  const [shillaRows, setShillaRows] = useState([]);
  const [years, setYears] = useState([]);
  const [search, setSearch] = useState('');
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [sharedDrafts, setSharedDrafts] = useState({});
  const [shillaDrafts, setShillaDrafts] = useState({});
  const [sharedState, setSharedState] = useState({ loading: false, error: '' });
  const [shillaState, setShillaState] = useState({ loading: false, error: '' });
  const [sharedSaving, setSharedSaving] = useState(false);
  const [shillaSaving, setShillaSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!router.isReady || ready) return;
    const queryYear = String(router.query.year || '').trim();
    setOrderYear(/^\d{4}$/.test(queryYear) ? queryYear : String(new Date().getFullYear()));
    setReady(true);
  }, [router.isReady, router.query.year, ready]);

  const load = useCallback(async () => {
    if (!ready || !/^\d{4}$/.test(orderYear)) return;
    const sequence = ++requestSequence.current;
    setSharedState({ loading: true, error: '' });
    setShillaState({ loading: true, error: '' });
    setMessage('');
    const checkCurrent = () => sequence === requestSequence.current;
    const loadShared = async () => {
      try {
        const response = await fetch(`/api/raum/purchase-costs?year=${encodeURIComponent(orderYear)}`);
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || '라움·초이문 매입단가를 불러오지 못했습니다.');
        if (!checkCurrent()) return;
        setSharedRows(Array.isArray(result.rows) ? result.rows : []);
        setYears(current => [...new Set([...current, ...(Array.isArray(result.years) ? result.years : [])])]);
      } catch (cause) {
        if (checkCurrent()) {
          setSharedRows([]);
          setSharedState(current => ({ ...current, error: messageOf(cause, '라움·초이문 매입단가를 불러오지 못했습니다.') }));
        }
      } finally {
        if (checkCurrent()) setSharedState(current => ({ ...current, loading: false }));
      }
    };
    const loadShilla = async () => {
      try {
        const response = await fetch(`/api/raum/shilla-purchase-costs?year=${encodeURIComponent(orderYear)}`);
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || '신라 매입단가를 불러오지 못했습니다.');
        if (!checkCurrent()) return;
        setShillaRows(Array.isArray(result.shillaRows) ? result.shillaRows : (Array.isArray(result.rows) ? result.rows : []));
        setYears(current => [...new Set([...current, ...(Array.isArray(result.years) ? result.years : [])])]);
      } catch (cause) {
        if (checkCurrent()) {
          setShillaRows([]);
          setShillaState(current => ({ ...current, error: messageOf(cause, '신라 매입단가를 불러오지 못했습니다.') }));
        }
      } finally {
        if (checkCurrent()) setShillaState(current => ({ ...current, loading: false }));
      }
    };
    await Promise.all([loadShared(), loadShilla()]);
  }, [ready, orderYear]);

  useEffect(() => { load(); return () => { requestSequence.current += 1; }; }, [load]);
  const sharedDirtyCount = Object.keys(sharedDrafts).length;
  const shillaDirtyCount = Object.keys(shillaDrafts).length;
  const dirtyCount = sharedDirtyCount + shillaDirtyCount;
  const busy = sharedState.loading || shillaState.loading || sharedSaving || shillaSaving;

  useEffect(() => {
    const onBeforeUnload = event => {
      if (!dirtyCount) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirtyCount]);

  const matrix = useMemo(() => buildRaumPnlCombinedPurchaseCostMatrix(sharedRows, shillaRows, { orderYear }), [sharedRows, shillaRows, orderYear]);
  const filteredItems = useMemo(() => {
    const query = search.replace(/\s+/g, '').toLowerCase();
    return matrix.items.filter(item => {
      if (query && !`${item.name}${item.shillaName || ''}${item.prodName}${item.shillaProdName || ''}${item.prodKey || ''}`.replace(/\s+/g, '').toLowerCase().includes(query)) return false;
      if (attentionOnly && !item.cells.some(cell => cell?.shared?.state && cell.shared.state !== 'match')) return false;
      return true;
    });
  }, [matrix.items, search, attentionOnly]);
  const stateCounts = useMemo(() => {
    const counts = { missing: 0, mismatch: 0, partial: 0 };
    for (const item of matrix.items) for (const cell of item.cells) {
      const state = cell?.shared?.state;
      if (Object.prototype.hasOwnProperty.call(counts, state)) counts[state] += 1;
    }
    return counts;
  }, [matrix.items]);

  const changeYear = next => {
    if (busy) return;
    if (dirtyCount && !window.confirm('저장하지 않은 공통 또는 신라 단가 변경이 있습니다. 버리고 조회 연도를 바꿀까요?')) return;
    requestSequence.current += 1;
    setOrderYear(String(next));
    setSharedRows([]); setShillaRows([]);
    setSharedDrafts({}); setShillaDrafts({});
    setSharedState({ loading: false, error: '' }); setShillaState({ loading: false, error: '' });
    setMessage('');
    router.replace({ pathname: router.pathname, query: { ...router.query, year: String(next) } }, undefined, { shallow: true });
  };

  const updateSharedDraft = (cell, value) => {
    setSharedDrafts(current => {
      const next = { ...current };
      if (isRaumPnlSharedDraftUnchanged(value, cell)) delete next[cell.key];
      else next[cell.key] = { cell, value };
      return next;
    });
    setMessage('');
  };
  const updateShillaDraft = (cell, value) => {
    setShillaDrafts(current => {
      const next = { ...current };
      if (isShillaPurchaseCostDraftUnchanged(value, cell)) delete next[cell.key];
      else next[cell.key] = { cell, value };
      return next;
    });
    setMessage('');
  };

  const saveShared = async () => {
    const entries = Object.values(sharedDrafts);
    if (!entries.length || busy) return;
    if (invalidEntries(entries)) { setSharedState(current => ({ ...current, error: '공통 매입단가는 0 이상의 숫자만 입력할 수 있습니다.' })); return; }
    if (entries.some(entry => !String(entry.value ?? '').trim()) && !window.confirm('빈칸으로 저장한 품목은 해당 차수 손익 합계에서 제외됩니다. 계속할까요?')) return;
    setSharedSaving(true); setSharedState(current => ({ ...current, error: '' })); setMessage('');
    try {
      const response = await fetch('/api/raum/purchase-costs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderYear, updates: entries.map(({ cell, value }) => ({ major: cell.major, identity: cell.identity, expected: cell.snapshot, costPrice: String(value ?? '').trim() ? Number(String(value).replace(/,/g, '')) : null })) }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '공통 매입단가 저장에 실패했습니다.');
      setSharedRows(Array.isArray(result.rows) ? result.rows : []);
      setSharedDrafts({});
      setMessage(`${result.changedCells ?? entries.length}개 라움·초이문 공통 단가를 저장했습니다.`);
    } catch (cause) { setSharedState(current => ({ ...current, error: messageOf(cause, '공통 매입단가 저장에 실패했습니다.') })); } finally { setSharedSaving(false); }
  };

  const saveShilla = async () => {
    const entries = Object.values(shillaDrafts);
    if (!entries.length || busy) return;
    if (invalidEntries(entries)) { setShillaState(current => ({ ...current, error: '신라 매입단가는 0 이상의 숫자만 입력할 수 있습니다.' })); return; }
    if (entries.some(entry => !String(entry.value ?? '').trim()) && !window.confirm('빈칸으로 저장한 품목은 해당 차수 손익 합계에서 제외됩니다. 계속할까요?')) return;
    setShillaSaving(true); setShillaState(current => ({ ...current, error: '' })); setMessage('');
    try {
      const response = await fetch('/api/raum/shilla-purchase-costs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderYear, updates: entries.map(({ cell, value }) => ({ pnlKey: cell.pnlKey, major: cell.major, identity: cell.identity, expected: cell.snapshot, costPrice: String(value ?? '').trim() ? Number(String(value).replace(/,/g, '')) : null })) }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '신라 매입단가 저장에 실패했습니다.');
      setShillaRows(Array.isArray(result.shillaRows) ? result.shillaRows : (Array.isArray(result.rows) ? result.rows : []));
      setShillaDrafts({});
      setMessage(`${result.changedCells ?? entries.length}개 신라 별도 단가를 저장했습니다.`);
    } catch (cause) { setShillaState(current => ({ ...current, error: messageOf(cause, '신라 매입단가 저장에 실패했습니다.') })); } finally { setShillaSaving(false); }
  };

  const attentionCount = stateCounts.missing + stateCounts.mismatch + stateCounts.partial;
  const selectedYears = [...new Set([orderYear, ...years].filter(Boolean))].sort((a, b) => Number(b) - Number(a));
  const matrixConflicts = Array.isArray(matrix.conflicts) ? matrix.conflicts : [];
  const noRows = !sharedState.loading && !shillaState.loading && !sharedState.error && !shillaState.error && !matrix.items.length;
  return <div style={{ padding: 8, color: '#1e293b', fontFamily: 'Malgun Gothic, sans-serif', fontSize: 12 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginBottom: 6 }}>
      <h1 style={{ fontSize: 17, margin: '0 10px 0 0' }}>라움·초이문 공통 + 신라 별도 매입단가</h1>
      <button type="button" style={btn} disabled={busy} onClick={() => changeYear(Number(orderYear) - 1)}>◀</button>
      <select value={orderYear} disabled={busy} onChange={event => changeYear(event.target.value)} style={{ height: 28, border, borderRadius: 4, minWidth: 84 }} aria-label="조회 연도">{selectedYears.map(year => <option key={year} value={year}>{year}년</option>)}</select>
      <button type="button" style={btn} disabled={busy} onClick={() => changeYear(Number(orderYear) + 1)}>▶</button>
      <input value={search} disabled={busy} onChange={event => setSearch(event.target.value)} placeholder="품목명·전산품목 검색" style={{ height: 28, width: 220, boxSizing: 'border-box', border, borderRadius: 4, padding: '0 7px' }} />
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><input type="checkbox" disabled={busy} checked={attentionOnly} onChange={event => setAttentionOnly(event.target.checked)} /> 공통 미입력·확인필요만</label>
      <button type="button" style={btn} disabled={busy || dirtyCount > 0} onClick={load}>↻ 새로고침</button>
      <button type="button" style={{ ...primary, marginLeft: 'auto', opacity: sharedDirtyCount && !busy ? 1 : .55 }} onClick={saveShared} disabled={!sharedDirtyCount || busy}>{sharedSaving ? '저장 중…' : `공통 저장 (${sharedDirtyCount})`}</button>
      <button type="button" style={{ ...shillaPrimary, opacity: shillaDirtyCount && !busy ? 1 : .55 }} onClick={saveShilla} disabled={!shillaDirtyCount || busy}>{shillaSaving ? '저장 중…' : `신라 별도 저장 (${shillaDirtyCount})`}</button>
    </div>
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', minHeight: 26, padding: '4px 7px', marginBottom: 6, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 4 }}>
      <b>{orderYear}년 · {PNL_PARTNERS.raum.label}+{PNL_PARTNERS.choimun.label} 공통 / 신라호텔 별도</b><span>대차수 {matrix.weeks.length}개</span><span>품목 {matrix.items.length}개</span>
      <span style={{ color: attentionCount ? '#b91c1c' : '#166534' }}>공통 확인 필요 {attentionCount}칸</span>
      <span style={{ color: '#475569' }}>같은 전산 품목·단위는 한 행에서 비교합니다. 판매가·수량·매입액·매출액과 저장은 거래처별로 분리됩니다.</span>
      <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}><a href={`/raum/pnl?partner=raum&year=${encodeURIComponent(orderYear)}`} style={{ color: '#1d4ed8', fontWeight: 700 }}>← 라움</a><a href={`/raum/pnl?partner=choimun&year=${encodeURIComponent(orderYear)}`} style={{ color: '#1d4ed8', fontWeight: 700 }}>← 초이문</a><a href={`/raum/pnl?partner=shilla&year=${encodeURIComponent(orderYear)}`} style={{ color: '#0f766e', fontWeight: 700 }}>← 신라</a></span>
    </div>
    {sharedState.error ? <div role="alert" style={{ padding: '6px 8px', marginBottom: 5, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 4 }}>라움·초이문 조회/저장 실패: {sharedState.error}</div> : null}
    {shillaState.error ? <div role="alert" style={{ padding: '6px 8px', marginBottom: 5, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 4 }}>신라 조회/저장 실패: {shillaState.error}</div> : null}
    {matrixConflicts.length ? <div role="alert" style={{ padding: '6px 8px', marginBottom: 5, background: '#fff7ed', border: '1px solid #fdba74', color: '#9a3412', borderRadius: 4 }}>신라 중복 차수는 안전하게 제외되어 저장할 수 없습니다. {matrixConflicts.join(' · ')}</div> : null}
    {message ? <div style={{ padding: '6px 8px', marginBottom: 6, background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534', borderRadius: 4 }}>{message}</div> : null}
    <div style={{ border, overflowY: 'auto', overflowX: 'auto', maxHeight: 'calc(100vh - 174px)', background: '#fff' }}>
      <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 5, background: '#dbeafe', borderBottom: border, fontWeight: 700, fontSize: 12 }}><div style={{ width: 210, flex: '0 0 210px', padding: '5px 6px', borderRight: border }}>품목</div><div style={{ width: 160, flex: '0 0 160px', padding: '5px 6px', borderRight: border }}>전산 품목</div><div style={{ width: 46, flex: '0 0 46px', padding: '5px 4px', textAlign: 'center', borderRight: border }}>단위</div><div style={{ flex: '1 1 auto', padding: '5px 6px', color: '#334155' }}>차수별 공통·신라 별도 매입단가</div></div>
      {noRows ? <div style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>저장된 손익 품목이 없습니다.</div> : null}
      {filteredItems.map((item, index) => {
        const hasDifferentShillaName = item.shillaName && String(item.shillaName).trim() !== String(item.name).trim();
        return <div key={item.identity} style={{ display: 'flex', minWidth: 800, alignItems: 'stretch', background: index % 2 ? '#f8fafc' : '#fff', borderBottom: border }}><div style={{ width: 210, flex: '0 0 210px', padding: '4px 6px', borderRight: border, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', alignSelf: 'center' }} title={hasDifferentShillaName ? `${item.name} / 신라 원본: ${item.shillaName}` : item.name}>{item.name}{hasDifferentShillaName ? <><br /><span style={{ color: '#0f766e', fontSize: 10 }}>신라 원본: {item.shillaName}</span></> : null}{item.isCustom ? <span style={{ color: '#92400e' }}> · 수동</span> : null}</div><div style={{ width: 160, flex: '0 0 160px', padding: '4px 6px', borderRight: border, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', alignSelf: 'center' }} title={item.prodName || '전산 미연결'}>{item.prodName || <span style={{ color: '#64748b' }}>미연결</span>}{item.prodKey ? <span style={{ color: '#94a3b8' }}> #{item.prodKey}</span> : null}</div><div style={{ width: 46, flex: '0 0 46px', padding: '4px', textAlign: 'center', borderRight: border, alignSelf: 'center' }}>{item.unit || '—'}</div><div style={{ flex: '1 1 auto', display: 'flex', flexWrap: 'wrap', gap: 4, padding: 4 }}>{item.cells.filter(Boolean).map(cell => { const shillaConflict = matrixConflicts.some(conflict => String(conflict).includes(`${cell.major}차`)); return <CombinedPurchaseCostCell key={cell.key} item={item} cell={cell} sharedDraft={cell.shared ? sharedDrafts[cell.shared.key] : null} shillaDraft={cell.shilla ? shillaDrafts[cell.shilla.key] : null} onSharedChange={updateSharedDraft} onShillaChange={updateShillaDraft} disabled={busy} sharedUnavailable={!!sharedState.error} shillaUnavailable={!!shillaState.error || shillaConflict} shillaUnavailableMessage={shillaConflict ? '신라 차수 충돌' : undefined} />; })}</div></div>;
      })}
    </div>
    {sharedState.loading || shillaState.loading ? <div style={{ position: 'fixed', right: 14, bottom: 12, padding: '6px 10px', background: '#1e293b', color: '#fff', borderRadius: 4 }}>불러오는 중…</div> : null}
  </div>;
}
