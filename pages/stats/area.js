import { useState, useEffect } from 'react';
import { useWeekInput, getCurrentWeek, WeekInput } from '../../lib/useWeekInput';
import { apiGet } from '../../lib/useApi';
import { useLang } from '../../lib/i18n';

const fmt = n => Number(n || 0).toLocaleString();
const gc = g => g >= 0 ? 'var(--green)' : 'var(--red)';
const growth = (cur, prev) => prev ? (((cur - prev) / prev) * 100).toFixed(2) : 0;

export default function AreaSales() {
  const { t } = useLang();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const weekInput = useWeekInput('');
  const [err, setErr] = useState('');

  const load = () => {
    setLoading(true);
    apiGet('/api/stats/sales', { type: 'area', week: weekInput.value })
      .then(d => { setData(d); setErr(''); })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (weekInput.value) load(); }, [weekInput.value]);

  const byArea = data?.byArea || [];
  const allWeeks = data?.allWeeks || [];
  const totalCur = byArea.reduce((a, b) => a + (b.curSales || 0), 0);
  const totalPrev = byArea.reduce((a, b) => a + (b.prevSales || 0), 0);
  const weekList = [...new Set(allWeeks.map(r => r.week))];
  const areaList = [...new Set(allWeeks.map(r => r.area))];

  return (
    <div>
      <div className="filter-bar">
        <WeekInput weekInput={weekInput} label="차수" />
        <div className="page-actions">
          <button className="btn btn-primary" onClick={load}>{t('조회')}</button>
          <button className="btn btn-secondary">{t('엑셀')}</button>
        </div>
      </div>
      {err && <div style={{ padding: '10px 14px', background: 'var(--red-bg)', color: 'var(--red)', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>⚠️ {err}</div>}
      {loading ? <div className="skeleton" style={{ height: 300, borderRadius: 12 }}></div> : (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header"><span className="card-title">[{data?.curWeek}] 지역별 판매액 비교</span><span style={{ fontSize: 12, color: 'var(--text3)' }}>vs 전차수: {data?.prevWeek}</span></div>
            <table className="tbl">
              <thead><tr><th>지역</th><th style={{ textAlign: 'right' }}>현재 차수</th><th style={{ textAlign: 'right' }}>전 차수</th><th style={{ textAlign: 'right' }}>증감률</th></tr></thead>
              <tbody>
                {byArea.map(r => {
                  const g = growth(r.curSales, r.prevSales);
                  return <tr key={r.area}><td><span className="badge badge-blue">{r.area}</span></td><td className="num">{fmt(r.curSales)}</td><td className="num" style={{ color: 'var(--text3)' }}>{fmt(r.prevSales)}</td><td className="num" style={{ color: gc(g), fontWeight: 700 }}>{g >= 0 ? '▲' : '▼'} {Math.abs(g)}%</td></tr>;
                })}
              </tbody>
              <tfoot><tr className="foot"><td>합계</td><td className="num">{fmt(totalCur)}</td><td className="num">{fmt(totalPrev)}</td><td className="num" style={{ color: gc(growth(totalCur, totalPrev)) }}>{growth(totalCur, totalPrev)}%</td></tr></tfoot>
            </table>
          </div>
          <div className="card">
            <div className="card-header"><span className="card-title">지역별 판매액 비교 (전체차수)</span></div>
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl" style={{ minWidth: 900 }}>
                <thead><tr><th>지역</th>{weekList.map(w => <th key={w} style={{ textAlign: 'right', fontFamily: 'var(--mono)', minWidth: 90, fontSize: 10 }}>{w}</th>)}</tr></thead>
                <tbody>
                  {areaList.map(area => (
                    <tr key={area}>
                      <td><span className="badge badge-blue">{area}</span></td>
                      {weekList.map(w => {
                        const item = allWeeks.find(r => r.area === area && r.week === w);
                        return <td key={w} className="num" style={{ fontSize: 11 }}>{item ? fmt(item.sales) : ''}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
