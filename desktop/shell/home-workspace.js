/* Personal home data crosses the authenticated, allowlisted main-process IPC.
   No browser network, credential storage or shared ERP mutation occurs here. */
(() => {
  'use strict';
  const root = document.getElementById('homeWorkspace');
  if (!root) return;
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
  const node = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const button = (text, fn, cls = '') => { const b = node('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b; };
  const invoke = (payload) => window.desktop.invoke('homeWorkspace', payload);
  let owner = '', visible = false, online = false, epoch = 0, snapshot = null, querying = false, busy = false;
  let timer, failures = 0, expanded = false, editing = null, editDraft = null, pending = null, confirmation = null;
  let selectedDate = today(), followsToday = true, detail = null, detailTrigger = null;
  let lastDirty = false;
  let readGeneration = 0;
  function draftSignal() { const dirty = !!(input.value.trim() || editing || pending); if (dirty !== lastDirty) { lastDirty = dirty; void window.desktop.invoke('homeDraft', { dirty }).catch(() => {}); } }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const lanes = ['guidance', 'feedback'].map(key => ({ key, at: 0, paused: reduced.matches, hover: false, focus: false, list: false }));

  const feeds = node('div', 'hw-feeds');
  const feedDetail = node('div', 'hw-detail'); feedDetail.hidden = true;
  const panel = node('section', 'hw-panel');
  const heading = node('div', 'hw-heading');
  const title = node('h2', '', '오늘의 내 업무');
  const date = node('input'); date.type = 'date'; date.value = selectedDate; date.setAttribute('aria-label', '업무 날짜 · 지난 기록');
  const weekday = node('span', 'hw-muted');
  const count = node('span', 'hw-count'); count.setAttribute('aria-live', 'polite');
  const refresh = button('다시 조회', () => { failures = 0; void load(); });
  const current = button('오늘', () => changeDate(today(), true));
  const filter = node('select'); filter.setAttribute('aria-label', '업무 보기');
  for (const [value, label] of [['active', '전체 업무'], ['pending', '미완료'], ['done', '완료'], ['repeat', '반복 업무'], ['archived', '보관함']]) filter.add(new Option(label, value));
  heading.append(title, date, weekday, current, filter, count, refresh);
  const status = node('p', 'hw-status'); status.setAttribute('role', 'status');
  const error = node('div', 'hw-error'); error.setAttribute('role', 'alert'); error.hidden = true;
  const errorText = node('span'); const retry = button('다시 시도', () => pending ? void sendPending() : void load()); error.append(errorText, retry);
  const form = node('form', 'hw-add');
  const input = node('input'); input.placeholder = '해야 할 일을 입력하세요'; input.maxLength = 300; input.required = true; input.setAttribute('aria-label', '추가할 업무');
  const repeat = makeRepeat([]); const add = node('button', 'hw-primary', '＋ 추가'); add.type = 'submit';
  form.append(input, repeat.root, add);
  const rows = node('div', 'hw-rows');
  const more = button('전체 보기', () => { if (!expanded) { expanded = true; renderTasks(); } else if (snapshot?.nextOffset != null) void loadMore(); else { expanded = false; renderTasks(); } }); more.hidden = true;
  panel.append(heading, status, error, form, rows, more); root.append(feeds, feedDetail, panel);

  function makeRepeat(values) {
    const wrap = node('div', 'hw-repeat'); const select = node('select'); select.setAttribute('aria-label', '반복 요일');
    for (const [v, t] of [['none', '반복 없음'], ['daily', '매일'], ['weekdays', '평일'], ['custom', '요일 선택']]) select.add(new Option(t, v));
    const choices = node('div', 'hw-days'); choices.setAttribute('role', 'group'); choices.setAttribute('aria-label', '반복할 요일');
    const checks = dayNames.map((name, index) => { const label = node('label'); const check = node('input'); check.type = 'checkbox'; check.checked = values.includes(index); label.append(check, document.createTextNode(name)); choices.append(label); return check; });
    select.value = !values.length ? 'none' : values.length === 7 ? 'daily' : 'custom';
    const paint = () => { choices.hidden = select.value !== 'custom'; };
    select.addEventListener('change', () => { select.setCustomValidity(''); paint(); }); checks.forEach(c => c.addEventListener('change', () => select.setCustomValidity(''))); paint(); wrap.append(select, choices);
    return { root: wrap, valid: () => { const ok = select.value !== 'custom' || checks.some(c => c.checked); select.setCustomValidity(ok ? '' : '반복할 요일을 하나 이상 선택해 주세요.'); if (!ok) select.reportValidity(); return ok; }, get: () => select.value === 'none' ? [] : select.value === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : select.value === 'weekdays' ? [1, 2, 3, 4, 5] : checks.flatMap((c, i) => c.checked ? [i] : []), reset: () => { select.value = 'none'; checks.forEach(c => c.checked = false); select.setCustomValidity(''); paint(); } };
  }
  function setError(text) { errorText.textContent = text; error.hidden = !text; }
  function lock() { form.querySelectorAll('input,select,button').forEach(e => e.disabled = !owner || busy || !snapshot); date.disabled = busy || !owner; filter.disabled = busy || !owner; retry.disabled = busy; }
  function stamp(value) { if (!value) return ''; const d = new Date(value); return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(d); }
  function changeDate(value, auto = false) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || busy) return;
    if (editing || pending || input.value.trim()) { date.value = selectedDate; setError('작성 중인 업무를 저장하거나 수정 취소 후 날짜를 변경해 주세요. 추가 입력은 직접 지울 수 있습니다.'); return; }
    selectedDate = value; followsToday = auto; date.value = value; expanded = false; confirmation = null;
    snapshot = null; renderTasks(); void load();
  }
  date.addEventListener('change', () => changeDate(date.value)); filter.addEventListener('change', () => { expanded = false; renderTasks(); });
  input.addEventListener('input', draftSignal);
  form.addEventListener('submit', event => { event.preventDefault(); const title = input.value.trim(); if (!title || !snapshot || busy) return;
    if (!repeat.valid()) return; const entered = input.value;
    mutate('create', { title, startDate: selectedDate, weekdays: repeat.get(), date: selectedDate }, () => { if (input.value === entered) { input.value = ''; repeat.reset(); } input.focus(); });
  });
  function schedule() { clearTimeout(timer); if (owner && visible && online && !document.hidden) timer = setTimeout(() => void load(), Math.min(300000, 30000 * 2 ** failures)); }
  async function load() {
    clearTimeout(timer); if (!owner || !visible || !online || document.hidden || querying || busy) { schedule(); return; }
    if (followsToday && selectedDate !== today() && !editing && !pending && !input.value.trim()) { selectedDate = today(); date.value = selectedDate; snapshot = null; }
    const ticket = epoch, requestedDate = selectedDate, generation = ++readGeneration; querying = true;
    if (!snapshot) status.textContent = '개인 업무와 소식을 불러오는 중…';
    try { const data = await invoke({ method: 'GET', date: requestedDate, offset: 0, limit: 200 });
      if (ticket !== epoch || generation !== readGeneration || requestedDate !== selectedDate) return;
      if (!data?.success || data.ownerId !== owner) throw new Error(data?.error || '개인 업무를 확인하지 못했습니다.');
      for (const lane of lanes) if (data.feedErrors?.[lane.key] && !data[lane.key]?.length && snapshot?.[lane.key]?.length) data[lane.key] = snapshot[lane.key];
      snapshot = data; failures = 0; if (!pending) setError(''); renderData();
    } catch (e) { if (ticket !== epoch || generation !== readGeneration) return; failures++; status.textContent = snapshot ? '갱신 지연 · 마지막 갱신 ' + stamp(snapshot.syncedAt) : '조회 실패 · 다시 시도해 주세요.'; setError(e.message || '조회에 실패했습니다.'); }
    finally { if (ticket === epoch && generation === readGeneration) { querying = false; lock(); if (requestedDate !== selectedDate) void load(); else schedule(); } }
  }
  async function loadMore() {
    if (querying || busy || snapshot?.nextOffset == null) return;
    const ticket = epoch, requestedDate = selectedDate; querying = true; more.disabled = true;
    try { const data = await invoke({ method: 'GET', date: requestedDate, offset: snapshot.nextOffset, limit: 200 });
      if (ticket !== epoch || requestedDate !== selectedDate) return;
      if (!data?.success || data.ownerId !== owner) throw new Error(data?.error || '추가 업무를 읽지 못했습니다.');
      if (data.revision !== snapshot.revision) { querying = false; await load(); setError('목록이 변경되어 처음부터 다시 읽었습니다. 전체 보기를 다시 눌러주세요.'); return; }
      const unique = new Map(snapshot.tasks.map(t => [rowKey(t), t])); data.tasks.forEach(t => unique.set(rowKey(t), t)); snapshot = { ...data, tasks: [...unique.values()] }; renderTasks();
    } catch (e) { if (ticket === epoch) setError(e.message); } finally { if (ticket === epoch) { querying = false; more.disabled = false; schedule(); } }
  }
  function mutate(action, fields, done) {
    if (busy || !owner || !snapshot) return;
    if (pending) { setError('이전 저장 결과를 먼저 다시 시도해 확인해 주세요. 입력은 유지됩니다.'); return; }
    pending = { command: { action, expectedRevision: snapshot.revision, requestId: crypto.randomUUID(), date: selectedDate, ...fields }, done };
    draftSignal();
    void sendPending();
  }
  async function sendPending() {
    if (!pending || busy || !owner) return;
    const request = pending, ticket = epoch; readGeneration++; querying = false; busy = true; lock(); renderTasks(); setError('');
    try { const data = await invoke({ method: 'POST', command: request.command });
      if (ticket !== epoch) return;
      if (!data?.success) { const e = new Error(data?.error || '저장하지 못했습니다. 입력은 유지됩니다.'); e.conflict = data?.status === 409 || /CONFLICT|REVISION/i.test(data?.code || ''); throw e; }
      if (data.ownerId && data.ownerId !== owner) throw new Error('계정이 변경되어 결과를 표시하지 않습니다.');
      pending = null; confirmation = null; request.done?.(); status.textContent = '저장했습니다.';
      // Mutations of carried occurrences may return that original date: reload the selected view.
      busy = false; querying = false; await load();
    } catch (e) { if (ticket !== epoch) return; setError((e.conflict ? '다른 창에서 변경했습니다. 최신 자료를 읽고 입력은 유지합니다. ' : '') + (e.message || '저장 실패') + ' 다시 시도해 주세요.');
      if (e.conflict) { busy = false; await load(); if (pending === request && snapshot) request.command = { ...request.command, expectedRevision: snapshot.revision, requestId: crypto.randomUUID() }; }
    } finally { if (ticket === epoch) { busy = false; lock(); renderTasks(); if (!pending && request.command.taskId && !editing) focusTask(request.command.taskId); draftSignal(); schedule(); } }
  }
  function renderData() { status.textContent = '마지막 갱신 ' + stamp(snapshot.syncedAt) + ' · 홈 표시 중 30초마다 확인'; renderTasks(); renderFeeds(); lock(); }
  function rowKey(task) { return String(task.id) + '|' + (task.occurrenceDate || selectedDate); }
  function focusTask(id) { [...rows.querySelectorAll('.hw-task')].find(r => r.dataset.task.startsWith(String(id) + '|'))?.querySelector('button:not(:disabled),input:not(:disabled)')?.focus(); }
  function taskFields(task) { return { taskId: task.id, date: task.occurrenceDate || selectedDate }; }
  function renderTasks() {
    if (editing && rows.querySelector('.hw-edit')) captureEdit();
    const focusedEdit = rows.querySelector('.hw-edit')?.contains(document.activeElement) ? { name: document.activeElement.name, start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd } : null;
    rows.replaceChildren(); weekday.textContent = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', weekday: 'long' }).format(new Date(selectedDate + 'T12:00:00+09:00'));
    const all = snapshot?.tasks || []; const active = all.filter(t => !t.archived);
    count.textContent = snapshot ? (snapshot.nextOffset != null ? '불러온 업무 ' : '') + active.filter(t => t.done).length + ' / ' + active.length + ' 완료' + (snapshot.nextOffset != null ? ' · 전체 ' + snapshot.totalTasks + '건' : '') : '';
    const items = all.filter(t => filter.value === 'archived' ? t.archived : !t.archived && (filter.value === 'pending' ? !t.done : filter.value === 'done' ? t.done : filter.value === 'repeat' ? t.weekdays?.length : true));
    if (!owner) { rows.append(node('p', 'hw-empty', '로그인하면 개인 업무와 소식을 확인할 수 있습니다.')); }
    else if (snapshot && !items.length) rows.append(node('p', 'hw-empty', '선택한 날짜와 보기에 해당하는 업무가 없습니다.'));
    for (const task of (expanded ? items : items.slice(0, 6))) {
      const row = node('div', 'hw-task' + (task.done ? ' is-done' : '')); row.dataset.task = rowKey(task);
      if (editing === rowKey(task)) { renderEdit(row, task); rows.append(row); continue; }
      const label = node('label', 'hw-task-label'), check = node('input'); check.type = 'checkbox'; check.checked = !!task.done; check.disabled = busy || task.archived; check.setAttribute('aria-label', task.title + ' 완료');
      check.addEventListener('change', () => { const done = check.checked; check.checked = !!task.done; mutate('complete', { ...taskFields(task), done }); });
      label.append(check, node('span', '', task.title));
      const meta = node('span', 'hw-task-meta', (task.carried ? '이월 ' + task.occurrenceDate + ' · ' : '') + (task.stopped ? '반복 종료' : task.weekdays?.length ? task.weekdays.map(d => dayNames[d]).join('·') + ' 반복' : '일회'));
      row.append(label, meta);
      const action = (text, fn) => { const b = button(text, fn); b.disabled = busy; row.append(b); return b; };
      if (task.archived) action('복구', () => mutate('restore', taskFields(task)));
      else { action('수정', () => { editing = rowKey(task); editDraft = { title: task.title, startDate: task.startDate || selectedDate, weekdays: task.weekdays || [] }; renderTasks(); rows.querySelector('.hw-edit input')?.focus(); });
        action('보관', () => { confirmation = { key: rowKey(task), action: 'archive' }; renderTasks(); rows.querySelector('.hw-confirm button')?.focus(); });
        if (task.weekdays?.length && !task.stopped) action('반복 종료', () => { confirmation = { key: rowKey(task), action: 'stop' }; renderTasks(); rows.querySelector('.hw-confirm button')?.focus(); }); }
      if (confirmation?.key === rowKey(task)) { const confirm = node('div', 'hw-confirm'); confirm.append(node('span', '', confirmation.action === 'stop' ? '오늘(또는 선택한 미래 날짜) 이후 반복을 종료합니다. 과거·미완료 기록은 유지됩니다.' : '이 날짜의 실행 건만 보관합니다. 보관함에서 복구할 수 있습니다.'));
        const cancel = () => { confirmation = null; renderTasks(); focusTask(task.id); };
        const yes = button('확인', () => mutate(confirmation.action, taskFields(task))); yes.disabled = busy; confirm.append(yes, button('취소', cancel)); confirm.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!busy) cancel(); } }); row.append(confirm); }
      rows.append(row);
    }
    more.hidden = items.length <= 6 && snapshot?.nextOffset == null; more.textContent = expanded ? snapshot?.nextOffset != null ? '업무 더 불러오기' : '6건만 보기' : '전체 보기' + (snapshot?.totalTasks ? ' (' + snapshot.totalTasks + '건)' : '');
    if (focusedEdit?.name) { const field = rows.querySelector('.hw-edit')?.elements[focusedEdit.name]; field?.focus({ preventScroll: true }); if (field?.type === 'text') field.setSelectionRange(focusedEdit.start, focusedEdit.end); }
    draftSignal();
  }
  let editRepeat;
  function captureEdit() { const f = rows.querySelector('.hw-edit'); if (f) editDraft = { title: f.elements.title.value, startDate: f.elements.startDate.value, weekdays: editRepeat.get() }; }
  function renderEdit(row, task) {
    const f = node('form', 'hw-edit'), text = node('input'), start = node('input'); text.name = 'title'; text.value = editDraft.title; text.required = true; text.maxLength = 300; text.setAttribute('aria-label', '업무 제목 수정'); start.type = 'date'; start.name = 'startDate'; start.value = editDraft.startDate; start.required = true; start.setAttribute('aria-label', '반복 시작일'); editRepeat = makeRepeat(editDraft.weekdays);
    const cancelEdit = () => { editing = null; editDraft = null; renderTasks(); rows.querySelector('[data-task="' + CSS.escape(rowKey(task)) + '"]>button')?.focus(); };
    const save = node('button', 'hw-primary', '저장'); save.type = 'submit'; const cancel = button('취소', cancelEdit); f.append(text, start, editRepeat.root, save, cancel);
    f.querySelectorAll('input,select,button').forEach(e => e.disabled = busy);
    f.addEventListener('submit', e => { e.preventDefault(); captureEdit(); if (!editDraft.title.trim() || !editRepeat.valid()) return; mutate('update', { ...taskFields(task), ...editDraft, title: editDraft.title.trim() }, () => { editing = null; editDraft = null; }); });
    f.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!busy) cancelEdit(); } }); row.append(f);
  }
  function renderFeeds() {
    const focused = document.activeElement?.dataset.feedControl; feeds.replaceChildren();
    for (const lane of lanes) {
      const items = snapshot?.[lane.key] || []; lane.at %= Math.max(1, items.length); const item = items[lane.at];
      const row = node('section', 'hw-feed'); row.setAttribute('aria-label', lane.key === 'guidance' ? '주의·업무 지침' : '수입부 피드백');
      row.append(node('strong', '', lane.key === 'guidance' ? '주의·업무 지침' : '수입부 피드백'));
      const copy = node('div', 'hw-feed-copy');
      if (snapshot?.feedErrors?.[lane.key]) copy.append(node('span', 'hw-error-copy', '조회 실패 · ' + snapshot.feedErrors[lane.key]));
      if (item) { copy.append(node('span', '', (item.isNew ? '새 소식 · ' : item.unread ? '미확인 · ' : '') + item.title), node('small', '', (item.orderYear ? item.orderYear + '년 ' + (item.orderWeek ? item.orderWeek + '차' : '차수 미확인') + ' · ' : '') + stamp(item.updatedAt))); }
      else if (!snapshot?.feedErrors?.[lane.key]) copy.append(node('span', '', !owner ? '로그인 후 확인' : !snapshot ? '소식 확인 중…' : '표시할 내용이 없습니다.'));
      row.append(copy); const controls = node('div', 'hw-feed-controls');
      const ctrl = (name, text, fn, disabled = false) => { const b = button(text, fn); b.dataset.feedControl = lane.key + ':' + name; b.setAttribute('aria-label', row.getAttribute('aria-label') + ' ' + text); b.disabled = disabled; controls.append(b); return b; };
      const move = d => { lane.at = (lane.at + d + items.length) % items.length; renderFeeds(); };
      controls.append(node('small', '', items.length ? (lane.at + 1) + '/' + items.length : ''));
      ctrl('prev', '이전', () => move(-1), items.length < 2); ctrl('next', '다음', () => move(1), items.length < 2);
      const pause = ctrl('pause', lane.paused ? '재생' : '일시정지', () => { lane.paused = !lane.paused; renderFeeds(); }, !items.length); pause.setAttribute('aria-pressed', String(lane.paused));
      ctrl('detail', '더보기', e => showDetail(lane, false, e), !item); ctrl('all', '전체', () => showDetail(lane, true), !items.length);
      row.append(controls); row.addEventListener('mouseenter', () => lane.hover = true); row.addEventListener('mouseleave', () => lane.hover = false); row.addEventListener('focusin', () => lane.focus = true); row.addEventListener('focusout', e => lane.focus = row.contains(e.relatedTarget));
      row.addEventListener('keydown', e => { if (items.length > 1 && ['ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); move(e.key === 'ArrowLeft' ? -1 : 1); } }); feeds.append(row);
    }
    if (focused) [...feeds.querySelectorAll('button')].find(b => b.dataset.feedControl === focused)?.focus({ preventScroll: true });
  }
  function showDetail(lane, all) {
    detail = lane.key; detailTrigger = document.activeElement?.dataset.feedControl; feedDetail.replaceChildren(); feedDetail.hidden = false;
    const close = button('닫기', closeDetail); feedDetail.append(close);
    for (const item of (all ? snapshot[lane.key] : [snapshot[lane.key][lane.at]])) { const article = node('article'); article.append(node('strong', '', item.title), node('p', '', item.summary || ''), node('small', '', (item.orderYear ? item.orderYear + '년 ' + (item.orderWeek ? item.orderWeek + '차' : '차수 미확인') + ' · ' : '') + stamp(item.updatedAt)));
      const open = button('원문 보기', async () => { const ticket = epoch; open.disabled = true; try { await window.desktop.invoke('open', { url: item.href, title: item.title }); if (ticket === epoch) mutate('read', { sourceKey: item.sourceKey }); } catch (e) { if (ticket === epoch) setError(e.message || '원문을 열지 못했습니다.'); } finally { if (ticket === epoch) open.disabled = false; } }); article.append(open); feedDetail.append(article); }
    close.focus();
  }
  function closeDetail() { detail = null; feedDetail.hidden = true; feedDetail.replaceChildren(); [...feeds.querySelectorAll('button')].find(b => b.dataset.feedControl === detailTrigger)?.focus(); }
  root.addEventListener('keydown', e => { if (e.key === 'Escape' && detail) { e.preventDefault(); e.stopPropagation(); closeDetail(); } });
  rows.addEventListener('keydown', e => {
    if (!['ArrowUp', 'ArrowDown'].includes(e.key) || e.target.closest('.hw-edit,.hw-confirm') || e.target.matches('select,textarea,input:not([type=checkbox])')) return;
    const list = [...rows.querySelectorAll('.hw-task')], currentRow = e.target.closest('.hw-task'), index = list.indexOf(currentRow);
    if (index < 0) return; const target = list[Math.max(0, Math.min(list.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)))];
    e.preventDefault(); e.stopPropagation(); target?.querySelector('input:not(:disabled),button:not(:disabled)')?.focus();
  });
  setInterval(() => { if (!visible || document.hidden || detail) return; for (const lane of lanes) if (!lane.paused && !lane.hover && !lane.focus && (snapshot?.[lane.key]?.length || 0) > 1) lane.at = (lane.at + 1) % snapshot[lane.key].length; renderFeeds(); }, 8000);
  reduced.addEventListener('change', e => { if (e.matches) { lanes.forEach(l => l.paused = true); renderFeeds(); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void load(); else clearTimeout(timer); });
  window.homeWorkspace = { applyState(next) {
    const nextOwner = Object.prototype.hasOwnProperty.call(next, 'homeOwnerId') ? String(next.homeOwnerId || '') : owner;
    const changed = nextOwner !== owner, wasVisible = visible, wasOnline = online;
    if (changed) { epoch++; owner = nextOwner; snapshot = null; pending = null; editing = null; editDraft = null; confirmation = null; busy = false; querying = false; failures = 0; input.value = ''; repeat.reset(); filter.value = 'active'; expanded = false; selectedDate = today(); date.value = selectedDate; followsToday = true; detail = null; feedDetail.hidden = true; feedDetail.replaceChildren(); setError(''); lanes.forEach(l => { l.at = 0; l.hover = false; l.focus = false; }); }
    if ('menuOpen' in next) visible = !!next.menuOpen; if ('online' in next) online = !!next.online;
    if (changed) { status.textContent = owner ? '개인 업무를 확인합니다.' : '로그인이 필요합니다.'; renderTasks(); renderFeeds(); lock(); }
    if (!visible || !online || !owner) clearTimeout(timer);
    if (owner && !online) status.textContent = '연결 대기 · ' + (snapshot ? '마지막 갱신 ' + stamp(snapshot.syncedAt) : '온라인 연결 후 다시 확인합니다.');
    if (owner && visible && online && (changed || !wasVisible || !wasOnline)) void load();
  } };
  renderTasks(); renderFeeds(); lock(); status.textContent = '로그인하면 개인 업무를 사용할 수 있습니다.';
})();
