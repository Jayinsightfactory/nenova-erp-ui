// Follow visible row order, including filtered search results.
export function moveQuantityFocus(event) {
  const input = event.target;
  if (input.type !== 'number' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const step = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[event.key];
  if (!step) return;
  event.preventDefault(); // Up/Down must never spin the current quantity, even at the boundary.
  const cell = input.closest('td');
  const rows = event.currentTarget.rows;
  let rowIndex = cell.parentElement.sectionRowIndex + step[0];
  while (rows[rowIndex]) {
    const target = rows[rowIndex].cells[cell.cellIndex + step[1]]?.querySelector('input[type="number"]');
    if (target) { target.focus(); return; }
    if (!step[0]) return;
    rowIndex += step[0]; // Skip group headings and subtotal rows in the summary.
  }
}
