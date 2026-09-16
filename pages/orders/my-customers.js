import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiDelete, apiGet, apiPost } from '../../lib/useApi';
import { buildForwardOrderWeeks, compactCustomerProductLabel, productAlphabetInitial, sortMyCustomersFirst, customerOrderDraft, customerOrderApprovalFingerprint } from '../../lib/myCustomerOrderEntry';
import { convertSalesPasteQtyToOutUnit, salesPasteUnitOptions } from '../../lib/salesPasteOrder';
import { MENU_BACK_REQUEST_EVENT } from '../../lib/menuNavigationHistory';

const currentYear = new Date().getFullYear();
const label = p => p.DisplayName || p.ProdName;
const displayLabel = p => compactCustomerProductLabel(p) || label(p);
const groupLabel = p => p.CountryFlower || p.FlowerName || '기타';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const ORDER_FAVORITE_PAGE = 'my-customer-order-template';
const logTime = value => value ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }) : '';
const requestedLabel = mode => mode === 'REPLACE' ? '변경 후' : '입력 환산';
const logStatusLabel = status => ({ 'awaiting-approval':'승인 대기 · 아직 저장하지 않았습니다', working:'주문등록 중', committed:'주문등록 완료', 'committed-reload-failed':'등록 완료 · 재조회 필요', failed:'등록 실패', 'failed-stale-reload-required':'수량 변경 감지 · 재조회 필요', 'unknown-commit-reload-required':'등록 결과 확인 필요' }[status] || status);

function parseFavorite(row) {
  try { return { favoriteKey: row.FavoriteKey, name: row.FavName, ...JSON.parse(row.FilterData || '{}') }; }
  catch { return null; }
}

