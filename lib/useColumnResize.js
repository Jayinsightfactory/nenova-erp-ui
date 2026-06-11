// lib/useColumnResize.js
// 테이블 컬럼 드래그 리사이즈 훅
// deps: 컬럼 구조 변경 시 핸들 재부착 (예: [data, showSections, compact])
// options.headerSelector: 리사이즈 대상 th (기본 'th')
// options.minWidth: 최소 px (기본 18 — 텍스트보다 좁게 줄이기 + 말줄임)
// options.widths: { [colIndex]: px } 저장된 너비
// options.onResize: (colIndex, width) => void

import { useRef, useEffect } from 'react';

function applyColWidth(th, width) {
  const w = Math.round(width);
  th.style.width = `${w}px`;
  th.style.minWidth = `${w}px`;
  th.style.maxWidth = `${w}px`;
}

export function useColumnResize(deps = [], options = {}) {
  const {
    headerSelector = 'th',
    minWidth = 18,
    widths = {},
    onResize,
  } = options;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const tableRef = useRef(null);

  useEffect(() => {
    const table = tableRef.current;
    if (!table) return;

    const ths = table.querySelectorAll(headerSelector);
    const cleanups = [];

    ths.forEach((th, idx) => {
      const saved = widths[idx];
      if (saved) applyColWidth(th, saved);
      else if (!th.style.width) applyColWidth(th, th.offsetWidth || 56);

      if (th.querySelector('.col-resize-handle')) return;
      th.classList.add('resizable');
      const handle = document.createElement('div');
      handle.className = 'col-resize-handle';
      th.appendChild(handle);

      const onMouseDown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startWidth = th.offsetWidth;
        handle.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        const onMouseMove = (e2) => {
          const newWidth = Math.max(optionsRef.current.minWidth ?? minWidth, startWidth + (e2.clientX - startX));
          applyColWidth(th, newWidth);
          optionsRef.current.onResize?.(idx, newWidth);
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
      });
    });

    return () => cleanups.forEach((fn) => fn());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return tableRef;
}
