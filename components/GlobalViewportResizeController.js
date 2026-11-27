// components/GlobalViewportResizeController.js
// 전 탭 동적 세로폭(--nv-avail-h), 테이블 컬럼 드래그 리사이즈/자동맞춤/저장,
// 분할 패널(.split-panel) 드래그 스플리터 + 접기/펼치기 통합 컨트롤러
import { useEffect } from 'react';
import { useRouter } from 'next/router';

const COL_WIDTH_PREFIX = 'nv_col_widths_v1:';
const SPLIT_RATIO_PREFIX = 'nv_split_ratio_v1:';
export const RESET_LAYOUT_SIZES_EVENT = 'nv:reset-layout-sizes';

function readJsonStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function getHeaderRow(table) {
  const rows = table.querySelectorAll(':scope > thead > tr');
  if (!rows.length) return null;
  if (rows.length === 1) return rows[0];
  // 다중 행 헤더일 경우 colSpan이 없는 최하위 라벨 행을 우선 선택
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const ths = rows[i].querySelectorAll(':scope > th');
    if (ths.length > 0) return rows[i];
  }
  return rows[0];
}

function ensureColgroupForTable(table, count) {
  let cg = table.querySelector(':scope > colgroup[data-nv-colgroup]');
  if (!cg) {
    cg = document.createElement('colgroup');
    cg.setAttribute('data-nv-colgroup', '1');
    table.insertBefore(cg, table.firstChild);
  }
  while (cg.children.length < count) cg.appendChild(document.createElement('col'));
  while (cg.children.length > count) cg.lastChild.remove();
  return cg;
}

function measureAutoFitWidth(table, th, colIndex) {
  const canvas = measureAutoFitWidth.canvas || (measureAutoFitWidth.canvas = document.createElement('canvas'));
  const ctx = canvas.getContext('2d');
  const style = getComputedStyle(th);
  if (ctx) ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;

  let maxW = ctx ? ctx.measureText((th.textContent || '').trim()).width + 24 : 90;
  const rows = table.querySelectorAll(':scope > tbody > tr');
  const limit = Math.min(rows.length, 100);
  for (let i = 0; i < limit; i += 1) {
    const cell = rows[i].children[colIndex];
    if (!cell || cell.colSpan > 1) continue;
    const text = (cell.textContent || '').trim();
    if (!text) continue;
    const w = ctx ? ctx.measureText(text).width + 20 : text.length * 8 + 20;
    if (w > maxW) maxW = w;
  }
  return Math.max(48, Math.min(480, Math.round(maxW)));
}