export default function MyCustomerOrders() {
  const weekChoices = useMemo(() => buildForwardOrderWeeks(new Date()), []);
  const defaultWeek = useMemo(() => weekChoices.find(w => w.default) || weekChoices[0], [weekChoices]);
  const [year, setYear] = useState(() => defaultWeek?.year || String(currentYear));
  const [week, setWeek] = useState(() => defaultWeek?.week || '');
  const [customers, setCustomers] = useState([]);
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerCursor, setCustomerCursor] = useState(-1);
  const [showAllCustomers, setShowAllCustomers] = useState(false);
  const [selectionCollapsed, setSelectionCollapsed] = useState(false);
  const [collapsedFlowers, setCollapsedFlowers] = useState({});
  const [custKey, setCustKey] = useState('');
  const [products, setProducts] = useState([]);
  const [qty, setQty] = useState({});
  const [finalQty, setFinalQty] = useState({});
  const [editingQtyKey, setEditingQtyKey] = useState(null);
  const qtyBeforeEdit = useRef('');
  const [units, setUnits] = useState({});
  const [search, setSearch] = useState('');
  const [searchRows, setSearchRows] = useState([]);
  const [showCatalogSearch, setShowCatalogSearch] = useState(false);
  const [productQuery, setProductQuery] = useState('');
  const [productLetter, setProductLetter] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [showTemplates, setShowTemplates] = useState(false);
  const [history, setHistory] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [previousOrderWeek, setPreviousOrderWeek] = useState('');
  const [orderMode, setOrderMode] = useState('ADD');
  const [loadedScope, setLoadedScope] = useState('');
  const [needsReload, setNeedsReload] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [executionLog, setExecutionLog] = useState(null);
  const [showExecutionLog, setShowExecutionLog] = useState(false);
  const refs = useRef({});
  const groupRefs = useRef({});
  const productAreaRef = useRef(null);
  const customerRefs = useRef({});
  const scrollAfterLoadRef = useRef(false);
  const loadSequenceRef = useRef(0);
  const submitLockRef = useRef(false);
  const scopeRef = useRef('');
  const scopeKey = `${custKey}|${year}|${week}`;
  scopeRef.current = scopeKey;

  useEffect(() => {
    apiGet('/api/orders/my-customers').then((c) => {
      const ordered = sortMyCustomersFirst(c.customers || []);
      setCustomers(ordered); if (ordered[0]) setCustKey(String(ordered[0].CustKey));
    }).catch(e => setMessage(e.message));
  }, []);

  useEffect(() => {
    const handleContextualBack = (event) => {
      if (!selectionCollapsed && !showTemplates && !showExecutionLog) return;
      event.preventDefault();
      if (submitting) {
        setMessage('주문 처리가 끝난 뒤 차수·업체 선택으로 돌아가세요.');
        return;
      }
      setSelectionCollapsed(false);
      setShowTemplates(false);
      setSelectedTemplate(null);
      setShowExecutionLog(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    window.addEventListener(MENU_BACK_REQUEST_EVENT, handleContextualBack);
    return () => window.removeEventListener(MENU_BACK_REQUEST_EVENT, handleContextualBack);
  }, [selectionCollapsed, showTemplates, showExecutionLog, submitting]);

  const load = async ({ preserveDraft = false, confirmDraft = false } = {}) => {
    if (!custKey || !week) return;
    if (confirmDraft && !preserveDraft && (Object.keys(finalQty).length || Object.keys(qty).some(k => String(qty[k]) !== ''))) {
      if (!window.confirm('입력 중인 초안을 지우고 최신 수량을 다시 불러올까요?')) return false;
    }
    const sequence = ++loadSequenceRef.current;
    const requestedScope = `${custKey}|${year}|${week}`;
    setLoadedScope(''); setBusy(true); setMessage('');
    try {
      const d = await apiGet('/api/orders/my-customers', { custKey, year, week });
      if (sequence !== loadSequenceRef.current || scopeRef.current !== requestedScope) return false;
      setProducts(d.products || []); if (!preserveDraft) { setQty({}); setFinalQty({}); setUnits({}); } setLoadedScope(requestedScope); setNeedsReload(false);
      setCollapsedFlowers({}); setProductQuery(''); setProductLetter('');
      if (scrollAfterLoadRef.current) setTimeout(()=>productAreaRef.current?.scrollIntoView({behavior:'smooth',block:'start'}),0);
      return true;
    } catch (e) { if (sequence === loadSequenceRef.current) { setLoadedScope(''); setNeedsReload(true); setMessage(e.message); } return false; }
    finally { if (sequence === loadSequenceRef.current) { setBusy(false); scrollAfterLoadRef.current = false; } }
  };
  useEffect(() => { load(); }, [custKey, year, week]);
  useEffect(() => { setEditingQtyKey(null); }, [custKey, year, week]);
  // 차수 또는 업체를 새로 고르면 이전 탐색은 해당 선택 차수부터 다시 시작한다.
  useEffect(() => { setPreviousOrderWeek(''); }, [custKey, year, week]);

  const changed = useMemo(() => products.filter(p => Number(qty[p.ProdKey] || 0) > 0), [products, qty]);
  const enteredRows = useMemo(() => loadedScope !== scopeKey ? [] : products.filter(p => Number(p.CurrentQty)>0 || p.ProdKey === editingQtyKey || finalQty[p.ProdKey] !== undefined || (Object.prototype.hasOwnProperty.call(qty, p.ProdKey) && String(qty[p.ProdKey]) !== '')), [products, qty, finalQty, editingQtyKey, loadedScope, scopeKey]);
  const selectedUnit = p => units[p.ProdKey] || p.OutUnit || '박스';
  const convertedInputQty = p => convertSalesPasteQtyToOutUnit(Number(qty[p.ProdKey] || 0), selectedUnit(p), p);
  const draftFor = p => customerOrderDraft(p, qty[p.ProdKey], finalQty[p.ProdKey], n => convertSalesPasteQtyToOutUnit(n, selectedUnit(p), p));
  const draftRows = products.filter(p => draftFor(p).touched);
  const editAdditional = (p, value) => { setQty(v=>({...v,[p.ProdKey]:value})); setFinalQty(v=>{const next={...v};delete next[p.ProdKey];return next;}); };
  const resetDraft = p => { editAdditional(p, ''); setEditingQtyKey(null); };
  const productGroups = useMemo(() => {
    const groups = new Map();
    products.forEach(product => {
      const flowerName = groupLabel(product);
      if (!groups.has(flowerName)) groups.set(flowerName, []);
      groups.get(flowerName).push(product);
    });
    return [...groups].map(([flowerName, groupProducts]) => ({ flowerName, products: groupProducts }));
  }, [products]);
  const filteredProductGroups = useMemo(() => {
    const query = productQuery.trim().toLowerCase();
    return productGroups.map(group => ({ ...group, products: group.products.filter(product => {
      const matchesQuery = !query || `${group.flowerName} ${label(product)} ${product.ProdName || ''} ${product.CounName || ''}`.toLowerCase().includes(query);
      return matchesQuery && (!productLetter || productAlphabetInitial(product) === productLetter);
    }) })).filter(group => group.products.length);
  }, [productGroups, productQuery, productLetter]);
  const visibleProducts = useMemo(() => filteredProductGroups.flatMap(group => collapsedFlowers[group.flowerName] ? [] : group.products), [filteredProductGroups, collapsedFlowers]);
  const visibleCustomers = useMemo(() => {
    const q = customerQuery.trim().toLowerCase();
    const matched = q ? customers.filter(c => `${c.CustName} ${c.ManagerName} ${c.CustArea}`.toLowerCase().includes(q)) : customers;
    if (q || showAllCustomers) return matched;
    const recent = matched.slice(0, 30);
    const selected = matched.find(c => String(c.CustKey) === String(custKey));
    return selected && !recent.some(c => c.CustKey === selected.CustKey) ? [selected, ...recent] : recent;
  }, [customers, customerQuery, showAllCustomers, custKey]);
  const selectedCustomer = useMemo(() => customers.find(c => String(c.CustKey) === String(custKey)), [customers, custKey]);
  const loadCustomerFavorites = async key => {
    const favoriteData = await apiGet('/api/favorites', { page: ORDER_FAVORITE_PAGE });
    const list = (favoriteData.favorites || []).map(parseFavorite).filter(f => f && String(f.custKey) === String(key));
    setFavorites(list); return list;
  };
  useEffect(() => {
    if (!custKey) return;
    setSelectedTemplate(null);
    loadCustomerFavorites(custKey).catch(() => setFavorites([]));
  }, [custKey]);
  const loadTemplates = async () => {
    if (!custKey || submitting || scopeRef.current !== scopeKey) return;
    const requestedScope = scopeKey;
    setTemplateBusy(true); setMessage(''); setShowTemplates(true);
    try {
      const [ordersData] = await Promise.all([
        apiGet('/api/orders/my-customers', { view: 'history', custKey, year, week }),
        loadCustomerFavorites(custKey),
      ]);
      if (scopeRef.current !== requestedScope) return;
      setHistory(ordersData.orders || []);
      setSelectedTemplate(null);
    } catch (e) { setMessage(`고정주문 조회 실패: ${e.message}`); }
    finally { setTemplateBusy(false); }
  };
  const applyTemplate = template => {
    if (submitting || scopeRef.current !== scopeKey) return;
    const valid = new Map(products.map(p => [Number(p.ProdKey), p]));
    const nextQty = {};
    const nextUnits = {};
    for (const item of template.items || []) if (valid.has(Number(item.prodKey)) && Number(item.qty) > 0) { nextQty[item.prodKey] = String(Number(item.qty)); nextUnits[item.prodKey] = salesPasteUnitOptions().includes(item.unit) ? item.unit : valid.get(Number(item.prodKey)).OutUnit; }
    setQty(nextQty); setFinalQty({}); setUnits(nextUnits); setShowTemplates(false); setSelectedTemplate(null);
    setMessage(`${template.name || `${template.year}년 ${template.week}`} 주문 ${Object.keys(nextQty).length}개 품목을 불러왔습니다. 수량 수정·삭제 후 주문등록하세요.`);
  };
  const loadPreviousOrderDraft = async () => {
    if (!custKey || !week || submitting || busy || loadedScope !== scopeKey) return;
    const requestedScope = scopeKey;
    const beforeWeek = previousOrderWeek || week;
    if ((Object.keys(finalQty).length || Object.keys(qty).some(key => String(qty[key]) !== '')) && !window.confirm('입력 중인 초안을 직전 차수 주문으로 바꿀까요?')) return;
    setTemplateBusy(true); setMessage(`${previousOrderWeek ? '그 이전' : '바로 이전'} 차수 주문을 불러오는 중입니다.`);
    try {
      const data = await apiGet('/api/orders/my-customers', { view: 'previous-order', custKey, year, week, beforeWeek });
      if (scopeRef.current !== requestedScope) return;
      if (!data.order) return setMessage(`같은 연도에서 이 업체의 ${previousOrderWeek ? '더 이전' : '바로 이전'} 입력 차수 주문이 없습니다.`);
      setPreviousOrderWeek(data.order.week);
      applyTemplate({ ...data.order, name: `${data.order.year}년 ${data.order.week} 바로 이전 주문` });
    } catch (e) { setMessage(`바로 이전 차수 주문 불러오기 실패: ${e.message}`); }
    finally { setTemplateBusy(false); }
  };
  const saveFavorite = async order => {
    const name = window.prompt('즐겨찾기 이름을 입력하세요.', `${order.year}년 ${order.week} 주문`);
    if (!name) return;
    setTemplateBusy(true);
    try {
      await apiPost('/api/favorites', { page: ORDER_FAVORITE_PAGE, name, filterData: JSON.stringify({
        custKey: Number(custKey), custName: selectedCustomer?.CustName, sourceYear: order.year, sourceWeek: order.week,
        items: order.items.map(item => ({ prodKey: Number(item.prodKey), qty: Number(item.qty), unit: item.unit })),
      }) });
      await loadTemplates(); setMessage('주문 즐겨찾기를 저장했습니다.');
    } catch (e) { setMessage(`즐겨찾기 저장 실패: ${e.message}`); }
    finally { setTemplateBusy(false); }
  };
  const removeFavorite = async favoriteKey => {
    if (!window.confirm('이 주문 즐겨찾기를 삭제할까요?')) return;
    try { await apiDelete('/api/favorites', { favoriteKey }); await loadTemplates(); }
    catch (e) { setMessage(`즐겨찾기 삭제 실패: ${e.message}`); }
  };
  useEffect(() => { setCustomerCursor(visibleCustomers.length ? 0 : -1); }, [customerQuery, showAllCustomers]);
  const selectCustomer = key => {
    if (submitting) return;
    if (String(key) !== String(custKey) && (Object.keys(finalQty).length || Object.keys(qty).some(k => String(qty[k]) !== '')) && !window.confirm('입력 중인 초안을 지우고 업체를 변경할까요?')) return;
    scrollAfterLoadRef.current = false;
    if (String(key) === String(custKey)) setTimeout(()=>productAreaRef.current?.scrollIntoView({behavior:'smooth',block:'nearest'}),0);
    else setCustKey(String(key));
    if (week && key) setSelectionCollapsed(true);
  };
  const moveCustomer = e => {
    if (!['ArrowDown','ArrowUp','Enter'].includes(e.key) || !visibleCustomers.length) return;
    e.preventDefault();
    if (e.key === 'Enter') return selectCustomer(visibleCustomers[Math.max(0, customerCursor)]?.CustKey);
    const next = e.key === 'ArrowDown' ? Math.min(visibleCustomers.length - 1, customerCursor + 1) : Math.max(0, customerCursor - 1);
    setCustomerCursor(next);
    setTimeout(() => customerRefs.current[visibleCustomers[next]?.CustKey]?.scrollIntoView({ block: 'nearest', inline: 'nearest' }), 0);
  };
  const doSearch = async e => {
    e?.preventDefault(); if (!search.trim() || submitting) return setSearchRows([]);
    const requestedScope = scopeKey;
    setBusy(true); try { const d = await apiGet('/api/products/search', { q: search.trim() }); if (scopeRef.current === requestedScope) setSearchRows((d.products || []).slice(0, 30)); } catch (x) { setMessage(x.message); } finally { setBusy(false); }
  };
  const addProduct = async p => {
    if (submitting || loadedScope !== scopeKey) return setMessage('현재 업체·차수 수량을 먼저 불러오세요.');
    const requestedScope = scopeKey;
    try {
      const snapshot = await apiGet('/api/orders/my-customers', { custKey, year, week });
      if (scopeRef.current !== requestedScope || loadedScope !== requestedScope) return;
      const current = (snapshot.products || []).find(x => Number(x.ProdKey) === Number(p.ProdKey));
      if (!products.some(x => Number(x.ProdKey) === Number(p.ProdKey))) {
        setProducts(v => [...v, { ...p, ...(current || {}), CurrentQty: Number(current?.CurrentQty || 0), UsageCount: Number(current?.UsageCount || 0) }]);
      }
    } catch (e) { return setMessage(`품목 수량 재조회 실패: ${e.message}`); }
    setCollapsedFlowers(v => ({ ...v, [groupLabel(p)]: false }));
    setSearchRows([]); setSearch(''); setTimeout(() => refs.current[p.ProdKey]?.focus(), 0);
  };
  const move = (e, prodKey) => {
    if (!['ArrowUp','ArrowLeft','ArrowDown','ArrowRight','Enter'].includes(e.key)) return;
    e.preventDefault(); const step = ['ArrowUp','ArrowLeft'].includes(e.key) ? -1 : 1;
    const i = visibleProducts.findIndex(p => Number(p.ProdKey) === Number(prodKey));
    refs.current[visibleProducts[Math.max(0, Math.min(visibleProducts.length - 1, i + step))]?.ProdKey]?.focus();
  };
  const jumpToFlower = flowerName => {
    setCollapsedFlowers(v => ({ ...v, [flowerName]: false }));
    setTimeout(() => groupRefs.current[flowerName]?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };
  const submit = async (requestedMode = orderMode, approvedFingerprint = '') => {
    if (submitLockRef.current || submitting || needsReload || loadedScope !== scopeKey) return setMessage('현재 업체·차수 수량을 다시 불러온 뒤 등록하세요.');
    if (requestedMode === 'ADD' && Object.keys(finalQty).length) return setMessage('최종 수량을 수정한 품목이 있습니다. 변경등록으로 저장하세요.');
    const rows = draftRows.filter(p => draftFor(p).changed || draftFor(p).finalQty === null);
    if (!rows.length) return setMessage(requestedMode === 'REPLACE' ? '변경할 수량을 입력하세요. 0도 변경값으로 등록됩니다.' : '추가할 수량을 입력하세요.');
    const invalid = rows.filter(p => draftFor(p).finalQty === null);
    if (invalid.length) return setMessage(`단위 환산값이 없어 등록할 수 없습니다: ${invalid.map(p => `${label(p)} (${selectedUnit(p)}→${p.OutUnit})`).join(', ')}`);
    const customer = customers.find(c => String(c.CustKey) === String(custKey));
    const items = rows.map(p => ({ prodKey: p.ProdKey, prodName: p.ProdName, qty: requestedMode === 'REPLACE' ? draftFor(p).finalQty : Number(qty[p.ProdKey]), unit: requestedMode === 'REPLACE' ? p.OutUnit : selectedUnit(p), expectedCurrentQty: Number(p.CurrentQty || 0) }));
    const fingerprint = customerOrderApprovalFingerprint(scopeKey, requestedMode, items);
    const previewRows = rows.map(p => ({ prodKey:p.ProdKey, prodName:label(p), unit:p.OutUnit, previousQty:draftFor(p).current, finalQty:draftFor(p).finalQty, status:'승인 대기' }));
    const preview = { startedAt:new Date().toISOString(), mode:requestedMode, scope:scopeKey, customerName:customer?.CustName, year, week, fingerprint, rows:previewRows };
    if (!approvedFingerprint || approvedFingerprint !== fingerprint) {
      setExecutionLog({ ...preview, status:'awaiting-approval' }); setShowExecutionLog(true);
      setMessage(approvedFingerprint ? '입력 내용이 달라져 변경표를 갱신했습니다. 다시 확인 후 승인하세요.' : '변경 품목과 수량을 확인하고 승인하면 주문등록을 시작합니다.');
      return;
    }
    submitLockRef.current = true; setSubmitting(true); setShowExecutionLog(true); setExecutionLog({ ...preview, status:'working', rows:previewRows.map(r=>({...r,status:'등록 중'})) }); setMessage('주문 등록을 처리 중입니다…');
    try {
      const d = await apiPost('/api/orders', { source: 'my-customer', orderMode: requestedMode, custKey: Number(custKey), custName: customer?.CustName, year, week,
        items });
      if (d.success === false || d.verified === false || (Object.prototype.hasOwnProperty.call(d, 'verified') && !d.verified)) {
        const verificationError = new Error(d.error || '주문 반영 검증에 실패했습니다. 입력 초안은 유지됩니다.'); verificationError.status = 422; throw verificationError;
      }
      const resultRows = previewRows.map(row => ({ ...row, ...(d.results || []).find(r=>Number(r.prodKey)===Number(row.prodKey)), unit:row.unit, status:'반영 완료' }));
      setExecutionLog(v => ({ ...v, finishedAt: new Date().toISOString(), status: 'committed', rows: resultRows, warning: d.warning || '' }));
      setQty({}); setFinalQty({}); setMessage(`${d.message || '주문 등록 완료'} · 결과를 재조회 중입니다.`);
      const reloaded = await load({ preserveDraft: false });
      if (!reloaded) { setExecutionLog(v => ({ ...v, status: 'committed-reload-failed' })); setMessage('주문은 반영됐지만 화면 재조회에 실패했습니다. 새로고침해 확인하세요.'); return; }
      const resultMessage = `${d.message || '주문 등록 완료'} · 주문원장 재조회 완료`; setMessage(resultMessage); window.alert(resultMessage);
    } catch (e) {
      const unknownCommit = !e.status || e.status === 409;
      if (unknownCommit) setNeedsReload(true);
      setExecutionLog(v => ({ ...v, finishedAt: new Date().toISOString(), status: !e.status ? 'unknown-commit-reload-required' : e.status === 409 ? 'failed-stale-reload-required' : 'failed', error: e.message, rows:(v.rows||[]).map(r=>({...r,status:!e.status?'결과 확인 필요':'등록 실패'})) }));
      setMessage(!e.status ? '등록 결과를 확인하지 못했습니다. 재조회 후 다시 등록하세요. 입력 초안은 유지됩니다.' : e.message || '등록 실패. 입력 초안은 유지됩니다.');
    } finally { submitLockRef.current = false; setSubmitting(false); }
  };

  return <>
    <Head><title>내 업체 주문등록</title></Head>
    <main className="my-order-page">
      <div className="title-row"><div><h1>내 업체 주문등록</h1><p>차수와 업체를 고른 뒤, 품목을 세 열로 빠르게 입력합니다.</p><nav className="entry-tabs" aria-label="주문 입력 방식"><span aria-current="page">수량 직접 입력</span><Link href="/orders/sales-paste">붙여서 주문등록</Link></nav></div><div className="page-actions"><button onClick={loadPreviousOrderDraft} disabled={busy||templateBusy||submitting||loadedScope!==scopeKey}>{templateBusy?'불러오는 중':previousOrderWeek?'더 이전 차수 주문 불러오기':'바로 이전 차수 주문 불러오기'}</button><button onClick={loadTemplates} disabled={busy||templateBusy||submitting}>과거·고정 주문</button><button onClick={()=>load({confirmDraft:true})} disabled={busy||submitting}>최신 다시불러오기</button><button type="button" onClick={()=>setShowExecutionLog(true)}>실행 로그</button></div></div>
      {selectionCollapsed&&selectedCustomer&&<section className="selection-summary"><div><b>{year}년 {week}</b><span>{selectedCustomer.CustName}{selectedCustomer.OrderCode?` · ${selectedCustomer.OrderCode}`:''}</span></div><button type="button" onClick={()=>setSelectionCollapsed(false)}>차수·업체 변경</button></section>}
      {!selectionCollapsed&&<section className="filters">
        <div className="pick-group"><b>등록 차수</b><div className="choice-buttons">{weekChoices.map(w=><button disabled={submitting} key={`${w.year}-${w.week}`} className={year===w.year&&week===w.week?'active':''} aria-pressed={year===w.year&&week===w.week} onClick={()=>{if((Object.keys(finalQty).length || Object.keys(qty).some(k=>String(qty[k])!== ''))&&!window.confirm('입력 중인 초안을 지우고 차수를 변경할까요?'))return;setSelectionCollapsed(false);setYear(w.year);setWeek(w.week)}}>{w.year!==String(currentYear)&&<small>{w.year}년 </small>}{w.label}</button>)}</div><small>현재 차수 -2부터 표시합니다. 기본 선택은 +2차이며, 각 차수의 1·2 세부차수입니다.</small></div>
        <div className="pick-group"><b>업체 선택 <em>{customers.length}곳 · 최근 주문순</em></b><div className="customer-tools"><input value={customerQuery} onChange={e=>setCustomerQuery(e.target.value)} onKeyDown={moveCustomer} placeholder="업체명·담당자 검색" aria-label="업체 검색" aria-activedescendant={customerCursor>=0?`customer-${visibleCustomers[customerCursor]?.CustKey}`:undefined}/><button onClick={()=>setShowAllCustomers(v=>!v)}>{showAllCustomers?'최근 업체만':'전체 업체 보기'}</button></div><small>업체명 입력 후 ↑↓로 이동하고 Enter로 선택하세요.</small><div className="choice-buttons customers">{visibleCustomers.map((c,i)=><button ref={el=>customerRefs.current[c.CustKey]=el} id={`customer-${c.CustKey}`} key={c.CustKey} className={`${String(custKey)===String(c.CustKey)?'active':''} ${i===customerCursor?'cursor':''}`} aria-pressed={String(custKey)===String(c.CustKey)} onMouseEnter={()=>setCustomerCursor(i)} onClick={()=>selectCustomer(c.CustKey)}><span>{c.CustName}{c.OrderCode&&<mark>{c.OrderCode}</mark>}{Number(c.IsMine)===1&&<i>내 업체</i>}</span><small>{c.ManagerName}{c.CustArea?` · ${c.CustArea}`:''}{c.LastOrderWeek?` · 최근 ${c.LastOrderWeek}`:' · 주문이력 없음'}</small></button>)}</div>{!customers.length&&<small>선택 가능한 활성 업체가 없습니다.</small>}{!customerQuery&&!showAllCustomers&&customers.length>30&&<small>최근 주문업체 30곳만 표시 중입니다. 검색하거나 전체 업체 보기를 누르세요.</small>}</div>
      </section>}
      {favorites.length>0&&<div className="pinned-favorites"><b>★ 고정 주문</b>{favorites.map(fav=><button type="button" key={fav.favoriteKey} disabled={submitting} onClick={()=>{setSelectedTemplate(fav);setShowTemplates(true)}}>{fav.name}<small>{fav.items?.length||0}개</small></button>)}</div>}
      {showTemplates&&<section className="templates"><div className="templates-head"><div><b>고정주문 불러오기</b><small>{year}년 {week}보다 이전 주문 또는 즐겨찾기를 선택해 내역을 확인한 뒤 불러옵니다. 확인만으로 기존 원장은 변경되지 않습니다.</small></div><button onClick={()=>{setShowTemplates(false);setSelectedTemplate(null)}}>닫기</button></div><div className="template-browser"><div className="template-columns"><div><h3>지난 차수 주문</h3>{history.length?history.map(order=><article key={order.id}><button className={`template-main ${selectedTemplate?.id===order.id?'selected':''}`} onClick={()=>setSelectedTemplate({...order,name:`${order.year}년 ${order.week}`})}><b>{order.year}년 {order.week}</b><small>{order.items.length}개 품목 · {String(order.date||'').slice(0,10)}</small></button><button className="star" onClick={()=>saveFavorite(order)} aria-label={`${order.year}년 ${order.week} 즐겨찾기`}>☆ 즐겨찾기</button></article>):<p>같은 연도의 이전 주문 이력이 없습니다.</p>}</div><div><h3>내 주문 즐겨찾기</h3>{favorites.length?favorites.map(fav=><article key={fav.favoriteKey}><button className={`template-main ${selectedTemplate?.favoriteKey===fav.favoriteKey?'selected':''}`} onClick={()=>setSelectedTemplate(fav)}><b>★ {fav.name}</b><small>{fav.items?.length||0}개 품목 · 원본 {fav.sourceYear||''} {fav.sourceWeek||''}</small></button><button className="delete-fav" onClick={()=>removeFavorite(fav.favoriteKey)} aria-label={`${fav.name} 삭제`}>삭제</button></article>):<p>저장된 즐겨찾기가 없습니다.</p>}</div></div><aside className="preview-pane">{selectedTemplate?<div className="template-preview"><div className="preview-title"><div><b>{selectedTemplate.name||`${selectedTemplate.year}년 ${selectedTemplate.week}`} 주문내역</b><small>{selectedTemplate.items?.length||0}개 품목을 확인한 뒤 불러오세요.</small></div><button className="load-template" onClick={()=>applyTemplate(selectedTemplate)}>이 주문 불러오기</button></div><div className="preview-items">{(selectedTemplate.items||[]).map(item=><div key={item.prodKey}><span>{item.countryFlower||item.flowerName||''}</span><b>{item.displayName||item.prodName||products.find(p=>Number(p.ProdKey)===Number(item.prodKey))?.ProdName||`품목 ${item.prodKey}`}</b><strong>{Number(item.qty)} {item.unit||''}</strong></div>)}</div></div>:<div className="preview-empty"><b>주문을 선택하세요</b><span>왼쪽에서 지난 차수 또는 즐겨찾기를 선택하면 이곳에 주문 품목과 수량이 표시됩니다.</span></div>}</aside></div></section>}
      <div className="entry-layout"><section className="product-workspace"><div className="catalog-search"><button type="button" className={showCatalogSearch?'catalog-open':''} onClick={()=>setShowCatalogSearch(v=>!v)} aria-expanded={showCatalogSearch}>전산 전체 품목 추가검색 {showCatalogSearch?'닫기':'열기'}</button>{showCatalogSearch&&<form className="search" onSubmit={doSearch}><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="다른 품종·품목 검색" aria-label="전산 전체 품목 추가검색"/><button disabled={busy}>검색 추가</button></form>}</div>
      {showCatalogSearch&&searchRows.length>0 && <div className="results">{searchRows.map(p=><button key={p.ProdKey} onClick={()=>addProduct(p)}><b>{groupLabel(p)}</b> {displayLabel(p)} <span>{p.CounName} · {p.OutUnit}</span></button>)}</div>}
      <div className="product-filter"><div><input value={productQuery} onChange={e=>setProductQuery(e.target.value)} placeholder="현재 목록 필터" aria-label="현재 목록 품목 필터"/><button type="button" onClick={()=>{setProductQuery('');setProductLetter('')}}>초기화</button></div></div>
      <div className="alphabet-bar"><div className="alphabet" aria-label="품목명 알파벳 필터"><button type="button" className={!productLetter?'active':''} onClick={()=>setProductLetter('')}>전체</button>{ALPHABET.map(letter=><button type="button" key={letter} className={productLetter===letter?'active':''} aria-pressed={productLetter===letter} onClick={()=>setProductLetter(letter)}>{letter}</button>)}</div></div>
      {message && <div className="notice" role="status" aria-live="polite">{message}</div>}
      <div className="product-scroll">
      <div ref={productAreaRef} className="grid-head"><span>품목</span><span>기존 주문 · 추가 입력 · 최종 수량</span></div>
      {loadedScope===scopeKey&&<div className="loaded-summary">현재 주문 {products.filter(p=>Number(p.CurrentQty||0)>0).length}개 품목 · {year}년 {week} · {selectedCustomer?.CustName||'업체'}{selectedCustomer?.OrderCode?` · ${selectedCustomer.OrderCode}`:''}</div>}
      {busy&&<div className="empty">{year}년 {week} · {selectedCustomer?.CustName||'업체'} 수량을 불러오는 중입니다…</div>}
      <div className="product-list">{loadedScope===scopeKey&&filteredProductGroups.map(group=>{ const collapsed=Boolean(collapsedFlowers[group.flowerName]); const entered=group.products.filter(p=>String(qty[p.ProdKey] ?? '')!==''); const panelId=`flower-${String(group.flowerName).replace(/[^a-zA-Z0-9가-힣_-]/g,'-')}`; return <section ref={el=>groupRefs.current[group.flowerName]=el} className={`flower-group ${entered.length?'has-entered':''}`} key={group.flowerName}><button type="button" className="flower-toggle" disabled={submitting} aria-expanded={!collapsed} aria-controls={panelId} onClick={()=>setCollapsedFlowers(v=>({...v,[group.flowerName]:!v[group.flowerName]}))}><span><b>{group.flowerName}</b><small>{group.products.length}개 품목{entered.length>0?` · 입력 ${entered.length}개`:''}</small></span><strong>{collapsed?'열기':'닫기'} <i aria-hidden="true">{collapsed?'▾':'▴'}</i></strong></button>{!collapsed&&<div className="flower-products" id={panelId}>{group.products.map(p=>{ const hasInput=String(qty[p.ProdKey] ?? '')!==''; const converted=hasInput?convertedInputQty(p):0; return <div className={`product-row ${hasInput?'has-input':''}`} key={p.ProdKey} title={label(p)}><span className="product-name"><b>{displayLabel(p)}</b></span><strong className={Number(p.CurrentQty||0)>0?'current-positive':''}>기존 {Number(p.CurrentQty||0)}{p.OutUnit}</strong><input ref={el=>refs.current[p.ProdKey]=el} value={qty[p.ProdKey] ?? ''} onChange={e=>editAdditional(p,e.target.value)} onKeyDown={e=>move(e,p.ProdKey)} disabled={submitting||loadedScope!==scopeKey} type="number" min="0" step="any" placeholder="+ 수량" aria-label={`${displayLabel(p)} 추가 입력수량`}/><select value={selectedUnit(p)} onChange={e=>setUnits(v=>({...v,[p.ProdKey]:e.target.value}))} disabled={submitting||loadedScope!==scopeKey} aria-label={`${displayLabel(p)} 입력단위`}>{salesPasteUnitOptions().map(unit=><option key={unit} value={unit}>{unit}</option>)}</select><strong className={converted===null?'conversion-error':''}>{converted===null?'환산 불가':`최종 ${draftFor(p).finalQty ?? '확인필요'}${p.OutUnit}`}</strong></div>})}</div>}</section>})}</div>
      {products.length>0&&filteredProductGroups.length===0&&<div className="empty">검색 또는 알파벳 조건에 맞는 품목이 없습니다.</div>}
      {!busy && loadedScope===scopeKey && products.length===0 && <div className="empty">이 업체의 기존 주문 품목이 없습니다. 검색으로 품목을 추가하세요.</div>}</div></section>
      <aside className="side-tools"><div className="live-order" aria-live="polite"><strong>주문 품목 {enteredRows.length}개</strong><p>기존 주문 포함 · 우측 수량은 최종 주문수량</p><small>추가 입력 품목 {changed.length}개 · 최종 수정 {Object.keys(finalQty).length}개</small>{enteredRows.length>0?<div>{enteredRows.map(p=><div className="live-order-item" key={p.ProdKey}>
        <span className="live-order-name" title={label(p)}><strong>{displayLabel(p)}</strong><small>기존 {Number(p.CurrentQty||0)}{p.OutUnit}{draftFor(p).touched ? ` → 최종 ${draftFor(p).finalQty ?? '확인필요'}${p.OutUnit}` : ''}</small></span>
        <label className="live-order-quantity">
          <input type="number" min="0" step="any" value={finalQty[p.ProdKey] ?? draftFor(p).finalQty ?? ''} disabled={submitting||loadedScope!==scopeKey}
            aria-label={`${displayLabel(p)} 최종 주문수량`} title="최종 수량 수정 · 변경등록으로 저장 · Esc 취소"
            onFocus={e=>{qtyBeforeEdit.current=finalQty[p.ProdKey];setEditingQtyKey(p.ProdKey);e.target.select();}}
            onChange={e=>setFinalQty(v=>({...v,[p.ProdKey]:e.target.value}))}
            onBlur={()=>setEditingQtyKey(null)}
            onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();setFinalQty(v=>{const n={...v};if(qtyBeforeEdit.current===undefined)delete n[p.ProdKey];else n[p.ProdKey]=qtyBeforeEdit.current;return n;});e.currentTarget.blur();}else if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur();}}}/>
          <b>{p.OutUnit}</b>
        </label>
        <button className="live-order-remove" type="button" disabled={submitting||loadedScope!==scopeKey||!draftFor(p).touched} onClick={()=>resetDraft(p)} title={`${label(p)} 입력 수량 지우기`} aria-label={`${displayLabel(p)} 수정 취소`}>×</button>
      </div>)}</div>:<p>왼쪽에서 수량을 입력하면 바로 이곳에 표시됩니다.</p>}</div><nav className="variety-nav" aria-label="품종 바로가기"><strong>품종 바로가기</strong><div>{filteredProductGroups.map(group=><button type="button" key={group.flowerName} onClick={()=>jumpToFlower(group.flowerName)}><span>{group.flowerName}</span><small>{group.products.length}</small></button>)}</div></nav></aside></div>
{showExecutionLog&&<div className="execution-backdrop"><section className="execution-log" role="dialog" aria-modal="true" aria-label="주문 실행 로그">
  <div className="execution-log-head"><b>주문 실행 로그 · 변경사항 확인</b><button type="button" disabled={submitting} onClick={()=>setShowExecutionLog(false)}>{executionLog?.status==='awaiting-approval'?'돌아가서 수정':'닫기'}</button></div>
  {executionLog?<><p className="approval-scope">{executionLog.customerName || '업체'} · {executionLog.year}년 {executionLog.week} · {executionLog.mode==='REPLACE'?'변경등록':'추가등록'}</p>
  <strong className="approval-status">{logStatusLabel(executionLog.status)}</strong><small>{logTime(executionLog.startedAt)}</small>
  {executionLog.error&&<p className="log-error">오류: {executionLog.error}</p>}
  {executionLog.warning&&<p className="log-warn">주의: {executionLog.warning}</p>}
  {executionLog.status==='committed-reload-failed'&&<p className="log-warn">DB 반영은 완료됐지만 재조회가 실패했습니다. 새로고침으로 확인하세요.</p>}
  {executionLog.status==='unknown-commit-reload-required'&&<p className="log-warn">반영 결과를 확인하지 못했습니다. 재조회 전 재등록하지 마세요.</p>}
  <div className="approval-counts">변경 {executionLog.rows?.length||0}개 품목 · 신규 {executionLog.rows?.filter(r=>Number(r.previousQty)===0&&Number(r.finalQty)>0).length||0} · 증가 {executionLog.rows?.filter(r=>Number(r.previousQty)>0&&Number(r.finalQty)>Number(r.previousQty)).length||0} · 감소 {executionLog.rows?.filter(r=>Number(r.finalQty)<Number(r.previousQty)).length||0}</div>
  <div className="approval-table-wrap"><table className="approval-table"><thead><tr><th>품목</th><th>기존</th><th>변경 후</th><th>증감</th><th>상태</th></tr></thead><tbody>{executionLog.rows?.map((r,i)=>{const delta=Number((Number(r.finalQty)-Number(r.previousQty)).toFixed(6));return <tr key={`${r.prodKey}-${i}`}><td>{r.prodName||r.prodKey}</td><td>{r.previousQty ?? '-'} {r.unit}</td><td><b>{r.finalQty ?? '-'} {r.unit}</b></td><td className={delta<0?'quantity-down':'quantity-up'}>{delta>0?'+':''}{delta} {r.unit}</td><td>{executionLog.status==='awaiting-approval'?(Number(r.previousQty)===0?'신규':delta<0?'감소':'증가'):r.status}</td></tr>})}</tbody></table></div>
  {executionLog.status==='awaiting-approval'&&<div className="approval-actions"><p>표에 있는 품목만 반영합니다. 승인 전에는 저장하지 않습니다.<br/>출고 연결·동시 수정 여부는 등록 시 서버에서 다시 확인합니다.</p><button type="button" className="approve-order" disabled={submitting||needsReload||loadedScope!==scopeKey||executionLog.scope!==scopeKey} onClick={()=>submit(executionLog.mode,executionLog.fingerprint)}>승인하고 주문등록 시작 ({executionLog.rows.length}개)</button></div>}
  </>:<p>아직 실행한 작업이 없습니다.</p>}
</section></div>}
      <div className="submit"><span>{draftRows.filter(p=>draftFor(p).changed).length}개 품목 수정{Object.keys(finalQty).length?' · 변경등록으로 저장':''}</span><button type="button" className={orderMode==='ADD'?'mode-active':''} onClick={()=>{setOrderMode('ADD');submit('ADD')}} disabled={submitting||needsReload||loadedScope!==scopeKey||!changed.length||Object.keys(finalQty).length>0}>추가등록</button><button type="button" className={orderMode==='REPLACE'?'mode-active':''} onClick={()=>{setOrderMode('REPLACE');submit('REPLACE')}} disabled={submitting||needsReload||loadedScope!==scopeKey||!draftRows.length}>변경등록</button></div>
    </main>
    <style jsx>{`
      .execution-backdrop{position:fixed;inset:0;z-index:100;background:#10182866;display:flex;align-items:center;justify-content:center;padding:16px}
      .execution-backdrop .execution-log{position:relative;right:auto;bottom:auto;width:min(980px,100%);max-height:85vh;overflow:auto;padding:18px;box-sizing:border-box}
      .execution-log-head{position:sticky;top:-18px;background:white;z-index:2;padding:6px 0;align-items:center}.execution-log-head b{font-size:20px}
      .approval-scope{font-size:17px;font-weight:700;color:#1849a9;margin:8px 0}.approval-status{display:block;color:#1849a9;font-size:16px}.approval-counts{padding:10px 0;font-weight:700;font-size:16px}
      .approval-table-wrap{max-height:48vh;overflow:auto}.approval-table{width:100%;border-collapse:collapse;font-size:15px}.approval-table th{position:sticky;top:0;background:#eef4ff;text-align:left;z-index:1}.approval-table th,.approval-table td{padding:10px 8px;border-bottom:1px solid #d0d5dd}.approval-table td:first-child{min-width:130px;overflow-wrap:anywhere}.approval-table td:not(:first-child){white-space:nowrap}.approval-table td:nth-child(3){background:#f0f9ff}.quantity-down{color:#b42318;font-weight:700}.quantity-up{color:#027a48;font-weight:700}
      .approval-actions{position:sticky;bottom:-18px;background:white;padding:12px 0 4px;display:flex;align-items:center;justify-content:space-between;gap:12px}.approval-actions p{margin:0;font-size:13px}.approval-actions .approve-order{background:#155eef;color:white;font-weight:800;padding:10px 18px;white-space:nowrap}.approve-order:disabled{opacity:.5}
      @media(max-width:620px){.execution-backdrop{padding:8px}.execution-backdrop .execution-log{padding:10px}.approval-actions{position:static;flex-direction:column;align-items:stretch}.approval-table{font-size:13px}.execution-log-head b{font-size:17px}}
      .entry-tabs{display:flex;gap:4px}.entry-tabs :global(a),.entry-tabs span{padding:6px 11px;border:1px solid #d0d5dd;border-radius:7px;text-decoration:none;color:#344054;background:#fff;font-weight:800}.entry-tabs span{background:#155eef;color:#fff;border-color:#155eef}
      .my-order-page{max-width:1920px;margin:auto;padding:6px 16px}.title-row,.search,.submit{display:flex;gap:8px;align-items:center}.title-row{justify-content:space-between}.title-row p{margin:1px 0 4px}h1{margin:0;font-size:24px}p,small{color:#667085}button,input{min-height:32px;border:1px solid #d0d5dd;border-radius:8px;padding:4px 9px;background:white}.page-actions{display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end}.selection-summary{display:flex;align-items:center;justify-content:space-between;margin-top:5px;padding:5px 9px;border:1px solid #b2ccff;border-radius:8px;background:#eef4ff}.selection-summary div{display:flex;gap:10px;align-items:center}.selection-summary b{color:#1849a9}.filters{padding:6px 9px;background:#f8fafc;border-radius:10px;display:grid;gap:6px}.pick-group{display:grid;gap:3px}.pick-group b{font-size:14px}.pick-group em{font-style:normal;color:#155eef}.choice-buttons{display:flex;flex-wrap:wrap;gap:4px}.choice-buttons button{min-width:68px;font-weight:700}.choice-buttons button.active{border-color:#155eef;background:#155eef;color:white;box-shadow:0 0 0 2px #dbe7ff}.choice-buttons button small{color:inherit}.customers button{display:flex;flex-direction:column;align-items:flex-start;min-width:120px}.customers button small{font-weight:400}.customers mark{background:#fef0c7;color:#93370d;border-radius:5px;padding:1px 4px;font-size:10px}.search{margin-top:4px}.search input{flex:1}.results{display:grid;grid-template-columns:repeat(3,1fr);gap:3px;padding:4px;background:#f8fafc}.results button{text-align:left}.results span{color:#667085}.product-filter{margin-top:4px;padding:5px;background:#f8fafc;border-radius:9px}.product-filter>div:first-child{display:flex;gap:4px}.product-filter input{flex:1}.alphabet-bar{position:sticky;top:0;z-index:6;margin-top:3px;padding:4px 5px;background:#f8fafc;border:1px solid #dce3ec;border-radius:8px}.alphabet{display:flex;flex-wrap:nowrap;gap:2px;overflow-x:auto}.alphabet button{min-width:29px;min-height:28px;padding:2px 5px;font-weight:700;flex:0 0 auto}.alphabet button.active{background:#155eef;color:white;border-color:#155eef}.notice{margin:4px 0;padding:5px 9px;background:#eef4ff;color:#1849a9}.grid-head{display:flex;justify-content:space-between;padding:3px 8px;font-size:12px;font-weight:700;color:#475467}.flower-group{margin-top:2px;border:1px solid #dce3ec;border-radius:7px;overflow:visible}.flower-toggle{position:sticky;top:0;z-index:3;width:100%;display:flex;justify-content:space-between;align-items:center;border:0;border-radius:6px 6px 0 0;background:#eef2f6;padding:2px 8px;text-align:left;box-shadow:0 1px 0 #dce3ec}.flower-toggle span{display:flex;align-items:baseline;gap:7px}.flower-toggle b{font-size:14px;color:#1d2939}.flower-toggle strong{color:#155eef}.flower-toggle i{font-style:normal}.flower-products{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;padding:1px}.product-row{display:grid;grid-template-columns:minmax(115px,1fr) 54px 76px 56px 66px;gap:3px;align-items:center;min-height:29px;padding:0 5px;border:1px solid #eaecf0;border-radius:4px;background:#fff}.product-name{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}.product-name b{font-weight:700}.product-row input{min-height:25px;height:25px;padding:0 5px;text-align:right;font-size:14px;border-color:#84adff}.product-row strong{font-size:12px;white-space:nowrap;text-align:right}.empty{text-align:center;padding:16px;color:#667085}.submit{position:sticky;bottom:0;z-index:7;justify-content:flex-end;background:white;border-top:1px solid #ddd;padding:5px 10px}.submit button{background:#155eef;color:white;font-weight:800;min-width:130px}.submit button.mode-active{background:#eff8ff;color:#1849a9}.submit button:disabled{opacity:.5}.execution-log{position:fixed;right:18px;bottom:62px;z-index:20;width:min(560px,calc(100vw - 36px));max-height:55vh;overflow:auto;padding:10px;background:#fff;border:2px solid #84adff;border-radius:10px;box-shadow:0 8px 30px #0002}.execution-log-head{display:flex;justify-content:space-between}.execution-log small{display:block}.log-rows>div{display:grid;grid-template-columns:1fr 2fr auto;gap:6px;border-top:1px solid #eaecf0;padding:4px 0}.log-error{color:#b42318}.log-warn{color:#b54708}@media(max-width:1180px){.flower-products{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:760px){.my-order-page{padding:4px 8px}.title-row{align-items:flex-start;gap:5px;flex-direction:column}.page-actions{justify-content:flex-start}.grid-head{display:none}.flower-products{grid-template-columns:1fr}.product-row{grid-template-columns:minmax(110px,1fr) 54px 76px 56px 66px}.flower-toggle{top:0}.flower-toggle span{align-items:flex-start;flex-direction:column;gap:0}.choice-buttons button{flex:1 0 28%}.customers button{flex-basis:46%}.results{grid-template-columns:1fr}}
      .catalog-search{margin-top:4px}.catalog-search>button{min-height:27px;padding:2px 7px;font-weight:700;color:#475467;background:#f8fafc}.catalog-search>button.catalog-open{color:#1849a9;border-color:#84adff;background:#eef4ff}.flower-group.has-entered{border-color:#84adff;box-shadow:0 0 0 1px #dbe7ff}.flower-group.has-entered .flower-toggle{background:#e8f1ff}.product-row.has-input{border-color:#2e90fa;background:#eff8ff;box-shadow:inset 3px 0 #1570ef}
      .customers button span{display:flex;gap:6px;align-items:center}.customers button i{font-size:10px;font-style:normal;padding:2px 5px;border-radius:10px;background:#dbeafe;color:#1d4ed8}.customers button.active i{background:white}
      .customers button.cursor{outline:3px solid #f79009;outline-offset:1px}.entry-layout{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:8px;align-items:start}.product-workspace{min-width:0}.product-scroll{max-height:calc(100vh - 245px);min-height:430px;overflow:auto;border:1px solid #dce3ec;border-radius:8px}.side-tools{position:sticky;top:48px;margin-top:4px;max-height:calc(100vh - 145px);overflow:auto;display:flex;flex-direction:column;gap:6px}.variety-nav{padding:6px;background:#eef4ff;border:1px solid #b2ccff;border-radius:9px}.variety-nav>strong{display:block;margin-bottom:4px;color:#1849a9}.variety-nav>div{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:3px}.variety-nav button{display:flex;justify-content:space-between;align-items:center;min-height:27px;padding:2px 6px;text-align:left;font-weight:700}.variety-nav button small{min-width:22px;text-align:center;border-radius:10px;background:#dbe7ff;color:#1849a9}.live-order{padding:7px;background:#fffaeb;border:1px solid #fedf89;border-radius:9px}.live-order>strong{display:block;margin-bottom:5px}.live-order>p{margin:0;color:#667085;font-size:13px}.live-order>div{display:flex;flex-direction:column;gap:3px}.live-order button{width:100%;display:grid;grid-template-columns:minmax(0,1fr) auto 18px;align-items:center;gap:6px;min-height:34px;background:white;text-align:left}.live-order button span{display:flex;min-width:0;flex-direction:column;overflow:hidden}.live-order button span small,.live-order button span strong{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.live-order button b{color:#155eef;white-space:nowrap}.live-order button i{font-style:normal;color:#b42318;font-size:17px}.flower-group{scroll-margin-top:8px}
      .customer-tools{display:flex;gap:5px}.customer-tools input{flex:1;max-width:360px}.customer-tools button{white-space:nowrap}
      .focus-bar{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:8px;padding:5px 8px;background:#eef4ff;border:1px solid #b2ccff;border-radius:8px}.focus-bar strong{font-size:16px}.focus-bar span{color:#475467;margin-right:auto}.focus-bar button{min-height:34px}
      .pinned-favorites{position:sticky;top:44px;z-index:4;display:flex;align-items:center;gap:4px;padding:4px 7px;background:#fffaeb;border:1px solid #fedf89;border-radius:8px;overflow-x:auto}.pinned-favorites>b{white-space:nowrap;color:#93370d}.pinned-favorites button{display:flex;align-items:center;gap:5px;white-space:nowrap;min-height:30px;font-weight:700}.pinned-favorites small{color:#b54708}.templates{margin:5px 0;padding:7px;background:#f9fafb;border:1px solid #d0d5dd;border-radius:9px}.templates-head{display:flex;justify-content:space-between;align-items:center}.templates-head div{display:flex;flex-direction:column}.template-browser{display:grid;grid-template-columns:minmax(470px,1fr) minmax(430px,1.15fr);gap:10px;align-items:start}.template-columns{display:grid;grid-template-columns:1fr;gap:5px}.template-columns h3{margin:6px 0 3px;font-size:14px}.template-columns article{display:flex;gap:4px;margin-bottom:3px}.template-main{flex:1;display:flex;justify-content:space-between;align-items:center;text-align:left}.template-main.selected{border-color:#155eef;background:#eef4ff;box-shadow:0 0 0 2px #dbe7ff}.star{color:#b54708;font-weight:700}.delete-fav{color:#b42318}.preview-pane{position:sticky;top:82px;min-height:250px}.template-preview{padding:7px;border:2px solid #84adff;border-radius:8px;background:white}.preview-empty{min-height:250px;border:2px dashed #b2ccff;border-radius:8px;background:#f5f8ff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;text-align:center;color:#475467;padding:20px}.preview-empty b{color:#1849a9}.preview-title{display:flex;justify-content:space-between;align-items:center;gap:8px}.preview-title>div{display:flex;flex-direction:column}.load-template{background:#155eef;color:white;font-weight:800}.preview-items{display:grid;grid-template-columns:1fr;gap:2px;margin-top:6px;max-height:430px;overflow:auto}.preview-items>div{display:grid;grid-template-columns:90px minmax(0,1fr) auto;gap:6px;padding:3px 5px;border-bottom:1px solid #eaecf0}.preview-items span{color:#667085;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.preview-items b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.preview-items strong{color:#155eef;white-space:nowrap}@media(max-width:900px){.template-browser{grid-template-columns:1fr}.preview-pane{position:static}.template-columns{grid-template-columns:1fr 1fr}}@media(max-width:760px){.template-columns{grid-template-columns:1fr}.focus-bar{flex-wrap:wrap}.focus-bar span{width:100%}.pinned-favorites{top:76px}}
      .product-row select{min-height:28px;height:28px;padding:1px 5px;border:1px solid #84adff;border-radius:8px;background:#fff;font-size:15px}.conversion-error{color:#b42318}
      .grid-head{padding-block:2px}.product-row{grid-template-columns:minmax(142px,1fr) 62px 62px 53px 68px;gap:2px;min-height:27px;padding:0 3px}.product-row input{min-height:23px;height:23px;padding-inline:4px}.product-row strong{font-size:11px;letter-spacing:-.25px}.live-order{padding:5px}.live-order>strong{margin-bottom:3px}.live-order>div{gap:2px}.live-order button{grid-template-columns:minmax(0,1fr) auto 14px;gap:4px;min-height:27px;padding:2px 5px}.live-order button span{display:block}.live-order button span strong{display:block;font-size:12px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.live-order button b{font-size:12px}.live-order button i{font-size:14px}
      @media(max-width:1050px){.entry-layout{grid-template-columns:1fr}.side-tools{position:static;max-height:none;order:2}.variety-nav>div{flex-direction:row;overflow-x:auto}.variety-nav button{flex:0 0 auto;gap:8px}.live-order{max-height:260px;overflow:auto}.live-order>div{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:760px){.product-row{grid-template-columns:1fr 1fr}}@media(max-width:620px){.live-order>div{grid-template-columns:1fr}}
      .live-order .live-order-name small{display:block;font-size:11px;color:#667085}.live-order>div{max-height:55vh;overflow:auto}.live-order-item{display:grid;grid-template-columns:minmax(0,1fr) auto 28px;align-items:center;gap:12px;padding:3px 5px;background:white;border:1px solid #e4e7ec;border-radius:6px;min-width:0}
      .live-order-name{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:12px}
      .live-order-quantity{display:flex;align-items:center;gap:3px;color:#155eef;white-space:nowrap}
      .live-order-quantity input{width:62px;min-width:0;min-height:28px;box-sizing:border-box;padding:2px 4px;text-align:right;font-size:14px;font-weight:700;color:#155eef;border:1px solid transparent;border-radius:4px;appearance:textfield}
      .live-order-quantity input::-webkit-inner-spin-button,.live-order-quantity input::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
      .live-order-quantity input:hover,.live-order-quantity input:focus{border-color:#84adff;background:#eff8ff;outline:2px solid #dbe7ff}
      .live-order-quantity b{font-size:12px}.live-order button.live-order-remove{display:block;width:28px;min-height:28px;padding:0;text-align:center;color:#b42318;background:#fff5f5;border-color:#fecdca;font-size:18px}
      .flower-products{align-items:start}
      @media(min-width:761px) and (max-width:1500px){.flower-products{grid-template-columns:repeat(2,minmax(0,1fr))}}
      .product-row{grid-template-columns:minmax(0,1fr) max-content 60px 56px max-content;gap:3px 5px;padding:3px 6px;align-content:start;min-height:33px}
      .product-row .product-name{grid-column:auto;white-space:normal;overflow:visible;text-overflow:clip;overflow-wrap:anywhere;line-height:1.35;font-size:13px}
      .product-row .product-name b{white-space:normal;overflow-wrap:anywhere}
      .product-row strong{font-size:11px;color:#475467}.product-row input{width:100%;box-sizing:border-box}.product-row:hover{background:#f8fbff}.product-row.has-input{background:#eff8ff}
      .live-order-name,.live-order-name strong{white-space:normal;overflow:visible;text-overflow:clip;overflow-wrap:anywhere;line-height:1.4}
      @media(max-width:760px){.product-row{grid-template-columns:minmax(0,1fr) max-content 54px 52px max-content;gap:3px}}
    `}</style>
  </>;
}
