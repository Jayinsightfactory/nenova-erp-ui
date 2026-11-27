// components/NenovaRibbonShell.js
// nenova.exe 클래식 상단 타이틀/리본 쉘 — Main(★ 즐겨찾기 + 5대 핵심 그룹) + 전체메뉴(13그룹 118메뉴)
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

const RECOMMENDED_FAV_HREFS = [
  '/orders/new',
  '/shipment/distribute',
  '/estimate',
  '/incoming',
];

const CORE_RIBBON_GROUPS = [
  {
    key: 'orders',
    label: '주문관리',
    sourceGroup: '주문관리',
    primaryHrefs: ['/orders/new', '/orders', '/orders/paste', '/warehouse'],
  },
  {
    key: 'inout',
    label: '입/출고관리',
    sourceGroup: '입/출고관리',
    primaryHrefs: ['/incoming', '/shipment/distribute', '/shipment/week-pivot', '/arrival-cost'],
  },
  {
    key: 'estimate',
    label: '견적서 관리',
    sourceGroup: '입/출고관리',
    explicitHrefs: ['/estimate', '/estimate/weekday', '/estimate-change-history', '/catalog', '/sales/status'],
    primaryHrefs: ['/estimate', '/estimate/weekday', '/estimate-change-history', '/sales/status'],
  },
  {
    key: 'stats',
    label: '통계화면',
    sourceGroup: '통계화면',
    primaryHrefs: ['/stats/pivot', '/stock', '/stats/monthly', '/stats/volume-board'],
  },
  {
    key: 'codes',
    label: '코드관리',
    sourceGroup: '코드관리',
    primaryHrefs: ['/master/customers', '/master/products', '/master/pricing', '/master/codes'],
  },
];

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
  onResetLayoutSizes,
  ClientDateComponent,
  DesktopDownloadButtonComponent,
  MenuBackButtonNode,
  menuItems = [],
  currentPathname = '',
  onCollapseSidebar,
}) {
  const [ribbonTab, setRibbonTab] = useState('main'); // 'main' | 'all'
  const [moreGroupKey, setMoreGroupKey] = useState(null);
  const [moreAnchorRect, setMoreAnchorRect] = useState(null);
  const [menuSearch, setMenuSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('ALL');
  const shellRef = useRef(null);

  const visibleMenuGroups = useMemo(() => {
    const uid = user?.userId;
    return menuItems
      .map((group) => ({
        ...group,
        items: (group.items || []).filter((item) => !item.userIds || (uid && item.userIds.includes(uid))),
      }))
      .filter((group) => group.items.length > 0);
  }, [menuItems, user?.userId]);

  const itemByHref = useMemo(() => {
    const map = new Map();
    for (const group of visibleMenuGroups) {
      for (const item of group.items) map.set(item.href, item);
    }
    return map;
  }, [visibleMenuGroups]);

  const coreGroups = useMemo(() => {
    return CORE_RIBBON_GROUPS.map((def) => {
      let items;
      if (def.explicitHrefs) {
        items = def.explicitHrefs.map((h) => itemByHref.get(h)).filter(Boolean);
      } else {
        const src = visibleMenuGroups.find((g) => g.group === def.sourceGroup);
        items = src ? src.items : [];
      }
      const primarySet = new Set(def.primaryHrefs);
      const primary = def.primaryHrefs.map((h) => items.find((i) => i.href === h)).filter(Boolean);
      const rest = items.filter((i) => !primarySet.has(i.href));
      return { ...def, items, primary, rest };
    }).filter((g) => g.items.length > 0);
  }, [visibleMenuGroups, itemByHref]);

  const recommendedFavorites = useMemo(
    () => RECOMMENDED_FAV_HREFS.map((h) => itemByHref.get(h)).filter(Boolean),
    [itemByHref]
  );

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

  const handleItemClick = (item) => {
    setMoreGroupKey(null);
    if (ribbonTab === 'all') setRibbonTab('main');
    onOpenTab?.(item);
  };

  if (navMode === 'sidebar') {
    return (
      <div className="topbar nv-topbar-classic" data-ui-topbar style={{ minHeight: 34 }}>
        <span data-ui-page-title className="nv-topbar-title">{t(pageTitle)}</span>
        <span className="nv-topbar-actions">
          {ClientDateComponent && <ClientDateComponent />}
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
          <button
            type="button"
            className="nv-top-btn"
            onClick={toggleLang}
          >
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

  return (
    <div ref={shellRef} data-nv-ribbon-shell>
      <div className="topbar nv-topbar-classic" data-ui-topbar>
        <Link href="/dashboard" className="nv-brand-badge" title={process.env.NEXT_PUBLIC_BUILD_VERSION || 'nenova ERP'}>
          <span>nenova ERP</span>
          <span className="nv-brand-ver">{process.env.NEXT_PUBLIC_BUILD_VERSION || 'v?'}</span>
        </Link>

        <div className="nv-ribbon-tabs" role="tablist" aria-label="리본 메뉴 탭">
          <button
            type="button"
            role="tab"
            aria-selected={ribbonTab === 'main'}
            className={`nv-ribbon-tab ${ribbonTab === 'main' ? 'active' : ''}`}
            data-testid="ribbon-tab-main"
            onClick={() => {
              setRibbonTab('main');
              if (ribbonCollapsed) onToggleRibbonCollapsed?.(false);
            }}
          >
            Main
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={ribbonTab === 'all'}
            className={`nv-ribbon-tab ${ribbonTab === 'all' ? 'active' : ''}`}
            data-testid="ribbon-tab-all"
            onClick={() => {
              setRibbonTab('all');
              if (ribbonCollapsed) onToggleRibbonCollapsed?.(false);
            }}
          >
            전체메뉴 ({visibleMenuGroups.reduce((sum, g) => sum + g.items.length, 0)})
          </button>
        </div>

        <span data-ui-page-title className="nv-topbar-title">{t(pageTitle)}</span>

        <span className="nv-topbar-actions">
          {ClientDateComponent && <ClientDateComponent />}
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
            {ribbonCollapsed ? '▼ 리본 펼치기' : '▲ 리본 접기'}
          </button>
          <button
            type="button"
            className="nv-top-btn"
            data-testid="nav-mode-toggle"
            onClick={() => onToggleNavMode?.('sidebar')}
            title="왼쪽 사이드바 보기로 전환"
          >
            사이드바 전환
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
        <div className="nv-ribbon-panel" data-ui-ribbon>
          {ribbonTab === 'main' ? (
            <div className="nv-ribbon-groups">
              {/* 맨 왼쪽 고정 그룹: ★ 즐겨찾기 */}
              <div className="nv-ribbon-group nv-ribbon-group-fav" data-testid="ribbon-favorites-group">
                <div className="nv-ribbon-group-items">
                  {sidebarFavorites.length > 0 ? (
                    sidebarFavorites.map((fav) => {
                      const original = t(fav.labelKey);
                      const alias = fav.saved?.alias;
                      const label = alias && alias !== original ? alias : original;
                      const isActive = currentPathname === fav.href.split('?')[0];
                      return (
                        <button
                          key={fav.href}
                          type="button"
                          className={`nv-ribbon-btn ${isActive ? 'active' : ''}`}
                          onClick={() => handleItemClick(fav)}
                          title={`${original} (${fav.href})`}
                        >
                          <span style={{ color: '#B45309' }}>★</span>
                          <span>{label}</span>
                        </button>
                      );
                    })
                  ) : (
                    recommendedFavorites.map((item) => (
                      <button
                        key={item.href}
                        type="button"
                        className={`nv-ribbon-btn ${currentPathname === item.href ? 'active' : ''}`}
                        onClick={() => handleItemClick(item)}
                        title="기본 추천 메뉴 — ★ 편집으로 개인 즐겨찾기 구성 가능"
                      >
                        <span style={{ color: '#94A3B8' }}>☆</span>
                        <span>{t(item.labelKey)}</span>
                      </button>
                    ))
                  )}
                </div>
                <div className="nv-ribbon-group-label">
                  <span>★ 즐겨찾기 {sidebarFavorites.length > 0 ? `(${sidebarFavorites.length})` : '(기본 추천)'}</span>
                  <button
                    type="button"
                    className="nv-mdi-tool-btn"
                    data-testid="open-favorites-editor"
                    onClick={onOpenFavoritesModal}
                    style={{ height: 18, fontSize: 11, padding: '0 5px' }}
                  >
                    ★ 편집
                  </button>
                </div>
              </div>

              {/* nenova.exe 핵심 5대 그룹 */}
              {coreGroups.map((group) => (
                <div key={group.key} className="nv-ribbon-group">
                  <div className="nv-ribbon-group-items">
                    {group.primary.map((item) => {
                      const isActive = currentPathname === item.href.split('?')[0];
                      return (
                        <button
                          key={item.href}
                          type="button"
                          className={`nv-ribbon-btn ${isActive ? 'active' : ''}`}
                          onClick={() => handleItemClick(item)}
                        >
                          {t(item.labelKey)}
                        </button>
                      );
                    })}
                    {group.rest.length > 0 && (
                      <button
                        type="button"
                        data-nv-more-btn
                        aria-expanded={moreGroupKey === group.key}
                        className="nv-ribbon-btn nv-ribbon-btn-more"
                        onClick={(e) => {
                          if (moreGroupKey === group.key) {
                            setMoreGroupKey(null);
                            return;
                          }
                          const rect = e.currentTarget.getBoundingClientRect();
                          setMoreAnchorRect({ left: rect.left, top: rect.bottom + 2 });
                          setMoreGroupKey(group.key);
                        }}
                      >
                        더보기 ({group.rest.length}) ▾
                      </button>
                    )}
                  </div>
                  <div className="nv-ribbon-group-label">
                    <span>{group.label}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="nv-allmenu-panel" data-testid="ribbon-all-menu-panel">
              <div className="nv-allmenu-toolbar">
                <input
                  type="text"
                  className="filter-input"
                  placeholder="전체 118개 메뉴 검색 (메뉴명 · 경로)..."
                  value={menuSearch}
                  onChange={(e) => setMenuSearch(e.target.value)}
                  style={{ width: 250 }}
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
                <button
                  type="button"
                  className="btn btn-sm"
                  style={{ marginLeft: 'auto' }}
                  onClick={onOpenFavoritesModal}
                >
                  ★ 즐겨찾기 순서·일괄 편집
                </button>
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
                              onClick={() => handleItemClick(item)}
                            >
                              {t(item.labelKey)}
                            </button>
                            <button
                              type="button"
                              className="nv-allmenu-pop"
                              title="새 창으로 열기"
                              aria-label={`${t(item.labelKey)} 새 창으로 열기`}
                              onClick={() => onOpenNewWindow?.(item.href)}
                            >
                              ↗
                            </button>
                            <button
                              type="button"
                              className={`nv-allmenu-star ${isFav ? 'on' : ''}`}
                              aria-pressed={isFav}
                              disabled={!user?.userId || favoriteBusyHref !== ''}
                              title={user?.userId ? (isFav ? '즐겨찾기 해제' : 'Main 즐겨찾기에 등록') : '로그인 필요'}
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
      )}

      {/* 더보기 드롭다운 */}
      {activeMoreGroup && moreAnchorRect && (
        <div
          className="nv-ribbon-dropdown"
          data-nv-ribbon-dropdown
          style={{
            left: Math.max(8, Math.min(moreAnchorRect.left, (typeof window !== 'undefined' ? window.innerWidth : 1280) - 280)),
            top: moreAnchorRect.top,
          }}
        >
          {activeMoreGroup.rest.map((item) => {
            const isFav = favoriteHrefs.has(item.href);
            return (
              <div key={item.href} className="nv-ribbon-drop-row">
                <button
                  type="button"
                  className="nv-allmenu-link"
                  onClick={() => handleItemClick(item)}
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
    </div>
  );
}
