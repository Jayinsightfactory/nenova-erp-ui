// Follow visible row order, including filtered search results.
export function moveQuantityFocus(event) {
  const input = event.target;
  if (input.type !== 'number' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const step = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[event.key];
  if (!step) return;
  event.preventDefault(); // Up/Down must never spin the current quantity, even at the boundary.
  const cell = input.closest('td');
  const row = event.currentTarget.rows[cell.parentElement.sectionRowIndex + step[0]];
  row?.cells[cell.cellIndex + step[1]]?.querySelector('input[type="number"]')?.focus();
}
