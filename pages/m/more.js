// pages/m/more.js — 모바일 더보기 메뉴
// 링크 리스트 + 로그아웃
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import MobileShell from '../../components/m/MobileShell';

const MENU_GROUPS = [
  {
    title: '관리',
    items: [
      { icon: '📦', label: '재고 현황', href: '/m/stock' },
      { icon: '📄', label: '견적서', href: '/m/estimate' },
      { icon: '💰', label: '매출 요약', href: '/m/sales' },
      { icon: '👥', label: '거래처', href: '/m/customers' },
    ],
  },
  {
    title: '구매관리',
    items: [
      { icon: '🛒', label: '구매 관리', href: '/purchase' },
      { icon: '🏭', label: '입고 관리', href: '/warehouse' },
    ],
  },
  {
    title: '재무/채권',
    items: [
      { icon: '💳', label: '채권 관리', href: '/sales/ar' },
      { icon: '🏦', label: '환율 조회', href: '/finance/exchange' },
    ],
  },
  {
    title: '설정',
    items: [
      { icon: '⚙️', label: '마스터 관리', href: '/master' },
      { icon: '📊', label: '통계 대시보드', href: '/stats/dashboard' },
      { icon: '🩺', label: '시스템 진단', href: '/m/admin/status' },
    ],
  },
];

export default function MobileMore() {
  const router = useRouter();
  const [me, setMe] = useState(null);

  // 인증
  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (d?.success && d?.user) setMe(d.user);
      else router.replace('/m/login?next=/m/more');
    }).catch(() => router.replace('/m/login?next=/m/more'));
  }, [router]);

  async function handleLogout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {}
    router.replace('/m/login');
  }

  if (!me) return null;

  return (
    <MobileShell title="더보기" back={false} user={me}>
      <Head><title>더보기 - 모바일</title></Head>

      <div className="mm-wrap">
        {/* 사용자 정보 */}
        <div className="mm-user-card">
          <div className="mm-user-name">{me.userName || me.userId}</div>
          <div className="mm-user-id">{me.userId}</div>
        </div>

        {/* 메뉴 그룹 */}
        {MENU_GROUPS.map((g, gi) => (
          <div key={gi} className="mm-group">
            <div className="mm-group-title">{g.title}</div>
            {g.items.map((item, ii) => (
              <button
                key={ii}
                className="mm-item"
                onClick={() => router.push(item.href)}
              >
                <span className="mm-item-icon">{item.icon}</span>
                <span className="mm-item-label">{item.label}</span>
                <span className="mm-item-arrow">&#9654;</span>
              </button>
            ))}
          </div>
        ))}

        {/* 로그아웃 */}
        <button className="mm-logout" onClick={handleLogout}>
          로그아웃
        </button>
      </div>

      <style jsx>{`
        .mm-wrap { padding: 12px; }
        .mm-user-card {
          background: white; border: 1px solid #E2E8F0;
          border-radius: 12px; padding: 16px; margin-bottom: 16px;
          text-align: center;
        }
        .mm-user-name { font-size: 18px; font-weight: 800; color: #1A202C; }
        .mm-user-id { font-size: 13px; color: #718096; margin-top: 4px; }

        .mm-group { margin-bottom: 16px; }
        .mm-group-title {
          font-size: 12px; font-weight: 700; color: #4A5568;
          margin-bottom: 6px; padding-left: 4px;
        }
        .mm-item {
          display: flex; align-items: center; gap: 12px;
          width: 100%; padding: 14px;
          background: white; border: 1px solid #E2E8F0;
          border-radius: 10px; margin-bottom: 4px;
          font-size: 14px; color: #1A202C;
          cursor: pointer; text-align: left;
          min-height: 48px; font-family: inherit;
        }
        .mm-item:active { background: #F7FAFC; }
        .mm-item-icon { font-size: 18px; }
        .mm-item-label { flex: 1; font-weight: 600; }
        .mm-item-arrow { color: #A0AEC0; font-size: 12px; }

        .mm-logout {
          display: block; width: 100%;
          padding: 14px; margin-top: 8px;
          background: white; border: 1px solid #FEB2B2;
          border-radius: 10px; font-size: 14px; font-weight: 700;
          color: #E53E3E; cursor: pointer; text-align: center;
          min-height: 48px; font-family: inherit;
        }
        .mm-logout:active { background: #FFF5F5; }
      `}</style>
    </MobileShell>
  );
}
