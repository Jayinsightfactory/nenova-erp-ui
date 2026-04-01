import { useState, useEffect } from 'react';
import { useWeekInput, getCurrentWeek, WeekInput } from '../../lib/useWeekInput';
import { apiGet } from '../../lib/useApi';
import { useLang } from '../../lib/i18n';

const fmt = n => Number(n || 0).toLocaleString();
const gc = g => g >= 0 ? 'var(--green)' : 'var(--red)';
const growth = (cur, prev) => prev ? (((cur - prev) / prev) * 100).toFixed(2) : 0;

export default function SalesManager() {
  const { t } = useLang();
  const [data, setData] = useState([]);
  const [curWeek, setCurWeek] = useState('');
  const [prevWeek, setPrevWeek] = useState('');
  const [loading, setLoading] = useState(true);
  const weekInput = useWeekInput('');
  const [managerFilter, setManagerFilter] = useState('');
  const [areaFilter, setAreaFilter] = useState('');
  const [err, setErr] = useState('');

  const load = () => {
    setLoading(true);
    apiGet('/api/stats/sales', { type: 'manager', week: weekInput.value, manager: managerFilter, area: areaFilter })
      .then(d => { setData(d.data || []); setCurWeek(d.curWeek); setPrevWeek(d.prevWeek); setErr(''); })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (weekInput.value) load(); }, [weekInput.value]);

  const totalCur = data.reduce((a, b) => a + (b.curSales || 0), 0);
  const totalPrev = data.reduce((a, b) => a + (b.prevSales || 0), 0);
  const managers = [...new Set(data.map(r => r.manager).filter(Boolean))];

  return (
    <div>
      <div className="filter-bar">
        <WeekInput weekInput={weekInput} label="차수" />
        <span className="filter-label">담당자</span>
        <select className="filter-select" value={managerFilter} onChange={e => setManagerFilter(e.target.value)}>
          <option value="">전체</option>
          {managers.map(m => <option key={m}>{m}</option>)}
        </select>
        <span className="filter-label">지역</span>
        <select className="filter-select" value={areaFilter} onChange={e => setAreaFilter(e.target.value)}>
          <option value="">전체</option>
          <option>경부선</option><option>양재동</option><option>지방</option><option>호남선</option>
        </select>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={load}>{t('조회')}</button>
          <button className="btn btn-secondary">{t('엑셀')}</button>
        </div>
      </div>
      {err && <div style={{ padding: '10px 14px', background: 'var(--red-bg)', color: 'var(--red)', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>⚠️ {err}</div>}
      <div className="card">
        <div className="card-header">
          <span className="card-title">[{curWeek}] 지역별 담당자 실적</span>
          <span style={{ fontSize: 12, color: 'var(--text3)' }}>vs {prevWeek}</span>
        </div>
        {loading ? <div className="skeleton" style={{ margin: 16, height: 300, borderRadius: 8 }}></div> : (
          <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
            <table className="tbl">
              <thead><tr><th>지역</th><th>담당자</th><th>거래처명</th><th style={{ textAlign: 'right' }}>현재 차수</th><th style={{ textAlign: 'right' }}>전 차수</th><th style={{ textAlign: 'right' }}>증감률</th></tr></thead>
              <tbody>
                {data.map((r, i) => {
                  const g = growth(r.curSales, r.prevSales);
                  return <tr key={i}><td><span className="badge badge-blue">{r.area}</span></td><td style={{ fontWeight: 600, fontSize: 12 }}>{r.manager}</td><td className="name">{r.CustName}</td><td className="num">{fmt(r.curSales)}</td><td className="num" style={{ color: 'var(--text3)' }}>{fmt(r.prevSales)}</td><td className="num" style={{ color: gc(g), fontWeight: 700 }}>{g >= 0 ? '+' : ''}{g}%</td></tr>;
                })}
              </tbody>
              <tfoot><tr className="foot"><td colSpan={3}>합계</td><td className="num">{fmt(totalCur)}</td><td className="num">{fmt(totalPrev)}</td><td className="num" style={{ color: gc(growth(totalCur, totalPrev)) }}>{growth(totalCur, totalPrev)}%</td></tr></tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
