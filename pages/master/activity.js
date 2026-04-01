// pages/master/activity.js
// 작업 내역 조회
// 수정이력: 2026-03-30 — 초기 작성
//   StockHistory + OrderHistory + ShipmentHistory 통합 조회
//   사용자별 / 유형별 / 기간별 필터

import { useState, useEffect } from 'react';
import { apiGet } from '../../lib/useApi';
import { useLang } from '../../lib/i18n';

const fmt = n => Number(n || 0).toLocaleString();

const TYPE_COLORS = {
  '입고':     'badge-blue',
  '출고':     'badge-green',
  '확정':     'badge-purple',
  '확정취소': 'badge-amber',
  '재고조정': 'badge-red',
  '주문신규': 'badge-green',
  '주문수정': 'badge-blue',
  '주문삭제': 'badge-red',
};

export default function Activity() {
  const { t } = useLang();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  // 필터
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [userId, setUserId] = useState('');
  const [changeType, setChangeType] = useState('');
  const [keyword, setKeyword] = useState('');

  // 사용자 목록 (드롭다운용)
  const [userList, setUserList] = useState([]);

  useEffect(() => {
    // 사용자 목록 로드
    apiGet('/api/master', { entity: 'users' })
      .then(d => setUserList(d.data || []))
      .catch(() => {});
  }, []);

  const load = () => {
    setLoading(true); setErr('');
    apiGet('/api/master/activity', { startDate, endDate, userId, changeType })
      .then(d => setLogs(d.logs || []))
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  // 키워드 필터 (클라이언트)
  const filtered = keyword
    ? logs.filter(r =>
        r.userId?.includes(keyword) ||
        r.changeType?.includes(keyword) ||
        r.prodName?.includes(keyword) ||
        r.descr?.includes(keyword)
      )
    : logs;

  const handleExcel = () => {
    const rows = [['변경일시','사용자','변경유형','차수','품목명','변경항목','이전값','변경값','비고']];
    filtered.forEach(r => rows.push([r.changeDtm, r.userId, r.changeType, r.week, r.prodName, r.columnName, r.before, r.after, r.descr]));
    const csv = rows.map(r => r.map(v => `"${v||''}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF'+csv], {type:'text/csv'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `작업내역_${endDate}.csv`; a.click();
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
        <select className="filter-select" value={userId} onChange={e => setUserId(e.target.value)} style={{minWidth:100}}>
          <option value="">전체</option>
          {userList.map(u => <option key={u.UserID} value={u.UserID}>{u.UserName} ({u.UserID})</option>)}
        </select>

        <span className="filter-label">유형</span>
        <select className="filter-select" value={changeType} onChange={e => setChangeType(e.target.value)} style={{minWidth:100}}>
          <option value="">전체</option>
          {['입고','출고','확정','확정취소','재고조정','주문신규','주문수정','주문삭제'].map(t => (
            <option key={t}>{t}</option>
          ))}
        </select>

        <span className="filter-label">검색</span>
        <input className="filter-input" placeholder="품목명 / 사용자 / 내용" value={keyword}
          onChange={e => setKeyword(e.target.value)} style={{minWidth:160}} />

        <div className="page-actions">
          <button className="btn btn-primary" onClick={load}>{t('조회')}</button>
          <button className="btn" onClick={handleExcel}>{t('엑셀')}</button>
          <button className="btn" onClick={() => window.opener ? window.close() : history.back()}>{t('닫기')}</button>
        </div>
      </div>

      {err && <div className="banner-err">⚠️ {err}</div>}

      {/* 요약 */}
      <div style={{padding:'4px 10px', background:'var(--header-bg)', border:'1px solid var(--border)', borderTop:'none', fontSize:12, display:'flex', gap:16}}>
        <span>전체: <strong>{filtered.length}건</strong></span>
        {['입고','출고','확정','재고조정'].map(t => {
          const cnt = filtered.filter(r => r.changeType === t).length;
          return cnt > 0 ? <span key={t}>{t}: <strong>{cnt}건</strong></span> : null;
        })}
      </div>

      {/* 테이블 */}
      <div className="table-wrap">
        {loading ? <div className="skeleton" style={{height:300}}></div> : (
          <table className="tbl">
            <thead>
              <tr>
                <th style={{minWidth:150}}>변경일시</th>
                <th style={{minWidth:80}}>사용자</th>
                <th style={{minWidth:80}}>변경유형</th>
                <th style={{minWidth:70}}>차수</th>
                <th style={{minWidth:200}}>품목명</th>
                <th style={{minWidth:70}}>변경항목</th>
                <th style={{textAlign:'right', minWidth:80}}>이전값</th>
                <th style={{textAlign:'right', minWidth:80}}>변경값</th>
                <th style={{minWidth:200}}>비고</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={9} style={{textAlign:'center', padding:40, color:'var(--text3)'}}>
                  작업 내역 없음
                </td></tr>
              ) : filtered.map((r, i) => (
                <tr key={i}>
                  <td style={{fontFamily:'var(--mono)', fontSize:11}}>{r.changeDtm}</td>
                  <td style={{fontWeight:'bold', fontSize:12}}>{r.userId}</td>
                  <td>
                    <span className={`badge ${TYPE_COLORS[r.changeType] || 'badge-gray'}`}>
                      {r.changeType}
                    </span>
                  </td>
                  <td style={{fontFamily:'var(--mono)', fontSize:11}}>{r.week}</td>
                  <td style={{fontSize:12}}>{r.prodName}</td>
                  <td style={{fontSize:11, color:'var(--text3)'}}>{r.columnName}</td>
                  <td className="num" style={{color:'var(--text3)'}}>{r.before}</td>
                  <td className="num" style={{fontWeight:'bold',
                    color: r.changeType === '재고조정' || r.changeType === '출고' ? 'var(--red)' : 'var(--blue)'
                  }}>{r.after}</td>
                  <td style={{fontSize:11, color:'var(--text3)'}}>{r.descr}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
