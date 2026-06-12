// lib/useColumnResize.js
// 테이블 컬럼 드래그 리사이즈 훅
// deps: 컬럼 구조 변경 시 핸들 재부착 (예: [data, showSections, compact])
// options.headerSelector: 리사이즈 대상 th (기본 'th')
// options.minWidth: 최소 px (기본 18)
// options.defaultWidth: 기본 px (기본 52)
// options.defaultGroupWidths: { cust: 56, farm: 56 } 그룹 기본값
// options.widths: { [colIndex]: px, 'g:cust': px } 저장된 너비
// options.onResize: (colIndex | 'g:groupId', width) => void
// th[data-resize-group="cust"] — 같은 그룹 열 일괄 조절

import { useRef, useEffect } from 'react';

function applyColWidth(col, th, width) {
  const w = Math.round(width);
  if (col) {
    col.style.width = `${w}px`;
    col.style.minWidth = `${w}px`;
    col.style.maxWidth = `${w}px`;
  }
  if (th) {
    th.style.width = `${w}px`;
    th.style.minWidth = `${w}px`;
    th.style.maxWidth = `${w}px`;
    th.style.boxSizing = 'border-box';
  }
}

function ensureColgroup(table, colCount) {
  let cg = table.querySelector('colgroup[data-resize-cols]');
  if (!cg) {
    cg = document.createElement('colgroup');
    cg.setAttribute('data-resize-cols', '1');
    table.insertBefore(cg, table.firstChild);
  }
  while (cg.children.length < colCount) cg.appendChild(document.createElement('col'));
  while (cg.children.length > colCount) cg.lastChild.remove();
  return cg;
}

export function useColumnResize(deps = [], options = {}) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const tableRef = useRef(null);

  useEffect(() => {
    const table = tableRef.current;
    if (!table) return;

    const headerSel = optionsRef.current.headerSelector || 'thead tr th';
    const rowSel = headerSel.replace(/\s+th\s*$/, '');
    const row = table.querySelector(rowSel);
    if (!row) return;

    const ths = row.querySelectorAll('th');
    if (!ths.length) return;

    const colgroup = ensureColgroup(table, ths.length);
    const {
      minWidth = 18,
      widths = {},
      defaultWidth = 52,
      defaultGroupWidths = {},
    } = optionsRef.current;

    const groupIndices = {};
    ths.forEach((th, idx) => {
      const g = th.dataset.resizeGroup;
      if (!g) return;
      if (!groupIndices[g]) groupIndices[g] = [];
      groupIndices[g].push(idx);
    });

    const applyAt = (idx, w) => {
      applyColWidth(colgroup.children[idx], ths[idx], w);
    };

    const applyGroup = (group, w) => {
      (groupIndices[group] || []).forEach((idx) => applyAt(idx, w));
    };

    const syncTableWidth = () => {
      let total = 0;
      for (let i = 0; i < colgroup.children.length; i++) {
        const w = parseInt(colgroup.children[i].style.width, 10);
        total += Number.isFinite(w) ? w : defaultWidth;
      }
      table.style.tableLayout = 'fixed';
      table.style.width = `${total}px`;
      table.style.minWidth = '100%';
    };

    const appliedGroups = new Set();
    ths.forEach((th, idx) => {
      const group = th.dataset.resizeGroup;
      if (group) {
        if (appliedGroups.has(group)) return;
        appliedGroups.add(group);
        const saved = widths[`g:${group}`] ?? defaultGroupWidths[group] ?? defaultWidth;
        applyGroup(group, saved);
        return;
      }
      const saved = widths[idx] ?? widths[String(idx)];
      const w = saved != null ? saved : defaultWidth;
      applyAt(idx, w);
    });
    syncTableWidth();

    const cleanups = [];

    ths.forEach((th, idx) => {
      th.classList.add('resizable');
      let handle = th.querySelector('.col-resize-handle');
      if (handle) handle.remove();
      handle = document.createElement('div');
      handle.className = 'col-resize-handle';
      th.appendChild(handle);

      const group = th.dataset.resizeGroup;

      const onMouseDown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startWidth = th.offsetWidth || defaultWidth;
        handle.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        const onMouseMove = (e2) => {
          const mw = optionsRef.current.minWidth ?? minWidth;
          const newWidth = Math.max(mw, startWidth + (e2.clientX - startX));
          if (group) {
            applyGroup(group, newWidth);
            syncTableWidth();
            optionsRef.current.onResize?.(`g:${group}`, newWidth);
          } else {
            applyAt(idx, newWidth);
            syncTableWidth();
            optionsRef.current.onResize?.(idx, newWidth);
          }
        };

        const onMouseUp = () => {
          handle.classList.remove('dragging');
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      };

      handle.addEventListener('mousedown', onMouseDown);
      cleanups.push(() => {
        handle.removeEventListener('mousedown', onMouseDown);
        handle.remove();
        th.classList.remove('resizable');
      });
    });

    return () => cleanups.forEach((fn) => fn());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return tableRef;
}
