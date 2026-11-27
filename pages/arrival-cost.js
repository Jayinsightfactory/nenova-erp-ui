import ArrivalUploadReview from '../components/ArrivalUploadReview';
// 도착원가 — 차수별 원가자료 업로드·매칭·배분기준 관리

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import ArrivalDriveAutoPanel from '../components/ArrivalDriveAutoPanel';
import InvoiceArrivalCostPanel from '../components/import-tools/InvoiceArrivalCostPanel';
import InvoiceWarehouseCostBrowse from '../components/import-tools/InvoiceWarehouseCostBrowse';
import {normalizeWarehouseBrowse} from '../lib/invoiceWarehouseBrowse.js';
import { parseJsonResponse } from '../lib/parseJsonResponse';
import { consumePendingArrivalUploadBridge } from '../lib/arrivalCostUploadBridge.js';
import {
  arrivalVarietyWeightActive,
  arrivalWeightHints,
  buildArrivalThreeTierChips,
  filterArrivalRowsByWeight,
  filterArrivalRowsThreeTier,
  formatFarmCostSummary,
  groupArrivalCostRows,
  normalizeArrivalVarietyTabs,
  normalizeWeekOrder,
  rowCost,
  sectionArrivalCostGroupsByWeek,
  summarizeArrivalFilteredRows,
} from '../lib/arrivalCostView.js';
import { recalcArrivalCostWithFx } from '../lib/arrivalCostFxPreview.js';
import { formatOrderWeekDateRange } from '../lib/orderWeekDate.js';

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
    const controller = new AbortController();
    let live = true;
    if (!open || !String(value || '').trim()) {
      setOptions([]);
      setBusy(false);
      return undefined;
    }
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const encoded = encodeURIComponent(String(value).trim());
        const url = kind === 'product'
          ? `/api/products/search?q=${encoded}`
          : `/api/arrival-cost?lookup=farms&q=${encoded}&limit=30`;
        const res = await fetch(url, { credentials: 'same-origin', signal: controller.signal });
        const json = await parseJsonResponse(res);
        if (!live) return;
        if (res.ok && json.success) setOptions(kind === 'product' ? (json.products || []).slice(0, 30) : (json.farms || []));
        else setOptions([]);
      } catch (_) {
        if (live) setOptions([]);
      } finally {
        if (live) setBusy(false);
      }
    }, 220);
    return () => { live = false; clearTimeout(timer); controller.abort(); };
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
  const receiptScope=useMemo(()=>{try{return normalizeWarehouseBrowse({orderYear:String(appliedFilters.orderYear),orderWeek:appliedFilters.orderWeek});}catch{return null;}},[appliedFilters.orderYear,appliedFilters.orderWeek]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState({});
  const [history, setHistory] = useState(null);
  const [varieties, setVarieties] = useState([]);
  const [scopeReady, setScopeReady] = useState(false);
  const [incomingUpload, setIncomingUpload] = useState(null);
  const uploadSectionRef = useRef(null);
  const requestRef = useRef({ id: 0, controller: null });

  const handleSendToUploadReview = useCallback((payload) => {
    if (!payload?.file) return;
    setIncomingUpload(payload);
    if (payload.orderYear || payload.orderWeek) {
      setFilters(prev => ({
        ...prev,
        orderYear: payload.orderYear || prev.orderYear,
        orderWeek: payload.orderWeek || prev.orderWeek,
      }));
    }
    setTimeout(() => {
      uploadSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  }, []);

  useEffect(() => {
    const pending = consumePendingArrivalUploadBridge();
    if (pending) handleSendToUploadReview(pending);
  }, [handleSendToUploadReview]);

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

  const [weightRuleOn, setWeightRuleOn] = useState(true);
  // 환율 재계산 미리보기 — 화면 표시용, DB에는 저장하지 않는다.
  const [previewFx, setPreviewFx] = useState('');
  const previewFxNum = Number(previewFx);
  const previewFxActive = previewFxNum > 0;
  const farmSummaryCostFn = useCallback((row) => {
    if (previewFxActive) {
      const preview = recalcArrivalCostWithFx(row, previewFxNum);
      if (preview.ok) return preview.cost;
    }
    return rowCost(row);
  }, [previewFxActive, previewFxNum]);
  const [expandedGroups, setExpandedGroups] = useState({});
  const [selectedChipVarieties, setSelectedChipVarieties] = useState([]);
  const [multiChipVariety, setMultiChipVariety] = useState(false);
  const [selectedChipFarms, setSelectedChipFarms] = useState([]);
  const [multiChipFarm, setMultiChipFarm] = useState(false);
  const [selectedChipProducts, setSelectedChipProducts] = useState([]);
  const [multiChipProduct, setMultiChipProduct] = useState(false);
  const [showAllChipProducts, setShowAllChipProducts] = useState(false);
  const [quickChipQuery, setQuickChipQuery] = useState('');
  const [groupLimit, setGroupLimit] = useState(100);

  const cleanVarieties = useMemo(() => normalizeArrivalVarietyTabs(varieties), [varieties]);
  const visibleRows = useMemo(
    () => (weightRuleOn ? filterArrivalRowsByWeight(data.rows || []) : (data.rows || [])),
    [data.rows, weightRuleOn],
  );
  useEffect(() => {
    setSelectedChipVarieties([]);
    setSelectedChipFarms([]);
    setSelectedChipProducts([]);
    setShowAllChipProducts(false);
    setQuickChipQuery('');
    setGroupLimit(100);
  }, [data.rows]);
  useEffect(() => {
    setGroupLimit(100);
  }, [selectedChipVarieties, selectedChipFarms, selectedChipProducts, quickChipQuery, weightRuleOn]);

  const chipVarietySet = useMemo(() => new Set(selectedChipVarieties), [selectedChipVarieties]);
  const chipFarmSet = useMemo(() => new Set(selectedChipFarms), [selectedChipFarms]);
  const chipProductSet = useMemo(() => new Set(selectedChipProducts), [selectedChipProducts]);
  const chipModel = useMemo(
    () => buildArrivalThreeTierChips(visibleRows, { selectedVarieties: selectedChipVarieties, selectedFarms: selectedChipFarms }),
    [visibleRows, selectedChipVarieties, selectedChipFarms],
  );
  const filteredRows = useMemo(
    () => filterArrivalRowsThreeTier(visibleRows, {
      selectedVarieties: selectedChipVarieties,
      selectedFarms: selectedChipFarms,
      selectedProducts: selectedChipProducts,
      quickQuery: quickChipQuery,
    }),
    [visibleRows, selectedChipVarieties, selectedChipFarms, selectedChipProducts, quickChipQuery],
  );
  const hasChipFilter = selectedChipVarieties.length > 0 || selectedChipFarms.length > 0 || selectedChipProducts.length > 0 || quickChipQuery.trim().length > 0;
  const visibleProductButtons = showAllChipProducts || chipModel.productButtons.length <= 24
    ? chipModel.productButtons
    : chipModel.productButtons.slice(0, 24);
  const subtotalSummary = useMemo(
    () => summarizeArrivalFilteredRows(filteredRows, farmSummaryCostFn),
    [filteredRows, farmSummaryCostFn],
  );
  const weeks = useMemo(() => [...new Set(filteredRows.map(row => row.orderWeek).filter(Boolean))], [filteredRows]);
  const unmatched = filteredRows.filter(row => row.matchStatus !== 'MATCHED').length;
  const groups = useMemo(() => groupArrivalCostRows(filteredRows), [filteredRows]);
  const pagedGroups = useMemo(() => groups.slice(0, groupLimit), [groups, groupLimit]);
  const weekSections = useMemo(() => sectionArrivalCostGroupsByWeek(pagedGroups), [pagedGroups]);
  const toggleGroup = (key) => setExpandedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  const weightHints = useMemo(() => arrivalWeightHints(data.rows || []), [data.rows]);
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
    if (!filters.flower) {
      try{const scope=normalizeWarehouseBrowse({orderYear:String(filters.orderYear),orderWeek:filters.orderWeek});setError('');setPage(1);setAppliedFilters({...filters,...scope,allVarieties:'1',weekOrder:normalizeWeekOrder(filters.weekOrder)});}
      catch{setError('연도와 세부차수를 확인하세요. 예: 2026 / 47-02');}
      return;
    }
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
        <section className="purpose-banner" aria-label="핵심 목적">
          <div className="purpose-main">
            <div className="purpose-top-tags">
              <span className="purpose-tag">핵심 목적 · PURPOSE</span>
              <span className="read-only-badge">웹 원장 전용 · ERP 원장 무변경</span>
            </div>
            <h2 data-desktop-chrome>도착원가</h2>
            <p className="purpose-headline">국가별·공동 AWB 운임·통관 실비를 정확히 배부해 품목별 도착원가를 산출하고 미검증 원가의 원장 반영을 차단합니다.</p>
            <p className="purpose-sub">상단 계산기에서 산출한 원가 엑셀은 [도착원가 업로드 검토로 바로 보내기] 또는 [엑셀 업로드]에서 검토·저장하면 아래 도착원가 내역과 입고·운송·매출이익 참고 원가에 반영됩니다(수입부 업무도구 승인 인보이스 원가는 자동 표시). 기존 입고·주문·출고·재고·손익 원장은 변경하지 않습니다.</p>
          </div>
        </section>

        <section className="arrival-card" aria-label="차수 입고자료로 원가 작성">
          <div className="section-title">입고자료로 도착원가 계산</div>
          {receiptScope
            ? <InvoiceWarehouseCostBrowse orderYear={receiptScope.orderYear} orderWeek={receiptScope.orderWeek} country={appliedFilters.country} onSendToUploadReview={handleSendToUploadReview} />
            : <p className="scope-empty-prompt">아래 검색에서 연도·표시 차수(예: 48-01)를 입력하고 조회하면 업로드한 입고를 선택해 국가별·통합·공동 AWB 도착원가를 작성할 수 있습니다. 승인 원가가 없어도 계산본을 작성할 수 있습니다.</p>}
        </section>
        <details className="approved-details"><summary>인보이스 승인 이력·엑셀 다운로드</summary><InvoiceArrivalCostPanel orderYear={appliedFilters.orderYear} orderWeek={appliedFilters.orderWeek} country={appliedFilters.country} /></details>
        <ArrivalDriveAutoPanel />
        <section id="arrival-upload-section" ref={uploadSectionRef} className="arrival-card">
          <div className="section-title">엑셀 업로드</div>
          <ArrivalUploadReview orderYear={filters.orderYear} orderWeek={filters.orderWeek} incomingUpload={incomingUpload} onSaved={json=>{setMessage(json.message);if(json.viewScope){setFilters(json.viewScope);setAppliedFilters(json.viewScope);setPage(1);}else load(page,appliedFilters);}} />
          <div className="hint">같은 연도·차수·국가를 다시 올리면 새 revision이 현재본이 되고, 기존 revision은 이력으로 남습니다.</div>
        </section>

        <section className="arrival-card">
          <div className="section-title">검색</div>
          <div className="filter-grid">
            <label>연도 <input value={filters.orderYear} onChange={e => updateFilter('orderYear', e.target.value)} /></label>
            <label>품목 <input value={filters.product} onChange={e => updateFilter('product', e.target.value)} placeholder="매칭 품목명 (예: 문라이트)" onKeyDown={e => e.key === 'Enter' && applySearch()} /></label>
            <label>농장 <input value={filters.farm} onChange={e => updateFilter('farm', e.target.value)} onKeyDown={e => e.key === 'Enter' && applySearch()} /></label>
            <label>표시 차수 <input value={filters.orderWeek} onChange={e => updateFilter('orderWeek', e.target.value)} placeholder="비우면 전 차수" onKeyDown={e => e.key === 'Enter' && applySearch()} /></label>
            {filters.orderWeek && (
              <span className="muted" title="선택한 차수의 실제 달력 날짜 (수요일 시작~화요일 종료)">
                ({formatOrderWeekDateRange(filters.orderYear, filters.orderWeek) || '차수 형식 확인 필요'})
              </span>
            )}
            <button className="primary" onClick={applySearch} disabled={loading}>{loading ? '조회 중…' : '조회'}</button>
          </div>
          <div className="hint">품목은 붙여넣기 매칭데이터 기준으로 찾습니다. 아래 버튼은 전산 국가·품종(CountryFlower)입니다. 품목명 없이 품종 버튼만 눌러도 조회됩니다. 결과는 차수 → 국가 → 품종 → 품목명 → 농장별 원가 순입니다.</div>
          <div className="variety-tabs" role="tablist" aria-label="국가·품종 선택">
            <button type="button" role="tab" aria-selected={appliedFilters.allVarieties === '1' || (!appliedFilters.flower && !!String(appliedFilters.product || '').trim())} className={appliedFilters.allVarieties === '1' || (!appliedFilters.flower && !!String(appliedFilters.product || '').trim()) ? 'active' : ''} onClick={showAll}>전체보기</button>
            {cleanVarieties.map((name) => {
              const ruleOn = weightRuleOn && arrivalVarietyWeightActive(name, data.rows || []);
              const selected = appliedFilters.flower === name;
              return (
                <button
                  type="button"
                  role="tab"
                  key={name}
                  aria-selected={selected}
                  className={[selected ? 'active' : '', ruleOn ? 'rule-on' : ''].filter(Boolean).join(' ')}
                  onClick={() => selectVariety(name)}
                >{name}{ruleOn ? ' 면 활성화' : ''}</button>
              );
            })}
            {!scopeReady && !String(filters.product || '').trim() && <span className="muted">연도를 선택하면 품종 탭이 나옵니다. 품종만 눌러도 검색됩니다.</span>}
            {String(appliedFilters.product || '').trim() && cleanVarieties.length === 0 && !loading && <span className="muted">검색된 품종이 없습니다.</span>}
          </div>
          <div className="summary-row">
            <span>현재본 {Number(data.total || 0).toLocaleString()}행 · 화면 {filteredRows.length.toLocaleString()}행</span>
            <span>매칭확인 필요 {unmatched.toLocaleString()}행</span>
            <span>차수 {weeks.join(', ') || '-'}</span>
            <label className="weight-rule">
              <input type="checkbox" checked={weightRuleOn} onChange={(e) => setWeightRuleOn(e.target.checked)} />
              특별기준 CW/GW (콜롬비아)
            </label>
            <label className="weight-rule" title="입력한 환율로 각 행 원가를 화면에서만 다시 계산해 보여줍니다 (저장되지 않음)">
              환율 재계산
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                placeholder="예: 1400"
                value={previewFx}
                onChange={(e) => setPreviewFx(e.target.value)}
                style={{ width: 80, marginLeft: 4 }}
              />
              {previewFx !== '' && !previewFxActive && <span className="muted"> 환율을 입력하세요</span>}
            </label>
            <span className="week-sort" role="group" aria-label="차수 정렬">
              <button type="button" className={currentWeekOrder === 'asc' ? 'active' : ''} onClick={() => applyWeekOrder('asc')}>차수 오름차순</button>
              <button type="button" className={currentWeekOrder === 'desc' ? 'active' : ''} onClick={() => applyWeekOrder('desc')}>차수 내림차순</button>
            </span>
            <span>페이지 {page} / {Math.max(1, Math.ceil(Number(data.total || 0) / Number(data.pageSize || 200)))}</span>
          </div>
          {weightRuleOn && weightHints.length > 0 && (
            <div className="hint">{weightHints.join(' · ')}. 활성화된 품종만 목록에 나옵니다. 다른 국가는 그대로입니다.</div>
          )}
          <div className="hint">승인된 인보이스 원가를 자동 표시합니다. 입고수량이 단이면 단 원가를 표시합니다. 같은 연도·차수·품목·농장·단위의 기존 엑셀 원가는 상세에서 비교하며 합산하지 않습니다. 인보이스 원가 수정은 수입부 업무도구에서 재승인하세요.</div>
        </section>

        {message && <div className="notice success">{message}</div>}
        {error && <div className="notice error">{error}</div>}
        {(data.warnings || []).map(warning => <div className="notice error" key={warning}>{warning}</div>)}

        <section className="arrival-card table-card">
          <div className="section-title">도착원가 내역 <span className="muted">(현재 revision)</span></div>
          {!loading && visibleRows.length > 0 && (
            <div className="three-tier-bar" aria-label="품종·농장·품목 원클릭 필터">
              <div className="tier-row" role="toolbar" aria-label="품종별 버튼 필터">
                <span className="tier-label">품종별</span>
                <div className="tier-chips">
                  <button
                    type="button"
                    className={selectedChipVarieties.length === 0 ? 'chip active' : 'chip'}
                    aria-pressed={selectedChipVarieties.length === 0}
                    onClick={() => { setSelectedChipVarieties([]); setSelectedChipFarms([]); setSelectedChipProducts([]); }}
                  >
                    전체 품종 ({visibleRows.length})
                  </button>
                  {chipModel.varietyButtons.map(item => {
                    const active = chipVarietySet.has(item.label);
                    return (
                      <button
                        key={item.label}
                        type="button"
                        className={active ? 'chip active' : 'chip'}
                        aria-pressed={active}
                        onClick={e => {
                          const additive = multiChipVariety || e.metaKey || e.ctrlKey || e.shiftKey;
                          setSelectedChipFarms([]);
                          setSelectedChipProducts([]);
                          setSelectedChipVarieties(prev => {
                            if (!additive) return prev.length === 1 && prev[0] === item.label ? [] : [item.label];
                            return prev.includes(item.label) ? prev.filter(x => x !== item.label) : [...prev, item.label];
                          });
                        }}
                      >
                        {item.label} ({item.count})
                      </button>
                    );
                  })}
                </div>
                <div className="tier-tools">
                  <button
                    type="button"
                    className={multiChipVariety ? 'chip-mode on' : 'chip-mode'}
                    aria-pressed={multiChipVariety}
                    onClick={() => setMultiChipVariety(v => !v)}
                  >
                    복수 선택
                  </button>
                </div>
              </div>

              {chipModel.farmButtons.length > 0 && (
                <div className="tier-row" role="toolbar" aria-label="농장별 버튼 필터">
                  <span className="tier-label">농장별</span>
                  <div className="tier-chips">
                    <button
                      type="button"
                      className={selectedChipFarms.length === 0 ? 'chip active' : 'chip'}
                      aria-pressed={selectedChipFarms.length === 0}
                      onClick={() => { setSelectedChipFarms([]); setSelectedChipProducts([]); }}
                    >
                      전체 농장 ({chipModel.farmButtons.length})
                    </button>
                    {chipModel.farmButtons.map(item => {
                      const active = chipFarmSet.has(item.farmName);
                      return (
                        <button
                          key={item.farmName}
                          type="button"
                          className={active ? 'chip active' : 'chip'}
                          aria-pressed={active}
                          onClick={e => {
                            const additive = multiChipFarm || e.metaKey || e.ctrlKey || e.shiftKey;
                            setSelectedChipProducts([]);
                            setSelectedChipFarms(prev => {
                              if (!additive) return prev.length === 1 && prev[0] === item.farmName ? [] : [item.farmName];
                              return prev.includes(item.farmName) ? prev.filter(x => x !== item.farmName) : [...prev, item.farmName];
                            });
                          }}
                        >
                          {item.farmName} ({item.count})
                        </button>
                      );
                    })}
                  </div>
                  <div className="tier-tools">
                    <button
                      type="button"
                      className={multiChipFarm ? 'chip-mode on' : 'chip-mode'}
                      aria-pressed={multiChipFarm}
                      onClick={() => setMultiChipFarm(v => !v)}
                    >
                      복수 농장
                    </button>
                  </div>
                </div>
              )}

              <div className="tier-row" role="toolbar" aria-label="품목별 버튼 필터">
                <span className="tier-label">품목별</span>
                <div className="tier-chips">
                  <button
                    type="button"
                    className={selectedChipProducts.length === 0 ? 'chip active' : 'chip'}
                    aria-pressed={selectedChipProducts.length === 0}
                    onClick={() => setSelectedChipProducts([])}
                  >
                    전체 품목 ({chipModel.productButtons.length})
                  </button>
                  {visibleProductButtons.map(item => {
                    const active = chipProductSet.has(item.productName);
                    return (
                      <button
                        key={item.productName}
                        type="button"
                        className={active ? 'chip active' : 'chip'}
                        aria-pressed={active}
                        onClick={e => {
                          const additive = multiChipProduct || e.metaKey || e.ctrlKey || e.shiftKey;
                          setSelectedChipProducts(prev => {
                            if (!additive) return prev.length === 1 && prev[0] === item.productName ? [] : [item.productName];
                            return prev.includes(item.productName) ? prev.filter(x => x !== item.productName) : [...prev, item.productName];
                          });
                        }}
                      >
                        {item.productName}{item.count > 1 ? ` (${item.count})` : ''}
                      </button>
                    );
                  })}
                  {chipModel.productButtons.length > 24 && (
                    <button
                      type="button"
                      className="chip-mode"
                      onClick={() => setShowAllChipProducts(v => !v)}
                    >
                      {showAllChipProducts ? '품목 접기' : `품목 더보기 (+${chipModel.productButtons.length - 24})`}
                    </button>
                  )}
                </div>
                <div className="tier-tools">
                  <button
                    type="button"
                    className={multiChipProduct ? 'chip-mode on' : 'chip-mode'}
                    aria-pressed={multiChipProduct}
                    onClick={() => setMultiChipProduct(v => !v)}
                  >
                    복수 품목
                  </button>
                  <input
                    type="search"
                    className="tier-search"
                    aria-label="결과 내 품목 또는 농장 즉시 검색"
                    value={quickChipQuery}
                    placeholder="결과 내 품목·농장 즉시 필터"
                    onChange={e => setQuickChipQuery(e.target.value)}
                  />
                  {hasChipFilter && (
                    <button
                      type="button"
                      onClick={() => { setSelectedChipVarieties([]); setSelectedChipFarms([]); setSelectedChipProducts([]); setQuickChipQuery(''); }}
                    >
                      초기화
                    </button>
                  )}
                </div>
              </div>

              <dl className="subtotal-strip" aria-label="선택 조건 실시간 소계">
                <div><dt>선택 품목그룹</dt><dd>{groups.length.toLocaleString('ko-KR')}그룹 ({subtotalSummary.rowCount.toLocaleString('ko-KR')}행)</dd></div>
                <div><dt>입고수량 합계</dt><dd>{subtotalSummary.qtySummary}</dd></div>
                <div><dt>가중평균 원가</dt><dd>{subtotalSummary.avgCostKRW != null ? `${fmt(subtotalSummary.avgCostKRW)}원` : '-'}</dd></div>
                <div className="subtotal-strong"><dt>수량×도착원가 합계</dt><dd>{fmt(subtotalSummary.totalCostKRW)}원</dd></div>
                {subtotalSummary.missingRows > 0 && <div><dt>원가 미업로드</dt><dd>{subtotalSummary.missingRows.toLocaleString('ko-KR')}건</dd></div>}
              </dl>
            </div>
          )}
          {loading ? <div className="empty">조회 중입니다.</div> : data.rows.length === 0 ? <div className="empty">선택 범위에 표시할 품목이 없습니다.</div> : visibleRows.length === 0 ? <div className="empty">지금 활성화된 품종이 아닙니다. 전체보기나 특별기준을 끄면 전체가 보입니다.</div> : filteredRows.length === 0 ? <div className="empty">선택한 품종·농장·품목 버튼 조건에 해당하는 원가 내역이 없습니다. 초기화를 눌러 전체를 확인하세요.</div> : (
            <div className="table-wrap">
              <table>
                <thead><tr>
                  <th>차수</th><th>국가</th><th>품종</th><th>품목</th><th>농장별 원가</th>
                </tr></thead>
                <tbody>{weekSections.flatMap(section => [
                  <tr key={`week-${section.orderWeek || 'none'}`} className="week-head">
                    <td colSpan={5}>
                      차수 {section.orderWeek || '-'}
                      {section.orderWeek && (() => {
                        const range = formatOrderWeekDateRange(appliedFilters.orderYear, section.orderWeek);
                        return range ? ` (${range})` : '';
                      })()}
                    </td>
                  </tr>,
                  ...section.groups.flatMap(group => [
                    <tr key={`${group.key}-head`} className="group-head" onClick={() => toggleGroup(group.key)}>
                      <td>{group.orderWeek || '-'}</td>
                      <td>{group.countryName || '-'}</td>
                      <td>{group.countryFlower || '-'}</td>
                      <td className="raw-name" title={group.productNameRaw}><button type="button" aria-expanded={!!expandedGroups[group.key]} onClick={e => {e.stopPropagation();toggleGroup(group.key);}}>{group.productName || group.productNameRaw}</button>{group.rows.some(row => row.sourceKind === 'INVOICE') && <span className="auto-match"> 인보이스 자동 반영</span>}</td>
                      <td className="farm-costs">{formatFarmCostSummary(group.rows, undefined, farmSummaryCostFn)}</td>
                    </tr>,
                    ...(expandedGroups[group.key] ? group.rows.map(row => {
                      const draft = drafts[row.arrivalLineKey] || {};
                      return <tr key={row.arrivalLineKey} className={row.uploadStatus === 'COST_NOT_UPLOADED' ? 'cost-missing' : row.matchStatus === 'MATCHED' ? 'group-detail' : 'group-detail needs-match'}>
                        <td colSpan={5}>
                          <div className="detail-row">
                            <span className="detail-farm">{row.farmNameRaw || '-'}</span>
                            <span className="num">{fmt(row.quantity, 2)} {row.unit} · {row.uploadStatus === 'COST_NOT_UPLOADED' ? '원가 미업로드' : `${fmt(row.sourceArrivalCostKRW)}원`}</span>
                            {previewFxActive && row.uploadStatus !== 'COST_NOT_UPLOADED' && (() => {
                              const preview = recalcArrivalCostWithFx(row, previewFxNum);
                              return preview.ok
                                ? <span className="num fx-preview" title={`원본 환율 ${fmt(preview.origFx, 2)} → 입력 환율 ${fmt(previewFxNum, 2)}`}>
                                    환율{fmt(previewFxNum, 2)} 적용 시 {fmt(preview.cost)}원
                                  </span>
                                : <span className="muted" title={preview.reason}>재계산 불가</span>;
                            })()}
                            {row.sourceKind === 'INVOICE' ? <>
                              <span>{row.notes}</span><a href="/import/tools">원가 수정·승인 이력</a>
                              {row.legacyComparisons.map(old => <span key={old.ArrivalLineKey} className="muted">기존 엑셀 {fmt(old.SelectedArrivalCostKRW)}원/{old.Unit} · 차이 {fmt(row.selectedArrivalCostKRW - old.SelectedArrivalCostKRW)}원 · {old.SourceFileName}</span>)}
                            </> : <>
                            <LookupInput kind="product" value={draft.prodInput || ''} onInput={value => updateProductInput(row, value)} onSelect={value => selectProduct(row, value)} placeholder="품목 검색·선택" />
                            <LookupInput kind="farm" value={draft.farmInput || ''} onInput={value => updateFarmInput(row, value)} onSelect={value => selectFarm(row, value)} placeholder={row.autoFarmKey && !row.farmKey ? '자동 후보 · 저장 필요' : '농장 검색·선택'} />
                            {row.autoFarmKey && !row.farmKey && <span className="auto-match">자동 후보</span>}
                            {row.uploadStatus === 'COST_NOT_UPLOADED' ? <span className="muted">업로드 필요</span> : <>
                              <button onClick={(e) => { e.stopPropagation(); save(row); }}>저장</button>
                              <button onClick={(e) => { e.stopPropagation(); showHistory(row); }}>이력</button>
                            </>}
                            </>}
                          </div>
                        </td>
                      </tr>;
                    }) : []),
                  ]),
                ])}</tbody>
              </table>
            </div>
          )}
          {groups.length > groupLimit && (
            <div className="more-groups-bar">
              <span>표시 {pagedGroups.length.toLocaleString('ko-KR')} / {groups.length.toLocaleString('ko-KR')}그룹</span>
              <button type="button" onClick={() => setGroupLimit(n => n + 100)}>
                더 보기 (+100건 · 남은 {(groups.length - groupLimit).toLocaleString('ko-KR')}그룹)
              </button>
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
        .arrival-page {
          min-height: 100%;
          padding: 14px 16px 28px;
          background: #f8fafc;
          color: #0f172a;
          font-family: 'Pretendard Variable', 'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', '맑은 고딕', 'Segoe UI', sans-serif;
          font-size: 14px;
          line-height: 1.5;
          font-variant-numeric: tabular-nums;
        }
        .arrival-page :global(button),
        .arrival-page :global(input),
        .arrival-page :global(select),
        .arrival-page :global(textarea),
        .arrival-page :global(table) {
          font-family: 'Pretendard Variable', 'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', '맑은 고딕', 'Segoe UI', sans-serif;
          font-variant-numeric: tabular-nums;
        }
        .purpose-banner {
          background: #ffffff;
          border: 1px solid #cbd5e1;
          border-left: 4px solid #0f172a;
          border-radius: 10px;
          padding: 16px 20px;
          margin-bottom: 12px;
          box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
        }
        .purpose-top-tags {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          flex-wrap: wrap;
          margin-bottom: 8px;
        }
        .purpose-tag {
          display: inline-flex;
          align-items: center;
          height: 24px;
          padding: 0 9px;
          border-radius: 5px;
          background: #f1f5f9;
          border: 1px solid #cbd5e1;
          color: #0f172a;
          font-size: 12.5px;
          font-weight: 800;
          letter-spacing: 0.03em;
        }
        h2 { margin: 0 0 4px; font-size: 20px; font-weight: 800; color: #0f172a; letter-spacing: -0.01em; }
        .purpose-headline { margin: 0 0 4px; font-size: 14.5px; font-weight: 700; color: #0f172a; }
        .purpose-sub { margin: 0; color: #475569; font-size: 13px; }
        .read-only-badge {
          display: inline-flex;
          align-items: center;
          height: 26px;
          padding: 0 10px;
          color: #065f46;
          background: #ecfdf5;
          border: 1px solid #a7f3d0;
          border-radius: 6px;
          font-size: 12.5px;
          font-weight: 700;
          white-space: nowrap;
        }
        .arrival-card {
          background: #ffffff;
          border: 1px solid #cbd5e1;
          border-radius: 10px;
          margin-bottom: 12px;
          padding: 16px 18px;
          box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
        }
        .scope-empty-prompt {
          margin: 4px 0 0;
          padding: 12px 14px;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          background: #f8fafc;
          color: #334155;
          font-size: 13.5px;
        }
        .approved-details {
          background: #ffffff;
          border: 1px solid #cbd5e1;
          border-radius: 10px;
          margin-bottom: 12px;
          padding: 0 16px;
        }
        .approved-details > summary {
          padding: 12px 2px;
          font-size: 14px;
          font-weight: 700;
          color: #0f172a;
          cursor: pointer;
        }
        .section-title { font-weight: 700; font-size: 15px; margin-bottom: 10px; color: #0f172a; }
        .muted, .hint { color: #475569; font-size: 13px; font-weight: 400; }
        .upload-row, .filter-grid { display: flex; flex-wrap: wrap; gap: 10px 14px; align-items: end; }
        label { display: flex; flex-direction: column; align-items: flex-start; gap: 5px; font-size: 13px; font-weight: 600; color: #334155; }
        input, select {
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          background: #ffffff;
          color: #0f172a;
          height: 36px;
          min-height: 36px;
          padding: 0 10px;
          font: inherit;
          font-size: 13.5px;
          font-weight: 500;
        }
        input:focus, select:focus { outline: 2px solid #2563eb; outline-offset: 1px; border-color: #2563eb; }
        .upload-row input[type=file] { min-width: 260px; }
        .filter-grid label input { width: 130px; }
        .filter-grid label:nth-child(2) input { width: 240px; }
        button {
          border: 1px solid #cbd5e1;
          background: #ffffff;
          color: #0f172a;
          border-radius: 6px;
          height: 36px;
          min-height: 36px;
          padding: 0 14px;
          cursor: pointer;
          font: inherit;
          font-size: 13.5px;
          font-weight: 600;
          white-space: nowrap;
        }
        button:hover:not(:disabled) { background: #f8fafc; border-color: #94a3b8; }
        button.primary { background: #0f172a; color: #ffffff; border-color: #0f172a; font-weight: 700; }
        button.primary:hover:not(:disabled) { background: #1e293b; border-color: #1e293b; }
        button:disabled { background: #f1f5f9; border-color: #cbd5e1; color: #94a3b8; cursor: not-allowed; }
        .hint { margin-top: 8px; line-height: 1.5; }
        .summary-row {
          display: flex;
          flex-wrap: wrap;
          gap: 12px 18px;
          margin-top: 12px;
          padding-top: 10px;
          border-top: 1px solid #e2e8f0;
          font-size: 13px;
          color: #334155;
          align-items: center;
        }
        .weight-rule {
          display: inline-flex;
          flex-direction: row;
          align-items: center;
          gap: 7px;
          font-size: 13px;
          font-weight: 600;
          color: #334155;
        }
        .weight-rule input[type="checkbox"] { width: 16px; height: 16px; min-height: 16px; padding: 0; accent-color: #0f172a; }
        .week-sort { display: flex; gap: 6px; }
        .week-sort button { height: 32px; min-height: 32px; padding: 0 11px; font-size: 13px; }
        .week-sort button.active { color: #ffffff; background: #0f172a; border-color: #0f172a; font-weight: 700; }
        .group-head { background: #f8fafc; font-weight: 700; cursor: pointer; }
        .three-tier-bar {
          padding: 12px 18px;
          background: #f8fafc;
          border-top: 1px solid #e2e8f0;
          display: flex;
          flex-direction: column;
          gap: 9px;
        }
        .tier-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .tier-label { min-width: 52px; font-size: 13px; font-weight: 700; color: #334155; }
        .tier-chips { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; flex: 1 1 420px; }
        .tier-chips .chip {
          height: 32px;
          min-height: 32px;
          padding: 0 11px;
          border-radius: 6px;
          font-size: 13.5px;
          font-weight: 600;
          border: 1px solid #cbd5e1;
          background: #ffffff;
          color: #1e293b;
        }
        .tier-chips .chip:hover { background: #f1f5f9; border-color: #94a3b8; }
        .tier-chips .chip.active { background: #0f172a; border-color: #0f172a; color: #ffffff; font-weight: 700; }
        .tier-tools { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-left: auto; }
        .chip-mode {
          height: 32px;
          min-height: 32px;
          padding: 0 10px;
          border-radius: 6px;
          font-size: 13px;
          background: #f1f5f9;
          border: 1px solid #cbd5e1;
          color: #475569;
        }
        .chip-mode.on { background: #334155; border-color: #334155; color: #ffffff; }
        .tier-search { height: 32px; min-height: 32px; width: 200px; font-size: 13.5px; }
        .subtotal-strip {
          margin: 4px 0 0;
          padding-top: 10px;
          border-top: 1px solid #e2e8f0;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
          gap: 8px;
        }
        .subtotal-strip > div {
          padding: 7px 10px;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 6px;
        }
        .subtotal-strip dt { font-size: 12.5px; color: #475569; font-weight: 600; }
        .subtotal-strip dd { margin: 2px 0 0; font-size: 14px; font-weight: 700; color: #0f172a; font-variant-numeric: tabular-nums; }
        .subtotal-strong { border-color: #a7f3d0 !important; background: #ecfdf5 !important; }
        .subtotal-strong dd { color: #065f46; }
        .more-groups-bar {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          padding: 10px 14px;
          border-top: 1px solid #e2e8f0;
          background: #f8fafc;
          font-size: 13.5px;
          color: #334155;
        }
        .group-head:hover td { background: #f1f5f9; }
        .group-head td { border-bottom: 1px solid #cbd5e1; }
        .farm-costs { white-space: normal; max-width: 920px; }
        .week-head td { background: #0f172a; color: #ffffff; font-weight: 700; font-size: 13.5px; padding: 9px 12px; }
        .detail-row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
        .detail-farm { font-weight: 700; min-width: 130px; color: #0f172a; }
        .variety-tabs { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 10px; padding-top: 10px; border-top: 1px solid #e2e8f0; }
        .variety-tabs button { height: 32px; min-height: 32px; padding: 0 12px; border-radius: 999px; font-size: 13px; }
        .variety-tabs button.rule-on { color: #065f46; background: #ecfdf5; border-color: #6ee7b7; font-weight: 700; }
        .variety-tabs button.active { color: #ffffff; background: #0f172a; border-color: #0f172a; font-weight: 700; }
        .notice { padding: 10px 14px; margin: 10px 0; border-radius: 8px; font-size: 13.5px; font-weight: 500; }
        .notice.success { color: #065f46; background: #ecfdf5; border: 1px solid #a7f3d0; }
        .notice.error { color: #991b1b; background: #fef2f2; border: 1px solid #fecaca; }
        .table-card { padding: 0; overflow: hidden; }
        .table-card .section-title { padding: 14px 18px 10px; margin-bottom: 0; }
        .table-wrap { overflow: auto; max-height: min(72vh, max(240px, calc(var(--nv-avail-h, 100vh) - 180px))); border-top: 1px solid #cbd5e1; background: #ffffff; }
        table { border-collapse: separate; border-spacing: 0; width: 100%; min-width: 1040px; font-size: 13.5px; }
        thead th { position: sticky; top: 0; z-index: 3; background: #f8fafc; color: #334155; font-size: 12.5px; font-weight: 700; text-align: left; }
        thead th:nth-child(1), .group-head td:nth-child(1) { position: sticky; left: 0; width: 80px; min-width: 80px; max-width: 80px; }
        thead th:nth-child(2), .group-head td:nth-child(2) { position: sticky; left: 80px; width: 84px; min-width: 84px; max-width: 84px; }
        thead th:nth-child(3), .group-head td:nth-child(3) { position: sticky; left: 164px; width: 122px; min-width: 122px; max-width: 122px; }
        thead th:nth-child(4), .group-head td:nth-child(4) { position: sticky; left: 286px; min-width: 240px; border-right: 1px solid #cbd5e1; }
        thead th:nth-child(-n+4) { z-index: 5; background: #f8fafc; }
        .group-head td:nth-child(-n+4) { z-index: 2; background: #f8fafc; }
        .group-head:hover td:nth-child(-n+4) { background: #f1f5f9; }
        th, td { border-bottom: 1px solid #e2e8f0; padding: 9px 12px; vertical-align: middle; white-space: nowrap; }
        tr.needs-match { background: #fffbeb; }
        tr.cost-missing { background: #fef2f2; }
        .missing-badge { color: #991b1b; background: #fee2e2; border: 1px solid #fca5a5; border-radius: 6px; padding: 2px 8px; font-size: 12.5px; font-weight: 700; }
        td.raw-name { max-width: 300px; overflow: hidden; text-overflow: ellipsis; }
        td.raw-name button { height: 30px; min-height: 30px; padding: 0 10px; font-size: 13px; }
        td input { width: 140px; height: 34px; min-height: 34px; }
        .num { text-align: right; font-variant-numeric: tabular-nums; }
        .selected-cost { color: #065f46; font-weight: 700; }
        .actions { display: flex; gap: 6px; }
        .empty { padding: 32px; text-align: center; color: #64748b; font-size: 14px; }
        .import-list { font-size: 13.5px; line-height: 1.85; color: #334155; }
        .pager { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 12px; border-top: 1px solid #e2e8f0; font-size: 13.5px; }
        .lookup-input { position: relative; display: inline-block; }
        .lookup-input > input { width: 220px; }
        .lookup-menu { position: absolute; top: calc(100% + 2px); left: 0; z-index: 20; width: 360px; max-height: 210px; overflow: auto; background: #ffffff; border: 1px solid #94a3b8; border-radius: 6px; box-shadow: 0 6px 18px rgba(15, 23, 42, 0.12); }
        .lookup-option { display: flex; flex-direction: column; align-items: flex-start; width: 100%; height: auto; border: 0; border-bottom: 1px solid #e2e8f0; border-radius: 0; background: #ffffff; padding: 8px 10px; text-align: left; white-space: normal; }
        .lookup-option:hover { background: #f1f5f9; }
        .lookup-option small { color: #475569; margin-top: 2px; font-size: 12.5px; }
        .lookup-status { padding: 10px; color: #475569; font-size: 13px; }
        .auto-match { display: inline-block; color: #065f46; font-size: 12.5px; font-weight: 600; margin-left: 6px; }
        .modal-backdrop { position: fixed; inset: 0; z-index: 20; display: flex; align-items: center; justify-content: center; background: rgba(15, 23, 42, 0.45); }
        .history-modal { width: min(720px, 92vw); max-height: 80vh; overflow: auto; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 10px; padding: 18px; box-shadow: 0 12px 36px rgba(15, 23, 42, 0.22); }
        .modal-title { display: flex; align-items: center; justify-content: space-between; font-weight: 700; font-size: 16px; margin-bottom: 12px; color: #0f172a; }
        .history-item { padding: 9px 4px; border-bottom: 1px solid #e2e8f0; font-size: 13.5px; color: #334155; }
        @media (max-width: 800px) { .arrival-page { padding: 10px; } .purpose-banner { padding: 14px; } }
      `}</style>
    </>
  );
}
