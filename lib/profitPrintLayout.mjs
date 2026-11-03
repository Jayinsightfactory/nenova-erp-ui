// Presentation only. No financial values are parsed, rounded or recalculated.
export function fitProfitPrintDocument(doc) {
  for (const page of doc.querySelectorAll('.profit-print-page')) {
    const content = page.querySelector('.profit-print-content');
    content.style.transform = 'none';
    const scale = Math.min(1, page.clientWidth / content.scrollWidth, page.clientHeight / content.scrollHeight);
    content.style.transform = `scale(${scale})`;
    // Only after all content fits: prevent Chromium paginating pre-transform overflow.
    page.style.overflow = 'hidden';
    page.dataset.printScale = String(scale);
  }
}

export function profitPopoverPosition(rect, viewportWidth, viewportHeight) {
  const width = Math.min(260, Math.max(0, viewportWidth - 16));
  const maxHeight = Math.min(480, Math.max(120, viewportHeight - 32));
  return { left: Math.max(8, Math.min(rect.left, viewportWidth - width - 8)),
    top: Math.max(8, Math.min(rect.bottom + 6, viewportHeight - maxHeight - 8)), width, maxHeight };
}

export function navigateProfitCheckboxes(event) {
  if (!['ArrowDown','ArrowUp','ArrowRight','ArrowLeft','Home','End'].includes(event.key) || event.target.type !== 'checkbox') return;
  const boxes = [...event.currentTarget.querySelectorAll('input[type="checkbox"]:not(:disabled)')];
  const index = boxes.indexOf(event.target);
  if (index < 0 || !boxes.length) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? boxes.length - 1
    : (index + (['ArrowDown','ArrowRight'].includes(event.key) ? 1 : -1) + boxes.length) % boxes.length;
  boxes[next].focus();
}
