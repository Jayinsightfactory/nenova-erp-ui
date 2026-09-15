import { useEffect, useRef, useState } from 'react';

const styles = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 1000, display: 'grid', placeItems: 'center',
    padding: 'clamp(12px, 3vw, 24px)', overflowY: 'auto', background: 'rgba(15, 23, 42, 0.48)',
  },
  dialog: {
    boxSizing: 'border-box', width: 'min(460px, 100%)', maxHeight: 'calc(100dvh - 24px)',
    overflowY: 'auto', padding: 22, borderRadius: 10, background: '#fff',
    boxShadow: '0 22px 60px rgba(15, 23, 42, 0.28)', color: '#0f172a',
  },
  title: { margin: 0, fontSize: 19, lineHeight: 1.35 },
  description: { margin: '8px 0 18px', color: '#475569', fontSize: 13, lineHeight: 1.55 },
  label: { display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 700 },
  input: {
    boxSizing: 'border-box', width: '100%', minHeight: 42, padding: '9px 11px',
    border: '1px solid #94a3b8', borderRadius: 6, color: '#0f172a', fontSize: 15,
  },
  hint: { margin: '6px 0 0', color: '#64748b', fontSize: 12 },
  error: { margin: '10px 0 0', color: '#b91c1c', fontSize: 13, lineHeight: 1.45 },
  actions: { display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8, marginTop: 20 },
  button: {
    minHeight: 40, minWidth: 88, padding: '8px 14px', border: '1px solid #cbd5e1',
    borderRadius: 6, background: '#fff', color: '#1e293b', fontSize: 14, fontWeight: 600,
    cursor: 'pointer',
  },
  primary: { background: '#0f766e', borderColor: '#0f766e', color: '#fff' },
  disabled: { cursor: 'not-allowed', opacity: 0.55 },
};

const HOTEL_NAME_MAX_LENGTH = 80;

export default function PnlHotelAddDialog({ open, onClose, onSubmit, busy = false, error = '' }) {
  const [name, setName] = useState('');
  const [validationError, setValidationError] = useState('');
  const dialogRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) {
      setName('');
      setValidationError('');
      return undefined;
    }
    const previousFocus = typeof document !== 'undefined' ? document.activeElement : null;
    inputRef.current?.focus();
    return () => previousFocus?.focus?.();
  }, [open]);

  if (!open) return null;

  const submit = (event) => {
    event.preventDefault();
    if (busy) return;
    const trimmedName = Array.from(String(name || '').trim()).slice(0, HOTEL_NAME_MAX_LENGTH).join('');
    if (!trimmedName) {
      setValidationError('호텔명을 입력하세요.');
      inputRef.current?.focus();
      return;
    }
    setValidationError('');
    // 호텔명만 전달합니다. 전산 거래처/ERP 검색·생성은 이 컴포넌트의 책임이 아닙니다.
    onSubmit?.(trimmedName);
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!busy) onClose?.();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = dialogRef.current?.querySelectorAll?.('input:not(:disabled), button:not(:disabled)');
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && event.target === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && event.target === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const visibleError = validationError || error;
  const close = () => { if (!busy) onClose?.(); };

  return (
    <div
      style={styles.overlay}
      onMouseDown={event => { if (event.target === event.currentTarget) close(); }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pnl-hotel-add-title"
        aria-describedby="pnl-hotel-add-description"
        style={styles.dialog}
        onKeyDown={handleKeyDown}
      >
        <h2 id="pnl-hotel-add-title" style={styles.title}>호텔 결산 탭 추가</h2>
        <p id="pnl-hotel-add-description" style={styles.description}>
          호텔명을 직접 입력하세요. 별도 결산 탭만 추가하며 전산 거래처는 만들지 않습니다.
        </p>
        <form onSubmit={submit} noValidate>
          <label htmlFor="pnl-hotel-add-name" style={styles.label}>호텔명</label>
          <input
            ref={inputRef}
            id="pnl-hotel-add-name"
            name="hotelName"
            type="text"
            autoComplete="off"
            autoFocus
            required
            maxLength={HOTEL_NAME_MAX_LENGTH}
            value={name}
            disabled={busy}
            aria-invalid={visibleError ? 'true' : undefined}
            aria-describedby={visibleError ? 'pnl-hotel-add-hint pnl-hotel-add-error' : 'pnl-hotel-add-hint'}
            onChange={event => {
              setName(Array.from(event.target.value).slice(0, HOTEL_NAME_MAX_LENGTH).join(''));
              if (validationError) setValidationError('');
            }}
            style={styles.input}
          />
          <p id="pnl-hotel-add-hint" style={styles.hint}>최대 80자</p>
          {visibleError ? <p id="pnl-hotel-add-error" role="alert" aria-live="assertive" style={styles.error}>{visibleError}</p> : null}
          <div style={styles.actions}>
            <button type="button" disabled={busy} onClick={close} style={{ ...styles.button, ...(busy ? styles.disabled : {}) }}>취소</button>
            <button type="submit" disabled={busy} style={{ ...styles.button, ...styles.primary, ...(busy ? styles.disabled : {}) }}>
              {busy ? '추가 중…' : '호텔 추가'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
