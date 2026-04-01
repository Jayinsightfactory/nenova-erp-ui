// lib/useColumnResize.js
// 테이블 컬럼 드래그 리사이즈 훅
// 사용법: const resizeRef = useColumnResize();  <table ref={resizeRef} className="tbl">

import { useRef, useEffect } from 'react';

export function useColumnResize() {
  const tableRef = useRef(null);

  useEffect(() => {
    const table = tableRef.current;
    if (!table) return;

    // th 에 리사이즈 핸들 추가
    const ths = table.querySelectorAll('th');
    const handles = [];

    ths.forEach(th => {
      if (th.querySelector('.col-resize-handle')) return; // 이미 있으면 스킵
      th.classList.add('resizable');
      const handle = document.createElement('div');
      handle.className = 'col-resize-handle';
      th.appendChild(handle);
      handles.push({ th, handle });

      let startX, startWidth;

      const onMouseDown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        startX = e.clientX;
        startWidth = th.offsetWidth;
        handle.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        const onMouseMove = (e2) => {
          const diff = e2.clientX - startX;
          const newWidth = Math.max(30, startWidth + diff);
          th.style.width = newWidth + 'px';
          th.style.minWidth = newWidth + 'px';
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
    });

    // 클린업
    return () => {
      handles.forEach(({ handle }) => {
        handle.remove();
      });
    };
  }, []);

  return tableRef;
}
