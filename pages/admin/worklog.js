// pages/admin/worklog.js
// 작업 내역 조회
// 수정이력: 2026-03-30 — 신규 작성
// - OrderHistory, StockHistory, ShipmentHistory 통합 조회
// - 사용자별/유형별/날짜별 필터

import { useState, useEffect } from 'react';
import { apiGet } from '../../lib/useApi';

const fmt = n => Number(n || 0).toLocaleString();

const TYPE_BADGE = {
  '주문변경':   'badge-blue',
  '재고변경':   'badge-amber',
  '출고변경':   'badge-green',
  '확정':       'badge-red',
  '확정취소':   'badge-gray',
  '입고':       'badge-blue',
  '재고조정':   'badge-amber',
};

export default function WorkLog() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  useEffect(() => {
    const d = new Date(); d.setDate(d.getDate() - 7);
    setStartDate(d.toISOString().slice(0, 10));
    setEndDate(new Date().toISOString().slice(0, 10));
  }, []);
  const [userFilter, setUserFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [err, setErr] = useState('');

  const load = () => {
    setLoading(true); setErr('');
    apiGet('/api/admin/worklog', { startDate, endDate, userId: userFilter, changeType: typeFilter })
      .then(d => setLogs(d.logs || []))
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const filtered = logs.filter(r =>
    (!userFilter || r.userId?.toLowerCase().includes(userFilter.toLowerCase())) &&
    (!typeFilter || r.category === typeFilter)
  );

  const handleExcel = () => {
    const rows = [['변경일자','사용자','카테고리','변경유형','차수','거래처/품목','변경항목','기준값','변경값','비고']];
    filtered.forEach(r => rows.push([r.changeDtm, r.userId, r.category, r.changeType, r.week, r.targetName, r.columName, r.beforeValue, r.afterValue, r.descr]));
    const csv = rows.map(r => r.map(v => `"${v||''}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF'+csv], {type:'text/csv'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `작업내역_${endDate}.csv`;
    a.click();
  };

  const categories = [...new Set(logs.map(r => r.category).filter(Boolean))];

  return (
    <div>
      <div className="filter-bar">
        <span className="filter-label">날짜</span>
        <input type="date" className="filter-input" value={startDate} onChange={e => setStartDate(e.target.value)} />
        <span style={{color:'var(--text3)'}}>~</span>
        <input type="date" className="filter-input" value={endDate} onChange={e => setEndDate(e.target.value)} />
        <span className="filter-label">사용자</span>
        <input className="filter-input" placeholder="계정 ID" value={userFilter} onChange={e => setUserFilter(e.target.value)} style={{width:100}} />
        <span className="filter-label">유형</span>
        <select className="filter-select" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">전체</option>
          {categories.map(c => <option key={c}>{c}</option>)}
        </select>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={load}>🔄 조회</button>
          <button className="btn" onClick={handleExcel}>📊 엑셀</button>
          <button className="btn" onClick={() => window.opener ? window.close() : history.back()}>✖️ 닫기</button>
        </div>
      </div>

      {err && <div className="banner-err">⚠️ {err}</div>}

      <div style={{padding:'4px 10px', background:'var(--header-bg)', border:'1px solid var(--border)', borderTop:'none', fontSize:12}}>
        조회 결과: <strong>{filtered.length}건</strong>
      </div>

      <div className="table-wrap">
        {loading ? <div className="skeleton" style={{height:400}}></div> : (
          <table className="tbl">
            <thead>
              <tr>
                <th style={{minWidth:140}}>변경일자</th>
                <th style={{minWidth:80}}>사용자</th>
                <th style={{minWidth:80}}>카테고리</th>
                <th style={{minWidth:80}}>변경유형</th>
                <th style={{minWidth:70}}>차수</th>
                <th style={{minWidth:180}}>거래처 / 품목</th>
                <th style={{minWidth:80}}>변경항목</th>
                <th style={{textAlign:'right', minWidth:70}}>기준값</th>
                <th style={{textAlign:'right', minWidth:70}}>변경값</th>
                <th>비고</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={10} style={{textAlign:'center', padding:40, color:'var(--text3)'}}>조회된 작업 내역이 없습니다</td></tr>
              ) : filtered.map((r, i) => (
                <tr key={i}>
                  <td style={{fontFamily:'var(--mono)', fontSize:11}}>{r.changeDtm}</td>
                  <td style={{fontWeight:'bold', fontSize:12}}>{r.userId}</td>
                  <td>
                    <span className={`badge ${TYPE_BADGE[r.category] || 'badge-gray'}`}>{r.category}</span>
                  </td>
                  <td style={{fontSize:11}}>{r.changeType}</td>
                  <td style={{fontFamily:'var(--mono)', fontWeight:'bold', fontSize:11}}>{r.week}</td>
                  <td style={{fontSize:12}}>{r.targetName}</td>
                  <td style={{fontSize:11, color:'var(--text3)'}}>{r.columName}</td>
                  <td className="num" style={{color:'var(--text3)'}}>{r.beforeValue}</td>
                  <td className="num" style={{fontWeight:'bold', color: r.changeType==='삭제'?'var(--red)':r.changeType==='신규'?'var(--green)':'var(--blue)'}}>{r.afterValue}</td>
                  <td style={{fontSize:11, color:'var(--text3)', maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{r.descr||'—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
