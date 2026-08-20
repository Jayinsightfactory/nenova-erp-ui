import Head from 'next/head';
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiDelete, apiGet, apiPost } from '../../lib/useApi';
import { buildForwardOrderWeeks, productAlphabetInitial } from '../../lib/myCustomerOrderEntry';

const currentYear = new Date().getFullYear();
const label = p => p.DisplayName || p.ProdName;
const groupLabel = p => p.CountryFlower || p.FlowerName || '기타';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const ORDER_FAVORITE_PAGE = 'my-customer-order-template';

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
  const [focusMode, setFocusMode] = useState(false);
  const [collapsedFlowers, setCollapsedFlowers] = useState({});
  const [custKey, setCustKey] = useState('');
  const [products, setProducts] = useState([]);
  const [qty, setQty] = useState({});
  const [search, setSearch] = useState('');
  const [searchRows, setSearchRows] = useState([]);
  const [productQuery, setProductQuery] = useState('');
  const [productLetter, setProductLetter] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [showTemplates, setShowTemplates] = useState(false);
  const [history, setHistory] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [templateBusy, setTemplateBusy] = useState(false);
  const refs = useRef({});
  const groupRefs = useRef({});
  const productAreaRef = useRef(null);
  const customerRefs = useRef({});
  const scrollAfterLoadRef = useRef(false);
  const loadSequenceRef = useRef(0);

  useEffect(() => {
    apiGet('/api/orders/my-customers').then((c) => {
      setCustomers(c.customers || []); if (c.customers?.[0]) setCustKey(String(c.customers[0].CustKey));
    }).catch(e => setMessage(e.message));
  }, []);

  const load = async () => {
    if (!custKey || !week) return;
    const sequence = ++loadSequenceRef.current;
    setBusy(true); setMessage('');
    try { const d = await apiGet('/api/orders/my-customers', { custKey, year, week }); if (sequence !== loadSequenceRef.current) return; setProducts(d.products || []); setQty({}); setCollapsedFlowers({}); setProductQuery(''); setProductLetter(''); if (scrollAfterLoadRef.current) setTimeout(()=>productAreaRef.current?.scrollIntoView({behavior:'smooth',block:'start'}),0); }
    catch (e) { if (sequence === loadSequenceRef.current) setMessage(e.message); } finally { if (sequence === loadSequenceRef.current) setBusy(false); }
    scrollAfterLoadRef.current = false;
  };
  useEffect(() => { load(); }, [custKey, year, week]);

  const changed = useMemo(() => products.filter(p => Number(qty[p.ProdKey] || 0) > 0), [products, qty]);
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
    if (!focusMode || !custKey) return;
    setSelectedTemplate(null);
    loadCustomerFavorites(custKey).catch(() => setFavorites([]));
  }, [focusMode, custKey]);
  const loadTemplates = async () => {
    if (!custKey) return;
    setTemplateBusy(true); setMessage(''); setShowTemplates(true);
    try {
      const [ordersData] = await Promise.all([
        apiGet('/api/orders/my-customers', { view: 'history', custKey, year, week }),
        loadCustomerFavorites(custKey),
      ]);
      setHistory(ordersData.orders || []);
      setSelectedTemplate(null);
    } catch (e) { setMessage(`고정주문 조회 실패: ${e.message}`); }
    finally { setTemplateBusy(false); }
  };
  const applyTemplate = template => {
    const valid = new Map(products.map(p => [Number(p.ProdKey), p]));
    const nextQty = {};
    for (const item of template.items || []) if (valid.has(Number(item.prodKey)) && Number(item.qty) > 0) nextQty[item.prodKey] = String(Number(item.qty));
    setQty(nextQty); setShowTemplates(false); setSelectedTemplate(null);
    setMessage(`${template.name || `${template.year}년 ${template.week}`} 주문 ${Object.keys(nextQty).length}개 품목을 불러왔습니다. 수량 수정·삭제 후 주문등록하세요.`);
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
    setFocusMode(true); scrollAfterLoadRef.current = true;
    if (String(key) === String(custKey)) setTimeout(()=>productAreaRef.current?.scrollIntoView({behavior:'smooth',block:'start'}),0);
    else setCustKey(String(key));
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
    e?.preventDefault(); if (!search.trim()) return setSearchRows([]);
    setBusy(true); try { const d = await apiGet('/api/products/search', { q: search.trim() }); setSearchRows((d.products || []).slice(0, 30)); } catch (x) { setMessage(x.message); } finally { setBusy(false); }
  };
  const addProduct = p => {
    if (!products.some(x => Number(x.ProdKey) === Number(p.ProdKey))) setProducts(v => [...v, { ...p, CurrentQty: 0, UsageCount: 0 }]);
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
  const submit = async () => {
    if (!changed.length) return setMessage('추가할 수량을 입력하세요.');
    const customer = customers.find(c => String(c.CustKey) === String(custKey));
    const summary = changed.map(p => `${label(p)} ${qty[p.ProdKey]}${p.OutUnit || ''}`).join('\n');
    if (!window.confirm(`${customer?.CustName} / ${year}년 ${week}\n\n${summary}\n\n기존 주문에 위 수량을 추가할까요?`)) return;
    setBusy(true); setMessage('');
    try {
      const d = await apiPost('/api/orders', { source: 'my-customer', custKey: Number(custKey), custName: customer?.CustName, year, week,
        items: changed.map(p => ({ prodKey: p.ProdKey, prodName: p.ProdName, qty: Number(qty[p.ProdKey]), unit: p.OutUnit, expectedCurrentQty: Number(p.CurrentQty || 0) })) });
      await load(); const resultMessage = `${d.message} · 주문원장 재조회 완료`; setMessage(resultMessage); window.alert(resultMessage);
    } catch (e) { setMessage(e.message); } finally { setBusy(false); }
  };

  return <>
    <Head><title>내 업체 주문등록</title></Head>
    <main className={`my-order-page${focusMode?' is-focus':''}`}>
      {focusMode ? <><div className="focus-bar"><strong>{year}년 {week} · {selectedCustomer?.CustName}{selectedCustomer?.OrderCode?` · ${selectedCustomer.OrderCode}`:''}</strong><span>{selectedCustomer?.ManagerName}{selectedCustomer?.CustArea?` · ${selectedCustomer.CustArea}`:''}</span><button onClick={loadTemplates} disabled={busy||templateBusy}>{templateBusy?'불러오는 중':'고정주문 불러오기'}</button><button onClick={()=>{setFocusMode(false);setShowTemplates(false);setSelectedTemplate(null);window.scrollTo({top:0,behavior:'smooth'})}}>차수·업체 다시 선택</button><button onClick={load} disabled={busy}>새로고침</button></div>{favorites.length>0&&<div className="pinned-favorites"><b>★ 고정 주문</b>{favorites.map(fav=><button type="button" key={fav.favoriteKey} onClick={()=>{setSelectedTemplate(fav);setShowTemplates(true)}}>{fav.name}<small>{fav.items?.length||0}개</small></button>)}</div>}</> : <>
      <div className="title-row"><div><h1>내 업체 주문등록</h1><p>차수와 업체를 선택하면 품종·품목 입력 화면만 표시됩니다.</p></div><button onClick={load} disabled={busy}>최신 다시불러오기</button></div>
      <section className="filters">
        <div className="pick-group"><b>등록 차수</b><div className="choice-buttons">{weekChoices.map(w=><button key={`${w.year}-${w.week}`} className={year===w.year&&week===w.week?'active':''} aria-pressed={year===w.year&&week===w.week} onClick={()=>{setYear(w.year);setWeek(w.week)}}>{w.year!==String(currentYear)&&<small>{w.year}년 </small>}{w.label}</button>)}</div><small>현재 차수 -2부터 표시합니다. 기본 선택은 +2차이며, 각 차수의 1·2 세부차수입니다.</small></div>
        <div className="pick-group"><b>업체 선택 <em>{customers.length}곳 · 최근 주문순</em></b><div className="customer-tools"><input value={customerQuery} onChange={e=>setCustomerQuery(e.target.value)} onKeyDown={moveCustomer} placeholder="업체명·담당자 검색" aria-label="업체 검색" aria-activedescendant={customerCursor>=0?`customer-${visibleCustomers[customerCursor]?.CustKey}`:undefined}/><button onClick={()=>setShowAllCustomers(v=>!v)}>{showAllCustomers?'최근 업체만':'전체 업체 보기'}</button></div><small>업체명 입력 후 ↑↓로 이동하고 Enter로 선택하세요.</small><div className="choice-buttons customers">{visibleCustomers.map((c,i)=><button ref={el=>customerRefs.current[c.CustKey]=el} id={`customer-${c.CustKey}`} key={c.CustKey} className={`${String(custKey)===String(c.CustKey)?'active':''} ${i===customerCursor?'cursor':''}`} aria-pressed={String(custKey)===String(c.CustKey)} onMouseEnter={()=>setCustomerCursor(i)} onClick={()=>selectCustomer(c.CustKey)}><span>{c.CustName}{c.OrderCode&&<mark>{c.OrderCode}</mark>}{Number(c.IsMine)===1&&<i>내 업체</i>}</span><small>{c.ManagerName}{c.CustArea?` · ${c.CustArea}`:''}{c.LastOrderWeek?` · 최근 ${c.LastOrderWeek}`:' · 주문이력 없음'}</small></button>)}</div>{!customers.length&&<small>선택 가능한 활성 업체가 없습니다.</small>}{!customerQuery&&!showAllCustomers&&customers.length>30&&<small>최근 주문업체 30곳만 표시 중입니다. 검색하거나 전체 업체 보기를 누르세요.</small>}</div>
      </section>
      </>}
      {showTemplates&&<section className="templates"><div className="templates-head"><div><b>고정주문 불러오기</b><small>{year}년 {week}보다 이전 주문 또는 즐겨찾기를 선택해 내역을 확인한 뒤 불러옵니다. 확인만으로 기존 원장은 변경되지 않습니다.</small></div><button onClick={()=>{setShowTemplates(false);setSelectedTemplate(null)}}>닫기</button></div><div className="template-browser"><div className="template-columns"><div><h3>지난 차수 주문</h3>{history.length?history.map(order=><article key={order.id}><button className={`template-main ${selectedTemplate?.id===order.id?'selected':''}`} onClick={()=>setSelectedTemplate({...order,name:`${order.year}년 ${order.week}`})}><b>{order.year}년 {order.week}</b><small>{order.items.length}개 품목 · {String(order.date||'').slice(0,10)}</small></button><button className="star" onClick={()=>saveFavorite(order)} aria-label={`${order.year}년 ${order.week} 즐겨찾기`}>☆ 즐겨찾기</button></article>):<p>같은 연도의 이전 주문 이력이 없습니다.</p>}</div><div><h3>내 주문 즐겨찾기</h3>{favorites.length?favorites.map(fav=><article key={fav.favoriteKey}><button className={`template-main ${selectedTemplate?.favoriteKey===fav.favoriteKey?'selected':''}`} onClick={()=>setSelectedTemplate(fav)}><b>★ {fav.name}</b><small>{fav.items?.length||0}개 품목 · 원본 {fav.sourceYear||''} {fav.sourceWeek||''}</small></button><button className="delete-fav" onClick={()=>removeFavorite(fav.favoriteKey)} aria-label={`${fav.name} 삭제`}>삭제</button></article>):<p>저장된 즐겨찾기가 없습니다.</p>}</div></div><aside className="preview-pane">{selectedTemplate?<div className="template-preview"><div className="preview-title"><div><b>{selectedTemplate.name||`${selectedTemplate.year}년 ${selectedTemplate.week}`} 주문내역</b><small>{selectedTemplate.items?.length||0}개 품목을 확인한 뒤 불러오세요.</small></div><button className="load-template" onClick={()=>applyTemplate(selectedTemplate)}>이 주문 불러오기</button></div><div className="preview-items">{(selectedTemplate.items||[]).map(item=><div key={item.prodKey}><span>{item.countryFlower||item.flowerName||''}</span><b>{item.displayName||item.prodName||products.find(p=>Number(p.ProdKey)===Number(item.prodKey))?.ProdName||`품목 ${item.prodKey}`}</b><strong>{Number(item.qty)} {item.unit||''}</strong></div>)}</div></div>:<div className="preview-empty"><b>주문을 선택하세요</b><span>왼쪽에서 지난 차수 또는 즐겨찾기를 선택하면 이곳에 주문 품목과 수량이 표시됩니다.</span></div>}</aside></div></section>}
      <div className="entry-layout"><section className="product-workspace"><form className="search" onSubmit={doSearch}><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="다른 품종·품목 검색"/><button disabled={busy}>검색 추가</button></form>
      {searchRows.length>0 && <div className="results">{searchRows.map(p=><button key={p.ProdKey} onClick={()=>addProduct(p)}><b>{groupLabel(p)}</b> {label(p)} <span>{p.CounName} · {p.OutUnit}</span></button>)}</div>}
      <div className="product-filter"><div><input value={productQuery} onChange={e=>setProductQuery(e.target.value)} placeholder="현재 품종·품목 검색" aria-label="현재 품종과 품목 검색"/><button type="button" onClick={()=>{setProductQuery('');setProductLetter('')}}>초기화</button></div></div>
      <div className="alphabet-bar"><div className="alphabet" aria-label="품목명 알파벳 필터"><button type="button" className={!productLetter?'active':''} onClick={()=>setProductLetter('')}>전체</button>{ALPHABET.map(letter=><button type="button" key={letter} className={productLetter===letter?'active':''} aria-pressed={productLetter===letter} onClick={()=>setProductLetter(letter)}>{letter}</button>)}</div></div>
      {message && <div className="notice" role="status" aria-live="polite">{message}</div>}
      <div className="product-scroll">
      <div ref={productAreaRef} className="grid-head"><span>품종 / 품목</span><span>사용</span><span>현재</span><span>이번 추가수량</span><span>등록 후</span></div>
      <div className="product-list">{filteredProductGroups.map(group=>{ const collapsed=Boolean(collapsedFlowers[group.flowerName]); const entered=group.products.filter(p=>Number(qty[p.ProdKey]||0)>0); const panelId=`flower-${String(group.flowerName).replace(/[^a-zA-Z0-9가-힣_-]/g,'-')}`; return <section ref={el=>groupRefs.current[group.flowerName]=el} className="flower-group" key={group.flowerName}><button type="button" className="flower-toggle" aria-expanded={!collapsed} aria-controls={panelId} onClick={()=>setCollapsedFlowers(v=>({...v,[group.flowerName]:!v[group.flowerName]}))}><span><b>{group.flowerName}</b><small>{group.products.length}개 품목{entered.length>0?` · 수량 입력 ${entered.length}개`:''}</small></span><strong>{collapsed?'열기':'닫기'} <i aria-hidden="true">{collapsed?'▾':'▴'}</i></strong></button>{!collapsed&&<div className="flower-products" id={panelId}>{group.products.map(p=><div className="product-row" key={p.ProdKey}><span className="product-name"><b>{label(p)}</b>{p.CounName&&<small> · {p.CounName}</small>}</span><span>{p.UsageCount}회</span><span>{Number(p.CurrentQty||0)} {p.OutUnit}</span><input ref={el=>refs.current[p.ProdKey]=el} value={qty[p.ProdKey]||''} onChange={e=>setQty(v=>({...v,[p.ProdKey]:e.target.value}))} onKeyDown={e=>move(e,p.ProdKey)} type="number" min="0" step="any" placeholder="0" aria-label={`${label(p)} 추가 수량`}/><strong>{Number(p.CurrentQty||0)+Number(qty[p.ProdKey]||0)} {p.OutUnit}</strong></div>)}</div>}</section>})}</div>
      {products.length>0&&filteredProductGroups.length===0&&<div className="empty">검색 또는 알파벳 조건에 맞는 품목이 없습니다.</div>}
      {!busy && products.length===0 && <div className="empty">이 업체의 기존 주문 품목이 없습니다. 검색으로 품목을 추가하세요.</div>}</div></section>
      <aside className="side-tools"><nav className="variety-nav" aria-label="품종 바로가기"><strong>품종 바로가기</strong><div>{filteredProductGroups.map(group=><button type="button" key={group.flowerName} onClick={()=>jumpToFlower(group.flowerName)}><span>{group.flowerName}</span><small>{group.products.length}</small></button>)}</div></nav><div className="live-order" aria-live="polite"><strong>입력 품목 {changed.length}개</strong>{changed.length>0?<div>{changed.map(p=><button type="button" key={p.ProdKey} onClick={()=>setQty(v=>({...v,[p.ProdKey]:''}))} title="입력 수량 지우기"><span><small>{groupLabel(p)}</small><strong>{label(p)}</strong></span><b>{qty[p.ProdKey]} {p.OutUnit}</b><i aria-hidden="true">×</i></button>)}</div>:<p>수량을 입력하면 이곳에 목록으로 표시됩니다.</p>}</div></aside></div>
      <div className="submit"><span>{changed.length}개 품목 추가</span><button onClick={submit} disabled={busy||!changed.length}>{busy?'처리 중...':'주문등록'}</button></div>
    </main>
    <style jsx>{`
      .my-order-page{max-width:1180px;margin:auto;padding:6px 16px}.title-row,.search,.product-row,.grid-head,.submit{display:flex;gap:8px;align-items:center}.title-row{justify-content:space-between}.title-row p{margin:1px 0 4px}h1{margin:0;font-size:24px}p,small{color:#667085}button,input{min-height:34px;border:1px solid #d0d5dd;border-radius:8px;padding:4px 9px;background:white}.filters{padding:6px 9px;background:#f8fafc;border-radius:10px;display:grid;gap:6px}.pick-group{display:grid;gap:3px}.pick-group b{font-size:14px}.pick-group em{font-style:normal;color:#155eef}.choice-buttons{display:flex;flex-wrap:wrap;gap:4px}.choice-buttons button{min-width:68px;font-weight:700}.choice-buttons button.active{border-color:#155eef;background:#155eef;color:white;box-shadow:0 0 0 2px #dbe7ff}.choice-buttons button small{color:inherit}.customers button{display:flex;flex-direction:column;align-items:flex-start;min-width:120px}.customers button small{font-weight:400}.customers mark{background:#fef0c7;color:#93370d;border-radius:5px;padding:1px 4px;font-size:10px}.search{margin-top:4px}.search input{flex:1}.results{display:grid;grid-template-columns:repeat(2,1fr);gap:3px;padding:4px;background:#f8fafc}.results button{text-align:left}.results span{color:#667085}.product-filter{margin-top:4px;padding:5px;background:#f8fafc;border-radius:9px}.product-filter>div:first-child{display:flex;gap:4px}.product-filter input{flex:1}.alphabet-bar{position:sticky;top:0;z-index:6;margin-top:3px;padding:4px 5px;background:#f8fafc;border:1px solid #dce3ec;border-radius:8px}.alphabet{display:flex;flex-wrap:nowrap;gap:2px;overflow-x:auto}.alphabet button{min-width:29px;min-height:28px;padding:2px 5px;font-weight:700;flex:0 0 auto}.alphabet button.active{background:#155eef;color:white;border-color:#155eef}.notice{margin:4px 0;padding:5px 9px;background:#eef4ff;color:#1849a9;border-radius:8px}.grid-head,.product-row{display:grid;grid-template-columns:minmax(300px,1fr) 70px 120px 150px 120px;gap:8px}.grid-head{padding:4px 10px;font-weight:700;color:#475467}.flower-group{margin-top:4px;border:1px solid #dce3ec;border-radius:9px;overflow:visible}.flower-toggle{position:sticky;top:0;z-index:3;width:100%;display:flex;justify-content:space-between;align-items:center;border:0;border-radius:8px 8px 0 0;background:#eef2f6;padding:4px 10px;text-align:left;box-shadow:0 1px 0 #dce3ec}.flower-toggle span{display:flex;align-items:baseline;gap:8px}.flower-toggle b{font-size:16px;color:#1d2939}.flower-toggle strong{color:#155eef}.flower-toggle i{font-style:normal}.product-row{padding:1px 10px;border-bottom:1px solid #eaecf0;min-height:34px}.product-row:last-child{border-bottom:0}.product-name{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.product-name b,.product-name small{display:inline}.product-row input{min-height:30px;height:30px;padding-block:1px;text-align:right;font-size:16px;border-color:#84adff}.empty{text-align:center;padding:16px;color:#667085}.submit{position:sticky;bottom:0;justify-content:flex-end;background:white;border-top:1px solid #ddd;padding:5px 10px}.submit button{background:#155eef;color:white;font-weight:800;min-width:160px}.submit button:disabled{opacity:.5}@media(max-width:760px){.my-order-page{padding:4px 8px}.grid-head{display:none}.product-row{grid-template-columns:1fr 1fr}.product-name{grid-column:1/-1}.flower-toggle{top:0}.flower-toggle span{align-items:flex-start;flex-direction:column;gap:0}.choice-buttons button{flex:1 0 28%}.customers button{flex-basis:46%}.results{grid-template-columns:1fr}}
      .customers button span{display:flex;gap:6px;align-items:center}.customers button i{font-size:10px;font-style:normal;padding:2px 5px;border-radius:10px;background:#dbeafe;color:#1d4ed8}.customers button.active i{background:white}
      .customers button.cursor{outline:3px solid #f79009;outline-offset:1px}.entry-layout{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:10px;align-items:start}.product-workspace{min-width:0}.side-tools{position:sticky;top:48px;margin-top:6px;max-height:calc(100vh - 115px);overflow:auto;display:flex;flex-direction:column;gap:6px}.variety-nav{padding:7px;background:#eef4ff;border:1px solid #b2ccff;border-radius:9px}.variety-nav>strong{display:block;margin-bottom:5px;color:#1849a9}.variety-nav>div{display:flex;flex-direction:column;gap:3px}.variety-nav button{display:flex;justify-content:space-between;align-items:center;min-height:29px;padding:3px 7px;text-align:left;font-weight:700}.variety-nav button small{min-width:25px;text-align:center;border-radius:10px;background:#dbe7ff;color:#1849a9}.live-order{padding:9px;background:#fffaeb;border:1px solid #fedf89;border-radius:9px}.live-order>strong{display:block;margin-bottom:7px}.live-order>p{margin:0;color:#667085;font-size:13px}.live-order>div{display:flex;flex-direction:column;gap:5px}.live-order button{width:100%;display:grid;grid-template-columns:minmax(0,1fr) auto 18px;align-items:center;gap:7px;min-height:42px;background:white;text-align:left}.live-order button span{display:flex;min-width:0;flex-direction:column;overflow:hidden}.live-order button span small,.live-order button span strong{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.live-order button b{color:#155eef;white-space:nowrap}.live-order button i{font-style:normal;color:#b42318;font-size:18px}.flower-group{scroll-margin-top:8px}
      .my-order-page.is-focus{height:calc(100vh - 48px);max-height:calc(100vh - 48px);display:flex;flex-direction:column;overflow:hidden;padding-bottom:0}
      .my-order-page.is-focus .entry-layout{flex:1;min-height:0;overflow:hidden}
      .my-order-page.is-focus .product-workspace{display:flex;flex-direction:column;min-height:0;height:100%;overflow:hidden}
      .my-order-page.is-focus .alphabet-bar{position:relative;top:auto;flex-shrink:0}
      .my-order-page.is-focus .product-filter,.my-order-page.is-focus .search,.my-order-page.is-focus .notice{flex-shrink:0}
      .my-order-page.is-focus .product-scroll{flex:1;min-height:0;overflow:auto}
      .my-order-page.is-focus .side-tools{position:relative;top:auto;max-height:100%;margin-top:0}
      .my-order-page.is-focus .submit{position:relative;flex-shrink:0}
      .my-order-page.is-focus .focus-bar,.my-order-page.is-focus .pinned-favorites{flex-shrink:0;position:relative;top:auto}
      .customer-tools{display:flex;gap:5px}.customer-tools input{flex:1;max-width:360px}.customer-tools button{white-space:nowrap}
      .focus-bar{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:8px;padding:5px 8px;background:#eef4ff;border:1px solid #b2ccff;border-radius:8px}.focus-bar strong{font-size:16px}.focus-bar span{color:#475467;margin-right:auto}.focus-bar button{min-height:34px}
      .pinned-favorites{position:sticky;top:44px;z-index:4;display:flex;align-items:center;gap:4px;padding:4px 7px;background:#fffaeb;border:1px solid #fedf89;border-radius:8px;overflow-x:auto}.pinned-favorites>b{white-space:nowrap;color:#93370d}.pinned-favorites button{display:flex;align-items:center;gap:5px;white-space:nowrap;min-height:30px;font-weight:700}.pinned-favorites small{color:#b54708}.templates{margin:5px 0;padding:7px;background:#f9fafb;border:1px solid #d0d5dd;border-radius:9px}.templates-head{display:flex;justify-content:space-between;align-items:center}.templates-head div{display:flex;flex-direction:column}.template-browser{display:grid;grid-template-columns:minmax(470px,1fr) minmax(430px,1.15fr);gap:10px;align-items:start}.template-columns{display:grid;grid-template-columns:1fr;gap:5px}.template-columns h3{margin:6px 0 3px;font-size:14px}.template-columns article{display:flex;gap:4px;margin-bottom:3px}.template-main{flex:1;display:flex;justify-content:space-between;align-items:center;text-align:left}.template-main.selected{border-color:#155eef;background:#eef4ff;box-shadow:0 0 0 2px #dbe7ff}.star{color:#b54708;font-weight:700}.delete-fav{color:#b42318}.preview-pane{position:sticky;top:82px;min-height:250px}.template-preview{padding:7px;border:2px solid #84adff;border-radius:8px;background:white}.preview-empty{min-height:250px;border:2px dashed #b2ccff;border-radius:8px;background:#f5f8ff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;text-align:center;color:#475467;padding:20px}.preview-empty b{color:#1849a9}.preview-title{display:flex;justify-content:space-between;align-items:center;gap:8px}.preview-title>div{display:flex;flex-direction:column}.load-template{background:#155eef;color:white;font-weight:800}.preview-items{display:grid;grid-template-columns:1fr;gap:2px;margin-top:6px;max-height:430px;overflow:auto}.preview-items>div{display:grid;grid-template-columns:90px minmax(0,1fr) auto;gap:6px;padding:3px 5px;border-bottom:1px solid #eaecf0}.preview-items span{color:#667085;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.preview-items b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.preview-items strong{color:#155eef;white-space:nowrap}@media(max-width:900px){.template-browser{grid-template-columns:1fr}.preview-pane{position:static}.template-columns{grid-template-columns:1fr 1fr}}@media(max-width:760px){.template-columns{grid-template-columns:1fr}.focus-bar{flex-wrap:wrap}.focus-bar span{width:100%}.pinned-favorites{top:76px}}
      @media(max-width:1050px){.entry-layout{grid-template-columns:1fr}.side-tools{position:static;max-height:none;order:2}.variety-nav>div{flex-direction:row;overflow-x:auto}.variety-nav button{flex:0 0 auto;gap:8px}.live-order{max-height:260px;overflow:auto}.live-order>div{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:620px){.live-order>div{grid-template-columns:1fr}}
    `}</style>
  </>;
}
