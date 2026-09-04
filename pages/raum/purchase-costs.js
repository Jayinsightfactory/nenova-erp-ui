import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { PNL_PARTNERS } from '../../lib/raumPnlPartner';
import {
  buildRaumPnlSharedPurchaseCostMatrix,
  isRaumPnlSharedDraftUnchanged,
} from '../../lib/raumPnlCostComparison';

const border = '1px solid #cbd5e1';
const btn = { height: 28, padding: '0 9px', border, borderRadius: 4, background: '#fff', color: '#1e293b', cursor: 'pointer', fontSize: 12 };
const primary = { ...btn, background: '#1d4ed8', borderColor: '#1d4ed8', color: '#fff', fontWeight: 700 };
const STATE_LABEL = { missing: '미입력', mismatch: '단가 다름', partial: '맞추기 필요' };

function fmt(value) {
  if (value == null || value === '') return '—';
  return Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
}

function PartnerCellBlock({ label, detail, draftText, draftInvalid }) {
  if (!detail) {
    return <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 2 }}>{label} 자료 없음</div>;
  }
  const salePriceText = detail.salePrices.length ? detail.salePrices.map(fmt).join('/') : '—';
  const draftNumber = draftText ? Number(draftText.replace(/,/g, '')) : null;
  const displayPurchaseAmount = draftText != null
    ? (draftText && !draftInvalid ? draftNumber * detail.qty : null)
    : detail.purchaseAmount;
  const purchaseAmountLabel = `${fmt(displayPurchaseAmount)}${draftText == null && detail.missingCostRows > 0 && displayPurchaseAmount != null ? ' (일부)' : ''}`;
  const saleAmountLabel = `${fmt(detail.saleAmount)}${detail.missingSaleAmountRows > 0 && detail.saleAmount != null ? ' (일부)' : ''}`;
  return (
    <div
      style={{ marginTop: 2, paddingTop: 2, borderTop: '1px dashed #e2e8f0' }}
      title={`${label} 판매가 ${detail.salePrices.map(fmt).join(' / ') || '—'} · 매입금액 ${purchaseAmountLabel} · 견적서 금액 ${saleAmountLabel} · 수량 ${fmt(detail.qty)}`}
    >
      <div style={{ fontSize: 9, fontWeight: 700, color: '#475569' }}>{label}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 4px', fontSize: 9, color: '#64748b', lineHeight: 1.3 }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>판 {salePriceText}</span>
        <span style={{ textAlign: 'right' }}>수 {fmt(detail.qty)}</span>
        <span style={{ color: draftInvalid ? '#b91c1c' : '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>매 {draftInvalid ? '확인' : purchaseAmountLabel}</span>
        <span style={{ textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>견 {saleAmountLabel}</span>
      </div>
    </div>
  );
}

// 차수 셀 하나 — 실제 데이터가 있는 차수만 최신순으로 붙여 보여주는 압축형 칸.
function WeekCostChip({ item, cell, draft, onChange }) {
  const value = draft ? draft.value : (cell.state === 'match' || cell.state === 'partial' ? String(cell.singleValue) : '');
  const changed = !!draft;
  const draftText = draft ? String(draft.value ?? '').trim() : '';
  const draftNumber = draftText ? Number(draftText.replace(/,/g, '')) : null;
  const draftInvalid = !!draft && !!draftText && (!Number.isFinite(draftNumber) || draftNumber < 0);
  const cellBg = changed ? '#fef3c7' : cell.state === 'mismatch' ? '#fff7ed' : cell.state === 'partial' ? '#fefce8' : cell.state === 'missing' ? '#fff7ed' : '#fff';
  const inputBorder = draftInvalid ? '1px solid #dc2626' : changed ? '1px solid #f59e0b' : cell.state === 'mismatch' ? '1px solid #f97316' : cell.state === 'partial' ? '1px solid #eab308' : '1px solid #93c5fd';
  return (
    <div style={{ width: 152, flex: '0 0 152px', padding: 4, background: cellBg, border, borderRadius: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
        <b style={{ fontSize: 11, color: '#1d4ed8' }}>{cell.major}차</b>
        {cell.state !== 'match' ? <span style={{ fontSize: 9, fontWeight: 700, color: cell.state === 'mismatch' ? '#c2410c' : '#a16207' }}>{STATE_LABEL[cell.state]}</span> : null}
      </div>
      <input
        value={value}
        onChange={event => onChange(cell, event.target.value)}
        inputMode="decimal"
        placeholder={cell.state === 'mismatch' ? '단가 다름' : cell.state === 'missing' ? '미입력' : ''}
        aria-label={`${item.name} ${cell.major}차 공통 매입단가`}
        style={{ width: '100%', height: 22, boxSizing: 'border-box', textAlign: 'right', padding: '0 5px', border: inputBorder, borderRadius: 3, color: draftInvalid ? '#b91c1c' : cell.state === 'mismatch' ? '#c2410c' : '#1e293b' }}
      />
      {cell.state === 'partial' && !changed ? (
        <button
          type="button"
          onClick={() => onChange(cell, String(cell.singleValue))}
          style={{ marginTop: 1, fontSize: 9, height: 14, lineHeight: '12px', padding: '0 4px', border: '1px solid #a16207', borderRadius: 3, background: '#fff', color: '#a16207', cursor: 'pointer' }}
        >동일 적용</button>
      ) : null}
      <PartnerCellBlock label="라움" detail={cell.partners.raum} draftText={changed ? draftText : null} draftInvalid={draftInvalid} />
      <PartnerCellBlock label="초이문" detail={cell.partners.choimun} draftText={changed ? draftText : null} draftInvalid={draftInvalid} />
    </div>
  );
}

export default function RaumPurchaseCostsPage() {
  const router = useRouter();
  const requestSeq = useRef(0);
  const [ready, setReady] = useState(false);
  const [orderYear, setOrderYear] = useState('');
  const [rows, setRows] = useState([]);
  const [years, setYears] = useState([]);
  const [search, setSearch] = useState('');
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!router.isReady || ready) return;
    const queryYear = String(router.query.year || '').trim();
    setOrderYear(/^\d{4}$/.test(queryYear) ? queryYear : String(new Date().getFullYear()));
    setReady(true);
  }, [router.isReady, router.query.year, ready]);

  const load = useCallback(async () => {
    if (!ready || !/^\d{4}$/.test(orderYear)) return;
    const sequence = ++requestSeq.current;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/raum/purchase-costs?year=${encodeURIComponent(orderYear)}`);
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
  }, [ready, orderYear]);

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

  const matrix = useMemo(() => buildRaumPnlSharedPurchaseCostMatrix(rows, { orderYear }), [rows, orderYear]);
  const filteredItems = useMemo(() => {
    const q = search.replace(/\s+/g, '').toLowerCase();
    return matrix.items.filter(item => {
      if (q && !`${item.name}${item.prodName}${item.prodKey || ''}`.replace(/\s+/g, '').toLowerCase().includes(q)) return false;
      if (attentionOnly && !item.cells.some(cell => cell && cell.state !== 'match')) return false;
      return true;
    });
  }, [matrix.items, search, attentionOnly]);
  const stateCounts = useMemo(() => {
    const counts = { missing: 0, mismatch: 0, partial: 0 };
    for (const item of matrix.items) {
      for (const cell of item.cells) {
        if (cell && Object.prototype.hasOwnProperty.call(counts, cell.state)) counts[cell.state] += 1;
      }
    }
    return counts;
  }, [matrix.items]);
  const attentionCount = stateCounts.missing + stateCounts.mismatch + stateCounts.partial;
  const dirtyCount = Object.keys(drafts).length;

  const changeYear = nextYear => {
    if (dirtyCount && !window.confirm('저장하지 않은 단가 변경이 있습니다. 버리고 조회 연도를 바꿀까요?')) return;
    setOrderYear(String(nextYear));
    setDrafts({});
    setError('');
    setMessage('');
    router.replace({ pathname: router.pathname, query: { year: String(nextYear) } }, undefined, { shallow: true });
  };

  const updateDraft = (cell, raw) => {
    setDrafts(current => {
      const next = { ...current };
      if (isRaumPnlSharedDraftUnchanged(raw, cell)) delete next[cell.key];
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
          orderYear,
          updates: entries.map(({ cell, value }) => ({
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
      setMessage(`${result.changedCells}개 단가를 저장했습니다. 라움·초이문의 해당 차수 매입액·이익도 새 단가로 계산됩니다.`);
    } catch (e) {
      setError(e.message || '매입단가 저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: 8, color: '#1e293b', fontFamily: 'Malgun Gothic, sans-serif', fontSize: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginBottom: 6 }}>
        <h1 style={{ fontSize: 17, margin: '0 10px 0 0' }}>라움·초이문 공통 매입단가</h1>
        <button type="button" style={btn} onClick={() => changeYear(Number(orderYear) - 1)}>◀</button>
        <select value={orderYear} onChange={event => changeYear(event.target.value)} style={{ height: 28, border, borderRadius: 4, minWidth: 84 }} aria-label="조회 연도">
          {[...new Set([orderYear, ...years])].filter(Boolean).sort((a, b) => Number(b) - Number(a)).map(year => <option key={year} value={year}>{year}년</option>)}
        </select>
        <button type="button" style={btn} onClick={() => changeYear(Number(orderYear) + 1)}>▶</button>
        <input value={search} onChange={event => setSearch(event.target.value)} placeholder="품목명·전산품목 검색" style={{ height: 28, width: 220, boxSizing: 'border-box', border, borderRadius: 4, padding: '0 7px' }} />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><input type="checkbox" checked={attentionOnly} onChange={event => setAttentionOnly(event.target.checked)} /> 미입력·확인필요만</label>
        <button type="button" style={btn} onClick={load} disabled={loading || saving}>↻ 새로고침</button>
        <button type="button" style={{ ...primary, marginLeft: 'auto', opacity: !dirtyCount || saving ? .55 : 1 }} onClick={save} disabled={!dirtyCount || saving}>{saving ? '저장 중…' : `변경 단가 저장 (${dirtyCount})`}</button>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', minHeight: 26, padding: '4px 7px', marginBottom: 6, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 4 }}>
        <b>{orderYear}년 · {PNL_PARTNERS.raum.label}+{PNL_PARTNERS.choimun.label} 공통 매입단가</b>
        <span>대차수 {matrix.weeks.length}개</span><span>품목 {matrix.items.length}개</span>
        <span style={{ color: attentionCount ? '#b91c1c' : '#166534' }}>확인 필요 {attentionCount}칸 (미입력 {stateCounts.missing} · 단가 다름 {stateCounts.mismatch} · 맞추기 필요 {stateCounts.partial})</span>
        <span style={{ color: '#475569' }}>매입단가는 라움·초이문 공통 하나이며, 판매가·수량·매입액·견적액은 거래처별로 따로 보여줍니다. 수정값은 실제 존재하는 행에만 반영되며 주문·분배·재고와 다음 차수 자동단가는 바뀌지 않습니다.</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <a href={`/raum/pnl?partner=raum${orderYear ? `&year=${encodeURIComponent(orderYear)}` : ''}`} style={{ color: '#1d4ed8', fontWeight: 700 }}>← 라움 손익계산서</a>
          <a href={`/raum/pnl?partner=choimun${orderYear ? `&year=${encodeURIComponent(orderYear)}` : ''}`} style={{ color: '#1d4ed8', fontWeight: 700 }}>← 초이문 손익계산서</a>
        </span>
      </div>

      {error ? <div role="alert" style={{ padding: '6px 8px', marginBottom: 6, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 4 }}>{error}</div> : null}
      {message ? <div style={{ padding: '6px 8px', marginBottom: 6, background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534', borderRadius: 4 }}>{message}</div> : null}

      <div style={{ border, overflowY: 'auto', overflowX: 'hidden', maxHeight: 'calc(100vh - 174px)', background: '#fff' }}>
        <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 5, background: '#dbeafe', borderBottom: border, fontWeight: 700, fontSize: 12 }}>
          <div style={{ width: 210, flex: '0 0 210px', padding: '5px 6px', borderRight: border }}>품목</div>
          <div style={{ width: 160, flex: '0 0 160px', padding: '5px 6px', borderRight: border }}>전산 매칭</div>
          <div style={{ width: 46, flex: '0 0 46px', padding: '5px 4px', textAlign: 'center', borderRight: border }}>단위</div>
          <div style={{ flex: '1 1 auto', padding: '5px 6px', fontWeight: 400, color: '#334155' }}>
            차수별 공통 매입단가 — 실제 데이터가 있는 차수만 최신순으로 붙여 표시 (라움/초이문 판매가·수량·매입액·견적액 포함)
          </div>
        </div>
        {!loading && !filteredItems.length ? <div style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>저장된 손익 품목이 없습니다.</div> : null}
        {filteredItems.map((item, rowIndex) => {
          const populatedCells = item.cells.filter(Boolean);
          return (
            <div key={item.identity} style={{ display: 'flex', alignItems: 'stretch', background: rowIndex % 2 ? '#f8fafc' : '#fff', borderBottom: border }}>
              <div style={{ width: 210, flex: '0 0 210px', padding: '4px 6px', borderRight: border, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', alignSelf: 'center' }} title={item.name}>
                {item.name}{item.isCustom ? <span style={{ color: '#92400e' }}> · 수동</span> : null}
              </div>
              <div style={{ width: 160, flex: '0 0 160px', padding: '4px 6px', borderRight: border, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', alignSelf: 'center' }} title={item.prodName || '전산 미매칭'}>
                {item.prodName || <span style={{ color: '#b91c1c' }}>미매칭</span>}{item.prodKey ? <span style={{ color: '#94a3b8' }}> #{item.prodKey}</span> : null}
              </div>
              <div style={{ width: 46, flex: '0 0 46px', padding: '4px', textAlign: 'center', borderRight: border, alignSelf: 'center' }}>{item.unit || '—'}</div>
              <div style={{ flex: '1 1 auto', display: 'flex', flexWrap: 'wrap', gap: 4, padding: 4 }}>
                {populatedCells.length ? populatedCells.map(cell => (
                  <WeekCostChip key={cell.key} item={item} cell={cell} draft={drafts[cell.key]} onChange={updateDraft} />
                )) : <span style={{ fontSize: 11, color: '#94a3b8', alignSelf: 'center' }}>데이터 없음</span>}
              </div>
            </div>
          );
        })}
      </div>
      {loading ? <div style={{ position: 'fixed', right: 14, bottom: 12, padding: '6px 10px', background: '#1e293b', color: '#fff', borderRadius: 4 }}>불러오는 중…</div> : null}
    </div>
  );
}
