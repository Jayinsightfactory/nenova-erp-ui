// components/FavoritesEditorModal.js
// 개인 커스텀 즐겨찾기 편집기 — 13개 그룹 118개 메뉴 검색/체크 추가·제거 + 위/아래 순서 변경
import { useEffect, useMemo, useRef, useState } from 'react';

export default function FavoritesEditorModal({
  open,
  onClose,
  user,
  t = (s) => s,
  menuItems = [],
  sidebarFavorites = [],
  favoriteHrefs = new Set(),
  toggleSidebarFavorite,
  favoriteBusyHref = '',
  onUpdateFavoritesOrder,
}) {
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('ALL');
  const [reordering, setReordering] = useState(false);
  const searchRef = useRef(null);
  const previousFocusRef = useRef(null);

  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement;
      requestAnimationFrame(() => searchRef.current?.focus());
    } else if (previousFocusRef.current?.isConnected) {
      previousFocusRef.current.focus();
      previousFocusRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const visibleGroups = useMemo(() => {
    const uid = user?.userId;
    const q = search.trim().toLowerCase();
    return menuItems
      .map((g) => ({
        ...g,
        items: (g.items || []).filter((item) => {
          if (item.userIds && (!uid || !item.userIds.includes(uid))) return false;
          if (groupFilter !== 'ALL' && g.group !== groupFilter) return false;
          if (!q) return true;
          return (
            t(item.labelKey).toLowerCase().includes(q) ||
            item.href.toLowerCase().includes(q) ||
            g.group.toLowerCase().includes(q)
          );
        }),
      }))
      .filter((g) => g.items.length > 0);
  }, [menuItems, user?.userId, groupFilter, search, t]);

  const moveFavorite = async (index, direction) => {
    const targetIdx = index + direction;
    if (reordering || targetIdx < 0 || targetIdx >= sidebarFavorites.length) return;
    const nextList = [...sidebarFavorites];
    const [moved] = nextList.splice(index, 1);
    nextList.splice(targetIdx, 0, moved);
    setReordering(true);
    try {
      await onUpdateFavoritesOrder?.(nextList);
    } finally {
      setReordering(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={() => onClose?.()}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="개인 즐겨찾기 편집"
        data-testid="favorites-editor-modal"
        style={{ width: 'min(920px, calc(100vw - 24px))', maxWidth: 'min(920px, calc(100vw - 24px))', maxHeight: 'calc(100dvh - 32px)', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <span className="modal-title">★ 개인 즐겨찾기 편집 ({sidebarFavorites.length}개 등록됨)</span>
          <button type="button" className="btn btn-sm" onClick={() => onClose?.()}>✕ 닫기</button>
        </div>

        {!user?.userId && (
          <div className="banner-warn" style={{ margin: 8 }}>
            로그인 후 개인 즐겨찾기를 저장하고 순서를 변경할 수 있습니다.
          </div>
        )}

        <div
          className="modal-body"
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.35fr) minmax(240px, 1fr)',
            gap: 10,
            maxHeight: 'calc(100dvh - 150px)',
            overflow: 'hidden',
            padding: 10,
          }}
        >
          {/* 왼쪽: 전체 메뉴 체크 목록 */}
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, border: '1px solid var(--border)', background: '#FFFFFF' }}>
            <div style={{ padding: 6, background: '#F4F6F8', borderBottom: '1px solid var(--border)', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <input
                ref={searchRef}
                type="text"
                className="filter-input"
                placeholder="메뉴명 또는 경로 검색..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ flex: 1, minWidth: 140 }}
              />
              <select
                className="filter-select"
                aria-label="그룹 필터"
                value={groupFilter}
                onChange={(e) => setGroupFilter(e.target.value)}
              >
                <option value="ALL">전체 그룹</option>
                {menuItems.map((g) => (
                  <option key={g.group} value={g.group}>{t(g.group)}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1, minHeight: 240, overflowY: 'auto', padding: 6 }}>
              {visibleGroups.map((g) => (
                <div key={g.group} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 6px', background: '#E9ECEF', border: '1px solid #C4CBD2', color: '#334155' }}>
                    {t(g.group)}
                  </div>
                  {g.items.map((item) => {
                    const checked = favoriteHrefs.has(item.href);
                    return (
                      <label
                        key={item.href}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '4px 6px',
                          borderBottom: '1px solid #EEF1F4',
                          cursor: user?.userId ? 'pointer' : 'not-allowed',
                          background: checked ? '#F1F6F3' : '#FFFFFF',
                          fontSize: 12.5,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!user?.userId || favoriteBusyHref !== ''}
                          onChange={(e) => toggleSidebarFavorite?.(e, item)}
                        />
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {t(item.labelKey)}
                        </span>
                        <span style={{ fontSize: 11, color: '#64748B' }}>{item.href}</span>
                      </label>
                    );
                  })}
                </div>
              ))}
              {visibleGroups.length === 0 && (
                <div className="empty-state" style={{ padding: 24 }}>검색 결과에 맞는 메뉴가 없습니다.</div>
              )}
            </div>
          </div>

          {/* 오른쪽: 등록된 즐겨찾기 순서 변경 */}
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, border: '1px solid var(--border)', background: '#FFFFFF' }}>
            <div style={{ padding: '6px 8px', background: '#E9ECEF', borderBottom: '1px solid #C4CBD2', fontSize: 12, fontWeight: 700 }}>
              Main 리본 표시 순서 ({sidebarFavorites.length})
            </div>
            <div style={{ flex: 1, minHeight: 240, overflowY: 'auto', padding: 6 }}>
              {sidebarFavorites.length === 0 ? (
                <div style={{ padding: 16, fontSize: 12, color: '#52637A', lineHeight: 1.5 }}>
                  왼쪽 목록에서 메뉴를 체크하면 Main 리본의 ★ 즐겨찾기 영역에 즉시 추가됩니다.
                </div>
              ) : (
                sidebarFavorites.map((fav, idx) => (
                  <div
                    key={fav.href}
                    data-testid="fav-order-row"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '4px 6px',
                      borderBottom: '1px solid #EEF1F4',
                      fontSize: 12.5,
                    }}
                  >
                    <span style={{ width: 20, fontSize: 11.5, color: '#52637A', fontVariantNumeric: 'tabular-nums' }}>{idx + 1}.</span>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {fav.saved?.alias || t(fav.labelKey)}
                    </span>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={reordering || idx === 0}
                      aria-label={`${t(fav.labelKey)} 위로 이동`}
                      onClick={() => moveFavorite(idx, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={reordering || idx === sidebarFavorites.length - 1}
                      aria-label={`${t(fav.labelKey)} 아래로 이동`}
                      onClick={() => moveFavorite(idx, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={!user?.userId || favoriteBusyHref !== ''}
                      aria-label={`${t(fav.labelKey)} 즐겨찾기 삭제`}
                      onClick={(e) => toggleSidebarFavorite?.(e, fav)}
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="modal-footer" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-primary" onClick={() => onClose?.()}>확인</button>
        </div>
      </div>
    </div>
  );
}
