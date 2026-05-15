import { useState, useEffect } from 'react';
import Link from 'next/link';
import { apiGet } from '../lib/useApi';
import { useLang } from '../lib/i18n';

const fmt = n => Number(n || 0).toLocaleString();

export default function Dashboard() {
  const { t } = useLang();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    apiGet('/api/stats/dashboard')
      .then(d => setData(d))
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  const kpi = data?.kpi || {};
  const salesByArea = data?.salesByArea || [];
  const topCustomers = data?.topCustomers || [];

  if (loading) return <div className="skeleton" style={{ height: 200 }}></div>;

  return (
    <div>
      {err && <div className="banner-err">⚠️ DB 연결 오류: {err}</div>}

      <div className="banner-info">
        실시간 DB 연결됨 — {data?.week} 차수 ({data?.year}) | 조회/등록: 실제 전산 DB
      </div>

      {/* KPI 요약 */}
      <div className="kpi-grid" style={{ marginBottom: 6 }}>
        <div className="kpi-card">
          <div className="kpi-label">이번 차수 매출</div>
          <div className="kpi-value" style={{ color: '#0066CC' }}>{fmt(kpi.totalSales)}</div>
          <div className="kpi-sub">{kpi.custCount}개 거래처</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">이번 차수 주문</div>
          <div className="kpi-value">{fmt(kpi.orderCount)}건</div>
          <div className="kpi-sub">총 {fmt(kpi.totalQty)} 수량</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">재고 부족 품목</div>
          <div className="kpi-value" style={{ color: '#CC0000' }}>{fmt(kpi.lowStockCount)}</div>
          <div className="kpi-sub">10개 미만</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">미확정 출고</div>
          <div className="kpi-value" style={{ color: '#996600' }}>{fmt(kpi.unfixedCount)}건</div>
          <div className="kpi-sub">확정 대기</div>
        </div>
      </div>

      <div className="grid-2" style={{ gap: 4, marginBottom: 6 }}>
        {/* 지역별 매출 */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">■ 지역별 매출 현황</span>
            <Link href="/stats/area" style={{ fontSize: 11, color: 'var(--blue)', marginLeft: 'auto' }}>상세 조회 →</Link>
          </div>
          <table className="tbl">
            <thead><tr><th>지역</th><th style={{ textAlign: 'right' }}>매출</th></tr></thead>
            <tbody>
              {salesByArea.length === 0
                ? <tr><td colSpan={2} style={{ textAlign: 'center', padding: 20, color: 'var(--text3)' }}>데이터 없음</td></tr>
                : salesByArea.map(r => (
                  <tr key={r.area}>
                    <td>{r.area}</td>
                    <td className="num">{fmt(r.curSales)}</td>
                  </tr>
                ))}
            </tbody>
            <tfoot>
              <tr><td>합계</td><td className="num">{fmt(salesByArea.reduce((a,b)=>a+b.curSales,0))}</td></tr>
            </tfoot>
          </table>
        </div>

        {/* TOP 거래처 */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">■ 거래처 매출 TOP 5</span>
          </div>
          <table className="tbl">
            <thead><tr><th>#</th><th>거래처</th><th>지역</th><th style={{ textAlign: 'right' }}>매출</th></tr></thead>
            <tbody>
              {topCustomers.length === 0
                ? <tr><td colSpan={4} style={{ textAlign: 'center', padding: 20, color: 'var(--text3)' }}>데이터 없음</td></tr>
                : topCustomers.map((c, i) => (
                  <tr key={c.CustName}>
                    <td style={{ fontWeight: 'bold' }}>{i + 1}</td>
                    <td>{c.CustName}</td>
                    <td>{c.CustArea}</td>
                    <td className="num">{fmt(c.sales)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 빠른 이동 */}
      <div className="card">
        <div className="card-header"><span className="card-title">■ 빠른 이동</span></div>
        <div style={{ padding: '8px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[
            { href: '/orders/new',           label: '주문 등록' },
            { href: '/shipment/distribute',  label: '출고 분배' },
            { href: '/stock',                label: '재고 관리' },
            { href: '/estimate',             label: '견적서 관리' },
            { href: '/stats/monthly',        label: '월별 판매' },
            { href: '/master/customers',     label: '거래처 관리' },
          ].map(item => (
            <Link key={item.href} href={item.href} style={{display:"inline-flex",alignItems:"center",height:24,padding:"0 10px",fontSize:12,border:"1px solid var(--border2)",background:"#E0E0E0",color:"var(--text1)",textDecoration:"none",cursor:"pointer"}}>{item.label}</Link>
          ))}
        </div>
      </div>
    </div>
  );
}
