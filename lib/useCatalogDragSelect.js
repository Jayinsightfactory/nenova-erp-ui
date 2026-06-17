import { useCallback, useRef, useState } from 'react';

function rectsIntersect(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** 빈 공간에서 구간 드래그 → 사각형 안 품목 토글(선택/해제) */
export function useCatalogDragSelect(onToggleProdKeys) {
  const suppressClickRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [marquee, setMarquee] = useState(null);
  const cleanupRef = useRef(null);

  const endSession = useCallback((session) => {
    if (session?.active) {
      suppressClickRef.current = true;
      if (session.mode === 'marquee' && session.rect) {
        const cards = [...document.querySelectorAll('[data-prod-key]')];
        const hits = cards.filter(card => rectsIntersect(session.rect, card.getBoundingClientRect()));
        const keys = hits.map(c => Number(c.dataset.prodKey)).filter(Number.isFinite);
        if (keys.length) onToggleProdKeys(keys);
      }
    }
    cleanupRef.current?.();
    cleanupRef.current = null;
    setDragging(false);
    setMarquee(null);
  }, [onToggleProdKeys]);

  const onPointerDown = useCallback((e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.catalog-thumb')) return;
    if (e.target.closest('[data-prod-key]')) return;
    if (!e.currentTarget.contains(e.target) && e.target !== e.currentTarget) return;

    const session = {
      mode: 'marquee',
      startX: e.clientX,
      startY: e.clientY,
      active: false,
      rect: null,
    };

    const onMove = (ev) => {
      const dist = Math.hypot(ev.clientX - session.startX, ev.clientY - session.startY);
      if (!session.active && dist > 4) {
        session.active = true;
        setDragging(true);
      }
      if (!session.active) return;
      const left = Math.min(session.startX, ev.clientX);
      const top = Math.min(session.startY, ev.clientY);
      const width = Math.abs(ev.clientX - session.startX);
      const height = Math.abs(ev.clientY - session.startY);
      session.rect = { left, top, right: left + width, bottom: top + height };
      setMarquee({ left, top, width, height, active: true });
    };

    const onUp = () => endSession(session);

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    cleanupRef.current = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [endSession]);

  const shouldSuppressClick = useCallback(() => {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    return true;
  }, []);

  return { dragging, marquee, onPointerDown, shouldSuppressClick };
}
