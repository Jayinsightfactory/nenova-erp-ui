// pages/shipment/week-pivot.js — 차수피벗 전용 전체화면 페이지
// 사이드바 없음, 최대 너비, 독립 창으로 사용
// 빌드캐시 파기 2026-04-13c

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useWeekInput, WeekInput } from '../../lib/useWeekInput';
import * as XLSX from 'xlsx';

// 차수(예: "15-01") → 정상 출고일(YYYY-MM-DD) 변환
// 01차=월요일, 02차=목요일(+3), 03차=토요일(+5)
function weekToShipDate(weekStr, year = new Date().getFullYear()) {
  try {
    const [wStr, dStr] = weekStr.split('-');
    const weekNum = parseInt(wStr, 10);
    const delivNum = parseInt(dStr, 10) || 1;
    const jan4 = new Date(year, 0, 4);
    const dayOfWeek = jan4.getDay() || 7;
    const monday = new Date(jan4);
    monday.setDate(jan4.getDate() - dayOfWeek + 1 + (weekNum - 1) * 7);
    const offsets = [0, 0, 3, 5];
    monday.setDate(monday.getDate() + (offsets[delivNum] ?? 0));
    return `${monday.getFullYear()}-${String(monday.getMonth()+1).padStart(2,'0')}-${String(monday.getDate()).padStart(2,'0')}`;
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────
// 주문추가 모달
// ─────────────────────────────────────────────────────────────
const UNITS = ['박스', '단', '송이'];

function AddOrderModal({ weekFrom, weekTo, onClose, onSuccess }) {
  const [custSearch, setCustSearch] = useState('');
  const [prodSearch, setProdSearch] = useState('');
  const [custs,      setCusts]      = useState([]);
  const [prods,      setProds]      = useState([]);
  const [selCust,    setSelCust]    = useState(null);
  const modalWeek = useWeekInput(weekFrom || '');
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState('');
  const [selMgr,     setSelMgr]     = useState('');
  const [selCoun,    setSelCoun]    = useState('');
  const [selFlower,  setSelFlower]  = useState('');
  const [orderCounts, setOrderCounts] = useState({});
  const [prodCounts,  setProdCounts]  = useState({});
  const [existOrders, setExistOrders] = useState({});
  const [cart, setCart] = useState([]);

  useEffect(() => {
    fetch('/api/master?entity=customers').then(r=>r.json()).then(d=>{if(d.success) setCusts(d.data);});
    fetch('/api/master?entity=products').then(r=>r.json()).then(d=>{if(d.success) setProds(d.data);});
    fetch('/api/shipment/stock-status?view=custOrderCounts').then(r=>r.json()).then(d=>{if(d.success&&d.counts)setOrderCounts(d.counts);}).catch(()=>{});
    fetch('/api/shipment/stock-status?view=prodOrderCounts').then(r=>r.json()).then(d=>{if(d.success&&d.counts)setProdCounts(d.counts);}).catch(()=>{});
  }, []);

  useEffect(() => {
    if (!selCust || !modalWeek.value) { setExistOrders({}); return; }
    fetch(`/api/shipment/stock-status?view=existOrders&weekFrom=${modalWeek.value}&weekTo=${modalWeek.value}&custKey=${selCust.CustKey}`)
      .then(r=>r.json()).then(d=>{ if(d.success&&d.orders) setExistOrders(d.orders); }).catch(()=>{});
  }, [selCust, modalWeek.value]);

  const mgrList    = useMemo(() => [...new Set(custs.map(c=>c.Manager||'미지정'))].sort(), [custs]);
  const counList   = useMemo(() => [...new Set(prods.map(p=>p.CounName).filter(Boolean))].sort(), [prods]);
  const flowerList = useMemo(() => {
    const base = selCoun ? prods.filter(p=>p.CounName===selCoun) : prods;
    return [...new Set(base.map(p=>p.FlowerName).filter(Boolean))].sort();
  }, [prods, selCoun]);

  const filteredCusts = useMemo(() => {
    let list = custs;
    if (selMgr) list = list.filter(c=>(c.Manager||'미지정')===selMgr);
    if (custSearch) { const q=custSearch.toLowerCase(); list=list.filter(c=>c.CustName?.toLowerCase().includes(q)||c.CustArea?.toLowerCase().includes(q)); }
    list = [...list].sort((a,b)=>(orderCounts[b.CustKey]||0)-(orderCounts[a.CustKey]||0));
    return list.slice(0, 80);
  }, [custs, custSearch, selMgr, orderCounts]);

  const filteredProds = useMemo(() => {
    let list = prods;
    if (selCoun)   list = list.filter(p=>p.CounName===selCoun);
    if (selFlower) list = list.filter(p=>p.FlowerName===selFlower);
    if (prodSearch) { const q=prodSearch.toLowerCase(); list=list.filter(p=>p.ProdName?.toLowerCase().includes(q)||p.FlowerName?.toLowerCase().includes(q)||p.CounName?.toLowerCase().includes(q)); }
    list = [...list].sort((a,b)=>(prodCounts[b.ProdKey]||0)-(prodCounts[a.ProdKey]||0));
    return list.slice(0, 200);
  }, [prods, prodSearch, selCoun, selFlower, prodCounts]);

  // ── 분배 동시 적용 체크박스
  const [distributeSync, setDistributeSync] = useState(false);

  // 카트: { cust:{CustKey,CustName,CustArea}, prod, qty, unit, existQty }
  const addToCart = (p) => {
    if (!selCust) { setError('업체를 먼저 선택하세요'); return; }
    if (cart.find(c=>c.cust.CustKey===selCust.CustKey && c.prod.ProdKey===p.ProdKey)) return;
    const u = UNITS.includes(p.OutUnit) ? p.OutUnit : '박스';
    const existKey = `${selCust.CustKey}-${p.ProdKey}-${modalWeek.value}`;
    const existQty = existOrders[existKey] || 0;
    setCart(prev=>[...prev,{cust:{CustKey:selCust.CustKey,CustName:selCust.CustName,CustArea:selCust.CustArea||''}, prod:p, qty:existQty||1, unit:u, existQty}]);
  };
  const removeFromCart  = (ck,pk) => setCart(prev=>prev.filter(c=>!(c.cust.CustKey===ck && c.prod.ProdKey===pk)));
  const updateCartQty   = (ck,pk, val) => setCart(prev=>prev.map(c=>(c.cust.CustKey===ck&&c.prod.ProdKey===pk)?{...c,qty:parseFloat(val)||0}:c));
  const updateCartUnit  = (ck,pk, u)   => setCart(prev=>prev.map(c=>(c.cust.CustKey===ck&&c.prod.ProdKey===pk)?{...c,unit:u}:c));

  const handleSubmit = async () => {
    if (!cart.length)     { setError('품목을 1개 이상 추가하세요'); return; }
    if (!modalWeek.value) { setError('차수를 입력하세요'); return; }
    setSaving(true); setError('');
    try {
      let allOk = true;
      // 1단계: 주문등록 (delta 모드 = 분배동시 적용 시, 절대값 = 기본)
      const orderAction = distributeSync ? 'addOrderDelta' : 'addOrder';
      for (const item of cart) {
        const r = await fetch('/api/shipment/stock-status', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ action:orderAction, custKey:item.cust.CustKey, prodKey:item.prod.ProdKey, week:modalWeek.value, qty:item.qty, unit:item.unit }),
        });
        const d = await r.json();
        if (!d.success) { setError(d.error); allOk=false; break; }
      }
      // 2단계: 분배 동시 적용 (순차 실행)
      if (allOk && distributeSync) {
        for (const item of cart) {
          const r = await fetch('/api/shipment/stock-status', {
            method:'PATCH', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ custKey:item.cust.CustKey, prodKey:item.prod.ProdKey, week:modalWeek.value, outQty:item.qty, mode:'delta' }),
          });
          const d = await r.json();
          if (!d.success) { setError('분배 오류: ' + d.error); allOk=false; break; }
        }
      }
      if (allOk) { onSuccess?.({ week:modalWeek.value }); onClose(); }
    } catch(e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const chip = (active) => ({
    padding:'3px 10px', borderRadius:12, border:'1px solid', fontSize:11, cursor:'pointer', fontWeight:active?700:400,
    borderColor:active?'#1976d2':'#ccc', background:active?'#1976d2':'#f5f5f5', color:active?'#fff':'#555',
  });

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}}
         onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:'#fff',borderRadius:10,width:'95vw',height:'95vh',overflow:'auto',boxShadow:'0 8px 32px rgba(0,0,0,0.25)'}}>
        <div style={{background:'#1976d2',color:'#fff',padding:'14px 20px',borderRadius:'10px 10px 0 0',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <span style={{fontWeight:700,fontSize:16}}>주문 추가 {cart.length>0&&<span style={{fontSize:12,opacity:0.8}}>({cart.length}개 품목)</span>}</span>
          <button onClick={onClose} style={{background:'none',border:'none',color:'#fff',fontSize:20,cursor:'pointer'}}>✕</button>
        </div>
        <div style={{padding:'18px 20px'}}>
          {/* 차수 */}
          <div style={{marginBottom:14}}>
            <label style={st.label}>차수</label>
            <div style={{display:'flex',gap:4,alignItems:'center'}}>
              <button onClick={modalWeek.prevWeek} style={st.weekBigBtn}>◁</button>
              <button onClick={modalWeek.prev} style={{padding:'4px 8px',border:'1px solid #ccc',borderRadius:4,cursor:'pointer',background:'#f5f5f5',fontSize:12}}>◀</button>
              <input {...modalWeek.props} style={{...st.modalInput,width:80,textAlign:'center',fontWeight:700}} />
              <button onClick={modalWeek.next} style={{padding:'4px 8px',border:'1px solid #ccc',borderRadius:4,cursor:'pointer',background:'#f5f5f5',fontSize:12}}>▶</button>
              <button onClick={modalWeek.nextWeek} style={st.weekBigBtn}>▷</button>
            </div>
          </div>
          {/* 업체 */}
          <div style={{marginBottom:14}}>
            <label style={st.label}>업체 선택</label>
            <div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:6}}>
              <span style={{fontSize:11,color:'#888',lineHeight:'24px'}}>담당자:</span>
              <button onClick={()=>setSelMgr('')} style={chip(!selMgr)}>전체</button>
              {mgrList.map(m=>(<button key={m} onClick={()=>setSelMgr(m)} style={chip(selMgr===m)}>{m}</button>))}
            </div>
            <input value={custSearch} onChange={e=>setCustSearch(e.target.value)} placeholder="업체명 / 지역 검색..."
              style={{...st.modalInput,marginBottom:6}} autoFocus />
            <div style={{display:'flex',gap:4,flexWrap:'wrap',maxHeight:100,overflowY:'auto',border:'1px solid #e0e0e0',borderRadius:6,padding:8,background:'#fafafa'}}>
              {filteredCusts.map(c=>{
                const cnt=orderCounts[c.CustKey]||0;
                return (<button key={c.CustKey} onClick={()=>setSelCust(c)}
                  style={{...chip(selCust?.CustKey===c.CustKey),borderColor:selCust?.CustKey===c.CustKey?'#1565c0':'#ccc',background:selCust?.CustKey===c.CustKey?'#1565c0':'#fff'}}>
                  {c.CustName} <span style={{fontSize:9,opacity:0.7}}>{c.CustArea}</span>
                  {cnt>0&&<span style={{fontSize:8,opacity:0.6,marginLeft:2}}>({cnt})</span>}
                </button>);
              })}
              {filteredCusts.length===0&&<span style={{color:'#999',fontSize:12}}>검색 결과 없음</span>}
            </div>
          </div>
          {/* 품목 */}
          <div style={{marginBottom:14}}>
            <label style={st.label}>품목 선택 (클릭하여 추가) — 인기순 정렬</label>
            <div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:4}}>
              <span style={{fontSize:11,color:'#888',lineHeight:'24px'}}>국가:</span>
              <button onClick={()=>{setSelCoun('');setSelFlower('');}} style={chip(!selCoun)}>전체</button>
              {counList.map(c=>(<button key={c} onClick={()=>{setSelCoun(c);setSelFlower('');}} style={chip(selCoun===c)}>{c}</button>))}
            </div>
            {flowerList.length>0&&(
              <div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:6}}>
                <span style={{fontSize:11,color:'#888',lineHeight:'24px'}}>꽃:</span>
                <button onClick={()=>setSelFlower('')} style={chip(!selFlower)}>전체</button>
                {flowerList.map(f=>(<button key={f} onClick={()=>setSelFlower(f)} style={chip(selFlower===f)}>{f}</button>))}
              </div>
            )}
            <input value={prodSearch} onChange={e=>setProdSearch(e.target.value)} placeholder="품목명 검색..." style={st.modalInput} />
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:4,maxHeight:280,overflowY:'auto',border:'1px solid #e0e0e0',borderRadius:6,padding:8,background:'#fafafa',marginTop:4}}>
              {filteredProds.map(p=>{
                const inCart=selCust&&cart.some(c=>c.cust.CustKey===selCust.CustKey&&c.prod.ProdKey===p.ProdKey);
                const existKey=selCust?`${selCust.CustKey}-${p.ProdKey}-${modalWeek.value}`:'';
                const eq=existOrders[existKey];
                return (<button key={p.ProdKey} onClick={()=>addToCart(p)}
                  style={{...chip(inCart),borderColor:inCart?'#2e7d32':eq?'#ff9800':'#ccc',background:inCart?'#2e7d32':eq?'#fff3e0':'#fff',textAlign:'left'}}>
                  {p.ProdName} <span style={{fontSize:9,opacity:0.7}}>[{p.OutUnit}]</span>
                  {eq>0&&!inCart&&<span style={{fontSize:9,color:'#e65100',marginLeft:2}}>({eq})</span>}
                </button>);
              })}
              {filteredProds.length===0&&<span style={{color:'#999',fontSize:12}}>검색 결과 없음</span>}
            </div>
          </div>
          {/* 카트 — 업체별 그룹 */}
          {cart.length>0&&(()=>{
            const groups={};
            cart.forEach(item=>{
              const ck=item.cust.CustKey;
              if(!groups[ck]) groups[ck]={cust:item.cust,items:[]};
              groups[ck].items.push(item);
            });
            return (
              <div style={{marginBottom:14,border:'1px solid #1976d2',borderRadius:6,overflow:'hidden'}}>
                <div style={{background:'#1976d2',color:'#fff',padding:'6px 12px',fontSize:12,fontWeight:700}}>
                  선택된 품목 ({cart.length}개, {Object.keys(groups).length}업체)
                </div>
                <div style={{maxHeight:220,overflowY:'auto'}}>
                  {Object.values(groups).map(g=>(
                    <div key={g.cust.CustKey}>
                      <div style={{background:'#e3f2fd',padding:'4px 12px',fontSize:11,fontWeight:700,borderBottom:'1px solid #bbdefb',color:'#1565c0'}}>
                        🏢 {g.cust.CustName} {g.cust.CustArea&&<span style={{fontSize:10,color:'#666'}}>({g.cust.CustArea})</span>}
                      </div>
                      {g.items.map((item,i)=>(
                        <div key={`${item.cust.CustKey}-${item.prod.ProdKey}`} style={{display:'flex',alignItems:'center',gap:8,padding:'5px 12px 5px 24px',borderBottom:'1px solid #eee',background:i%2===0?'#fff':'#f9f9f9',fontSize:12}}>
                          <button onClick={()=>removeFromCart(item.cust.CustKey,item.prod.ProdKey)} style={{background:'#ef5350',color:'#fff',border:'none',borderRadius:4,width:20,height:20,cursor:'pointer',fontSize:12,lineHeight:'18px',flexShrink:0}}>✕</button>
                          <span style={{flex:1,fontWeight:600,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.prod.ProdName}</span>
                          {item.existQty>0&&<span style={{color:'#e65100',fontSize:10,whiteSpace:'nowrap'}}>기존:{item.existQty}</span>}
                          <div style={{display:'flex',gap:2,flexShrink:0}}>
                            {UNITS.map(u=>(<button key={u} onClick={()=>updateCartUnit(item.cust.CustKey,item.prod.ProdKey,u)}
                              style={{padding:'2px 6px',borderRadius:4,border:'1px solid',fontSize:10,cursor:'pointer',borderColor:item.unit===u?'#1976d2':'#ccc',background:item.unit===u?'#1976d2':'#f9f9f9',color:item.unit===u?'#fff':'#555',fontWeight:item.unit===u?700:400}}>{u}</button>))}
                          </div>
                          <input type="number" value={item.qty} onChange={e=>updateCartQty(item.cust.CustKey,item.prod.ProdKey,e.target.value)}
                            style={{width:60,textAlign:'right',fontSize:11,padding:'3px 4px',border:'1px solid #ccc',borderRadius:3,background:item.qty<0?'#ffebee':'#fff',flexShrink:0}} />
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
          {error&&<div style={{color:'#d32f2f',fontSize:12,marginBottom:10}}>⚠ {error}</div>}
          <div style={{display:'flex',gap:8,justifyContent:'flex-end',alignItems:'center'}}>
            <label style={{fontSize:12,cursor:'pointer',display:'flex',alignItems:'center',gap:4,marginRight:'auto'}}>
              <input type="checkbox" checked={distributeSync} onChange={e=>setDistributeSync(e.target.checked)} />
              분배 동시 적용
            </label>
            <button onClick={onClose} style={{padding:'8px 20px',border:'1px solid #ccc',borderRadius:5,cursor:'pointer',background:'#f5f5f5'}}>취소</button>
            <button onClick={handleSubmit} disabled={saving||cart.length===0}
              style={{padding:'8px 24px',background:(saving||cart.length===0)?'#aaa':'#1976d2',color:'#fff',border:'none',borderRadius:5,cursor:'pointer',fontWeight:700}}>
              {saving?'저장중...':`주문 추가 (${cart.length}개)`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────────────────
function fmt(v) {
  if (v===null||v===undefined) return '0';
  return Number(v).toLocaleString();
}

function stripProdName(name) {
  return (name||'')
    .replace(/^(\[.*?\]\s*)*/,'')
    .replace(/\s*\(.*?\)\s*$/,'')
    .replace(/^\s*\/\s*/,'').trim() || name;
}

// ─────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────────────
export default function WeekPivot() {
  const router = useRouter();
  const weekFromInput = useWeekInput('');
  const weekToInput   = useWeekInput('');
  const weekFrom = weekFromInput.value;
  const weekTo   = weekToInput.value;

  const [loading,     setLoading]     = useState(false);
  const [custRows,    setCustRows]    = useState([]);
  const [startStocks, setStartStocks] = useState({});
  const [user,        setUser]        = useState(null);
  const [apiError,    setApiError]    = useState('');

  // 공통 텍스트 필터
  const [filterCoun,   setFilterCoun]   = useState('');
  const [filterFlower, setFilterFlower] = useState('');
  const [filterSearch, setFilterSearch] = useState('');

  // 피벗 전용 필터
  const [pvMgr,         setPvMgr]         = useState('');
  const [pvCusts,       setPvCusts]       = useState(new Set());
  const [pvFlowers,     setPvFlowers]     = useState(new Set());
  const [pvDescrOpen,   setPvDescrOpen]   = useState(true);
  const [pvDescrModal,  setPvDescrModal]  = useState(null);
  const [pvShowOnlyOut, setPvShowOnlyOut] = useState(false);
  const [pvEdit,        setPvEdit]        = useState(null);
  const [selectedPK,    setSelectedPK]    = useState(null); // 행 강조 선택

  const [showAddOrder,  setShowAddOrder]  = useState(false);

  // ── 즐겨찾기
  const [favorites, setFavorites] = useState([]);
  const loadFavorites = useCallback(async () => {
    try {
      const r = await fetch('/api/favorites?page=week-pivot');
      const d = await r.json();
      if (d.success) setFavorites(d.favorites || []);
    } catch {}
  }, []);
  useEffect(() => { loadFavorites(); }, [loadFavorites]);

  const saveFavorite = async () => {
    const name = prompt('즐겨찾기 이름을 입력하세요:');
    if (!name) return;
    const filterState = {
      weekFrom, weekTo: weekToInput.value,
      pvMgr, pvCusts: [...pvCusts], pvFlowers: [...pvFlowers], pvShowOnlyOut,
      filterCoun, filterFlower, filterSearch,
    };
    try {
      await fetch('/api/favorites', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ page:'week-pivot', name, filterData: JSON.stringify(filterState) }),
      });
      loadFavorites();
    } catch {}
  };

  const applyFavorite = (fav) => {
    try {
      const f = JSON.parse(fav.FilterData);
      if (f.weekFrom) weekFromInput.setValue(f.weekFrom);
      if (f.weekTo) weekToInput.setValue(f.weekTo);
      if (f.pvMgr !== undefined) setPvMgr(f.pvMgr);
      if (f.pvCusts) setPvCusts(new Set(f.pvCusts));
      if (f.pvFlowers) setPvFlowers(new Set(f.pvFlowers));
      if (f.pvShowOnlyOut !== undefined) setPvShowOnlyOut(f.pvShowOnlyOut);
      if (f.filterCoun !== undefined) setFilterCoun(f.filterCoun);
      if (f.filterFlower !== undefined) setFilterFlower(f.filterFlower);
      if (f.filterSearch !== undefined) setFilterSearch(f.filterSearch);
    } catch {}
  };

  const deleteFavorite = async (fk) => {
    if (!confirm('삭제하시겠습니까?')) return;
    try {
      await fetch('/api/favorites', { method:'DELETE', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ favoriteKey: fk }) });
      loadFavorites();
    } catch {}
  };

  // 로그인 확인
  useEffect(() => {
    try { const u = JSON.parse(localStorage.getItem('nenovaUser')||'null'); if (!u) router.replace('/login'); else setUser(u); } catch { router.replace('/login'); }
  }, []);

  // weekTo 기본값 = weekFrom
  useEffect(() => {
    if (weekFrom && !weekToInput.value) weekToInput.setValue(weekFrom);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekFrom]);

  // 데이터 로드
  const loadData = useCallback(async (wf, wt) => {
    if (!wf || !wt) return;
    setLoading(true); setApiError('');
    try {
      const p = `weekFrom=${encodeURIComponent(wf)}&weekTo=${encodeURIComponent(wt)}`;
      // customers 데이터와 시작재고 동시 로드
      const [custResp, ssResp] = await Promise.all([
        fetch(`/api/shipment/stock-status?${p}&view=customers`),
        fetch(`/api/shipment/stock-status?${p}&view=startStocks`),
      ]);
      // 인증 만료 → 로그인 페이지로
      if (custResp.status === 401) { router.replace('/login'); return; }
      const custRes = await custResp.json();
      if (custRes.success) {
        setCustRows(custRes.rows || []);
      } else {
        setApiError(custRes.error || 'API 오류');
        setCustRows([]);
      }
      // 시작재고 초기화 (DB 저장값)
      if (ssResp.ok) {
        const ssRes = await ssResp.json();
        if (ssRes.success && ssRes.rows?.length) {
          const ssMap = {};
          ssRes.rows.forEach(r => { ssMap[`${r.ProdKey}-${r.OrderWeek}`] = { stock: r.Stock }; });
          setStartStocks(ssMap);
        }
      }
    } catch(e) { setApiError(e.message); }
    finally { setLoading(false); }
  }, [router]);

  useEffect(() => {
    if (weekFrom && weekTo) loadData(weekFrom, weekTo);
  }, [weekFrom, weekTo, loadData]);

  // 시작재고 저장
  const saveStartStock = useCallback(async (prodKey, week, stock, remark) => {
    const key = `${prodKey}-${week}`;
    const prev = startStocks[key] || {};
    const s  = stock  != null ? stock  : prev.stock;
    const rm = remark != null ? remark : (prev.remark || '');
    try {
      const r = await fetch('/api/shipment/stock-status', {
        method:'PUT', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ prodKey, week, stock:s, remark:rm }),
      });
      const d = await r.json();
      if (d.success) setStartStocks(prev=>({...prev,[key]:{stock:parseFloat(s)||0,remark:rm}}));
    } catch(e) { console.error(e); }
  }, [startStocks]);

  // 피벗 셀 수량 저장
  const savePvCell = useCallback(async (pk, ck, wk, newQty, oldQty, custName) => {
    const qty = parseFloat(newQty) || 0;
    const old = parseFloat(oldQty) || 0;
    if (qty === old) { setPvEdit(null); return; }
    try {
      const diff = qty - old;
      const diffStr = diff > 0 ? `${diff}추가` : `${Math.abs(diff)}감소`;
      const r = await fetch('/api/shipment/stock-status', {
        method:'PATCH', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ custKey:ck, prodKey:pk, week:wk, outQty:qty, shipDate:weekToShipDate(wk), descrLog:`${custName} ${old}>${qty}(${diffStr})` }),
      });
      const d = await r.json();
      if (d.success) { setPvEdit(null); loadData(weekFrom, weekTo); }
      else alert('저장 실패: ' + d.error);
    } catch(e) { alert('오류: ' + e.message); }
  }, [weekFrom, weekTo, loadData]);

  // 차수피벗 제외 품명 키워드 (대소문자 무시)
  const EXCLUDED_PROD_KW = ['carnation', 'hydrangea', 'rose', 'altromeria'];

  // 필터 적용
  const applyFilter = useCallback((rows) => rows.filter(r => {
    if (filterCoun   && !r.CounName?.includes(filterCoun))     return false;
    if (filterFlower && !r.FlowerName?.includes(filterFlower)) return false;
    if (filterSearch) {
      const q = filterSearch.toLowerCase();
      if (!r.ProdName?.toLowerCase().includes(q) && !r.FlowerName?.toLowerCase().includes(q) && !r.CustName?.toLowerCase().includes(q)) return false;
    }
    // 제외 품명 필터 — 사용자가 국가/꽃/검색어를 직접 선택한 경우 제외 안 함
    if (!filterCoun && !filterFlower && !filterSearch) {
      const pn = (r.ProdName || '').toLowerCase();
      if (EXCLUDED_PROD_KW.some(kw => pn.includes(kw))) return false;
    }
    return true;
  }), [filterCoun, filterFlower, filterSearch]);

  const filteredCustRows = useMemo(() => applyFilter(custRows), [custRows, applyFilter]);
  const allCounNames     = useMemo(() => [...new Set(custRows.map(r=>r.CounName).filter(Boolean))].sort(), [custRows]);

  // ─────────────────────────────────────────────────────────────
  // 피벗 렌더링
  // ─────────────────────────────────────────────────────────────
  const renderWeekPivot = () => {
    const allMgrs = [...new Set(custRows.map(r=>r.Manager||'미지정'))].sort();
    const allCusts = {};
    custRows.forEach(r=>{ allCusts[r.CustKey]={name:r.CustName,area:r.CustArea,descr:r.CustDescr,mgr:r.Manager}; });
    const allCustList = Object.entries(allCusts)
      .filter(([,c])=>!pvMgr||(c.mgr||'미지정')===pvMgr)
      .sort((a,b)=>((a[1].area||'')+a[1].name).localeCompare((b[1].area||'')+b[1].name,'ko'));

    let rows = filteredCustRows;
    if (pvMgr) rows = rows.filter(r=>(r.Manager||'미지정')===pvMgr);
    if (pvCusts.size > 0) rows = rows.filter(r=>pvCusts.has(r.CustKey));
    if (pvFlowers.size > 0) rows = rows.filter(r=>pvFlowers.has(r.FlowerName));

    const weeks = [...new Set(rows.map(r=>r.OrderWeek))].sort();
    const custMap = {};
    rows.forEach(r=>{ custMap[r.CustKey]={name:r.CustName,area:r.CustArea||'기타',descr:r.CustDescr}; });
    const custKeys = Object.keys(custMap).map(Number)
      .sort((a,b)=>((custMap[a].area+custMap[a].name).localeCompare(custMap[b].area+custMap[b].name,'ko')));

    const areaGroups=[]; let lastArea=null, areaStart=0;
    custKeys.forEach((ck,i)=>{
      const area=custMap[ck].area;
      if(area!==lastArea){if(lastArea!==null)areaGroups.push({area:lastArea,count:i-areaStart});lastArea=area;areaStart=i;}
    });
    if(lastArea!==null) areaGroups.push({area:lastArea,count:custKeys.length-areaStart});

    const prodMap={};
    rows.forEach(r=>{
      if(pvShowOnlyOut){
        if((r.outQty||0)>0||Object.keys(startStocks).some(k=>k.startsWith(`${r.ProdKey}-`)&&startStocks[k]?.stock)){
          if(!prodMap[r.ProdKey]) prodMap[r.ProdKey]={name:r.ProdName,coun:r.CounName,flower:r.FlowerName,unit:r.OutUnit};
        }
      } else {
        if((r.outQty||0)>0||(r.custOrderQty||0)>0){
          if(!prodMap[r.ProdKey]) prodMap[r.ProdKey]={name:r.ProdName,coun:r.CounName,flower:r.FlowerName,unit:r.OutUnit};
        }
      }
    });
    const prodKeys = Object.keys(prodMap).map(Number).sort((a,b)=>
      ((prodMap[a].coun||'')+(prodMap[a].flower||'')+(prodMap[a].name||'')).localeCompare(
       (prodMap[b].coun||'')+(prodMap[b].flower||'')+(prodMap[b].name||''),'ko'));

    const dataMap={}, inMap={}, descrMap={}, prevStockMap={};
    rows.forEach(r=>{
      const dk=`${r.ProdKey}-${r.CustKey}-${r.OrderWeek}`;
      dataMap[dk]=r.outQty||0;
      if(r.outDescr) descrMap[dk]=r.outDescr;
      const ik=`${r.ProdKey}-${r.OrderWeek}`;
      if(!inMap[ik]) inMap[ik]=r.totalInQty||0;
      // 품목별 이월재고 (DB ProductStock 기준) — startStocks 미입력 시 기본값
      if(!(r.ProdKey in prevStockMap)) prevStockMap[r.ProdKey]=r.prevStock||0;
    });
    const isFixed=(ck,wk)=>rows.some(r=>r.CustKey===ck&&r.OrderWeek===wk&&r.isFix);

    if(weeks.length===0) return <div style={st.empty}>해당 차수에 주문 데이터 없음<br/><span style={{fontSize:11,color:'#bbb'}}>custRows: {custRows.length}행</span></div>;
    if(prodKeys.length===0) return <div style={st.empty}>표시할 품목 없음 (출고/주문 수량이 0)<br/><span style={{fontSize:11,color:'#bbb'}}>전체 데이터: {rows.length}행</span></div>;

    const PROD_REPEAT=10, CUST_REPEAT=15;
    const stockCols=7;
    const prodLabelCols=custKeys.length>CUST_REPEAT?Math.floor((custKeys.length-1)/CUST_REPEAT):0;
    const colsPerWeek=custKeys.length+stockCols+prodLabelCols;

    const cShort=(ck)=>{
      const c=custMap[ck]; if(!c) return '?';
      const d=(c.descr||'').split('/')[0].trim();
      return d||c.name;
    };
    const chipS=(active)=>({
      padding:'2px 8px',borderRadius:10,border:'1px solid',fontSize:10,cursor:'pointer',fontWeight:active?700:400,
      borderColor:active?'#1976d2':'#ccc',background:active?'#1976d2':'#f5f5f5',color:active?'#fff':'#555',
    });

    return (
      <div>
        {/* 담당자 필터 */}
        <div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:4}}>
          <span style={{fontSize:10,color:'#888',lineHeight:'22px'}}>담당자:</span>
          <button onClick={()=>{setPvMgr('');setPvCusts(new Set());}} style={chipS(!pvMgr)}>전체</button>
          {allMgrs.map(m=>(<button key={m} onClick={()=>{setPvMgr(m);setPvCusts(new Set());}} style={chipS(pvMgr===m)}>{m}</button>))}
        </div>
        {/* 업체 필터 */}
        <div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:4}}>
          <span style={{fontSize:10,color:'#888',lineHeight:'22px'}}>업체:</span>
          <button onClick={()=>setPvCusts(new Set())} style={chipS(pvCusts.size===0)}>전체</button>
          {allCustList.map(([ck,c])=>{
            const k=Number(ck); const active=pvCusts.has(k);
            const short=(c.descr||'').split('/')[0].trim()||c.name;
            return (<button key={ck} onClick={()=>setPvCusts(prev=>{const n=new Set(prev);active?n.delete(k):n.add(k);return n;})} style={chipS(active)}>{short}</button>);
          })}
        </div>
        {/* 국가 필터 */}
        <div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:4}}>
          <span style={{fontSize:10,color:'#888',lineHeight:'22px'}}>국가:</span>
          <button onClick={()=>{setFilterCoun('');setFilterFlower('');}} style={chipS(!filterCoun)}>전체</button>
          {allCounNames.map(c=>(<button key={c} onClick={()=>{setFilterCoun(prev=>prev===c?'':c);setFilterFlower('');}} style={chipS(filterCoun===c)}>{c}</button>))}
        </div>
        {/* 꽃 필터 (국가 선택 시) */}
        {filterCoun&&(()=>{
          const flowers=[...new Set(custRows.filter(r=>r.CounName===filterCoun).map(r=>r.FlowerName).filter(Boolean))].sort();
          return (
            <div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:4}}>
              <span style={{fontSize:10,color:'#888',lineHeight:'22px'}}>꽃:</span>
              <button onClick={()=>setPvFlowers(new Set())} style={chipS(pvFlowers.size===0)}>전체</button>
              {flowers.map(f=>{const active=pvFlowers.has(f);return(<button key={f} onClick={()=>setPvFlowers(prev=>{const n=new Set(prev);active?n.delete(f):n.add(f);return n;})} style={chipS(active)}>{f}</button>);})}
            </div>
          );
        })()}
        {/* 옵션 + 버튼 */}
        <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:6,flexWrap:'wrap'}}>
          <label style={{fontSize:11,color:'#555',cursor:'pointer',display:'flex',alignItems:'center',gap:4}}>
            <input type="checkbox" checked={pvShowOnlyOut} onChange={e=>setPvShowOnlyOut(e.target.checked)} />
            출고/재고 있는 품목만
          </label>
          <span style={{fontSize:10,color:'#999'}}>({prodKeys.length}개 품목 / {custKeys.length}개 업체)</span>
          <button onClick={()=>{
            const xlData=[];
            const hdr=['국가','꽃','품명'];
            weeks.forEach(wk=>{custKeys.forEach(ck=>hdr.push(`${wk} ${cShort(ck)}`));hdr.push(`${wk} 시작`,`${wk} 입고`,`${wk} 출고`,`${wk} 잔량`);});
            xlData.push(hdr);
            prodKeys.forEach(pk=>{
              const p=prodMap[pk];
              const row=[p.coun,p.flower,stripProdName(p.name)];
              const _xl0=startStocks[`${pk}-${weeks[0]}`];let rs=_xl0?.stock!=null?_xl0.stock:(prevStockMap[pk]||0);
              weeks.forEach(wk=>{
                const wkSS=startStocks[`${pk}-${wk}`]?.stock;
                if(wkSS!=null) rs=wkSS;
                custKeys.forEach(ck=>row.push(dataMap[`${pk}-${ck}-${wk}`]||0));
                const inQ=inMap[`${pk}-${wk}`]||0;
                const wOut=custKeys.reduce((a,ck)=>a+(dataMap[`${pk}-${ck}-${wk}`]||0),0);
                row.push(rs,inQ,wOut,rs+inQ-wOut);
                rs=rs+inQ-wOut;
              });
              xlData.push(row);
            });
            const ws=XLSX.utils.aoa_to_sheet(xlData);
            const wb=XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb,ws,'차수피벗');
            XLSX.writeFile(wb,`차수피벗_${weeks.join('~')}.xlsx`);
          }} style={{...st.addBtn,background:'#2e7d32'}}>📥 엑셀</button>
          <button onClick={()=>{
            const lines=[];
            prodKeys.forEach(pk=>{
              const p=prodMap[pk];const _cp0=startStocks[`${pk}-${weeks[0]}`];let rs=_cp0?.stock!=null?_cp0.stock:(prevStockMap[pk]||0);
              weeks.forEach(wk=>{const wkSS=startStocks[`${pk}-${wk}`]?.stock;if(wkSS!=null)rs=wkSS;const inQ=inMap[`${pk}-${wk}`]||0;const wOut=custKeys.reduce((a,ck)=>a+(dataMap[`${pk}-${ck}-${wk}`]||0),0);rs=rs+inQ-wOut;});
              if(rs>0) lines.push(`${stripProdName(p.name)} ${rs}`);
            });
            if(!lines.length){alert('잔량이 있는 품목이 없습니다');return;}
            navigator.clipboard.writeText(lines.join('\n')).then(()=>alert(`${lines.length}개 품목 복사됨`));
          }} style={{...st.addBtn,background:'#6a1b9a'}}>📋 잔량복사</button>
        </div>

        {/* 피벗 테이블 */}
        <div style={{overflowX:'auto',overflowY:'auto',maxHeight:'calc(100vh - 200px)',position:'relative'}}>
        <table style={{...st.table,fontSize:10,borderCollapse:'collapse'}}>
          <thead style={{position:'sticky',top:0,zIndex:4}}>
            <tr style={st.thead}>
              <th style={{...st.th,position:'sticky',left:0,background:'#263238',zIndex:3}} rowSpan={3}>품명</th>
              {weeks.map(wk=>(
                <th key={wk} colSpan={colsPerWeek} style={{...st.th,textAlign:'center',background:'#1a237e',fontSize:12,borderLeft:'2px solid #fff'}}>{wk}</th>
              ))}
            </tr>
            <tr style={st.thead}>
              {weeks.map(wk=>(
                <React.Fragment key={wk}>
                  {areaGroups.map((ag,ai)=>(
                    <th key={`${wk}-a${ai}`} colSpan={ag.count} style={{...st.th,textAlign:'center',background:'#455a64',fontSize:9,borderLeft:ai===0?'2px solid #fff':'none'}}>{ag.area}</th>
                  ))}
                  <th colSpan={stockCols} style={{...st.th,textAlign:'center',background:'#004d40',fontSize:9}}>재고</th>
                </React.Fragment>
              ))}
            </tr>
            <tr style={st.thead}>
              {weeks.map(wk=>(
                <React.Fragment key={wk}>
                  {custKeys.map((ck,ci)=>(
                    <React.Fragment key={`${wk}-${ck}`}>
                      {ci>0&&ci%CUST_REPEAT===0&&<th style={{...st.th,background:'#ff8f00',fontSize:7,textAlign:'center',padding:'2px',minWidth:16}}>품명</th>}
                      <th style={{...st.th,fontSize:9,textAlign:'center',minWidth:44,maxWidth:60,whiteSpace:'normal',wordBreak:'break-all',lineHeight:'1.2',padding:'4px 2px',borderLeft:ci===0?'2px solid #fff':'none'}}>
                        {cShort(ck)}
                      </th>
                    </React.Fragment>
                  ))}
                  <th style={{...st.th,background:'#006064',textAlign:'center',fontSize:8}}>시작재고</th>
                  <th style={{...st.th,background:'#004d40',textAlign:'center',fontSize:8,minWidth:50}}>시작비고</th>
                  <th style={{...st.th,background:'#1565c0',textAlign:'center',fontSize:8}}>입고</th>
                  <th style={{...st.th,background:'#ad1457',textAlign:'center',fontSize:8}}>출고</th>
                  <th style={{...st.th,background:'#4a148c',textAlign:'center',fontSize:8}}>잔량</th>
                  <th style={{...st.th,background:'#37474f',textAlign:'center',fontSize:8,minWidth:pvDescrOpen?100:30,cursor:'pointer'}}
                      onClick={()=>setPvDescrOpen(p=>!p)}>{pvDescrOpen?'비고 ▾':'▸'}</th>
                </React.Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {prodKeys.map((pk,pi)=>{
              const p=prodMap[pk];
              const _initSS=startStocks[`${pk}-${weeks[0]}`];
              let rollingStock=_initSS?.stock!=null?_initSS.stock:(prevStockMap[pk]||0);
              const needRepeat=pi>0&&pi%PROD_REPEAT===0;
              return (
                <React.Fragment key={pk}>
                  {needRepeat&&(
                    <tr style={{background:'#eceff1'}}>
                      <td style={{...st.td,position:'sticky',left:0,background:'#eceff1',zIndex:1,fontSize:9,color:'#555',fontWeight:700}}>▼ 업체 ▼</td>
                      {weeks.map(wk=>(
                        <React.Fragment key={wk}>
                          {custKeys.map((ck,ci)=>(
                            <React.Fragment key={`r-${wk}-${ck}`}>
                              {ci>0&&ci%CUST_REPEAT===0&&<td style={{...st.td,background:'#eceff1',fontSize:7,color:'#888',textAlign:'center'}}>품명</td>}
                              <td style={{...st.td,fontSize:8,textAlign:'center',color:'#555',fontWeight:600,whiteSpace:'normal',wordBreak:'break-all',background:'#eceff1',borderLeft:ci===0?'2px solid #ccc':'none'}}>{cShort(ck)}</td>
                            </React.Fragment>
                          ))}
                          <td colSpan={stockCols} style={{...st.td,background:'#eceff1'}}></td>
                        </React.Fragment>
                      ))}
                    </tr>
                  )}
                  {(()=>{
                    const isSel = pk === selectedPK;
                    const rowBg = isSel ? '#FFF8E1' : (pi%2===0?'#fff':'#f5f5f5');
                    return (
                  <tr style={{background:rowBg, outline: isSel?'1px solid #FFA000':'none', outlineOffset:'-1px'}}>
                    <td style={{...st.td,position:'sticky',left:0,background:rowBg,zIndex:1,minWidth:150,
                                borderLeft: isSel?'4px solid #FF6F00':'4px solid transparent', boxSizing:'border-box'}}>
                      <span style={{...st.clickCell,fontSize:8,color:filterCoun===p.coun?'#1565c0':'#999'}}
                            onClick={()=>setFilterCoun(prev=>prev===p.coun?'':p.coun)}>{p.coun}</span>
                      <span style={{...st.clickCell,fontSize:8,color:filterFlower===p.flower?'#2e7d32':'#999',marginLeft:2}}
                            onClick={()=>setFilterFlower(prev=>prev===p.flower?'':p.flower)}>·{p.flower}</span>
                      <div style={{fontWeight:600,fontSize:13,cursor:'pointer',color:isSel?'#E65100':undefined}}
                           onClick={()=>setSelectedPK(prev=>prev===pk?null:pk)}>{stripProdName(p.name)}</div>
                    </td>
                    {weeks.map(wk=>{
                      const ssKey=`${pk}-${wk}`;
                      const ssObj=startStocks[ssKey];
                      if(ssObj?.stock!=null) rollingStock=ssObj.stock;
                      const weekStart=rollingStock;
                      const inQty=inMap[`${pk}-${wk}`]||0;
                      const weekOut=custKeys.reduce((a,ck)=>a+(dataMap[`${pk}-${ck}-${wk}`]||0),0);
                      rollingStock=weekStart+inQty-weekOut;
                      return (
                        <React.Fragment key={wk}>
                          {custKeys.map((ck,ci)=>{
                            const v=dataMap[`${pk}-${ck}-${wk}`]||0;
                            return (
                              <React.Fragment key={`${wk}-${ck}`}>
                                {ci>0&&ci%CUST_REPEAT===0&&(
                                  <td style={{...st.td,fontSize:8,fontWeight:600,color:'#e65100',background:'#fff8e1',borderLeft:'2px solid #ff9800',padding:'2px 4px',whiteSpace:'normal',wordBreak:'break-all',lineHeight:'1.1',maxWidth:56,minWidth:56}}>
                                    {stripProdName(p.name).slice(0,10)}
                                  </td>
                                )}
                                {(()=>{
                                  const fixed=isFixed(ck,wk);
                                  return (
                                    <td style={{...st.td,textAlign:'right',fontSize:10,cursor:fixed?'not-allowed':'pointer',
                                        borderLeft:ci===0?'2px solid #e0e0e0':'none',color:v>0?'#1565c0':'#ddd',
                                        background:fixed?'#f5f5f5':pvEdit?.pk===pk&&pvEdit?.ck===ck&&pvEdit?.wk===wk?'#fff9c4':undefined}}
                                        onClick={()=>{if(fixed){alert('확정된 차수는 수정할 수 없습니다');return;}setPvEdit({pk,ck,wk,val:v,newVal:v,custName:cShort(ck)});}}>
                                      {v>0?fmt(v):'·'}
                                      {fixed&&v>0&&<span style={{fontSize:7,color:'#999'}}>🔒</span>}
                                    </td>
                                  );
                                })()}
                              </React.Fragment>
                            );
                          })}
                          {/* 시작재고 입력 */}
                          <td style={{...st.td,textAlign:'right',background:'#e0f7fa',padding:'2px 3px'}} onClick={e=>e.stopPropagation()}>
                            <input type="number" key={`ss-${pk}-${wk}`} defaultValue={ssObj?.stock??''} placeholder="-"
                              style={{width:40,textAlign:'right',fontSize:9,padding:'1px 2px',border:'1px solid #ccc',borderRadius:2,background:'#fff'}}
                              onBlur={e=>saveStartStock(pk,wk,e.target.value)} />
                          </td>
                          {/* 시작비고 */}
                          <td style={{...st.td,fontSize:8,color:'#555',background:'#e0f7fa',padding:'1px 2px'}} onClick={e=>e.stopPropagation()}>
                            <input type="text" key={`sr-${pk}-${wk}`} defaultValue={ssObj?.remark??''} placeholder="-"
                              style={{width:46,fontSize:8,padding:'1px 2px',border:'1px solid #ccc',borderRadius:2,background:'#fff'}}
                              onBlur={e=>saveStartStock(pk,wk,null,e.target.value)} />
                          </td>
                          <td style={{...st.td,textAlign:'right',background:'#e3f2fd',fontSize:9}}>{fmt(inQty)}</td>
                          <td style={{...st.td,textAlign:'right',background:'#fce4ec',fontWeight:600,fontSize:9}}>{fmt(weekOut)}</td>
                          <td style={{...st.td,textAlign:'right',background:'#f3e5f5',fontWeight:700,fontSize:9,color:rollingStock<0?'#d32f2f':'#388e3c'}}>{fmt(rollingStock)}</td>
                          {/* 비고 (수정내역) */}
                          {(()=>{
                            const custLogs=custKeys.map(ck=>{
                              const raw=descrMap[`${pk}-${ck}-${wk}`]||'';
                              const lines=raw.split('\n').filter(l=>l.trim());
                              return {ck,lines};
                            }).filter(x=>x.lines.length);
                            const cnt=custLogs.reduce((a,x)=>a+x.lines.length,0);
                            const maxLineLen=custLogs.reduce((a,x)=>Math.max(a,...x.lines.map(l=>l.length)),0);
                            const dynWidth=pvDescrOpen?Math.max(100,maxLineLen*6):30;
                            return (
                              <td style={{...st.td,fontSize:8,color:'#555',width:dynWidth,minWidth:dynWidth,maxWidth:pvDescrOpen?'none':30,
                                          whiteSpace:'pre-line',lineHeight:'1.3',cursor:'pointer',verticalAlign:'top',padding:'2px 4px'}}
                                  onClick={()=>setPvDescrOpen(p=>!p)}>
                                {pvDescrOpen?(
                                  custLogs.map(({ck,lines})=>lines.map((line,li)=>(
                                    <div key={`${ck}-${li}`} style={{display:'flex',alignItems:'flex-start',gap:2,marginBottom:1}}>
                                      <span style={{flex:1,fontSize:7,color:'#555',lineHeight:'1.3',wordBreak:'break-all'}}>{line}</span>
                                      <span title="수정내역 삭제"
                                        style={{cursor:'pointer',color:'#e53935',fontSize:9,flexShrink:0,lineHeight:'1.3',padding:'0 1px'}}
                                        onClick={e=>{e.stopPropagation();setPvDescrModal({pk,ck,wk,lineIdx:li,custName:cShort(ck),prodName:stripProdName(p.name),line,allLines:lines});}}>✕</span>
                                    </div>
                                  )))
                                ):(
                                  cnt>0?<span style={{color:'#e65100',fontWeight:700}}>+{cnt}</span>:''
                                )}
                              </td>
                            );
                          })()}
                        </React.Fragment>
                      );
                    })}
                  </tr>
                  );})()}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
        </div>

        {/* 수량 수정 모달 */}
        {pvEdit&&(
          <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center'}}
               onClick={e=>e.target===e.currentTarget&&setPvEdit(null)}>
            <div style={{background:'#fff',borderRadius:10,padding:20,boxShadow:'0 8px 32px rgba(0,0,0,0.3)',minWidth:280,textAlign:'center'}}>
              <div style={{fontSize:14,fontWeight:700,marginBottom:12}}>출고수량 수정</div>
              <div style={{fontSize:12,color:'#888',marginBottom:8}}>{pvEdit.custName}</div>
              <div style={{display:'flex',gap:16,justifyContent:'center',marginBottom:16}}>
                <div><div style={{fontSize:10,color:'#888'}}>기존수량</div><div style={{fontSize:24,fontWeight:700,color:'#37474f'}}>{pvEdit.val}</div></div>
                <div style={{fontSize:20,color:'#aaa',lineHeight:'48px'}}>→</div>
                <div><div style={{fontSize:10,color:'#1976d2'}}>수정수량</div><div style={{fontSize:24,fontWeight:700,color:'#1976d2'}}>{pvEdit.newVal}</div></div>
              </div>
              <div style={{display:'flex',gap:6,justifyContent:'center',marginBottom:12}}>
                {[[-10,'#ffcdd2'],[-1,'#ffcdd2'],[1,'#c8e6c9'],[10,'#c8e6c9']].map(([n,bg])=>(
                  <button key={n} onClick={()=>setPvEdit(p=>({...p,newVal:(p.newVal||0)+n}))}
                    style={{...st.pmBtn,width:44,fontSize:12,background:bg}}>{n>0?`+${n}`:n}</button>
                ))}
                <input type="number" value={pvEdit.newVal} onChange={e=>setPvEdit(p=>({...p,newVal:parseFloat(e.target.value)||0}))}
                  style={{width:60,textAlign:'center',fontSize:16,fontWeight:700,border:'2px solid #1976d2',borderRadius:6,padding:'4px'}} />
              </div>
              <div style={{display:'flex',gap:8,justifyContent:'center'}}>
                <button onClick={()=>setPvEdit(null)} style={{padding:'8px 20px',border:'1px solid #ccc',borderRadius:5,cursor:'pointer',background:'#f5f5f5'}}>취소</button>
                <button onClick={()=>savePvCell(pvEdit.pk,pvEdit.ck,pvEdit.wk,pvEdit.newVal,pvEdit.val,pvEdit.custName)}
                  style={{padding:'8px 24px',background:'#1976d2',color:'#fff',border:'none',borderRadius:5,cursor:'pointer',fontWeight:700}}>저장</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const hasWeek = weekFrom && weekTo;

  return (
    <>
      <Head><title>📊 차수피벗 - nenova ERP</title></Head>
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; padding: 0; background: #f5f7fa; font-family: 'Malgun Gothic', sans-serif; }
        input, button, select { font-family: inherit; }
      `}</style>

      {/* 상단 헤더 */}
      <div style={{position:'sticky',top:0,zIndex:100,background:'linear-gradient(to right,#1a237e,#1976d2)',
                   color:'#fff',padding:'6px 12px',display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',
                   boxShadow:'0 2px 8px rgba(0,0,0,0.3)'}}>
        <span style={{fontWeight:700,fontSize:14,whiteSpace:'nowrap'}}>📊 차수피벗</span>
        <span style={{width:1,height:20,background:'rgba(255,255,255,0.3)',margin:'0 4px'}} />
        {/* 양쪽 동시 이동 <<< */}
        <button
          onClick={()=>{ weekFromInput.prevWeek(); weekToInput.prevWeek(); }}
          style={{...hst.wBtn, background:'#e65100', border:'1px solid #bf360c', fontWeight:900,
                  fontSize:11, padding:'2px 10px', letterSpacing:0, minWidth:40, color:'#fff'}}
          title="양쪽 동시 주차-1">&lt;&lt;&lt;</button>
        {/* 차수 From */}
        <div style={{display:'flex',alignItems:'center',gap:2}}>
          <button onClick={weekFromInput.prevWeek} style={hst.wBtn} title="주차-1">◀◀</button>
          <button onClick={weekFromInput.prev}     style={hst.wBtn} title="차수-1">◁</button>
          <input {...weekFromInput.props} style={hst.wInput} />
          <button onClick={weekFromInput.next}     style={hst.wBtn} title="차수+1">▷</button>
          <button onClick={weekFromInput.nextWeek} style={hst.wBtn} title="주차+1">▶▶</button>
        </div>
        <span style={{fontSize:12,opacity:0.7}}>~</span>
        {/* 차수 To */}
        <div style={{display:'flex',alignItems:'center',gap:2}}>
          <button onClick={weekToInput.prevWeek} style={hst.wBtn} title="주차-1">◀◀</button>
          <button onClick={weekToInput.prev}     style={hst.wBtn} title="차수-1">◁</button>
          <input {...weekToInput.props} style={hst.wInput} />
          <button onClick={weekToInput.next}     style={hst.wBtn} title="차수+1">▷</button>
          <button onClick={weekToInput.nextWeek} style={hst.wBtn} title="주차+1">▶▶</button>
        </div>
        {/* 양쪽 동시 이동 >>> */}
        <button
          onClick={()=>{ weekFromInput.nextWeek(); weekToInput.nextWeek(); }}
          style={{...hst.wBtn, background:'#e65100', border:'1px solid #bf360c', fontWeight:900,
                  fontSize:11, padding:'2px 10px', letterSpacing:0, minWidth:40, color:'#fff'}}
          title="양쪽 동시 주차+1">&gt;&gt;&gt;</button>
        <button onClick={()=>loadData(weekFrom,weekTo)} disabled={loading||!hasWeek}
          style={{...hst.hBtn,background:'rgba(255,255,255,0.2)',border:'1px solid rgba(255,255,255,0.4)'}}>
          {loading?'로딩중...':'🔄 새로고침'}
        </button>
        <button onClick={()=>setShowAddOrder(true)}
          style={{...hst.hBtn,background:'#43a047',border:'1px solid #388e3c'}}>
          ➕ 주문추가
        </button>
        {/* 즐겨찾기 */}
        {favorites.map(fav=>(
          <span key={fav.FavoriteKey} style={{display:'inline-flex',alignItems:'center',gap:1}}>
            <button onClick={()=>applyFavorite(fav)}
              style={{padding:'2px 8px',fontSize:10,fontWeight:600,border:'1px solid #f9a825',borderRadius:10,
                background:'rgba(255,248,225,0.9)',color:'#f57f17',cursor:'pointer'}}>
              ⭐{fav.FavName}
            </button>
            <button onClick={()=>deleteFavorite(fav.FavoriteKey)}
              style={{width:14,height:14,padding:0,fontSize:8,border:'none',background:'transparent',color:'rgba(255,255,255,0.5)',cursor:'pointer'}}>✕</button>
          </span>
        ))}
        <button onClick={saveFavorite}
          style={{padding:'2px 8px',fontSize:10,border:'1px dashed rgba(255,255,255,0.4)',borderRadius:10,
            background:'transparent',color:'rgba(255,255,255,0.7)',cursor:'pointer'}}>
          + 즐겨찾기
        </button>
        {/* 검색 */}
        <input value={filterSearch} onChange={e=>setFilterSearch(e.target.value)} placeholder="품목/업체 검색..."
          style={{...hst.wInput,width:140,background:'rgba(255,255,255,0.15)',color:'#fff',border:'1px solid rgba(255,255,255,0.3)'}} />
        <span style={{marginLeft:'auto',fontSize:11,opacity:0.7}}>{user?.userName||''}</span>
        <button onClick={()=>window.close()} style={{...hst.hBtn,background:'rgba(255,255,255,0.1)',border:'1px solid rgba(255,255,255,0.3)',fontSize:11}}>✕ 닫기</button>
      </div>

      {/* 본문 */}
      <div style={{padding:'8px 10px'}}>
        {apiError ? (
          <div style={{...st.empty, color:'#d32f2f'}}>
            <div style={{fontSize:16,fontWeight:700,marginBottom:8}}>⚠ 오류</div>
            <div style={{fontSize:13}}>{apiError}</div>
            {apiError.includes('로그인') || apiError.includes('인증') ? (
              <button onClick={()=>router.replace('/login')}
                style={{marginTop:16,padding:'8px 24px',background:'#1976d2',color:'#fff',border:'none',borderRadius:5,cursor:'pointer',fontWeight:700}}>
                로그인하기
              </button>
            ) : (
              <button onClick={()=>loadData(weekFrom,weekTo)}
                style={{marginTop:16,padding:'8px 24px',background:'#1976d2',color:'#fff',border:'none',borderRadius:5,cursor:'pointer',fontWeight:700}}>
                다시 시도
              </button>
            )}
          </div>
        ) : !hasWeek ? (
          <div style={st.empty}>차수를 선택해 주세요</div>
        ) : loading ? (
          <div style={st.empty}>데이터 로딩중...</div>
        ) : (
          renderWeekPivot()
        )}
      </div>

      {/* 주문추가 모달 */}
      {showAddOrder && (
        <AddOrderModal
          weekFrom={weekFrom} weekTo={weekTo}
          onClose={()=>setShowAddOrder(false)}
          onSuccess={()=>loadData(weekFrom,weekTo)}
        />
      )}

      {/* 수정내역 삭제 모달 */}
      {pvDescrModal && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:3000,display:'flex',alignItems:'center',justifyContent:'center'}}
             onClick={e=>e.target===e.currentTarget&&setPvDescrModal(null)}>
          <div style={{background:'#fff',borderRadius:10,padding:24,boxShadow:'0 8px 32px rgba(0,0,0,0.3)',minWidth:320,maxWidth:480}}>
            <div style={{fontWeight:700,fontSize:14,marginBottom:4}}>수정내역 삭제</div>
            <div style={{fontSize:12,color:'#888',marginBottom:12}}>
              {pvDescrModal.prodName} / {pvDescrModal.custName} / {pvDescrModal.wk}
            </div>
            <div style={{background:'#fff3e0',border:'1px solid #ff9800',borderRadius:6,padding:'8px 12px',fontSize:12,marginBottom:16,wordBreak:'break-all'}}>
              {pvDescrModal.line}
            </div>
            <div style={{fontSize:12,color:'#d32f2f',marginBottom:16}}>이 항목을 삭제하시겠습니까?</div>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button onClick={()=>setPvDescrModal(null)}
                style={{padding:'7px 20px',border:'1px solid #ccc',borderRadius:5,cursor:'pointer',background:'#f5f5f5',fontSize:12}}>취소</button>
              <button onClick={async()=>{
                const m=pvDescrModal;
                try {
                  const r=await fetch('/api/shipment/stock-status',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({custKey:m.ck,prodKey:m.pk,week:m.wk,lineIdx:m.lineIdx})});
                  const d=await r.json();
                  if(d.success){setPvDescrModal(null);loadData(weekFrom,weekTo);}
                  else alert('삭제 실패: '+d.error);
                } catch(e){alert('오류: '+e.message);}
              }} style={{padding:'7px 20px',background:'#d32f2f',color:'#fff',border:'none',borderRadius:5,cursor:'pointer',fontSize:12,fontWeight:700}}>삭제</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// 스타일
// ─────────────────────────────────────────────────────────────
const hst = {
  wBtn:   { padding:'3px 7px', border:'1px solid rgba(255,255,255,0.4)', borderRadius:3, cursor:'pointer', background:'rgba(255,255,255,0.15)', color:'#fff', fontSize:11, fontWeight:700 },
  wInput: { padding:'3px 6px', border:'1px solid rgba(255,255,255,0.4)', borderRadius:3, background:'rgba(255,255,255,0.95)', color:'#222', fontSize:12, fontWeight:700, width:68, textAlign:'center' },
  hBtn:   { padding:'4px 12px', borderRadius:4, cursor:'pointer', color:'#fff', fontSize:12, fontWeight:600 },
};

const st = {
  table:     { width:'100%', borderCollapse:'collapse', fontSize:12, marginBottom:8 },
  thead:     { background:'#37474f', color:'#fff' },
  th:        { padding:'6px 8px', textAlign:'left', borderRight:'1px solid #546e7a', whiteSpace:'nowrap', fontWeight:600, fontSize:11 },
  td:        { padding:'4px 6px', borderBottom:'1px solid #e0e0e0', borderRight:'1px solid #f0f0f0', fontSize:11 },
  clickCell: { cursor:'pointer', textDecoration:'underline', textDecorationColor:'#bbb', textUnderlineOffset:2 },
  empty:     { textAlign:'center', padding:'80px 20px', color:'#999', fontSize:14 },
  addBtn:    { padding:'4px 12px', background:'#1976d2', color:'#fff', border:'none', borderRadius:4, cursor:'pointer', fontSize:11, fontWeight:600 },
  pmBtn:     { width:22, height:22, padding:0, fontSize:13, lineHeight:'20px', border:'1px solid #ccc', borderRadius:3, cursor:'pointer', background:'#f5f5f5', fontWeight:700, display:'inline-flex', alignItems:'center', justifyContent:'center' },
  weekBigBtn:{ padding:'4px 8px', border:'2px solid #1976d2', borderRadius:4, cursor:'pointer', background:'#e3f2fd', fontSize:14, fontWeight:700, color:'#1976d2' },
  label:     { display:'block', fontSize:12, fontWeight:600, color:'#555', marginBottom:4 },
  modalInput:{ fontSize:13, padding:'6px 10px', border:'1px solid #ccc', borderRadius:4, width:'100%', boxSizing:'border-box' },
};
