// components/Layout.js
// 수정이력: 2026-03-30 — useLang 훅으로 전체 메뉴/버튼 언어 전환
// 수정이력: 2026-04-09 — 홈 링크 + topbar 닫기 버튼 추가
// 수정이력: 2026-04-09b — Railway 강제 재빌드 v2

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { useLang } from '../lib/i18n';

// hydration 안전한 날짜 컴포넌트
function ClientDate() {
  const [dt, setDt] = useState('');
  useEffect(() => { setDt(new Date().toLocaleDateString('ko-KR')); }, []);
  return <span style={{color:'var(--text3)', fontSize:11}}>{dt}</span>;
}

const MENU_ITEMS = [
  {
    group: '주문관리',
    items: [
      { href: '/orders/new',   labelKey: '주문등록',          popup: false },
      { href: '/orders/paste', labelKey: '붙여넣기 주문등록',  popup: true  },
      { href: '/orders',       labelKey: '주문관리',          popup: false },
      { href: '/warehouse',    labelKey: '발주관리',          popup: false },
    ]
  },
  {
    group: '입/출고관리',
    items: [
      { href: '/incoming',            labelKey: '입고관리',     popup: true },
      { href: '/incoming-price',      labelKey: '입고단가/송금', popup: false },
      { href: '/freight',             labelKey: '운송기준원가', popup: true },
      { href: '/shipment/distribute',    labelKey: '출고분배',      popup: true },
      { href: '/shipment/stock-status', labelKey: '출고,재고상황', popup: false },
      { href: '/shipment/view',          labelKey: '출고조회',      popup: false },
      { href: '/shipment/history',       labelKey: '출고내역조회',  popup: false },
      { href: '/estimate',            labelKey: '견적서 관리',  popup: true },
    ]
  },
  {
    group: '구매관리',
    items: [
      { href: '/purchase/status', labelKey: '구매현황(외화/수입)', popup: false },
    ]
  },
  {
    group: '채권관리',
    items: [
      { href: '/sales/status',       labelKey: '판매현황',           popup: false },
      { href: '/sales/ar',           labelKey: '거래처별 채권',      popup: false },
      { href: '/sales/tax-invoice',  labelKey: '세금계산서 진행단계', popup: false },
      { href: '/ecount/dashboard',   labelKey: '이카운트 연동',       popup: false },
    ]
  },
  {
    group: '재무관리',
    items: [
      { href: '/finance/bank',     labelKey: '입/출금 계좌 조회', popup: false },
      { href: '/finance/exchange', labelKey: '외화/환율 관리',    popup: false },
    ]
  },
  {
    group: '통계화면',
    items: [
      { href: '/stock',          labelKey: '재고 관리',      popup: true },
      { href: '/stats/monthly',  labelKey: '월별 판매 현황', popup: false },
      { href: '/stats/pivot',    labelKey: 'Pivot 통계',     popup: false },
      { href: '/stats/area',     labelKey: '지역별 판매 비교',popup: false },
      { href: '/stats/analysis', labelKey: '매출/물량 분석', popup: false },
      { href: '/stats/manager',  labelKey: '영업 사원 실적', popup: false },
    ]
  },
  {
    group: '코드관리',
    items: [
      { href: '/master/customers', labelKey: '거래처관리',           popup: true },
      { href: '/master/products',  labelKey: '품목관리',             popup: true },
      { href: '/master/pricing',   labelKey: '업체별 품목 단가관리', popup: true },
      { href: '/master/codes',     labelKey: '코드관리',             popup: true },
      { href: '/admin/users',      labelKey: '사용자관리',           popup: true },
      { href: '/master/activity',  labelKey: '작업내역',             popup: true },
      { href: '/admin/category-overrides', labelKey: '🏷 세부카테고리', popup: true },
      { href: '/dev/action-log',   labelKey: '🔍 액션 로그',         popup: false },
    ]
  },
];

export function openPopup(href, label, w = 1280, h = 820) {
  const left = Math.max(0, (screen.width  - w) / 2);
  const top  = Math.max(0, (screen.height - h) / 2);
  window.open(
    `${href}?popup=1`,
    label || href,
    `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`
  );
}

