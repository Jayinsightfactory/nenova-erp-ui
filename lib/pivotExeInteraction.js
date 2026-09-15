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
