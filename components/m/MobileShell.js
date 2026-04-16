// components/m/MobileShell.js — 모바일 공통 껍데기
// 상단 헤더(뒤로가기 + 제목) + 하단 탭바(5개) + safe-area + 풀스크린
import { useRouter } from 'next/router';

const TABS = [
  { icon: '🏠', label: '홈',    href: '/m' },
  { icon: '📋', label: '주문',  href: '/m/orders' },
  { icon: '🚚', label: '출고',  href: '/m/shipment' },
  { icon: '💬', label: '챗봇',  href: '/m/chat' },
  { icon: '⋯',  label: '더보기', href: '/m/more' },
];

export default function MobileShell({ title, back, children, hideTabBar = false, user }) {
  const router = useRouter();
  const currentPath = router.pathname;

  return (
    <div className="ms-root">
      {/* 상단 헤더 */}
      <header className="ms-header">
        {back !== false && (
          <button className="ms-back" onClick={() => router.back()} aria-label="뒤로">
            ←
          </button>
        )}
        <span className="ms-title">{title || '네노바 ERP'}</span>
        {user && (
          <span className="ms-user">{user.userName || user.userId}</span>
        )}
      </header>

      {/* 컨텐츠 */}
      <main className="ms-content">
        {children}
      </main>

      {/* 하단 탭바 */}
      {!hideTabBar && (
        <nav className="ms-tabbar">
          {TABS.map(t => {
            const active = currentPath === t.href ||
              (t.href !== '/m' && currentPath.startsWith(t.href));
            return (
              <button
                key={t.href}
                className={`ms-tab ${active ? 'active' : ''}`}
                onClick={() => router.push(t.href)}
              >
                <span className="ms-tab-icon">{t.icon}</span>
                <span className="ms-tab-label">{t.label}</span>
              </button>
            );
          })}
        </nav>
      )}

      <style jsx>{`
        .ms-root {
          display: flex; flex-direction: column;
          height: 100vh; height: 100dvh;
          max-width: 768px; margin: 0 auto;
          background: #F5F7FA;
          font-family: -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', sans-serif;
        }
        .ms-header {
          flex-shrink: 0;
          display: flex; align-items: center; gap: 8px;
          padding: 10px 16px;
          padding-top: calc(10px + env(safe-area-inset-top));
          background: #2b6cb0; color: white;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          min-height: 48px;
        }
        .ms-back {
          width: 36px; height: 36px; border: none; border-radius: 50%;
          background: rgba(255,255,255,0.15); color: white;
          font-size: 18px; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
        }
        .ms-back:active { background: rgba(255,255,255,0.3); }
        .ms-title {
          flex: 1; font-weight: 700; font-size: 16px;
        }
        .ms-user {
          font-size: 12px; opacity: 0.85;
          padding: 4px 10px; background: rgba(255,255,255,0.15);
          border-radius: 12px;
        }
        .ms-content {
          flex: 1; overflow-y: auto;
          -webkit-overflow-scrolling: touch;
        }
        .ms-tabbar {
          flex-shrink: 0;
          display: flex;
          background: white;
          border-top: 1px solid #E2E8F0;
          padding-bottom: env(safe-area-inset-bottom);
        }
        .ms-tab {
          flex: 1;
          display: flex; flex-direction: column; align-items: center;
          gap: 2px; padding: 8px 4px;
          border: none; background: none;
          font-family: inherit; cursor: pointer;
          color: #A0AEC0; font-size: 10px;
          min-height: 48px;
        }
        .ms-tab.active { color: #2b6cb0; }
        .ms-tab:active { background: #F7FAFC; }
        .ms-tab-icon { font-size: 20px; line-height: 1; }
        .ms-tab-label { font-weight: 600; }
      `}</style>

      <style jsx global>{`
        html, body, #__next { height: 100%; margin: 0; padding: 0; }
        body { background: #F5F7FA; color: #1a202c; -webkit-font-smoothing: antialiased; }
        * { box-sizing: border-box; }
      `}</style>
    </div>
  );
}
