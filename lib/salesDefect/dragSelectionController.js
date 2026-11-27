// 영업수입불량차감 체크박스 마우스·펜 범위 드래그 선택 제어기
import { selectDefectRange } from '../defectDragSelection.js';

export function endDefectSelectionDrag(selectionDragRef) {
  const session = selectionDragRef.current;
  if (session?.frame) cancelAnimationFrame(session.frame);
  if (session?.zone.hasPointerCapture?.(session.pointerId)) session.zone.releasePointerCapture(session.pointerId);
  selectionDragRef.current = null;
}

export function updateDefectSelectionDrag(selectionDragRef, x, y, recordPointer = true) {
  const session = selectionDragRef.current;
  if (!session) return;
  if (recordPointer) { session.x = x; session.y = y; }
  const row = document.elementFromPoint(x, y)?.closest('tr');
  const zone = row?.querySelector(`[data-selection-group="${session.group}"]`);
  const current = session.zones.indexOf(zone);
  if (current >= 0) session.current = current;
  session.setSelection(selectDefectRange({
    baseline: session.baseline,
    items: session.items,
    anchor: session.anchor,
    current: session.current,
    selected: session.selected,
  }));
}

export function startDefectSelectionDrag({
  event,
  group,
  baseline,
  setSelection,
  selectionDragRef,
  selectionPointerTypeRef,
}) {
  selectionPointerTypeRef.current = event.pointerType;
  if (!['mouse', 'pen'].includes(event.pointerType) || event.button !== 0 || !event.isPrimary
    || event.currentTarget.querySelector('input')?.disabled) return;
  event.preventDefault();
  endDefectSelectionDrag(selectionDragRef);
  const zone = event.currentTarget;
  const zones = [...document.querySelectorAll(`[data-selection-group="${group}"]`)];
  const items = zones.map((item) => ({ key: Number(item.dataset.selectionKey), eligible: !item.querySelector('input').disabled }));
  const anchor = zones.indexOf(zone);
  const session = {
    zone,
    zones,
    items,
    group,
    baseline: new Set(baseline),
    setSelection,
    anchor,
    current: anchor,
    selected: !baseline.has(items[anchor].key),
    pointerId: event.pointerId,
    scroll: zone.closest('.defect-grid-scroll'),
    x: event.clientX,
    y: event.clientY,
  };
  selectionDragRef.current = session;
  zone.querySelector('input')?.focus({ preventScroll: true });
  zone.setPointerCapture(event.pointerId);
  updateDefectSelectionDrag(selectionDragRef, event.clientX, event.clientY);
  const frame = () => {
    if (selectionDragRef.current !== session) return;
    const rect = session.scroll?.getBoundingClientRect();
    if (rect) {
      const top = Math.max(0, rect.top);
      const bottom = Math.min(innerHeight, rect.bottom);
      const delta = session.y < top + 44 ? -18 : session.y > bottom - 44 ? 18 : 0;
      if (delta) {
        session.scroll.scrollTop += delta;
        const headerBottom = Math.max(top, ...[...session.scroll.querySelectorAll('thead th')].map((cell) => cell.getBoundingClientRect().bottom));
        updateDefectSelectionDrag(selectionDragRef, session.x, Math.max(headerBottom + 2, Math.min(bottom - 5, session.y)), false);
      }
    }
    session.frame = requestAnimationFrame(frame);
  };
  session.frame = requestAnimationFrame(frame);
}

export function buildDefectSelectionZoneProps({
  group,
  key,
  baseline,
  setter,
  selectionDragRef,
  selectionPointerTypeRef,
}) {
  return {
    'data-selection-group': group,
    'data-selection-key': key,
    title: '↑↓ 항목 이동 · Space 또는 Enter 선택',
    onKeyDown: (event) => {
      if (event.target.tagName !== 'INPUT' || event.target.type !== 'checkbox') return;
      if (event.key === 'Enter') { event.preventDefault(); event.target.click(); return; }
      if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      const inputs = [...document.querySelectorAll(`[data-selection-group="${group}"] input`)].filter((input) => !input.disabled);
      const index = inputs.indexOf(event.target);
      const next = inputs[index + (event.key === 'ArrowDown' ? 1 : -1)];
      event.preventDefault();
      next?.focus();
    },
    onPointerDown: (event) => startDefectSelectionDrag({ event, group, baseline, setSelection: setter, selectionDragRef, selectionPointerTypeRef }),
    onPointerMove: (event) => { if (selectionDragRef.current?.pointerId === event.pointerId) updateDefectSelectionDrag(selectionDragRef, event.clientX, event.clientY); },
    onPointerUp: () => endDefectSelectionDrag(selectionDragRef),
    onPointerCancel: () => endDefectSelectionDrag(selectionDragRef),
    onClickCapture: (event) => {
      if (event.detail > 0 && ['mouse', 'pen'].includes(selectionPointerTypeRef.current)) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
  };
}
