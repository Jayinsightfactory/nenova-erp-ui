import { useEffect, useRef, useState } from 'react';
import styles from '../styles/ecount-workbench.module.css';

export function EcountWorkspaceDialog({ title, children, onClose, busy, lookupVariant, onNewWindow, standalone=false, lookupActionId, footerActions }) {
  const panel = useRef(null);
  const [maximized,setMaximized]=useState(false);
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
  return <div className={standalone?styles.lookupStandalone:styles.overlay}><section ref={panel} tabIndex={-1} role="dialog" aria-modal={!standalone} aria-label={title} className={`${styles.dialog} ${lookupVariant?styles.lookupDialog:''} ${lookupVariant==='order'?styles.orderLookupDialog:lookupVariant==='po'?styles.poLookupDialog:['warehouse','product'].includes(lookupVariant)?styles.warehouseLookupDialog:''} ${maximized?styles.lookupMaximized:''}`}  onKeyDown={keys}>
    <header><h2>{title}</h2>{lookupVariant&&<div className={styles.lookupTitleTools}>{!standalone&&<button type="button" data-ecount-action-id={lookupActionId?.('new-window','제목줄')} aria-label="새창" onClick={onNewWindow} disabled={!onNewWindow}>↗</button>}{['고정','새로고침','최대화'].map((label,index)=><button type="button" key={label} data-ecount-action-id={lookupActionId?.(['pin','refresh','maximize'][index],'제목줄')} aria-label={index===2&&maximized?'복원':label} aria-pressed={index===2&&lookupVariant==='po'&&!standalone?maximized:undefined} disabled={index!==2||lookupVariant!=='po'||standalone} onClick={index===2&&lookupVariant==='po'&&!standalone?()=>setMaximized(value=>!value):undefined} title={index===2&&lookupVariant==='po'&&!standalone?'':'원본 동작을 아직 확인하지 않았습니다.'}>{index===2&&maximized?'▣':['⌖','↻','□'][index]}</button>)}</div>}<button onClick={onClose} disabled={busy} aria-label="닫기" data-ecount-action-id={lookupActionId?.('close','제목줄')}>×</button></header>{children}{lookupVariant&&<footer>{footerActions}<button type="button" data-ecount-action-id={lookupActionId?.('닫기','하단')} onClick={onClose}>닫기</button>{lookupVariant==='po'&&<button disabled data-ecount-action-id={lookupActionId?.('키보드 활용 TIP 상세보기','하단')} className={styles.lookupKeyboardTip} title="원본 동작은 아직 확인하지 않았습니다.">☀ 키보드 활용 TIP 상세보기 ▴</button>}</footer>}
  </section></div>;
}
