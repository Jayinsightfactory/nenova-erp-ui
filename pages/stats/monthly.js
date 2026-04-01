import { useState, useEffect } from 'react';
import { apiGet } from '../../lib/useApi';
import { useLang } from '../../lib/i18n';

const fmt = n => Number(n || 0).toLocaleString();
const fmtW = n => (Number(n || 0) / 10000).toFixed(0) + '만';
const gc = g => g >= 0 ? 'var(--green)' : 'var(--red)';
const growth = (cur, prev) => prev ? (((cur - prev) / prev) * 100).toFixed(1) : 0;

export default function MonthlySales() {
  const { t } = useLang();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState('current');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [err, setErr] = useState('');

  const load = () => {
    setLoading(true);
    const now = new Date(date);
    apiGet('/api/stats/sales', { type: 'monthly', month: now.getMonth() + 1, year: now.getFullYear() })
      .then(d => { setData(d); setErr(''); })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  if (loading) return <div className="skeleton" style={{ height: 400, borderRadius: 12 }}></div>;

  const byProduct = data?.byProduct || [];
  const byCustomer = data?.byCustomer || [];
  const byArea = data?.byArea || [];
  const byManager = data?.byManager || [];

  return (
    <div>
      <div className="filter-bar">
        <span className="filter-label">기간</span>
        {[['current', '당월'], ['prev', '전월'], ['select', '선택']].map(([v, l]) => (
          <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, cursor: 'pointer' }}>
            <input type="radio" name="mode" checked={mode === v} onChange={() => setMode(v)} /> {l}
          </label>
        ))}
        <input type="date" className="filter-input" value={date} onChange={e => setDate(e.target.value)} />
        <div className="page-actions">
          <button className="btn btn-primary" onClick={load}>{t('조회')}</button>
          <button className="btn btn-secondary">{t('엑셀')}</button>
        </div>
      </div>
      {err && <div style={{ padding: '10px 14px', background: 'var(--red-bg)', color: 'var(--red)', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>⚠️ {err}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><span className="card-title">[{data?.month}]월 품목별 판매 현황</span></div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead><tr><th>품목명</th><th style={{ textAlign: 'right' }}>판매량</th><th style={{ textAlign: 'right' }}>판매금액</th><th style={{ textAlign: 'right' }}>전월 판매금액</th><th style={{ textAlign: 'right' }}>증감률</th></tr></thead>
            <tbody>
              {byProduct.map(r => {
                const g = growth(r.curSales, r.prevSales);
                return (
                  <tr key={r.prodName}>
                    <td className="name">{r.prodName}</td>
                    <td className="num">{fmt(r.qty)}</td>
                    <td className="num">{fmt(r.curSales)}</td>
                    <td className="num" style={{ color: 'var(--text3)' }}>{fmt(r.prevSales)}</td>
                    <td className="num" style={{ color: gc(g), fontWeight: 700 }}>{g >= 0 ? '▲' : '▼'} {Math.abs(g)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid-2" style={{ gap: 16 }}>
        <div className="card">
          <div className="card-header"><span className="card-title">[{data?.month}]월 거래처별 판매 현황</span></div>
          <table className="tbl">
            <thead><tr><th>#</th><th>지역</th><th>거래처명</th><th style={{ textAlign: 'right' }}>판매금액</th><th style={{ textAlign: 'right' }}>전월</th><th style={{ textAlign: 'right' }}>증감률</th></tr></thead>
            <tbody>
              {byCustomer.map((c, i) => {
                const g = growth(c.curSales, c.prevSales);
                return (
                  <tr key={c.CustName}>
                    <td style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: i < 3 ? 'var(--amber)' : 'var(--text3)' }}>{i + 1}</td>
                    <td><span className="badge badge-gray" style={{ fontSize: 10 }}>{c.area}</span></td>
                    <td style={{ fontSize: 12 }}>{c.CustName}</td>
                    <td className="num">{fmtW(c.curSales)}</td>
                    <td className="num" style={{ color: 'var(--text3)', fontSize: 11 }}>{fmtW(c.prevSales)}</td>
                    <td className="num" style={{ color: gc(g), fontSize: 11 }}>{g >= 0 ? '+' : ''}{g}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <div className="card-header"><span className="card-title">[{data?.month}]월 지역별 판매</span></div>
            <table className="tbl">
              <thead><tr><th>지역</th><th style={{ textAlign: 'right' }}>판매금액</th><th style={{ textAlign: 'right' }}>전월</th><th style={{ textAlign: 'right' }}>증감률</th></tr></thead>
              <tbody>
                {byArea.map(r => {
                  const g = growth(r.curSales, r.prevSales);
                  return <tr key={r.area}><td><span className="badge badge-blue">{r.area}</span></td><td className="num">{fmtW(r.curSales)}</td><td className="num" style={{ color: 'var(--text3)' }}>{fmtW(r.prevSales)}</td><td className="num" style={{ color: gc(g), fontWeight: 700 }}>{g >= 0 ? '▲' : '▼'} {Math.abs(g)}%</td></tr>;
                })}
              </tbody>
            </table>
          </div>
          <div className="card">
            <div className="card-header"><span className="card-title">[{data?.month}]월 담당자별 판매</span></div>
            <table className="tbl">
              <thead><tr><th>담당자</th><th style={{ textAlign: 'right' }}>판매 금액</th><th style={{ textAlign: 'right' }}>전월</th><th style={{ textAlign: 'right' }}>증감률</th></tr></thead>
              <tbody>
                {byManager.map(m => {
                  const g = growth(m.curSales, m.prevSales);
                  return <tr key={m.Manager}><td className="name">{m.Manager}</td><td className="num">{fmtW(m.curSales)}</td><td className="num" style={{ color: 'var(--text3)' }}>{fmtW(m.prevSales)}</td><td className="num" style={{ color: gc(g), fontWeight: 700 }}>{g >= 0 ? '+' : ''}{g}%</td></tr>;
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
