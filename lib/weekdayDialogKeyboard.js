const selector='button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],iframe,[tabindex]:not([tabindex="-1"])';
const controls=root=>[...root.querySelectorAll(selector)].filter(node=>!node.hidden && node.getAttribute('aria-hidden')!=='true');

// Keep the preview document reachable while routing its boundary keys to the dialog.
export function installWeekdayDialogKeyboard(root,{onClose,canClose=()=>true,returnFocus,initialSelector,frame}={}) {
  const doc=root.ownerDocument;
  let frameDoc;
  const keydown=event=>{
    if(event.isComposing || event.nativeEvent?.isComposing) return;
    if(event.key==='Escape') {
      event.preventDefault();event.stopPropagation();
      if(canClose()) onClose();
      return;
    }
    if(event.key!=='Tab') return;
    const items=controls(root),active=doc.activeElement;
    if(!items.length) {event.preventDefault();root.focus();return;}
    if(!root.contains(active) || active===root
      || event.shiftKey && active===items[0] || !event.shiftKey && active===items.at(-1)) {
      event.preventDefault();(event.shiftKey?items.at(-1):items[0]).focus();
    }
  };
  const frameKeydown=event=>{
    if(event.key==='Escape') {keydown(event);return;}
    if(event.key!=='Tab' || event.isComposing) return;
    const inside=controls(frameDoc),active=frameDoc.activeElement;
    if(inside.length && (event.shiftKey?active!==inside[0]:active!==inside.at(-1)) && inside.includes(active)) return;
    const items=controls(root),index=items.indexOf(frame);
    event.preventDefault();
    (items[(index+(event.shiftKey?-1:1)+items.length)%items.length] || root).focus();
  };
  const bindFrame=()=>{
    frameDoc?.removeEventListener('keydown',frameKeydown);
    frameDoc=frame?.contentDocument;
    frameDoc?.addEventListener('keydown',frameKeydown);
  };
  doc.addEventListener('keydown',keydown);
  frame?.addEventListener('load',bindFrame);bindFrame();
  (root.querySelector(initialSelector || '[autofocus]') || controls(root)[0] || root).focus();
  return ()=>{
    doc.removeEventListener('keydown',keydown);
    frame?.removeEventListener('load',bindFrame);
    frameDoc?.removeEventListener('keydown',frameKeydown);
    const restore=()=>{if(returnFocus?.isConnected && !returnFocus.disabled)returnFocus.focus();};
    if(doc.defaultView?.requestAnimationFrame) doc.defaultView.requestAnimationFrame(restore);else restore();
  };
}
