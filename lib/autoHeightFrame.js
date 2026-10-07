// Same-origin presentation bridge only. Authentication and page actions stay in the frame.
export function bindAutoHeightFrame(frame) {
  let disconnect = () => {};
  function connect() {
    disconnect();
    let doc;
    try { doc = frame.contentDocument; } catch { return; }
    if (!doc?.body || !doc.head) return;
    if (doc.location && doc.location.pathname !== '/sales/farm-quality') { frame.style.height = '600px'; return; }
    const view = doc.defaultView;
    if (typeof view?.ResizeObserver !== 'function') return;
    const style = doc.createElement('style');
    style.dataset.autoHeightFrame = 'true';
    style.textContent = `html,body{height:auto!important;min-height:0!important;overflow:hidden!important}
      [data-ui-shell="popup"]{height:auto!important;min-height:0!important}
      [data-ui-shell="popup"]>:last-child{flex:none!important;overflow:visible!important}`;
    doc.head.appendChild(style);
    let pending = 0;
    function measure() {
      pending = 0;
      // A link inside the existing application can navigate to a different page.
      // Do not apply this page's height contract to another viewport-based screen.
      if (doc.location && doc.location.pathname !== '/sales/farm-quality') {
        disconnect();
        frame.style.height = '600px';
        return;
      }
      // Hidden tabs must not shrink the saved frame to zero.
      if (!frame.getClientRects().length || !frame.clientWidth) return;
      const height = Math.ceil(doc.body.getBoundingClientRect().height);
      if (Number.isFinite(height) && height > 0) frame.style.height = `${height + 2}px`;
    }
    function schedule() {
      if (!pending) pending = view.requestAnimationFrame(measure);
    }
    let observer;
    disconnect = () => {
      observer?.disconnect();
      view.removeEventListener('resize', schedule);
      if (pending) view.cancelAnimationFrame(pending);
      style.remove();
    };
    try {
      observer = new view.ResizeObserver(schedule);
      observer.observe(doc.body);
      observer.observe(frame);
      view.addEventListener('resize', schedule);
      schedule();
    } catch {
      // Preserve ordinary iframe scrolling if auto-sizing cannot be installed.
      disconnect();
      disconnect = () => {};
    }
  }
  frame.addEventListener('load', connect);
  connect();
  return () => { frame.removeEventListener('load', connect); disconnect(); };
}