export default function GlobalViewportResizeController() {
  const router = useRouter();
  const pathname = router.pathname || '/';

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;

    const rootEl = document.documentElement;
    const colStorageKey = `${COL_WIDTH_PREFIX}${pathname}`;
    const splitStorageKey = `${SPLIT_RATIO_PREFIX}${pathname}`;

    let splitOverlayHost = document.querySelector('.nv-split-overlay-host');
    if (!splitOverlayHost) {
      splitOverlayHost = document.createElement('div');
      splitOverlayHost.className = 'nv-split-overlay-host';
      document.body.appendChild(splitOverlayHost);
    }

    const updateViewportVars = () => {
      const pageArea = document.querySelector('.page-area');
      const popupBody = document.querySelector('[data-ui-shell="popup"] > div:last-child');
      const host = pageArea || popupBody;
      let topOffset = 0;
      if (host) {
        const rect = host.getBoundingClientRect();
        topOffset = Math.max(0, Math.round(rect.top));
      } else {
        const ribbon = document.querySelector('[data-ui-ribbon]');
        const mditabs = document.querySelector('[data-ui-mditabs]');
        const topbar = document.querySelector('[data-ui-topbar]');
        const popupbar = document.querySelector('[data-ui-popupbar]');
        const candidates = [topbar, ribbon, mditabs, popupbar].filter((el) => el && getComputedStyle(el).display !== 'none');
        topOffset = candidates.reduce((maxBottom, el) => Math.max(maxBottom, Math.round(el.getBoundingClientRect().bottom)), 0);
      }
      const availH = Math.max(240, window.innerHeight - topOffset);
      const innerH = Math.max(200, availH - 14);
      rootEl.style.setProperty('--nv-top-offset', `${topOffset}px`);
      rootEl.style.setProperty('--nv-avail-h', `${availH}px`);
      rootEl.style.setProperty('--nv-page-inner-h', `${innerH}px`);
    };

    const applyColumnWidths = (table, tableIdx, widthsMap) => {
      const headerRow = getHeaderRow(table);
      if (!headerRow) return;
      const ths = [...headerRow.querySelectorAll(':scope > th')];
      if (!ths.length) return;
      const tableWidths = widthsMap[String(tableIdx)];
      if (!tableWidths || Object.keys(tableWidths).length === 0) return;

      const cg = ensureColgroupForTable(table, ths.length);
      let totalW = 0;
      ths.forEach((th, idx) => {
        const saved = Number(tableWidths[String(idx)]);
        const width = Number.isFinite(saved) && saved >= 32
          ? saved
          : Math.max(36, Math.round(th.getBoundingClientRect().width || 80));
        const col = cg.children[idx];
        if (col) col.style.width = `${width}px`;
        th.style.width = `${width}px`;
        th.style.minWidth = `${width}px`;
        totalW += width;
      });
      table.dataset.nvHasResizedCols = '1';
      table.style.tableLayout = 'fixed';
      if (totalW > 0) table.style.width = `${totalW}px`;
    };

    const enhanceTables = () => {
      const savedMap = readJsonStorage(colStorageKey, {});
      const tables = [...document.querySelectorAll('table.tbl')].filter((table) => {
        if (table.classList.contains('tbl-pivot')) return false;
        if (table.hasAttribute('data-custom-col-resize')) return false;
        if (table.closest('.ant-table')) return false;
        if (table.closest('[aria-hidden="true"]')) return false;
        if (table.querySelector('.col-resize-handle')) return false;
        return true;
      });

      tables.forEach((table, tableIdx) => {
        table.dataset.nvTableIndex = String(tableIdx);
        const headerRow = getHeaderRow(table);
        if (!headerRow) return;
        const ths = [...headerRow.querySelectorAll(':scope > th')];
        if (ths.length < 2) return;

        applyColumnWidths(table, tableIdx, savedMap);

        ths.forEach((th, colIdx) => {
          if (th.colSpan > 1) return;
          if (th.querySelector('.nv-col-resizer')) return;
          if (getComputedStyle(th).position === 'static') {
            th.dataset.nvPosRel = '1';
          }
          th.dataset.nvResizable = '1';
          const handle = document.createElement('span');
          handle.className = 'nv-col-resizer';
          handle.setAttribute('role', 'separator');
          handle.setAttribute('aria-orientation', 'vertical');
          handle.title = '드래그하여 열 너비 조절 · 더블클릭으로 자동 맞춤';

          handle.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
          });

          handle.addEventListener('dblclick', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const currentMap = readJsonStorage(colStorageKey, {});
            const tKey = String(tableIdx);
            const nextTableMap = { ...(currentMap[tKey] || {}) };
            ths.forEach((h, i) => {
              if (!nextTableMap[String(i)]) {
                nextTableMap[String(i)] = Math.max(36, Math.round(h.getBoundingClientRect().width || 80));
              }
            });
            nextTableMap[String(colIdx)] = measureAutoFitWidth(table, th, colIdx);
            currentMap[tKey] = nextTableMap;
            writeJsonStorage(colStorageKey, currentMap);
            applyColumnWidths(table, tableIdx, currentMap);
          });

          handle.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            const startX = e.clientX;
            const currentWidths = ths.map((h) => Math.max(36, Math.round(h.getBoundingClientRect().width || 80)));
            const startW = currentWidths[colIdx];
            handle.classList.add('dragging');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';

            const currentMap = readJsonStorage(colStorageKey, {});
            const tKey = String(tableIdx);
            const nextTableMap = { ...(currentMap[tKey] || {}) };
            currentWidths.forEach((w, i) => {
              if (!nextTableMap[String(i)]) nextTableMap[String(i)] = w;
            });

            const onMove = (moveEvt) => {
              const newW = Math.max(36, Math.min(820, Math.round(startW + (moveEvt.clientX - startX))));
              nextTableMap[String(colIdx)] = newW;
              currentMap[tKey] = nextTableMap;
              applyColumnWidths(table, tableIdx, currentMap);
              writeJsonStorage(colStorageKey, currentMap);
            };

            const onUp = () => {
              handle.classList.remove('dragging');
              document.body.style.cursor = '';
              document.body.style.userSelect = '';
              writeJsonStorage(colStorageKey, currentMap);
              window.removeEventListener('mousemove', onMove, true);
              window.removeEventListener('mouseup', onUp, true);
            };

            window.addEventListener('mousemove', onMove, true);
            window.addEventListener('mouseup', onUp, true);
          });

          th.appendChild(handle);
        });
      });
    };

    const syncSplitPanels = () => {
      if (!splitOverlayHost) return;
      splitOverlayHost.innerHTML = '';
      if (window.innerWidth <= 900) return;

      const savedSplit = readJsonStorage(splitStorageKey, {});
      const panels = [...document.querySelectorAll('.split-panel')].filter((panel) => {
        if (panel.closest('[aria-hidden="true"]')) return false;
        const kids = [...panel.children].filter((el) => getComputedStyle(el).display !== 'none');
        return kids.length === 2;
      });

      panels.forEach((panel, splitIdx) => {
        const sKey = String(splitIdx);
        const state = savedSplit[sKey] || {};
        const leftChild = panel.children[0];
        const rightChild = panel.children[1];

        if (state.collapsed === 'left') {
          panel.setAttribute('data-nv-split-collapsed', 'left');
          panel.style.gridTemplateColumns = '0px minmax(0, 1fr)';
        } else if (state.collapsed === 'right') {
          panel.setAttribute('data-nv-split-collapsed', 'right');
          panel.style.gridTemplateColumns = 'minmax(0, 1fr) 0px';
        } else {
          panel.removeAttribute('data-nv-split-collapsed');
          if (Number.isFinite(state.ratioPct)) {
            const pct = Math.max(15, Math.min(85, state.ratioPct));
            panel.style.gridTemplateColumns = `minmax(180px, ${pct}%) minmax(180px, ${100 - pct}%)`;
          }
        }

        const panelRect = panel.getBoundingClientRect();
        if (panelRect.width < 280 || panelRect.height < 40) return;

        const leftRect = leftChild.getBoundingClientRect();
        const rightRect = rightChild.getBoundingClientRect();
        let gutterX = (leftRect.right + rightRect.left) / 2 - 5;
        if (state.collapsed === 'left') gutterX = panelRect.left + 2;
        if (state.collapsed === 'right') gutterX = panelRect.right - 12;

        const gutter = document.createElement('div');
        gutter.className = 'nv-split-gutter';
        gutter.dataset.nvSplitIndex = sKey;
        gutter.style.left = `${Math.round(gutterX)}px`;
        gutter.style.top = `${Math.max(0, Math.round(panelRect.top))}px`;
        gutter.style.height = `${Math.max(40, Math.min(window.innerHeight - Math.max(0, panelRect.top), Math.round(panelRect.height)))}px`;
        gutter.title = '드래그하여 좌우 폭 조절';

        const pill = document.createElement('div');
        pill.className = 'nv-split-btn-pill';

        const leftBtn = document.createElement('button');
        leftBtn.type = 'button';
        leftBtn.className = 'nv-split-toggle-btn';
        leftBtn.dataset.testid = `split-collapse-left-${splitIdx}`;
        leftBtn.textContent = state.collapsed === 'left' ? '▶' : '◀';
        leftBtn.title = state.collapsed === 'left' ? '왼쪽 패널 펼치기' : '왼쪽 패널 접기';
        leftBtn.addEventListener('mousedown', (e) => e.stopPropagation());
        leftBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const next = readJsonStorage(splitStorageKey, {});
          const cur = next[sKey] || {};
          next[sKey] = { ...cur, collapsed: cur.collapsed === 'left' ? null : 'left' };
          writeJsonStorage(splitStorageKey, next);
          syncSplitPanels();
        });

        const rightBtn = document.createElement('button');
        rightBtn.type = 'button';
        rightBtn.className = 'nv-split-toggle-btn';
        rightBtn.dataset.testid = `split-collapse-right-${splitIdx}`;
        rightBtn.textContent = state.collapsed === 'right' ? '◀' : '▶';
        rightBtn.title = state.collapsed === 'right' ? '오른쪽 패널 펼치기' : '오른쪽 패널 접기';
        rightBtn.addEventListener('mousedown', (e) => e.stopPropagation());
        rightBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const next = readJsonStorage(splitStorageKey, {});
          const cur = next[sKey] || {};
          next[sKey] = { ...cur, collapsed: cur.collapsed === 'right' ? null : 'right' };
          writeJsonStorage(splitStorageKey, next);
          syncSplitPanels();
        });

        pill.appendChild(leftBtn);
        pill.appendChild(rightBtn);
        gutter.appendChild(pill);

        gutter.addEventListener('mousedown', (e) => {
          if (e.button !== 0 || e.target.closest('button')) return;
          e.preventDefault();
          e.stopPropagation();
          const rect = panel.getBoundingClientRect();
          if (rect.width <= 0) return;
          gutter.classList.add('dragging');
          document.body.style.cursor = 'col-resize';
          document.body.style.userSelect = 'none';

          const onMove = (moveEvt) => {
            const relX = moveEvt.clientX - rect.left;
            const pct = Math.max(18, Math.min(82, Math.round((relX / rect.width) * 1000) / 10));
            panel.removeAttribute('data-nv-split-collapsed');
            panel.style.gridTemplateColumns = `minmax(180px, ${pct}%) minmax(180px, ${100 - pct}%)`;
            const next = readJsonStorage(splitStorageKey, {});
            next[sKey] = { ratioPct: pct, collapsed: null };
            writeJsonStorage(splitStorageKey, next);
            gutter.style.left = `${Math.round(rect.left + (rect.width * pct) / 100 - 5)}px`;
          };

          const onUp = () => {
            gutter.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            window.removeEventListener('mousemove', onMove, true);
            window.removeEventListener('mouseup', onUp, true);
            syncSplitPanels();
          };

          window.addEventListener('mousemove', onMove, true);
          window.addEventListener('mouseup', onUp, true);
        });

        splitOverlayHost.appendChild(gutter);
      });
    };

    let rafId = 0;
    const scheduleRefresh = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        updateViewportVars();
        enhanceTables();
        syncSplitPanels();
      });
    };

    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleRefresh) : null;
    if (resizeObserver) {
      resizeObserver.observe(document.body);
      document.querySelectorAll('[data-ui-topbar], [data-ui-ribbon], [data-ui-mditabs], [data-ui-popupbar]').forEach((el) => {
        resizeObserver.observe(el);
      });
    }

    const mutationObserver = typeof MutationObserver === 'function'
      ? new MutationObserver((mutations) => {
          const relevant = mutations.some((m) => !m.target?.closest?.('.nv-split-overlay-host'));
          if (relevant) scheduleRefresh();
        })
      : null;
    if (mutationObserver) {
      mutationObserver.observe(document.body, { childList: true, subtree: true });
    }

    const onResetSizes = () => {
      try {
        localStorage.removeItem(colStorageKey);
        localStorage.removeItem(splitStorageKey);
      } catch {}
      document.querySelectorAll('table.tbl[data-nv-has-resized-cols="1"]').forEach((table) => {
        delete table.dataset.nvHasResizedCols;
        table.style.tableLayout = '';
        table.style.width = '';
        table.querySelector(':scope > colgroup[data-nv-colgroup]')?.remove();
        table.querySelectorAll(':scope > thead th').forEach((th) => {
          th.style.width = '';
          th.style.minWidth = '';
        });
      });
      document.querySelectorAll('.split-panel').forEach((panel) => {
        panel.removeAttribute('data-nv-split-collapsed');
        panel.style.gridTemplateColumns = '';
      });
      scheduleRefresh();
    };

    window.addEventListener('resize', scheduleRefresh);
    window.addEventListener('scroll', syncSplitPanels, true);
    window.addEventListener(RESET_LAYOUT_SIZES_EVENT, onResetSizes);
    scheduleRefresh();

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener('resize', scheduleRefresh);
      window.removeEventListener('scroll', syncSplitPanels, true);
      window.removeEventListener(RESET_LAYOUT_SIZES_EVENT, onResetSizes);
      if (splitOverlayHost) splitOverlayHost.innerHTML = '';
    };
  }, [pathname]);

  return null;
}
