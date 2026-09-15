// Display-only scheduling. No ERP values, queries, or shared storage ownership here.
export function createPivotResizeSession({ target, startX, startWidth, onPreview, onCommit, onFinish }) {
  let active = true;
  let frame = null;
  let width = startWidth;
  const widthAt = (x) => Math.max(48, Math.min(400, startWidth + x - startX));
  const paint = () => {
    frame = null;
    if (active) onPreview(width, startX + width - startWidth);
  };
  const move = (event) => {
    if (!Number.isFinite(event.clientX)) return;
    width = widthAt(event.clientX);
    if (frame === null) frame = target.requestAnimationFrame(paint);
  };
  const finish = (commit, event) => {
    if (!active) return;
    active = false;
    if (frame !== null) target.cancelAnimationFrame(frame);
    target.removeEventListener('mousemove', move);
    target.removeEventListener('mouseup', done);
    target.removeEventListener('keydown', key);
    target.removeEventListener('blur', cancel);
    target.removeEventListener('pagehide', cancel);
    if (commit && Number.isFinite(event?.clientX)) width = widthAt(event.clientX);
    onFinish();
    if (commit) onCommit(width);
  };
  const done = (event) => finish(true, event);
  const cancel = () => finish(false);
  const key = (event) => { if (event.key === 'Escape') { event.preventDefault(); cancel(); } };
  target.addEventListener('mousemove', move);
  target.addEventListener('mouseup', done);
  target.addEventListener('keydown', key);
  target.addEventListener('blur', cancel);
  target.addEventListener('pagehide', cancel);
  paint();
  return cancel;
}

export function createPivotHeaderHeightResizeSession({ target, startY, startHeight, onPreview, onCommit, onFinish }) {
  let active = true;
  let frame = null;
  let height = startHeight;
  const heightAt = (y) => Math.max(18, Math.min(120, startHeight + y - startY));
  const paint = () => { frame = null; if (active) onPreview(height, startY + height - startHeight); };
  const move = (event) => {
    if (!Number.isFinite(event.clientY)) return;
    height = heightAt(event.clientY);
    if (frame === null) frame = target.requestAnimationFrame(paint);
  };
  const finish = (commit, event) => {
    if (!active) return;
    active = false;
    if (frame !== null) target.cancelAnimationFrame(frame);
    target.removeEventListener('mousemove', move); target.removeEventListener('mouseup', done);
    target.removeEventListener('keydown', key); target.removeEventListener('blur', cancel); target.removeEventListener('pagehide', cancel);
    if (commit && Number.isFinite(event?.clientY)) height = heightAt(event.clientY);
    onFinish(); if (commit) onCommit(height);
  };
  const done = (event) => finish(true, event);
  const cancel = () => finish(false);
  const key = (event) => { if (event.key === 'Escape') { event.preventDefault(); cancel(); } };
  target.addEventListener('mousemove', move); target.addEventListener('mouseup', done);
  target.addEventListener('keydown', key); target.addEventListener('blur', cancel); target.addEventListener('pagehide', cancel);
  paint();
  return cancel;
}

/**
 * Row headers keep their own widths. Every horizontal pivot value column shares
 * one preference so resizing any visible value column updates the entire matrix.
 */
export function pivotResizePreferenceKey(columnId, rowFieldIds = []) {
  return rowFieldIds.includes(columnId) ? columnId : '__data';
}

/** Remove obsolete per-value-column widths before storing the shared width. */
export function withCollectivePivotWidth(widths = {}, preferenceKey, width) {
  if (preferenceKey !== '__data') return widths[preferenceKey] === width ? widths : { ...widths, [preferenceKey]: width };
  const next = Object.fromEntries(Object.entries(widths).filter(([key]) => !key.startsWith('col-')));
  if (next.__data === width && Object.keys(next).length === Object.keys(widths).length) return widths;
  next.__data = width;
  return next;
}

