const GRID_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export function getEstimateGridNavigationTarget(cells = [], current = {}, key = '') {
  if (!GRID_KEYS.has(key)) return null;
  const normalized = (cells || [])
    .map((cell, index) => ({ ...cell, index, row: Number(cell.row), column: String(cell.column || '') }))
    .filter((cell) => Number.isInteger(cell.row) && cell.column && cell.disabled !== true);
  const currentIndex = normalized.findIndex((cell) => cell.row === Number(current.row) && cell.column === String(current.column || ''));
  if (currentIndex < 0) return null;
  if (key === 'ArrowLeft') return normalized[currentIndex - 1] || null;
  if (key === 'ArrowRight') return normalized[currentIndex + 1] || null;
  const direction = key === 'ArrowUp' ? -1 : 1;
  const sameColumn = normalized
    .filter((cell) => cell.column === normalized[currentIndex].column && (cell.row - normalized[currentIndex].row) * direction > 0)
    .sort((a, b) => direction > 0 ? a.row - b.row : b.row - a.row);
  return sameColumn[0] || null;
}

