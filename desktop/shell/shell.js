/* The Electron preload exposes only the named desktop actions. All labels and
 * destinations below come from the main process state and are rendered as text. */
(() => {
  'use strict';

  const desktop = window.desktop;
  const $ = (id) => document.getElementById(id);
  const state = { windowId: null, windows: [], tabs: [], activeId: null, menuOpen: true, toolsOpen: false, favorites: [], menus: [], online: true, message: '', notice: '', syncStatus: 'checking' };
  let lastMenuTrigger = null;
  let draggingId = null;
  let dropHandled = false;
  let pending = false;
  let tabSignature = '';
  let menuSignature = '';

  function activeTab() { return state.tabs.find((tab) => tab.id === state.activeId) || null; }
  function shortUrl(url) {
    try { const parsed = new URL(url); return parsed.pathname + parsed.search; }
    catch { return String(url || ''); }
  }
  function call(action, payload) {
    if (!desktop || typeof desktop.invoke !== 'function') return Promise.reject(new Error('데스크톱 연결을 사용할 수 없습니다.'));
    return desktop.invoke(action, payload).catch((error) => {
      $('statusMessage').textContent = error && error.message ? error.message : '요청을 처리하지 못했습니다.';
      throw error;
    });
  }
  function run(action, payload) { void call(action, payload).catch(() => {}); }
  function makeButton(className, label, title, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.title = title || label;
    button.addEventListener('click', onClick);
    return button;
  }
  function setMenu(open, focusSearch = false) {
    if (open) lastMenuTrigger = document.activeElement;
    void call('menu', { open }).then(() => {
      if (focusSearch) requestAnimationFrame(() => $('menuSearch').focus());
      if (!open && lastMenuTrigger && typeof lastMenuTrigger.focus === 'function') {
        requestAnimationFrame(() => lastMenuTrigger.focus());
      }
    }).catch(() => {});
  }
  function openPage(item) {
    if (!item || !item.href) return;
    run('open', { url: item.href, title: item.labelKey || item.title || item.href });
  }

  function moveMenuFocus(event) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = [...document.querySelectorAll('#favoritesList button, #menuGroups button')];
    if (!items.length) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement);
    const nextIndex = index < 0 ? (event.key === 'ArrowDown' ? 0 : items.length - 1) :
      (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[nextIndex].focus();
  }

  function renderTabs(force = false) {
    const root = $('tabs');
    const nextSignature = JSON.stringify([state.activeId, state.tabs.map(({ id, title, url, loading, error }) => [id, title, url, loading, error])]);
    if (!force && nextSignature === tabSignature) return;
    if (draggingId || root.querySelector('.tab-rename')) return;
    const focused = root.contains(document.activeElement) ? {
      id: document.activeElement.closest('.tab')?.dataset.id,
      selector: document.activeElement.classList.contains('tab-close') ? '.tab-close' : '.tab-main'
    } : null;
    const scroll = root.scrollLeft;
    root.replaceChildren();
    for (const tab of state.tabs) {
      const wrapper = document.createElement('div');
      wrapper.className = `tab${tab.id === state.activeId ? ' active' : ''}${tab.loading ? ' loading' : ''}${tab.error ? ' error' : ''}`;
      wrapper.draggable = true;
      wrapper.dataset.id = tab.id;
      const main = makeButton('tab-main', '', tab.title || tab.url || '업무 화면', () => run('activate', { id: tab.id }));
      main.setAttribute('role', 'tab');
      main.setAttribute('aria-selected', String(tab.id === state.activeId));
      main.setAttribute('aria-label', `${tab.title || '업무 화면'}${tab.loading ? ', 로딩 중' : ''}${tab.error ? ', 오류' : ''}`);
      const dot = document.createElement('span'); dot.className = 'tab-state'; dot.setAttribute('aria-hidden', 'true');
      const title = document.createElement('span'); title.className = 'tab-text'; title.textContent = tab.title || shortUrl(tab.url) || '업무 화면';
      main.append(dot, title);
      main.addEventListener('dblclick', () => {
        const input = document.createElement('input');
        input.className = 'tab-rename'; input.type = 'text'; input.value = tab.title || '';
        input.maxLength = 80; input.setAttribute('aria-label', '탭 이름 변경');
        let done = false;
        const finish = (save) => {
          if (done) return;
          done = true;
          const nextTitle = input.value.trim();
          if (save && nextTitle && nextTitle !== tab.title) run('rename', { id: tab.id, title: nextTitle });
          input.replaceWith(main);
          main.focus();
          renderTabs();
        };
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') { event.preventDefault(); finish(true); }
          if (event.key === 'Escape') { event.preventDefault(); finish(false); }
        });
        input.addEventListener('blur', () => finish(true));
        main.replaceWith(input); input.focus(); input.select();
      });
      main.addEventListener('keydown', (event) => {
        if (event.key === 'F2') { event.preventDefault(); main.dispatchEvent(new MouseEvent('dblclick')); return; }
        if (event.ctrlKey && event.shiftKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
          event.preventDefault();
          const index = state.tabs.findIndex((current) => current.id === tab.id);
          if (event.key === 'ArrowLeft' && index > 0) run('reorder', { id: tab.id, beforeId: state.tabs[index - 1].id });
          if (event.key === 'ArrowRight' && index < state.tabs.length - 1) run('reorder', { id: tab.id, beforeId: state.tabs[index + 2]?.id || null });
          return;
        }
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const index = state.tabs.findIndex((current) => current.id === tab.id);
        const next = state.tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + state.tabs.length) % state.tabs.length];
        if (next) root.querySelector(`[data-id="${CSS.escape(next.id)}"] .tab-main`)?.focus();
      });
      const close = makeButton('tab-close', '×', `${tab.title || '업무 화면'} 닫기`, () => run('close', { id: tab.id }));
      close.setAttribute('aria-label', `${tab.title || '업무 화면'} 닫기`);
      wrapper.append(main, close);
      wrapper.addEventListener('dragstart', (event) => {
        draggingId = tab.id; dropHandled = false;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('application/x-nenova-tab', tab.id);
        wrapper.classList.add('dragging');
      });
      wrapper.addEventListener('dragover', (event) => {
        if (!event.dataTransfer.types.includes('application/x-nenova-tab')) return;
        event.preventDefault(); event.dataTransfer.dropEffect = 'move';
        wrapper.classList.add('drag-over');
      });
      wrapper.addEventListener('dragleave', () => wrapper.classList.remove('drag-over'));
      wrapper.addEventListener('drop', (event) => {
        event.preventDefault(); wrapper.classList.remove('drag-over');
        const id = event.dataTransfer.getData('application/x-nenova-tab');
        if (!id || id === tab.id) return;
        dropHandled = true;
        run('reorder', { id, beforeId: tab.id });
      });
      wrapper.addEventListener('dragend', (event) => {
        wrapper.classList.remove('dragging', 'drag-over');
        if (!dropHandled && draggingId === tab.id) run('dragEnd', { id: tab.id, screenX: event.screenX, screenY: event.screenY });
        draggingId = null; dropHandled = false;
        renderTabs();
      });
      root.append(wrapper);
    }
    tabSignature = nextSignature;
    root.scrollLeft = scroll;
    if (focused?.id) root.querySelector(`[data-id="${CSS.escape(focused.id)}"] ${focused.selector}`)?.focus();
    $('tabCount').textContent = `탭 ${state.tabs.length}개`;
  }

  function renderMenus() {
    const query = $('menuSearch').value.trim().toLocaleLowerCase('ko');
    const nextSignature = JSON.stringify([query, state.online, state.menus, state.favorites]);
    if (nextSignature === menuSignature) return;
    menuSignature = nextSignature;
    const groups = $('menuGroups');
    groups.replaceChildren();
    let count = 0;
    const startItems = [];
    if (!state.online) startItems.push({ href: '/login', labelKey: '로그인' });
    if (!state.menus.some((group) => group.items?.some((item) => item.href === '/dashboard'))) {
      startItems.push({ href: '/dashboard', labelKey: '네노바 홈' });
    }
    const allGroups = startItems.length ? [{ group: '시작', items: startItems }, ...state.menus] : state.menus;
    for (const group of allGroups) {
      const groupName = String(group.group || '기타');
      const matching = (Array.isArray(group.items) ? group.items : []).filter((item) =>
        !query || `${groupName} ${item.labelKey || ''} ${item.href || ''}`.toLocaleLowerCase('ko').includes(query));
      if (!matching.length) continue;
      const card = document.createElement('section'); card.className = 'menu-group';
      const heading = document.createElement('h3');
      const line = document.createElement('span'); line.className = 'group-line'; line.setAttribute('aria-hidden', 'true');
      heading.append(line, document.createTextNode(groupName));
      const items = document.createElement('div'); items.className = 'group-items';
      for (const item of matching) {
        const button = makeButton('menu-item', '', `${item.labelKey || item.href} 열기`, () => openPage(item));
        const label = document.createElement('span'); label.textContent = item.labelKey || item.href;
        button.append(label); items.append(button); count++;
      }
      card.append(heading, items); groups.append(card);
    }
    $('resultCount').textContent = `${count}개 화면`;
    $('emptySearch').hidden = count > 0;
    const favorites = $('favoritesList'); favorites.replaceChildren();
    const matches = state.favorites.filter((item) => !query || `${item.title || ''} ${item.url || ''}`.toLocaleLowerCase('ko').includes(query));
    $('favoritesSection').hidden = !state.online;
    if (!matches.length && state.online) {
      const hint = document.createElement('p');
      hint.className = 'home-note';
      hint.textContent = query ? '검색한 즐겨찾기가 없습니다.' : '업무 화면을 열고 ☆ 또는 Ctrl+D를 누르면 여기에 추가됩니다.';
      favorites.append(hint);
    }
    for (const item of matches) {
      const button = makeButton('favorite-card', '', `${item.title || item.url} 열기`, () => openPage({ href: item.url, labelKey: item.title }));
      const star = document.createElement('span'); star.className = 'favorite-star'; star.textContent = '★'; star.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span'); label.textContent = item.title || shortUrl(item.url);
      button.append(star, label); favorites.append(button);
    }
  }

  function render() {
    const tab = activeTab();
    document.querySelector('.app-shell').classList.toggle('menu-open', Boolean(state.menuOpen));
    document.querySelector('.app-shell').classList.toggle('tools-open', Boolean(state.toolsOpen));
    $('home').hidden = !state.menuOpen;
    $('menuButton').setAttribute('aria-pressed', String(state.menuOpen));
    $('toolsButton').setAttribute('aria-pressed', String(state.toolsOpen));
    $('toolsButton').setAttribute('aria-label', state.notice ? `알림: ${state.notice}. 도구 펼치기` : state.toolsOpen ? '도구 접기' : '도구 펼치기');
    $('toolsButton').title = state.notice ? `${state.notice} · 도구를 열어 상태 확인` : '도구 펼치기/접기 (Ctrl+Shift+B)';
    $('toolsNotice').hidden = !state.notice;
    $('currentTitle').textContent = state.menuOpen ? '업무 메뉴' : (tab?.title || '업무 화면');
    $('currentUrl').textContent = state.menuOpen ? '' : shortUrl(tab?.url);
    const hasTab = Boolean(tab);
    $('compactFavoriteButton').disabled = !hasTab;
    for (const id of ['backButton', 'forwardButton', 'reloadButton', 'favoriteButton', 'zoomOutButton', 'zoomButton', 'zoomInButton', 'printButton', 'detachButton', 'moveSelect']) $(id).disabled = !hasTab;
    const favorite = hasTab && state.favorites.some((item) => item.url === tab.url);
    $('favoriteButton').textContent = favorite ? '★' : '☆';
    $('favoriteButton').setAttribute('aria-pressed', String(Boolean(favorite)));
    $('favoriteButton').setAttribute('aria-label', favorite ? '즐겨찾기 해제' : '즐겨찾기 추가');
    $('compactFavoriteButton').textContent = favorite ? '★' : '☆';
    $('compactFavoriteButton').setAttribute('aria-pressed', String(Boolean(favorite)));
    $('compactFavoriteButton').setAttribute('aria-label', favorite ? '즐겨찾기 해제' : '즐겨찾기 추가');
    $('zoomButton').textContent = `${Math.round((tab?.zoom || 1) * 100)}%`;
    $('connectionIndicator').className = `connection-indicator ${state.online ? 'online' : 'offline'}`;
    $('connectionText').textContent = state.online ? '로그인됨' : '로그인 필요';
    $('syncButton').disabled = state.syncStatus === 'checking';
    $('syncButton').textContent = state.syncStatus === 'checking' ? '업데이트 확인 중…' : '업데이트 확인';
    $('syncButton').title = state.webVersion ? `웹 메뉴·기능 확인 (${state.webVersion})` : '로그인 후 최신 웹 메뉴·기능을 확인합니다';
    $('statusMessage').textContent = state.message || (tab?.loading ? '화면을 불러오는 중' : tab?.error ? '화면을 불러오지 못했습니다' : '준비됨');
    $('windowLabel').textContent = `업무 창 ${state.windowId || ''}`;
    $('windowCount').textContent = state.windows.length > 1 ? `열린 창 ${state.windows.length}개` : '';
    const select = $('moveSelect');
    select.replaceChildren(new Option('창 이동', ''));
    for (const windowItem of state.windows) {
      if (windowItem.id === state.windowId) continue;
      select.add(new Option(windowItem.title || `업무 창 ${windowItem.id}`, windowItem.id));
    }
    select.disabled = !hasTab || select.options.length < 2;
    renderTabs(); renderMenus();
  }

  function applyState(next) {
    if (!next || typeof next !== 'object') return;
    const wasMenuOpen = state.menuOpen;
    for (const key of ['windowId', 'activeId', 'menuOpen', 'toolsOpen', 'online', 'message', 'notice', 'version', 'syncStatus', 'webVersion', 'menuVersion']) if (Object.prototype.hasOwnProperty.call(next, key)) state[key] = next[key];
    for (const key of ['windows', 'tabs', 'favorites', 'menus']) if (Array.isArray(next[key])) state[key] = next[key];
    render();
    if (!wasMenuOpen && state.menuOpen) requestAnimationFrame(() => $('menuSearch').focus());
  }

  function wire() {
    $('syncButton').addEventListener('click', () => run('sync'));
    $('homeButton').addEventListener('click', () => setMenu(true, true));
    $('menuButton').addEventListener('click', () => setMenu(!state.menuOpen, !state.menuOpen));
    $('toolsButton').addEventListener('click', () => run('tools'));
    $('compactFavoriteButton').addEventListener('click', () => { if (state.activeId) run('favorite', { id: state.activeId }); });
    $('addTabButton').addEventListener('click', () => setMenu(true, true));
    $('newWindowButton').addEventListener('click', () => run('newWindow'));
    $('backButton').addEventListener('click', () => run('navigate', { direction: 'back' }));
    $('forwardButton').addEventListener('click', () => run('navigate', { direction: 'forward' }));
    $('reloadButton').addEventListener('click', () => run('reload'));
    $('favoriteButton').addEventListener('click', () => { if (state.activeId) run('favorite', { id: state.activeId }); });
    $('detachButton').addEventListener('click', () => { if (state.activeId) run('detach', { id: state.activeId }); });
    $('printButton').addEventListener('click', () => run('print'));
    $('moveSelect').addEventListener('change', (event) => {
      if (state.activeId && event.target.value) run('move', { id: state.activeId, targetWindowId: event.target.value });
      event.target.value = '';
    });
    $('zoomOutButton').addEventListener('click', () => { const tab = activeTab(); if (tab) run('zoom', { value: Math.max(.5, Math.round(((tab.zoom || 1) - .1) * 10) / 10) }); });
    $('zoomInButton').addEventListener('click', () => { const tab = activeTab(); if (tab) run('zoom', { value: Math.min(2, Math.round(((tab.zoom || 1) + .1) * 10) / 10) }); });
    $('zoomButton').addEventListener('click', () => run('zoom', { value: 1 }));
    $('menuSearch').addEventListener('input', renderMenus);
    $('menuSearch').addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') moveMenuFocus(event);
    });
    $('favoritesList').addEventListener('keydown', moveMenuFocus);
    $('menuGroups').addEventListener('keydown', moveMenuFocus);
    $('tabs').addEventListener('dragover', (event) => {
      if (event.target.closest('.tab') || !event.dataTransfer.types.includes('application/x-nenova-tab')) return;
      event.preventDefault(); event.dataTransfer.dropEffect = 'move';
    });
    $('tabs').addEventListener('drop', (event) => {
      if (event.target.closest('.tab')) return;
      event.preventDefault();
      const id = event.dataTransfer.getData('application/x-nenova-tab');
      if (id) { dropHandled = true; run('reorder', { id, beforeId: null }); }
    });
    document.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'b') { event.preventDefault(); run('tools'); return; }
      if (event.key === 'Escape' && state.menuOpen) { event.preventDefault(); setMenu(false); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setMenu(true, true); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 't') { event.preventDefault(); setMenu(true, true); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'w' && state.activeId) { event.preventDefault(); run('close', { id: state.activeId }); }
    });
  }

  wire();
  render();
  if (desktop && typeof desktop.onState === 'function') desktop.onState(applyState);
  if (!pending) {
    pending = true;
    call('state').then(applyState).catch(() => { $('statusMessage').textContent = '데스크톱 상태를 읽지 못했습니다.'; }).finally(() => { pending = false; });
  }
})();
