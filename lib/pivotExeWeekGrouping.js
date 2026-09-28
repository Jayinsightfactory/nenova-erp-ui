// Display-only projection AFTER native filters. Never alter the fetched ERP rows.
export function projectPivotMainWeeks(rows, layout, mode) {
  if (mode !== 'main') return rows;
  const weekAxis = [layout.row, layout.column].find(axis => axis.includes('OrderWeek'));
  if (!weekAxis) return rows;
  const hasYear = weekAxis.includes('OrderYear');
  return rows.map(row => {
    const match = String(row.OrderWeek ?? '').match(/^(\d{1,2})-(\d{1,2})([A-Za-z]*)$/);
    const year = String(row.OrderYear ?? '');
    // Malformed/missing years stay separate, never silently join a known year.
    const major = match && Number(match[1]) >= 1 && Number(match[1]) <= 53 && Number(match[2]) >= 1
      ? `${match[1].padStart(2, '0')}차` : null;
    if (!major || !/^\d{4}$/.test(year)) return row;
    return { ...row, OrderWeek: hasYear ? major : `${year} ${major}` };
  });
}

export function pivotIncludedWeeks(rows) {
  return [...new Set(rows.map(row => `${row.OrderYear ?? '?'} ${row.OrderWeek ?? '?'}`))]
    .sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }));
}

// Switching to the EXE screenshot is explicit, not an automatic layout reset.
export function pivotIncomingSelections(selections = {}) {
  return { ...Object.fromEntries(Object.entries(selections).filter(([id]) => ['CounName', 'FlowerName', 'ProdName'].includes(id))), ListType: ['03. 입고'] };
}
