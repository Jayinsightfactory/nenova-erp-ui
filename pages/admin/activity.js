// pages/admin/activity.js
// 작업 내역 조회 화면
// 수정이력: 2026-03-30 — 초기 작성
// 재고변경, 주문변경, 출고변경 이력을 사용자별/카테고리별/날짜별로 조회

import { useState, useEffect } from 'react';
import { apiGet } from '../../lib/useApi';

const CATEGORY_MAP = {
  '재고': { color: '#996600', bg: '#FFF8E0', label: '재고' },
  '주문': { color: '#0066CC', bg: '#E8F0FF', label: '주문' },
  '출고': { color: '#006600', bg: '#EEFFEE', label: '출고' },
};

const TYPE_BADGE = {
  '신규':   { color: '#006600', bg: '#EEFFEE' },
  '수정':   { color: '#0066CC', bg: '#E8F0FF' },
  '삭제':   { color: '#CC0000', bg: '#FFEEEE' },
  '확정':   { color: '#5500AA', bg: '#F0EEFF' },
  '확정취소 / Cancelar':{ color: '#996600', bg: '#FFF8E0' },
  '재고조정':{ color: '#996600', bg: '#FFF8E0' },
  '입고':   { color: '#006600', bg: '#EEFFEE' },
};

export default function ActivityLog() {
  const [activities, setActivities] = useState([]);
  const [userList, setUserList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  // 필터
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  useEffect(() => {
    const d = new Date(); d.setDate(d.getDate() - 7);
    setStartDate(d.toISOString().slice(0, 10));
    setEndDate(new Date().toISOString().slice(0, 10));
  }, []);
  const [userFilter, setUserFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [search, setSearch] = useState('');

  const load = () => {
    setLoading(true); setErr('');
    apiGet('/api/admin/activity', {
      startDate, endDate,
      userId: userFilter,
      category: categoryFilter,
    })
      .then(d => {
        setActivities(d.activities || []);
        setUserList(d.userList || []);
      })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  // 추가 필터 (프론트)
  const filtered = activities.filter(r => {
    if (typeFilter && r.변경유형 !== typeFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      return r.품목명?.toLowerCase().includes(s) ||
             r.거래처명?.toLowerCase().includes(s) ||
             r.사용자?.toLowerCase().includes(s) ||
             r.비고?.toLowerCase().includes(s);
    }
    return true;
  });

  // 카테고리별 집계
  const stats = {};
  filtered.forEach(r => {
    stats[r.카테고리] = (stats[r.카테고리] || 0) + 1;
  });

  const handleExcel = () => {
    const rows = [['변경일시','사용자','카테고리','변경유형','차수','품목명','거래처명','변경항목','이전값','변경값','비고']];
    filtered.forEach(r => rows.push([r.변경일시,r.사용자,r.카테고리,r.변경유형,r.차수,r.품목명,r.거래처명,r.변경항목,r.이전값,r.변경값,r.비고]));
    const csv = rows.map(r => r.map(v => `"${v||''}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF'+csv], {type:'text/csv'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `작업내역_${endDate}.csv`;
    a.click();
  };

  return (
    <div>
      {/* 필터 바 */}
      <div className="filter-bar">
        <span className="filter-label">기간</span>
        <input type="date" className="filter-input" value={startDate} onChange={e => setStartDate(e.target.value)} />
        <span style={{color:'var(--text3)'}}>~</span>
        <input type="date" className="filter-input" value={endDate} onChange={e => setEndDate(e.target.value)} />

        <span className="filter-label">사용자</span>
        <select className="filter-select" value={userFilter} onChange={e => setUserFilter(e.target.value)} style={{minWidth:100}}>
          <option value="">전체</option>
          {userList.map(u => <option key={u}>{u}</option>)}
        </select>

        <span className="filter-label">카테고리</span>
        <select className="filter-select" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
          <option value="">전체</option>
          <option value="stock">재고</option>
          <option value="order">주문</option>
          <option value="shipment">출고</option>
        </select>

        <span className="filter-label">변경유형</span>
        <select className="filter-select" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">전체</option>
          {['신규','수정','삭제','확정','확정취소 / Cancelar','재고조정','입고'].map(t => <option key={t}>{t}</option>)}
        </select>

        <span className="filter-label">검색</span>
        <input className="filter-input" placeholder="품목명 / 거래처 / 사용자" value={search} onChange={e => setSearch(e.target.value)} style={{minWidth:160}} />

        <div className="page-actions">
          <button className="btn btn-primary" onClick={load}>🔄 조회 / Buscar</button>
          <button className="btn" onClick={handleExcel}>📊 엑셀 / Excel</button>
          <button className="btn" onClick={() => window.opener ? window.close() : history.back()}>✖️ 닫기 / Cerrar</button>
        </div>
      </div>

      {err && <div className="banner-err">⚠️ {err}</div>}

      {/* 카테고리별 집계 카드 */}
      <div style={{display:'flex', gap:8, marginBottom:8}}>
        {[
          { key:'재고', icon:'📦', label:'재고 변경' },
          { key:'주문', icon:'📋', label:'주문 변경' },
          { key:'출고', icon:'🚚', label:'출고 변경' },
        ].map(cat => {
          const c = CATEGORY_MAP[cat.key];
          return (
            <div key={cat.key}
              onClick={() => setCategoryFilter(categoryFilter === cat.key.toLowerCase() ? '' : cat.key === '재고' ? 'stock' : cat.key === '주문' ? 'order' : 'shipment')}
              style={{
                background: c.bg, border:`1px solid ${c.color}`,
                padding:'6px 14px', cursor:'pointer', fontSize:12,
                display:'flex', gap:8, alignItems:'center', minWidth:120,
              }}
            >
              <span>{cat.icon}</span>
              <div>
                <div style={{fontWeight:'bold', color:c.color}}>{cat.label}</div>
                <div style={{fontFamily:'var(--mono)', fontWeight:'bold', fontSize:16, color:c.color}}>
                  {stats[cat.key] || 0}건
                </div>
              </div>
            </div>
          );
        })}
        <div style={{background:'var(--header-bg)', border:'1px solid var(--border)', padding:'6px 14px', fontSize:12, display:'flex', gap:8, alignItems:'center', minWidth:120}}>
          <span>📊</span>
          <div>
            <div style={{fontWeight:'bold'}}>전체</div>
            <div style={{fontFamily:'var(--mono)', fontWeight:'bold', fontSize:16}}>{filtered.length}건</div>
          </div>
        </div>
      </div>

      {/* 작업내역 테이블 */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">■ 작업 내역 / Historial de actividades</span>
          <span style={{fontSize:11, color:'var(--text3)'}}>{filtered.length}건</span>
        </div>
        <div className="table-wrap" style={{border:'none'}}>
          {loading ? <div className="skeleton" style={{height:300, margin:12}}></div> : (
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{minWidth:140}}>변경일시</th>
                  <th style={{minWidth:80}}>사용자</th>
                  <th style={{minWidth:60}}>카테고리</th>
                  <th style={{minWidth:70}}>변경유형</th>
                  <th style={{minWidth:70}}>차수</th>
                  <th style={{minWidth:180}}>품목명</th>
                  <th style={{minWidth:120}}>거래처명</th>
                  <th style={{minWidth:80}}>변경항목</th>
                  <th style={{textAlign:'right', minWidth:70}}>이전값</th>
                  <th style={{textAlign:'right', minWidth:70}}>변경값</th>
                  <th style={{minWidth:160}}>비고</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={11} style={{textAlign:'center', padding:40, color:'var(--text3)'}}>
                      조회된 작업 내역이 없습니다
                    </td>
                  </tr>
                ) : filtered.map((r, i) => {
                  const cat = CATEGORY_MAP[r.카테고리] || {};
                  const typ = TYPE_BADGE[r.변경유형]  || {};
                  return (
                    <tr key={i}>
                      <td style={{fontFamily:'var(--mono)', fontSize:11}}>{r.변경일시}</td>
                      <td style={{fontWeight:'bold', fontSize:12}}>{r.사용자}</td>
                      <td>
                        <span style={{
                          display:'inline-block', padding:'1px 6px', fontSize:11,
                          background: cat.bg, color: cat.color,
                          border:`1px solid ${cat.color}`,
                        }}>
                          {r.카테고리}
                        </span>
                      </td>
                      <td>
                        <span style={{
                          display:'inline-block', padding:'1px 6px', fontSize:11,
                          background: typ.bg || '#F0F0F0',
                          color: typ.color || 'var(--text2)',
                          border:`1px solid ${typ.color || 'var(--border)'}`,
                        }}>
                          {r.변경유형}
                        </span>
                      </td>
                      <td style={{fontFamily:'var(--mono)', fontWeight:'bold', fontSize:11}}>{r.차수}</td>
                      <td style={{fontSize:12}}>{r.품목명 || '—'}</td>
                      <td style={{fontSize:12}}>{r.거래처명 || '—'}</td>
                      <td style={{fontSize:11, color:'var(--text3)'}}>{r.변경항목}</td>
                      <td className="num" style={{color:'var(--text3)'}}>{r.이전값}</td>
                      <td className="num" style={{
                        fontWeight:'bold',
                        color: r.변경유형 === '삭제' ? 'var(--red)'
                             : r.변경유형 === '신규' ? 'var(--green)'
                             : 'var(--blue)',
                      }}>
                        {r.변경값}
                      </td>
                      <td style={{fontSize:11, color:'var(--text3)'}}>{r.비고 || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
