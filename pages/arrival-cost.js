// 도착원가 — 차수별 원가자료 업로드·매칭·배분기준 관리

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import { parseJsonResponse } from '../lib/parseJsonResponse';
import { formatFarmCostSummary, groupArrivalCostRows, normalizeWeekOrder } from '../lib/arrivalCostView.js';

const BASIS = [
  ['SOURCE', '엑셀 원식'],
  ['WEIGHT', '중량 기준'],
  ['VOLUME', '부피·용적 기준'],
  ['VALUE', 'FOB 금액비례'],
  ['EQUAL', '균등배분'],
];

const fmt = (value, digits = 0) => value == null || value === ''
  ? '-'
  : Number(value).toLocaleString('ko-KR', { maximumFractionDigits: digits });

function basisLabel(value) {
  return BASIS.find(([key]) => key === value)?.[1] || value || '-';
}

function productOptionLabel(product) {
  const country = product.CounName || product.countryName || product.dbCountryName || '';
  const flower = product.FlowerName || product.flowerName || product.dbFlowerName || '';
  const name = product.DisplayName || product.displayName || product.ProdName || product.prodName || '';
  const key = product.ProdKey ?? product.prodKey ?? '';
  return `${country} · ${flower} · ${name}${key ? ` (#${key})` : ''}`.trim();
}

function farmOptionLabel(farm) {
  const name = farm.FarmName || farm.farmName || farm.autoFarmName || '';
  const key = farm.FarmKey ?? farm.farmKey ?? '';
  return `${name}${key ? ` (#${key})` : ''}`.trim();
}

function LookupInput({ kind, value, onInput, onSelect, placeholder }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !String(value || '').trim()) {
      setOptions([]);
      return undefined;
    }
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const encoded = encodeURIComponent(String(value).trim());
        const url = kind === 'product'
          ? `/api/products/search?q=${encoded}`
          : `/api/arrival-cost?lookup=farms&q=${encoded}&limit=30`;
        const res = await fetch(url, { credentials: 'same-origin' });
        const json = await parseJsonResponse(res);
        if (res.ok && json.success) setOptions(kind === 'product' ? (json.products || []).slice(0, 30) : (json.farms || []));
        else setOptions([]);
      } catch (_) {
        setOptions([]);
      } finally {
        setBusy(false);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [kind, open, value]);

  return <div className="lookup-input">
    <input
      value={value || ''}
      onChange={e => { onInput(e.target.value); setOpen(true); }}
      onFocus={() => setOpen(true)}
      onBlur={() => setTimeout(() => setOpen(false), 160)}
      placeholder={placeholder}
      aria-label={placeholder}
    />
    {open && (busy || options.length > 0) && <div className="lookup-menu">
      {busy && <div className="lookup-status">검색 중…</div>}
      {!busy && options.map(item => <button
        type="button"
        className="lookup-option"
        key={item.ProdKey ?? item.FarmKey}
        onMouseDown={e => { e.preventDefault(); onSelect(item); setOpen(false); }}
        title={kind === 'product' ? productOptionLabel(item) : farmOptionLabel(item)}
      >
        {kind === 'product' ? productOptionLabel(item) : farmOptionLabel(item)}
        {kind === 'product' && Number(item.UsageCount || item.orderCount || 0) > 0 && <small>사용 {Number(item.UsageCount || item.orderCount).toLocaleString('ko-KR')}회</small>}
      </button>)}
    </div>}
  </div>;
}

