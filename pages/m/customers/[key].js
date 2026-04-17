// pages/m/customers/[key].js — 모바일 거래처 상세
// 거래처 정보 + 탭: 주문이력 / 단가 / 미수금
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import MobileShell from '../../../components/m/MobileShell';

const DETAIL_TABS = [
  { key: 'orders', label: '주문이력' },
  { key: 'price', label: '단가' },
  { key: 'ar', label: '미수금' },
];

export default function MobileCustomerDetail() {
  const router = useRouter();
  const { key } = router.query;
  const [me, setMe] = useState(null);
  const [cust, setCust] = useState(null);
  const [tab, setTab] = useState('orders');
  const [orders, setOrders] = useState([]);
  const [prices, setPrices] = useState([]);
  const [ar, setAr] = useState(null);
  const [loading, setLoading] = useState(false);

  // 인증
  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (d?.success && d?.user) setMe(d.user);
      else router.replace('/m/login');
    }).catch(() => router.replace('/m/login'));
  }, [router]);

  // 거래처 정보 로드
  useEffect(() => {
    if (!key || !me) return;
    fetch('/api/customers/search')
      .then(r => r.json())
      .then(d => {
        if (d?.success && d?.customers) {
          const found = d.customers.find(c => String(c.CustKey) === String(key));
          if (found) setCust(found);
        }
      })
      .catch(() => {});
  }, [key, me]);

  // 탭별 데이터 로드
  useEffect(() => {
    if (!key || !me) return;
    setLoading(true);

    if (tab === 'orders') {
      fetch(`/api/orders/history?custKey=${key}`)
        .then(r => r.json())
        .then(d => {
          if (d?.success) setOrders(d.orders || d.history || []);
          else setOrders([]);
        })
        .catch(() => setOrders([]))
        .finally(() => setLoading(false));
    } else if (tab === 'price') {
      fetch(`/api/estimate?custKey=${key}`)
        .then(r => r.json())
        .then(d => {
          if (d?.success) setPrices(d.items || d.shipments || []);
          else setPrices([]);
        })
        .catch(() => setPrices([]))
        .finally(() => setLoading(false));
    } else if (tab === 'ar') {
      fetch(`/api/sales/ar?type=list&custKey=${key}`)
        .then(r => r.json())
        .then(d => {
          if (d?.success) setAr(d);
          else setAr(null);
        })
        .catch(() => setAr(null))
        .finally(() => setLoading(false));
    }
  }, [key, me, tab]);

  const fmtN = n => Number(n || 0).toLocaleString();
  const custName = cust?.CustName || '거래처 상세';

  if (!me) return null;

  return (
    <MobileShell title={custName} user={me}>
      <Head><title>{custName} - 거래처</title></Head>

      <div className="cd-wrap">
        {/* 거래처 정보 카드 */}
        {cust && (
          <div className="cd-info">
            <div className="cd-info-row">
              <span className="cd-info-label">이름</span>
              <span className="cd-info-val">{cust.CustName}</span>
            </div>
            <div className="cd-info-row">
              <span className="cd-info-label">지역</span>
              <span className="cd-info-val">{cust.CustArea || '-'}</span>
            </div>
            <div className="cd-info-row">
              <span className="cd-info-label">담당자</span>
              <span className="cd-info-val">{cust.Manager || '-'}</span>
            </div>
            <div className="cd-info-row">
              <span className="cd-info-label">연락처</span>
              <span className="cd-info-val">{cust.Mobile || cust.Tel || '-'}</span>
            </div>
            <div className="cd-info-row">
              <span className="cd-info-label">출고요일</span>
              <span className="cd-info-val">{cust.BaseOutDay || '-'}</span>
            </div>
          </div>
        )}

        {/* 탭 버튼 */}
        <div className="cd-tabs">
          {DETAIL_TABS.map(t => (
            <button
              key={t.key}
              className={`cd-tab ${tab === t.key ? 'active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* 탭 컨텐츠 */}
        {loading ? (
          <div className="cd-empty">조회 중...</div>
        ) : (
          <>
            {/* 주문이력 */}
            {tab === 'orders' && (
              orders.length === 0 ? (
                <div className="cd-empty">주문이력이 없습니다</div>
              ) : (
                orders.slice(0, 30).map((o, i) => (
                  <div key={i} className="cd-card">
                    <div className="cd-card-top">
                      <span className="cd-card-week">{o.OrderWeek || o.week || '-'}차</span>
                      <span className="cd-card-qty">{fmtN(o.TotalQty || o.totalQty || o.qty || 0)}</span>
                    </div>
                    {o.ProdName && (
                      <div className="cd-card-sub">{o.DisplayName || o.ProdName}</div>
                    )}
                  </div>
                ))
              )
            )}

            {/* 단가 */}
            {tab === 'price' && (
              prices.length === 0 ? (
                <div className="cd-empty">단가 정보가 없습니다</div>
              ) : (
                prices.slice(0, 30).map((p, i) => (
                  <div key={i} className="cd-card">
                    <div className="cd-card-top">
                      <span className="cd-card-name">{p.ProdName || p.CustName || '-'}</span>
                      <span className="cd-card-amt">{fmtN(p.Cost || p.totalAmount || 0)}원</span>
                    </div>
                    {p.OutUnit && (
                      <div className="cd-card-sub">{p.OutUnit}</div>
                    )}
                  </div>
                ))
              )
            )}

            {/* 미수금 */}
            {tab === 'ar' && (
              !ar || !ar.list || ar.list.length === 0 ? (
                <div className="cd-empty">미수금 데이터가 없습니다</div>
              ) : (
                ar.list.map((r, i) => (
                  <div key={i} className="cd-card">
                    <div className="cd-card-top">
                      <span className="cd-card-name">{r.CustName || '-'}</span>
                      <span className="cd-card-amt ar">{fmtN(r.balance || r.ArBalance || 0)}원</span>
                    </div>
                    <div className="cd-card-sub">
                      매출 {fmtN(r.salesAmt || 0)} / 입금 {fmtN(r.paidAmt || 0)}
                    </div>
                  </div>
                ))
              )
            )}
          </>
        )}
      </div>

      <style jsx>{`
        .cd-wrap { padding: 12px; }
        .cd-info {
          background: white; border: 1px solid #E2E8F0;
          border-radius: 12px; padding: 14px; margin-bottom: 14px;
        }
        .cd-info-row {
          display: flex; justify-content: space-between;
          align-items: center; padding: 6px 0;
          border-bottom: 1px solid #F7FAFC;
        }
        .cd-info-row:last-child { border-bottom: none; }
        .cd-info-label { font-size: 13px; color: #718096; }
        .cd-info-val { font-size: 14px; font-weight: 600; color: #1A202C; }

        .cd-tabs { display: flex; gap: 6px; margin-bottom: 14px; }
        .cd-tab {
          flex: 1; padding: 10px 8px;
          border: 1px solid #CBD5E0; border-radius: 10px;
          background: white; font-size: 13px; font-weight: 600;
          color: #4A5568; cursor: pointer; text-align: center;
          min-height: 44px; font-family: inherit;
        }
        .cd-tab.active {
          background: #2b6cb0; color: white; border-color: #2b6cb0;
        }
        .cd-tab:active { opacity: 0.8; }

        .cd-card {
          background: white; border: 1px solid #E2E8F0;
          border-radius: 10px; padding: 12px 14px; margin-bottom: 6px;
        }
        .cd-card-top {
          display: flex; justify-content: space-between;
          align-items: center;
        }
        .cd-card-week { font-size: 14px; font-weight: 700; color: #2b6cb0; }
        .cd-card-name { font-size: 14px; font-weight: 600; color: #1A202C; }
        .cd-card-qty { font-size: 14px; font-weight: 700; color: #1A202C; }
        .cd-card-amt { font-size: 14px; font-weight: 700; color: #2b6cb0; }
        .cd-card-amt.ar { color: #E53E3E; }
        .cd-card-sub { font-size: 12px; color: #718096; margin-top: 4px; }
        .cd-empty {
          padding: 40px 16px; text-align: center;
          color: #A0AEC0; font-size: 14px;
        }
      `}</style>
    </MobileShell>
  );
}
