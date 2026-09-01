import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { PNL_PARTNERS, resolvePnlPartner } from '../../lib/raumPnlPartner';
import { buildRaumPnlPurchaseCostMatrix } from '../../lib/raumPnlCostComparison';

const border = '1px solid #cbd5e1';
const btn = { height: 28, padding: '0 9px', border, borderRadius: 4, background: '#fff', color: '#1e293b', cursor: 'pointer', fontSize: 12 };
const primary = { ...btn, background: '#1d4ed8', borderColor: '#1d4ed8', color: '#fff', fontWeight: 700 };

function fmt(value) {
  if (value == null || value === '') return '—';
  return Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
}

function sameDraftValue(raw, values) {
  const text = String(raw ?? '').trim();
  if (values.length > 1) return false;
  if (!text) return values.length === 0;
  const number = Number(text.replace(/,/g, ''));
  return Number.isFinite(number) && values.length === 1 && number === Number(values[0]);
}

export default function RaumPurchaseCostsPage() {
  const router = useRouter();
  const requestSeq = useRef(0);
  const [ready, setReady] = useState(false);
  const [partnerCode, setPartnerCode] = useState('raum');
  const [orderYear, setOrderYear] = useState('');
  const [rows, setRows] = useState([]);
  const [years, setYears] = useState([]);
  const [search, setSearch] = useState('');
  const [missingOnly, setMissingOnly] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!router.isReady || ready) return;
    let partner = 'raum';
    try { partner = resolvePnlPartner(router.query.partner).code; } catch { /* 기본 라움 */ }
    const queryYear = String(router.query.year || '').trim();
    setPartnerCode(partner);
    setOrderYear(/^\d{4}$/.test(queryYear) ? queryYear : String(new Date().getFullYear()));
    setReady(true);
  }, [router.isReady, router.query.partner, router.query.year, ready]);

  const load = useCallback(async () => {
    if (!ready || !/^\d{4}$/.test(orderYear)) return;
    const sequence = ++requestSeq.current;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/raum/purchase-costs?partner=${encodeURIComponent(partnerCode)}&year=${encodeURIComponent(orderYear)}`);
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '매입단가를 불러오지 못했습니다.');
      if (sequence !== requestSeq.current) return;
      setRows(Array.isArray(result.rows) ? result.rows : []);
      setYears(Array.isArray(result.years) ? result.years : []);
      setDrafts({});
      setMessage('');
    } catch (e) {
      if (sequence !== requestSeq.current) return;
      setRows([]);
      setError(e.message || '매입단가를 불러오지 못했습니다.');
    } finally {
      if (sequence === requestSeq.current) setLoading(false);
    }
  }, [ready, orderYear, partnerCode]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const onBeforeUnload = event => {
      if (!Object.keys(drafts).length) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [drafts]);

  const partner = resolvePnlPartner(partnerCode);
  const matrix = useMemo(() => buildRaumPnlPurchaseCostMatrix(rows, { orderYear, partnerCode }), [rows, orderYear, partnerCode]);
  const filteredItems = useMemo(() => {
    const q = search.replace(/\s+/g, '').toLowerCase();
    return matrix.items.filter(item => {
      if (q && !`${item.name}${item.prodName}${item.prodKey || ''}`.replace(/\s+/g, '').toLowerCase().includes(q)) return false;
      if (missingOnly && !item.cells.some(cell => cell && cell.values.length === 0)) return false;
      return true;
    });
  }, [matrix.items, search, missingOnly]);
  const missingCount = useMemo(() => matrix.items.reduce((sum, item) => sum + item.cells.filter(cell => cell && cell.values.length === 0).length, 0), [matrix.items]);
  const dirtyCount = Object.keys(drafts).length;

  const changeScope = (nextPartner, nextYear) => {
    if (dirtyCount && !window.confirm('저장하지 않은 단가 변경이 있습니다. 버리고 조회 조건을 바꿀까요?')) return;
    setPartnerCode(resolvePnlPartner(nextPartner).code);
    setOrderYear(String(nextYear));
    setDrafts({});
    setError('');
    setMessage('');
    router.replace({ pathname: router.pathname, query: { partner: nextPartner, year: String(nextYear) } }, undefined, { shallow: true });
  };

  const updateDraft = (cell, raw) => {
    setDrafts(current => {
      const next = { ...current };
      if (sameDraftValue(raw, cell.values)) delete next[cell.key];
      else next[cell.key] = { cell, value: raw };
      return next;
    });
    setMessage('');
  };

  const save = async () => {
    const entries = Object.values(drafts);
    if (!entries.length) return;
    const invalid = entries.find(entry => {
      const text = String(entry.value ?? '').trim();
      if (!text) return false;
      const number = Number(text.replace(/,/g, ''));
      return !Number.isFinite(number) || number < 0;
    });
    if (invalid) {
      setError('매입단가는 0 이상의 숫자만 입력할 수 있습니다.');
      return;
    }
    if (entries.some(entry => !String(entry.value ?? '').trim()) &&
        !window.confirm('빈칸으로 저장한 품목은 해당 차수 손익 합계에서 제외됩니다. 계속할까요?')) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/raum/purchase-costs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partnerCode,
          orderYear,
          updates: entries.map(({ cell, value }) => ({
            pnlKey: cell.pnlKey,
            major: cell.major,
            identity: cell.identity,
            expected: cell.snapshot,
            costPrice: String(value ?? '').trim() ? Number(String(value).replace(/,/g, '')) : null,
          })),
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '매입단가 저장에 실패했습니다.');
      setRows(Array.isArray(result.rows) ? result.rows : []);
      setDrafts({});
      setMessage(`${result.changedCells}개 단가를 저장했습니다. 해당 차수의 매입액·이익도 새 단가로 계산됩니다.`);
    } catch (e) {
      setError(e.message || '매입단가 저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: 8, color: '#1e293b', fontFamily: 'Malgun Gothic, sans-serif', fontSize: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginBottom: 6 }}>
        <h1 style={{ fontSize: 17, margin: '0 10px 0 0' }}>차수별 매입단가</h1>
        {Object.values(PNL_PARTNERS).map(item => (
          <button key={item.code} type="button" onClick={() => changeScope(item.code, orderYear)} style={{ ...btn, background: partnerCode === item.code ? '#1d4ed8' : '#fff', color: partnerCode === item.code ? '#fff' : '#1e293b', fontWeight: 700 }}>{item.label}</button>
        ))}
        <button type="button" style={btn} onClick={() => changeScope(partnerCode, Number(orderYear) - 1)}>◀</button>
        <select value={orderYear} onChange={event => changeScope(partnerCode, event.target.value)} style={{ height: 28, border, borderRadius: 4, minWidth: 84 }} aria-label="조회 연도">
          {[...new Set([orderYear, ...years])].filter(Boolean).sort((a, b) => Number(b) - Number(a)).map(year => <option key={year} value={year}>{year}년</option>)}
        </select>
        <button type="button" style={btn} onClick={() => changeScope(partnerCode, Number(orderYear) + 1)}>▶</button>
        <input value={search} onChange={event => setSearch(event.target.value)} placeholder="품목명·전산품목 검색" style={{ height: 28, width: 220, boxSizing: 'border-box', border, borderRadius: 4, padding: '0 7px' }} />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><input type="checkbox" checked={missingOnly} onChange={event => setMissingOnly(event.target.checked)} /> 미입력만</label>
        <button type="button" style={btn} onClick={load} disabled={loading || saving}>↻ 새로고침</button>
        <button type="button" style={{ ...primary, marginLeft: 'auto', opacity: !dirtyCount || saving ? .55 : 1 }} onClick={save} disabled={!dirtyCount || saving}>{saving ? '저장 중…' : `변경 단가 저장 (${dirtyCount})`}</button>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', minHeight: 26, padding: '4px 7px', marginBottom: 6, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 4 }}>
        <b>{partner.label} · {orderYear}년</b>
        <span>저장 차수 {matrix.weeks.length}개</span><span>품목 {matrix.items.length}개</span><span style={{ color: missingCount ? '#b91c1c' : '#166534' }}>미입력 {missingCount}칸</span>
        <span style={{ color: '#475569' }}>수정값은 선택한 차수 손익에만 반영되며 주문·분배·재고와 다음 차수 자동단가는 바뀌지 않습니다.</span>
        <a href={`/raum/pnl?partner=${encodeURIComponent(partnerCode)}`} style={{ marginLeft: 'auto', color: '#1d4ed8', fontWeight: 700 }}>← 손익계산서</a>
      </div>

      {error ? <div role="alert" style={{ padding: '6px 8px', marginBottom: 6, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 4 }}>{error}</div> : null}
      {message ? <div style={{ padding: '6px 8px', marginBottom: 6, background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534', borderRadius: 4 }}>{message}</div> : null}

      <div style={{ border, overflow: 'auto', maxHeight: 'calc(100vh - 174px)', background: '#fff' }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, minWidth: Math.max(1000, 470 + matrix.weeks.length * 126), width: '100%', tableLayout: 'fixed' }}>
          <thead>
            <tr>
              <th style={{ position: 'sticky', top: 0, left: 0, zIndex: 5, width: 230, padding: '5px 6px', background: '#dbeafe', borderRight: border, borderBottom: border }}>품목</th>
              <th style={{ position: 'sticky', top: 0, left: 230, zIndex: 5, width: 190, padding: '5px 6px', background: '#dbeafe', borderRight: border, borderBottom: border }}>전산 매칭</th>
              <th style={{ position: 'sticky', top: 0, zIndex: 4, width: 50, padding: '5px 4px', background: '#dbeafe', borderRight: border, borderBottom: border }}>단위</th>
              {matrix.weeks.map(week => <th key={week.key} style={{ position: 'sticky', top: 0, zIndex: 4, width: 126, padding: '4px', background: '#e0f2fe', borderRight: border, borderBottom: border }}>{week.label}<div style={{ fontSize: 10, color: '#64748b', fontWeight: 400 }}>매입단가</div></th>)}
            </tr>
          </thead>
          <tbody>
            {!loading && !filteredItems.length ? <tr><td colSpan={3 + matrix.weeks.length} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>저장된 손익 품목이 없습니다.</td></tr> : null}
            {filteredItems.map((item, rowIndex) => (
              <tr key={item.identity} style={{ background: rowIndex % 2 ? '#f8fafc' : '#fff' }}>
                <td style={{ position: 'sticky', left: 0, zIndex: 2, padding: '4px 6px', background: rowIndex % 2 ? '#f8fafc' : '#fff', borderRight: border, borderBottom: border, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.name}>{item.name}{item.isCustom ? <span style={{ color: '#92400e' }}> · 수동</span> : null}</td>
                <td style={{ position: 'sticky', left: 230, zIndex: 2, padding: '4px 6px', background: rowIndex % 2 ? '#f8fafc' : '#fff', borderRight: border, borderBottom: border, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.prodName || '전산 미매칭'}>{item.prodName || <span style={{ color: '#b91c1c' }}>미매칭</span>}{item.prodKey ? <span style={{ color: '#94a3b8' }}> #{item.prodKey}</span> : null}</td>
                <td style={{ padding: '4px', textAlign: 'center', borderRight: border, borderBottom: border }}>{item.unit || '—'}</td>
                {item.cells.map((cell, cellIndex) => {
                  if (!cell) return <td key={matrix.weeks[cellIndex].key} style={{ background: '#f1f5f9', borderRight: border, borderBottom: border, textAlign: 'center', color: '#94a3b8' }}>—</td>;
                  const draft = drafts[cell.key];
                  const value = draft ? draft.value : (cell.values.length === 1 ? String(cell.values[0]) : '');
                  const changed = !!draft;
                  return <td key={cell.key} style={{ padding: 3, background: changed ? '#fef3c7' : cell.values.length ? undefined : '#fff7ed', borderRight: border, borderBottom: border }}>
                    <input
                      value={value}
                      onChange={event => updateDraft(cell, event.target.value)}
                      inputMode="decimal"
                      placeholder={cell.values.length > 1 ? '여러 단가' : '미입력'}
                      aria-label={`${item.name} ${cell.major}차 매입단가`}
                      style={{ width: '100%', height: 24, boxSizing: 'border-box', textAlign: 'right', padding: '0 5px', border: changed ? '1px solid #f59e0b' : '1px solid #93c5fd', borderRadius: 3, color: cell.values.length > 1 && !changed ? '#b45309' : '#1e293b' }}
                    />
                    <div style={{ minHeight: 12, marginTop: 1, textAlign: 'right', fontSize: 9.5, color: cell.values.length > 1 ? '#b45309' : '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={cell.values.length > 1 ? `현재 저장값 ${cell.values.map(fmt).join(' / ')}` : `수량 ${fmt(cell.qty)}`}>
                      {cell.values.length > 1 ? `현재 ${cell.values.map(fmt).join('/')}` : `수량 ${fmt(cell.qty)}`}
                    </div>
                  </td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {loading ? <div style={{ position: 'fixed', right: 14, bottom: 12, padding: '6px 10px', background: '#1e293b', color: '#fff', borderRadius: 4 }}>불러오는 중…</div> : null}
    </div>
  );
}
