import { useEffect } from 'react';

// Horizontal overflow containers prevent CSS sticky from following page scroll.
// Move the original cells together, retaining their controls and column widths.
export default function useVolumePageHeader(containerRef, topRailRef) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    let frame;
    const update = () => {
      frame = undefined;
      const table = container.querySelector('table');
      const rows = table?.querySelectorAll('[data-volume-header-row]');
      if (!table || !rows?.length || !table.offsetHeight) return;
      const rect = table.getBoundingClientRect();
      const scale = rect.height / table.offsetHeight;
      const headerHeight = [...rows].reduce((sum, row) => sum + row.offsetHeight, 0);
      let top = Math.max(0, topRailRef?.current?.getBoundingClientRect().bottom || 0);
      for (let parent = container; parent && parent !== document.body; parent = parent.parentElement) {
        if (/(auto|scroll|hidden)/.test(getComputedStyle(parent).overflowY)) {
          top = Math.max(top, parent.getBoundingClientRect().top + parent.clientTop);
        }
      }
      const offset = Math.min(Math.max(0, (top - rect.top) / scale), Math.max(0, table.offsetHeight - headerHeight));
      container.style.setProperty('--volume-header-offset', `${offset}px`);
    };
    const schedule = () => { if (frame === undefined) frame = requestAnimationFrame(update); };
    const observer = new ResizeObserver(schedule);
    observer.observe(container);
    const table = container.querySelector('table');
    if (table) observer.observe(table);
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    update();
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      container.style.removeProperty('--volume-header-offset');
    };
  });
}
