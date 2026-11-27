// components/NenovaRibbonShell.js
// nenova.exe 클래식 상단 타이틀/리본 쉘 — Main(86px 고정 6그룹) · ★ 즐겨찾기(<=180px 격자) · 전체메뉴 플로팅 오버레이
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

const RECOMMENDED_FAV_HREFS = [
  '/orders/new',
  '/shipment/distribute',
  '/estimate',
  '/incoming',
];

const ESTIMATE_GROUP_HREFS = new Set([
  '/estimate',
  '/estimate/weekday',
  '/estimate-change-history',
  '/catalog',
  '/sales/status',
]);

const CORE_RIBBON_GROUPS = [
  {
    key: 'orders',
    label: '주문관리',
    layout: 'large',
    sourceGroup: '주문관리',
    primaryItems: [
      { href: '/orders/new', label: '주문등록', icon: 'plusDoc' },
      { href: '/orders', label: '주문관리', icon: 'listDoc' },
      { href: '/warehouse', label: '발주관리', icon: 'box' },
    ],
  },
  {
    key: 'inout',
    label: '입/출고관리',
    layout: 'large',
    sourceGroup: '입/출고관리',
    excludeHrefs: ESTIMATE_GROUP_HREFS,
    primaryItems: [
      { href: '/incoming', label: '입고관리', icon: 'inbox' },
      { href: '/shipment/distribute', label: '출고분배', icon: 'split' },
      { href: '/shipment/view', label: '출고조회', icon: 'search' },
      { href: '/shipment/statement', label: '출고내역', icon: 'receipt' },
    ],
  },
  {
    key: 'estimate',
    label: '견적서 관리',
    layout: 'large',
    isEstimate: true,
    explicitHrefs: ['/estimate', '/estimate/weekday', '/estimate-change-history', '/catalog', '/sales/status'],
    primaryItems: [
      { href: '/estimate', label: '견적서 관리', icon: 'calcDoc' },
    ],
  },
  {
    key: 'stats',
    label: '통계화면',
    layout: 'grid3x2',
    sourceGroup: '통계화면',
    primaryItems: [
      { href: '/stock', label: '재고 관리', icon: 'layers' },
      { href: '/stats/pivot', label: 'Pivot 통계', icon: 'grid' },
      { href: '/stats/area', label: '지역별 판매', icon: 'map' },
      { href: '/stats/monthly', label: '일별 판매', icon: 'chart' },
      { href: '/stats/manager', label: '영업사원 실적', icon: 'user' },
      { href: '/stats/analysis', label: '매출/불량', icon: 'trend' },
    ],
  },
  {
    key: 'codes',
    label: '코드관리',
    layout: 'grid3x2',
    sourceGroup: '코드관리',
    primaryItems: [
      { href: '/master/customers', label: '거래처관리', icon: 'users' },
      { href: '/master/products', label: '품목관리', icon: 'tag' },
      { href: '/master/pricing', label: '업체별 단가', icon: 'won' },
      { href: '/admin/users', label: '사용자관리', icon: 'shield' },
      { href: '/master/codes', label: '코드관리', icon: 'sliders' },
      { href: '/master/activity', label: '메뉴/이력', icon: 'clock' },
    ],
  },
  {
    key: 'webwork',
    label: '웹 업무',
    layout: 'grid3x2',
    isWebWork: true,
    explicitHrefs: [
      '/orders/paste',
      '/shipment/week-pivot',
      '/import',
      '/sales/ar',
      '/arrival-cost',
      '/sales/status',
      '/sales/profit-report',
      '/sales/defect-deductions',
      '/ecount/workbench',
      '/finance/bank',
      '/work/manuals',
      '/pm',
      '/automation',
    ],
    primaryItems: [
      { href: '/orders/paste', label: '붙여넣기 주문', icon: 'paste' },
      { href: '/shipment/week-pivot', label: '차수피벗', icon: 'grid' },
      { href: '/import', label: '수입부', icon: 'plane' },
      { href: '/sales/ar', label: '매출/채권', icon: 'wallet' },
      { href: '/arrival-cost', label: '도착원가', icon: 'calcDoc' },
      { href: '__ALL_MENU__', label: '전체메뉴 ▾', icon: 'menu', isAllMenuTrigger: true },
    ],
  },
];

