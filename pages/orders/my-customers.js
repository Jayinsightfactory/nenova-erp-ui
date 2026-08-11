import Head from 'next/head';
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiGet, apiPost } from '../../lib/useApi';
import { buildForwardOrderWeeks } from '../../lib/myCustomerOrderEntry';

const currentYear = new Date().getFullYear();
const label = p => p.DisplayName || p.ProdName;

export default function MyCustomerOrders() {
  const [year, setYear] = useState(String(currentYear));
  const weekChoices = useMemo(() => buildForwardOrderWeeks(new Date()), []);
  const [week, setWeek] = useState(() => weekChoices[0]?.week || '');
  const [customers, setCustomers] = useState([]);
  const [custKey, setCustKey] = useState('');
  const [products, setProducts] = useState([]);
  const [qty, setQty] = useState({});
  const [search, setSearch] = useState('');
  const [searchRows, setSearchRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const refs = useRef([]);

  useEffect(() => {
    apiGet('/api/orders/my-customers').then((c) => {
      setCustomers(c.customers || []); if (c.customers?.[0]) setCustKey(String(c.customers[0].CustKey));
    }).catch(e => setMessage(e.message));
  }, []);

  const load = async () => {
    if (!custKey || !week) return;
    setBusy(true); setMessage('');
    try { const d = await apiGet('/api/orders/my-customers', { custKey, year, week }); setProducts(d.products || []); setQty({}); }
    catch (e) { setMessage(e.message); } finally { setBusy(false); }
  };
  useEffect(() => { load(); }, [custKey, year, week]);

  const changed = useMemo(() => products.filter(p => Number(qty[p.ProdKey] || 0) > 0), [products, qty]);
  const doSearch = async e => {
    e?.preventDefault(); if (!search.trim()) return setSearchRows([]);
    setBusy(true); try { const d = await apiGet('/api/products/search', { q: search.trim() }); setSearchRows((d.products || []).slice(0, 30)); } catch (x) { setMessage(x.message); } finally { setBusy(false); }
  };
  const addProduct = p => {
    if (!products.some(x => Number(x.ProdKey) === Number(p.ProdKey))) setProducts(v => [...v, { ...p, CurrentQty: 0, UsageCount: 0 }]);
    setSearchRows([]); setSearch(''); setTimeout(() => refs.current[products.length]?.focus(), 0);
  };
  const move = (e, i) => {
    if (!['ArrowUp','ArrowLeft','ArrowDown','ArrowRight','Enter'].includes(e.key)) return;
    e.preventDefault(); const step = ['ArrowUp','ArrowLeft'].includes(e.key) ? -1 : 1;
    refs.current[Math.max(0, Math.min(products.length - 1, i + step))]?.focus();
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
      await load(); setMessage(`${d.message} · 주문원장 재조회 완료`);
    } catch (e) { setMessage(e.message); } finally { setBusy(false); }
  };

  let lastFlower = '';
  return <>
    <Head><title>내 업체 주문등록</title></Head>
    <main className="my-order-page">
      <div className="title-row"><div><h1>내 업체 주문등록</h1><p>담당 업체의 자주 주문한 품목에 수량만 추가합니다.</p></div><button onClick={load} disabled={busy}>최신 다시불러오기</button></div>
      <section className="filters">
        <div className="pick-group"><b>등록 차수</b><div className="choice-buttons">{weekChoices.map(w=><button key={`${w.year}-${w.week}`} className={year===w.year&&week===w.week?'active':''} aria-pressed={year===w.year&&week===w.week} onClick={()=>{setYear(w.year);setWeek(w.week)}}>{w.year!==String(currentYear)&&<small>{w.year}년 </small>}{w.label}</button>)}</div><small>오늘 기준 2차 앞부터, 각 차수의 1·2 세부차수입니다.</small></div>
        <div className="pick-group"><b>업체 선택 <em>{customers.length}곳</em></b><div className="choice-buttons customers">{customers.map(c=><button key={c.CustKey} className={String(custKey)===String(c.CustKey)?'active':''} aria-pressed={String(custKey)===String(c.CustKey)} onClick={()=>setCustKey(String(c.CustKey))}><span>{c.CustName}{Number(c.IsMine)===1&&<i>내 업체</i>}</span><small>{c.ManagerName}{c.CustArea?` · ${c.CustArea}`:''}</small></button>)}</div>{!customers.length&&<small>선택 가능한 활성 업체가 없습니다.</small>}</div>
      </section>
      <form className="search" onSubmit={doSearch}><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="다른 품종·품목 검색"/><button disabled={busy}>검색 추가</button></form>
      {searchRows.length>0 && <div className="results">{searchRows.map(p=><button key={p.ProdKey} onClick={()=>addProduct(p)}><b>{p.FlowerName}</b> {label(p)} <span>{p.CounName} · {p.OutUnit}</span></button>)}</div>}
      {message && <div className="notice" role="status" aria-live="polite">{message}</div>}
      <div className="grid-head"><span>품종 / 품목</span><span>사용</span><span>현재</span><span>이번 추가수량</span><span>등록 후</span></div>
      <div className="product-list">{products.map((p,i)=>{ const group=p.FlowerName!==lastFlower; lastFlower=p.FlowerName; return <div key={p.ProdKey}>{group&&<h2>{p.FlowerName || '기타'}</h2>}<div className="product-row"><span><b>{label(p)}</b><small>{p.CounName} · {p.ProdName}</small></span><span>{p.UsageCount}회</span><span>{Number(p.CurrentQty||0)} {p.OutUnit}</span><input ref={el=>refs.current[i]=el} value={qty[p.ProdKey]||''} onChange={e=>setQty(v=>({...v,[p.ProdKey]:e.target.value}))} onKeyDown={e=>move(e,i)} type="number" min="0" step="any" placeholder="0" aria-label={`${label(p)} 추가 수량`}/><strong>{Number(p.CurrentQty||0)+Number(qty[p.ProdKey]||0)} {p.OutUnit}</strong></div></div>})}</div>
      {!busy && products.length===0 && <div className="empty">이 업체의 기존 주문 품목이 없습니다. 검색으로 품목을 추가하세요.</div>}
      <div className="submit"><span>{changed.length}개 품목 추가</span><button onClick={submit} disabled={busy||!changed.length}>{busy?'처리 중...':'주문등록'}</button></div>
    </main>
    <style jsx>{`
      .my-order-page{max-width:1180px;margin:auto;padding:24px}.title-row,.search,.product-row,.grid-head,.submit{display:flex;gap:12px;align-items:center}.title-row{justify-content:space-between}h1{margin:0}p,small{color:#667085}button,input{min-height:42px;border:1px solid #d0d5dd;border-radius:8px;padding:8px 12px;background:white}.filters{padding:16px;background:#f8fafc;border-radius:12px;display:grid;gap:16px}.pick-group{display:grid;gap:8px}.pick-group b{font-size:14px}.pick-group em{font-style:normal;color:#155eef}.choice-buttons{display:flex;flex-wrap:wrap;gap:8px}.choice-buttons button{min-width:68px;font-weight:700}.choice-buttons button.active{border-color:#155eef;background:#155eef;color:white;box-shadow:0 0 0 2px #dbe7ff}.choice-buttons button small{color:inherit}.customers button{display:flex;flex-direction:column;align-items:flex-start;min-width:120px}.customers button small{font-weight:400}.search{margin-top:14px}.search input{flex:1}.results{display:grid;grid-template-columns:repeat(2,1fr);gap:6px;padding:10px;background:#f8fafc}.results button{text-align:left}.results span{color:#667085}.notice{margin:12px 0;padding:12px;background:#eef4ff;color:#1849a9;border-radius:8px}.grid-head,.product-row{display:grid;grid-template-columns:minmax(300px,1fr) 70px 120px 150px 120px;gap:10px}.grid-head{padding:12px;font-weight:700;color:#475467}.product-list h2{font-size:16px;margin:16px 0 4px;padding:8px;background:#eef2f6}.product-row{padding:8px 12px;border-bottom:1px solid #eaecf0}.product-row span:first-child{display:flex;flex-direction:column}.product-row input{text-align:right;font-size:17px;border-color:#84adff}.empty{text-align:center;padding:48px;color:#667085}.submit{position:sticky;bottom:0;justify-content:flex-end;background:white;border-top:1px solid #ddd;padding:14px}.submit button{background:#155eef;color:white;font-weight:800;min-width:160px}.submit button:disabled{opacity:.5}@media(max-width:760px){.my-order-page{padding:12px}.grid-head{display:none}.product-row{grid-template-columns:1fr 1fr}.product-row span:first-child{grid-column:1/-1}.choice-buttons button{flex:1 0 28%}.customers button{flex-basis:46%}.results{grid-template-columns:1fr}}
      .customers button span{display:flex;gap:6px;align-items:center}.customers button i{font-size:10px;font-style:normal;padding:2px 5px;border-radius:10px;background:#dbeafe;color:#1d4ed8}.customers button.active i{background:white}
    `}</style>
  </>;
}