export default function ArrivalCostPage() {
  const [filters, setFilters] = useState({
    orderYear: String(new Date().getFullYear()), orderWeek: '', country: '', flower: '', product: '', farm: '', weekOrder: 'desc',
  });
  const [appliedFilters, setAppliedFilters] = useState({
    orderYear: String(new Date().getFullYear()), orderWeek: '', country: '', flower: '', product: '', farm: '', weekOrder: 'desc',
  });
  const [data, setData] = useState({ rows: [], imports: [], total: 0, page: 1, pageSize: 200, hasMore: false });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState({});
  const [history, setHistory] = useState(null);
  const [varieties, setVarieties] = useState([]);
  const [scopeReady, setScopeReady] = useState(false);
  const requestRef = useRef({ id: 0, controller: null });

  useEffect(() => {
    if (String(filters.product || '').trim()) return undefined;
    if (!filters.orderYear) { setVarieties([]); setScopeReady(false); return undefined; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const qs = new URLSearchParams({ lookup: 'varieties', orderYear: filters.orderYear });
        if (filters.orderWeek) qs.set('orderWeek', filters.orderWeek);
        const res = await fetch(`/api/arrival-cost?${qs}`, { credentials: 'same-origin', signal: controller.signal });
        const json = await parseJsonResponse(res);
        if (!res.ok || !json.success) throw new Error(json.error || '품종 조회 실패');
        setVarieties(json.varieties || []);
        setScopeReady(true);
        if (filters.flower && !(json.varieties || []).includes(filters.flower)) updateFilter('flower', '');
      } catch (e) { if (e.name !== 'AbortError') setError(e.message); }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [filters.orderYear, filters.orderWeek, filters.product]);

  const load = useCallback(async (targetPage = 1, queryFilters = appliedFilters) => {
    if (!queryFilters.orderYear) return;
    const hasProduct = String(queryFilters.product || '').trim();
    const hasFlower = String(queryFilters.flower || '').trim();
    if (!hasProduct && !hasFlower && !(queryFilters.orderWeek && queryFilters.allVarieties)) return;
    requestRef.current.controller?.abort();
    const controller = new AbortController();
    const requestId = requestRef.current.id + 1;
    requestRef.current = { id: requestId, controller };
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams(Object.entries(queryFilters).filter(([, value]) => value !== ''));
      qs.set('page', String(targetPage));
      qs.set('pageSize', '200');
      const res = await fetch(`/api/arrival-cost?${qs}`, { credentials: 'same-origin', signal: controller.signal });
      const json = await parseJsonResponse(res);
      if (!res.ok || !json.success) throw new Error(json.error || '도착원가 조회 실패');
      if (requestRef.current.id !== requestId) return;
      setData(json);
      setPage(Number(json.page || targetPage));
      if (String(queryFilters.product || '').trim()) {
        setVarieties(json.matchedVarieties || []);
        setScopeReady(true);
      }
      const next = {};
      for (const row of json.rows || []) {
        next[row.arrivalLineKey] = {
          prodKey: row.prodKey || '', farmKey: row.farmKey || row.autoFarmKey || '', allocationBasis: row.allocationBasis || 'SOURCE', notes: row.notes || '',
          prodInput: row.prodKey ? productOptionLabel(row) : '',
          farmInput: row.farmKey || row.autoFarmKey ? farmOptionLabel(row) : (row.farmNameRaw || ''),
        };
      }
      setDrafts(next);
    } catch (e) {
      if (e.name !== 'AbortError') setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [appliedFilters]);

  useEffect(() => { load(1, appliedFilters); return () => requestRef.current.controller?.abort(); }, [load, appliedFilters]);

  const updateFilter = (key, value) => setFilters(prev => ({ ...prev, [key]: value }));
  const updateDraft = (id, key, value) => setDrafts(prev => ({ ...prev, [id]: { ...prev[id], [key]: value } }));
  const updateProductInput = (row, value) => {
    setDrafts(prev => ({ ...prev, [row.arrivalLineKey]: { ...prev[row.arrivalLineKey], prodInput: value, prodKey: '' } }));
  };
  const selectProduct = (row, product) => setDrafts(prev => ({
    ...prev,
    [row.arrivalLineKey]: { ...prev[row.arrivalLineKey], prodInput: productOptionLabel(product), prodKey: product.ProdKey },
  }));
  const updateFarmInput = (row, value) => {
    setDrafts(prev => ({ ...prev, [row.arrivalLineKey]: { ...prev[row.arrivalLineKey], farmInput: value, farmKey: '' } }));
  };
  const selectFarm = (row, farm) => {
    setDrafts(prev => ({
      ...prev,
      [row.arrivalLineKey]: { ...prev[row.arrivalLineKey], farmInput: farmOptionLabel(farm), farmKey: farm.FarmKey },
    }));
  };

  const upload = async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const file = formElement.elements.namedItem('file')?.files?.[0];
    if (!file) { setError('업로드할 엑셀 파일을 선택하세요.'); return; }
    setUploading(true); setError(''); setMessage('');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('orderYear', filters.orderYear);
      if (filters.orderWeek) form.append('orderWeek', filters.orderWeek);
      const res = await fetch('/api/arrival-cost/upload', { method: 'POST', body: form, credentials: 'same-origin' });
      const json = await parseJsonResponse(res);
      if (!res.ok || !json.success) throw new Error(json.error || '업로드 실패');
      formElement.reset();
      setMessage(`${json.message} · 매칭 ${json.matchedCount}건 / 수동확인 ${json.unmatchedCount}건`);
      await load(page, appliedFilters);
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  };

  const save = async (row) => {
    const draft = drafts[row.arrivalLineKey] || {};
    setError(''); setMessage('');
    try {
      const res = await fetch('/api/arrival-cost', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ arrivalLineKey: row.arrivalLineKey, prodKey: draft.prodKey || null, farmKey: draft.farmKey || null, allocationBasis: draft.allocationBasis || 'SOURCE', notes: draft.notes || '' }),
      });
      const json = await parseJsonResponse(res);
      if (!res.ok || !json.success) throw new Error(json.error || '저장 실패');
      setMessage(`${row.orderWeek || '차수'} / ${row.productNameRaw} 저장 완료`);
      await load(page, appliedFilters);
    } catch (e) { setError(e.message); }
  };

  const showHistory = async (row) => {
    try {
      const res = await fetch(`/api/arrival-cost/history?arrivalLineKey=${row.arrivalLineKey}`, { credentials: 'same-origin' });
      const json = await parseJsonResponse(res);
      if (!res.ok || !json.success) throw new Error(json.error || '이력 조회 실패');
      setHistory({ row, rows: json.rows || [] });
    } catch (e) { setError(e.message); }
  };

  const weeks = useMemo(() => [...new Set(data.rows.map(row => row.orderWeek).filter(Boolean))], [data.rows]);
  const unmatched = data.rows.filter(row => row.matchStatus !== 'MATCHED').length;
  const groups = useMemo(() => groupArrivalCostRows(data.rows || []), [data.rows]);
  const currentWeekOrder = normalizeWeekOrder(appliedFilters.weekOrder);
  const applySearch = () => {
    if (!filters.orderYear) { setError('연도를 선택하세요.'); return; }
    if (String(filters.product || '').trim()) {
      setError('');
      setPage(1);
      setAppliedFilters({ ...filters, flower: '', allVarieties: '1', weekOrder: normalizeWeekOrder(filters.weekOrder) });
      return;
    }
    if (String(filters.flower || '').trim()) {
      setError('');
      setPage(1);
      setAppliedFilters({ ...filters, allVarieties: '', weekOrder: normalizeWeekOrder(filters.weekOrder) });
      return;
    }
    if (!filters.orderWeek) { setError('품목명으로 검색하거나 품종을 선택하세요. 전체보기는 차수를 입력하세요.'); return; }
    if (!filters.flower) { setError('품종을 선택하거나 전체보기를 누르세요.'); return; }
    setError('');
    setPage(1);
    setAppliedFilters({ ...filters, allVarieties: '', weekOrder: normalizeWeekOrder(filters.weekOrder) });
  };
  const applyWeekOrder = (weekOrder) => {
    const next = { ...appliedFilters, weekOrder: normalizeWeekOrder(weekOrder) };
    setFilters((prev) => ({ ...prev, weekOrder: next.weekOrder }));
    setPage(1);
    setAppliedFilters(next);
  };
  const selectVariety = (flower) => {
    const next = { ...filters, flower };
    setFilters(next);
    setPage(1);
    setAppliedFilters({ ...next, allVarieties: '', weekOrder: normalizeWeekOrder(next.weekOrder) });
  };
  const showAll = () => {
    if (String(filters.product || '').trim()) {
      const next = { ...filters, flower: '' };
      setFilters(next);
      setPage(1);
      setAppliedFilters({ ...next, allVarieties: '1' });
      return;
    }
    if (!filters.orderYear || !filters.orderWeek) { setError('연도와 차수를 모두 선택하세요.'); return; }
    const next = { ...filters, flower: '' };
    setFilters(next); setPage(1); setAppliedFilters({ ...next, allVarieties: '1' });
  };
  const movePage = (nextPage) => {
    if (nextPage < 1 || (nextPage > page && !data.hasMore)) return;
    load(nextPage, appliedFilters);
  };

  return (
    <>
      <Head><title>도착원가 · NENOVA</title></Head>
      <div className="arrival-page">
        <div className="arrival-title-row">
          <div>
            <h2>도착원가</h2>
            <p>차수별 원가자료를 웹 전용 원장으로 관리합니다. 기존 입고·주문·출고·재고·손익 원장에는 자동 반영하지 않습니다.</p>
          </div>
          <span className="read-only-badge">웹 원장 전용</span>
        </div>

        <section className="arrival-card">
          <div className="section-title">엑셀 업로드</div>
          <form className="upload-row" onSubmit={upload}>
            <label>연도 <input value={filters.orderYear} onChange={e => updateFilter('orderYear', e.target.value)} /></label>
            <label>기본 차수 <input placeholder="파일에 차수가 있으면 비워두세요" value={filters.orderWeek} onChange={e => updateFilter('orderWeek', e.target.value)} /></label>
            <input name="file" type="file" accept=".xlsx,.xls" />
            <button className="primary" disabled={uploading}>{uploading ? '업로드 중…' : '엑셀 업로드'}</button>
          </form>
          <div className="hint">같은 연도·차수·국가를 다시 올리면 새 revision이 현재본이 되고, 기존 revision은 이력으로 남습니다.</div>
        </section>

        <section className="arrival-card">
          <div className="section-title">검색</div>
          <div className="filter-grid">
            <label>연도 <input value={filters.orderYear} onChange={e => updateFilter('orderYear', e.target.value)} /></label>
            <label>품목 <input value={filters.product} onChange={e => updateFilter('product', e.target.value)} placeholder="매칭 품목명 (예: 문라이트)" onKeyDown={e => e.key === 'Enter' && applySearch()} /></label>
            <label>농장 <input value={filters.farm} onChange={e => updateFilter('farm', e.target.value)} onKeyDown={e => e.key === 'Enter' && applySearch()} /></label>
            <label>표시 차수 <input value={filters.orderWeek} onChange={e => updateFilter('orderWeek', e.target.value)} placeholder="비우면 전 차수" onKeyDown={e => e.key === 'Enter' && applySearch()} /></label>
            <button className="primary" onClick={applySearch} disabled={loading}>{loading ? '조회 중…' : '조회'}</button>
          </div>
          <div className="hint">품목은 붙여넣기 매칭데이터 기준으로 찾습니다. 아래 버튼은 전산 국가·품종(CountryFlower)입니다. 품목명 없이 품종 버튼만 눌러도 조회됩니다. 결과는 차수 → 국가 → 품종 → 품목명 → 농장별 원가 순입니다.</div>
          <div className="variety-tabs" role="tablist" aria-label="국가·품종 선택">
            <button type="button" role="tab" aria-selected={appliedFilters.allVarieties === '1' || (!appliedFilters.flower && !!String(appliedFilters.product || '').trim())} className={appliedFilters.allVarieties === '1' || (!appliedFilters.flower && !!String(appliedFilters.product || '').trim()) ? 'active' : ''} onClick={showAll}>전체보기</button>
            {varieties.map(name => <button type="button" role="tab" key={name} aria-selected={appliedFilters.flower === name} className={appliedFilters.flower === name ? 'active' : ''} onClick={() => selectVariety(name)}>{name}</button>)}
            {!scopeReady && !String(filters.product || '').trim() && <span className="muted">연도를 선택하면 품종 탭이 나옵니다. 품종만 눌러도 검색됩니다.</span>}
            {String(appliedFilters.product || '').trim() && varieties.length === 0 && !loading && <span className="muted">검색된 품종이 없습니다.</span>}
          </div>
          <div className="summary-row">
            <span>현재본 {Number(data.total || 0).toLocaleString()}행 · 화면 {data.rows.length.toLocaleString()}행</span>
            <span>매칭확인 필요 {unmatched.toLocaleString()}행</span>
            <span>차수 {weeks.join(', ') || '-'}</span>
            <span className="week-sort" role="group" aria-label="차수 정렬">
              <button type="button" className={currentWeekOrder === 'asc' ? 'active' : ''} onClick={() => applyWeekOrder('asc')}>차수 오름차순</button>
              <button type="button" className={currentWeekOrder === 'desc' ? 'active' : ''} onClick={() => applyWeekOrder('desc')}>차수 내림차순</button>
            </span>
            <span>페이지 {page} / {Math.max(1, Math.ceil(Number(data.total || 0) / Number(data.pageSize || 200)))}</span>
          </div>
        </section>

        {message && <div className="notice success">{message}</div>}
        {error && <div className="notice error">{error}</div>}

        <section className="arrival-card table-card">
          <div className="section-title">도착원가 내역 <span className="muted">(현재 revision)</span></div>
          {loading ? <div className="empty">조회 중입니다.</div> : data.rows.length === 0 ? <div className="empty">선택 범위에 표시할 품목이 없습니다.</div> : (
            <div className="table-wrap">
              <table>
                <thead><tr>
                  <th>차수</th><th>국가</th><th>국가·품종</th><th>원본 품목명</th><th>전산 품목 매칭</th><th>원본 농장</th><th>전산 농장 선택</th>
                  <th>입고수량</th><th>원가(엑셀)</th><th>기준</th><th>선택 원가</th><th>메모</th><th>저장</th>
                </tr></thead>
                <tbody>{groups.map(group => [
                  <tr key={`${group.key}-head`} className="group-head">
                    <td>{group.orderWeek || '-'}</td>
                    <td>{group.countryName || '-'}</td>
                    <td>{group.countryFlower || '-'}</td>
                    <td className="raw-name" title={group.productNameRaw}>{group.productNameRaw || group.productName}</td>
                    <td colSpan={9} className="farm-costs">{formatFarmCostSummary(group.rows)}</td>
                  </tr>,
                  ...group.rows.map(row => {
                    const draft = drafts[row.arrivalLineKey] || {};
                    return <tr key={row.arrivalLineKey} className={row.uploadStatus === 'COST_NOT_UPLOADED' ? 'cost-missing' : row.matchStatus === 'MATCHED' ? '' : 'needs-match'}>
                      <td>{row.orderWeek || '-'}</td>
                      <td>{row.countryName || row.dbCountryName || '-'}</td>
                      <td>{row.countryFlower || row.dbFlowerName || row.flowerNameRaw || '-'}</td>
                      <td className="raw-name" title={row.productNameRaw}>{row.productNameRaw}</td>
                      <td><LookupInput kind="product" value={draft.prodInput || ''} onInput={value => updateProductInput(row, value)} onSelect={value => selectProduct(row, value)} placeholder="품목 검색·선택" /></td>
                      <td>{row.farmNameRaw || '-'}</td>
                      <td><LookupInput kind="farm" value={draft.farmInput || ''} onInput={value => updateFarmInput(row, value)} onSelect={value => selectFarm(row, value)} placeholder={row.autoFarmKey && !row.farmKey ? '자동 후보 · 저장 필요' : '농장 검색·선택'} />{row.autoFarmKey && !row.farmKey && <span className="auto-match">자동 후보</span>}</td>
                      <td className="num">{fmt(row.quantity, 2)} {row.unit}</td>
                      <td className="num">{row.uploadStatus === 'COST_NOT_UPLOADED' ? <span className="missing-badge">원가 미업로드</span> : `${fmt(row.sourceArrivalCostKRW, 2)}원`}</td>
                      <td><select value={draft.allocationBasis || 'SOURCE'} onChange={e => updateDraft(row.arrivalLineKey, 'allocationBasis', e.target.value)}>
                        {BASIS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                      </select></td>
                      <td className="num selected-cost">{row.uploadStatus === 'COST_NOT_UPLOADED' ? '-' : `${fmt(row.selectedArrivalCostKRW)}원`}</td>
                      <td><input value={draft.notes || ''} onChange={e => updateDraft(row.arrivalLineKey, 'notes', e.target.value)} placeholder="메모" /></td>
                      <td className="actions">{row.uploadStatus === 'COST_NOT_UPLOADED' ? <span className="muted">업로드 필요</span> : <><button onClick={() => save(row)}>저장</button><button onClick={() => showHistory(row)}>이력</button></>}</td>
                    </tr>;
                  }),
                ])}</tbody>
              </table>
            </div>
          )}
          {data.rows.length > 0 && <div className="pager">
            <button onClick={() => movePage(page - 1)} disabled={loading || page <= 1}>이전</button>
            <span>{page} / {Math.max(1, Math.ceil(Number(data.total || 0) / Number(data.pageSize || 200)))}</span>
            <button onClick={() => movePage(page + 1)} disabled={loading || !data.hasMore}>다음</button>
          </div>}
        </section>

        <section className="arrival-card">
          <div className="section-title">업로드 이력</div>
          <div className="import-list">{data.imports.length === 0 ? <span className="muted">아직 업로드 이력이 없습니다.</span> : data.imports.map(item => <div key={item.ImportKey}><strong>revision {item.RevisionNo}</strong> · {item.UploadFileName} · {item.UploadedAt ? new Date(item.UploadedAt).toLocaleString('ko-KR') : '-'} · {item.UploadedByName || '-'}</div>)}</div>
        </section>
      </div>

      {history && <div className="modal-backdrop" onClick={() => setHistory(null)}><div className="history-modal" onClick={e => e.stopPropagation()}><div className="modal-title">변경 이력 — {history.row.productNameRaw}<button onClick={() => setHistory(null)}>닫기</button></div>{history.rows.length === 0 ? <div className="empty">이력이 없습니다.</div> : history.rows.map(item => <div className="history-item" key={item.HistoryKey}><strong>{item.ActionType}</strong> · {item.ChangedByName || item.ChangedBy} · {item.ChangedAt ? new Date(item.ChangedAt).toLocaleString('ko-KR') : ''}</div>)}</div></div>}

      <style jsx>{`
        .arrival-page { min-height:100%; padding:6px; background:#f4f6f9; color:#172033; }
        .arrival-title-row { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:6px; }
        h2 { margin:0 0 3px; font-size:19px; } p { margin:0; color:#657080; font-size:11px; }
        .read-only-badge { padding:5px 10px; color:#0b5d42; background:#e7f7ef; border:1px solid #b6e6cc; border-radius:4px; font-size:12px; font-weight:700; white-space:nowrap; }
        .arrival-card { background:#fff; border:1px solid #d7dee8; border-radius:6px; margin-bottom:6px; padding:8px; box-shadow:0 1px 2px #13213b0a; }
        .section-title { font-weight:700; font-size:13px; margin-bottom:6px; color:#163d76; } .muted,.hint { color:#7a8797; font-size:11px; font-weight:400; }
        .upload-row,.filter-grid { display:flex; flex-wrap:wrap; gap:8px; align-items:center; } label { display:flex; align-items:center; gap:5px; font-size:12px; } input,select { border:1px solid #b9c4d1; border-radius:3px; background:#fff; min-height:28px; padding:3px 6px; font:inherit; font-size:12px; } input:focus,select:focus { outline:2px solid #b9d9ff; border-color:#4b91dd; }
        .upload-row input[type=file] { min-width:260px; } .filter-grid label input { width:130px; } .filter-grid label:nth-child(2) input { width:230px; }
        button { border:1px solid #aab7c7; background:#f5f7fa; border-radius:3px; padding:5px 9px; cursor:pointer; font:inherit; font-size:12px; } button:hover { background:#eaf2fb; } button.primary { background:#1565c0; color:#fff; border-color:#1565c0; font-weight:700; } button:disabled { opacity:.55; cursor:wait; }
        .hint { margin-top:4px; } .summary-row { display:flex; flex-wrap:wrap; gap:18px; margin-top:6px; font-size:12px; color:#506074; align-items:center; }
        .week-sort { display:flex; gap:5px; } .week-sort button.active { color:#fff; background:#1565c0; border-color:#1565c0; font-weight:700; }
        .group-head { background:#e8eef6; font-weight:700; } .group-head td { border-bottom:1px solid #c5d0de; } .farm-costs { white-space:normal; max-width:720px; }
        .variety-tabs { display:flex; flex-wrap:wrap; gap:5px; align-items:center; margin-top:8px; padding-top:7px; border-top:1px solid #e1e6ed; } .variety-tabs button { border-radius:999px; } .variety-tabs button.active { color:#fff; background:#1565c0; border-color:#1565c0; font-weight:700; }
        .notice { padding:9px 12px; margin:8px 0; border-radius:4px; font-size:12px; } .notice.success { color:#0b5d42; background:#e7f7ef; border:1px solid #b6e6cc; } .notice.error { color:#a12d2d; background:#fff0f0; border:1px solid #f0b7b7; }
        .table-card { padding:0; overflow:hidden; } .table-card .section-title { padding:8px 8px 0; } .table-wrap { overflow:auto; max-height:calc(100vh - 275px); border-top:1px solid #d7dee8; } table { border-collapse:collapse; width:max-content; min-width:1600px; font-size:11px; } th { position:sticky; top:0; z-index:2; background:#edf2f8; color:#32445d; } th,td { border-bottom:1px solid #e1e6ed; padding:6px 7px; vertical-align:middle; white-space:nowrap; } tr.needs-match { background:#fff9e9; } tr.cost-missing { background:#fff0f0; } .missing-badge { color:#a12d2d; background:#ffe0e0; border:1px solid #efb4b4; border-radius:999px; padding:2px 6px; font-weight:700; } td.raw-name { max-width:260px; overflow:hidden; text-overflow:ellipsis; } td input { width:130px; } td:nth-child(5) input,td:nth-child(7) input { width:310px; } .num { text-align:right; font-variant-numeric:tabular-nums; } .selected-cost { color:#0b5d42; font-weight:700; } .actions { display:flex; gap:4px; } .empty { padding:28px; text-align:center; color:#8491a3; font-size:13px; } .import-list { font-size:12px; line-height:1.9; color:#506074; } .pager { display:flex; align-items:center; justify-content:center; gap:12px; padding:8px; border-top:1px solid #d7dee8; } .lookup-input { position:relative; display:inline-block; } .lookup-input > input { width:310px; } .lookup-menu { position:absolute; top:calc(100% + 2px); left:0; z-index:20; width:360px; max-height:190px; overflow:auto; background:#fff; border:1px solid #718096; box-shadow:0 5px 14px #0003; } .lookup-option { display:flex; flex-direction:column; align-items:flex-start; width:100%; border:0; border-bottom:1px solid #e4e8ee; border-radius:0; background:#fff; padding:6px 8px; text-align:left; white-space:normal; } .lookup-option:hover { background:#eaf3ff; } .lookup-option small { color:#657080; margin-top:2px; } .lookup-status { padding:8px; color:#657080; } .auto-match { display:block; color:#0b6e4f; font-size:10px; margin-top:2px; }
        .modal-backdrop { position:fixed; inset:0; z-index:20; display:flex; align-items:center; justify-content:center; background:#0006; } .history-modal { width:min(720px,92vw); max-height:80vh; overflow:auto; background:#fff; border-radius:6px; padding:14px; box-shadow:0 10px 40px #0005; } .modal-title { display:flex; justify-content:space-between; font-weight:700; margin-bottom:10px; color:#163d76; } .history-item { padding:8px 2px; border-bottom:1px solid #e4e8ee; font-size:12px; }
        @media (max-width:800px) { .arrival-page { padding:8px; } .arrival-title-row { display:block; } .read-only-badge { display:inline-block; margin-top:8px; } .table-wrap { max-height:none; } }
      `}</style>
    </>
  );
}
