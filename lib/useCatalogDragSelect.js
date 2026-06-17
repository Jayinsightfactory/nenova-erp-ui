import { useCallback, useRef, useState } from 'react';

/** iPhone 사진 앱처럼 드래그로 지나간 품목을 연속 선택 */
export function useCatalogDragSelect(onSelectProdKey) {
  const suppressClickRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const cleanupRef = useRef(null);

  const endSession = useCallback((session) => {
    if (session?.active) suppressClickRef.current = true;
    cleanupRef.current?.();
    cleanupRef.current = null;
    setDragging(false);
  }, []);

  const onPointerDown = useCallback((e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.catalog-thumb')) return;

    const session = {
      startX: e.clientX,
      startY: e.clientY,
      active: false,
      visited: new Set(),
    };

    const visit = (clientX, clientY) => {
      if (!session.active) return;
      const el = document.elementFromPoint(clientX, clientY);
      const card = el?.closest('[data-prod-key]');
      if (!card) return;
      const pk = Number(card.dataset.prodKey);
      if (!Number.isFinite(pk) || session.visited.has(pk)) return;
      session.visited.add(pk);
      onSelectProdKey(pk);
    };

    const onMove = (ev) => {
      const dist = Math.hypot(ev.clientX - session.startX, ev.clientY - session.startY);
      if (!session.active && dist > 6) {
        session.active = true;
        setDragging(true);
      }
      if (session.active) visit(ev.clientX, ev.clientY);
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
  }, [endSession, onSelectProdKey]);

  const shouldSuppressClick = useCallback(() => {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    return true;
  }, []);

  return { dragging, onPointerDown, shouldSuppressClick };
}
