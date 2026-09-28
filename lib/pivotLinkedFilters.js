import { filterRows } from './pivotExeModel.js';

// Facets use the very same predicates as the table. Only the open field's
// checkbox predicate is omitted; advanced AND/OR/NOT stays intact.
export function pivotLinkedValues(rows, field, options, format) {
  const fieldFilters = { ...options.fieldFilters };
  delete fieldFilters[field];
  return [...new Set(filterRows(rows, { ...options, fieldFilters }).map(row => format(row[field])))];
}

// Selecting every contextual candidate must not erase a narrower explicit
// choice when another filter is later cleared. Reset only against the full pool.
export function applyLinkedPivotSelection(selections, field, selected, allValues) {
  const accepted = [...new Set(selected)];
  const next = { ...selections, [field]: accepted };
  if (allValues.length && accepted.length === allValues.length && allValues.every(value => accepted.includes(value))) delete next[field];
  return next;
}
