// pages/shipment/stock-status.js — 출고,재고상황 v5
// 추가: 업체별 칩 필터 기본값 전체숨김, 줄긋기 제거, 기록컬럼, UpdateDtm 오류수정
import React, { useState, useEffect, useCallback, useMemo, useRef, createContext, useContext } from 'react';
import Layout from '../../components/Layout';
import { WeekInput, useWeekInput } from '../../lib/useWeekInput';
import * as XLSX from 'xlsx';

// ─────────────────────────────────────────────────────────────
// Edit Context
// ─────────────────────────────────────────────────────────────
const EditCtx = createContext(null);

function OutQtyCell({ ck, pk, wk, baseQty }) {
  const { editMap, setEditMap, saving, handleSave } = useContext(EditCtx);
  const k = `${ck}-${pk}-${wk}`;
  const cur     = k in editMap ? editMap[k] : (baseQty ?? 0);
  const isDirty = k in editMap;
  const isSav   = saving === k;

  const adjust = (delta) =>
    setEditMap(prev => ({ ...prev, [k]: Math.max(0, (k in prev ? prev[k] : (baseQty ?? 0)) + delta) }));

  return (
    <td style={{ ...st.td, padding: '3px 6px', background: isDirty ? '#fff9c4' : '#fce4ec', whiteSpace: 'nowrap' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 2 }}>
        <button onClick={() => adjust(-1)} style={st.pmBtn} disabled={isSav}>−</button>
        <input
          type="number" min={0} value={cur}
          onChange={e => setEditMap(prev => ({ ...prev, [k]: parseFloat(e.target.value) || 0 }))}
          style={{ width: 58, textAlign: 'right', fontSize: 11, padding: '2px 4px',
            border: `1px solid ${isDirty ? '#f9a825' : '#ddd'}`, borderRadius: 3,
            background: isDirty ? '#fffde7' : '#fff', fontWeight: isDirty ? 700 : 400 }}
          disabled={isSav}
        />
        <button onClick={() => adjust(1)} style={st.pmBtn} disabled={isSav}>+</button>
        {isDirty && (
          <button onClick={() => handleSave(ck, pk, wk)}
            style={{ ...st.pmBtn, background: isSav ? '#aaa' : '#1976d2', color: '#fff', padding: '2px 8px', fontSize: 10, width: 'auto' }}
            disabled={isSav}>
            {isSav ? '…' : '저장'}
          </button>
        )}
      </div>
    </td>
  );
}

