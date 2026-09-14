// Pure browser-window calculations for the EXE pivot.  This module only decides which
// existing model cells are painted; it never filters, aggregates, formats, or mutates data.
export const PIVOT_EXE_WINDOW_CELL_THRESHOLD = 5000;

const finiteNonNegative = (value) => Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0);

export function shouldWindowPivotExe(totalRows, totalColumns, threshold = PIVOT_EXE_WINDOW_CELL_THRESHOLD) {
  return finiteNonNegative(totalRows) * finiteNonNegative(totalColumns) > threshold;
}

export function buildPivotExeColumnPrefix(widths = []) {
  const prefix = [0];
  for (const width of widths) prefix.push(prefix[prefix.length - 1] + finiteNonNegative(width));
  return prefix;
}

/** Returns the leaf column containing an x-coordinate, or the first index past the last leaf. */
export function findPivotExeColumnAt(prefix = [], offset = 0) {
  const count = Math.max(0, prefix.length - 1);
  const target = finiteNonNegative(offset);
  let low = 0;
  let high = count;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (prefix[middle + 1] <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function getPivotExeRowWindow({ totalRows = 0, scrollTop = 0, clientHeight = 0, headerHeight = 0, rowHeight = 1, overscan = 6 } = {}) {
  const count = Math.max(0, Math.trunc(finiteNonNegative(totalRows)));
  if (!count) return { start: 0, end: 0, topHeight: 0, bottomHeight: 0 };
  const height = Math.max(1, finiteNonNegative(rowHeight));
  const visibleHeight = Math.max(0, finiteNonNegative(clientHeight) - finiteNonNegative(headerHeight));
  // The sticky header covers part of the viewport, but it does not move the body's scroll
  // coordinate. At scrollTop=N, body row N / rowHeight is directly beneath that overlay.
  const bodyTop = finiteNonNegative(scrollTop);
  const first = Math.min(count - 1, Math.floor(bodyTop / height));
  const last = Math.min(count, Math.max(first + 1, Math.ceil((bodyTop + visibleHeight) / height)));
  const padding = Math.max(0, Math.trunc(finiteNonNegative(overscan)));
  const start = Math.max(0, first - padding);
  const end = Math.min(count, last + padding);
  return { start, end, topHeight: start * height, bottomHeight: (count - end) * height };
}

export function getPivotExeColumnWindow({ widths = [], prefix = buildPivotExeColumnPrefix(widths), scrollLeft = 0, clientWidth = 0, rowHeaderWidth = 0, overscan = 2 } = {}) {
  const count = Math.max(0, widths.length);
  if (!count) return { start: 0, end: 0, leftWidth: 0, rightWidth: 0 };
  // Sticky row fields occupy this much of the viewport. scrollLeft is already relative to
  // the first numeric leaf once those fields are covered by the sticky layer.
  const firstX = finiteNonNegative(scrollLeft);
  const visibleWidth = Math.max(0, finiteNonNegative(clientWidth) - finiteNonNegative(rowHeaderWidth));
  const lastX = firstX + visibleWidth;
  const first = Math.min(count - 1, findPivotExeColumnAt(prefix, firstX));
  const last = Math.min(count, Math.max(first + 1, findPivotExeColumnAt(prefix, Math.max(firstX, lastX - 0.001)) + 1));
  const padding = Math.max(0, Math.trunc(finiteNonNegative(overscan)));
  const start = Math.max(0, first - padding);
  const end = Math.min(count, last + padding);
  return { start, end, leftWidth: prefix[start], rightWidth: prefix[count] - prefix[end] };
}

/** Clips merged header leaves to the numeric window while retaining their global start index. */
export function clipPivotExeHeaderCells(headerCells = [], start = 0, end = 0) {
  return headerCells.flatMap((cell) => {
    const cellStart = Math.max(0, Math.trunc(finiteNonNegative(cell?.columnStart)));
    const cellEnd = cellStart + Math.max(0, Math.trunc(finiteNonNegative(cell?.columnSpan)));
    const clippedStart = Math.max(cellStart, start);
    const clippedEnd = Math.min(cellEnd, end);
    return clippedStart < clippedEnd ? [{ ...cell, columnSpan: clippedEnd - clippedStart }] : [];
  });
}

function rowHeaderOrigin(cells, rowIndex, fieldIndex) {
  let origin = rowIndex;
  while (origin > 0 && cells[origin]?.[fieldIndex]?.hidden) origin -= 1;
  return cells[origin]?.[fieldIndex]?.hidden ? -1 : origin;
}

/**
 * Re-emits the origin label when a vertical window starts within a merged row header.
 * Its span is clipped to the rendered rows so no header cell can cross a spacer row.
 */
export function getPivotExeWindowedRowHeaderCells(cells = [], start = 0, end = cells.length) {
  const rangeStart = Math.max(0, Math.min(cells.length, Math.trunc(finiteNonNegative(start))));
  const rangeEnd = Math.max(rangeStart, Math.min(cells.length, Math.trunc(finiteNonNegative(end))));
  const fields = cells[0]?.length || 0;
  const result = Array.from({ length: rangeEnd - rangeStart }, () => Array(fields).fill(null));
  for (let fieldIndex = 0; fieldIndex < fields; fieldIndex += 1) {
    let rowIndex = rangeStart;
    while (rowIndex < rangeEnd) {
      const origin = rowHeaderOrigin(cells, rowIndex, fieldIndex);
      const source = origin >= 0 ? cells[origin]?.[fieldIndex] : null;
      if (!source || source.hidden) { rowIndex += 1; continue; }
      const sourceEnd = origin + Math.max(1, Math.trunc(finiteNonNegative(source.rowSpan)) || 1);
      const clippedEnd = Math.min(rangeEnd, sourceEnd);
      result[rowIndex - rangeStart][fieldIndex] = { ...source, rowSpan: Math.max(1, clippedEnd - rowIndex) };
      rowIndex = Math.max(rowIndex + 1, clippedEnd);
    }
  }
  return result;
}
