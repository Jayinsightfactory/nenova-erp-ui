// pages/orders/index.js
// 주문 관리 화면
// 수정이력: 2026-03-30 — 기존 프로그램과 동일한 레이아웃으로 재작성
//   - 거래처별 그룹핑 + 품목 행 표시
//   - 주문등록 버튼 → 팝업 새 창으로 열기
//   - 차수/품목 필터, 박스/단/송이 합계 표시

import { useState, useEffect } from 'react';
import { apiGet } from '../../lib/useApi';
import { useLang } from '../../lib/i18n';

const fmt = n => Number(n || 0).toLocaleString();

// 팝업으로 주문 등록 열기
function openOrderNew() {
  const w = 1280, h = 820;
  const left = Math.max(0, (screen.width  - w) / 2);
  const top  = Math.max(0, (screen.height - h) / 2);
  window.open(
    '/orders/new?popup=1',
    '주문등록',
    `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`
  );
}

export default function OrderList() {
  const { t } = useLang();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [custName, setCustName] = useState('');
  const [prodFilter, setProdFilter] = useState('');
  const [selectedRow, setSelectedRow] = useState(null); // { orderId, prodKey }
  const [err, setErr] = useState('');

  const load = () => {
    setLoading(true); setErr('');
    apiGet('/api/orders', { startDate, endDate, custName })
      .then(d => setOrders(d.orders || []))
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const d = new Date(); const day = d.getDay();
    const mon = new Date(d); mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    const sun = new Date(d); sun.setDate(d.getDate() + (day === 0 ? 0 : 7 - day));
    setStartDate(mon.toISOString().slice(0, 10));
    setEndDate(sun.toISOString().slice(0, 10));
  }, []);

  useEffect(() => { if (startDate && endDate) load(); }, [startDate, endDate]);

  // 품목 필터 적용
  const filteredOrders = orders.map(o => ({
    ...o,
    items: prodFilter
      ? o.items.filter(i => i.prodName?.toLowerCase().includes(prodFilter.toLowerCase()))
      : o.items
  })).filter(o => o.items.length > 0);

  // 전체 합계
  const totalBox   = filteredOrders.flatMap(o => o.items).reduce((a, i) => a + (i.boxQty  || 0), 0);
  const totalBunch = filteredOrders.flatMap(o => o.items).reduce((a, i) => a + (i.bunchQty|| 0), 0);
  const totalSteam = filteredOrders.flatMap(o => o.items).reduce((a, i) => a + (i.steamQty|| 0), 0);
  const totalCount = filteredOrders.reduce((a, o) => a + o.items.length, 0);

  const handleExcel = () => {
    const rows = [['주문일자','차수','거래처','지역','담당자','국가','꽃','품목명(색상)','단위','박스수량','단수량','송이수량','클라이언트코드']];
    filteredOrders.forEach(o => {
      o.items.forEach(item => {
        rows.push([o.date, o.week, o.custName, o.custArea, o.manager,
          item.counName, item.flowerName, item.prodName,
          item.unit, item.boxQty||0, item.bunchQty||0, item.steamQty||0, o.orderCode]);
      });
    });
    const csv = rows.map(r => r.map(v => `"${v||''}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF'+csv], {type:'text/csv'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `주문목록_${endDate}.csv`;
    a.click();
  };

  return (
    <div>
      {/* 필터 바 */}
      <div className="filter-bar">
        <span className="filter-label">주문일자</span>
        <input type="date" className="filter-input" value={startDate} onChange={e => setStartDate(e.target.value)} />
        <span style={{color:'var(--text3)'}}>~</span>
        <input type="date" className="filter-input" value={endDate} onChange={e => setEndDate(e.target.value)} />
        <span className="filter-label">품목</span>
        <input className="filter-input" placeholder="품목명" value={prodFilter} onChange={e => setProdFilter(e.target.value)} style={{minWidth:120}} />
        <div className="page-actions">
          <button className="btn btn-primary" onClick={load}>{t('새로고침')}</button>
          <button className="btn btn-sm" style={{background:'#006600',color:'#fff',borderColor:'#004400'}} onClick={openOrderNew}>✏️ 주문 등록 / Reg. Pedido</button>
          <button className="btn" onClick={handleExcel}>📊 엑 셀 / Excel</button>
          <button className="btn" onClick={() => window.opener ? window.close() : history.back()}>✖️ 닫 기 / Cerrar</button>
        </div>
      </div>

      {err && <div className="banner-err">⚠️ {err}</div>}

      {/* 합계 요약 */}
      <div style={{padding:'4px 10px', background:'var(--header-bg)', border:'1px solid var(--border)', borderTop:'none', fontSize:12, display:'flex', gap:20}}>
        <span>조회 결과: <strong>{totalCount}건</strong></span>
        <span>박스 합계: <strong style={{fontFamily:'var(--mono)'}}>{fmt(totalBox)}</strong></span>
        <span>단 합계: <strong style={{fontFamily:'var(--mono)'}}>{fmt(totalBunch)}</strong></span>
        <span>송이 합계: <strong style={{fontFamily:'var(--mono)'}}>{fmt(totalSteam)}</strong></span>
      </div>

      {/* 주문 목록 테이블 */}
      <div className="table-wrap">
        {loading ? (
          <div className="skeleton" style={{height:300}}></div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th style={{minWidth:90}}>주문일자</th>
                <th style={{minWidth:70}}>차수</th>
                <th style={{minWidth:160}}>거래처</th>
                <th style={{minWidth:60}}>지역</th>
                <th style={{minWidth:80}}>담당자</th>
                <th style={{minWidth:60}}>국가</th>
                <th style={{minWidth:70}}>꽃</th>
                <th style={{minWidth:200}}>품목명(색상)</th>
                <th style={{minWidth:40}}>단위</th>
                <th style={{textAlign:'right',minWidth:70}}>박스수량</th>
                <th style={{textAlign:'right',minWidth:70}}>단수량</th>
                <th style={{textAlign:'right',minWidth:70}}>송이수량</th>
                <th style={{minWidth:90}}>클라이언트코드</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={13} style={{textAlign:'center', padding:40, color:'var(--text3)'}}>
                    조회된 주문이 없습니다
                  </td>
                </tr>
              ) : filteredOrders.map(o => {
                const orderTotal = {
                  box:   o.items.reduce((a,i) => a+(i.boxQty  ||0), 0),
                  bunch: o.items.reduce((a,i) => a+(i.bunchQty||0), 0),
                  steam: o.items.reduce((a,i) => a+(i.steamQty||0), 0),
                };
                return [
                  // ── 차수 헤더 행
                  <tr key={`week-${o.id}`} style={{background:'#E0E8F0'}}>
                    <td colSpan={13} style={{padding:'2px 8px', fontWeight:'bold', fontSize:12}}>
                      ∨ 차수: {o.week}
                    </td>
                  </tr>,

                  // ── 거래처 헤더 행
                  <tr key={`cust-${o.id}`} style={{background:'#EEF4FB'}}>
                    <td colSpan={5} style={{padding:'2px 16px', fontWeight:'bold', fontSize:12, color:'var(--blue)'}}>
                      ∨ 거래처명: {o.custName} ({o.manager})
                    </td>
                    <td colSpan={4}></td>
                    <td className="num" style={{fontWeight:'bold'}}>{fmt(orderTotal.box)}</td>
                    <td className="num" style={{fontWeight:'bold'}}>{fmt(orderTotal.bunch)}</td>
                    <td className="num" style={{fontWeight:'bold'}}>{fmt(orderTotal.steam)}</td>
                    <td></td>
                  </tr>,

                  // ── 품목 행들
                  ...o.items.map((item, idx) => {
                    const isSelected = selectedRow?.orderId === o.id && selectedRow?.idx === idx;
                    return (
                      <tr key={`item-${o.id}-${idx}`}
                        className={isSelected ? 'selected' : ''}
                        onClick={() => setSelectedRow({orderId: o.id, idx})}
                        style={{cursor:'pointer'}}
                      >
                        <td style={{fontFamily:'var(--mono)', fontSize:11}}>{o.date}</td>
                        <td style={{fontFamily:'var(--mono)', fontWeight:'bold', fontSize:11}}>{o.week}</td>
                        <td style={{fontSize:12}}>{o.custName}</td>
                        <td>{o.custArea ? <span className="badge badge-gray">{o.custArea}</span> : ''}</td>
                        <td style={{fontSize:11, color:'var(--text3)'}}>{o.manager}</td>
                        <td style={{fontSize:11}}>{item.counName}</td>
                        <td style={{fontSize:11}}>{item.flowerName}</td>
                        <td style={{fontSize:12, fontWeight:500}}>{item.prodName}</td>
                        <td style={{fontSize:11}}>{item.unit}</td>
                        <td className="num">{item.boxQty   > 0 ? fmt(item.boxQty)   : ''}</td>
                        <td className="num">{item.bunchQty > 0 ? fmt(item.bunchQty) : ''}</td>
                        <td className="num">{item.steamQty > 0 ? fmt(item.steamQty) : ''}</td>
                        <td style={{fontFamily:'var(--mono)', fontSize:11}}>{o.orderCode}</td>
                      </tr>
                    );
                  }),

                  // ── 거래처 소계 행
                  <tr key={`subtotal-${o.id}`} style={{background:'#F8F8F8', borderTop:'1px solid var(--border)'}}>
                    <td colSpan={9} style={{textAlign:'right', fontWeight:'bold', fontSize:12, padding:'2px 8px', color:'var(--text3)'}}>
                      합계
                    </td>
                    <td className="num" style={{fontWeight:'bold'}}>{fmt(orderTotal.box)}</td>
                    <td className="num" style={{fontWeight:'bold'}}>{fmt(orderTotal.bunch)}</td>
                    <td className="num" style={{fontWeight:'bold'}}>{fmt(orderTotal.steam)}</td>
                    <td></td>
                  </tr>,
                ];
              })}
            </tbody>
            {/* 전체 합계 */}
            <tfoot>
              <tr>
                <td colSpan={9} style={{textAlign:'right', fontWeight:'bold', padding:'3px 8px'}}>전체 합계</td>
                <td className="num" style={{fontWeight:'bold'}}>{fmt(totalBox)}</td>
                <td className="num" style={{fontWeight:'bold'}}>{fmt(totalBunch)}</td>
                <td className="num" style={{fontWeight:'bold'}}>{fmt(totalSteam)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