function RibbonSvgIcon({ name, size = 18 }) {
  const props = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
    style: { flexShrink: 0, display: 'block' },
  };
  switch (name) {
    case 'plusDoc':
      return (
        <svg {...props}>
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5M12 11v6M9 14h6" />
        </svg>
      );
    case 'listDoc':
      return (
        <svg {...props}>
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5M9 13h6M9 17h4" />
        </svg>
      );
    case 'box':
      return (
        <svg {...props}>
          <path d="M21 8l-9-5-9 5v8l9 5 9-5z" />
          <path d="M3.3 8.2L12 13l8.7-4.8M12 22V13" />
        </svg>
      );
    case 'inbox':
      return (
        <svg {...props}>
          <path d="M4 13h5l2 3h2l2-3h5" />
          <path d="M5.5 5h13L21 13v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z" />
        </svg>
      );
    case 'split':
      return (
        <svg {...props}>
          <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
        </svg>
      );
    case 'search':
      return (
        <svg {...props}>
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
      );
    case 'receipt':
      return (
        <svg {...props}>
          <path d="M5 3h14v18l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21z" />
          <path d="M8.5 8h7M8.5 12h7M8.5 16h4" />
        </svg>
      );
    case 'calcDoc':
      return (
        <svg {...props}>
          <rect x="5" y="3" width="14" height="18" rx="1.5" />
          <path d="M8 7h8M8 12h2M12 12h4M8 16h2M12 16h4" />
        </svg>
      );
    case 'layers':
      return (
        <svg {...props}>
          <path d="M12 3l9 4.5-9 4.5-9-4.5z" />
          <path d="M3 12l9 4.5 9-4.5M3 16.5L12 21l9-4.5" />
        </svg>
      );
    case 'grid':
      return (
        <svg {...props}>
          <rect x="3" y="4" width="18" height="16" rx="1" />
          <path d="M3 10h18M9 4v16M15 4v16" />
        </svg>
      );
    case 'map':
      return (
        <svg {...props}>
          <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" />
          <path d="M9 4v14M15 6v14" />
        </svg>
      );
    case 'chart':
      return (
        <svg {...props}>
          <path d="M4 20h16M7 16v-4M12 16V8M17 16v-6" />
        </svg>
      );
    case 'user':
    case 'users':
      return (
        <svg {...props}>
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 20a7 7 0 0 1 14 0" />
        </svg>
      );
    case 'trend':
      return (
        <svg {...props}>
          <path d="M4 18l5-5 4 3 7-8" />
          <path d="M15 8h5v5" />
        </svg>
      );
    case 'tag':
      return (
        <svg {...props}>
          <path d="M20 13l-7 7-9-9V4h7z" />
          <circle cx="8.5" cy="8.5" r="1.2" />
        </svg>
      );
    case 'won':
      return (
        <svg {...props}>
          <path d="M5 6l3 12 4-10 4 10 3-12M4 12h16M4 15h16" />
        </svg>
      );
    case 'shield':
      return (
        <svg {...props}>
          <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
        </svg>
      );
    case 'sliders':
      return (
        <svg {...props}>
          <path d="M4 7h16M4 17h16M9 4v6M15 14v6" />
        </svg>
      );
    case 'clock':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v4l3 2" />
        </svg>
      );
    case 'paste':
      return (
        <svg {...props}>
          <rect x="6" y="4" width="12" height="16" rx="1.5" />
          <path d="M9 4V2.5h6V4M9 10h6M9 14h4" />
        </svg>
      );
    case 'plane':
      return (
        <svg {...props}>
          <path d="M3 14l18-7-7 14-2.5-5.5z" />
        </svg>
      );
    case 'wallet':
      return (
        <svg {...props}>
          <rect x="3" y="6" width="18" height="13" rx="1.5" />
          <path d="M15 12h6M3 10h18" />
        </svg>
      );
    case 'menu':
    default:
      return (
        <svg {...props}>
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      );
  }
}

