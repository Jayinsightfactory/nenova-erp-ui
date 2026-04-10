// pages/shipment/stock-status.js — 출고,재고상황 v5
// 추가: 업체별 칩 필터 기본값 전체숨김, 줄긋기 제거, 기록컬럼, UpdateDtm 오류수정
import React, { useState, useEffect, useCallback, useMemo, createContext, useContext } from 'react';
import Layout from '../../components/Layout';
import { WeekInput, useWeekInput } from '../../lib/useWeekInput';

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
  const [selProd,    setSelProd]    = useState(null);
  const [qty,        setQty]        = useState('');
  const [unit,       setUnit]       = useState('박스');
  const [orderWeek,  setOrderWeek]  = useState(weekFrom || '');
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState('');

  // 업체/품목 로드
  useEffect(() => {
    fetch('/api/master?entity=customers').then(r=>r.json()).then(d=>{if(d.success) setCusts(d.data);});
    fetch('/api/master?entity=products').then(r=>r.json()).then(d=>{if(d.success) setProds(d.data);});
  }, []);

  // 품목 선택 시 단위 자동 설정
  useEffect(() => {
    if (selProd?.OutUnit) {
      const u = selProd.OutUnit;
      setUnit(UNITS.includes(u) ? u : '박스');
    }
  }, [selProd]);

  const filteredCusts = useMemo(() => {
    if (!custSearch) return custs.slice(0, 50);
    const q = custSearch.toLowerCase();
    return custs.filter(c => c.CustName?.toLowerCase().includes(q) || c.CustArea?.toLowerCase().includes(q));
  }, [custs, custSearch]);

  const filteredProds = useMemo(() => {
    if (!prodSearch) return prods.slice(0, 50);
    const q = prodSearch.toLowerCase();
    return prods.filter(p =>
      p.ProdName?.toLowerCase().includes(q) || p.FlowerName?.toLowerCase().includes(q) || p.CounName?.toLowerCase().includes(q));
  }, [prods, prodSearch]);

  const handleSubmit = async () => {
    if (!selCust)              { setError('업체를 선택하세요'); return; }
    if (!selProd)              { setError('품목을 선택하세요'); return; }
    if (!qty || parseFloat(qty) <= 0) { setError('수량을 입력하세요 (0 초과)'); return; }
    if (!orderWeek)            { setError('차수를 입력하세요'); return; }
    setSaving(true); setError('');
    try {
      const r = await fetch('/api/shipment/stock-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'addOrder', custKey: selCust.CustKey, prodKey: selProd.ProdKey, week: orderWeek, qty, unit }),
      });
      const d = await r.json();
      if (d.success) { onSuccess?.(); onClose(); }
      else setError(d.error);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:1000,
                  display:'flex', alignItems:'center', justifyContent:'center' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background:'#fff', borderRadius:10, width:560, maxWidth:'95vw', maxHeight:'90vh',
                    overflow:'auto', boxShadow:'0 8px 32px rgba(0,0,0,0.25)' }}>
        <div style={{ background:'#1976d2', color:'#fff', padding:'14px 20px', borderRadius:'10px 10px 0 0',
                      display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontWeight:700, fontSize:16 }}>주문 추가</span>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'#fff', fontSize:20, cursor:'pointer' }}>✕</button>
        </div>
        <div style={{ padding:'18px 20px' }}>

          {/* 차수 */}
          <div style={{ marginBottom:14 }}>
            <label style={st.label}>차수</label>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <input value={orderWeek} onChange={e=>setOrderWeek(e.target.value)} placeholder="예: 14-01"
                style={{ ...st.modalInput, width:120 }} />
              {weekFrom !== weekTo && (
                <span style={{ fontSize:11, color:'#888' }}>범위: {weekFrom} ~ {weekTo}</span>
              )}
            </div>
          </div>

          {/* 업체 */}
          <div style={{ marginBottom:14 }}>
            <label style={st.label}>업체 선택</label>
            {selCust ? (
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <span style={{ background:'#e3f2fd', padding:'4px 12px', borderRadius:20, fontSize:13, fontWeight:600 }}>
                  {selCust.CustName} <span style={{ color:'#888', fontSize:11 }}>({selCust.CustArea})</span>
                </span>
                <button onClick={()=>setSelCust(null)}
                  style={{ ...st.pmBtn, background:'#ef5350', color:'#fff', width:'auto', padding:'2px 8px', fontSize:10 }}>변경</button>
              </div>
            ) : (
              <>
                <input value={custSearch} onChange={e=>setCustSearch(e.target.value)} placeholder="업체명 / 지역 검색..."
                  style={st.modalInput} autoFocus />
                <div style={{ border:'1px solid #e0e0e0', borderRadius:4, maxHeight:150, overflowY:'auto', marginTop:4 }}>
                  {filteredCusts.map(c=>(
                    <div key={c.CustKey} onClick={()=>{setSelCust(c);setCustSearch('');}}
                      style={{ padding:'6px 10px', cursor:'pointer', fontSize:12, borderBottom:'1px solid #f0f0f0',
                               display:'flex', gap:6 }}
                      onMouseOver={e=>e.currentTarget.style.background='#e3f2fd'}
                      onMouseOut={e=>e.currentTarget.style.background='transparent'}>
                      <b>{c.CustName}</b><span style={{color:'#888'}}>{c.CustArea}</span>
                    </div>
                  ))}
                  {filteredCusts.length===0&&<div style={{padding:'8px 10px',color:'#999',fontSize:12}}>검색 결과 없음</div>}
                </div>
              </>
            )}
          </div>

          {/* 품목 */}
          <div style={{ marginBottom:14 }}>
            <label style={st.label}>품목 선택</label>
            {selProd ? (
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <span style={{ background:'#e8f5e9', padding:'4px 12px', borderRadius:20, fontSize:13, fontWeight:600 }}>
                  {selProd.CounName} · {selProd.FlowerName} · {selProd.ProdName}
                  <span style={{ color:'#888', fontSize:11, marginLeft:6 }}>[{selProd.OutUnit}]</span>
                </span>
                <button onClick={()=>setSelProd(null)}
                  style={{ ...st.pmBtn, background:'#ef5350', color:'#fff', width:'auto', padding:'2px 8px', fontSize:10 }}>변경</button>
              </div>
            ) : (
              <>
                <input value={prodSearch} onChange={e=>setProdSearch(e.target.value)} placeholder="품목명 / 꽃 / 국가 검색..."
                  style={st.modalInput} />
                <div style={{ border:'1px solid #e0e0e0', borderRadius:4, maxHeight:150, overflowY:'auto', marginTop:4 }}>
                  {filteredProds.map(p=>(
                    <div key={p.ProdKey} onClick={()=>{setSelProd(p);setProdSearch('');}}
                      style={{ padding:'6px 10px', cursor:'pointer', fontSize:12, borderBottom:'1px solid #f0f0f0',
                               display:'flex', gap:6 }}
                      onMouseOver={e=>e.currentTarget.style.background='#e8f5e9'}
                      onMouseOut={e=>e.currentTarget.style.background='transparent'}>
                      <b>{p.ProdName}</b>
                      <span style={{color:'#888'}}>{p.CounName} · {p.FlowerName}</span>
                      <span style={{color:'#1976d2', fontSize:11}}>[{p.OutUnit}]</span>
                    </div>
                  ))}
                  {filteredProds.length===0&&<div style={{padding:'8px 10px',color:'#999',fontSize:12}}>검색 결과 없음</div>}
                </div>
              </>
            )}
          </div>

          {/* 단위 + 수량 */}
          <div style={{ marginBottom:16, display:'flex', gap:16, alignItems:'flex-end', flexWrap:'wrap' }}>
            <div>
              <label style={st.label}>단위</label>
              <div style={{ display:'flex', gap:6 }}>
                {UNITS.map(u=>(
                  <button key={u} onClick={()=>setUnit(u)}
                    style={{ padding:'6px 14px', borderRadius:6, border:'1px solid',
                             borderColor: unit===u ? '#1976d2' : '#ccc',
                             background: unit===u ? '#1976d2' : '#f9f9f9',
                             color: unit===u ? '#fff' : '#555',
                             fontWeight: unit===u ? 700 : 400,
                             cursor:'pointer', fontSize:13 }}>
                    {u}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label style={st.label}>수량 ({unit})</label>
              <input type="number" min={1} value={qty} onChange={e=>setQty(e.target.value)}
                placeholder="0" style={{ ...st.modalInput, width:100 }} />
            </div>
          </div>

          {error && <div style={{color:'#d32f2f',fontSize:12,marginBottom:10}}>⚠ {error}</div>}

          <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
            <button onClick={onClose} style={{ padding:'8px 20px', border:'1px solid #ccc', borderRadius:5, cursor:'pointer', background:'#f5f5f5' }}>취소</button>
            <button onClick={handleSubmit} disabled={saving}
              style={{ padding:'8px 24px', background:saving?'#aaa':'#1976d2', color:'#fff', border:'none', borderRadius:5, cursor:'pointer', fontWeight:700 }}>
              {saving ? '저장중...' : '주문 추가'}
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

  const [products,  setProducts]  = useState([]);
  const [custRows,  setCustRows]  = useState([]);
  const [mgrRows,   setMgrRows]   = useState([]);
  const [pivotRows, setPivotRows] = useState([]);

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

  // 데이터 로드 시 칩 필터 초기화 — 기본값: 전체숨김
  useEffect(() => {
    setHiddenCusts(new Set(custRows.map(r => r.CustKey)));
  }, [custRows]);
  useEffect(() => {
    setHiddenMgrs(new Set(mgrRows.map(r => r.Manager || '미지정')));
    setHiddenMgrCusts({});
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
      if (t === 'pivot')     setPivotRows(d.rows||[]);
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (weekFrom && weekTo) { setEditMap({}); loadData(weekFrom, weekTo, tab); }
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
              <th style={{ ...st.th, background:'#2e7d32' }}>이월재고</th>
              <th style={{ ...st.th, background:'#1565c0' }}>입고수량</th>
              <th style={{ ...st.th, background:'#e65100' }}>주문수량</th>
              <th style={{ ...st.th, background:'#ad1457' }}>출고수량</th>
              <th style={{ ...st.th, background:'#4a148c' }}>잔량</th>
              <th style={{ ...st.th, background:'#455a64', minWidth:90 }}>기록</th>
            </tr>
          </thead>
          <tbody>
            {filteredProducts.map((p, i) => {
              const remain   = (p.prevStock||0) + (p.inQty||0) - (p.outQty||0);
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
                    <td style={{ ...st.td, textAlign:'right', background:'#e8f5e9', fontWeight:600 }}>{fmt(p.prevStock)}</td>
                    <td style={{ ...st.td, textAlign:'right', background:'#e3f2fd' }}>{fmt(p.inQty)}</td>
                    <td style={{ ...st.td, textAlign:'right', background:'#fff3e0' }}>{fmt(p.orderQty)}</td>
                    <td style={{ ...st.td, textAlign:'right', background:'#fce4ec', fontWeight:600 }}>{fmt(p.outQty)}</td>
                    <td style={{ ...st.td, textAlign:'right', background:'#f3e5f5',
                                 color:remain<0?'#d32f2f':'#388e3c', fontWeight:700 }}>{fmt(remain)}</td>
                    <td style={st.td}></td>
                  </tr>
                  {isExp && expState==='loading' && (
                    <tr><td colSpan={11} style={{ ...st.td, textAlign:'center', color:'#888', fontSize:11 }}>업체별 로딩중...</td></tr>
                  )}
                  {isExp && expState==='error' && (
                    <tr><td colSpan={11} style={{ ...st.td, textAlign:'center', color:'#d32f2f', fontSize:11 }}>로드 실패</td></tr>
                  )}
                  {isExp && Array.isArray(expState) && expRows.length===0 && (
                    <tr><td colSpan={11} style={{ ...st.td, textAlign:'center', color:'#bbb', fontSize:11 }}>출고 데이터 없음</td></tr>
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
              <td style={{ ...st.td, textAlign:'right' }}>{fmt(filteredProducts.reduce((a,p)=>a+(p.prevStock||0),0))}</td>
              <td style={{ ...st.td, textAlign:'right' }}>{fmt(filteredProducts.reduce((a,p)=>a+(p.inQty||0),0))}</td>
              <td style={{ ...st.td, textAlign:'right' }}>{fmt(filteredProducts.reduce((a,p)=>a+(p.orderQty||0),0))}</td>
              <td style={{ ...st.td, textAlign:'right' }}>{fmt(filteredProducts.reduce((a,p)=>a+(p.outQty||0),0))}</td>
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
          const totOut = g.items.reduce((a,b)=>a+(b.outQty||0),0);
          const totOrd = g.items.reduce((a,b)=>a+(b.custOrderQty||0),0);
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
                    {g.items.map((item, i) => {
                      const remain = (item.prevStock||0) + (item.totalInQty||0) - (item.totalOutQty||0);
                      return (
                        <tr key={`${item.ProdKey}-${item.OrderWeek}`} style={{ background:i%2===0?'#fff':'#fafafa' }}>
                          <td style={st.td}>{item.CounName}</td>
                          <td style={st.td}>{item.FlowerName}</td>
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
                const totOut = g.items.reduce((a,b)=>a+(b.outQty||0),0);
                const totOrd = g.items.reduce((a,b)=>a+(b.custOrderQty||0),0);
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
                            <th style={{ ...st.th, background:'#2e7d32' }}>이월재고</th>
                            <th style={{ ...st.th, background:'#455a64' }}>내주문</th>
                            <th style={{ ...st.th, background:'#455a64' }}>전체입고</th>
                            <th style={{ ...st.th, background:'#455a64' }}>전체주문</th>
                            <th style={{ ...st.th, background:'#ad1457' }}>출고수량 ±</th>
                            <th style={{ ...st.th, background:'#4a148c' }}>잔량</th>
                            <th style={{ ...st.th, background:'#455a64', minWidth:90 }}>기록</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.items.map((item,i) => {
                            const remain = (item.prevStock||0)+(item.totalInQty||0)-(item.totalOutQty||0);
                            return (
                              <tr key={`${item.ProdKey}-${item.OrderWeek}`} style={{ background:i%2===0?'#fff':'#fafafa' }}>
                                <td style={st.td}>{item.CounName}</td>
                                <td style={st.td}>{item.FlowerName}</td>
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
        })}
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
            <div style={{ display:'flex', alignItems:'center', gap:6, background:'#f5f5f5',
                          padding:'6px 10px', borderRadius:6, border:'1px solid #e0e0e0' }}>
              <span style={{ fontSize:12, color:'#555', fontWeight:600 }}>차수</span>
              <WeekInput weekInput={weekFromInput} />
              <span style={{ color:'#aaa', fontWeight:700 }}>~</span>
              <WeekInput weekInput={weekToInput} />
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

          {tab==='pivot' && (
            <div style={{ display:'flex', gap:4, marginBottom:12 }}>
              {[{key:'byCust',label:'🏢 업체기준'},{key:'byProd',label:'📦 품목기준'}].map(s=>(
                <button key={s.key} onClick={()=>setPivotSub(s.key)}
                  style={{ ...st.subTabBtn, ...(pivotSub===s.key?st.subTabBtnActive:{}) }}>
                  {s.label}
                </button>
              ))}
            </div>
          )}

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
              {tab==='pivot'     && renderPivot()}
            </>
          )}
        </div>
      </Layout>

      {showAddOrder && (
        <AddOrderModal
          weekFrom={weekFrom} weekTo={weekTo}
          onClose={() => setShowAddOrder(false)}
          onSuccess={() => loadData(weekFrom, weekTo, tab)}
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
  empty: { textAlign:'center', padding:'60px 20px', color:'#999', fontSize:14 },
  custHeader: {
    background:'#eceff1', padding:'8px 12px', borderRadius:'4px 4px 0 0',
    borderLeft:'3px solid #1976d2', fontSize:13,
    display:'flex', alignItems:'center', flexWrap:'wrap', gap:4,
  },
  refreshBtn: { padding:'5px 12px', background:'#f5f5f5', border:'1px solid #ccc', borderRadius:4, cursor:'pointer', fontSize:12 },
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
