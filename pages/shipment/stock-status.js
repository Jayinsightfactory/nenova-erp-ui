// pages/shipment/stock-status.js — 출고,재고상황
import { useState, useEffect, useCallback } from 'react';
import Layout from '../../components/Layout';
import WeekInput from '../../components/WeekInput';

export default function StockStatus() {
  const [week, setWeek]           = useState('');
  const [tab, setTab]             = useState('products'); // products | customers | pivot
  const [pivotSub, setPivotSub]   = useState('byCust');   // byCust | byProd
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');

  // 품목별 데이터
  const [products, setProducts]   = useState([]);
  // 업체별 데이터
  const [custRows, setCustRows]   = useState([]);
  // 모아보기 데이터
  const [pivotRows, setPivotRows] = useState([]);

  // ── 차수 변경 시 데이터 로드
  const loadData = useCallback(async (w, t) => {
    if (!w) return;
    setLoading(true);
    setError('');
    try {
      if (t === 'products') {
        const r = await fetch(`/api/shipment/stock-status?week=${encodeURIComponent(w)}&view=products`);
        const d = await r.json();
        if (d.success) setProducts(d.products || []);
        else setError(d.error);
      } else if (t === 'customers') {
        const r = await fetch(`/api/shipment/stock-status?week=${encodeURIComponent(w)}&view=customers`);
        const d = await r.json();
        if (d.success) setCustRows(d.rows || []);
        else setError(d.error);
      } else if (t === 'pivot') {
        const r = await fetch(`/api/shipment/stock-status?week=${encodeURIComponent(w)}&view=pivot`);
        const d = await r.json();
        if (d.success) setPivotRows(d.rows || []);
        else setError(d.error);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (week) loadData(week, tab);
  }, [week, tab, loadData]);

  // ── 품목별 탭
  const renderProducts = () => {
    if (!products.length) return <div style={styles.empty}>데이터 없음</div>;
    const total = { inQty: 0, outQty: 0, orderQty: 0, prevStock: 0 };
    products.forEach(p => {
      total.inQty    += p.inQty    || 0;
      total.outQty   += p.outQty   || 0;
      total.orderQty += p.orderQty || 0;
      total.prevStock+= p.prevStock|| 0;
    });
    return (
      <div style={{ overflowX: 'auto' }}>
        <table style={styles.table}>
          <thead>
            <tr style={styles.thead}>
              <th style={styles.th}>국가</th>
              <th style={styles.th}>꽃</th>
              <th style={styles.th}>품명</th>
              <th style={styles.th}>단위</th>
              <th style={{...styles.th, background:'#e8f5e9'}}>이월재고</th>
              <th style={{...styles.th, background:'#e3f2fd'}}>입고수량</th>
              <th style={{...styles.th, background:'#fff3e0'}}>주문수량</th>
              <th style={{...styles.th, background:'#fce4ec'}}>출고수량</th>
              <th style={{...styles.th, background:'#f3e5f5'}}>잔량</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p, i) => {
              const remain = (p.prevStock||0) + (p.inQty||0) - (p.outQty||0);
              const isOver = remain < 0;
              return (
                <tr key={p.ProdKey} style={{ background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                  <td style={styles.td}>{p.CounName}</td>
                  <td style={styles.td}>{p.FlowerName}</td>
                  <td style={{...styles.td, fontWeight: 500}}>{p.ProdName}</td>
                  <td style={{...styles.td, textAlign:'center'}}>{p.OutUnit}</td>
                  <td style={{...styles.td, textAlign:'right', background:'#e8f5e9'}}>{fmt(p.prevStock)}</td>
                  <td style={{...styles.td, textAlign:'right', background:'#e3f2fd'}}>{fmt(p.inQty)}</td>
                  <td style={{...styles.td, textAlign:'right', background:'#fff3e0'}}>{fmt(p.orderQty)}</td>
                  <td style={{...styles.td, textAlign:'right', background:'#fce4ec', fontWeight:600}}>{fmt(p.outQty)}</td>
                  <td style={{...styles.td, textAlign:'right', background:'#f3e5f5',
                              color: isOver ? '#d32f2f' : '#388e3c', fontWeight: 600}}>
                    {fmt(remain)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ background: '#eceff1', fontWeight: 700 }}>
              <td colSpan={4} style={{...styles.td, textAlign:'center'}}>합계 ({products.length}품목)</td>
              <td style={{...styles.td, textAlign:'right'}}>{fmt(total.prevStock)}</td>
              <td style={{...styles.td, textAlign:'right'}}>{fmt(total.inQty)}</td>
              <td style={{...styles.td, textAlign:'right'}}>{fmt(total.orderQty)}</td>
              <td style={{...styles.td, textAlign:'right'}}>{fmt(total.outQty)}</td>
              <td style={{...styles.td, textAlign:'right', color: (total.prevStock+total.inQty-total.outQty)<0 ? '#d32f2f':'#388e3c'}}>
                {fmt(total.prevStock + total.inQty - total.outQty)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  };

  // ── 업체별 탭: 업체 → 품목 목록
  const renderCustomers = () => {
    if (!custRows.length) return <div style={styles.empty}>데이터 없음</div>;
    // 업체별 그룹
    const grouped = {};
    custRows.forEach(r => {
      const key = r.CustKey;
      if (!grouped[key]) grouped[key] = { name: r.CustName, area: r.CustArea, items: [] };
      grouped[key].items.push(r);
    });
    return (
      <div>
        {Object.values(grouped).map(g => {
          const totOrder = g.items.reduce((a, b) => a + (b.orderQty||0), 0);
          const totOut   = g.items.reduce((a, b) => a + (b.outQty||0), 0);
          const totRem   = g.items.reduce((a, b) => a + (b.remain||0), 0);
          return (
            <div key={g.name} style={{ marginBottom: 16 }}>
              <div style={styles.custHeader}>
                <span style={{ fontWeight: 700 }}>{g.name}</span>
                <span style={{ color: '#666', fontSize: 12, marginLeft: 8 }}>{g.area}</span>
                <span style={{ marginLeft: 16, color: '#1976d2' }}>주문 {fmt(totOrder)}</span>
                <span style={{ marginLeft: 8, color: '#e65100' }}>출고 {fmt(totOut)}</span>
                <span style={{ marginLeft: 8, color: totRem < 0 ? '#d32f2f' : '#388e3c' }}>잔량 {fmt(totRem)}</span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ ...styles.table, marginBottom: 0 }}>
                  <thead>
                    <tr style={styles.thead}>
                      <th style={styles.th}>국가</th>
                      <th style={styles.th}>꽃</th>
                      <th style={styles.th}>품명</th>
                      <th style={styles.th}>단위</th>
                      <th style={{...styles.th, background:'#fff3e0'}}>주문수량</th>
                      <th style={{...styles.th, background:'#fce4ec'}}>출고수량</th>
                      <th style={{...styles.th, background:'#f3e5f5'}}>잔량</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.items.map((item, i) => (
                      <tr key={item.ProdKey} style={{ background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                        <td style={styles.td}>{item.CounName}</td>
                        <td style={styles.td}>{item.FlowerName}</td>
                        <td style={{...styles.td, fontWeight:500}}>{item.ProdName}</td>
                        <td style={{...styles.td, textAlign:'center'}}>{item.OutUnit}</td>
                        <td style={{...styles.td, textAlign:'right', background:'#fff3e0'}}>{fmt(item.orderQty)}</td>
                        <td style={{...styles.td, textAlign:'right', background:'#fce4ec', fontWeight:600,
                            color: item.outQty > 0 ? '#e65100' : '#999'}}>{fmt(item.outQty)}</td>
                        <td style={{...styles.td, textAlign:'right', background:'#f3e5f5',
                            color: item.remain < 0 ? '#d32f2f' : '#388e3c'}}>{fmt(item.remain)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // ── 모아보기: 업체기준(업체행 × 품목열) 또는 품목기준(품목행 × 업체열)
  const renderPivot = () => {
    if (!pivotRows.length) return <div style={styles.empty}>출고 데이터 없음 (0 제외)</div>;

    if (pivotSub === 'byCust') {
      // 열: 품목 목록
      const prodMap = {};
      const custMap = {};
      pivotRows.forEach(r => {
        prodMap[r.ProdKey] = { name: r.ProdName, flower: r.FlowerName, coun: r.CounName };
        if (!custMap[r.CustKey]) custMap[r.CustKey] = { name: r.CustName, area: r.CustArea, data: {} };
        custMap[r.CustKey].data[r.ProdKey] = r.outQty;
      });
      const prods = Object.entries(prodMap).sort((a,b) => {
        const A = prodMap[a[0]]; const B = prodMap[b[0]];
        return (A.coun+A.flower+A.name).localeCompare(B.coun+B.flower+B.name);
      });
      const custs = Object.values(custMap).sort((a,b) => (a.area+a.name).localeCompare(b.area+b.name));
      const prodTotals = {};
      prods.forEach(([pk]) => {
        prodTotals[pk] = custs.reduce((a, c) => a + (c.data[pk]||0), 0);
      });

      return (
        <div style={{ overflowX: 'auto' }}>
          <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
            📊 업체 기준 — 업체행 × 품목열 (출고수량 0 제외)
          </div>
          <table style={{ ...styles.table, fontSize: 11 }}>
            <thead>
              <tr style={styles.thead}>
                <th style={{ ...styles.th, minWidth: 80, position: 'sticky', left: 0, zIndex: 2, background: '#37474f' }}>업체명</th>
                {prods.map(([pk]) => (
                  <th key={pk} style={{ ...styles.th, minWidth: 70, whiteSpace:'nowrap' }}>
                    {prodMap[pk].flower}<br/>
                    <span style={{ fontSize: 10, color: '#cfd8dc' }}>{prodMap[pk].name}</span>
                  </th>
                ))}
                <th style={{ ...styles.th, background: '#546e7a' }}>합계</th>
              </tr>
            </thead>
            <tbody>
              {custs.map((c, ci) => {
                const rowTotal = prods.reduce((a, [pk]) => a + (c.data[pk]||0), 0);
                return (
                  <tr key={c.name} style={{ background: ci % 2 === 0 ? '#fff' : '#f5f5f5' }}>
                    <td style={{ ...styles.td, fontWeight: 600, position: 'sticky', left: 0, background: ci%2===0?'#fff':'#f5f5f5', zIndex:1 }}>{c.name}</td>
                    {prods.map(([pk]) => (
                      <td key={pk} style={{ ...styles.td, textAlign: 'right', color: (c.data[pk]||0) > 0 ? '#1565c0' : '#bbb' }}>
                        {(c.data[pk]||0) > 0 ? fmt(c.data[pk]) : '-'}
                      </td>
                    ))}
                    <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700, background: '#e8eaf6' }}>{fmt(rowTotal)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: '#eceff1', fontWeight: 700 }}>
                <td style={{ ...styles.td, position: 'sticky', left: 0, background: '#eceff1', zIndex: 1 }}>합계</td>
                {prods.map(([pk]) => (
                  <td key={pk} style={{ ...styles.td, textAlign: 'right' }}>{fmt(prodTotals[pk])}</td>
                ))}
                <td style={{ ...styles.td, textAlign: 'right' }}>{fmt(Object.values(prodTotals).reduce((a,b)=>a+b,0))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      );
    }

    // 품목 기준
    const prodMap = {};
    const custMap = {};
    pivotRows.forEach(r => {
      if (!prodMap[r.ProdKey]) prodMap[r.ProdKey] = { name: r.ProdName, flower: r.FlowerName, coun: r.CounName, data: {} };
      custMap[r.CustKey] = { name: r.CustName, area: r.CustArea };
      prodMap[r.ProdKey].data[r.CustKey] = r.outQty;
    });
    const prods = Object.entries(prodMap).sort((a,b)=>{
      const A=prodMap[a[0]]; const B=prodMap[b[0]];
      return (A.coun+A.flower+A.name).localeCompare(B.coun+B.flower+B.name);
    });
    const custs = Object.entries(custMap).sort((a,b)=>(custMap[a[0]].area+custMap[a[0]].name).localeCompare(custMap[b[0]].area+custMap[b[0]].name));
    const custTotals = {};
    custs.forEach(([ck]) => {
      custTotals[ck] = prods.reduce((a,[pk]) => a + (prodMap[pk].data[ck]||0), 0);
    });

    return (
      <div style={{ overflowX: 'auto' }}>
        <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
          📊 품목 기준 — 품목행 × 업체열 (출고수량 0 제외)
        </div>
        <table style={{ ...styles.table, fontSize: 11 }}>
          <thead>
            <tr style={styles.thead}>
              <th style={{ ...styles.th, minWidth: 100, position: 'sticky', left: 0, zIndex: 2, background: '#37474f' }}>품명</th>
              {custs.map(([ck]) => (
                <th key={ck} style={{ ...styles.th, minWidth: 60, whiteSpace:'nowrap' }}>{custMap[ck].name}</th>
              ))}
              <th style={{ ...styles.th, background: '#546e7a' }}>합계</th>
            </tr>
          </thead>
          <tbody>
            {prods.map(([pk, p], pi) => {
              const rowTotal = custs.reduce((a,[ck]) => a+(p.data[ck]||0), 0);
              return (
                <tr key={pk} style={{ background: pi%2===0?'#fff':'#f5f5f5' }}>
                  <td style={{ ...styles.td, fontWeight:600, position:'sticky', left:0, background:pi%2===0?'#fff':'#f5f5f5', zIndex:1 }}>
                    <div style={{ fontSize:11 }}>{p.coun} · {p.flower}</div>
                    <div>{p.name}</div>
                  </td>
                  {custs.map(([ck]) => (
                    <td key={ck} style={{ ...styles.td, textAlign:'right', color:(p.data[ck]||0)>0?'#1565c0':'#bbb' }}>
                      {(p.data[ck]||0)>0 ? fmt(p.data[ck]) : '-'}
                    </td>
                  ))}
                  <td style={{ ...styles.td, textAlign:'right', fontWeight:700, background:'#e8eaf6' }}>{fmt(rowTotal)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ background:'#eceff1', fontWeight:700 }}>
              <td style={{ ...styles.td, position:'sticky', left:0, background:'#eceff1', zIndex:1 }}>합계</td>
              {custs.map(([ck]) => (
                <td key={ck} style={{ ...styles.td, textAlign:'right' }}>{fmt(custTotals[ck])}</td>
              ))}
              <td style={{ ...styles.td, textAlign:'right' }}>{fmt(Object.values(custTotals).reduce((a,b)=>a+b,0))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  };

  return (
    <Layout title="출고,재고상황">
      <div style={{ padding: '16px 20px', maxWidth: 1400, margin: '0 auto' }}>
        {/* 헤더 */}
        <div style={{ display:'flex', alignItems:'center', gap:16, marginBottom:16, flexWrap:'wrap' }}>
          <h2 style={{ margin:0, fontSize:18, fontWeight:700 }}>출고,재고상황</h2>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <label style={{ fontSize:13, color:'#555' }}>차수</label>
            <WeekInput value={week} onChange={setWeek} />
          </div>
          {week && (
            <button onClick={() => loadData(week, tab)} style={styles.refreshBtn}>🔄 새로고침</button>
          )}
          {loading && <span style={{ color:'#1976d2', fontSize:13 }}>로딩중...</span>}
        </div>

        {error && (
          <div style={{ background:'#ffebee', border:'1px solid #ef9a9a', borderRadius:6, padding:'10px 14px', marginBottom:16, color:'#c62828', fontSize:13 }}>
            오류: {error}
          </div>
        )}

        {/* 탭 */}
        <div style={{ display:'flex', gap:4, marginBottom:16, borderBottom:'2px solid #e0e0e0' }}>
          {[
            { key:'products',  label:'📦 품목별' },
            { key:'customers', label:'🏢 업체별' },
            { key:'pivot',     label:'📊 모아보기' },
          ].map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{ ...styles.tabBtn, ...(tab === t.key ? styles.tabBtnActive : {}) }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* 모아보기 서브탭 */}
        {tab === 'pivot' && (
          <div style={{ display:'flex', gap:4, marginBottom:12 }}>
            <button onClick={() => setPivotSub('byCust')}
              style={{ ...styles.subTabBtn, ...(pivotSub==='byCust' ? styles.subTabBtnActive : {}) }}>
              🏢 업체기준
            </button>
            <button onClick={() => setPivotSub('byProd')}
              style={{ ...styles.subTabBtn, ...(pivotSub==='byProd' ? styles.subTabBtnActive : {}) }}>
              📦 품목기준
            </button>
          </div>
        )}

        {/* 콘텐츠 */}
        {!week ? (
          <div style={styles.empty}>차수를 선택해 주세요</div>
        ) : loading ? (
          <div style={styles.empty}>데이터 로딩중...</div>
        ) : (
          <>
            {tab === 'products'  && renderProducts()}
            {tab === 'customers' && renderCustomers()}
            {tab === 'pivot'     && renderPivot()}
          </>
        )}
      </div>
    </Layout>
  );
}

function fmt(v) {
  if (v === null || v === undefined) return '0';
  return Number(v).toLocaleString();
}

const styles = {
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 12,
    marginBottom: 8,
  },
  thead: {
    background: '#37474f',
    color: '#fff',
  },
  th: {
    padding: '8px 10px',
    textAlign: 'left',
    borderRight: '1px solid #546e7a',
    whiteSpace: 'nowrap',
    fontWeight: 600,
    fontSize: 12,
  },
  td: {
    padding: '6px 10px',
    borderBottom: '1px solid #e0e0e0',
    borderRight: '1px solid #f0f0f0',
    fontSize: 12,
  },
  empty: {
    textAlign: 'center',
    padding: '60px 20px',
    color: '#999',
    fontSize: 14,
  },
  custHeader: {
    background: '#eceff1',
    padding: '8px 12px',
    borderRadius: '4px 4px 0 0',
    borderLeft: '3px solid #1976d2',
    marginBottom: 0,
    fontSize: 13,
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
  },
  refreshBtn: {
    padding: '5px 12px',
    background: '#f5f5f5',
    border: '1px solid #ccc',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 12,
  },
  tabBtn: {
    padding: '8px 18px',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 500,
    color: '#666',
    borderBottom: '3px solid transparent',
    marginBottom: -2,
  },
  tabBtnActive: {
    color: '#1976d2',
    borderBottom: '3px solid #1976d2',
    fontWeight: 700,
  },
  subTabBtn: {
    padding: '5px 14px',
    border: '1px solid #ccc',
    background: '#f9f9f9',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 12,
    color: '#555',
  },
  subTabBtnActive: {
    background: '#1976d2',
    border: '1px solid #1976d2',
    color: '#fff',
    fontWeight: 600,
  },
};
