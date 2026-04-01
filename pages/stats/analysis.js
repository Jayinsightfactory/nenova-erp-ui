import { useState, useEffect } from 'react';
import { getCurrentWeek } from '../../lib/useWeekInput';
import { apiGet } from '../../lib/useApi';
import { useLang } from '../../lib/i18n';

const fmt = n => Number(n || 0).toLocaleString();

export default function SalesAnalysis() {
  const { t } = useLang();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [week, setWeek] = useState('');
  const [err, setErr] = useState('');

  const load = () => {
    setLoading(true);
    apiGet('/api/stats/sales', { type: 'analysis', week })
      .then(d => { setData(d); setErr(''); })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { setWeek(getCurrentWeek()); }, []);

  useEffect(() => { if (week) load(); }, [week]);

  if (loading) return <div className="skeleton" style={{height:400,borderRadius:12}}></div>;

  const sales = data?.sales || {};
  const defects = data?.defects || [];
  const byFlower = data?.byFlower || [];
  const trend = data?.trend || [];
  const gc = g => parseFloat(g) >= 0 ? 'var(--green)' : 'var(--red)';
  const growth = (cur, prev) => prev ? (((cur-prev)/prev)*100).toFixed(1) : 0;

  const defectMap = {};
  defects.forEach(d => { defectMap[d.EstimateType] = d; });
  const totalDefect = defects.reduce((a,b)=>a+(b.curAmount||0),0);
  const prevDefect = defects.reduce((a,b)=>a+(b.prevAmount||0),0);

  return (
    <div>
      <div className="filter-bar">
        <span className="filter-label">차수</span>
        <input className="filter-input" placeholder="빈칸=최신" value={week} onChange={e=>setWeek(e.target.value)} style={{width:100}} />
        <div className="page-actions">
          <button className="btn btn-primary" onClick={load}>{t('조회')}</button>
          <button className="btn btn-secondary">{t('엑셀')}</button>
        </div>
      </div>
      {err && <div style={{padding:'8px 14px',background:'var(--red-bg)',color:'var(--red)',borderRadius:8,marginBottom:10,fontSize:13}}>⚠️ {err}</div>}

      <div style={{padding:'8px 14px',background:'var(--blue-bg)',color:'var(--blue)',borderRadius:8,marginBottom:14,fontSize:12}}>
        📊 현재 차수: <strong>{data?.curWeek}</strong> · 비교 차수: <strong>{data?.prevWeek}</strong>
      </div>

      <div className="grid-2" style={{gap:14,marginBottom:14}}>
        <div className="card">
          <div className="card-header"><span className="card-title">[{data?.curWeek}] 매출액</span></div>
          <table className="tbl">
            <thead><tr><th>항목</th><th style={{textAlign:'right'}}>현재차수</th><th style={{textAlign:'right'}}>전차수</th></tr></thead>
            <tbody>
              <tr><td className="name">매출액</td><td className="num" style={{color:'var(--blue)',fontWeight:700}}>{fmt(sales.curSales)}</td><td className="num" style={{color:'var(--text3)'}}>{fmt(sales.prevSales)}</td></tr>
            </tbody>
            <tfoot><tr className="foot"><td>합계</td><td className="num">{fmt(sales.curSales)}</td><td className="num">{fmt(sales.prevSales)}</td></tr></tfoot>
          </table>
        </div>
        <div className="card">
          <div className="card-header"><span className="card-title">[{data?.curWeek}] 품목별 매출액</span></div>
          <div style={{overflowX:'auto'}}>
            <table className="tbl" style={{minWidth:500}}>
              <thead><tr><th>꽃 종류</th><th style={{textAlign:'right'}}>매출액</th></tr></thead>
              <tbody>
                {byFlower.map(f => <tr key={f.FlowerName}><td><span className="badge badge-purple">{f.FlowerName}</span></td><td className="num">{fmt(f.curSales)}</td></tr>)}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="grid-2" style={{gap:14,marginBottom:14}}>
        <div className="card">
          <div className="card-header"><span className="card-title">[{data?.curWeek}] 불량차감 상세</span></div>
          <table className="tbl">
            <thead><tr><th>항목</th><th style={{textAlign:'right'}}>현재차수</th><th style={{textAlign:'right'}}>전차수</th></tr></thead>
            <tbody>
              <tr><td>매출액</td><td className="num" style={{color:'var(--blue)'}}>{fmt(sales.curSales)}</td><td className="num" style={{color:'var(--text3)'}}>{fmt(sales.prevSales)}</td></tr>
              {defects.map(d => <tr key={d.EstimateType}><td style={{fontSize:12}}>{d.EstimateType}</td><td className="num" style={{color:'var(--red)'}}>{fmt(d.curAmount)}</td><td className="num" style={{color:'var(--text3)'}}>{fmt(d.prevAmount)}</td></tr>)}
            </tbody>
            <tfoot>
              <tr className="foot"><td>Grand Total</td>
                <td className="num">{fmt((sales.curSales||0)+totalDefect)}</td>
                <td className="num">{fmt((sales.prevSales||0)+prevDefect)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="card">
          <div className="card-header"><span className="card-title">전체차수 매출 추이</span></div>
          <div style={{overflowX:'auto'}}>
            <table className="tbl" style={{minWidth:600}}>
              <thead><tr><th style={{minWidth:80}}>차수</th><th style={{textAlign:'right'}}>매출액</th></tr></thead>
              <tbody>
                {trend.map(t => <tr key={t.week}><td style={{fontFamily:'var(--mono)',fontWeight:700}}>{t.week}</td><td className="num">{fmt(t.sales)}</td></tr>)}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