export default function Layout({ children, title }) {
  const router = useRouter();
  const { lang, t, toggleLang } = useLang();
  const isPopup = router.query.popup === '1';

  // 로그인 유저 (hydration 안전)
  const [user, setUser] = useState(null);
  useEffect(() => {
    try { setUser(JSON.parse(localStorage.getItem('nenovaUser')||'null')); } catch {}
  }, []);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    localStorage.removeItem('nenovaUser');
    router.push('/login');
  };

  const pageTitle = title || MENU_ITEMS.flatMap(g => g.items)
    .find(i => i.href === router.pathname)?.labelKey || 'nenova ERP';

  // ── 팝업 모드
  if (isPopup) {
    return (
      <>
        <Head><title>{t(pageTitle)} - nenova ERP</title></Head>
        <style>{`body { overflow: hidden; }`}</style>
        <div style={{ display:'flex', flexDirection:'column', height:'100vh', background:'var(--bg)' }}>
          <div style={{
            height:28, background:'linear-gradient(to right,#000080,#1084d0)',
            display:'flex', alignItems:'center', padding:'0 10px',
            color:'#fff', fontSize:12, fontWeight:'bold', flexShrink:0, gap:8
          }}>
            <span>nenova ERP — {t(pageTitle)}</span>
            <span style={{marginLeft:'auto', display:'flex', gap:6, alignItems:'center'}}>
              <span style={{fontSize:9, opacity:.6, fontFamily:"'Menlo','Monaco',monospace"}}>
                {process.env.NEXT_PUBLIC_BUILD_VERSION || 'v?'}
              </span>
              {user && <span style={{fontSize:11, opacity:.8}}>{user.userName}</span>}
              <button onClick={toggleLang}
                style={{background:'none', border:'1px solid rgba(255,255,255,.5)', color:'#fff',
                  cursor:'pointer', fontSize:10, padding:'1px 6px'}}>
                {lang==='bi'?'KO/ES':lang==='ko'?'KO':'ES'}
              </button>
              <button onClick={() => window.close()}
                style={{background:'none', border:'1px solid rgba(255,255,255,.4)', color:'#fff',
                  cursor:'pointer', fontSize:11, padding:'1px 8px'}}>
                {t('닫기')}
              </button>
            </span>
          </div>
          <div style={{flex:1, overflow:'auto', padding:'6px 8px'}}>
            {children}
          </div>
        </div>
      </>
    );
  }

  // ── 일반 모드
  return (
    <>
      <Head><title>{t(pageTitle)} - nenova ERP</title></Head>
      <div className="layout">
        <div className="sidebar">
          <Link href="/dashboard" style={{ textDecoration:'none', color:'inherit', display:'block' }}>
            <div className="sidebar-logo" style={{ cursor:'pointer' }} title={process.env.NEXT_PUBLIC_BUILD_VERSION || ''}>
              🏠 nenova ERP
              <span style={{
                marginLeft: 6,
                fontSize: 9,
                fontWeight: 500,
                opacity: 0.7,
                padding: '2px 5px',
                background: 'rgba(255,255,255,0.18)',
                borderRadius: 4,
                letterSpacing: 0.2,
                fontFamily: "'Menlo','Monaco',monospace",
                verticalAlign: 'middle',
              }}>{process.env.NEXT_PUBLIC_BUILD_VERSION || 'v?'}</span>
            </div>
          </Link>
          <nav className="sidebar-nav">
            {MENU_ITEMS.map(group => (
              <div key={group.group} className="nav-group">
                {/* 그룹 제목도 번역 */}
                <div className="nav-group-title">{t(group.group)}</div>
                {group.items.map(item => (
                  item.fullscreen ? (
                    <a key={item.href}
                      className={`nav-item ${router.pathname === item.href ? 'active' : ''}`}
                      href="#"
                      onClick={e => { e.preventDefault(); window.open(item.href, '_blank', `width=${screen.width},height=${screen.height},left=0,top=0,resizable=yes,scrollbars=yes`); }}
                    >{t(item.labelKey)}</a>
                  ) : item.popup ? (
                    <a key={item.href}
                      className={`nav-item ${router.pathname === item.href ? 'active' : ''}`}
                      href="#"
                      onClick={e => { e.preventDefault(); openPopup(item.href, t(item.labelKey)); }}
                    >{t(item.labelKey)}</a>
                  ) : (
                    <Link key={item.href} href={item.href}
                      className={`nav-item ${router.pathname === item.href ? 'active' : ''}`}
                    >{t(item.labelKey)}</Link>
                  )
                ))}
              </div>
            ))}
          </nav>
          <div style={{padding:'6px 10px', borderTop:'1px solid var(--border)', fontSize:11, color:'var(--text3)'}}>
            {user ? `${user.userName} (${user.userId})` : ''}
          </div>
        </div>

        <div className="main-content">
          <div className="topbar">
            <span style={{fontWeight:'bold', fontSize:13}}>{t(pageTitle)}</span>
            <span style={{marginLeft:'auto', display:'flex', gap:6, alignItems:'center'}}>
              <ClientDate />
              {/* 언어 전환 버튼 */}
              <button className="btn btn-sm" onClick={toggleLang}
                style={{
                  background: lang==='es' ? '#1166BB' : lang==='ko' ? '#006600' : '#6a1b9a',
                  color:'#fff',
                  borderColor: lang==='es' ? '#0055AA' : lang==='ko' ? '#004400' : '#4a148c',
                  minWidth: 52, fontWeight:'bold', fontSize:11
                }}>
                {lang==='bi' ? '🌐 KO/ES' : lang==='ko' ? '🌐 KO' : '🌐 ES'}
              </button>
              {user && (
                <button className="btn btn-sm" onClick={handleLogout}>
                  {t('로그아웃')}
                </button>
              )}
              <button className="btn btn-sm"
                onClick={() => window.opener ? window.close() : router.push('/dashboard')}
                style={{ borderColor:'#999' }}
                title="창 닫기 / 홈으로">
                ✕ {t('닫기')}
              </button>
            </span>
          </div>
          <div className="page-area">{children}</div>
        </div>
      </div>
    </>
  );
}
