// pages/m/index.js — 모바일 홈 (버튼 선택형 메뉴 + KPI)
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import MobileShell from '../../components/m/MobileShell';

const MENU = [
  { icon: '📋', label: '주문',   href: '/m/orders',    color: '#3182CE' },
  { icon: '🚚', label: '출고',   href: '/m/shipment',  color: '#38A169' },
  { icon: '📄', label: '견적서', href: '/m/estimate',  color: '#D69E2E' },
  { icon: '📦', label: '재고',   href: '/m/stock',     color: '#E53E3E' },
  { icon: '💰', label: '매출',   href: '/m/sales',     color: '#805AD5' },
  { icon: '👥', label: '거래처', href: '/m/customers', color: '#DD6B20' },
];

export default function MobileHome() {
  const router = useRouter();
  const [me, setMe] = useState(null);
  const [kpi, setKpi] = useState(null);

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (d?.success && d?.user) setMe(d.user);
      else router.replace('/m/login?next=/m');
    }).catch(() => router.replace('/m/login?next=/m'));
  }, [router]);

  // KPI 데이터 (bizContext API)
  useEffect(() => {
    fetch('/api/m/biz').then(r => r.json()).then(d => {
      if (d?.success) setKpi(d);
    }).catch(() => {});
  }, []);

  if (!me) return <div style={{ display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',color:'#666' }}>로딩 중...</div>;

  const latestWeek = kpi?.recentMajorWeeks?.[0] || '?';
  const shipStats = kpi?.shipmentStats || {};
  const topCust = kpi?.topCustomers?.slice(0, 3) || [];
  const fmtN = n => Number(n || 0).toLocaleString();

  return (
    <MobileShell title="네노바 ERP" back={false} user={me}>
      <Head><title>네노바 모바일</title></Head>

      <div className="mh-wrap">
        {/* 메인 메뉴 — 2×3 버튼 그리드 */}
        <div className="mh-grid">
          {MENU.map(m => (
            <button
              key={m.href}
              className="mh-btn"
              style={{ borderLeft: `4px solid ${m.color}` }}
              onClick={() => router.push(m.href)}
            >
              <span className="mh-btn-icon">{m.icon}</span>
              <span className="mh-btn-label">{m.label}</span>
              <span className="mh-btn-kpi">
                {m.label === '주문' && kpi ? `${latestWeek}차` : ''}
                {m.label === '출고' && shipStats.fixRate != null ? `${shipStats.fixRate}% 확정` : ''}
                {m.label === '재고' ? '' : ''}
                {m.label === '매출' && kpi?.monthlyTopCust?.[0] ? `${fmtN(Math.round((kpi.monthlyTopCust.reduce((s,c) => s + (c.Amt||0), 0))/10000))}만원` : ''}
              </span>
            </button>
          ))}
        </div>

        {/* 빠른 접근 */}
        <div className="mh-quick">
          <div className="mh-section-title">빠른 접근</div>
          <button className="mh-quick-btn" onClick={() => router.push(`/m/orders?week=${latestWeek}`)}>
            📋 {latestWeek}차 주문 전체
          </button>
          <button className="mh-quick-btn" onClick={() => router.push('/m/shipment?tab=today')}>
            🚚 오늘 출고 확정
          </button>
          <button className="mh-quick-btn" onClick={() => router.push('/m/chat')}>
            💬 챗봇에 물어보기
          </button>
        </div>

        {/* 최근 주요 거래처 */}
        {topCust.length > 0 && (
          <div className="mh-recent">
            <div className="mh-section-title">{latestWeek}차 주문 TOP 거래처</div>
            {topCust.map((c, i) => (
              <div key={i} className="mh-recent-row">
                <span className="mh-rank">{i + 1}</span>
                <span className="mh-cname">{c.CustName}</span>
                <span className="mh-cqty">{fmtN(c.TotalQty)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <style jsx>{`
        .mh-wrap { padding: 16px 12px; }
        .mh-grid {
          display: grid; grid-template-columns: 1fr 1fr;
          gap: 10px; margin-bottom: 20px;
        }
        .mh-btn {
          display: flex; flex-direction: column; align-items: flex-start;
          gap: 4px; padding: 14px 12px;
          background: white; border: 1px solid #E2E8F0;
          border-radius: 12px; cursor: pointer;
          text-align: left; min-height: 72px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.06);
          font-family: inherit;
        }
        .mh-btn:active { background: #F7FAFC; transform: scale(0.98); }
        .mh-btn-icon { font-size: 24px; }
        .mh-btn-label { font-size: 14px; font-weight: 700; color: #1A202C; }
        .mh-btn-kpi { font-size: 11px; color: #718096; }

        .mh-section-title {
          font-size: 13px; font-weight: 700; color: #4A5568;
          margin-bottom: 8px;
        }
        .mh-quick { margin-bottom: 20px; }
        .mh-quick-btn {
          display: block; width: 100%;
          padding: 12px 14px; margin-bottom: 6px;
          background: white; border: 1px solid #E2E8F0;
          border-radius: 10px; font-size: 14px; color: #2D3748;
          text-align: left; cursor: pointer;
          min-height: 48px; font-family: inherit;
        }
        .mh-quick-btn:active { background: #EDF2F7; }

        .mh-recent { margin-bottom: 20px; }
        .mh-recent-row {
          display: flex; align-items: center; gap: 10px;
          padding: 10px 12px; margin-bottom: 4px;
          background: white; border-radius: 8px;
          border: 1px solid #E2E8F0;
        }
        .mh-rank {
          width: 24px; height: 24px;
          display: flex; align-items: center; justify-content: center;
          background: #EDF2F7; border-radius: 50%;
          font-size: 12px; font-weight: 700; color: #4A5568;
        }
        .mh-cname { flex: 1; font-size: 13px; font-weight: 600; color: #1A202C; }
        .mh-cqty { font-size: 13px; font-weight: 700; color: #2b6cb0; }
      `}</style>
    </MobileShell>
  );
}
