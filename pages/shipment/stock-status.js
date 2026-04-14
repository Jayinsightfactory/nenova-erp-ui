// pages/shipment/stock-status.js — 출고,재고상황 v5
// 추가: 업체별 칩 필터 기본값 전체숨김, 줄긋기 제거, 기록컬럼, UpdateDtm 오류수정
import React, { useState, useEffect, useCallback, useMemo, useRef, createContext, useContext } from 'react';
// Layout은 _app.js에서 이미 감싸므로 별도 import 불필요
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
  const [submitResults, setSubmitResults] = useState(null); // { items: [{prod,qty,unit,status,dbQty}...] }

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

  // 업체+차수 선택 시 기존 주문수량+분배수량 조회
  useEffect(() => {
    if (!selCust || !modalWeek.value) { setExistOrders({}); return; }
    fetch(`/api/shipment/stock-status?view=customers&weekFrom=${modalWeek.value}&weekTo=${modalWeek.value}`)
      .then(r=>r.json()).then(d=>{
        if (!d.success) return;
        const map = {};
        (d.rows||[]).filter(r => r.CustKey === selCust.CustKey).forEach(r => {
          map[`${selCust.CustKey}-${r.ProdKey}-${modalWeek.value}`] = {
            orderQty: r.custOrderQty || 0,
            outQty: r.outQty || 0
          };
        });
        setExistOrders(map);
      }).catch(()=>{});
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

  // 카트: { cust:{CustKey,CustName}, prod, qty, unit, existQty, existOut }
  const addToCart = (p) => {
    if (!selCust) { setError('업체를 먼저 선택하세요'); return; }
    if (cart.find(c => c.cust.CustKey === selCust.CustKey && c.prod.ProdKey === p.ProdKey)) return;
    const u = UNITS.includes(p.OutUnit) ? p.OutUnit : '박스';
    const existKey = `${selCust.CustKey}-${p.ProdKey}-${modalWeek.value}`;
    const exist = existOrders[existKey] || {};
    const existQty = exist.orderQty || 0;
    const existOut = exist.outQty || 0;
    setCart(prev => [...prev, { cust:{CustKey:selCust.CustKey, CustName:selCust.CustName}, prod: p, qty: existQty || 1, unit: u, existQty, existOut }]);
  };
  const removeFromCart = (ck,pk) => setCart(prev => prev.filter(c => !(c.cust.CustKey===ck && c.prod.ProdKey===pk)));
  const updateCartQty = (ck,pk, val) => setCart(prev => prev.map(c => (c.cust.CustKey===ck&&c.prod.ProdKey===pk) ? {...c, qty: parseFloat(val)||0} : c));
  const updateCartUnit = (ck,pk, u) => setCart(prev => prev.map(c => (c.cust.CustKey===ck&&c.prod.ProdKey===pk) ? {...c, unit: u} : c));

  const handleSubmit = async () => {
    if (cart.length === 0) { setError('품목을 1개 이상 추가하세요'); return; }
    if (!modalWeek.value) { setError('차수를 입력하세요'); return; }
    setSaving(true); setError('');
    const results = [];
    try {
      for (const item of cart) {
        const r = await fetch('/api/shipment/stock-status', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'addOrder', custKey: item.cust.CustKey, prodKey: item.prod.ProdKey, week: modalWeek.value, qty: item.qty, unit: item.unit }),
        });
        const d = await r.json();
        results.push({ cust: item.cust, prod: item.prod, qty: item.qty, unit: item.unit, ok: d.success, error: d.error || '' });
      }
      // DB 검증: 실제 저장된 수량 확인 (업체별)
      const custKeys = [...new Set(cart.map(c=>c.cust.CustKey))];
      const verifyRes = await fetch(`/api/shipment/stock-status?view=customers&weekFrom=${modalWeek.value}&weekTo=${modalWeek.value}`);
      const verifyData = await verifyRes.json();
      const dbRows = verifyData.rows || [];
      results.forEach(r => {
        const match = dbRows.find(row => row.CustKey === r.cust.CustKey && row.ProdKey === r.prod.ProdKey);
        r.dbQty = match?.custOrderQty ?? null;
        r.verified = r.dbQty != null && r.dbQty == r.qty;
      });
      const custNames = [...new Set(cart.map(c=>c.cust.CustName))].join(', ');
      setSubmitResults({ custName: custNames, week: modalWeek.value, items: results });
      onSuccess?.({ week: modalWeek.value });
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
                const inCart = selCust && cart.some(c=>c.cust.CustKey===selCust.CustKey && c.prod.ProdKey===p.ProdKey);
                const existKey = selCust ? `${selCust.CustKey}-${p.ProdKey}-${modalWeek.value}` : '';
                const eq = existOrders[existKey];
                const hasExist = eq && (eq.orderQty > 0 || eq.outQty > 0);
                return (
                  <button key={p.ProdKey} onClick={()=>addToCart(p)}
                    style={{ ...chipStyle(inCart), borderColor: inCart?'#2e7d32': hasExist?'#ff9800':'#ccc',
                             background: inCart?'#2e7d32': hasExist?'#fff3e0':'#fff', textAlign:'left' }}>
                    {p.ProdName} <span style={{fontSize:9,opacity:0.7}}>[{p.OutUnit}]</span>
                    {hasExist && !inCart && <span style={{fontSize:9,color:'#e65100',marginLeft:2}}>(주문{eq.orderQty} 분배{eq.outQty})</span>}
                  </button>
                );
              })}
              {filteredProds.length===0&&<span style={{color:'#999',fontSize:12}}>검색 결과 없음</span>}
            </div>
          </div>

          {/* 카트 — 업체별 그룹 */}
          {cart.length > 0 && (()=>{
            const groups = {};
            cart.forEach(item => {
              const ck = item.cust.CustKey;
              if (!groups[ck]) groups[ck] = { cust: item.cust, items: [] };
              groups[ck].items.push(item);
            });
            return (
            <div style={{ marginBottom:14, border:'1px solid #1976d2', borderRadius:6, overflow:'hidden' }}>
              <div style={{ background:'#1976d2', color:'#fff', padding:'6px 12px', fontSize:12, fontWeight:700, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span>{Object.values(groups).map(g=>g.cust.CustName).join(', ')} ({cart.length}개, {Object.keys(groups).length}업체)</span>
                <button onClick={()=>setCart([])} style={{background:'rgba(255,255,255,0.2)',border:'1px solid rgba(255,255,255,0.4)',color:'#fff',borderRadius:4,padding:'2px 8px',fontSize:10,cursor:'pointer'}}>전체 취소</button>
              </div>
              <div style={{ maxHeight:220, overflowY:'auto' }}>
                {Object.values(groups).map(g=>(
                  <div key={g.cust.CustKey}>
                    <div style={{background:'#e3f2fd',padding:'4px 12px',fontSize:11,fontWeight:700,borderBottom:'1px solid #bbdefb',color:'#1565c0'}}>
                      🏢 {g.cust.CustName}
                    </div>
                    {g.items.map((item,i)=>(
                  <div key={`${item.cust.CustKey}-${item.prod.ProdKey}`} style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 12px 5px 24px',
                       borderBottom:'1px solid #eee', background: i%2===0?'#fff':'#f9f9f9', fontSize:12 }}>
                    <span style={{ flex:1, fontWeight:600, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {item.prod.ProdName}
                    </span>
                    <span style={{ fontSize:10, whiteSpace:'nowrap', display:'flex', gap:4, flexShrink:0 }}>
                      {item.existQty > 0 && <span style={{color:'#1565c0'}}>주문:{item.existQty}</span>}
                      {item.existOut > 0 && <span style={{color:'#e65100'}}>분배:{item.existOut}</span>}
                      {(item.existQty > 0 || item.existOut > 0) && <span style={{color:'#2e7d32',fontWeight:700}}>→{item.qty}</span>}
                    </span>
                    <div style={{ display:'flex', gap:2, flexShrink:0 }}>
                      {UNITS.map(u=>(
                        <button key={u} onClick={()=>updateCartUnit(item.cust.CustKey, item.prod.ProdKey, u)}
                          style={{ padding:'2px 6px', borderRadius:4, border:'1px solid', fontSize:10, cursor:'pointer',
                                   borderColor: item.unit===u?'#1976d2':'#ccc', background: item.unit===u?'#1976d2':'#f9f9f9',
                                   color: item.unit===u?'#fff':'#555', fontWeight: item.unit===u?700:400 }}>
                          {u}
                        </button>
                      ))}
                    </div>
                    <div style={{ display:'flex', alignItems:'center', gap:2, flexShrink:0 }}>
                      <button onClick={()=>updateCartQty(item.cust.CustKey, item.prod.ProdKey, (item.qty||0)-1)}
                        style={{ width:28, height:28, fontSize:16, fontWeight:700, border:'1px solid #ccc', borderRadius:4, cursor:'pointer', background:'#f5f5f5', color:'#d32f2f', lineHeight:'26px' }}>−</button>
                      <input type="number" value={item.qty}
                        onChange={e=>updateCartQty(item.cust.CustKey, item.prod.ProdKey, e.target.value)}
                        style={{ width:50, textAlign:'center', fontSize:13, fontWeight:700, padding:'3px 2px', border:'1px solid #1976d2', borderRadius:4,
                                 background: item.qty < 0 ? '#ffebee' : '#fff' }} />
                      <button onClick={()=>updateCartQty(item.cust.CustKey, item.prod.ProdKey, (item.qty||0)+1)}
                        style={{ width:28, height:28, fontSize:16, fontWeight:700, border:'1px solid #ccc', borderRadius:4, cursor:'pointer', background:'#e3f2fd', color:'#1565c0', lineHeight:'26px' }}>+</button>
                    </div>
                    <button onClick={()=>removeFromCart(item.cust.CustKey, item.prod.ProdKey)}
                      style={{ background:'#ef5350', color:'#fff', border:'none', borderRadius:4, width:22, height:22, cursor:'pointer', fontSize:11, lineHeight:'20px', flexShrink:0 }}>✕</button>
                  </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            );
          })()}

          {error && <div style={{color:'#d32f2f',fontSize:12,marginBottom:10}}>⚠ {error}</div>}

          {/* 등록 결과 표시 */}
          {submitResults && (
            <div style={{ marginBottom:14, border:'2px solid #2e7d32', borderRadius:6, overflow:'hidden' }}>
              <div style={{ background:'#2e7d32', color:'#fff', padding:'8px 12px', fontSize:13, fontWeight:700, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span>주문등록 결과 — {submitResults.custName} [{submitResults.week}]</span>
                <button onClick={()=>{setSubmitResults(null);setCart([]);}} style={{background:'none',border:'1px solid rgba(255,255,255,0.5)',color:'#fff',borderRadius:4,padding:'2px 10px',fontSize:11,cursor:'pointer'}}>확인 (닫기)</button>
              </div>
              <div style={{ maxHeight:200, overflowY:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                  <thead>
                    <tr style={{ background:'#e8f5e9' }}>
                      <th style={{padding:'4px 8px',textAlign:'left'}}>품목</th>
                      <th style={{padding:'4px 8px',textAlign:'right'}}>요청수량</th>
                      <th style={{padding:'4px 8px',textAlign:'right'}}>DB수량</th>
                      <th style={{padding:'4px 8px',textAlign:'center'}}>상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {submitResults.items.map((r,i) => (
                      <tr key={i} style={{ background: i%2===0?'#fff':'#f9f9f9', borderBottom:'1px solid #eee' }}>
                        <td style={{padding:'4px 8px',fontWeight:500}}>{r.cust?.CustName && <span style={{fontSize:10,color:'#1565c0',marginRight:4}}>[{r.cust.CustName}]</span>}{r.prod.ProdName}</td>
                        <td style={{padding:'4px 8px',textAlign:'right'}}>{r.qty} {r.unit}</td>
                        <td style={{padding:'4px 8px',textAlign:'right',fontWeight:700,color:r.verified?'#2e7d32':'#d32f2f'}}>
                          {r.dbQty != null ? r.dbQty : '-'}
                        </td>
                        <td style={{padding:'4px 8px',textAlign:'center',fontSize:14}}>
                          {!r.ok ? <span style={{color:'#d32f2f'}}>❌ {r.error}</span>
                           : r.verified ? <span style={{color:'#2e7d32'}}>✅</span>
                           : <span style={{color:'#ff9800'}}>⚠️ 불일치</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
            <button onClick={onClose} style={{ padding:'8px 20px', border:'1px solid #ccc', borderRadius:5, cursor:'pointer', background:'#f5f5f5' }}>닫기</button>
            {!submitResults && (
              <button onClick={handleSubmit} disabled={saving || cart.length===0}
                style={{ padding:'8px 24px', background:(saving||cart.length===0)?'#aaa':'#1976d2', color:'#fff', border:'none', borderRadius:5, cursor:'pointer', fontWeight:700 }}>
                {saving ? '저장중...' : `주문등록추가 (${cart.length}개)`}
              </button>
            )}
            {submitResults && (
              <button onClick={()=>{setSubmitResults(null);setCart([]);}}
                style={{ padding:'8px 24px', background:'#2e7d32', color:'#fff', border:'none', borderRadius:5, cursor:'pointer', fontWeight:700 }}>
                계속 추가하기
              </button>
            )}
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
  const [startStocks, setStartStocks] = useState({}); // { "ProdKey-OrderWeek": { stock, remark } }
  const [confirmedStocks, setConfirmedStocks] = useState({}); // { "ProdKey-OrderWeek": stock } DB 확정재고
  const [shipHistory, setShipHistory] = useState([]); // ShipmentHistory 전산 수정내역

  // 텍스트 필터
  const [filterCoun,   setFilterCoun]   = useState(new Set()); // 복수 국가 선택
  const [filterFlower, setFilterFlower] = useState('');
  const [filterSearch, setFilterSearch] = useState('');

  // 품목별 탭 - 업체 sub-row 확장
  const [prodExpand, setProdExpand] = useState({});

  // 편집 상태
  const [editMap, setEditMap] = useState({});
  const [saving,  setSaving]  = useState(null);

  // 주문추가 모달
  const [showAddOrder, setShowAddOrder] = useState(false);

  // ── 즐겨찾기
  const [favorites, setFavorites] = useState([]);
  const loadFavorites = useCallback(async () => {
    try {
      const r = await fetch('/api/favorites?page=stock-status');
      const d = await r.json();
      if (d.success) setFavorites(d.favorites || []);
    } catch {}
  }, []);
  useEffect(() => { loadFavorites(); }, [loadFavorites]);

  const saveFavorite = async () => {
    const name = prompt('즐겨찾기 이름을 입력하세요:');
    if (!name) return;
    const filterState = {
      weekFrom, weekTo,
      tab, pivotSub,
      hiddenCusts: [...hiddenCusts],
      hiddenMgrs: [...hiddenMgrs],
      hiddenMgrCusts: Object.fromEntries(Object.entries(hiddenMgrCusts).map(([k,v])=>[k,[...v]])),
      pvMgr, pvCusts: [...pvCusts], pvFlowers: [...pvFlowers],
      filterCoun: [...filterCoun], filterFlower, filterSearch, pvShowOnlyOut,
    };
    try {
      const r = await fetch('/api/favorites', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ page:'stock-status', name, filterData: JSON.stringify(filterState) }),
      });
      const d = await r.json();
      if (d.success) loadFavorites();
    } catch {}
  };

  const [activeFavKey, setActiveFavKey] = useState(null); // 현재 활성화된 즐겨찾기

  const applyFavorite = (fav) => {
    // 이미 활성 → 취소 (필터 초기화)
    if (activeFavKey === fav.FavoriteKey) {
      setActiveFavKey(null);
      setFilterCoun(new Set()); setFilterFlower(''); setFilterSearch('');
      setPvMgr(''); setPvCusts(new Set()); setPvFlowers(new Set()); setPvShowOnlyOut(false);
      return;
    }
    setActiveFavKey(fav.FavoriteKey);
    try {
      const f = JSON.parse(fav.FilterData);
      if (f.weekFrom) weekFromInput.setValue(f.weekFrom);
      if (f.weekTo) weekToInput.setValue(f.weekTo);
      if (f.tab) setTab(f.tab);
      if (f.pivotSub) setPivotSub(f.pivotSub);
      if (f.hiddenCusts) setHiddenCusts(new Set(f.hiddenCusts));
      if (f.hiddenMgrs) setHiddenMgrs(new Set(f.hiddenMgrs));
      if (f.hiddenMgrCusts) {
        const obj = {};
        Object.entries(f.hiddenMgrCusts).forEach(([k,v])=>{ obj[k]=new Set(v); });
        setHiddenMgrCusts(obj);
      }
      if (f.pvMgr !== undefined) setPvMgr(f.pvMgr);
      if (f.pvCusts) setPvCusts(new Set(f.pvCusts));
      if (f.pvFlowers) setPvFlowers(new Set(f.pvFlowers));
      // filterCoun: 구버전(문자열) 호환 + 신버전(배열)
      if (f.filterCoun) {
        if (typeof f.filterCoun === 'string') setFilterCoun(new Set([f.filterCoun]));
        else if (Array.isArray(f.filterCoun)) setFilterCoun(new Set(f.filterCoun));
        else setFilterCoun(new Set());
      } else {
        setFilterCoun(new Set());
      }
      if (f.filterFlower !== undefined) setFilterFlower(f.filterFlower);
      if (f.filterSearch !== undefined) setFilterSearch(f.filterSearch);
      if (f.pvShowOnlyOut !== undefined) setPvShowOnlyOut(f.pvShowOnlyOut);
    } catch {}
  };

  const deleteFavorite = async (fk) => {
    if (!confirm('이 즐겨찾기를 삭제하시겠습니까?')) return;
    try {
      await fetch('/api/favorites', { method:'DELETE', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ favoriteKey: fk }) });
      loadFavorites();
    } catch {}
  };

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
        // 차수 피벗용 customers 데이터도 로드 (await: 로딩 끝나기 전에 데이터 준비)
        try {
          const r2 = await fetch(`/api/shipment/stock-status?${p}&view=customers`);
          const d2 = await r2.json();
          if (d2.success) setCustRows(d2.rows||[]);
        } catch(e) {}
      }
      // 시작재고 조회
      fetch(`/api/shipment/stock-status?weekFrom=${encodeURIComponent(wf)}&weekTo=${encodeURIComponent(wt)}&view=startStock`)
        .then(r=>r.json()).then(d2=>{ if(d2.success) setStartStocks(d2.stocks||{}); }).catch(()=>{});
      // 확정재고 조회 (ProductStock isFix=1 기준)
      fetch(`/api/shipment/stock-status?weekFrom=${encodeURIComponent(wf)}&weekTo=${encodeURIComponent(wt)}&view=confirmedStock`)
        .then(r=>r.json()).then(d2=>{ if(d2.success) setConfirmedStocks(d2.stocks||{}); }).catch(()=>{});
      // 전산 수정내역(ShipmentHistory) 조회 → shipHistory 상태에 저장
      fetch(`/api/shipment/history?startDate=2020-01-01&endDate=2099-12-31&search=${encodeURIComponent(wf)}`)
        .then(r=>r.json()).then(d2=>{ if(d2.success) setShipHistory(d2.history||[]); }).catch(()=>{});
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

  // ── 시작재고/시작비고 저장
  const saveStartStock = useCallback(async (prodKey, week, stock, remark) => {
    const key = `${prodKey}-${week}`;
    const prev = startStocks[key] || {};
    const s = stock != null ? stock : prev.stock;
    const rm = remark != null ? remark : (prev.remark || '');
    try {
      const r = await fetch('/api/shipment/stock-status', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prodKey, week, stock: s, remark: rm }),
      });
      const d = await r.json();
      if (d.success) setStartStocks(prev => ({ ...prev, [key]: { stock: parseFloat(s)||0, remark: rm } }));
    } catch(e) { console.error(e); }
  }, [startStocks]);

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
    if (filterCoun.size > 0 && !filterCoun.has(r.CounName))     return false;
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
  const isFilterActive = filterCoun.size > 0 || filterFlower || filterSearch;

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
      <div style={{ overflowX:'auto', maxHeight:'calc(100vh - 300px)', overflowY:'auto' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, fontSize:11, color:'#666', marginBottom:6, flexWrap:'wrap' }}>
          <span>💡 잔량 = 이월재고 + 입고 − 출고 | 행 클릭(▶) 시 업체별 출고수량 편집 가능</span>
          {(()=>{
            const ssCount = Object.keys(startStocks).filter(k=>k.endsWith(`-${weekFrom}`)&&startStocks[k]?.stock!=null).length;
            return ssCount > 0
              ? <span style={{background:'#e0f7fa',border:'1px solid #00acc1',borderRadius:10,padding:'2px 10px',color:'#006064',fontWeight:700}}>
                  📦 시작재고 {ssCount}개 저장됨 ({weekFrom})
                  <button onClick={async()=>{
                    if(!confirm(`[${weekFrom}] 시작재고를 전부 삭제(초기화)하시겠습니까?`)) return;
                    const delKeys = Object.keys(startStocks).filter(k=>k.endsWith(`-${weekFrom}`));
                    for(const k of delKeys){
                      const pk=k.split('-')[0];
                      await fetch('/api/shipment/stock-status',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({prodKey:pk,week:weekFrom,stock:0})});
                    }
                    setStartStocks(prev=>{const n={...prev};delKeys.forEach(k=>delete n[k]);return n;});
                  }} style={{marginLeft:6,fontSize:10,padding:'1px 6px',border:'1px solid #e53935',borderRadius:4,background:'#ffebee',color:'#c62828',cursor:'pointer'}}>
                    🗑 삭제(초기화)
                  </button>
                </span>
              : <span style={{color:'#999'}}>시작재고 미설정 ({weekFrom})</span>;
          })()}
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
              const ssObj = startStocks[`${p.ProdKey}-${weekFrom}`];
              const ss = ssObj?.stock;
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
                        onBlur={e=>saveStartStock(p.ProdKey, weekFrom, e.target.value)} />
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
                          <td style={{ ...st.td, ...st.clickCell, background: filterCoun.has(item.CounName)?'#bbdefb':undefined }}
                              onClick={()=>setFilterCoun(prev=>{const n=new Set(prev);n.has(item.CounName)?n.delete(item.CounName):n.add(item.CounName);return n;})}>{item.CounName}</td>
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
                            const ssObj = startStocks[`${item.ProdKey}-${weekFrom}`];
                            const ss = ssObj?.stock;
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
  const [pvDescrOpen, setPvDescrOpen] = useState(true);  // 비고 컬럼 표시/숨김
  const [pvDescrModal, setPvDescrModal] = useState(null); // 수정내역 삭제 모달
  const [pvDescrView, setPvDescrView] = useState(null);  // 비고 상세 보기 모달 { pk, prodName, wk, items:[] }
  const [pvShowOnlyOut, setPvShowOnlyOut] = useState(false); // 출고 있는 품목만
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

    // 품목 — 주문 또는 출고 수량이 있는 것
    const prodMap = {};
    rows.forEach(r => {
      if (pvShowOnlyOut) {
        // 출고 또는 시작재고 있는 품목만
        if ((r.outQty||0) > 0 || Object.keys(startStocks).some(k => k.startsWith(`${r.ProdKey}-`) && startStocks[k]?.stock)) {
          if (!prodMap[r.ProdKey]) prodMap[r.ProdKey] = { name:r.ProdName, coun:r.CounName, flower:r.FlowerName, unit:r.OutUnit };
        }
      } else {
        // 전체 모드: 주문 또는 출고가 있는 것
        if ((r.outQty||0) > 0 || (r.custOrderQty||0) > 0 || (r.orderQty||0) > 0) {
          if (!prodMap[r.ProdKey]) prodMap[r.ProdKey] = { name:r.ProdName, coun:r.CounName, flower:r.FlowerName, unit:r.OutUnit };
        }
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
      if (r.outCreateDtm) fixMap[dk] = r.outCreateDtm;
      const ik = `${r.ProdKey}-${r.OrderWeek}`;
      if (!inMap[ik]) inMap[ik] = r.totalInQty || 0;
    });
    // 전산 수정내역(ShipmentHistory) → descrMap에 합치기
    shipHistory.forEach(h => {
      if (!h.CustName || !h.name) return;
      // CustKey+ProdKey 매칭 (history에는 CustName/ProdName만 있으므로 rows에서 찾기)
      const matchRow = rows.find(r => r.CustName === h.CustName && r.ProdName === h.name && r.OrderWeek === h.week);
      if (!matchRow) return;
      const dk = `${matchRow.ProdKey}-${matchRow.CustKey}-${h.week}`;
      const log = `[전산 ${h.ChangeDtm} ${h.type}] ${h.before}→${h.after}`;
      descrMap[dk] = (descrMap[dk] || '') + '\n' + log;
    });
    // isFix: CustKey-OrderWeek 단위로 확정 여부
    const isFixed = (ck, wk) => {
      return rows.some(r => r.CustKey===ck && r.OrderWeek===wk && r.isFix);
    };

    if (weeks.length === 0 || prodKeys.length === 0) return <div style={st.empty}>필터 조건에 맞는 데이터 없음
      <div style={{marginTop:10}}><button onClick={()=>{setFilterCoun(new Set());setFilterFlower('');setFilterSearch('');setPvMgr('');setPvCusts(new Set());setPvFlowers(new Set());setPvShowOnlyOut(false);setActiveFavKey(null);}}
        style={{padding:'6px 16px',fontSize:12,border:'1px solid #1976d2',borderRadius:6,background:'#e3f2fd',color:'#1565c0',cursor:'pointer',fontWeight:600}}>🔄 필터 초기화</button></div>
    </div>;

    const PROD_REPEAT = 10;
    const CUST_REPEAT = 15;
    const stockCols = 9; // 확정재고/시작재고/시작비고/입고/출고/잔량(확정)/잔량(시작)/비고
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
              <th style={{ ...st.th, background:'#b71c1c', textAlign:'center', fontSize:8 }}>확정재고</th>
              <th style={{ ...st.th, background:'#006064', textAlign:'center', fontSize:8 }}>시작재고</th>
              <th style={{ ...st.th, background:'#004d40', textAlign:'center', fontSize:8, minWidth:50 }}>시작비고</th>
              <th style={{ ...st.th, background:'#1565c0', textAlign:'center', fontSize:8 }}>입고</th>
              <th style={{ ...st.th, background:'#ad1457', textAlign:'center', fontSize:8 }}>출고</th>
              <th style={{ ...st.th, background:'#880e4f', textAlign:'center', fontSize:8 }}>잔량(확정)</th>
              <th style={{ ...st.th, background:'#4a148c', textAlign:'center', fontSize:8 }}>잔량</th>
              {pvDescrOpen && <th style={{ ...st.th, background:'#37474f', textAlign:'center', fontSize:8, minWidth:80 }}>비고</th>}
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
          <button onClick={()=>{setFilterCoun(new Set());setFilterFlower('');}} style={chipS(filterCoun.size===0)}>전체</button>
          {allCounNames.map(c=>(<button key={c} onClick={()=>{setFilterCoun(prev=>{const n=new Set(prev);n.has(c)?n.delete(c):n.add(c);return n;});setFilterFlower('');}} style={chipS(filterCoun.has(c))}>{c}</button>))}
        </div>
        {filterCoun.size > 0 && (() => {
          const flowers = [...new Set(custRows.filter(r=>filterCoun.has(r.CounName)).map(r=>r.FlowerName).filter(Boolean))].sort();
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
        <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:6, flexWrap:'wrap' }}>
          <label style={{fontSize:11,color:'#555',cursor:'pointer',display:'flex',alignItems:'center',gap:4}}>
            <input type="checkbox" checked={pvShowOnlyOut} onChange={e=>setPvShowOnlyOut(e.target.checked)} />
            출고/재고 있는 품목만
          </label>
          <span style={{fontSize:10,color:'#999'}}>({prodKeys.length}개 품목)</span>
          <span style={{width:1,height:16,background:'#ccc'}}/>
          {(()=>{
            const ssCount = weeks.reduce((a,wk) => a + Object.keys(startStocks).filter(k=>k.endsWith(`-${wk}`)&&startStocks[k]?.stock!=null&&startStocks[k]?.stock>0).length, 0);
            return ssCount > 0
              ? <span style={{background:'#e0f7fa',border:'1px solid #00acc1',borderRadius:10,padding:'2px 10px',fontSize:11,color:'#006064',fontWeight:700}}>
                  📦 시작재고 {ssCount}개 저장됨
                  <button onClick={async()=>{
                    if(!confirm(`시작재고를 전부 삭제(초기화)하시겠습니까?`)) return;
                    for(const wk of weeks){
                      const delKeys = Object.keys(startStocks).filter(k=>k.endsWith(`-${wk}`));
                      for(const k of delKeys){
                        const pk=k.split('-')[0];
                        await fetch('/api/shipment/stock-status',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({prodKey:pk,week:wk,stock:0})});
                      }
                    }
                    setStartStocks({});
                  }} style={{marginLeft:6,fontSize:10,padding:'1px 6px',border:'1px solid #e53935',borderRadius:4,background:'#ffebee',color:'#c62828',cursor:'pointer'}}>
                    🗑 초기화
                  </button>
                </span>
              : <span style={{fontSize:11,color:'#999'}}>시작재고 미설정</span>;
          })()}
          <span style={{width:1,height:16,background:'#ccc'}}/>
          <button onClick={()=>setPvDescrOpen(p=>!p)}
            style={{padding:'2px 8px',fontSize:10,border:'1px solid #666',borderRadius:4,
              background:pvDescrOpen?'#37474f':'#f5f5f5',color:pvDescrOpen?'#fff':'#555',cursor:'pointer'}}>
            {pvDescrOpen ? '📝 비고 숨김' : '📝 비고 표시'}
          </button>
        </div>
        <button onClick={async()=>{
          // 엑셀: 차수 > 지역 > 업체 > 품종별 그룹핑, 0값 제거, 비고 포함
          const wb = XLSX.utils.book_new();
          weeks.forEach(wk => {
            const xlData = [];
            // 지역별 그룹
            areaGroups.forEach(ag => {
              const areaCusts = custKeys.filter(ck => custMap[ck].area === ag.area);
              if (areaCusts.length === 0) return;
              xlData.push([`▶ ${ag.area}`]);
              areaCusts.forEach(ck => {
                const custName = cShort(ck);
                const custProds = prodKeys.filter(pk => (dataMap[`${pk}-${ck}-${wk}`]||0) > 0);
                if (custProds.length === 0) return;
                // 품종별 그룹핑
                const byFlower = {};
                custProds.forEach(pk => {
                  const fl = prodMap[pk].flower || '기타';
                  if (!byFlower[fl]) byFlower[fl] = [];
                  byFlower[fl].push(pk);
                });
                // 업체 헤더
                xlData.push([`  ${custName}`]);
                Object.entries(byFlower).forEach(([flower, pks]) => {
                  xlData.push(['', '', `[${flower}]`, '', '', '']);
                  xlData.push(['', '국가', '꽃', '품명', '수량', '비고']);
                  let flowerTotal = 0;
                  pks.forEach(pk => {
                    const p = prodMap[pk];
                    const v = dataMap[`${pk}-${ck}-${wk}`] || 0;
                    const descr = descrMap[`${pk}-${ck}-${wk}`] || '';
                    xlData.push(['', p.coun, p.flower, stripProdName(p.name), v, descr.replace(/\n/g, ' ')]);
                    flowerTotal += v;
                  });
                  xlData.push(['', '', '', `${flower} 소계`, flowerTotal, '']);
                });
                // 업체 총합
                const custTotal = custProds.reduce((a,pk) => a + (dataMap[`${pk}-${ck}-${wk}`]||0), 0);
                xlData.push(['', '', '', '업체 합계', custTotal, '']);
                xlData.push([]);
              });
            });
            // 품종별 전체 토탈 요약
            xlData.push([]);
            xlData.push(['▶ 품종별 전체 수량']);
            xlData.push(['', '품종', '총 출고수량']);
            const flowerTotals = {};
            prodKeys.forEach(pk => {
              const fl = prodMap[pk].flower || '기타';
              const wOut = custKeys.reduce((a,ck) => a + (dataMap[`${pk}-${ck}-${wk}`]||0), 0);
              if (wOut > 0) flowerTotals[fl] = (flowerTotals[fl]||0) + wOut;
            });
            Object.entries(flowerTotals).sort((a,b) => b[1]-a[1]).forEach(([fl,tot]) => {
              xlData.push(['', fl, tot]);
            });
            xlData.push(['', '전체 합계', Object.values(flowerTotals).reduce((a,b)=>a+b,0)]);
            // 재고 요약
            xlData.push([]);
            xlData.push(['▶ 재고 요약']);
            xlData.push(['', '국가', '꽃', '품명', '시작', '입고', '출고', '잔량']);
            prodKeys.forEach(pk => {
              const p = prodMap[pk];
              const wkSS = startStocks[`${pk}-${wk}`]?.stock;
              const prevRS = startStocks[`${pk}-${weeks[0]}`]?.stock || 0;
              const wStart = wkSS != null ? wkSS : prevRS;
              const inQ = inMap[`${pk}-${wk}`] || 0;
              const wOut = custKeys.reduce((a,ck) => a + (dataMap[`${pk}-${ck}-${wk}`]||0), 0);
              const remain = wStart + inQ - wOut;
              if (wOut > 0 || inQ > 0 || wStart > 0) {
                xlData.push(['', p.coun, p.flower, stripProdName(p.name), wStart||'', inQ||'', wOut||'', remain]);
              }
            });
            const ws = XLSX.utils.aoa_to_sheet(xlData);
            ws['!cols'] = [{wch:3},{wch:10},{wch:12},{wch:28},{wch:8},{wch:40}];
            XLSX.utils.book_append_sheet(wb, ws, wk);
          });
          // ── 병합 시트: 전체 차수 합산 (업체 × 품종별)
          if (weeks.length > 1) {
            const mergedData = [];
            mergedData.push([`전체 (${weeks.join(' + ')})`]);
            mergedData.push([]);
            areaGroups.forEach(ag => {
              const areaCusts = custKeys.filter(ck => custMap[ck].area === ag.area);
              if (areaCusts.length === 0) return;
              mergedData.push([`▶ ${ag.area}`]);
              areaCusts.forEach(ck => {
                const custName = cShort(ck);
                // 전체 차수 합산 수량
                const custProds = prodKeys.filter(pk => {
                  const total = weeks.reduce((a,wk) => a + (dataMap[`${pk}-${ck}-${wk}`]||0), 0);
                  return total > 0;
                });
                if (custProds.length === 0) return;
                const byFlower = {};
                custProds.forEach(pk => {
                  const fl = prodMap[pk].flower || '기타';
                  if (!byFlower[fl]) byFlower[fl] = [];
                  byFlower[fl].push(pk);
                });
                mergedData.push([`  ${custName}`]);
                Object.entries(byFlower).forEach(([flower, pks]) => {
                  mergedData.push(['', '', `[${flower}]`, '', ...weeks.map(()=>''), '']);
                  const hdr = ['', '국가', '꽃', '품명'];
                  weeks.forEach(wk => hdr.push(wk));
                  hdr.push('합계', '비고');
                  mergedData.push(hdr);
                  let flowerTotal = 0;
                  pks.forEach(pk => {
                    const p = prodMap[pk];
                    const row = ['', p.coun, p.flower, stripProdName(p.name)];
                    let rowTotal = 0;
                    weeks.forEach(wk => {
                      const v = dataMap[`${pk}-${ck}-${wk}`]||0;
                      row.push(v||'');
                      rowTotal += v;
                    });
                    const allDescr = weeks.map(wk => descrMap[`${pk}-${ck}-${wk}`]||'').filter(Boolean).join(' ');
                    row.push(rowTotal, allDescr.replace(/\n/g,' '));
                    mergedData.push(row);
                    flowerTotal += rowTotal;
                  });
                  mergedData.push(['', '', '', `${flower} 소계`, ...weeks.map(()=>''), flowerTotal, '']);
                });
                const custTotal = custProds.reduce((a,pk) => a + weeks.reduce((s,wk) => s + (dataMap[`${pk}-${ck}-${wk}`]||0), 0), 0);
                mergedData.push(['', '', '', '업체 합계', ...weeks.map(()=>''), custTotal, '']);
                mergedData.push([]);
              });
            });
            // 품종별 전체 토탈
            mergedData.push([]);
            mergedData.push(['▶ 품종별 전체 수량']);
            const mHdr = ['', '품종']; weeks.forEach(wk => mHdr.push(wk)); mHdr.push('합계');
            mergedData.push(mHdr);
            const allFlowerTotals = {};
            prodKeys.forEach(pk => {
              const fl = prodMap[pk].flower || '기타';
              if (!allFlowerTotals[fl]) allFlowerTotals[fl] = {};
              weeks.forEach(wk => {
                const wOut = custKeys.reduce((a,ck) => a + (dataMap[`${pk}-${ck}-${wk}`]||0), 0);
                allFlowerTotals[fl][wk] = (allFlowerTotals[fl][wk]||0) + wOut;
              });
            });
            Object.entries(allFlowerTotals).sort((a,b) => {
              const ta = Object.values(a[1]).reduce((s,v)=>s+v,0);
              const tb = Object.values(b[1]).reduce((s,v)=>s+v,0);
              return tb - ta;
            }).forEach(([fl,wkMap]) => {
              const row = ['', fl];
              let total = 0;
              weeks.forEach(wk => { row.push(wkMap[wk]||''); total += (wkMap[wk]||0); });
              row.push(total);
              mergedData.push(row);
            });
            const mws = XLSX.utils.aoa_to_sheet(mergedData);
            mws['!cols'] = [{wch:3},{wch:10},{wch:12},{wch:28},...weeks.map(()=>({wch:8})),{wch:8},{wch:30}];
            XLSX.utils.book_append_sheet(wb, mws, '전체병합');
          }
          // ── 차수피벗 시트: 3줄 헤더(셀병합) + 합산수식 + 테두리 + 정렬
          {
          const colsPerWeek = custKeys.length + 4; // 업체 + 시작/입고/출고/잔량
          const totalCols = 3 + weeks.length * colsPerWeek;
          const dataStartRow = 3; // 0-indexed (행4부터 데이터)
          const dataRows = prodKeys.length;
          const sumRow = dataStartRow + dataRows; // 합계 행

          const flatData = [];
          // 행1: 차수
          const h1 = ['','',''];
          weeks.forEach(wk => { for(let i=0;i<colsPerWeek;i++) h1.push(i===0?wk:''); });
          flatData.push(h1);
          // 행2: 지역
          const h2 = ['','',''];
          weeks.forEach(() => {
            areaGroups.forEach(ag => { for(let i=0;i<ag.count;i++) h2.push(i===0?ag.area:''); });
            h2.push('','','','');
          });
          flatData.push(h2);
          // 행3: 업체명
          const h3 = ['국가','꽃','품명'];
          weeks.forEach(() => { custKeys.forEach(ck => h3.push(cShort(ck))); h3.push('시작','입고','출고','잔량'); });
          flatData.push(h3);
          // 데이터 행
          prodKeys.forEach(pk => {
            const p = prodMap[pk];
            const row = [p.coun, p.flower, stripProdName(p.name)];
            let rs = startStocks[`${pk}-${weeks[0]}`]?.stock || 0;
            weeks.forEach(wk => {
              const wkSS = startStocks[`${pk}-${wk}`]?.stock;
              if (wkSS != null) rs = wkSS;
              custKeys.forEach(ck => {
                const v = dataMap[`${pk}-${ck}-${wk}`]||0;
                row.push(v > 0 ? v : '');
              });
              const wStart = rs, inQ = inMap[`${pk}-${wk}`]||0;
              const wOut = custKeys.reduce((a,ck)=>a+(dataMap[`${pk}-${ck}-${wk}`]||0),0);
              rs = wStart + inQ - wOut;
              row.push(wStart||'', inQ||'', wOut||'', rs);
            });
            flatData.push(row);
          });
          // 합계 행 (수식)
          const sumRowData = ['','','합계'];
          for (let c = 3; c < totalCols; c++) {
            const colLetter = XLSX.utils.encode_col(c);
            sumRowData.push({ f: `SUM(${colLetter}${dataStartRow+1+1}:${colLetter}${sumRow})` });
          }
          flatData.push(sumRowData);

          const flatWs = XLSX.utils.aoa_to_sheet(flatData);

          // 셀병합: 행1 차수, 행2 지역
          const merges = [];
          // 행1+2+3 품명 영역 병합 (A1:A3, B1:B3, C1:C3)
          merges.push({s:{r:0,c:0},e:{r:2,c:0}});
          merges.push({s:{r:0,c:1},e:{r:2,c:1}});
          merges.push({s:{r:0,c:2},e:{r:2,c:2}});
          // 차수별 병합
          weeks.forEach((wk,wi) => {
            const startCol = 3 + wi * colsPerWeek;
            const endCol = startCol + colsPerWeek - 1;
            // 행1: 차수 셀병합
            merges.push({s:{r:0,c:startCol},e:{r:0,c:endCol}});
            // 행2: 지역별 셀병합
            let col = startCol;
            areaGroups.forEach(ag => {
              if (ag.count > 1) merges.push({s:{r:1,c:col},e:{r:1,c:col+ag.count-1}});
              col += ag.count;
            });
            // 행2: 재고 4칸 병합
            merges.push({s:{r:1,c:endCol-3},e:{r:1,c:endCol}});
          });
          flatWs['!merges'] = merges;
          flatWs['!cols'] = [{wch:10},{wch:10},{wch:26},...Array(totalCols-3).fill({wch:7})];
          XLSX.utils.book_append_sheet(wb, flatWs, '차수피벗');
          }

          // ── 업체별 개별 시트
          custKeys.forEach(ck => {
            const cn = cShort(ck);
            const custProds = prodKeys.filter(pk =>
              weeks.some(wk => (dataMap[`${pk}-${ck}-${wk}`]||0) > 0)
            );
            if (custProds.length === 0) return;
            const csData = [];
            csData.push([`${cn} (${custMap[ck]?.area||''})`]);
            const hdr = ['국가','꽃','품명'];
            weeks.forEach(wk => hdr.push(`${wk} 수량`));
            if (weeks.length > 1) hdr.push('합계');
            hdr.push('비고');
            csData.push(hdr);
            // 품종별 그룹핑
            const byFlower = {};
            custProds.forEach(pk => {
              const fl = prodMap[pk].flower || '기타';
              if (!byFlower[fl]) byFlower[fl] = [];
              byFlower[fl].push(pk);
            });
            let rowIdx = 2; // 현재 행 (1=헤더제목, 2=컬럼헤더, 3부터 데이터)
            Object.entries(byFlower).forEach(([flower, pks]) => {
              const flowerStartRow = rowIdx + 1;
              pks.forEach(pk => {
                const p = prodMap[pk];
                const row = [p.coun, p.flower, stripProdName(p.name)];
                weeks.forEach(wk => {
                  const v = dataMap[`${pk}-${ck}-${wk}`]||0;
                  row.push(v > 0 ? v : '');
                });
                if (weeks.length > 1) {
                  let rowTotal = 0;
                  weeks.forEach(wk => { rowTotal += (dataMap[`${pk}-${ck}-${wk}`]||0); });
                  row.push(rowTotal || '');
                }
                const allDescr = weeks.map(wk => descrMap[`${pk}-${ck}-${wk}`]||'').filter(Boolean).join(' ');
                row.push(allDescr.replace(/\n/g,' '));
                csData.push(row);
                rowIdx++;
              });
              // 품종 소계 행
              const subR = ['', '', `${flower} 소계`];
              weeks.forEach((wk,wi) => {
                const col = XLSX.utils.encode_col(3+wi);
                subR.push({ f: `SUM(${col}${flowerStartRow}:${col}${rowIdx})` });
              });
              if (weeks.length > 1) {
                const col = XLSX.utils.encode_col(3+weeks.length);
                subR.push({ f: `SUM(${col}${flowerStartRow}:${col}${rowIdx})` });
              }
              csData.push(subR);
              rowIdx++;
            });
            // 전체 합계 행
            const totalR = ['','','전체 합계'];
            const dataColCount = weeks.length + (weeks.length > 1 ? 1 : 0);
            for (let ci = 0; ci < dataColCount; ci++) {
              const col = XLSX.utils.encode_col(3+ci);
              totalR.push({ f: `SUM(${col}3:${col}${rowIdx})` });
            }
            csData.push(totalR);
            const csWs = XLSX.utils.aoa_to_sheet(csData);
            csWs['!cols'] = [{wch:10},{wch:10},{wch:28},...weeks.map(()=>({wch:8})),...(weeks.length>1?[{wch:8}]:[]),{wch:30}];
            // 시트명 31자 제한 + 특수문자 제거
            const sheetName = cn.replace(/[\\\/\?\*\[\]:]/g,'').substring(0,31);
            try { XLSX.utils.book_append_sheet(wb, csWs, sheetName); } catch {}
          });

          // 저장: showSaveFilePicker 지원 시 경로 선택, 아니면 기본 다운로드
          const fileName = `차수피벗_${weeks.join('~')}.xlsx`;
          if (window.showSaveFilePicker) {
            try {
              const handle = await window.showSaveFilePicker({
                suggestedName: fileName,
                types: [{ description: 'Excel', accept: {'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx']} }],
                startIn: localStorage.getItem('excelSaveDir') ? undefined : 'downloads',
              });
              // 디렉토리 기억 (다음번에 같은 위치)
              const writable = await handle.createWritable();
              const buf = XLSX.write(wb, { bookType:'xlsx', type:'array' });
              await writable.write(buf);
              await writable.close();
              alert(`✅ 저장 완료: ${handle.name}`);
            } catch(e) {
              if (e.name !== 'AbortError') { console.error(e); XLSX.writeFile(wb, fileName); }
            }
          } else {
            alert('⚠️ 이 브라우저는 저장 위치 선택을 지원하지 않습니다.\nChrome 브라우저를 사용해주세요.\n기본 다운로드 폴더에 저장됩니다.');
            XLSX.writeFile(wb, fileName);
          }
        }} style={{ ...st.addBtn, marginBottom:8, background:'#2e7d32' }}>📥 엑셀 다운로드</button>
        <button onClick={()=>{
          // 잔량 있는 품목 클립보드 복사 (마지막 차수 기준)
          const lines = [];
          prodKeys.forEach(pk => {
            const p = prodMap[pk];
            let rs = startStocks[`${pk}-${weeks[0]}`]?.stock || 0;
            weeks.forEach(wk => {
              const wkSS = startStocks[`${pk}-${wk}`]?.stock;
              if (wkSS != null) rs = wkSS;
              const inQ = inMap[`${pk}-${wk}`]||0;
              const wOut = custKeys.reduce((a,ck)=>a+(dataMap[`${pk}-${ck}-${wk}`]||0),0);
              rs = rs + inQ - wOut;
            });
            if (rs > 0) lines.push(`${stripProdName(p.name)} ${rs}`);
          });
          if (lines.length === 0) { alert('잔량이 있는 품목이 없습니다'); return; }
          navigator.clipboard.writeText(lines.join('\n')).then(()=>alert(`${lines.length}개 품목 복사됨`));
        }} style={{ ...st.addBtn, marginBottom:8, background:'#6a1b9a', marginLeft:8 }}>📋 잔량 복사</button>

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
              let rollingStock = startStocks[`${pk}-${weeks[0]}`]?.stock || 0;

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
                      <span style={{ ...st.clickCell, fontSize:8, color: filterCoun.has(p.coun)?'#1565c0':'#999' }}
                            onClick={()=>setFilterCoun(prev=>{const n=new Set(prev);n.has(p.coun)?n.delete(p.coun):n.add(p.coun);return n;})}>{p.coun}</span>
                      <span style={{ ...st.clickCell, fontSize:8, color: filterFlower===p.flower?'#2e7d32':'#999', marginLeft:2 }}
                            onClick={()=>setFilterFlower(prev=>prev===p.flower?'':p.flower)}>·{p.flower}</span>
                      <div style={{fontWeight:600, fontSize:10}}>{stripProdName(p.name)}</div>
                    </td>
                    {weeks.map(wk => {
                      // 해당 차수에 시작재고가 입력되어 있으면 rollingStock을 덮어씀
                      const ssKey = `${pk}-${wk}`;
                      const ssObj = startStocks[ssKey];
                      if (ssObj?.stock != null) rollingStock = ssObj.stock;
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
                          {/* 확정재고 (DB에서 읽기 전용) */}
                          {(()=>{
                            // 확정재고: confirmedStocks에서 해당 품목의 최신 확정 스냅샷
                            const csKeys = Object.keys(confirmedStocks).filter(k=>k.startsWith(`${pk}-`));
                            const csVal = csKeys.length > 0 ? confirmedStocks[csKeys[csKeys.length-1]] : null;
                            const confirmRemain = csVal != null ? csVal + inQty - weekOut : null;
                            return <>
                              <td style={{...st.td,textAlign:'right',background:'#ffebee',fontSize:9,fontWeight:700,color:'#b71c1c'}}>
                                {csVal != null ? fmt(csVal) : '-'}
                              </td>
                              <td style={{...st.td,textAlign:'right',background:'#e0f7fa',padding:'2px 3px'}}
                                  onClick={e=>e.stopPropagation()}>
                                <input type="number" key={`ss-${pk}-${wk}`} defaultValue={ssObj?.stock??''} placeholder="-"
                                  style={{width:40,textAlign:'right',fontSize:9,padding:'1px 2px',border:'1px solid #ccc',borderRadius:2,background:'#fff'}}
                                  onBlur={e=>saveStartStock(pk,wk,e.target.value)} />
                              </td>
                              <td style={{...st.td,fontSize:8,color:'#555',maxWidth:50,whiteSpace:'pre-line',lineHeight:'1.1',background:'#e0f7fa',padding:'1px 2px'}}
                                  onClick={e=>e.stopPropagation()}>
                                <input type="text" key={`sr-${pk}-${wk}`} defaultValue={ssObj?.remark??''} placeholder="-"
                                  style={{width:46,fontSize:8,padding:'1px 2px',border:'1px solid #ccc',borderRadius:2,background:'#fff'}}
                                  onBlur={e=>saveStartStock(pk,wk,null,e.target.value)} />
                              </td>
                              <td style={{...st.td,textAlign:'right',background:'#e3f2fd',fontSize:9}}>{fmt(inQty)}</td>
                              <td style={{...st.td,textAlign:'right',background:'#fce4ec',fontWeight:600,fontSize:9}}>{fmt(weekOut)}</td>
                              <td style={{...st.td,textAlign:'right',background:'#fce4ec',fontWeight:700,fontSize:9,
                                          color:confirmRemain!=null?(confirmRemain<0?'#d32f2f':'#2e7d32'):'#999'}}>
                                {confirmRemain != null ? fmt(confirmRemain) : '-'}
                              </td>
                              <td style={{...st.td,textAlign:'right',background:'#f3e5f5',fontWeight:700,fontSize:9,
                                          color:rollingStock<0?'#d32f2f':'#388e3c'}}>{fmt(rollingStock)}</td>
                            </>;
                          })()}
                          {(() => {
                            // 이 품목+차수의 모든 업체 비고 합산 (업체별 개별 항목)
                            const custLogs = custKeys.map(ck => {
                              const raw = descrMap[`${pk}-${ck}-${wk}`] || '';
                              const lines = raw.split('\n').filter(l=>l.trim());
                              return { ck, lines };
                            }).filter(x=>x.lines.length);
                            const cnt = custLogs.reduce((a,x)=>a+x.lines.length, 0);
                            if (!pvDescrOpen) return null;
                            return (
                              <td style={{...st.td,fontSize:8,color:'#555',minWidth:80,maxWidth:120,
                                          whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',
                                          cursor:'pointer',padding:'2px 4px',background:cnt>0?'#fff8e1':undefined}}
                                  title={cnt>0?'클릭하여 상세보기':''}
                                  onClick={()=>{
                                    if(cnt===0) return;
                                    // 비고 상세 모달 — 품목+차수+업체별 전체 이력
                                    const items = custLogs.map(({ck,lines})=>({
                                      custName:cShort(ck), lines
                                    }));
                                    // 기초재고, 입고, 분배 정보
                                    const ssVal = startStocks[`${pk}-${wk}`]?.stock;
                                    const inVal = inMap[`${pk}-${wk}`]||0;
                                    const outVal = custKeys.reduce((a,c)=>a+(dataMap[`${pk}-${c}-${wk}`]||0),0);
                                    setPvDescrView({
                                      pk, wk, prodName:stripProdName(p.name), coun:p.coun, flower:p.flower,
                                      startStock:ssVal, inQty:inVal, outQty:outVal, remain:(ssVal||0)+inVal-outVal,
                                      items
                                    });
                                  }}>
                                {cnt > 0 ? <span style={{color:'#e65100'}}>📝{cnt}건</span> : ''}
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
      {/* 비고 상세 모달 */}
      {pvDescrView && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:2500,display:'flex',alignItems:'center',justifyContent:'center'}}
             onClick={e=>e.target===e.currentTarget&&setPvDescrView(null)}>
          <div style={{background:'#fff',borderRadius:10,boxShadow:'0 8px 32px rgba(0,0,0,0.3)',minWidth:500,maxWidth:700,maxHeight:'80vh',overflow:'auto'}}>
            <div style={{background:'#37474f',color:'#fff',padding:'12px 20px',borderRadius:'10px 10px 0 0',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span style={{fontWeight:700,fontSize:14}}>📝 변경내역 상세</span>
              <button onClick={()=>setPvDescrView(null)} style={{background:'none',border:'none',color:'#fff',fontSize:18,cursor:'pointer'}}>✕</button>
            </div>
            <div style={{padding:'16px 20px'}}>
              {/* 품목 정보 */}
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:12,marginBottom:16}}>
                <tbody>
                  <tr style={{borderBottom:'1px solid #eee'}}><td style={{padding:'6px 4px',color:'#888',width:80}}>품목</td><td style={{fontWeight:700}}>{pvDescrView.coun} / {pvDescrView.flower} / {pvDescrView.prodName}</td></tr>
                  <tr style={{borderBottom:'1px solid #eee'}}><td style={{padding:'6px 4px',color:'#888'}}>차수</td><td style={{fontWeight:700,color:'#1565c0'}}>{pvDescrView.wk}</td></tr>
                  <tr style={{borderBottom:'1px solid #eee'}}><td style={{padding:'6px 4px',color:'#888'}}>기초재고</td><td>{pvDescrView.startStock != null ? pvDescrView.startStock : '-'}</td></tr>
                  <tr style={{borderBottom:'1px solid #eee'}}><td style={{padding:'6px 4px',color:'#888'}}>입고</td><td style={{color:'#1565c0'}}>{pvDescrView.inQty}</td></tr>
                  <tr style={{borderBottom:'1px solid #eee'}}><td style={{padding:'6px 4px',color:'#888'}}>출고(분배)</td><td style={{color:'#e65100',fontWeight:700}}>{pvDescrView.outQty}</td></tr>
                  <tr><td style={{padding:'6px 4px',color:'#888'}}>잔량</td><td style={{fontWeight:700,color:pvDescrView.remain<0?'#d32f2f':'#2e7d32'}}>{pvDescrView.remain}</td></tr>
                </tbody>
              </table>
              {/* 업체별 변경내역 */}
              <div style={{fontSize:13,fontWeight:700,marginBottom:8}}>변경내역</div>
              {pvDescrView.items.map((item,i) => (
                <div key={i} style={{marginBottom:12}}>
                  <div style={{fontSize:12,fontWeight:600,color:'#1565c0',marginBottom:4}}>🏢 {item.custName}</div>
                  {item.lines.map((line,li) => (
                    <div key={li} style={{fontSize:11,color:'#555',padding:'2px 0 2px 16px',borderLeft:'2px solid #e0e0e0',marginBottom:2}}>
                      {line}
                    </div>
                  ))}
                </div>
              ))}
              {pvDescrView.items.length === 0 && <div style={{color:'#999',fontSize:12}}>변경내역 없음</div>}
            </div>
          </div>
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
    if (!pivotRows.length) return <div style={st.empty}>주문/출고 데이터 없음</div>;

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
        <div style={{ padding:'16px 20px', maxWidth:1600, margin:'0 auto' }}>

          {/* 헤더 */}
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12, flexWrap:'wrap' }}>
            <h2 style={{ margin:0, fontSize:18, fontWeight:700 }}>출고,재고상황</h2>
            <div style={{ display:'flex', alignItems:'center', gap:4, background:'#f5f5f5',
                          padding:'6px 10px', borderRadius:6, border:'1px solid #e0e0e0' }}>
              <span style={{ fontSize:12, color:'#555', fontWeight:600 }}>차수</span>
              <button onClick={()=>{weekFromInput.prevWeek();weekToInput.prevWeek();}}
                style={{...st.weekSyncBtn,background:'#e65100',color:'#fff',fontWeight:900,fontSize:11,padding:'2px 8px',borderRadius:4,border:'none',cursor:'pointer'}}
                title="양쪽 동시 이전 주차">&lt;&lt;&lt;</button>
              <button onClick={weekFromInput.prevWeek} style={st.weekBigBtn} title="이전 주차">◁</button>
              <WeekInput weekInput={weekFromInput} />
              <button onClick={weekFromInput.nextWeek} style={st.weekBigBtn} title="다음 주차">▷</button>
              <span style={{ color:'#aaa', fontWeight:700 }}>~</span>
              <button onClick={weekToInput.prevWeek} style={st.weekBigBtn} title="이전 주차">◁</button>
              <WeekInput weekInput={weekToInput} />
              <button onClick={weekToInput.nextWeek} style={st.weekBigBtn} title="다음 주차">▷</button>
              <button onClick={()=>{weekFromInput.nextWeek();weekToInput.nextWeek();}}
                style={{...st.weekSyncBtn,background:'#e65100',color:'#fff',fontWeight:900,fontSize:11,padding:'2px 8px',borderRadius:4,border:'none',cursor:'pointer'}}
                title="양쪽 동시 다음 주차">&gt;&gt;&gt;</button>
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
              <select value="" onChange={e=>{if(e.target.value) setFilterCoun(prev=>{const n=new Set(prev);n.add(e.target.value);return n;});}} style={st.filterSel}>
                <option value="">{filterCoun.size>0?`국가 ${filterCoun.size}개 선택`:'국가 전체'}</option>
                {allCounNames.filter(c=>!filterCoun.has(c)).map(c=><option key={c} value={c}>{c}</option>)}
              </select>
              {filterCoun.size>0&&<button onClick={()=>setFilterCoun(new Set())} style={{fontSize:10,padding:'1px 6px',border:'1px solid #ccc',borderRadius:4,cursor:'pointer',background:'#fff'}}>국가초기화</button>}
              <select value={filterFlower} onChange={e=>setFilterFlower(e.target.value)} style={st.filterSel}>
                <option value="">꽃 전체</option>
                {allFlowerNames.map(f=><option key={f} value={f}>{f}</option>)}
              </select>
              <input value={filterSearch} onChange={e=>setFilterSearch(e.target.value)}
                placeholder="품명 / 꽃 / 업체명..." style={{ ...st.filterSel, width:160 }} />
              {isFilterActive && (
                <button onClick={()=>{setFilterCoun(new Set());setFilterFlower('');setFilterSearch('');}}
                  style={{ fontSize:11, padding:'3px 10px', border:'1px solid #ccc', borderRadius:4, cursor:'pointer', background:'#fff' }}>
                  ✕ 초기화
                </button>
              )}
            </div>
          )}

          {/* 탭 + 즐겨찾기 */}
          <div style={{ display:'flex', gap:4, marginBottom:16, borderBottom:'2px solid #e0e0e0', alignItems:'center', flexWrap:'wrap' }}>
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
            <span style={{ width:1, height:20, background:'#ccc', margin:'0 4px' }}/>
            {favorites.map(fav=>{
              const isActive = activeFavKey === fav.FavoriteKey;
              return (
              <span key={fav.FavoriteKey} style={{ display:'inline-flex', alignItems:'center', gap:2 }}>
                <button onClick={()=>applyFavorite(fav)}
                  style={{ padding:'4px 10px', fontSize:11, fontWeight:600, borderRadius:12, cursor:'pointer',
                    border: isActive ? '2px solid #e65100' : '1px solid #f9a825',
                    background: isActive ? '#e65100' : '#fff8e1',
                    color: isActive ? '#fff' : '#f57f17' }}>
                  {isActive ? '★' : '⭐'} {fav.FavName}
                </button>
                <button onClick={()=>deleteFavorite(fav.FavoriteKey)}
                  style={{ width:16, height:16, padding:0, fontSize:9, border:'none', background:'transparent',
                    color:'#999', cursor:'pointer', lineHeight:'16px' }}>✕</button>
              </span>
              );
            })}
            <button onClick={saveFavorite}
              style={{ padding:'4px 10px', fontSize:11, border:'1px dashed #aaa', borderRadius:12,
                background:'#fafafa', color:'#666', cursor:'pointer' }}>
              + 즐겨찾기 추가
            </button>
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
                  <div style={{ display:'flex', gap:4, marginBottom:10, alignItems:'center', flexWrap:'wrap' }}>
                    {[{key:'byCust',label:'🏢 업체기준'},{key:'byProd',label:'📦 품목기준'},{key:'weekPivot',label:'📊 차수 피벗'}].map(s=>(
                      <button key={s.key} onClick={()=>setPivotSub(s.key)}
                        style={{ ...st.subTabBtn, ...(pivotSub===s.key?st.subTabBtnActive:{}) }}>
                        {s.label}
                      </button>
                    ))}
                    <button onClick={()=>setShowAddOrder(true)}
                      style={{ marginLeft:'auto', padding:'5px 14px', background:'#388e3c', color:'#fff',
                               border:'none', borderRadius:4, cursor:'pointer', fontSize:12, fontWeight:700 }}>
                      ➕ 주문추가
                    </button>
                  </div>
                  {pivotSub==='weekPivot' ? renderWeekPivot() : renderPivot()}
                </>
              )}
            </>
          )}
        </div>

      {/* 수정내역 삭제 확인 모달 */}
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
                const m = pvDescrModal;
                try {
                  const r = await fetch('/api/shipment/stock-status', {
                    method:'DELETE', headers:{'Content-Type':'application/json'},
                    body: JSON.stringify({custKey:m.ck, prodKey:m.pk, week:m.wk, lineIdx:m.lineIdx}),
                  });
                  const d = await r.json();
                  if (d.success) { setPvDescrModal(null); loadData(weekFrom, weekTo, tab); }
                  else alert('삭제 실패: ' + d.error);
                } catch(e) { alert('오류: ' + e.message); }
              }}
                style={{padding:'7px 20px',background:'#d32f2f',color:'#fff',border:'none',borderRadius:5,cursor:'pointer',fontSize:12,fontWeight:700}}>
                삭제
              </button>
            </div>
          </div>
        </div>
      )}
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