// ─────────────────────────────────────────────────────────────
// 칩 필터 바 컴포넌트
// ─────────────────────────────────────────────────────────────
function ChipFilterBar({ chips, hiddenSet, onToggle, onSelectAll, onDeselectAll, label }) {
  const allVisible = hiddenSet.size === 0;
  const allHidden  = hiddenSet.size === chips.length;
  return (
    <div style={{ background: '#f0f4f8', border: '1px solid #d0d8e0', borderRadius: 6,
                  padding: '8px 10px', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: '#555', fontWeight: 700, whiteSpace: 'nowrap' }}>{label}</span>
        <button onClick={onSelectAll}
          style={{ ...st.ctrlBtn, background: allVisible ? '#1976d2' : '#fff', color: allVisible ? '#fff' : '#555' }}>
          전체표시
        </button>
        <button onClick={onDeselectAll}
          style={{ ...st.ctrlBtn, background: allHidden ? '#ef5350' : '#fff', color: allHidden ? '#fff' : '#555' }}>
          전체숨김
        </button>
        <span style={{ width: 1, height: 18, background: '#ccc', margin: '0 4px' }} />
        {chips.map(c => {
          const active = !hiddenSet.has(c.key);
          return (
            <button key={c.key} onClick={() => onToggle(c.key)}
              style={{
                padding: '3px 8px', borderRadius: 14,
                border: `1px solid ${active ? '#1976d2' : '#bbb'}`,
                background: active ? '#1976d2' : '#f0f0f0',
                color: active ? '#fff' : '#aaa',
                fontSize: 11, cursor: 'pointer', fontWeight: active ? 600 : 400,
                whiteSpace: 'nowrap', transition: 'all 0.12s',
              }}>
              {c.area ? <span style={{ fontSize: 10, opacity: 0.75 }}>[{c.area}] </span> : null}
              {c.name}
            </button>
          );
        })}
      </div>
    </div>
  );
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
  const [prodCounts, setProdCounts] = useState({});   // { ProdKey: count } 품목 인기순
  const [existOrders, setExistOrders] = useState({}); // { `CustKey-ProdKey-Week`: qty } 기존 주문수량
  const [cart, setCart] = useState([]);

  useEffect(() => {
    fetch('/api/master?entity=customers').then(r=>r.json()).then(d=>{if(d.success) setCusts(d.data);});
    fetch('/api/master?entity=products').then(r=>r.json()).then(d=>{if(d.success) setProds(d.data);});
    fetch('/api/shipment/stock-status?view=custOrderCounts').then(r=>r.json()).then(d=>{
      if(d.success && d.counts) setOrderCounts(d.counts);
    }).catch(()=>{});
    fetch('/api/shipment/stock-status?view=prodOrderCounts').then(r=>r.json()).then(d=>{
      if(d.success && d.counts) setProdCounts(d.counts);
    }).catch(()=>{});
  }, []);

  // 업체+차수 선택 시 기존 주문수량 조회
  useEffect(() => {
    if (!selCust || !modalWeek.value) { setExistOrders({}); return; }
    fetch(`/api/shipment/stock-status?view=existOrders&weekFrom=${modalWeek.value}&weekTo=${modalWeek.value}&custKey=${selCust.CustKey}`)
      .then(r=>r.json()).then(d=>{ if(d.success && d.orders) setExistOrders(d.orders); })
      .catch(()=>{});
  }, [selCust, modalWeek.value]);

  const mgrList = useMemo(() => [...new Set(custs.map(c => c.Manager || '미지정'))].sort(), [custs]);
  const counList = useMemo(() => [...new Set(prods.map(p => p.CounName).filter(Boolean))].sort(), [prods]);
  const flowerList = useMemo(() => {
    const base = selCoun ? prods.filter(p => p.CounName === selCoun) : prods;
    return [...new Set(base.map(p => p.FlowerName).filter(Boolean))].sort();
  }, [prods, selCoun]);

  const filteredCusts = useMemo(() => {
    let list = custs;
    if (selMgr) list = list.filter(c => (c.Manager || '미지정') === selMgr);
    if (custSearch) {
      const q = custSearch.toLowerCase();
      list = list.filter(c => c.CustName?.toLowerCase().includes(q) || c.CustArea?.toLowerCase().includes(q));
    }
    list = [...list].sort((a,b) => (orderCounts[b.CustKey]||0) - (orderCounts[a.CustKey]||0));
    return list.slice(0, 80);
  }, [custs, custSearch, selMgr, orderCounts]);

  const filteredProds = useMemo(() => {
    let list = prods;
    if (selCoun) list = list.filter(p => p.CounName === selCoun);
    if (selFlower) list = list.filter(p => p.FlowerName === selFlower);
    if (prodSearch) {
      const q = prodSearch.toLowerCase();
      list = list.filter(p =>
        p.ProdName?.toLowerCase().includes(q) || p.FlowerName?.toLowerCase().includes(q) || p.CounName?.toLowerCase().includes(q));
    }
    // 인기순 정렬
    list = [...list].sort((a,b) => (prodCounts[b.ProdKey]||0) - (prodCounts[a.ProdKey]||0));
    return list.slice(0, 200);
  }, [prods, prodSearch, selCoun, selFlower, prodCounts]);

  const addToCart = (p) => {
    if (cart.find(c => c.prod.ProdKey === p.ProdKey)) return;
    const u = UNITS.includes(p.OutUnit) ? p.OutUnit : '박스';
    const existKey = selCust ? `${selCust.CustKey}-${p.ProdKey}-${modalWeek.value}` : '';
    const existQty = existOrders[existKey] || 0;
    setCart(prev => [...prev, { prod: p, qty: existQty || 1, unit: u, existQty }]);
  };
  const removeFromCart = (pk) => setCart(prev => prev.filter(c => c.prod.ProdKey !== pk));
  const updateCartQty = (pk, val) => setCart(prev => prev.map(c => c.prod.ProdKey===pk ? {...c, qty: parseFloat(val)||0} : c));
  const updateCartUnit = (pk, u) => setCart(prev => prev.map(c => c.prod.ProdKey===pk ? {...c, unit: u} : c));

  const handleSubmit = async () => {
    if (!selCust) { setError('업체를 선택하세요'); return; }
    if (cart.length === 0) { setError('품목을 1개 이상 추가하세요'); return; }
    if (!modalWeek.value) { setError('차수를 입력하세요'); return; }
    setSaving(true); setError('');
    try {
      let allOk = true;
      for (const item of cart) {
        const r = await fetch('/api/shipment/stock-status', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'addOrder', custKey: selCust.CustKey, prodKey: item.prod.ProdKey, week: modalWeek.value, qty: item.qty, unit: item.unit }),
        });
        const d = await r.json();
        if (!d.success) { setError(d.error); allOk = false; break; }
      }
      if (allOk) { onSuccess?.({ custKey: selCust.CustKey, custName: selCust.CustName, week: modalWeek.value }); onClose(); }
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const chipStyle = (active) => ({
    padding:'3px 10px', borderRadius:12, border:'1px solid', fontSize:11, cursor:'pointer', fontWeight: active?700:400,
    borderColor: active?'#1976d2':'#ccc', background: active?'#1976d2':'#f5f5f5', color: active?'#fff':'#555',
  });

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:1000,
                  display:'flex', alignItems:'center', justifyContent:'center' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background:'#fff', borderRadius:10, width:'95vw', height:'95vh',
                    overflow:'auto', boxShadow:'0 8px 32px rgba(0,0,0,0.25)' }}>
        <div style={{ background:'#1976d2', color:'#fff', padding:'14px 20px', borderRadius:'10px 10px 0 0',
                      display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontWeight:700, fontSize:16 }}>주문 추가 {cart.length > 0 && <span style={{fontSize:12,opacity:0.8}}>({cart.length}개 품목)</span>}</span>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'#fff', fontSize:20, cursor:'pointer' }}>✕</button>
        </div>
        <div style={{ padding:'18px 20px' }}>

          {/* 차수 — 좌우 버튼 */}
          <div style={{ marginBottom:14 }}>
            <label style={st.label}>차수</label>
            <div style={{ display:'flex', gap:4, alignItems:'center' }}>
              <button onClick={modalWeek.prevWeek} style={st.weekBigBtn} title="이전 주차">◁</button>
              <button onClick={modalWeek.prev} style={{ padding:'4px 8px', border:'1px solid #ccc', borderRadius:4, cursor:'pointer', background:'#f5f5f5', fontSize:12 }}>◀</button>
              <input {...modalWeek.props} style={{ ...st.modalInput, width:80, textAlign:'center', fontWeight:700 }} />
              <button onClick={modalWeek.next} style={{ padding:'4px 8px', border:'1px solid #ccc', borderRadius:4, cursor:'pointer', background:'#f5f5f5', fontSize:12 }}>▶</button>
              <button onClick={modalWeek.nextWeek} style={st.weekBigBtn} title="다음 주차">▷</button>
            </div>
          </div>

          {/* 업체 */}
          <div style={{ marginBottom:14 }}>
            <label style={st.label}>업체 선택</label>
            <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginBottom:6 }}>
              <span style={{ fontSize:11, color:'#888', lineHeight:'24px' }}>담당자:</span>
              <button onClick={()=>setSelMgr('')} style={chipStyle(!selMgr)}>전체</button>
              {mgrList.map(m=>(<button key={m} onClick={()=>setSelMgr(m)} style={chipStyle(selMgr===m)}>{m}</button>))}
            </div>
            <input value={custSearch} onChange={e=>setCustSearch(e.target.value)} placeholder="업체명 / 지역 검색..."
              style={{ ...st.modalInput, marginBottom:6 }} autoFocus />
            <div style={{ display:'flex', gap:4, flexWrap:'wrap', maxHeight:100, overflowY:'auto',
                          border:'1px solid #e0e0e0', borderRadius:6, padding:8, background:'#fafafa' }}>
              {filteredCusts.map(c=>{
                const cnt = orderCounts[c.CustKey] || 0;
                return (
                  <button key={c.CustKey} onClick={()=>setSelCust(c)}
                    style={{ ...chipStyle(selCust?.CustKey===c.CustKey),
                             borderColor: selCust?.CustKey===c.CustKey?'#1565c0':'#ccc',
                             background: selCust?.CustKey===c.CustKey?'#1565c0':'#fff' }}>
                    {c.CustName} <span style={{fontSize:9,opacity:0.7}}>{c.CustArea}</span>
                    {cnt > 0 && <span style={{fontSize:8,opacity:0.6,marginLeft:2}}>({cnt})</span>}
                  </button>
                );
              })}
              {filteredCusts.length===0&&<span style={{color:'#999',fontSize:12}}>검색 결과 없음</span>}
            </div>
          </div>

          {/* 품목 선택 → 카트 추가 */}
          <div style={{ marginBottom:14 }}>
            <label style={st.label}>품목 선택 (클릭하여 추가) — 인기순 정렬</label>
            <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginBottom:4 }}>
              <span style={{ fontSize:11, color:'#888', lineHeight:'24px' }}>국가:</span>
              <button onClick={()=>{setSelCoun('');setSelFlower('');}} style={chipStyle(!selCoun)}>전체</button>
              {counList.map(c=>(<button key={c} onClick={()=>{setSelCoun(c);setSelFlower('');}} style={chipStyle(selCoun===c)}>{c}</button>))}
            </div>
            {flowerList.length > 0 && (
              <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginBottom:6 }}>
                <span style={{ fontSize:11, color:'#888', lineHeight:'24px' }}>꽃:</span>
                <button onClick={()=>setSelFlower('')} style={chipStyle(!selFlower)}>전체</button>
                {flowerList.map(f=>(<button key={f} onClick={()=>setSelFlower(f)} style={chipStyle(selFlower===f)}>{f}</button>))}
              </div>
            )}
            <input value={prodSearch} onChange={e=>setProdSearch(e.target.value)} placeholder="품목명 검색..."
              style={st.modalInput} />
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(160px, 1fr))', gap:4,
                          maxHeight:280, overflowY:'auto',
                          border:'1px solid #e0e0e0', borderRadius:6, padding:8, background:'#fafafa', marginTop:4 }}>
              {filteredProds.map(p=>{
                const inCart = cart.some(c=>c.prod.ProdKey===p.ProdKey);
                const existKey = selCust ? `${selCust.CustKey}-${p.ProdKey}-${modalWeek.value}` : '';
                const eq = existOrders[existKey];
                return (
                  <button key={p.ProdKey} onClick={()=>addToCart(p)}
                    style={{ ...chipStyle(inCart), borderColor: inCart?'#2e7d32': eq?'#ff9800':'#ccc',
                             background: inCart?'#2e7d32': eq?'#fff3e0':'#fff', textAlign:'left' }}>
                    {p.ProdName} <span style={{fontSize:9,opacity:0.7}}>[{p.OutUnit}]</span>
                    {eq > 0 && !inCart && <span style={{fontSize:9,color:'#e65100',marginLeft:2}}>({eq})</span>}
                  </button>
                );
              })}
              {filteredProds.length===0&&<span style={{color:'#999',fontSize:12}}>검색 결과 없음</span>}
            </div>
          </div>

          {/* 카트 */}
          {cart.length > 0 && (
            <div style={{ marginBottom:14, border:'1px solid #1976d2', borderRadius:6, overflow:'hidden' }}>
              <div style={{ background:'#1976d2', color:'#fff', padding:'6px 12px', fontSize:12, fontWeight:700 }}>
                선택된 품목 ({cart.length}개)
              </div>
              <div style={{ maxHeight:180, overflowY:'auto' }}>
                {cart.map((item, i) => (
                  <div key={item.prod.ProdKey} style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 12px',
                       borderBottom:'1px solid #eee', background: i%2===0?'#fff':'#f9f9f9', fontSize:12 }}>
                    <button onClick={()=>removeFromCart(item.prod.ProdKey)}
                      style={{ background:'#ef5350', color:'#fff', border:'none', borderRadius:4, width:20, height:20, cursor:'pointer', fontSize:12, lineHeight:'18px', flexShrink:0 }}>✕</button>
                    <span style={{ flex:1, fontWeight:600, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {item.prod.ProdName}
                    </span>
                    {item.existQty > 0 && <span style={{ color:'#e65100', fontSize:10, whiteSpace:'nowrap' }}>기존:{item.existQty}</span>}
                    <div style={{ display:'flex', gap:2, flexShrink:0 }}>
                      {UNITS.map(u=>(
                        <button key={u} onClick={()=>updateCartUnit(item.prod.ProdKey, u)}
                          style={{ padding:'2px 6px', borderRadius:4, border:'1px solid', fontSize:10, cursor:'pointer',
                                   borderColor: item.unit===u?'#1976d2':'#ccc', background: item.unit===u?'#1976d2':'#f9f9f9',
                                   color: item.unit===u?'#fff':'#555', fontWeight: item.unit===u?700:400 }}>
                          {u}
                        </button>
                      ))}
                    </div>
                    <input type="number" value={item.qty}
                      onChange={e=>updateCartQty(item.prod.ProdKey, e.target.value)}
                      style={{ width:60, textAlign:'right', fontSize:11, padding:'3px 4px', border:'1px solid #ccc', borderRadius:3,
                               background: item.qty < 0 ? '#ffebee' : '#fff', flexShrink:0 }} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && <div style={{color:'#d32f2f',fontSize:12,marginBottom:10}}>⚠ {error}</div>}

          <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
            <button onClick={onClose} style={{ padding:'8px 20px', border:'1px solid #ccc', borderRadius:5, cursor:'pointer', background:'#f5f5f5' }}>취소</button>
            <button onClick={handleSubmit} disabled={saving || cart.length===0}
              style={{ padding:'8px 24px', background:(saving||cart.length===0)?'#aaa':'#1976d2', color:'#fff', border:'none', borderRadius:5, cursor:'pointer', fontWeight:700 }}>
              {saving ? '저장중...' : `주문 추가 (${cart.length}개)`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────────────
export default function StockStatus() {
  const weekFromInput = useWeekInput('');
  const weekToInput   = useWeekInput('');
  const weekFrom = weekFromInput.value;
  const weekTo   = weekToInput.value;

  const [tab, setTab]           = useState('products');
  const [pivotSub, setPivotSub] = useState('byCust');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const isFirstLoad = useRef({ custs: true, mgrs: true }); // 첫 로드 시에만 전체숨김

  const [products,  setProducts]  = useState([]);
  const [custRows,  setCustRows]  = useState([]);
  const [mgrRows,   setMgrRows]   = useState([]);
  const [pivotRows, setPivotRows] = useState([]);
  const [startStocks, setStartStocks] = useState({}); // { ProdKey: stock }

  // 텍스트 필터
  const [filterCoun,   setFilterCoun]   = useState('');
  const [filterFlower, setFilterFlower] = useState('');
  const [filterSearch, setFilterSearch] = useState('');

  // 품목별 탭 - 업체 sub-row 확장
  const [prodExpand, setProdExpand] = useState({});

  // 편집 상태
  const [editMap, setEditMap] = useState({});
  const [saving,  setSaving]  = useState(null);

  // 주문추가 모달
  const [showAddOrder, setShowAddOrder] = useState(false);

  // ── 업체별 탭 칩 필터 (hiddenCusts = 숨길 CustKey Set)
  const [hiddenCusts, setHiddenCusts] = useState(new Set());
  // ── 담당자별 탭 칩 필터
  const [hiddenMgrs,      setHiddenMgrs]      = useState(new Set());
  const [hiddenMgrCusts,  setHiddenMgrCusts]  = useState({}); // { [mgrName]: Set<CustKey> }

  // ── 칩 데이터 (주문 있는 것 기준 = 로드된 데이터에서 추출)
  const custChips = useMemo(() => {
    const map = {};
    custRows.forEach(r => { map[r.CustKey] = { key: r.CustKey, name: r.CustName, area: r.CustArea }; });
    return Object.values(map).sort((a,b) => (a.area+a.name).localeCompare(b.area+b.name));
  }, [custRows]);

  const mgrList = useMemo(() => {
    return [...new Set(mgrRows.map(r => r.Manager || '미지정'))].sort();
  }, [mgrRows]);

  // 담당자별 업체 칩 맵: { [mgrName]: [{ key, name, area }] }
  const mgrCustChips = useMemo(() => {
    const map = {};
    mgrRows.forEach(r => {
      const mgr = r.Manager || '미지정';
      if (!map[mgr]) map[mgr] = {};
      map[mgr][r.CustKey] = { key: r.CustKey, name: r.CustName, area: r.CustArea };
    });
    return Object.fromEntries(
      Object.entries(map).map(([mgr, custs]) => [
        mgr,
        Object.values(custs).sort((a,b) => (a.area+a.name).localeCompare(b.area+b.name))
      ])
    );
  }, [mgrRows]);

  // 데이터 로드 시 칩 필터 — 첫 로드만 전체숨김, 이후(저장 후)는 기존 필터 유지
  useEffect(() => {
    if (isFirstLoad.current.custs) {
      setHiddenCusts(new Set(custRows.map(r => r.CustKey)));
      isFirstLoad.current.custs = false;
    }
  }, [custRows]);
  useEffect(() => {
    if (isFirstLoad.current.mgrs) {
      setHiddenMgrs(new Set(mgrRows.map(r => r.Manager || '미지정')));
      setHiddenMgrCusts({});
      isFirstLoad.current.mgrs = false;
    }
  }, [mgrRows]);

  // ── 칩 토글 헬퍼
  const toggleCust = useCallback((ck) => setHiddenCusts(prev => {
    const n = new Set(prev); n.has(ck) ? n.delete(ck) : n.add(ck); return n;
  }), []);

  const toggleMgr = useCallback((mgr) => setHiddenMgrs(prev => {
    const n = new Set(prev); n.has(mgr) ? n.delete(mgr) : n.add(mgr); return n;
  }), []);

  const toggleMgrCust = useCallback((mgr, ck) => setHiddenMgrCusts(prev => {
    const mset = new Set(prev[mgr] || []); mset.has(ck) ? mset.delete(ck) : mset.add(ck);
    return { ...prev, [mgr]: mset };
  }), []);

  // ── 데이터 로드
  const loadData = useCallback(async (wf, wt, t) => {
    if (!wf || !wt) return;
    setLoading(true); setError('');
    try {
      const p = `weekFrom=${encodeURIComponent(wf)}&weekTo=${encodeURIComponent(wt)}`;
      const urls = {
        products:  `/api/shipment/stock-status?${p}&view=products`,
        customers: `/api/shipment/stock-status?${p}&view=customers`,
        managers:  `/api/shipment/stock-status?${p}&view=managers`,
        pivot:     `/api/shipment/stock-status?${p}&view=pivot`,
      };
      if (!urls[t]) return;
      const r = await fetch(urls[t]);
      const d = await r.json();
      if (!d.success) { setError(d.error); return; }
      if (t === 'products')  { setProducts(d.products||[]); setProdExpand({}); }
      if (t === 'customers') setCustRows(d.rows||[]);
      if (t === 'managers')  setMgrRows(d.rows||[]);
      if (t === 'pivot') {
        setPivotRows(d.rows||[]);
        // 차수 피벗용 customers 데이터도 로드
        fetch(`/api/shipment/stock-status?${p}&view=customers`).then(r2=>r2.json()).then(d2=>{
          if(d2.success) setCustRows(d2.rows||[]);
        }).catch(()=>{});
      }
      // 시작재고 조회
      fetch(`/api/shipment/stock-status?weekFrom=${encodeURIComponent(wf)}&view=startStock`)
        .then(r=>r.json()).then(d2=>{ if(d2.success) setStartStocks(d2.stocks||{}); }).catch(()=>{});
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (weekFrom && weekTo) {
      setEditMap({});
      isFirstLoad.current = { custs: true, mgrs: true }; // 차수/탭 변경 시 필터 리셋
      loadData(weekFrom, weekTo, tab);
    }
  }, [weekFrom, weekTo, tab, loadData]);

  useEffect(() => {
    if (weekFrom && !weekToInput.value) weekToInput.setValue(weekFrom);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekFrom]);

  // ── 저장
  const handleSave = useCallback(async (ck, pk, wk) => {
    const k = `${ck}-${pk}-${wk}`;
    const qty = editMap[k] ?? 0;
    setSaving(k);
    try {
      const r = await fetch('/api/shipment/stock-status', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ custKey: ck, prodKey: pk, week: wk, outQty: qty }),
      });
      const d = await r.json();
      if (d.success) {
        setEditMap(prev => { const n={...prev}; delete n[k]; return n; });
        loadData(weekFrom, weekTo, tab);
        // 열린 prodExpand sub-row 갱신
        setProdExpand(prev => {
          const updated = {...prev};
          Object.keys(updated).forEach(prodKey => {
            if (Array.isArray(updated[prodKey])) {
              fetch(`/api/shipment/stock-status?weekFrom=${encodeURIComponent(weekFrom)}&weekTo=${encodeURIComponent(weekTo)}&view=customers&prodKey=${prodKey}`)
                .then(r=>r.json()).then(d=>{ if(d.success) setProdExpand(p=>({...p,[prodKey]:d.rows||[]})); });
              delete updated[prodKey];
            }
          });
          return updated;
        });
      } else { alert('저장 실패: ' + d.error); }
    } catch(e) { alert('오류: ' + e.message); }
    finally { setSaving(null); }
  }, [editMap, weekFrom, weekTo, tab, loadData]);

  // ── 시작재고 저장
  const saveStartStock = useCallback(async (prodKey, stock) => {
    try {
      const r = await fetch('/api/shipment/stock-status', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prodKey, week: weekFrom, stock }),
      });
      const d = await r.json();
      if (d.success) setStartStocks(prev => ({ ...prev, [prodKey]: parseFloat(stock)||0 }));
    } catch(e) { console.error(e); }
  }, [weekFrom]);

  // ── 품목 expand 토글
  const toggleProdExpand = useCallback(async (prodKey) => {
    if (prodExpand[prodKey] !== undefined) {
      setProdExpand(prev => { const n={...prev}; delete n[prodKey]; return n; });
      return;
    }
    setProdExpand(prev => ({ ...prev, [prodKey]: 'loading' }));
    try {
      const r = await fetch(`/api/shipment/stock-status?weekFrom=${encodeURIComponent(weekFrom)}&weekTo=${encodeURIComponent(weekTo)}&view=customers&prodKey=${prodKey}`);
      const d = await r.json();
      setProdExpand(prev => ({ ...prev, [prodKey]: d.success ? (d.rows||[]) : 'error' }));
    } catch { setProdExpand(prev => ({ ...prev, [prodKey]: 'error' })); }
  }, [prodExpand, weekFrom, weekTo]);

  // ── 텍스트 필터
  const applyFilter = useCallback((rows) => rows.filter(r => {
    if (filterCoun   && !r.CounName?.includes(filterCoun))     return false;
    if (filterFlower && !r.FlowerName?.includes(filterFlower)) return false;
    if (filterSearch) {
      const q = filterSearch.toLowerCase();
      if (!r.ProdName?.toLowerCase().includes(q) &&
          !r.FlowerName?.toLowerCase().includes(q) &&
          !(r.CustName?.toLowerCase().includes(q))) return false;
    }
    return true;
  }), [filterCoun, filterFlower, filterSearch]);

  const filteredProducts = useMemo(() => applyFilter(products), [products, applyFilter]);
  const filteredCustRows = useMemo(() => applyFilter(custRows), [custRows, applyFilter]);
  const filteredMgrRows  = useMemo(() => applyFilter(mgrRows),  [mgrRows,  applyFilter]);

  const allCounNames   = useMemo(() => [...new Set([...products,...custRows,...mgrRows].map(r=>r.CounName).filter(Boolean))].sort(), [products,custRows,mgrRows]);
  const allFlowerNames = useMemo(() => [...new Set([...products,...custRows,...mgrRows].map(r=>r.FlowerName).filter(Boolean))].sort(), [products,custRows,mgrRows]);

  const isRange = weekFrom !== weekTo;
  const hasWeek = weekFrom && weekTo;
  const isFilterActive = filterCoun || filterFlower || filterSearch;

  // 품목 행 정렬: 차수(범위 조회 시) → 국가 → 꽃 → 품명
  const sortItems = (items) => [...items].sort((a,b) => {
    if (isRange && a.OrderWeek !== b.OrderWeek) return (a.OrderWeek||'').localeCompare(b.OrderWeek||'');
    const c = (a.CounName||'').localeCompare(b.CounName||'', 'ko');
    if (c !== 0) return c;
    const f = (a.FlowerName||'').localeCompare(b.FlowerName||'', 'ko');
    if (f !== 0) return f;
    return (a.ProdName||'').localeCompare(b.ProdName||'', 'ko');
  });

  // ─────────────────────────────────────────────────────────────
  // 품목별 탭
  // ─────────────────────────────────────────────────────────────
  const renderProducts = () => {
    if (!filteredProducts.length) return <div style={st.empty}>데이터 없음</div>;
    return (
      <div style={{ overflowX:'auto' }}>
        <div style={{ fontSize:11, color:'#666', marginBottom:6 }}>
          💡 잔량 = 이월재고 + 입고 − 출고 | 행 클릭(▶) 시 업체별 출고수량 편집 가능
        </div>
        <table style={st.table}>
          <thead>
            <tr style={st.thead}>
              <th style={{ ...st.th, width:22 }}></th>
              <th style={st.th}>국가</th><th style={st.th}>꽃</th><th style={st.th}>품명</th><th style={st.th}>단위</th>
              <th style={{ ...st.th, background:'#006064' }}>시작재고</th>
              <th style={{ ...st.th, background:'#2e7d32' }}>이월재고</th>
              <th style={{ ...st.th, background:'#1565c0' }}>입고수량</th>
              <th style={{ ...st.th, background:'#e65100' }}>주문수량</th>
              <th style={{ ...st.th, background:'#ad1457' }}>출고수량</th>
              <th style={{ ...st.th, background:'#4a148c' }}>잔량(재고)</th>
              <th style={{ ...st.th, background:'#311b92' }}>잔량(기존)</th>
              <th style={{ ...st.th, background:'#455a64', minWidth:90 }}>기록</th>
            </tr>
          </thead>
          <tbody>
            {filteredProducts.map((p, i) => {
              const remain   = (p.prevStock||0) + (p.inQty||0) - (p.outQty||0);
              const ss = startStocks[p.ProdKey];
              const remainSS = ss != null ? ss - (p.outQty||0) : null;
              const expState = prodExpand[p.ProdKey];
              const isExp    = expState !== undefined;
              const expRows  = Array.isArray(expState) ? expState : [];
              return (
                <React.Fragment key={p.ProdKey}>
                  <tr style={{ background: i%2===0?'#fff':'#fafafa', cursor:'pointer' }}
                    onClick={() => toggleProdExpand(p.ProdKey)}>
                    <td style={{ ...st.td, textAlign:'center', color:'#1976d2', fontWeight:700, fontSize:11 }}>
                      {expState==='loading' ? '⏳' : isExp ? '▼' : '▶'}
                    </td>
                    <td style={st.td}>{p.CounName}</td>
                    <td style={st.td}>{p.FlowerName}</td>
                    <td style={{ ...st.td, fontWeight:600 }}>{p.ProdName}</td>
                    <td style={{ ...st.td, textAlign:'center' }}>{p.OutUnit}</td>
                    <td style={{ ...st.td, textAlign:'right', background:'#e0f7fa', padding:'2px 4px' }}
                        onClick={e=>e.stopPropagation()}>
                      <input type="number" defaultValue={ss ?? ''} placeholder="-"
                        style={{ width:50, textAlign:'right', fontSize:11, padding:'2px 3px', border:'1px solid #ccc', borderRadius:3, background:'#fff' }}
                        onBlur={e=>saveStartStock(p.ProdKey, e.target.value)} />
                    </td>
                    <td style={{ ...st.td, textAlign:'right', background:'#e8f5e9', fontWeight:600 }}>{fmt(p.prevStock)}</td>
                    <td style={{ ...st.td, textAlign:'right', background:'#e3f2fd' }}>{fmt(p.inQty)}</td>
                    <td style={{ ...st.td, textAlign:'right', background:'#fff3e0' }}>{fmt(p.orderQty)}</td>
                    <td style={{ ...st.td, textAlign:'right', background:'#fce4ec', fontWeight:600 }}>{fmt(p.outQty)}</td>
                    <td style={{ ...st.td, textAlign:'right', background:'#e0f7fa',
                                 color: remainSS!=null?(remainSS<0?'#d32f2f':'#006064'):'#999', fontWeight:700 }}>
                      {remainSS!=null ? fmt(remainSS) : '-'}
                    </td>
                    <td style={{ ...st.td, textAlign:'right', background:'#f3e5f5',
                                 color:remain<0?'#d32f2f':'#388e3c', fontWeight:700 }}>{fmt(remain)}</td>
                    <td style={st.td}></td>
                  </tr>
                  {isExp && expState==='loading' && (
                    <tr><td colSpan={13} style={{ ...st.td, textAlign:'center', color:'#888', fontSize:11 }}>업체별 로딩중...</td></tr>
                  )}
                  {isExp && expState==='error' && (
                    <tr><td colSpan={13} style={{ ...st.td, textAlign:'center', color:'#d32f2f', fontSize:11 }}>로드 실패</td></tr>
                  )}
                  {isExp && Array.isArray(expState) && expRows.length===0 && (
                    <tr><td colSpan={13} style={{ ...st.td, textAlign:'center', color:'#bbb', fontSize:11 }}>출고 데이터 없음</td></tr>
                  )}
                  {isExp && expRows.map(r2 => (
                    <tr key={`${p.ProdKey}-${r2.CustKey}-${r2.OrderWeek}`} style={{ background:'#eaf4fb' }}>
                      <td style={{ ...st.td, textAlign:'center', fontSize:10, color:'#aaa' }}>└</td>
                      <td colSpan={2} style={{ ...st.td, fontSize:11, paddingLeft:16 }}>
                        <b style={{ color:'#1565c0' }}>{r2.CustName}</b>
                        <span style={{ color:'#888', marginLeft:4 }}>{r2.CustArea}</span>
                      </td>
                      <td style={{ ...st.td, fontSize:11 }}>
                        {isRange && <span style={{ color:'#1976d2', fontWeight:600, marginRight:4 }}>{r2.OrderWeek}</span>}
                        {r2.ProdName}
                      </td>
                      <td style={{ ...st.td, textAlign:'center', fontSize:11 }}>{r2.OutUnit}</td>
                      <td style={{ ...st.td, textAlign:'right', background:'#e8f5e9', fontSize:11 }}>—</td>
                      <td style={{ ...st.td, textAlign:'right', background:'#e3f2fd', fontSize:11 }}>{fmt(r2.totalInQty)}</td>
                      <td style={{ ...st.td, textAlign:'right', background:'#fff3e0', fontSize:11 }}>{fmt(r2.custOrderQty)}</td>
                      <OutQtyCell ck={r2.CustKey} pk={r2.ProdKey} wk={r2.OrderWeek} baseQty={r2.outQty} />
                      <td style={{ ...st.td, textAlign:'right', background:'#f3e5f5', fontSize:11,
                                   color:((r2.totalInQty||0)-(r2.totalOutQty||0))<0?'#d32f2f':'#388e3c' }}>
                        {fmt((r2.totalInQty||0)-(r2.totalOutQty||0))}
                      </td>
                      <td style={{ ...st.td, fontSize:10, color:'#888', whiteSpace:'nowrap', textAlign:'center' }}>{r2.outCreateDtm || '—'}</td>
                    </tr>
                  ))}
                </React.Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ background:'#eceff1', fontWeight:700 }}>
              <td colSpan={5} style={st.td}>합계 ({filteredProducts.length}품목)</td>
              <td style={st.td}></td>
              <td style={{ ...st.td, textAlign:'right' }}>{fmt(filteredProducts.reduce((a,p)=>a+(p.prevStock||0),0))}</td>
              <td style={{ ...st.td, textAlign:'right' }}>{fmt(filteredProducts.reduce((a,p)=>a+(p.inQty||0),0))}</td>
              <td style={{ ...st.td, textAlign:'right' }}>{fmt(filteredProducts.reduce((a,p)=>a+(p.orderQty||0),0))}</td>
              <td style={{ ...st.td, textAlign:'right' }}>{fmt(filteredProducts.reduce((a,p)=>a+(p.outQty||0),0))}</td>
              <td style={st.td}></td>
              <td style={{ ...st.td, textAlign:'right',
                color:filteredProducts.reduce((a,p)=>a+(p.prevStock||0)+(p.inQty||0)-(p.outQty||0),0)<0?'#d32f2f':'#388e3c' }}>
                {fmt(filteredProducts.reduce((a,p)=>a+(p.prevStock||0)+(p.inQty||0)-(p.outQty||0),0))}
              </td>
              <td style={st.td}></td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────
  // 업체별 탭
  // ─────────────────────────────────────────────────────────────
  const renderCustomers = () => {
    if (!custRows.length) return (
      <div style={{ textAlign:'center', padding:'40px 20px', color:'#aaa' }}>
        <div style={{ fontSize:14, marginBottom:8 }}>이 차수에 주문 등록된 업체가 없습니다</div>
        <button onClick={() => setShowAddOrder(true)} style={st.addBtn}>+ 주문 추가</button>
      </div>
    );

    // 업체 그룹
    const grouped = {};
    filteredCustRows.forEach(r => {
      if (!grouped[r.CustKey]) grouped[r.CustKey] = { custKey:r.CustKey, name:r.CustName, area:r.CustArea, manager:r.Manager, items:[] };
      grouped[r.CustKey].items.push(r);
    });

    const visGroups = Object.values(grouped)
      .filter(g => !hiddenCusts.has(g.custKey))
      .sort((a,b) => (a.area+a.name).localeCompare(b.area+b.name));

    return (
      <div>
        {/* 업체 칩 필터 */}
        <ChipFilterBar
          chips={custChips}
          hiddenSet={hiddenCusts}
          onToggle={toggleCust}
          onSelectAll={() => setHiddenCusts(new Set())}
          onDeselectAll={() => setHiddenCusts(new Set(custChips.map(c=>c.key)))}
          label="업체 표시:"
        />

        <div style={{ fontSize:11, color:'#666', marginBottom:8 }}>
          💡 <b>출고수량</b>: 해당 업체만 | <b>전체입고·잔량</b>: 모든 업체 합계 기준 | 출고수량 셀 +/− 후 <b>저장</b>
        </div>

        {visGroups.length === 0 && (
          <div style={st.empty}>표시할 업체 없음 (칩에서 선택하세요)</div>
        )}

        {visGroups.map(g => {
          const sortedItems = sortItems(g.items);
          const totOut = sortedItems.reduce((a,b)=>a+(b.outQty||0),0);
          const totOrd = sortedItems.reduce((a,b)=>a+(b.custOrderQty||0),0);
          return (
            <div key={g.custKey} style={{ marginBottom:14 }}>
              <div style={st.custHeader}>
                <span style={{ fontWeight:700 }}>{g.name}</span>
                <span style={{ color:'#666', fontSize:12, marginLeft:8 }}>{g.area}</span>
                {g.manager && <span style={{ color:'#888', fontSize:11, marginLeft:6 }}>({g.manager})</span>}
                <span style={{ marginLeft:16, color:'#1976d2', fontSize:12 }}>내주문 {fmt(totOrd)}</span>
                <span style={{ marginLeft:8, color:'#e65100', fontSize:12 }}>출고 {fmt(totOut)}</span>
              </div>
              <div style={{ overflowX:'auto' }}>
                <table style={{ ...st.table, marginBottom:0 }}>
                  <thead>
                    <tr style={st.thead}>
                      <th style={st.th}>국가</th><th style={st.th}>꽃</th><th style={st.th}>품명</th><th style={st.th}>단위</th>
                      {isRange && <th style={st.th}>차수</th>}
                      <th style={{ ...st.th, background:'#2e7d32' }}>이월재고</th>
                      <th style={{ ...st.th, background:'#37474f' }}>내주문</th>
                      <th style={{ ...st.th, background:'#37474f' }}>전체입고</th>
                      <th style={{ ...st.th, background:'#37474f' }}>전체주문</th>
                      <th style={{ ...st.th, background:'#ad1457' }}>출고수량 ±</th>
                      <th style={{ ...st.th, background:'#4a148c' }}>잔량</th>
                      <th style={{ ...st.th, background:'#455a64', minWidth:90 }}>기록</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedItems.map((item, i) => {
                      const remain = (item.prevStock||0) + (item.totalInQty||0) - (item.totalOutQty||0);
                      return (
                        <tr key={`${item.ProdKey}-${item.OrderWeek}`} style={{ background:i%2===0?'#fff':'#fafafa' }}>
                          <td style={{ ...st.td, ...st.clickCell, background: filterCoun===item.CounName?'#bbdefb':undefined }}
                              onClick={()=>setFilterCoun(prev=>prev===item.CounName?'':item.CounName)}>{item.CounName}</td>
                          <td style={{ ...st.td, ...st.clickCell, background: filterFlower===item.FlowerName?'#c8e6c9':undefined }}
                              onClick={()=>setFilterFlower(prev=>prev===item.FlowerName?'':item.FlowerName)}>{item.FlowerName}</td>
                          <td style={{ ...st.td, fontWeight:600 }}>{item.ProdName}</td>
                          <td style={{ ...st.td, textAlign:'center' }}>{item.OutUnit}</td>
                          {isRange && <td style={{ ...st.td, textAlign:'center', fontSize:11, color:'#1565c0', fontWeight:600 }}>{item.OrderWeek}</td>}
                          <td style={{ ...st.td, textAlign:'right', background:'#e8f5e9', fontWeight:600 }}>{fmt(item.prevStock)}</td>
                          <td style={{ ...st.td, textAlign:'right', background:'#fff3e0' }}>{fmt(item.custOrderQty)}</td>
                          <td style={{ ...st.td, textAlign:'right', background:'#e3f2fd' }}>{fmt(item.totalInQty)}</td>
                          <td style={{ ...st.td, textAlign:'right', background:'#f0f4c3' }}>{fmt(item.totalOrderQty)}</td>
                          <OutQtyCell ck={item.CustKey} pk={item.ProdKey} wk={item.OrderWeek} baseQty={item.outQty} />
                          <td style={{ ...st.td, textAlign:'right', background:'#f3e5f5',
                                       color:remain<0?'#d32f2f':'#388e3c', fontWeight:700 }}>{fmt(remain)}</td>
                          <td style={{ ...st.td, fontSize:10, color:'#888', whiteSpace:'nowrap', textAlign:'center' }}>{item.outCreateDtm || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────
  // 담당자별 탭
  // ─────────────────────────────────────────────────────────────
  const renderManagers = () => {
    if (!mgrRows.length) return <div style={st.empty}>데이터 없음</div>;

    // 담당자 → 업체 그룹
    const mgrMap = {};
    filteredMgrRows.forEach(r => {
      const mgr = r.Manager || '미지정';
      if (!mgrMap[mgr]) mgrMap[mgr] = {};
      const ck = r.CustKey;
      if (!mgrMap[mgr][ck]) mgrMap[mgr][ck] = { custKey:ck, name:r.CustName, area:r.CustArea, items:[] };
      mgrMap[mgr][ck].items.push(r);
    });

    const visMgrs = Object.entries(mgrMap).filter(([mgr]) => !hiddenMgrs.has(mgr)).sort((a,b)=>a[0].localeCompare(b[0]));

    return (
      <div>
        {/* 담당자 칩 필터 */}
        <ChipFilterBar
          chips={mgrList.map(m => ({ key: m, name: m, area: '' }))}
          hiddenSet={hiddenMgrs}
          onToggle={toggleMgr}
          onSelectAll={() => setHiddenMgrs(new Set())}
          onDeselectAll={() => setHiddenMgrs(new Set(mgrList))}
          label="담당자:"
        />

        {visMgrs.length === 0 && <div style={st.empty}>표시할 담당자 없음</div>}

        {visMgrs.map(([mgr, custs]) => {
          const chips4mgr  = mgrCustChips[mgr] || [];
          const hiddenC    = hiddenMgrCusts[mgr] || new Set();
          const visCusts   = Object.values(custs).filter(g => !hiddenC.has(g.custKey)).sort((a,b)=>(a.area+a.name).localeCompare(b.area+b.name));

          return (
            <div key={mgr} style={{ marginBottom:24 }}>
              {/* 담당자 헤더 */}
              <div style={{ background:'#37474f', color:'#fff', padding:'8px 16px',
                            borderRadius:'6px 6px 0 0', fontSize:14, fontWeight:700 }}>
                👤 담당자: {mgr}
              </div>

              {/* 업체 칩 필터 (담당자 내) — 업체 1개여도 항상 표시 */}
              {chips4mgr.length > 0 && (
                <div style={{ background:'#eceff1', padding:'6px 10px', borderBottom:'1px solid #d0d8e0' }}>
                  <ChipFilterBar
                    chips={chips4mgr}
                    hiddenSet={hiddenC}
                    onToggle={(ck) => toggleMgrCust(mgr, ck)}
                    onSelectAll={() => setHiddenMgrCusts(prev=>({...prev,[mgr]:new Set()}))}
                    onDeselectAll={() => setHiddenMgrCusts(prev=>({...prev,[mgr]:new Set(chips4mgr.map(c=>c.key))}))}
                    label="업체:"
                  />
                </div>
              )}

              {visCusts.length === 0 && <div style={{ padding:'12px 16px', color:'#aaa', fontSize:12 }}>표시할 업체 없음</div>}

              {visCusts.map(g => {
                const sortedItems = sortItems(g.items);
                const totOut = sortedItems.reduce((a,b)=>a+(b.outQty||0),0);
                const totOrd = sortedItems.reduce((a,b)=>a+(b.custOrderQty||0),0);
                return (
                  <div key={g.custKey}>
                    <div style={{ ...st.custHeader, borderRadius:0, borderLeft:'3px solid #78909c' }}>
                      <span style={{ fontWeight:600 }}>{g.name}</span>
                      <span style={{ color:'#777', fontSize:12, marginLeft:8 }}>{g.area}</span>
                      <span style={{ marginLeft:16, color:'#1976d2', fontSize:12 }}>주문 {fmt(totOrd)}</span>
                      <span style={{ marginLeft:8, color:'#e65100', fontSize:12 }}>출고 {fmt(totOut)}</span>
                    </div>
                    <div style={{ overflowX:'auto' }}>
                      <table style={{ ...st.table, marginBottom:0 }}>
                        <thead>
                          <tr style={{ ...st.thead, background:'#546e7a' }}>
                            <th style={st.th}>국가</th><th style={st.th}>꽃</th><th style={st.th}>품명</th><th style={st.th}>단위</th>
                            {isRange && <th style={st.th}>차수</th>}
                            <th style={{ ...st.th, background:'#006064' }}>시작재고</th>
                            <th style={{ ...st.th, background:'#2e7d32' }}>이월재고</th>
                            <th style={{ ...st.th, background:'#455a64' }}>내주문</th>
                            <th style={{ ...st.th, background:'#455a64' }}>전체입고</th>
                            <th style={{ ...st.th, background:'#455a64' }}>전체주문</th>
                            <th style={{ ...st.th, background:'#ad1457' }}>출고수량 ±</th>
                            <th style={{ ...st.th, background:'#4a148c' }}>잔량(재고)</th>
                            <th style={{ ...st.th, background:'#311b92' }}>잔량(기존)</th>
                            <th style={{ ...st.th, background:'#455a64', minWidth:90 }}>기록</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedItems.map((item,i) => {
                            const remain = (item.prevStock||0)+(item.totalInQty||0)-(item.totalOutQty||0);
                            const ss = startStocks[item.ProdKey];
                            const remainSS = ss != null ? ss - (item.totalOutQty||0) : null;
                            return (
                              <tr key={`${item.ProdKey}-${item.OrderWeek}`} style={{ background:i%2===0?'#fff':'#fafafa' }}>
                                <td style={{ ...st.td, ...st.clickCell, background: filterCoun===item.CounName?'#bbdefb':undefined }}
                                    onClick={()=>setFilterCoun(prev=>prev===item.CounName?'':item.CounName)}>{item.CounName}</td>
                                <td style={{ ...st.td, ...st.clickCell, background: filterFlower===item.FlowerName?'#c8e6c9':undefined }}
                                    onClick={()=>setFilterFlower(prev=>prev===item.FlowerName?'':item.FlowerName)}>{item.FlowerName}</td>
                                <td style={{ ...st.td, fontWeight:600 }}>{item.ProdName}</td>
                                <td style={{ ...st.td, textAlign:'center' }}>{item.OutUnit}</td>
                                {isRange && <td style={{ ...st.td, textAlign:'center', fontSize:11, color:'#1565c0', fontWeight:600 }}>{item.OrderWeek}</td>}
                                <td style={{ ...st.td, textAlign:'right', background:'#e0f7fa', color:'#006064', fontWeight:600 }}>
                                  {ss != null ? fmt(ss) : '-'}</td>
                                <td style={{ ...st.td, textAlign:'right', background:'#e8f5e9', fontWeight:600 }}>{fmt(item.prevStock)}</td>
                                <td style={{ ...st.td, textAlign:'right', background:'#fff3e0' }}>{fmt(item.custOrderQty)}</td>
                                <td style={{ ...st.td, textAlign:'right', background:'#e3f2fd' }}>{fmt(item.totalInQty)}</td>
                                <td style={{ ...st.td, textAlign:'right', background:'#f0f4c3' }}>{fmt(item.totalOrderQty)}</td>
                                <OutQtyCell ck={item.CustKey} pk={item.ProdKey} wk={item.OrderWeek} baseQty={item.outQty} />
                                <td style={{ ...st.td, textAlign:'right', background:'#e0f7fa',
                                             color: remainSS!=null?(remainSS<0?'#d32f2f':'#006064'):'#999', fontWeight:700 }}>
                                  {remainSS!=null ? fmt(remainSS) : '-'}</td>
                                <td style={{ ...st.td, textAlign:'right', background:'#f3e5f5',
                                             color:remain<0?'#d32f2f':'#388e3c', fontWeight:700 }}>{fmt(remain)}</td>
                                <td style={{ ...st.td, fontSize:10, color:'#888', whiteSpace:'nowrap', textAlign:'center' }}>{item.outCreateDtm || '—'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────
  // 차수 피벗 뷰 (품명 × 업체 × 차수 + 롤링 재고) — 모아보기 탭에서 사용
  // ─────────────────────────────────────────────────────────────
  // 업체 짧은 이름: Descr의 '/' 앞 부분, 없으면 업체명
  const custShortName = useCallback((r) => {
    const d = r.CustDescr || r.Descr || '';
    if (d) { const first = d.split('/')[0].trim(); if (first) return first; }
    return r.CustName;
  }, []);

  // 품명에서 모든 꽃/국가 영문명 제거
  const stripProdName = useCallback((name) => {
    return name
      .replace(/^(\[.*?\]\s*)*/,'')  // [MEL], [EZ], [오경] 등
      .replace(/^(SPRAY\s+ROSE|ORCHID\s+VIETNAM|Ecuador\s+Tinted?|ALSTROMERIA|Minicarnation|CARNATION|Hydrangea|Anthurium|Delphinium|Amaryllis|Eucalyptus|Gladiolus|Asparagus|POMPON|DAHLIA|Ecuador|ORCHID|CHINA|ROSE|Tulip|Calla|Sweet|Gerbera|Peony|Den\.|Lisianthus|Hyacinthus|Spary|Allium|Acasia|Narcissus|Eryngium|Clematis|Veronica|Agapanthus|Helleborus|Fritillaria|Wax|Skimmia|Astrantia|Eyphorbia|Cymbidium|Panicum|Amaranthus|Nerine|Lily|Bouvardia|Ranunculus|Saponaria|Astilbe|Iris|Ruscus|SALAL|MOK|Rosa|Gentiana|Scabiosa|Sandersonia|Matricaria|Triteleia|Leucospermum|Campanula|Gloriosa|Grevillea|Jasmine|Oncidium|Fern|Cotton|Cortaderia|Kangaroo|Pong|Eustoma|ARAN|STATICE|LIMONIUM|PITTOSPORUM|Nutan|Preserved|Leucothoe|Genista|Thryptomene|Ananas|Wolly|Garden)\s*[\/\s]*/i, '')
      .replace(/^\s*\/\s*/,'').trim() || name;
  }, []);

  // 피벗 전용 필터
  const [pvMgr, setPvMgr] = useState('');
  const [pvCusts, setPvCusts] = useState(new Set());
  const [pvFlowers, setPvFlowers] = useState(new Set()); // 다중 꽃 선택
  const [pvDescrOpen, setPvDescrOpen] = useState(true);  // 비고 접기/펼치기
  // 피벗 셀 인라인 편집
  const [pvEdit, setPvEdit] = useState(null); // { pk, ck, wk, val, newVal, custName }

  const savePvCell = useCallback(async (pk, ck, wk, newQty, oldQty, custName) => {
    const qty = parseFloat(newQty) || 0;
    const old = parseFloat(oldQty) || 0;
    if (qty === old) { setPvEdit(null); return; }
    try {
      const diff = qty - old;
      const diffStr = diff > 0 ? `${diff}추가` : `${Math.abs(diff)}감소`;
      const r = await fetch('/api/shipment/stock-status', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ custKey: ck, prodKey: pk, week: wk, outQty: qty,
          descrLog: `${custName} ${old}>${qty}(${diffStr})` }),
      });
      const d = await r.json();
      if (d.success) { setPvEdit(null); loadData(weekFrom, weekTo, tab); }
      else alert('저장 실패: ' + d.error);
    } catch(e) { alert('오류: ' + e.message); }
  }, [weekFrom, weekTo, tab, loadData]);

  const renderWeekPivot = () => {
    // 담당자/업체 목록 (필터용) — 필터 전 원본에서 추출
    const allMgrs = [...new Set(custRows.map(r=>r.Manager||'미지정'))].sort();
    const allCusts = {};
    custRows.forEach(r => { allCusts[r.CustKey] = { name: r.CustName, area: r.CustArea, descr: r.CustDescr, mgr: r.Manager }; });
    const allCustList = Object.entries(allCusts)
      .filter(([,c]) => !pvMgr || (c.mgr||'미지정')===pvMgr)
      .sort((a,b) => ((a[1].area||'')+a[1].name).localeCompare((b[1].area||'')+b[1].name, 'ko'));

    // 피벗 전용 필터 적용
    let rows = filteredCustRows;
    if (pvMgr) rows = rows.filter(r => (r.Manager||'미지정') === pvMgr);
    if (pvCusts.size > 0) rows = rows.filter(r => pvCusts.has(r.CustKey));
    if (pvFlowers.size > 0) rows = rows.filter(r => pvFlowers.has(r.FlowerName));

    const weeks = [...new Set(rows.map(r=>r.OrderWeek))].sort();
    const custMap = {};
    rows.forEach(r => { custMap[r.CustKey] = { name: r.CustName, area: r.CustArea || '기타', descr: r.CustDescr }; });
    const custKeys = Object.keys(custMap).map(Number)
      .sort((a,b) => ((custMap[a].area+custMap[a].name).localeCompare(custMap[b].area+custMap[b].name, 'ko')));
    // 지역 그룹 계산
    const areaGroups = [];
    let lastArea = null, areaStart = 0;
    custKeys.forEach((ck, i) => {
      const area = custMap[ck].area;
      if (area !== lastArea) { if (lastArea !== null) areaGroups.push({ area: lastArea, count: i - areaStart }); lastArea = area; areaStart = i; }
    });
    if (lastArea !== null) areaGroups.push({ area: lastArea, count: custKeys.length - areaStart });

    // 품목 — 수량 있는 것만
    const prodMap = {};
    rows.forEach(r => {
      if ((r.outQty||0) > 0 || (r.custOrderQty||0) > 0) {
        if (!prodMap[r.ProdKey]) prodMap[r.ProdKey] = { name:r.ProdName, coun:r.CounName, flower:r.FlowerName, unit:r.OutUnit };
      }
    });
    const prodKeys = Object.keys(prodMap).map(Number).sort((a,b) =>
      ((prodMap[a].coun||'')+(prodMap[a].flower||'')+(prodMap[a].name||'')).localeCompare(
       (prodMap[b].coun||'')+(prodMap[b].flower||'')+(prodMap[b].name||''), 'ko'));

    const dataMap = {}, inMap = {}, descrMap = {}, fixMap = {};
    rows.forEach(r => {
      const dk = `${r.ProdKey}-${r.CustKey}-${r.OrderWeek}`;
      dataMap[dk] = r.outQty || 0;
      if (r.outDescr) descrMap[dk] = r.outDescr;
      if (r.outCreateDtm) fixMap[dk] = r.outCreateDtm; // ShipmentDtm 존재 = 확정 여부 판단용
      const ik = `${r.ProdKey}-${r.OrderWeek}`;
      if (!inMap[ik]) inMap[ik] = r.totalInQty || 0;
    });
    // isFix: CustKey-OrderWeek 단위로 확정 여부
    const isFixed = (ck, wk) => {
      return rows.some(r => r.CustKey===ck && r.OrderWeek===wk && r.isFix);
    };

    if (weeks.length === 0 || prodKeys.length === 0) return <div style={st.empty}>필터 조건에 맞는 데이터 없음</div>;

    const PROD_REPEAT = 10;
    const CUST_REPEAT = 15;
    const stockCols = 7; // 시작재고/시작비고/입고/출고/잔량/비고
    const prodLabelCols = custKeys.length > CUST_REPEAT ? Math.floor((custKeys.length-1) / CUST_REPEAT) : 0;
    const colsPerWeek = custKeys.length + stockCols + prodLabelCols;

    // 업체 짧은 이름
    const cShort = (ck) => {
      const c = custMap[ck];
      if (!c) return '?';
      const d = (c.descr||'').split('/')[0].trim();
      return d || c.name;
    };

    const chipS = (active) => ({
      padding:'2px 8px', borderRadius:10, border:'1px solid', fontSize:10, cursor:'pointer', fontWeight: active?700:400,
      borderColor: active?'#1976d2':'#ccc', background: active?'#1976d2':'#f5f5f5', color: active?'#fff':'#555',
    });

    const renderHeaderRows = () => (
      <>
        <tr style={st.thead}>
          <th style={{ ...st.th, position:'sticky', left:0, background:'#263238', zIndex:3 }} rowSpan={3}>품명</th>
          {weeks.map(wk => (
            <th key={wk} colSpan={colsPerWeek} style={{ ...st.th, textAlign:'center', background:'#1a237e', fontSize:12, borderLeft:'2px solid #fff' }}>{wk}</th>
          ))}
        </tr>
        <tr style={st.thead}>
          {weeks.map(wk => (
            <React.Fragment key={wk}>
              {areaGroups.map((ag,ai) => (
                <th key={`${wk}-a${ai}`} colSpan={ag.count} style={{ ...st.th, textAlign:'center', background:'#455a64', fontSize:9, borderLeft: ai===0?'2px solid #fff':'none' }}>{ag.area}</th>
              ))}
              <th colSpan={stockCols} style={{ ...st.th, textAlign:'center', background:'#004d40', fontSize:9 }}>재고</th>
            </React.Fragment>
          ))}
        </tr>
        <tr style={st.thead}>
          {weeks.map(wk => (
            <React.Fragment key={wk}>
              {custKeys.map((ck,ci) => (
                <React.Fragment key={`${wk}-${ck}`}>
                  {ci > 0 && ci % CUST_REPEAT === 0 && <th style={{...st.th,background:'#ff8f00',fontSize:7,textAlign:'center',padding:'2px',minWidth:16}}>품명</th>}
                  <th style={{ ...st.th, fontSize:9, textAlign:'center', minWidth:44, maxWidth:60,
                      whiteSpace:'normal', wordBreak:'break-all', lineHeight:'1.2', padding:'4px 2px',
                      borderLeft: ci===0?'2px solid #fff':'none' }}>
                    {cShort(ck)}
                  </th>
                </React.Fragment>
              ))}
              <th style={{ ...st.th, background:'#006064', textAlign:'center', fontSize:8 }}>시작재고</th>
              <th style={{ ...st.th, background:'#004d40', textAlign:'center', fontSize:8, minWidth:50 }}>시작비고</th>
              <th style={{ ...st.th, background:'#1565c0', textAlign:'center', fontSize:8 }}>입고</th>
              <th style={{ ...st.th, background:'#ad1457', textAlign:'center', fontSize:8 }}>출고</th>
              <th style={{ ...st.th, background:'#4a148c', textAlign:'center', fontSize:8 }}>잔량</th>
              <th style={{ ...st.th, background:'#37474f', textAlign:'center', fontSize:8, minWidth: pvDescrOpen?80:30, cursor:'pointer' }}
                  onClick={()=>setPvDescrOpen(p=>!p)}>
                {pvDescrOpen ? '비고 ▾' : '▸'}
              </th>
            </React.Fragment>
          ))}
        </tr>
      </>
    );

    return (
      <div>
        {/* 피벗 필터: 담당자 → 업체 → 국가 → 꽃 */}
        <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginBottom:6 }}>
          <span style={{fontSize:10,color:'#888',lineHeight:'22px'}}>담당자:</span>
          <button onClick={()=>{setPvMgr('');setPvCusts(new Set());}} style={chipS(!pvMgr)}>전체</button>
          {allMgrs.map(m=>(<button key={m} onClick={()=>{setPvMgr(m);setPvCusts(new Set());}} style={chipS(pvMgr===m)}>{m}</button>))}
        </div>
        <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginBottom:6 }}>
          <span style={{fontSize:10,color:'#888',lineHeight:'22px'}}>업체:</span>
          <button onClick={()=>setPvCusts(new Set())} style={chipS(pvCusts.size===0)}>전체</button>
          {allCustList.map(([ck,c])=>{
            const k=Number(ck); const active=pvCusts.has(k);
            const short=(c.descr||'').split('/')[0].trim()||c.name;
            return (<button key={ck} onClick={()=>setPvCusts(prev=>{const n=new Set(prev);active?n.delete(k):n.add(k);return n;})} style={chipS(active)}>{short}</button>);
          })}
        </div>
        <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginBottom:6 }}>
          <span style={{fontSize:10,color:'#888',lineHeight:'22px'}}>국가:</span>
          <button onClick={()=>{setFilterCoun('');setFilterFlower('');}} style={chipS(!filterCoun)}>전체</button>
          {allCounNames.map(c=>(<button key={c} onClick={()=>{setFilterCoun(prev=>prev===c?'':c);setFilterFlower('');}} style={chipS(filterCoun===c)}>{c}</button>))}
        </div>
        {filterCoun && (() => {
          const flowers = [...new Set(custRows.filter(r=>r.CounName===filterCoun).map(r=>r.FlowerName).filter(Boolean))].sort();
          return (
            <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginBottom:6 }}>
              <span style={{fontSize:10,color:'#888',lineHeight:'22px'}}>꽃:</span>
              <button onClick={()=>setPvFlowers(new Set())} style={chipS(pvFlowers.size===0)}>전체</button>
              {flowers.map(f=>{
                const active = pvFlowers.has(f);
                return (<button key={f} onClick={()=>setPvFlowers(prev=>{const n=new Set(prev);active?n.delete(f):n.add(f);return n;})} style={chipS(active)}>{f}</button>);
              })}
            </div>
          );
        })()}
        <button onClick={()=>{
          // 엑셀 데이터 생성
          const xlData = [];
          // 헤더
          const hdr = ['국가','꽃','품명'];
          weeks.forEach(wk => { custKeys.forEach(ck => hdr.push(`${wk} ${cShort(ck)}`)); hdr.push(`${wk} 시작`,`${wk} 입고`,`${wk} 출고`,`${wk} 잔량`); });
          xlData.push(hdr);
          // 데이터
          prodKeys.forEach(pk => {
            const p = prodMap[pk];
            const row = [p.coun, p.flower, stripProdName(p.name)];
            let rs = startStocks[pk] || 0;
            weeks.forEach(wk => {
              custKeys.forEach(ck => row.push(dataMap[`${pk}-${ck}-${wk}`]||0));
              const wStart = rs, inQ = inMap[`${pk}-${wk}`]||0;
              const wOut = custKeys.reduce((a,ck)=>a+(dataMap[`${pk}-${ck}-${wk}`]||0),0);
              rs = wStart + inQ - wOut;
              row.push(wStart, inQ, wOut, rs);
            });
            xlData.push(row);
          });
          const ws = XLSX.utils.aoa_to_sheet(xlData);
          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, ws, '차수피벗');
          XLSX.writeFile(wb, `차수피벗_${weeks.join('~')}.xlsx`);
        }} style={{ ...st.addBtn, marginBottom:8, background:'#2e7d32' }}>📥 엑셀 다운로드</button>

        {rows.length === 0 ? (
          <div style={st.empty}>필터 조건에 맞는 데이터 없음</div>
        ) : (
        <div style={{ overflowX:'auto', overflowY:'auto', maxHeight:'70vh', position:'relative' }}>
        <table style={{ ...st.table, fontSize:10, borderCollapse:'collapse' }}>
          <thead style={{ position:'sticky', top:0, zIndex:4 }}>
            {renderHeaderRows()}
          </thead>
          <tbody>
            {prodKeys.map((pk, pi) => {
              const p = prodMap[pk];
              let rollingStock = startStocks[pk] || 0;

              // N품목마다 업체헤더 반복
              const needCustRepeat = pi > 0 && pi % PROD_REPEAT === 0;

              return (
                <React.Fragment key={pk}>
                  {needCustRepeat && (
                    <tr style={{ background:'#eceff1' }}>
                      <td style={{ ...st.td, position:'sticky', left:0, background:'#eceff1', zIndex:1, fontSize:9, color:'#555', fontWeight:700 }}>▼ 업체 ▼</td>
                      {weeks.map(wk => (
                        <React.Fragment key={wk}>
                          {custKeys.map((ck,ci) => (
                            <React.Fragment key={`r-${wk}-${ck}`}>
                              {ci > 0 && ci % CUST_REPEAT === 0 && <td style={{...st.td,background:'#eceff1',fontSize:7,color:'#888',textAlign:'center'}}>품명</td>}
                              <td style={{ ...st.td, fontSize:8, textAlign:'center', color:'#555', fontWeight:600,
                                  whiteSpace:'normal', wordBreak:'break-all', background:'#eceff1',
                                  borderLeft: ci===0?'2px solid #ccc':'none' }}>
                                {cShort(ck)}
                              </td>
                            </React.Fragment>
                          ))}
                          <td colSpan={stockCols} style={{ ...st.td, background:'#eceff1' }}></td>
                        </React.Fragment>
                      ))}
                    </tr>
                  )}
                  <tr style={{ background: pi%2===0?'#fff':'#f5f5f5' }}>
                    <td style={{ ...st.td, position:'sticky', left:0, background: pi%2===0?'#fff':'#f5f5f5', zIndex:1, minWidth:150 }}>
                      <span style={{ ...st.clickCell, fontSize:8, color: filterCoun===p.coun?'#1565c0':'#999' }}
                            onClick={()=>setFilterCoun(prev=>prev===p.coun?'':p.coun)}>{p.coun}</span>
                      <span style={{ ...st.clickCell, fontSize:8, color: filterFlower===p.flower?'#2e7d32':'#999', marginLeft:2 }}
                            onClick={()=>setFilterFlower(prev=>prev===p.flower?'':p.flower)}>·{p.flower}</span>
                      <div style={{fontWeight:600, fontSize:10}}>{stripProdName(p.name)}</div>
                    </td>
                    {weeks.map(wk => {
                      const weekStart = rollingStock;
                      const inQty = inMap[`${pk}-${wk}`] || 0;
                      const weekOut = custKeys.reduce((a,ck) => a + (dataMap[`${pk}-${ck}-${wk}`]||0), 0);
                      rollingStock = weekStart + inQty - weekOut;
                      return (
                        <React.Fragment key={wk}>
                          {custKeys.map((ck,ci) => {
                            const v = dataMap[`${pk}-${ck}-${wk}`] || 0;
                            return (
                              <React.Fragment key={`${wk}-${ck}`}>
                                {ci > 0 && ci % CUST_REPEAT === 0 && (
                                  <td style={{...st.td,fontSize:8,fontWeight:600,color:'#e65100',whiteSpace:'nowrap',
                                      background:'#fff8e1',borderLeft:'2px solid #ff9800',padding:'2px 4px',
                                      whiteSpace:'normal',wordBreak:'break-all',lineHeight:'1.1',maxWidth:56,minWidth:56}}>
                                    {stripProdName(p.name).slice(0,10)}
                                  </td>
                                )}
                                {(() => {
                                  const fixed = isFixed(ck, wk);
                                  return (
                                    <td style={{...st.td,textAlign:'right',fontSize:10,
                                        cursor: fixed?'not-allowed':'pointer',
                                        borderLeft: ci===0?'2px solid #e0e0e0':'none',
                                        color:v>0?'#1565c0':'#ddd',
                                        background: fixed?'#f5f5f5': pvEdit?.pk===pk&&pvEdit?.ck===ck&&pvEdit?.wk===wk?'#fff9c4':undefined}}
                                        onClick={()=>{ if(fixed){alert('확정된 차수는 수정할 수 없습니다');return;} setPvEdit({pk,ck,wk,val:v,newVal:v,custName:cShort(ck)}); }}>
                                      {v>0?fmt(v):'·'}
                                      {fixed && v>0 && <span style={{fontSize:7,color:'#999'}}>🔒</span>}
                                    </td>
                                  );
                                })()}
                              </React.Fragment>
                            );
                          })}
                          <td style={{...st.td,textAlign:'right',background:'#e0f7fa',padding:'2px 3px'}}
                              onClick={e=>e.stopPropagation()}>
                            {wk === weeks[0] ? (
                              <input type="number" defaultValue={startStocks[pk]??''} placeholder="-"
                                style={{width:40,textAlign:'right',fontSize:9,padding:'1px 2px',border:'1px solid #ccc',borderRadius:2,background:'#fff'}}
                                onBlur={e=>saveStartStock(pk,e.target.value)} />
                            ) : <span style={{fontSize:9,fontWeight:600}}>{fmt(weekStart)}</span>}
                          </td>
                          <td style={{...st.td,fontSize:8,color:'#555',maxWidth:50,whiteSpace:'pre-line',lineHeight:'1.1',background:'#e0f7fa'}}>
                            {wk === weeks[0] ? '' : ''}
                          </td>
                          <td style={{...st.td,textAlign:'right',background:'#e3f2fd',fontSize:9}}>{fmt(inQty)}</td>
                          <td style={{...st.td,textAlign:'right',background:'#fce4ec',fontWeight:600,fontSize:9}}>{fmt(weekOut)}</td>
                          <td style={{...st.td,textAlign:'right',background:'#f3e5f5',fontWeight:700,fontSize:9,
                                      color:rollingStock<0?'#d32f2f':'#388e3c'}}>{fmt(rollingStock)}</td>
                          {(() => {
                            const logs = custKeys.map(ck=>descrMap[`${pk}-${ck}-${wk}`]).filter(Boolean);
                            const cnt = logs.reduce((a,l) => a + l.split('\n').filter(Boolean).length, 0);
                            return (
                              <td style={{...st.td,fontSize:8,color:'#555',maxWidth: pvDescrOpen?120:30,whiteSpace:'pre-line',lineHeight:'1.2',cursor:'pointer'}}
                                  onClick={()=>setPvDescrOpen(p=>!p)}>
                                {pvDescrOpen ? (logs.join('\n') || '') : (cnt > 0 ? <span style={{color:'#e65100',fontWeight:700}}>+{cnt}</span> : '')}
                              </td>
                            );
                          })()}
                        </React.Fragment>
                      );
                    })}
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
      {/* 수량 수정 모달 */}
      {pvEdit && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center'}}
             onClick={e=>e.target===e.currentTarget&&setPvEdit(null)}>
          <div style={{background:'#fff',borderRadius:10,padding:20,boxShadow:'0 8px 32px rgba(0,0,0,0.3)',minWidth:280,textAlign:'center'}}>
            <div style={{fontSize:14,fontWeight:700,marginBottom:12}}>출고수량 수정</div>
            <div style={{fontSize:12,color:'#888',marginBottom:8}}>{pvEdit.custName}</div>
            <div style={{display:'flex',gap:16,justifyContent:'center',marginBottom:16}}>
              <div>
                <div style={{fontSize:10,color:'#888'}}>기존수량</div>
                <div style={{fontSize:24,fontWeight:700,color:'#37474f'}}>{pvEdit.val}</div>
              </div>
              <div style={{fontSize:20,color:'#aaa',lineHeight:'48px'}}>→</div>
              <div>
                <div style={{fontSize:10,color:'#1976d2'}}>수정수량</div>
                <div style={{fontSize:24,fontWeight:700,color:'#1976d2'}}>{pvEdit.newVal}</div>
              </div>
            </div>
            <div style={{display:'flex',gap:6,justifyContent:'center',marginBottom:12}}>
              <button onClick={()=>setPvEdit(p=>({...p,newVal:(p.newVal||0)-10}))} style={{...st.pmBtn,width:44,fontSize:12,background:'#ffcdd2'}}>-10</button>
              <button onClick={()=>setPvEdit(p=>({...p,newVal:(p.newVal||0)-1}))} style={{...st.pmBtn,width:44,fontSize:14,background:'#ffcdd2'}}>-1</button>
              <input type="number" value={pvEdit.newVal} onChange={e=>setPvEdit(p=>({...p,newVal:parseFloat(e.target.value)||0}))}
                style={{width:60,textAlign:'center',fontSize:16,fontWeight:700,border:'2px solid #1976d2',borderRadius:6,padding:'4px'}} />
              <button onClick={()=>setPvEdit(p=>({...p,newVal:(p.newVal||0)+1}))} style={{...st.pmBtn,width:44,fontSize:14,background:'#c8e6c9'}}>+1</button>
              <button onClick={()=>setPvEdit(p=>({...p,newVal:(p.newVal||0)+10}))} style={{...st.pmBtn,width:44,fontSize:12,background:'#c8e6c9'}}>+10</button>
            </div>
            <div style={{display:'flex',gap:8,justifyContent:'center'}}>
              <button onClick={()=>setPvEdit(null)} style={{padding:'8px 20px',border:'1px solid #ccc',borderRadius:5,cursor:'pointer',background:'#f5f5f5'}}>취소</button>
              <button onClick={()=>savePvCell(pvEdit.pk,pvEdit.ck,pvEdit.wk,pvEdit.newVal,pvEdit.val,pvEdit.custName)}
                style={{padding:'8px 24px',background:'#1976d2',color:'#fff',border:'none',borderRadius:5,cursor:'pointer',fontWeight:700}}>
                저장
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────
  // 모아보기 탭
  // ─────────────────────────────────────────────────────────────
  const renderPivot = () => {
    if (!pivotRows.length) return <div style={st.empty}>출고 데이터 없음 (출고수량 0 제외)</div>;

    if (pivotSub === 'byCust') {
      const prodMap={}, custMap={};
      pivotRows.forEach(r=>{
        prodMap[r.ProdKey]={name:r.ProdName,flower:r.FlowerName,coun:r.CounName};
        if(!custMap[r.CustKey]) custMap[r.CustKey]={name:r.CustName,area:r.CustArea,data:{}};
        custMap[r.CustKey].data[r.ProdKey]=(custMap[r.CustKey].data[r.ProdKey]||0)+(r.outQty||0);
      });
      const prods=Object.entries(prodMap).sort((a,b)=>{const A=prodMap[a[0]],B=prodMap[b[0]];return(A.coun+A.flower+A.name).localeCompare(B.coun+B.flower+B.name);});
      const custs=Object.values(custMap).sort((a,b)=>(a.area+a.name).localeCompare(b.area+b.name));
      const prodTotals={};
      prods.forEach(([pk])=>{prodTotals[pk]=custs.reduce((a,c)=>a+(c.data[pk]||0),0);});
      return (
        <div style={{overflowX:'auto'}}>
          <div style={{fontSize:12,color:'#666',marginBottom:8}}>📊 업체기준 — 업체행 × 품목열</div>
          <table style={{...st.table,fontSize:11}}>
            <thead>
              <tr style={st.thead}>
                <th style={{...st.th,minWidth:80,position:'sticky',left:0,zIndex:2,background:'#37474f'}}>업체명</th>
                {prods.map(([pk])=>(
                  <th key={pk} style={{...st.th,minWidth:70}}>
                    {prodMap[pk].flower}<br/><span style={{fontSize:10,color:'#cfd8dc'}}>{prodMap[pk].name}</span>
                  </th>
                ))}
                <th style={{...st.th,background:'#546e7a'}}>합계</th>
              </tr>
            </thead>
            <tbody>
              {custs.map((c,ci)=>{
                const rowTotal=prods.reduce((a,[pk])=>a+(c.data[pk]||0),0);
                return (
                  <tr key={c.name} style={{background:ci%2===0?'#fff':'#f5f5f5'}}>
                    <td style={{...st.td,fontWeight:600,position:'sticky',left:0,background:ci%2===0?'#fff':'#f5f5f5',zIndex:1}}>{c.name}</td>
                    {prods.map(([pk])=>(
                      <td key={pk} style={{...st.td,textAlign:'right',color:(c.data[pk]||0)>0?'#1565c0':'#bbb'}}>
                        {(c.data[pk]||0)>0?fmt(c.data[pk]):'−'}
                      </td>
                    ))}
                    <td style={{...st.td,textAlign:'right',fontWeight:700,background:'#e8eaf6'}}>{fmt(rowTotal)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{background:'#eceff1',fontWeight:700}}>
                <td style={{...st.td,position:'sticky',left:0,background:'#eceff1',zIndex:1}}>합계</td>
                {prods.map(([pk])=><td key={pk} style={{...st.td,textAlign:'right'}}>{fmt(prodTotals[pk])}</td>)}
                <td style={{...st.td,textAlign:'right'}}>{fmt(Object.values(prodTotals).reduce((a,b)=>a+b,0))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      );
    }

    // 품목 기준
    const prodMap={}, custMap={};
    pivotRows.forEach(r=>{
      if(!prodMap[r.ProdKey]) prodMap[r.ProdKey]={name:r.ProdName,flower:r.FlowerName,coun:r.CounName,data:{}};
      custMap[r.CustKey]={name:r.CustName,area:r.CustArea};
      prodMap[r.ProdKey].data[r.CustKey]=(prodMap[r.ProdKey].data[r.CustKey]||0)+(r.outQty||0);
    });
    const prods=Object.entries(prodMap).sort((a,b)=>{const A=prodMap[a[0]],B=prodMap[b[0]];return(A.coun+A.flower+A.name).localeCompare(B.coun+B.flower+B.name);});
    const custs=Object.entries(custMap).sort((a,b)=>(custMap[a[0]].area+custMap[a[0]].name).localeCompare(custMap[b[0]].area+custMap[b[0]].name));
    const custTotals={};
    custs.forEach(([ck])=>{custTotals[ck]=prods.reduce((a,[pk])=>a+(prodMap[pk].data[ck]||0),0);});
    return (
      <div style={{overflowX:'auto'}}>
        <div style={{fontSize:12,color:'#666',marginBottom:8}}>📊 품목기준 — 품목행 × 업체열</div>
        <table style={{...st.table,fontSize:11}}>
          <thead>
            <tr style={st.thead}>
              <th style={{...st.th,minWidth:110,position:'sticky',left:0,zIndex:2,background:'#37474f'}}>품명</th>
              {custs.map(([ck])=><th key={ck} style={{...st.th,minWidth:60}}>{custMap[ck].name}</th>)}
              <th style={{...st.th,background:'#546e7a'}}>합계</th>
            </tr>
          </thead>
          <tbody>
            {prods.map(([pk,p],pi)=>{
              const rowTotal=custs.reduce((a,[ck])=>a+(p.data[ck]||0),0);
              return (
                <tr key={pk} style={{background:pi%2===0?'#fff':'#f5f5f5'}}>
                  <td style={{...st.td,fontWeight:600,position:'sticky',left:0,background:pi%2===0?'#fff':'#f5f5f5',zIndex:1}}>
                    <div style={{fontSize:10,color:'#888'}}>{p.coun}·{p.flower}</div>{p.name}
                  </td>
                  {custs.map(([ck])=>(
                    <td key={ck} style={{...st.td,textAlign:'right',color:(p.data[ck]||0)>0?'#1565c0':'#bbb'}}>
                      {(p.data[ck]||0)>0?fmt(p.data[ck]):'−'}
                    </td>
                  ))}
                  <td style={{...st.td,textAlign:'right',fontWeight:700,background:'#e8eaf6'}}>{fmt(rowTotal)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{background:'#eceff1',fontWeight:700}}>
              <td style={{...st.td,position:'sticky',left:0,background:'#eceff1',zIndex:1}}>합계</td>
              {custs.map(([ck])=><td key={ck} style={{...st.td,textAlign:'right'}}>{fmt(custTotals[ck])}</td>)}
              <td style={{...st.td,textAlign:'right'}}>{fmt(Object.values(custTotals).reduce((a,b)=>a+b,0))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────
  // 렌더
  // ─────────────────────────────────────────────────────────────
  return (
    <EditCtx.Provider value={{ editMap, setEditMap, saving, handleSave }}>
      <Layout title="출고,재고상황">
        <div style={{ padding:'16px 20px', maxWidth:1600, margin:'0 auto' }}>

          {/* 헤더 */}
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12, flexWrap:'wrap' }}>
            <h2 style={{ margin:0, fontSize:18, fontWeight:700 }}>출고,재고상황</h2>
            <div style={{ display:'flex', alignItems:'center', gap:4, background:'#f5f5f5',
                          padding:'6px 10px', borderRadius:6, border:'1px solid #e0e0e0' }}>
              <span style={{ fontSize:12, color:'#555', fontWeight:600 }}>차수</span>
              <button onClick={()=>{weekFromInput.prevWeek();weekToInput.prevWeek();}} style={st.weekSyncBtn} title="양쪽 이전 주차">◀◀</button>
              <button onClick={weekFromInput.prevWeek} style={st.weekBigBtn} title="이전 주차">◁</button>
              <WeekInput weekInput={weekFromInput} />
              <button onClick={weekFromInput.nextWeek} style={st.weekBigBtn} title="다음 주차">▷</button>
              <span style={{ color:'#aaa', fontWeight:700 }}>~</span>
              <button onClick={weekToInput.prevWeek} style={st.weekBigBtn} title="이전 주차">◁</button>
              <WeekInput weekInput={weekToInput} />
              <button onClick={weekToInput.nextWeek} style={st.weekBigBtn} title="다음 주차">▷</button>
              <button onClick={()=>{weekFromInput.nextWeek();weekToInput.nextWeek();}} style={st.weekSyncBtn} title="양쪽 다음 주차">▶▶</button>
              {isRange && <span style={{ fontSize:11, color:'#1976d2' }}>(범위)</span>}
            </div>
            <button onClick={() => hasWeek && loadData(weekFrom, weekTo, tab)} style={st.refreshBtn} disabled={!hasWeek||loading}>
              🔄 새로고침
            </button>
            {['products','customers','managers'].includes(tab) && (
              <button onClick={() => setShowAddOrder(true)} style={st.addBtn}>+ 주문 추가</button>
            )}
            {loading && <span style={{ color:'#1976d2', fontSize:12, fontWeight:600 }}>로딩중...</span>}
            {saving  && <span style={{ color:'#e65100', fontSize:12, fontWeight:600 }}>저장중...</span>}
          </div>

          {/* 오류 */}
          {error && (
            <div style={{ background:'#ffebee', border:'1px solid #ef9a9a', borderRadius:6,
                          padding:'10px 14px', marginBottom:12, color:'#c62828', fontSize:13 }}>
              오류: {error}
            </div>
          )}

          {/* 텍스트 필터 바 */}
          {['products','customers','managers'].includes(tab) && (
            <div style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap', alignItems:'center',
                          background:'#f5f5f5', padding:'8px 12px', borderRadius:6,
                          border:`1px solid ${isFilterActive?'#1976d2':'#e0e0e0'}` }}>
              <span style={{ fontSize:12, color:'#555', fontWeight:600 }}>🔍</span>
              <select value={filterCoun} onChange={e=>setFilterCoun(e.target.value)} style={st.filterSel}>
                <option value="">국가 전체</option>
                {allCounNames.map(c=><option key={c} value={c}>{c}</option>)}
              </select>
              <select value={filterFlower} onChange={e=>setFilterFlower(e.target.value)} style={st.filterSel}>
                <option value="">꽃 전체</option>
                {allFlowerNames.map(f=><option key={f} value={f}>{f}</option>)}
              </select>
              <input value={filterSearch} onChange={e=>setFilterSearch(e.target.value)}
                placeholder="품명 / 꽃 / 업체명..." style={{ ...st.filterSel, width:160 }} />
              {isFilterActive && (
                <button onClick={()=>{setFilterCoun('');setFilterFlower('');setFilterSearch('');}}
                  style={{ fontSize:11, padding:'3px 10px', border:'1px solid #ccc', borderRadius:4, cursor:'pointer', background:'#fff' }}>
                  ✕ 초기화
                </button>
              )}
            </div>
          )}

          {/* 탭 */}
          <div style={{ display:'flex', gap:4, marginBottom:16, borderBottom:'2px solid #e0e0e0' }}>
            {[
              { key:'products',  label:'📦 품목별' },
              { key:'customers', label:'🏢 업체별' },
              { key:'managers',  label:'👤 담당자별' },
              { key:'pivot',     label:'📊 모아보기' },
            ].map(t=>(
              <button key={t.key} onClick={()=>setTab(t.key)}
                style={{ ...st.tabBtn, ...(tab===t.key?st.tabBtnActive:{}) }}>
                {t.label}
              </button>
            ))}
          </div>

          {/* 콘텐츠 */}
          {!hasWeek ? (
            <div style={st.empty}>차수를 선택해 주세요</div>
          ) : loading ? (
            <div style={st.empty}>데이터 로딩중...</div>
          ) : (
            <>
              {tab==='products'  && renderProducts()}
              {tab==='customers' && renderCustomers()}
              {tab==='managers'  && renderManagers()}
              {tab==='pivot' && (
                <>
                  <div style={{ display:'flex', gap:4, marginBottom:10 }}>
                    {[{key:'byCust',label:'🏢 업체기준'},{key:'byProd',label:'📦 품목기준'},{key:'weekPivot',label:'📊 차수 피벗'}].map(s=>(
                      <button key={s.key} onClick={()=>setPivotSub(s.key)}
                        style={{ ...st.subTabBtn, ...(pivotSub===s.key?st.subTabBtnActive:{}) }}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                  {pivotSub==='weekPivot' ? renderWeekPivot() : renderPivot()}
                </>
              )}
            </>
          )}
        </div>
      </Layout>

      {showAddOrder && (
        <AddOrderModal
          weekFrom={weekFrom} weekTo={weekTo}
          onClose={() => setShowAddOrder(false)}
          onSuccess={({ custKey }) => {
            // 업체별 탭: 해당 업체 칩 자동 활성화
            setHiddenCusts(prev => { const n = new Set(prev); n.delete(custKey); return n; });
            // 담당자별 탭: 모든 담당자의 해당 업체 칩 자동 활성화
            setHiddenMgrCusts(prev => {
              const n = { ...prev };
              Object.keys(n).forEach(mgr => { const s = new Set(n[mgr]); s.delete(custKey); n[mgr] = s; });
              return n;
            });
            loadData(weekFrom, weekTo, tab);
          }}
        />
      )}
    </EditCtx.Provider>
  );
}

function fmt(v) {
  if (v===null||v===undefined) return '0';
  return Number(v).toLocaleString();
}

const st = {
  table: { width:'100%', borderCollapse:'collapse', fontSize:12, marginBottom:8 },
  thead: { background:'#37474f', color:'#fff' },
  th: { padding:'8px 10px', textAlign:'left', borderRight:'1px solid #546e7a', whiteSpace:'nowrap', fontWeight:600, fontSize:12 },
  td: { padding:'6px 10px', borderBottom:'1px solid #e0e0e0', borderRight:'1px solid #f0f0f0', fontSize:12 },
  clickCell: { cursor:'pointer', textDecoration:'underline', textDecorationColor:'#bbb', textUnderlineOffset:2 },
  empty: { textAlign:'center', padding:'60px 20px', color:'#999', fontSize:14 },
  custHeader: {
    background:'#eceff1', padding:'8px 12px', borderRadius:'4px 4px 0 0',
    borderLeft:'3px solid #1976d2', fontSize:13,
    display:'flex', alignItems:'center', flexWrap:'wrap', gap:4,
  },
  refreshBtn: { padding:'5px 12px', background:'#f5f5f5', border:'1px solid #ccc', borderRadius:4, cursor:'pointer', fontSize:12 },
  weekBigBtn: { padding:'4px 8px', border:'2px solid #1976d2', borderRadius:4, cursor:'pointer', background:'#e3f2fd', fontSize:14, fontWeight:700, color:'#1976d2' },
  weekSyncBtn: { padding:'4px 8px', border:'2px solid #e65100', borderRadius:4, cursor:'pointer', background:'#fff3e0', fontSize:11, fontWeight:700, color:'#e65100' },
  addBtn: { padding:'5px 14px', background:'#1976d2', color:'#fff', border:'none', borderRadius:4, cursor:'pointer', fontSize:12, fontWeight:600 },
  tabBtn: { padding:'8px 18px', border:'none', background:'transparent', cursor:'pointer', fontSize:13, fontWeight:500, color:'#666', borderBottom:'3px solid transparent', marginBottom:-2 },
  tabBtnActive: { color:'#1976d2', borderBottom:'3px solid #1976d2', fontWeight:700 },
  subTabBtn: { padding:'5px 14px', border:'1px solid #ccc', background:'#f9f9f9', borderRadius:4, cursor:'pointer', fontSize:12, color:'#555' },
  subTabBtnActive: { background:'#1976d2', border:'1px solid #1976d2', color:'#fff', fontWeight:600 },
  pmBtn: { width:22, height:22, padding:0, fontSize:13, lineHeight:'20px', border:'1px solid #ccc', borderRadius:3, cursor:'pointer', background:'#f5f5f5', fontWeight:700, display:'inline-flex', alignItems:'center', justifyContent:'center' },
  filterSel: { fontSize:12, padding:'3px 8px', border:'1px solid #ccc', borderRadius:4, background:'#fff' },
  ctrlBtn: { padding:'2px 10px', borderRadius:12, border:'1px solid #ccc', cursor:'pointer', fontSize:11, fontWeight:500 },
  label: { display:'block', fontSize:12, fontWeight:600, color:'#555', marginBottom:4 },
  modalInput: { fontSize:13, padding:'6px 10px', border:'1px solid #ccc', borderRadius:4, width:'100%', boxSizing:'border-box' },
};
