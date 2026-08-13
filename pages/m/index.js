// pages/m/index.js — 모바일 홈: 데스크톱 전체 메뉴 + 모바일 전용 화면 통합
// 통계/KPI 없음. 모든 기능 접근 가능.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import MobileShell from '../../components/m/MobileShell';
import { MENU_ITEMS } from '../../components/Layout';

// 모바일 전용 (간편) 화면 — 모바일 최적화 페이지
const MOBILE_ONLY = [
  { icon: '📋', label: '주문 (모바일)',   href: '/m/orders' },
  { icon: '🚚', label: '출고 (모바일)',   href: '/m/shipment' },
  { icon: '📄', label: '견적서 (모바일)', href: '/m/estimate' },
  { icon: '📦', label: '재고 (모바일)',   href: '/m/stock' },
  { icon: '💰', label: '매출 (모바일)',   href: '/m/sales' },
  { icon: '👥', label: '거래처 (모바일)', href: '/m/customers' },
  { icon: '💬', label: '챗봇 (Text-to-SQL)', href: '/m/chat' },
];

// 데스크톱/모바일 메뉴의 공통 원본. 새 메뉴는 components/Layout.js 한 곳에만 등록한다.
// 기존 모바일 공개 범위는 유지하되 href/label/권한 정의는 복제하지 않는다.
const MOBILE_DESKTOP_HREFS = new Set([
  '/integrations/moyi', '/integrations/moyi-drive',
  '/orders/new', '/orders/paste', '/orders/import', '/orders/kakao-audit', '/orders', '/warehouse',
  '/incoming', '/incoming/kakao-summary', '/incoming-price', '/freight', '/shipment/distribute',
  '/shipment/fix-status', '/shipment/week-pivot', '/shipment/stock-status', '/shipment/view', '/shipment/history', '/estimate',
  '/purchase/status', '/sales/status', '/sales/ar', '/sales/tax-invoice', '/ecount/dashboard',
  '/finance/bank', '/finance/exchange', '/stock', '/stats/monthly', '/stats/pivot', '/stats/area', '/stats/analysis', '/stats/manager',
  '/master/customers', '/master/products', '/master/pricing', '/master/codes', '/admin/users', '/master/activity',
  '/admin/category-overrides', '/dev/action-log', '/dev/project-plan',
]);
const DESKTOP_MENU = MENU_ITEMS
  .map((group) => ({ ...group, items: group.items.filter((item) => MOBILE_DESKTOP_HREFS.has(item.href)) }))
  .filter((group) => group.items.length > 0);

export default function MobileHome() {
  const router = useRouter();
  const [me, setMe] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (d?.success && d?.user) setMe(d.user);
      else router.replace('/m/login?next=/m');
    }).catch(() => router.replace('/m/login?next=/m'));
  }, [router]);

  if (!me) return <div style={{ display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',color:'#666' }}>로딩 중...</div>;

  const q = search.trim().toLowerCase();
  const matches = (label) => !q || label.toLowerCase().includes(q);

  return (
    <MobileShell title="네노바 ERP" back={false} user={me}>
      <Head><title>네노바 모바일</title></Head>

      <div className="mh-wrap">
        {/* 검색창 */}
        <div className="mh-search">
          <input
            type="text"
            placeholder="🔍 메뉴 검색 (예: 출고, 거래처)"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* 모바일 전용 화면 (간편 UI) */}
        {MOBILE_ONLY.some(m => matches(m.label)) && (
          <section className="mh-section">
            <div className="mh-section-title">📱 모바일 전용 (간편)</div>
            <div className="mh-list">
              {MOBILE_ONLY.filter(m => matches(m.label)).map(m => (
                <button key={m.href} className="mh-row mh-row-mobile" onClick={() => router.push(m.href)}>
                  <span className="mh-icon">{m.icon}</span>
                  <span className="mh-label">{m.label}</span>
                  <span className="mh-arrow">›</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* 데스크톱 전체 메뉴 — 그룹별 */}
        {DESKTOP_MENU.map(grp => {
          const filtered = grp.items.filter(it => (!it.userIds || it.userIds.includes(me.userId)) && matches(it.labelKey));
          if (filtered.length === 0) return null;
          return (
            <section key={grp.group} className="mh-section">
              <div className="mh-section-title">📂 {grp.group}</div>
              <div className="mh-list">
                {filtered.map(it => (
                  <button key={it.href} className="mh-row" onClick={() => router.push(it.href)}>
                    <span className="mh-label">{it.labelKey}</span>
                    <span className="mh-arrow">›</span>
                  </button>
                ))}
              </div>
            </section>
          );
        })}

        <div className="mh-foot">
          {q ? (
            DESKTOP_MENU.every(g => g.items.filter(i => !i.userIds || i.userIds.includes(me.userId)).every(i => !matches(i.labelKey))) &&
            MOBILE_ONLY.every(m => !matches(m.label)) &&
            <div style={{ textAlign:'center', color:'#999', padding:24 }}>검색 결과 없음</div>
          ) : (
            <div style={{ textAlign:'center', color:'#aaa', padding:16, fontSize:11 }}>
              데스크톱 화면도 모바일에서 그대로 열림 — 좌우 스크롤로 확인
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        .mh-wrap { padding: 12px 10px 24px; }

        .mh-search {
          margin-bottom: 12px;
        }
        .mh-search input {
          width: 100%; padding: 10px 14px; font-size: 14px;
          border: 1.5px solid #CBD5E0; border-radius: 10px;
          background: #fff; box-sizing: border-box;
          font-family: inherit;
        }
        .mh-search input:focus {
          outline: none; border-color: #2b6cb0;
          box-shadow: 0 0 0 3px rgba(43,108,176,0.15);
        }

        .mh-section { margin-bottom: 18px; }
        .mh-section-title {
          font-size: 12px; font-weight: 700; color: #4A5568;
          padding: 4px 6px; margin-bottom: 6px;
          letter-spacing: 0.3px;
        }

        .mh-list {
          display: flex; flex-direction: column; gap: 4px;
          background: #fff; border: 1px solid #E2E8F0;
          border-radius: 10px; overflow: hidden;
          box-shadow: 0 1px 3px rgba(0,0,0,0.04);
        }
        .mh-row {
          display: flex; align-items: center; gap: 10px;
          padding: 12px 14px; border: none; background: #fff;
          border-bottom: 1px solid #EDF2F7;
          font-family: inherit; font-size: 14px; color: #2D3748;
          cursor: pointer; text-align: left;
          width: 100%; box-sizing: border-box;
        }
        .mh-row:last-child { border-bottom: none; }
        .mh-row:active { background: #F7FAFC; }
        .mh-row-mobile { background: #F0F9FF; }
        .mh-row-mobile:active { background: #E0F2FE; }

        .mh-icon { font-size: 18px; flex-shrink: 0; }
        .mh-label { flex: 1; font-weight: 500; }
        .mh-arrow { color: #A0AEC0; font-size: 18px; flex-shrink: 0; }

        .mh-foot { margin-top: 8px; }
      `}</style>
    </MobileShell>
  );
}
