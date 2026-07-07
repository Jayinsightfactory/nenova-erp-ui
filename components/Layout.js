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

export const MENU_ITEMS = [
  {
    group: '주문관리',
    items: [
      { href: '/orders/new',   labelKey: '주문등록',          popup: false },
      { href: '/orders/paste', labelKey: '붙여넣기 주문등록',  popup: true  },
      { href: '/orders/import', labelKey: '업로드 주문등록',    popup: false },
      { href: '/orders/kakao-audit', labelKey: '카톡 변경 검증', popup: false },
      { href: '/orders',       labelKey: '주문관리',          popup: false },
      { href: '/warehouse',    labelKey: '발주관리',          popup: false },
    ]
  },
  {
    group: '입/출고관리',
    items: [
      { href: '/incoming',            labelKey: '입고관리',     popup: true },
      { href: '/incoming/kakao-summary', labelKey: '수입방 카톡 수량집계', popup: false },
      { href: '/incoming-price',      labelKey: '입고단가/송금', popup: false },
      { href: '/freight',             labelKey: '운송기준원가', popup: true },
      { href: '/shipment/distribute',    labelKey: '출고분배',      popup: true },
      { href: '/shipment/distribute-import', labelKey: '출고분배 엑셀업로드', popup: false },
      { href: '/shipment/fix-status',    labelKey: '차수 확정 현황', popup: false },
      { href: '/shipment/stock-status', labelKey: '출고,재고상황', popup: false },
      { href: '/shipment/week-pivot',   labelKey: '차수피벗',      popup: true },
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
      { href: '/sales/weekly-shipment', labelKey: '차수매출관리',    popup: true  },
      { href: '/sales/revenue-management', labelKey: '영업매출관리', popup: false },
      { href: '/catalog',              labelKey: '거래처 카탈로그', popup: true },
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
      { href: '/stats/pivot',    labelKey: 'Pivot 통계',     popup: true },
      { href: '/stats/area',     labelKey: '지역별 판매 비교',popup: false },
      { href: '/stats/analysis', labelKey: '매출/물량 분석', popup: false },
      { href: '/stats/manager',  labelKey: '영업 사원 실적', popup: false },
    ]
  },
  {
    group: '자동화',
    items: [
      { href: '/automation', labelKey: '🔗 업무 자동화(n8n)', popup: false },
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
      { href: '/admin/chat-audit', labelKey: '챗봇 질문/처리현황', popup: false },
      { href: '/admin/workflow',   labelKey: '📊 업무플로우 분석',   popup: false },
      { href: '/dev/project-plan',  labelKey: '작업/기획 현황',       popup: false },
      { href: '/demo/tenant-studio', labelKey: '🎨 테넌트 스튜디오',   popup: true },
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

// 메인 앱 진입 경로 — 이 경로들은 자식창(window.opener)으로 열려도
// 절대 사이드바를 자동으로 숨기지 않는다(사용자가 탐색에 쓰는 메인 창일 수 있음).
const MAIN_ENTRY_PATHS = ['/dashboard', '/login', '/'];

export default function Layout({ children, title }) {
  const router = useRouter();
  const { lang, t, toggleLang } = useLang();
  const isPopup = router.query.popup === '1';

  // 로그인 유저 (hydration 안전)
  const [user, setUser] = useState(null);
  useEffect(() => {
    try { setUser(JSON.parse(localStorage.getItem('nenovaUser')||'null')); } catch {}
  }, []);

  // 자식창(window.opener로 열린 창) 감지 — hydration 안전.
  // SSR/첫 렌더는 false(기존과 동일) → 마운트 후 클라이언트에서만 판정.
  // cross-origin opener 접근이 예외를 던져도 "자식창"으로 간주(중복 사이드바 방지).
  const [isChildWindow, setIsChildWindow] = useState(false);
  useEffect(() => {
    try {
      if (window.opener && window.opener !== window) setIsChildWindow(true);
    } catch {
      // cross-origin opener → 접근 예외 = 자식창
      setIsChildWindow(true);
    }
  }, []);

  // 사용자 수동 접기/펴기 토글 (자식창 자동 접힘을 언제든 복구 가능)
  // null = 미설정(자동 판정 따름), true = 강제 접힘, false = 강제 펼침
  const [sidebarOverride, setSidebarOverride] = useState(null);

  // ?popup=1 이 아니면서, 자식창이고, 메인 진입 경로가 아니면 기본 접힘.
  // 사용자가 토글하면 그 값이 우선.
  const isMainEntry = MAIN_ENTRY_PATHS.includes(router.pathname);
  const autoCollapse = isChildWindow && !isMainEntry;
  const sidebarSuppressed = sidebarOverride === null ? autoCollapse : sidebarOverride;

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    localStorage.removeItem('nenovaUser');
    router.push('/login');
  };

  const pageTitle = title || MENU_ITEMS.flatMap(g => g.items)
    .find(i => i.href === router.pathname)?.labelKey || 'nenova ERP';

  // ── 팝업 모드 (?popup=1 이거나, 자식창 자동 접힘 / 사용자 강제 접힘)
  if (isPopup || sidebarSuppressed) {
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
              {/* ?popup=1 정식 팝업이 아닌 자동 접힘/강제 접힘일 때만 '메뉴 펼치기' 노출 → 언제든 사이드바 복구 가능 */}
              {!isPopup && (
                <button onClick={() => setSidebarOverride(false)}
                  style={{background:'none', border:'1px solid rgba(255,255,255,.5)', color:'#fff',
                    cursor:'pointer', fontSize:10, padding:'1px 6px'}}
                  title={t('메뉴 펼치기')}>
                  ☰ {t('메뉴')}
                </button>
              )}
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
              {/* 사이드바 접기 — 자식창에서 자동 펼침을 되돌리거나, 좁은 화면에서 메뉴 숨김 */}
              <button className="btn btn-sm"
                onClick={() => setSidebarOverride(true)}
                title={t('메뉴 접기')}>
                ☰
              </button>
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
