import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { apiDelete, apiGet, apiPost } from '../lib/useApi';
import { useLang } from '../lib/i18n';
import { MENU_ITEMS, openPopup } from '../components/Layout';

const fmt = n => Number(n || 0).toLocaleString();
const DASHBOARD_MENU_PAGE = 'dashboard-menu';

const MENU_ICONS = {
  주문관리: '📋',
  '입/출고관리': '🚚',
  구매관리: '🧾',
  채권관리: '💰',
  재무관리: '🏦',
  통계화면: '📊',
  코드관리: '⚙️',
};

function parseFavorite(fav) {
  try {
    const data = JSON.parse(fav.FilterData || '{}');
    return { ...fav, data };
  } catch {
    return { ...fav, data: null };
  }
}

export default function Dashboard() {
  const { t } = useLang();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [menuFavorites, setMenuFavorites] = useState([]);
  const [menuPickerOpen, setMenuPickerOpen] = useState(false);
  const [menuSearch, setMenuSearch] = useState('');
  const [menuSaving, setMenuSaving] = useState(false);

  useEffect(() => {
    apiGet('/api/stats/dashboard')
      .then(d => setData(d))
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
    loadMenuFavorites();
  }, []);

  const allMenus = useMemo(() => (
    MENU_ITEMS.flatMap(group => group.items.map(item => ({
      ...item,
      group: group.group,
      label: t(item.labelKey),
      icon: MENU_ICONS[group.group] || '•',
    })))
  ), [t]);

  const selectedHrefs = useMemo(() => new Set(
    menuFavorites.map(f => f.data?.href).filter(Boolean)
  ), [menuFavorites]);

  const visiblePickerMenus = useMemo(() => {
    const q = menuSearch.trim().toLowerCase();
    if (!q) return allMenus;
    return allMenus.filter(item =>
      item.href.toLowerCase().includes(q) ||
      item.label.toLowerCase().includes(q) ||
      t(item.group).toLowerCase().includes(q)
    );
  }, [allMenus, menuSearch, t]);

  async function loadMenuFavorites() {
    try {
      const d = await apiGet('/api/favorites', { page: DASHBOARD_MENU_PAGE });
      setMenuFavorites((d.favorites || []).map(parseFavorite).filter(f => f.data?.href));
    } catch {
      setMenuFavorites([]);
    }
  }

  function openWorkMenu(item) {
    if (!item?.href) return;
    const label = item.label || t(item.labelKey || item.href);
    if (item.popup) {
      openPopup(item.href, label);
      return;
    }
    // 새 창은 사이드바 없는 팝업 모드로 — 메인 창 메뉴와 중복 방지. window.opener 감지가
    // 런처/COOP 환경에서 실패해도 확실히 팝업모드로 뜨도록 ?popup=1 을 명시한다.
    window.open(
      `${item.href}${item.href.includes('?') ? '&' : '?'}popup=1`,
      item.href.replace(/[^a-z0-9]/gi, '_') || '_blank',
      `width=${Math.max(1200, screen.width - 80)},height=${Math.max(760, screen.height - 80)},left=20,top=20,resizable=yes,scrollbars=yes`
    );
  }

  async function addMenuFavorite(item) {
    if (!item || selectedHrefs.has(item.href)) return;
    setMenuSaving(true);
    try {
      await apiPost('/api/favorites', {
        page: DASHBOARD_MENU_PAGE,
        name: item.labelKey,
        filterData: JSON.stringify({
          href: item.href,
          labelKey: item.labelKey,
          group: item.group,
          popup: !!item.popup,
          fullscreen: !!item.fullscreen,
        }),
      });
      await loadMenuFavorites();
    } catch (e) {
      alert(`메뉴 즐겨찾기 저장 실패: ${e.message}`);
    } finally {
      setMenuSaving(false);
    }
  }

  async function removeMenuFavorite(favoriteKey) {
    if (!favoriteKey) return;
    setMenuSaving(true);
    try {
      await apiDelete('/api/favorites', { favoriteKey });
      await loadMenuFavorites();
    } catch (e) {
      alert(`메뉴 즐겨찾기 삭제 실패: ${e.message}`);
    } finally {
      setMenuSaving(false);
    }
  }

  const kpi = data?.kpi || {};
  const salesByArea = data?.salesByArea || [];
  const topCustomers = data?.topCustomers || [];
  const favoriteGridStyle = {
    padding: 12,
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, 176px)',
    gap: 10,
    alignItems: 'stretch',
    justifyContent: 'start',
  };
  const favoriteButtonStyle = {
    width: '100%',
    height: 92,
    boxSizing: 'border-box',
    textAlign: 'left',
    padding: '12px 36px 11px 14px',
    border: '1px solid #dbe3ea',
    borderRadius: 8,
    background: '#fff',
    boxShadow: '0 1px 3px rgba(15,23,42,0.06)',
    cursor: 'pointer',
    display: 'grid',
    gridTemplateRows: '1fr auto',
    overflow: 'hidden',
  };

  if (loading) return <div className="skeleton" style={{ height: 200 }}></div>;

  return (
    <div>
      {err && <div className="banner-err">⚠️ DB 연결 오류: {err}</div>}

      <div className="banner-info">
        실시간 DB 연결됨 — {data?.week} 차수 ({data?.year}) | 조회/등록: 실제 전산 DB
      </div>

      {/* 개인 메뉴 즐겨찾기 */}
      <div className="card" style={{ marginBottom: 6, border: '1px solid #d6e0ee', background: '#f8fbff' }}>
        <div className="card-header" style={{ minHeight: 34, alignItems: 'center' }}>
          <span className="card-title">■ 내 즐겨찾기 메뉴</span>
          <button
            onClick={() => setMenuPickerOpen(true)}
            style={{
              marginLeft: 'auto',
              height: 28,
              padding: '0 12px',
              border: '1px solid #1d4ed8',
              borderRadius: 6,
              background: '#2563eb',
              color: '#fff',
              fontSize: 12,
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            즐겨찾는 메뉴 추가하기
          </button>
        </div>
        <div style={favoriteGridStyle}>
          {menuFavorites.length === 0 ? (
            <button
              onClick={() => setMenuPickerOpen(true)}
              style={{
                width: 176,
                height: 92,
                boxSizing: 'border-box',
                border: '1px dashed #93c5fd',
                borderRadius: 8,
                background: '#eff6ff',
                color: '#1d4ed8',
                fontWeight: 900,
                cursor: 'pointer',
                padding: '0 14px',
                lineHeight: 1.25,
              }}
            >
              + 즐겨찾는 메뉴 추가하기
            </button>
          ) : menuFavorites.map(fav => {
            const menu = allMenus.find(m => m.href === fav.data.href) || fav.data;
            const label = menu.label || t(menu.labelKey || fav.FavName);
            const group = menu.group || fav.data.group || '';
            const icon = MENU_ICONS[group] || '•';
            return (
              <div key={fav.FavoriteKey} style={{ position: 'relative' }}>
                <button
                  onClick={() => openWorkMenu({ ...menu, ...fav.data, label })}
                  style={favoriteButtonStyle}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, minWidth: 0 }}>
                    <span style={{ fontSize: 22, lineHeight: 1, flex: '0 0 auto' }}>{icon}</span>
                    <span style={{ fontSize: 14, fontWeight: 900, color: '#0f172a', lineHeight: 1.22, wordBreak: 'keep-all' }}>{label}</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {t(group)} · 새 창으로 열기
                  </div>
                </button>
                <button
                  onClick={() => removeMenuFavorite(fav.FavoriteKey)}
                  disabled={menuSaving}
                  title="즐겨찾기에서 제거"
                  style={{
                    position: 'absolute',
                    right: 7,
                    top: 7,
                    width: 22,
                    height: 22,
                    border: '1px solid #e2e8f0',
                    borderRadius: 11,
                    background: '#fff',
                    color: '#94a3b8',
                    cursor: menuSaving ? 'wait' : 'pointer',
                    fontWeight: 900,
                    lineHeight: '18px',
                  }}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
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

      {menuPickerOpen && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(15,23,42,0.35)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}>
          <div style={{
            width: 'min(920px, 96vw)',
            maxHeight: '86vh',
            background: '#fff',
            border: '1px solid #cbd5e1',
            borderRadius: 10,
            boxShadow: '0 18px 44px rgba(15,23,42,0.24)',
            display: 'grid',
            gridTemplateRows: 'auto auto 1fr',
            overflow: 'hidden',
          }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div>
                <div style={{ fontSize: 17, fontWeight: 900, color: '#0f172a' }}>즐겨찾는 메뉴 추가하기</div>
                <div style={{ marginTop: 3, fontSize: 12, color: '#64748b' }}>홈에 올릴 메뉴를 선택하세요. 저장된 메뉴는 클릭하면 새 창으로 열립니다.</div>
              </div>
              <button
                onClick={() => setMenuPickerOpen(false)}
                style={{ marginLeft: 'auto', height: 30, padding: '0 11px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', cursor: 'pointer' }}
              >
                닫기
              </button>
            </div>
            <div style={{ padding: 12, borderBottom: '1px solid #e2e8f0' }}>
              <input
                value={menuSearch}
                onChange={e => setMenuSearch(e.target.value)}
                placeholder="메뉴명, 그룹명으로 검색"
                style={{ width: '100%', height: 36, border: '1px solid #cbd5e1', borderRadius: 7, padding: '0 11px', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ overflow: 'auto', padding: 12 }}>
              {MENU_ITEMS.map(group => {
                const items = visiblePickerMenus.filter(item => item.group === group.group);
                if (items.length === 0) return null;
                return (
                  <div key={group.group} style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 900, color: '#475569', margin: '0 0 7px 2px' }}>
                      {MENU_ICONS[group.group] || '•'} {t(group.group)}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 8 }}>
                      {items.map(item => {
                        const added = selectedHrefs.has(item.href);
                        return (
                          <button
                            key={item.href}
                            onClick={() => addMenuFavorite(item)}
                            disabled={added || menuSaving}
                            style={{
                              minHeight: 52,
                              textAlign: 'left',
                              padding: '9px 11px',
                              border: added ? '1px solid #bbf7d0' : '1px solid #dbe3ea',
                              borderRadius: 8,
                              background: added ? '#f0fdf4' : '#fff',
                              cursor: added ? 'default' : 'pointer',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                              <span style={{ fontSize: 13, fontWeight: 900, color: '#0f172a' }}>{item.label}</span>
                              <span style={{ fontSize: 11, color: added ? '#16a34a' : '#2563eb', fontWeight: 800 }}>
                                {added ? '추가됨' : '+ 추가'}
                              </span>
                            </div>
                            <div style={{ marginTop: 4, fontSize: 11, color: '#94a3b8' }}>{item.href}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
