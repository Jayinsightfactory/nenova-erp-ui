(() => {
  'use strict';
  const button = document.getElementById('startupButton');
  const status = document.getElementById('startupStatus');
  button.style.fontSize = '14px';
  button.style.minHeight = '32px';
  button.style.height = 'auto';
  button.style.whiteSpace = 'normal';
  status.style.fontSize = '14px';
  let current = {}, busy = false;
  function render(state) {
    current = state.startup || {};
    button.disabled = busy || !current.supported;
    button.setAttribute('aria-pressed', String(!!current.enabled));
    button.textContent = '로그인 시 자동 실행: ' + (current.enabled ? '켜짐' : '꺼짐');
    button.setAttribute('aria-label', 'Windows ' + button.textContent);
    status.textContent = current.message || '';
  }
  window.desktop.onState(render);
  window.desktop.invoke('state').then(render).catch(() => { status.textContent = '자동 실행 설정을 확인하지 못했습니다.'; });
  button.addEventListener('click', async () => {
    const hadFocus = document.activeElement === button;
    busy = true; button.disabled = true;
    try { render(await window.desktop.invoke('startup', { enabled: !current.enabled })); }
    catch (error) { status.textContent = error.message; }
    finally {
      busy = false; button.disabled = !current.supported;
      if (hadFocus && document.activeElement === document.body) button.focus({ preventScroll: true });
    }
  });
})();
