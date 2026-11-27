// components/MdiTabBar.js
// nenova.exe 스타일 다중 화면(MDI) 탭 바 — 탭 열기·전환·닫기·다른 탭 닫기·전체 닫기·새 창 분리·스크롤 복원
import { useRef } from 'react';

export const MDI_TABS_STORAGE_KEY = 'nv_mdi_tabs_v1';
export const MDI_SCROLL_STORAGE_KEY = 'nv_mdi_scroll_v1';
export const MAX_MDI_TABS = 24;

export function readStoredMdiTabs(storage) {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(MDI_TABS_STORAGE_KEY) || '[]');
    return Array.isArray(parsed)
      ? parsed.filter((t) => t && typeof t.href === 'string' && t.href.startsWith('/'))
      : [];
  } catch {
    return [];
  }
}

export function writeStoredMdiTabs(storage, tabs) {
  if (!storage) return;
  try {
    storage.setItem(MDI_TABS_STORAGE_KEY, JSON.stringify((tabs || []).slice(-MAX_MDI_TABS)));
  } catch {}
}

export function saveMdiTabScroll(storage, href, scrollTop) {
  if (!storage || !href) return;
  try {
    const map = JSON.parse(storage.getItem(MDI_SCROLL_STORAGE_KEY) || '{}');
    map[href] = Math.max(0, Math.round(Number(scrollTop) || 0));
    storage.setItem(MDI_SCROLL_STORAGE_KEY, JSON.stringify(map));
  } catch {}
}

export function readMdiTabScroll(storage, href) {
  if (!storage || !href) return 0;
  try {
    const map = JSON.parse(storage.getItem(MDI_SCROLL_STORAGE_KEY) || '{}');
    return Number(map[href]) || 0;
  } catch {
    return 0;
  }
}

export default function MdiTabBar({
  tabs = [],
  activePath = '',
  t = (s) => s,
  onSelectTab,
  onCloseTab,
  onCloseOtherTabs,
  onCloseAllTabs,
  onOpenInNewWindow,
  onResetLayoutSizes,
}) {
  const scrollRef = useRef(null);

  const scrollTabs = (delta) => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollBy({ left: delta, behavior: 'smooth' });
  };

  return (
    <div className="nv-mditabs-bar" data-ui-mditabs="true" role="navigation" aria-label="열린 화면 탭">
      <button
        type="button"
        className="nv-mdi-tool-btn"
        style={{ marginBottom: 3, padding: '0 5px' }}
        onClick={() => scrollTabs(-180)}
        title="왼쪽 탭 보기"
        aria-label="왼쪽 탭 스크롤"
      >
        ‹
      </button>

      <div ref={scrollRef} className="nv-mditabs-scroll" role="tablist" aria-label="열린 업무 탭">
        {tabs.map((tab) => {
          const baseHref = String(tab.href || '').split('?')[0];
          const isActive = activePath === baseHref;
          const label = t(tab.label || baseHref);
          return (
            <div
              key={tab.href}
              role="tab"
              aria-selected={isActive}
              data-mdi-tab-href={tab.href}
              className={`nv-mdi-tab ${isActive ? 'active' : ''}`}
            >
              <button
                type="button"
                className="nv-mdi-tab-btn"
                title={`${label} (${tab.asPath || tab.href})`}
                onClick={() => onSelectTab?.(tab)}
              >
                {label}
              </button>
              <button
                type="button"
                className="nv-mdi-tab-close"
                aria-label={`${label} 탭 닫기`}
                title="탭 닫기"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab?.(tab);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className="nv-mdi-tool-btn"
        style={{ marginBottom: 3, padding: '0 5px' }}
        onClick={() => scrollTabs(180)}
        title="오른쪽 탭 보기"
        aria-label="오른쪽 탭 스크롤"
      >
        ›
      </button>

      <div className="nv-mditabs-actions">
        <button
          type="button"
          className="nv-mdi-tool-btn"
          data-testid="mdi-open-new-window"
          onClick={() => onOpenInNewWindow?.()}
          title="현재 탭을 새 창으로 열기"
        >
          새 창으로
        </button>
        {tabs.length > 1 && (
          <button
            type="button"
            className="nv-mdi-tool-btn"
            data-testid="mdi-close-others"
            onClick={() => onCloseOtherTabs?.()}
            title="현재 탭 제외 모두 닫기"
          >
            다른 탭 닫기
          </button>
        )}
        {tabs.length > 1 && (
          <button
            type="button"
            className="nv-mdi-tool-btn"
            data-testid="mdi-close-all"
            onClick={() => onCloseAllTabs?.()}
            title="전체 탭 닫고 홈으로"
          >
            전체 닫기
          </button>
        )}
        <button
          type="button"
          className="nv-mdi-tool-btn"
          data-testid="nv-reset-col-widths"
          onClick={() => onResetLayoutSizes?.()}
          title="현재 화면의 테이블 열폭·분할폭 초기화"
        >
          열폭 초기화
        </button>
      </div>
    </div>
  );
}
