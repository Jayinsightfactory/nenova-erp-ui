/* The Electron preload exposes only the named desktop actions. All labels and
 * destinations below come from the main process state and are rendered as text. */
(() => {
  'use strict';

  const desktop = window.desktop;
  const $ = (id) => document.getElementById(id);
  const state = { windowId: null, windows: [], tabs: [], activeId: null, menuOpen: true, toolsOpen: false, favorites: [], menus: [], online: true, message: '', notice: '', syncStatus: 'checking' };
  const pmLive = { owner: '', timer: null, busy: false, generation: 0 };
  let lastMenuTrigger = null;
  let draggingId = null;
  let dropHandled = false;
  let pending = false;
  let tabSignature = '';
  let renderedActiveId = null;
  let menuSignature = '';
  let favoritesOwner='',favoritesOpen=true;
  function favoritesPreference(){return 'nenova-favorites-open-v1:'+encodeURIComponent(favoritesOwner);}
  function renderFavoritesVisibility(){
    let toggle=$('favoritesToggle');if(!toggle){toggle=makeButton('favorites-toggle','','즐겨찾기 목록 접기/열기',()=>{favoritesOpen=!favoritesOpen;try{if(favoritesOwner)localStorage.setItem(favoritesPreference(),favoritesOpen?'1':'0');}catch{}renderFavoritesVisibility();});toggle.id='favoritesToggle';toggle.setAttribute('aria-controls','favoritesList');$('favoritesHeading').parentElement.append(toggle);}
    $('favoritesList').hidden=!favoritesOpen;toggle.textContent=favoritesOpen?'접기 ▴':'열기 ▾';toggle.setAttribute('aria-expanded',String(favoritesOpen));toggle.disabled=!state.online;
  }
  let searchCatalog = [], searchMatches = [], activeResult = -1;
  const searchKey = text => String(text || '').normalize('NFKC').toLocaleLowerCase('ko').replace(/\s+/g, '');

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

  function dismissMenuResults() {
    $('menuSearchPopup').hidden = true;
    $('menuSearch').setAttribute('aria-expanded', 'false');
    $('menuSearch').removeAttribute('aria-activedescendant');
    activeResult = -1;
  }
  function chooseMenuResult(index) {
    const item = searchMatches[index];
    if (!item) return;
    $('menuSearch').value = '';
    dismissMenuResults();
    openPage(item);
  }
  function highlightMenuResult(index) {
    const list = $('menuSearchResults'), previous = list.children[activeResult], option = list.children[index];
    if (!option) return;
    previous?.setAttribute('aria-selected','false');
    activeResult = index; option.setAttribute('aria-selected','true');
    $('menuSearch').setAttribute('aria-activedescendant',option.id);
    const box=list.getBoundingClientRect(), row=option.getBoundingClientRect();
    if(row.bottom>box.bottom)list.scrollTop+=row.bottom-box.bottom;
    else if(row.top<box.top)list.scrollTop-=box.top-row.top;
  }
  function showMenuResults() {
    const input = $('menuSearch'), key = searchKey(input.value), list = $('menuSearchResults');
    dismissMenuResults(); list.replaceChildren(); searchMatches = [];
    if (!key || !state.menuOpen || document.activeElement !== input) return;
    // Build the full menu catalog only when permissions or favorites change.
    const matched = searchCatalog.filter(item => item.key.includes(key));
    const rank = item => item.name === key ? 0 : item.name.startsWith(key) ? 1 : item.name.includes(key) ? 2 : 3;
    const seen = new Set();
    for (const item of matched.sort((a,b) => rank(a) - rank(b))) {
      if (seen.has(item.route)) continue;
      seen.add(item.route); searchMatches.push(item);
    }
    const rows = document.createDocumentFragment();
    for (const [index,item] of searchMatches.entries()) {
      const option = makeButton('home-menu-option', '', item.labelKey+' 열기', () => chooseMenuResult(index));
      option.id='home-menu-option-'+index;option.tabIndex=-1;option.setAttribute('role','option');option.setAttribute('aria-selected','false');
      const name=document.createElement('span'),group=document.createElement('small');name.textContent=item.display;group.textContent=item.group;
      option.append(name,group);rows.append(option);
    }
    list.append(rows);list.scrollTop=0;
    $('menuSearchStatus').textContent=searchMatches.length?'검색 결과 '+searchMatches.length+'개':'검색 결과가 없습니다. 다른 메뉴 이름으로 찾아보세요.';
    $('menuSearchPopup').hidden=false;input.setAttribute('aria-expanded','true');
  }
  function indexMenu(href, labelKey, group, display=labelKey) {
    if (!href) return;
    let route;try{route=new URL(href,'https://nenovaweb.com').href;}catch{return;}
    searchCatalog.push({href,route,labelKey,group,display,name:searchKey(display),key:searchKey([display,labelKey,group,href].join(' '))});
  }

  function moveMenuFocus(event) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = [...document.querySelectorAll('#favoritesList button, #menuGroups button')].filter(button => !button.disabled);
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
    const activeChanged = renderedActiveId !== state.activeId;
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
      wrapper.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        run('tabContextMenu', { id: tab.id, x: Math.round(event.clientX), y: Math.round(event.clientY) });
      });
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
    renderedActiveId = state.activeId;
    root.scrollLeft = scroll;
    if (focused?.id) root.querySelector(`[data-id="${CSS.escape(focused.id)}"] ${focused.selector}`)?.focus({ preventScroll: true });
    // Follow selection only. Loading/title updates must preserve manual scrolling.
    if (activeChanged) {
      const active = root.querySelector('.tab.active');
      if (active) {
        const bounds = root.getBoundingClientRect();
        const tabBounds = active.getBoundingClientRect();
        if (tabBounds.left < bounds.left) root.scrollLeft += tabBounds.left - bounds.left;
        else if (tabBounds.right > bounds.right) root.scrollLeft += tabBounds.right - bounds.right;
      }
    }
    $('tabCount').textContent = `탭 ${state.tabs.length}개`;
  }

  function renderMenus() {
    const nextSignature = JSON.stringify([state.online, state.menus, state.favorites]);
    if (nextSignature === menuSignature) return;
    menuSignature = nextSignature;
    searchCatalog = [];
    const focusedFavorite = document.activeElement?.dataset?.menuFavorite;
    const groups = $('menuGroups');
    groups.replaceChildren();
    let count = 0;
    const startItems = [];
    if (!state.online) startItems.push({ href: '/login', labelKey: '로그인' });
    if (!state.menus.some((group) => group.items?.some((item) => item.href === '/dashboard'))) {
      startItems.push({ href: '/dashboard', labelKey: '네노바 홈', favorite: state.favorites.some(f => { try { return new URL(f.url).pathname === '/dashboard'; } catch { return false; } }) });
    }
    const allGroups = startItems.length ? [{ group: '시작', items: startItems }, ...state.menus] : state.menus;
    for (const group of allGroups) {
      const groupName = String(group.group || '기타');
      const matching = Array.isArray(group.items) ? group.items : [];
      if (!matching.length) continue;
      const card = document.createElement('section'); card.className = 'menu-group';
      const heading = document.createElement('h3');
      const line = document.createElement('span'); line.className = 'group-line'; line.setAttribute('aria-hidden', 'true');
      heading.append(line, document.createTextNode(groupName));
      const items = document.createElement('div'); items.className = 'group-items';
      for (const item of matching) {
        indexMenu(item.href,item.labelKey || item.href,groupName);
        const button = makeButton('menu-item', '', `${item.labelKey || item.href} 열기`, () => openPage(item));
        const label = document.createElement('span'); label.textContent = item.labelKey || item.href;
        button.append(label);
        const row = document.createElement('div'); row.className = 'menu-row';
        const star = makeButton('menu-favorite', item.favorite ? '★' : '☆', `${item.labelKey || item.href} 즐겨찾기 ${item.favorite ? '해제' : '추가'}`, () => run('menuFavorite', { href: item.href }));
        star.disabled = !state.online || item.href === '/login';
        star.dataset.menuFavorite = item.href;
        star.setAttribute('aria-label', star.title);
        star.setAttribute('aria-pressed', String(Boolean(item.favorite)));
        row.append(button, star); items.append(row); count++;
      }
      card.append(heading, items); groups.append(card);
    }
    $('resultCount').textContent = `${count}개 화면`;
    $('emptySearch').hidden = count > 0;
    const favorites = $('favoritesList'); favorites.replaceChildren();
    const matches = state.favorites;
    $('favoritesSection').hidden = !state.online;
    if (!matches.length && state.online) {
      const hint = document.createElement('p');
      hint.className = 'home-note';
      hint.textContent = '아래 메뉴 이름 옆 ☆를 누르면 화면을 열지 않고 즐겨찾기에 추가됩니다.';
      favorites.append(hint);
    }
    for (const item of matches) {
      if(state.online)indexMenu(item.url,item.title || shortUrl(item.url),'즐겨찾기',item.number+' '+(item.alias || item.title || shortUrl(item.url)));
      const button = makeButton('favorite-card', '', `${item.title || item.url} 열기`, () => openPage({ href: item.url, labelKey: item.title }));
      const original = item.title || shortUrl(item.url);
      button.textContent = `${item.number} ${item.alias && item.alias !== original ? `${item.alias}(${original})` : original}`;
      const row = document.createElement('div');
      row.className = 'favorite-row';
      const edit = makeButton('menu-favorite', '✎', `${original} 즐겨찾기 이름 변경`, () => {
        const input = document.createElement('input');
        input.maxLength = 60;
        input.setAttribute('aria-label', '즐겨찾기 이름');
        input.value = item.alias || '';
        const cancel = () => { row.replaceChildren(button, edit); edit.focus(); };
        const save = () => { run('renameFavorite', { url: item.url, alias: input.value.trim() }); cancel(); };
        input.addEventListener('keydown', event => {
          if (event.isComposing) return;
          if (event.key === 'Enter') save();
          if (event.key === 'Escape') cancel();
        });
        row.replaceChildren(input, makeButton('', '저장', '이름 저장', save), makeButton('', '취소', '취소', cancel));
        input.focus();
      });
      row.append(button, edit);
      favorites.append(row);
    }
    if (focusedFavorite) [...document.querySelectorAll('[data-menu-favorite]')].find(button => button.dataset.menuFavorite === focusedFavorite)?.focus();
    showMenuResults();
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
    $('logoutButton').disabled = !state.online;
    if ($('quickNewWindowButton')) $('quickNewWindowButton').disabled = !state.online;
    if ($('newWindowButton')) $('newWindowButton').disabled = !state.online;
    $('syncButton').disabled = state.syncStatus === 'checking';
    $('syncButton').textContent = state.syncStatus === 'checking' ? '웹 메뉴 확인 중…' : '웹 메뉴 갱신';
    $('syncButton').title = state.webVersion ? `웹 메뉴·기능 확인 (${state.webVersion})` : '로그인 후 최신 웹 메뉴·기능을 확인합니다';
    const update = state.appUpdate || { phase: 'unavailable', message: '' };
    const needUpdate = ['available', 'downloaded'].includes(update.phase);
    const updateNotice = $('appUpdateNotice');
    updateNotice.hidden = !needUpdate;
    updateNotice.textContent = update.phase === 'downloaded' ? '업데이트 준비됨' : '업데이트 하세요';
    updateNotice.title = update.phase === 'downloaded' ? '다운로드 완료. 지금 업데이트하세요' : `업데이트가 필요합니다. 앱 ${update.version || ''} 지금 업데이트하세요`;
    updateNotice.setAttribute('aria-label', updateNotice.title);
    updateNotice.style.background = needUpdate ? '#d82f36' : '';
    updateNotice.style.borderColor = needUpdate ? '#b42318' : '';
    updateNotice.style.color = needUpdate ? '#ffffff' : '';
    updateNotice.style.fontWeight = needUpdate ? '700' : '';
    const updatePanel = document.querySelector('.app-update-panel');
    if (updatePanel) {
      updatePanel.style.borderColor = needUpdate ? '#d82f36' : '';
      updatePanel.style.background = needUpdate ? '#fff5f5' : '';
      updatePanel.style.boxShadow = needUpdate ? '0 0 0 2px #d82f361f' : '';
    }
    const updateBtn = $('appUpdateButton');
    updateBtn.disabled = ['unavailable', 'checking', 'downloading', 'installing'].includes(update.phase);
    updateBtn.textContent = update.phase === 'available' ? `앱 ${update.version} 다운로드` : update.phase === 'downloaded' ? '재시작하여 업데이트' : update.phase === 'checking' ? '앱 업데이트 확인 중…' : update.phase === 'downloading' ? `다운로드 ${update.percent}%` : '앱 업데이트 확인';
    updateBtn.style.background = needUpdate ? '#d82f36' : '';
    updateBtn.style.borderColor = needUpdate ? '#b42318' : '';
    updateBtn.style.color = needUpdate ? '#ffffff' : '';
    updateBtn.style.fontWeight = needUpdate ? '700' : '';
    $('cancelUpdateButton').hidden = update.phase !== 'downloading';
    const updateStatusEl = $('appUpdateStatus');
    updateStatusEl.textContent = needUpdate
      ? `앱 ${state.version || ''} · 업데이트 필요 — 지금 업데이트하세요${update.message ? ` (${update.message})` : ''}`
      : `앱 ${state.version || ''} · ${update.message || ''}`;
    updateStatusEl.style.color = needUpdate ? '#c92a2a' : '';
    updateStatusEl.style.fontWeight = needUpdate ? '700' : '';
    const releaseNotes = Array.isArray(update.releaseNotes) ? update.releaseNotes.filter(note => typeof note === 'string' && note.trim()).slice(0, 3) : [];
    const notes = releaseNotes.length ? releaseNotes : [
      '상단 홈 버튼을 알아보기 쉬운 집 모양으로 바꿨습니다.',
      '기존 홈 열기·닫기와 Ctrl+K 동작은 유지합니다.',
      '기존 작업 공간과 입력·선택 내용을 유지합니다.'
    ];
    $('appUpdateNotesHeading').textContent = '앱 ' + (releaseNotes.length ? (update.version || state.version || '') : (state.version || '')) + ' 변경 내용';
    $('appUpdateNotes').replaceChildren(...notes.map(note => {
      const item = document.createElement('li'); item.textContent = note; return item;
    }));
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
    renderTabs(); renderMenus();renderFavoritesVisibility();
  }

  function applyState(next) {
    if (!next || typeof next !== 'object') return;
    const wasMenuOpen = state.menuOpen;
    if(Object.hasOwn(next,'homeOwnerId')&&String(next.homeOwnerId||'')!==favoritesOwner){favoritesOwner=String(next.homeOwnerId||'');favoritesOpen=true;try{favoritesOpen=localStorage.getItem(favoritesPreference())!=='0';}catch{}}
    if(next.menuOpen===false || (Object.hasOwn(next,'homeOwnerId') && next.homeOwnerId!==pmLive.owner)){ $('menuSearch').value='';dismissMenuResults(); }
    for (const key of ['appUpdate', 'windowId', 'activeId', 'menuOpen', 'toolsOpen', 'online', 'message', 'notice', 'version', 'syncStatus', 'webVersion', 'menuVersion']) if (Object.prototype.hasOwnProperty.call(next, key)) state[key] = next[key];
    for (const key of ['windows', 'tabs', 'favorites', 'menus']) if (Array.isArray(next[key])) state[key] = next[key];
    render();
    window.homeWorkspace?.applyState(next);
    window.homeDashboard?.applyState(next);
    if (Object.prototype.hasOwnProperty.call(next, 'homeOwnerId') && next.homeOwnerId !== pmLive.owner) {
      pmLive.owner = next.homeOwnerId || ''; pmLive.generation++; pmLive.busy = false;
      clearTimeout(pmLive.timer); pmLive.timer = null;
      renderPmLive({ state: pmLive.owner ? 'checking' : 'offline', reason: pmLive.owner ? 'PM 상태를 확인하고 있습니다.' : '로그인 후 확인할 수 있습니다.' });
      if (pmLive.owner) void checkPmLive();
    }
    // Commit explicit menu-opening focus with the same render. A queued frame
    // can run after another native focus/state transition and restore a tab.
    // Ordinary polling never enters this branch or takes focus from the user.
    if (!wasMenuOpen && state.menuOpen) $('menuSearch').focus({ preventScroll: true });
  }

  function renderPmLive(result) {
    const panel = $('pmLivePanel'), badge = $('pmLiveBadge'), activity = $('pmLiveActivity'), evidence = $('pmLiveEvidence');
    if (!panel || !badge || !activity || !evidence) return;
    const stateName = result?.state || 'offline';
    panel.dataset.state = stateName;
    panel.classList.remove('is-live', 'is-stale', 'is-offline', 'is-checking');
    panel.classList.add(stateName === 'live' || stateName === 'active' ? 'is-live' : stateName === 'stale' ? 'is-stale' : stateName === 'checking' ? 'is-checking' : 'is-offline');
    // 이 창에는 오류 난 건의 제목만 보인다(사장님 지시 2026-11-13). 내부 이름·수신 시각 같은 상세는 PM 관제 화면에서 본다.
    const connected = stateName === 'live' || stateName === 'active';
    const issues = connected && Array.isArray(result?.issues) ? result.issues : null;
    panel.dataset.issues = issues ? String(issues.length) : '';
    badge.textContent = connected
      ? (issues ? (issues.length ? `오류 ${issues.length}건` : '정상') : '확인 불가')
      : ({ stale: '갱신 지연', checking: '확인 중' })[stateName] || '확인 불가';
    badge.setAttribute('aria-busy', String(stateName === 'checking' || pmLive.busy));
    activity.textContent = connected
      ? (issues ? (issues.length ? [...issues.slice(0, 5), ...(issues.length > 5 ? [`외 ${issues.length - 5}건`] : [])].join('\n') : '오류 없음') : '오류 목록을 확인할 수 없습니다.')
      : stateName === 'stale' ? 'PM 갱신이 늦어지고 있습니다.' : (result?.reason || 'PM 상태를 확인할 수 없습니다.');
    // 모양은 여기서 준다: shell.css·index.html 은 가이드 영상 원본 해시에 묶여 있어 건드리지 않는다.
    activity.style.whiteSpace = 'pre-line';
    const alert = Boolean(issues && issues.length);
    badge.style.background = alert ? '#fde8e8' : ''; badge.style.color = alert ? '#a32228' : '';
    evidence.textContent = ''; evidence.hidden = true; evidence.style.display = 'none';
  }
  async function checkPmLive() {
    clearTimeout(pmLive.timer);
    if (!pmLive.owner || document.hidden) return;
    const generation = pmLive.generation;
    if (!pmLive.busy) {
      pmLive.busy = true; renderPmLive({ state: $('pmLivePanel').dataset.state === 'live' ? 'live' : 'checking', reason: 'PM 상태를 확인하고 있습니다.' });
      try {
        const result = await desktop.invoke('pmLiveStatus');
        if (generation === pmLive.generation && pmLive.owner) renderPmLive(result);
      } catch {
        if (generation === pmLive.generation && pmLive.owner) renderPmLive({ state: 'offline', reason: 'PM 상태 서버에 연결할 수 없습니다.' });
      } finally { if (generation === pmLive.generation) pmLive.busy = false; }
    }
    if (pmLive.owner) pmLive.timer = setTimeout(() => void checkPmLive(), 60000);
  }

  function wire() {
    const updateNotice = document.createElement('button');
    updateNotice.id = 'appUpdateNotice'; updateNotice.type = 'button'; updateNotice.className = 'top-action app-update-notice'; updateNotice.hidden = true;
    $('tabs').before(updateNotice);
    updateNotice.addEventListener('click', () => {
      lastMenuTrigger = updateNotice;
      void call('menu', { open: true }).then(() => $('appUpdateButton').focus({ preventScroll: true })).catch(() => {});
    });
    window.addEventListener('online', () => run('appUpdate', { automatic: true }));
    document.addEventListener('visibilitychange', () => { if (document.hidden) { clearTimeout(pmLive.timer); pmLive.timer = null; } else if (pmLive.owner) void checkPmLive(); });
    $('appUpdateButton').addEventListener('click', () => run('appUpdate'));
    $('logoutButton').addEventListener('click', () => run('logout'));
    $('cancelUpdateButton').addEventListener('click', () => run('cancelUpdate'));
    $('syncButton').addEventListener('click', () => run('sync'));
    $('homeButton').addEventListener('click', () => setMenu(true, true));
    const pmOpenButton = $('pmOpenButton');
    pmOpenButton.textContent = '오류관제 열기';
    pmOpenButton.addEventListener('click', () => {
      run('open', { url: '/pm', title: 'PM 진행·오류 관제' });
    });
    const pmActions = document.createElement('div');
    pmActions.className = 'pm-live-actions';
    pmActions.style.display = 'flex';
    pmActions.style.flexWrap = 'wrap';
    pmActions.style.gap = '6px';
    pmActions.style.alignItems = 'center';
    const pmHubButton = document.createElement('button');
    pmHubButton.id = 'pmHubButton';
    pmHubButton.type = 'button';
    pmHubButton.className = 'pm-open-button';
    pmHubButton.textContent = '통합지휘실';
    pmHubButton.title = '사장님 통합 지휘실(PM·에이전트·디벨롭) 열기';
    pmHubButton.style.background = '#0f172a';
    pmHubButton.style.borderColor = '#0f172a';
    pmHubButton.style.color = '#ffffff';
    pmHubButton.addEventListener('click', () => {
      run('open', { url: '/work/command-hub', title: '사장님 통합 지휘실' });
    });
    const pmArchButton = document.createElement('button');
    pmArchButton.id = 'pmArchButton';
    pmArchButton.type = 'button';
    pmArchButton.className = 'pm-open-button';
    pmArchButton.textContent = '흐름도';
    pmArchButton.title = '아키텍처 흐름도 열기';
    pmArchButton.addEventListener('click', () => {
      run('open', { url: '/my-work?tab=arch', title: '아키텍처 흐름도' });
    });
    const pmSimButton = document.createElement('button');
    pmSimButton.id = 'pmSimButton';
    pmSimButton.type = 'button';
    pmSimButton.className = 'pm-open-button';
    pmSimButton.textContent = '시뮬레이션';
    pmSimButton.title = '통합 솔루션 모션·실캡처 시뮬레이션 열기';
    pmSimButton.addEventListener('click', () => {
      run('open', { url: '/my-work?tab=suite-sim', title: '통합 솔루션 시뮬레이션' });
    });
    const pmRadarButton = document.createElement('button');
    pmRadarButton.id = 'pmRadarButton';
    pmRadarButton.type = 'button';
    pmRadarButton.className = 'pm-open-button';
    pmRadarButton.textContent = '도입레이더';
    pmRadarButton.title = '도입·기술 레이더 열기';
    pmRadarButton.addEventListener('click', () => {
      run('open', { url: '/my-work?tab=radar', title: '도입·기술 레이더' });
    });
    pmOpenButton.replaceWith(pmActions);
    pmActions.append(pmHubButton, pmOpenButton, pmArchButton, pmSimButton, pmRadarButton);
    $('menuButton').addEventListener('click', () => setMenu(!state.menuOpen, !state.menuOpen));
    $('toolsButton').addEventListener('click', () => run('tools'));
    $('compactFavoriteButton').addEventListener('click', () => { if (state.activeId) run('favorite', { id: state.activeId }); });
    $('addTabButton').addEventListener('click', () => setMenu(true, true));
    $('quickNewWindowButton')?.addEventListener('click', () => run('newWindow'));
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
    $('menuSearch').addEventListener('input', showMenuResults);
    $('menuSearch').addEventListener('focus', showMenuResults);
    $('menuSearch').addEventListener('blur', dismissMenuResults);
    $('menuSearchPopup').addEventListener('mousedown',event=>{if(event.target.closest('[role=option]'))event.preventDefault();});
    $('menuSearch').addEventListener('keydown', (event) => {
      if(event.isComposing || event.keyCode===229)return;
      const visible=!$('menuSearchPopup').hidden;
      if(visible && event.key==='Escape'){event.preventDefault();event.stopPropagation();$('menuSearch').value='';dismissMenuResults();return;}
      if(visible && event.key==='Enter'){event.preventDefault();if(searchMatches.length)chooseMenuResult(Math.max(0,activeResult));return;}
      if(visible && ['ArrowDown','ArrowUp'].includes(event.key)){
        event.preventDefault();const n=searchMatches.length;if(n)highlightMenuResult(activeResult<0?(event.key==='ArrowDown'?0:n-1):(activeResult+(event.key==='ArrowDown'?1:-1)+n)%n);return;
      }
      if(!visible && event.key==='ArrowDown')moveMenuFocus(event);
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
      if(document.querySelector('dialog[open]')||event.isComposing||event.keyCode===229)return;
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'b') { event.preventDefault(); run('tools'); return; }
      if (event.key === 'Escape' && state.menuOpen && !event.defaultPrevented) { event.preventDefault(); setMenu(false); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setMenu(true, true); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 't') { event.preventDefault(); setMenu(true, true); return; }
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'n') { event.preventDefault(); run('newWindow'); return; }
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
