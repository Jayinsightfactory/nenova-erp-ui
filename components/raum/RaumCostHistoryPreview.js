import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const CLOSE_DELAY = 140;

function formatValues(values) {
  if (!values?.length) return '—';
  return values.map(value => Number(value) === 0 ? '0' : Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 })).join(' / ');
}

/** Read-only, portal-rendered history for one purchase-cost editor. */
export default function RaumCostHistoryPreview({
  item,
  valuesByWeek = [],
  weeks = [],
  orderYear,
  loading = false,
  error = '',
  children,
}) {
  const itemIdentity = `${item?.itemKey ?? item?._uid ?? item?.prodKey ?? item?.name ?? ''}|${item?.unit ?? ''}`;
  const anchorRef = useRef(null);
  const closeTimer = useRef(null);
  const popupRef = useRef(null);
  const measuredRef = useRef(false);
  const tooltipId = useId().replace(/:/g, '');
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);

  const clearClose = useCallback(() => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);
  const close = useCallback(() => { clearClose(); setOpen(false); setPosition(null); }, [clearClose]);
  const scheduleClose = useCallback(() => {
    clearClose();
    closeTimer.current = window.setTimeout(close, CLOSE_DELAY);
  }, [clearClose, close]);

  const place = useCallback(() => {
    if (!anchorRef.current || typeof window === 'undefined') return;
    const rect = anchorRef.current.getBoundingClientRect();
    const width = Math.max(0, Math.min(360, window.innerWidth - 24));
    const maxHeight = Math.max(0, Math.min(430, window.innerHeight - 24));
    const popupHeight = popupRef.current?.getBoundingClientRect().height || 180;
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    const below = rect.bottom + 8;
    const top = below + popupHeight <= window.innerHeight - 12
      ? below
      : Math.max(12, rect.top - Math.min(popupHeight, maxHeight) - 8);
    setPosition({ left, top, width, maxHeight });
  }, []);

  const show = useCallback(() => {
    clearClose();
    measuredRef.current = false;
    setOpen(true);
    window.requestAnimationFrame(place);
  }, [clearClose, place]);

  useEffect(() => {
    close();
    // Item, partner/year/detail changes invalidate the old anchor.
  }, [itemIdentity, orderYear, close]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = event => { if (event.key === 'Escape') close(); };
    const onViewport = event => {
      if (event.target === popupRef.current || popupRef.current?.contains(event.target)) return;
      close();
    };
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onViewport);
    window.addEventListener('scroll', onViewport, true);
    place();
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onViewport);
      window.removeEventListener('scroll', onViewport, true);
    };
  }, [open, close, place]);

  useEffect(() => {
    if (!open) return undefined;
    const frame = window.requestAnimationFrame(place);
    return () => window.cancelAnimationFrame(frame);
  }, [open, weeks.length, loading, error, place]);

  useEffect(() => {
    if (!open || !position || measuredRef.current) return undefined;
    measuredRef.current = true;
    const frame = window.requestAnimationFrame(place);
    return () => window.cancelAnimationFrame(frame);
  }, [open, position, place]);

  useEffect(() => () => clearClose(), [clearClose]);

  const child = children({
    ref: anchorRef,
    onMouseEnter: show,
    onMouseLeave: scheduleClose,
    onFocus: show,
    onBlur: event => {
      if (popupRef.current?.contains(event.relatedTarget)) return;
      scheduleClose();
    },
    'aria-describedby': open ? tooltipId : undefined,
  });

  const popup = open && position && typeof document !== 'undefined' ? createPortal(
    <div
      className="raum-cost-history-preview"
      ref={popupRef}
      id={tooltipId}
      role="tooltip"
      onMouseEnter={clearClose}
      onMouseLeave={scheduleClose}
      style={{ position: 'fixed', left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight, boxSizing: 'border-box', overflowY: 'auto', zIndex: 10000, padding: '10px 12px', background: '#fff', border: '1px solid #93c5fd', borderRadius: 7, boxShadow: '0 8px 24px rgba(15,23,42,.2)', fontSize: 12, color: '#1e293b' }}
    >
      <div style={{ fontWeight: 700, marginBottom: 3 }}>{item?.name || '품목'} · {orderYear || '연도 미지정'}년</div>
      <div style={{ color: '#475569', marginBottom: 8 }}>차수별 저장 매입단가 (원/VAT별도)</div>
      {loading ? <div style={{ color: '#64748b' }}>불러오는 중…</div> : null}
      {error ? <div style={{ color: '#b91c1c' }}>{error}</div> : null}
      {!loading && !error && !weeks.length ? <div style={{ color: '#64748b' }}>저장된 비교값 없음</div> : null}
      {!loading && !error && weeks.length ? (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <tbody>{weeks.map((week, index) => (
            <tr key={week.key}>
              <th style={{ textAlign: 'left', padding: '3px 10px 3px 0', fontWeight: 600 }}>{week.label}</th>
              <td style={{ textAlign: 'right', padding: '3px 0', whiteSpace: 'nowrap' }}>{formatValues(valuesByWeek[index])}</td>
            </tr>
          ))}</tbody>
        </table>
      ) : null}
    </div>,
    document.body
  ) : null;

  return <>{child}{popup}</>;
}