export function normalizeCollectivePivotWidths(widths = {}, fallback = 96) {
  const source = widths && typeof widths === 'object' ? widths : {};
  const inherited = source.__data ?? Object.entries(source).find(([key]) => key.startsWith('col-'))?.[1] ?? fallback;
  return withCollectivePivotWidth(source, '__data', inherited);
}

const filterLabel = (value) => value === null ? '(null)' : value === undefined ? '(undefined)' : value === '' ? '(빈값)' : String(value);

/**
 * Display state for an EXE-style field value filter. A missing selection means
 * every value is visible; an empty array deliberately means no value is visible.
 */
export function describePivotValueSelection(values = [], selected, filterActive = true) {
  const all = [...new Set(Array.isArray(values) ? values : [])];
  const chosen = Array.isArray(selected) ? [...new Set(selected)].filter((value) => all.includes(value)) : all;
  const constrained = Array.isArray(selected) && chosen.length < all.length;
  if (!filterActive && constrained) return { active:false, label:'필터 꺼짐', selectedCount:chosen.length, totalCount:all.length };
  if (!constrained) return { active:false, label:'전체', selectedCount:all.length, totalCount:all.length };
  if (chosen.length === 0) return { active:true, label:'선택 없음', selectedCount:0, totalCount:all.length };
  if (chosen.length === 1) return { active:true, label:filterLabel(chosen[0]), selectedCount:1, totalCount:all.length };
  return { active:true, label:`${filterLabel(chosen[0])} 외 ${chosen.length - 1}`, selectedCount:chosen.length, totalCount:all.length };
}

/** Store only constrained selections so "전체 선택" is identical to filter reset. */
export function applyPivotValueSelection(selections = {}, fieldId, selected = [], values = []) {
  const all = [...new Set(Array.isArray(values) ? values : [])];
  const accepted = [...new Set(Array.isArray(selected) ? selected : [])].filter((value) => all.includes(value));
  const next = { ...selections };
  if (accepted.length === all.length) delete next[fieldId];
  else next[fieldId] = accepted;
  return next;
}

/**
 * Move a field exactly where it was dropped. This mirrors a native PivotGrid:
 * dropping between two field buttons also reorders fields inside the same zone.
 */
export function movePivotField(zones, fieldId, targetZone, targetIndex, numericOrSummary = false) {
  if (!zones || !['rows', 'cols', 'values', 'filters'].includes(targetZone)) return zones;
  const valueEntry = (zones.values || []).find((item) => item.id === fieldId);
  const next = {
    rows: (zones.rows || []).filter((item) => item !== fieldId),
    cols: (zones.cols || []).filter((item) => item !== fieldId),
    filters: (zones.filters || []).filter((item) => item !== fieldId),
    values: (zones.values || []).filter((item) => item.id !== fieldId),
  };
  const list = next[targetZone];
  const index = Math.max(0, Math.min(list.length, Number.isInteger(targetIndex) ? targetIndex : list.length));
  const item = targetZone === 'values'
    ? (valueEntry || { id: fieldId, aggregation: typeof numericOrSummary === 'string' ? numericOrSummary : numericOrSummary ? 'sum' : 'count' })
    : fieldId;
  list.splice(index, 0, item);
  return next;
}

/** Coalesce preference writes, but explicitly flush on pagehide/unmount. */
export function createPivotPreferenceWriter({ write, onError, setTimer = setTimeout, clearTimer = clearTimeout, delay = 350 }) {
  let pending;
  let timer = null;
  let disposed = false;
  const flush = () => {
    if (timer !== null) { clearTimer(timer); timer = null; }
    if (pending === undefined) return;
    const next = pending;
    pending = undefined;
    try { write(next); } catch (error) { onError?.(error); }
  };
  return {
    schedule(value) {
      if (disposed) return;
      pending = value;
      if (timer !== null) clearTimer(timer);
      timer = setTimer(flush, delay);
    },
    flush,
    dispose() { if (disposed) return; disposed = true; flush(); },
  };
}
