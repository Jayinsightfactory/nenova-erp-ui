import { useState, useEffect } from 'react';
import { useWeekInput } from '../../lib/useWeekInput';
import { apiGet } from '../../lib/useApi';
import { useLang } from '../../lib/i18n';

const typeBadge = t => t === '신규' ? 'badge-green' : t === '수정' ? 'badge-blue' : 'badge-red';

export default function ShipmentHistory() {
  const { t } = useLang();
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [search, setSearch] = useState('');
  const [err, setErr] = useState('');

  const load = () => {
    setLoading(true);
    apiGet('/api/shipment/history', { startDate, endDate, search })
      .then(d => { setHistory(d.history || []); setErr(''); })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const d = new Date();
    setEndDate(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() - 7);
    setStartDate(d.toISOString().slice(0, 10));
  }, []);

  useEffect(() => { if (startDate && endDate) load(); }, [startDate, endDate]);

  return (
    <div>
      <div className="filter-bar">
        <span className="filter-label">변경일자</span>
        <input type="date" className="filter-input" value={startDate} onChange={e => setStartDate(e.target.value)} />
        <span style={{ color: 'var(--text3)' }}>~</span>
        <input type="date" className="filter-input" value={endDate} onChange={e => setEndDate(e.target.value)} />
        <span className="filter-label">검색</span>
        <input className="filter-input" placeholder="품목명 / 거래처명" value={search} onChange={e => setSearch(e.target.value)} style={{ minWidth: 160 }} />
        <div className="page-actions">
          <button className="btn btn-primary" onClick={load}>🔄 조회 / Buscar</button>
          <button className="btn btn-secondary">📊 엑셀 / Excel</button>
        </div>
      </div>
      {err && <div style={{ padding: '10px 14px', background: 'var(--red-bg)', color: 'var(--red)', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>⚠️ {err}</div>}
      <div className="card">
        <div className="card-header">
          <span className="card-title">출고 변경 내역 목록</span>
          <span style={{ fontSize: 12, color: 'var(--text3)' }}>{history.length}건</span>
        </div>
        <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
          {loading ? <div className="skeleton" style={{ margin: 16, height: 300, borderRadius: 8 }}></div> : (
            <table className="tbl">
              <thead>
                <tr><th>변경일자</th><th>차수</th><th>거래처명</th><th>국가</th><th>꽃</th><th>품목명</th><th>변경유형</th><th>출고일자</th><th style={{ textAlign: 'right' }}>기준값</th><th style={{ textAlign: 'right' }}>변경값</th><th>비고</th></tr>
              </thead>
              <tbody>
                {history.length === 0 ? (
                  <tr><td colSpan={11} style={{ textAlign: 'center', padding: 32, color: 'var(--text3)' }}>조회 조건을 입력 후 조회하세요</td></tr>
                ) : history.map((r, i) => (
                  <tr key={i}>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{r.ChangeDtm}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontWeight: 700 }}>{r.week}</td>
                    <td className="name">{r.CustName}</td>
                    <td><span className="badge badge-gray">{r.country}</span></td>
                    <td style={{ fontSize: 12 }}>{r.flower}</td>
                    <td style={{ fontSize: 12 }}>{r.name}</td>
                    <td><span className={`badge ${typeBadge(r.type)}`}>{r.type}</span></td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{r.outDate}</td>
                    <td className="num" style={{ color: 'var(--text3)' }}>{r.before}</td>
                    <td className="num" style={{ fontWeight: 700, color: r.type === '삭제' ? 'var(--red)' : r.type === '신규' ? 'var(--green)' : 'var(--blue)' }}>{r.after}</td>
                    <td style={{ fontSize: 12, color: 'var(--text3)' }}>{r.Descr || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
