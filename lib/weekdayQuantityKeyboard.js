// Text editing keeps its native shortcuts; horizontal cell movement starts at a caret edge.
export function weekdayQuantityDirection({ key, altKey, ctrlKey, metaKey, shiftKey, isComposing, value = '', selectionStart, selectionEnd }) {
  if (altKey || ctrlKey || metaKey || shiftKey || isComposing) return null;
  if (key === 'ArrowUp') return 'up';
  if (key === 'ArrowDown') return 'down';
  const length = String(value).length;
  const all = selectionStart === 0 && selectionEnd === length;
  if (key === 'ArrowLeft' && (all || selectionStart === 0 && selectionEnd === 0)) return 'left';
  if (key === 'ArrowRight' && (all || selectionStart === length && selectionEnd === length)) return 'right';
  return null;
}

export function weekdayQuantityTarget(cells, currentIndex, direction) {
  const current = cells[currentIndex];
  if (!current || !direction) return -1;
  const step = direction === 'left' || direction === 'up' ? -1 : 1;
  const vertical = direction === 'up' || direction === 'down';
  for (let index = currentIndex + step; index >= 0 && index < cells.length; index += step) {
    const next = cells[index];
    if (next.disabled || next.hidden) continue;
    if (vertical ? next.column === current.column && next.row !== current.row : next.row === current.row) return index;
    if (!vertical && next.row !== current.row) return -1;
  }
  return -1;
}

export function moveWeekdayQuantityFocus(event) {
  const input = event.currentTarget;
  const direction = weekdayQuantityDirection({ ...event, key: event.key, altKey: event.altKey, ctrlKey: event.ctrlKey,
    metaKey: event.metaKey, shiftKey: event.shiftKey, isComposing: event.nativeEvent?.isComposing,
    value: input.value, selectionStart: input.selectionStart, selectionEnd: input.selectionEnd });
  if (!direction) return false;
  const controls = [...(input.closest('table')?.querySelectorAll('input[data-wcm-quantity]') || [])];
  const cells = controls.map(control => ({ row: control.closest('tr'), column: control.dataset.wcmQuantity,
    disabled: control.disabled, hidden: Boolean(control.closest('[hidden]')) }));
  const next = weekdayQuantityTarget(cells, controls.indexOf(input), direction);
  if (next < 0) return false;
  event.preventDefault();
  const target = controls[next];
  target.focus({ preventScroll: true }); // Existing blur handler records the edited draft.
  target.select();
  const matrix = input.closest('.weekday-cycle-matrix');
  const sticky = matrix?.querySelector('.wcm-sticky-header')?.getBoundingClientRect();
  const product = target.closest('tr')?.querySelector?.('th')?.getBoundingClientRect();
  if (target.style) {
    target.style.scrollMarginTop = `${Math.max(8, sticky?.bottom || 0) + 8}px`;
    target.style.scrollMarginLeft = `${(product?.width || 0) + 8}px`;
  }
  target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  return true;
}