export default function NenovaRibbonShell({
  user,
  pageTitle,
  t,
  lang,
  toggleLang,
  handleLogout,
  sidebarFavorites = [],
  favoriteHrefs = new Set(),
  toggleSidebarFavorite,
  favoriteBusyHref = '',
  navMode = 'ribbon',
  onToggleNavMode,
  ribbonCollapsed = false,
  onToggleRibbonCollapsed,
  onOpenFavoritesModal,
  onOpenTab,
  onOpenNewWindow,
  ClientDateComponent,
  DesktopDownloadButtonComponent,
  MenuBackButtonNode,
  menuItems = [],
  currentPathname = '',
  onCollapseSidebar,
}) {
  const [ribbonTab, setRibbonTab] = useState('main'); // 'main' | 'favorites'
  const [allMenuOpen, setAllMenuOpen] = useState(false);
  const [allMenuAnchorRect, setAllMenuAnchorRect] = useState(null);
  const [moreGroupKey, setMoreGroupKey] = useState(null);
  const [moreAnchorRect, setMoreAnchorRect] = useState(null);
  const [menuSearch, setMenuSearch] = useState('');
  const [favSearch, setFavSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('ALL');
  const shellRef = useRef(null);
  const allMenuSearchRef = useRef(null);

  const visibleMenuGroups = useMemo(() => {
    const uid = user?.userId;
    return menuItems
      .map((group) => ({
        ...group,
        items: (group.items || []).filter((item) => !item.userIds || (uid && item.userIds.includes(uid))),
      }))
      .filter((group) => group.items.length > 0);
  }, [menuItems, user?.userId]);

  const totalMenuCount = useMemo(
    () => visibleMenuGroups.reduce((sum, g) => sum + g.items.length, 0),
    [visibleMenuGroups]
  );

  const itemByHref = useMemo(() => {
    const map = new Map();
    for (const group of visibleMenuGroups) {
      for (const item of group.items) map.set(item.href, item);
    }
    return map;
  }, [visibleMenuGroups]);

  const coreGroups = useMemo(() => {
    return CORE_RIBBON_GROUPS.map((def) => {
      let pool;
      if (def.explicitHrefs) {
        pool = def.explicitHrefs.map((h) => itemByHref.get(h)).filter(Boolean);
      } else {
        const src = visibleMenuGroups.find((g) => g.group === def.sourceGroup);
        pool = (src ? src.items : []).filter((i) => !def.excludeHrefs || !def.excludeHrefs.has(i.href));
      }
      const primary = [];
      const primaryHrefSet = new Set();
      for (const p of def.primaryItems) {
        if (p.isAllMenuTrigger) {
          primary.push(p);
          continue;
        }
        const canonical = itemByHref.get(p.href);
        if (!canonical) continue;
        primaryHrefSet.add(p.href);
        primary.push({
          ...canonical,
          ribbonLabel: p.label,
          ribbonIcon: p.icon,
        });
      }
      const rest = pool.filter((i) => !primaryHrefSet.has(i.href));
      return { ...def, primary, rest };
    }).filter((g) => g.primary.length > 0);
  }, [visibleMenuGroups, itemByHref]);

  const recommendedFavorites = useMemo(
    () => RECOMMENDED_FAV_HREFS.map((h) => itemByHref.get(h)).filter(Boolean),
    [itemByHref]
  );

  const favList = sidebarFavorites.length > 0 ? sidebarFavorites : recommendedFavorites;
  const favFilterLower = favSearch.trim().toLowerCase();
  const filteredFavorites = useMemo(() => {
    if (!favFilterLower) return favList;
    return favList.filter((item) => {
      const original = t(item.labelKey);
      const alias = item.saved?.alias || '';
      return (
        original.toLowerCase().includes(favFilterLower) ||
        alias.toLowerCase().includes(favFilterLower) ||
        item.href.toLowerCase().includes(favFilterLower)
      );
    });
  }, [favList, favFilterLower, t]);

  useEffect(() => {
    if (!moreGroupKey) return undefined;
    const onDocDown = (e) => {
      if (e.target.closest?.('[data-nv-ribbon-dropdown]') || e.target.closest?.('[data-nv-more-btn]')) return;
      setMoreGroupKey(null);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setMoreGroupKey(null);
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [moreGroupKey]);

  useEffect(() => {
    if (!allMenuOpen) return undefined;
    requestAnimationFrame(() => allMenuSearchRef.current?.focus());
    const onDocDown = (e) => {
      if (e.target.closest?.('[data-nv-allmenu-popover]') || e.target.closest?.('[data-nv-allmenu-trigger]')) return;
      setAllMenuOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setAllMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [allMenuOpen]);

  useEffect(() => {
    if (ribbonCollapsed || ribbonTab !== 'favorites') return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (allMenuOpen || moreGroupKey) return;
      if (document.querySelector('[data-testid="favorites-editor-modal"]')) return;
      onToggleRibbonCollapsed?.(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ribbonCollapsed, ribbonTab, allMenuOpen, moreGroupKey, onToggleRibbonCollapsed]);

  const activeMoreGroup = moreGroupKey ? coreGroups.find((g) => g.key === moreGroupKey) : null;

  const searchLower = menuSearch.trim().toLowerCase();
  const filteredAllGroups = useMemo(() => {
    return visibleMenuGroups
      .filter((g) => groupFilter === 'ALL' || g.group === groupFilter)
      .map((g) => ({
        ...g,
        items: g.items.filter((item) => {
          if (!searchLower) return true;
          const label = t(item.labelKey).toLowerCase();
          return label.includes(searchLower) || item.href.toLowerCase().includes(searchLower) || g.group.toLowerCase().includes(searchLower);
        }),
      }))
      .filter((g) => g.items.length > 0);
  }, [visibleMenuGroups, groupFilter, searchLower, t]);

  const handleMainItemClick = (item) => {
    setMoreGroupKey(null);
    setAllMenuOpen(false);
    onOpenTab?.(item);
  };

  const handleFavoriteItemClick = (item) => {
    setMoreGroupKey(null);
    setAllMenuOpen(false);
    onToggleRibbonCollapsed?.(true);
    onOpenTab?.(item);
  };

  const handleAllMenuItemClick = (item) => {
    setAllMenuOpen(false);
    setMoreGroupKey(null);
    onOpenTab?.(item);
  };

  const openAllMenuFromEl = (el) => {
    if (allMenuOpen) {
      setAllMenuOpen(false);
      return;
    }
    setMoreGroupKey(null);
    const rect = el?.getBoundingClientRect?.() || { left: 16, bottom: 30 };
    setAllMenuAnchorRect({ left: rect.left, top: rect.bottom + 2 });
    setAllMenuOpen(true);
  };

  const handleMainTabClick = () => {
    setMoreGroupKey(null);
    setAllMenuOpen(false);
    if (!ribbonCollapsed && ribbonTab === 'main') {
      onToggleRibbonCollapsed?.(true);
      return;
    }
    setRibbonTab('main');
    if (ribbonCollapsed) onToggleRibbonCollapsed?.(false);
  };

  const handleFavoritesTabClick = () => {
    setMoreGroupKey(null);
    setAllMenuOpen(false);
    if (!ribbonCollapsed && ribbonTab === 'favorites') {
      onToggleRibbonCollapsed?.(true);
      return;
    }
    setRibbonTab('favorites');
    if (ribbonCollapsed) onToggleRibbonCollapsed?.(false);
  };

  if (navMode === 'sidebar') {
    return (
      <div className="topbar nv-topbar-classic" data-ui-topbar style={{ minHeight: 30 }}>
        <span data-ui-page-title className="nv-topbar-title">{t(pageTitle)}</span>
        <span className="nv-topbar-actions">
          {ClientDateComponent && <span className="nv-topbar-date"><ClientDateComponent /></span>}
          {DesktopDownloadButtonComponent && <DesktopDownloadButtonComponent />}
          {MenuBackButtonNode}
          <button
            type="button"
            className="nv-top-btn nv-top-btn-solid"
            onClick={() => onToggleNavMode?.('ribbon')}
            title="nenova.exe 클래식 리본 메뉴로 전환"
          >
            클래식 리본 전환
          </button>
          <button type="button" className="nv-top-btn" onClick={toggleLang}>
            {lang === 'bi' ? 'KO/ES' : lang === 'ko' ? 'KO' : 'ES'}
          </button>
          {user && (
            <button type="button" className="nv-top-btn" onClick={handleLogout}>
              {t('로그아웃')}
            </button>
          )}
          <button
            type="button"
            className="nv-top-btn"
            onClick={onCollapseSidebar}
            title={t('메뉴 접기')}
          >
            ☰
          </button>
          <button
            type="button"
            className="nv-top-btn"
            onClick={() => (window.opener ? window.close() : onOpenTab?.({ href: '/dashboard', labelKey: '홈' }))}
            title="창 닫기 / 홈으로"
          >
            ✕ {t('닫기')}
          </button>
        </span>
      </div>
    );
  }

  const isMainOpen = !ribbonCollapsed && ribbonTab === 'main';
  const isFavoritesOpen = !ribbonCollapsed && ribbonTab === 'favorites';

  return (
    <div ref={shellRef} data-nv-ribbon-shell>
      <div className="topbar nv-topbar-classic" data-ui-topbar>
        <Link href="/dashboard" className="nv-brand-badge" title={process.env.NEXT_PUBLIC_BUILD_VERSION || 'nenova ERP'}>
          <span>nenova ERP</span>
          <span className="nv-brand-ver">{process.env.NEXT_PUBLIC_BUILD_VERSION || 'v?'}</span>
        </Link>

        <div className="nv-ribbon-tabs" role="tablist" aria-label="리본 모드 선택">
          <button
            type="button"
            role="tab"
            aria-selected={isMainOpen}
            className={`nv-ribbon-tab ${isMainOpen ? 'active' : ''}`}
            data-testid="ribbon-tab-main"
            onClick={handleMainTabClick}
            title="nenova.exe 기본 리본 열기/접기"
          >
            Main
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isFavoritesOpen}
            className={`nv-ribbon-tab nv-ribbon-tab-fav ${isFavoritesOpen ? 'active' : ''}`}
            data-testid="ribbon-tab-favorites"
            onClick={handleFavoritesTabClick}
            title="내 즐겨찾기 패널 열기/닫기"
          >
            ★ 즐겨찾기 ({sidebarFavorites.length})
          </button>
          <button
            type="button"
            data-nv-allmenu-trigger
            aria-expanded={allMenuOpen}
            className={`nv-ribbon-tab nv-ribbon-tab-all ${allMenuOpen ? 'active' : ''}`}
            data-testid="ribbon-tab-all"
            onClick={(e) => openAllMenuFromEl(e.currentTarget)}
            title="전체 13개 그룹 메뉴 플로팅 검색"
          >
            전체메뉴 ({totalMenuCount}) ▾
          </button>
        </div>

        <span data-ui-page-title className="nv-topbar-title">{t(pageTitle)}</span>

        <span className="nv-topbar-actions">
          {ClientDateComponent && <span className="nv-topbar-date"><ClientDateComponent /></span>}
          {DesktopDownloadButtonComponent && <DesktopDownloadButtonComponent />}
          {MenuBackButtonNode}
          <button
            type="button"
            className="nv-top-btn"
            data-testid="ribbon-new-window-btn"
            onClick={() => onOpenNewWindow?.(currentPathname)}
            title="현재 화면을 새 창으로 열기"
          >
            + 새 창
          </button>
          <button
            type="button"
            className="nv-top-btn"
            data-testid="ribbon-collapse-toggle"
            aria-expanded={!ribbonCollapsed}
            onClick={() => onToggleRibbonCollapsed?.(!ribbonCollapsed)}
            title={ribbonCollapsed ? '리본 펼치기' : '리본 접기'}
          >
            {ribbonCollapsed ? '▼ 펼치기' : '▲ 접기'}
          </button>
          <button
            type="button"
            className="nv-top-btn"
            data-testid="nav-mode-toggle"
            onClick={() => onToggleNavMode?.('sidebar')}
            title="왼쪽 사이드바 보기로 전환"
          >
            사이드바
          </button>
          <button type="button" className="nv-top-btn" onClick={toggleLang}>
            {lang === 'bi' ? 'KO/ES' : lang === 'ko' ? 'KO' : 'ES'}
          </button>
          {user && (
            <button type="button" className="nv-top-btn" onClick={handleLogout}>
              {user.userName} · {t('로그아웃')}
            </button>
          )}
          <button
            type="button"
            className="nv-top-btn"
            onClick={() => (window.opener ? window.close() : onOpenTab?.({ href: '/dashboard', labelKey: '홈' }))}
            title="창 닫기 / 홈으로"
          >
            ✕ {t('닫기')}
          </button>
        </span>
      </div>

      {!ribbonCollapsed && (
        <div
          className={`nv-ribbon-panel ${ribbonTab === 'favorites' ? 'is-favorites' : 'is-main'}`}
          data-ui-ribbon
          data-ribbon-mode={ribbonTab}
        >
          {ribbonTab === 'main' ? (
            <div className="nv-ribbon-body" data-testid="ribbon-main-body">
              <div className="nv-ribbon-groups">
                {coreGroups.map((group) => (
                  <div
                    key={group.key}
                    className={`nv-ribbon-group nv-ribbon-group-${group.key} ${group.layout === 'large' ? 'is-large' : 'is-grid3x2'}`}
                    data-ribbon-group={group.key}
                  >
                    <div
                      className={`nv-ribbon-group-items ${group.layout === 'large' ? 'nv-items-large' : 'nv-items-grid3x2'} ${group.isWebWork ? 'is-webwork' : ''}`}
                    >
                      {group.primary.map((item) => {
                        if (item.isAllMenuTrigger) {
                          return (
                            <button
                              key={item.href}
                              type="button"
                              data-nv-allmenu-trigger
                              className="nv-ribbon-btn-sm nv-ribbon-btn-sm-all"
                              onClick={(e) => openAllMenuFromEl(e.currentTarget)}
                              title="전체메뉴 오버레이 열기"
                            >
                              <RibbonSvgIcon name={item.icon} size={13} />
                              <span className="nv-btn-label">{item.label}</span>
                            </button>
                          );
                        }
                        const isActive = currentPathname === item.href.split('?')[0];
                        if (group.layout === 'large') {
                          return (
                            <button
                              key={item.href}
                              type="button"
                              className={`nv-ribbon-btn-lg ${group.isEstimate ? 'is-estimate' : ''} ${isActive ? 'active' : ''}`}
                              onClick={() => handleMainItemClick(item)}
                              title={`${t(item.labelKey)} (${item.href})`}
                            >
                              <span className="nv-btn-icon-lg">
                                <RibbonSvgIcon name={item.ribbonIcon} size={19} />
                              </span>
                              <span className="nv-btn-label-lg">{item.ribbonLabel || t(item.labelKey)}</span>
                            </button>
                          );
                        }
                        return (
                          <button
                            key={item.href}
                            type="button"
                            className={`nv-ribbon-btn-sm ${isActive ? 'active' : ''}`}
                            onClick={() => handleMainItemClick(item)}
                            title={`${t(item.labelKey)} (${item.href})`}
                          >
                            <RibbonSvgIcon name={item.ribbonIcon} size={13} />
                            <span className="nv-btn-label">{item.ribbonLabel || t(item.labelKey)}</span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="nv-ribbon-group-label" data-ribbon-group-label>
                      <span className="nv-ribbon-group-title">{group.label}</span>
                      {group.rest.length > 0 && (
                        <button
                          type="button"
                          data-nv-more-btn
                          aria-expanded={moreGroupKey === group.key}
                          aria-label={`${group.label} 확장 메뉴 (${group.rest.length})`}
                          title={`${group.label} 추가 메뉴 (${group.rest.length}개)`}
                          className={`nv-ribbon-more-btn ${moreGroupKey === group.key ? 'active' : ''}`}
                          onClick={(e) => {
                            if (moreGroupKey === group.key) {
                              setMoreGroupKey(null);
                              return;
                            }
                            setAllMenuOpen(false);
                            const rect = e.currentTarget.getBoundingClientRect();
                            setMoreAnchorRect({ left: rect.left, top: rect.bottom + 3 });
                            setMoreGroupKey(group.key);
                          }}
                        >
                          ▾
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="nv-favorites-panel" data-testid="ribbon-favorites-panel">
              <div className="nv-fav-header">
                <span className="nv-fav-title">
                  ★ 내 즐겨찾기 ({sidebarFavorites.length}개){sidebarFavorites.length === 0 ? ' · 기본 추천' : ''}
                </span>
                <input
                  type="text"
                  className="nv-fav-filter"
                  data-testid="favorites-panel-filter"
                  placeholder="즐겨찾기 빠른 필터..."
                  value={favSearch}
                  onChange={(e) => setFavSearch(e.target.value)}
                />
                <div className="nv-fav-actions">
                  <button
                    type="button"
                    className="nv-mdi-tool-btn nv-fav-head-btn"
                    data-testid="open-favorites-editor"
                    onClick={onOpenFavoritesModal}
                  >
                    ★ 편집/순서변경
                  </button>
                  <button
                    type="button"
                    className="nv-mdi-tool-btn nv-fav-head-btn"
                    data-testid="favorites-panel-close"
                    onClick={() => onToggleRibbonCollapsed?.(true)}
                    title="즐겨찾기 닫기 (ESC)"
                  >
                    닫기 ×
                  </button>
                </div>
              </div>
              <div className="nv-fav-grid" data-testid="ribbon-favorites-grid">
                {filteredFavorites.map((fav) => {
                  const original = t(fav.labelKey);
                  const alias = fav.saved?.alias;
                  const label = alias && alias !== original ? alias : original;
                  const isActive = currentPathname === fav.href.split('?')[0];
                  const isSaved = sidebarFavorites.length > 0;
                  return (
                    <button
                      key={fav.href}
                      type="button"
                      className={`nv-fav-item-btn ${isActive ? 'active' : ''}`}
                      data-testid="ribbon-favorite-item"
                      onClick={() => handleFavoriteItemClick(fav)}
                      title={`${original} (${fav.href})`}
                    >
                      <span className={`nv-fav-item-star ${isSaved ? 'saved' : 'rec'}`}>{isSaved ? '★' : '☆'}</span>
                      <span className="nv-fav-item-text">{label}</span>
                    </button>
                  );
                })}
                {filteredFavorites.length === 0 && (
                  <div className="nv-fav-empty">일치하는 즐겨찾기가 없습니다.</div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 그룹 ▾ 확장 플로팅 드롭다운 */}
      {activeMoreGroup && moreAnchorRect && (
        <div
          className="nv-ribbon-dropdown"
          data-nv-ribbon-dropdown
          style={{
            left: Math.max(8, Math.min(moreAnchorRect.left, (typeof window !== 'undefined' ? window.innerWidth : 1280) - 270)),
            top: moreAnchorRect.top,
          }}
        >
          <div className="nv-ribbon-drop-head">{activeMoreGroup.label} 추가 메뉴 ({activeMoreGroup.rest.length})</div>
          {activeMoreGroup.rest.map((item) => {
            const isFav = favoriteHrefs.has(item.href);
            return (
              <div key={item.href} className="nv-ribbon-drop-row">
                <button
                  type="button"
                  className="nv-allmenu-link"
                  onClick={() => handleMainItemClick(item)}
                >
                  {t(item.labelKey)}
                </button>
                <button
                  type="button"
                  className="nv-allmenu-pop"
                  title="새 창으로 열기"
                  onClick={() => {
                    setMoreGroupKey(null);
                    onOpenNewWindow?.(item.href);
                  }}
                >
                  ↗
                </button>
                <button
                  type="button"
                  className={`nv-allmenu-star ${isFav ? 'on' : ''}`}
                  aria-pressed={isFav}
                  disabled={!user?.userId || favoriteBusyHref !== ''}
                  onClick={(e) => toggleSidebarFavorite?.(e, item)}
                >
                  {isFav ? '★' : '☆'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* 전체메뉴 플로팅 오버레이 팝오버 (세로 레이아웃 0px 증가) */}
      {allMenuOpen && (
        <div
          className="nv-allmenu-popover"
          data-nv-allmenu-popover
          data-testid="ribbon-all-menu-panel"
          style={{
            left: Math.max(8, Math.min(allMenuAnchorRect?.left ?? 8, (typeof window !== 'undefined' ? window.innerWidth : 1280) - Math.min(1060, (typeof window !== 'undefined' ? window.innerWidth : 1280) - 16) - 8)),
            top: Math.max(32, allMenuAnchorRect?.top ?? 32),
          }}
        >
          <div className="nv-allmenu-toolbar">
            <input
              ref={allMenuSearchRef}
              type="text"
              className="filter-input"
              placeholder={`전체 ${totalMenuCount}개 메뉴 검색 (메뉴명 · 경로)...`}
              value={menuSearch}
              onChange={(e) => setMenuSearch(e.target.value)}
              style={{ width: 240, height: 24 }}
            />
            <button
              type="button"
              className={`chip ${groupFilter === 'ALL' ? 'chip-active' : 'chip-inactive'}`}
              onClick={() => setGroupFilter('ALL')}
            >
              전체 ({visibleMenuGroups.length}그룹)
            </button>
            {visibleMenuGroups.map((g) => (
              <button
                key={g.group}
                type="button"
                className={`chip ${groupFilter === g.group ? 'chip-active' : 'chip-inactive'}`}
                onClick={() => setGroupFilter(groupFilter === g.group ? 'ALL' : g.group)}
              >
                {t(g.group)} ({g.items.length})
              </button>
            ))}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  setAllMenuOpen(false);
                  onOpenFavoritesModal?.();
                }}
              >
                ★ 즐겨찾기 편집
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setAllMenuOpen(false)}
              >
                닫기 ×
              </button>
            </div>
          </div>
          <div className="nv-allmenu-grid">
            {filteredAllGroups.map((group) => (
              <div key={group.group} className="nv-allmenu-group">
                <div className="nv-allmenu-group-head">{t(group.group)} ({group.items.length})</div>
                <div>
                  {group.items.map((item) => {
                    const isFav = favoriteHrefs.has(item.href);
                    const isActive = currentPathname === item.href.split('?')[0];
                    return (
                      <div key={item.href} className={`nv-allmenu-item ${isActive ? 'active' : ''}`}>
                        <button
                          type="button"
                          className="nv-allmenu-link"
                          title={`${t(item.labelKey)} (${item.href})`}
                          onClick={() => handleAllMenuItemClick(item)}
                        >
                          {t(item.labelKey)}
                        </button>
                        <button
                          type="button"
                          className="nv-allmenu-pop"
                          title="새 창으로 열기"
                          aria-label={`${t(item.labelKey)} 새 창으로 열기`}
                          onClick={() => {
                            setAllMenuOpen(false);
                            onOpenNewWindow?.(item.href);
                          }}
                        >
                          ↗
                        </button>
                        <button
                          type="button"
                          className={`nv-allmenu-star ${isFav ? 'on' : ''}`}
                          aria-pressed={isFav}
                          disabled={!user?.userId || favoriteBusyHref !== ''}
                          title={user?.userId ? (isFav ? '즐겨찾기 해제' : '즐겨찾기에 등록') : '로그인 필요'}
                          onClick={(e) => toggleSidebarFavorite?.(e, item)}
                        >
                          {isFav ? '★' : '☆'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
