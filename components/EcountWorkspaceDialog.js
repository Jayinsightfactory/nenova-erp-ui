import { useEffect, useRef } from 'react';
import styles from '../styles/ecount-workbench.module.css';

export function EcountWorkspaceDialog({ title, children, onClose, busy }) {
  const panel = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    (panel.current?.querySelector('button:not(:disabled),input:not(:disabled),select:not(:disabled)')||panel.current)?.focus();
    return () => previous?.isConnected && previous.focus();
  }, []);
  function keys(event) {
    if (event.key === 'Escape' && !busy) { event.preventDefault(); closeRef.current(); }
    if (event.key !== 'Tab') return;
    const controls = [...panel.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],textarea:not(:disabled)')];
    if(!controls.length){event.preventDefault();panel.current?.focus();return;}
    const first = controls[0], last = controls.at(-1);
    if (document.activeElement===panel.current){event.preventDefault();(event.shiftKey?last:first)?.focus();}
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  return <div className={styles.overlay}><section ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={styles.dialog} onKeyDown={keys}>
    <header><h2>{title}</h2><button onClick={onClose} disabled={busy} aria-label="닫기">×</button></header>{children}
  </section></div>;
}
