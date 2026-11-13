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
  let readGeneration = 0, menuGroups = [], timeline = false;
  function draftSignal() { const dirty = !!(input.value.trim() || addSettings.dirty() || editing || pending); if (dirty !== lastDirty) { lastDirty = dirty; void window.desktop.invoke('homeDraft', { dirty }).catch(() => {}); } }
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
  const openNotes = button('업무 메모장 열기', () => window.desktop.invoke('notesOpen').catch(e => setError(e.message)));
  const downloadNotes = button('업무 메모장 바로가기 다운로드', () => window.desktop.invoke('notesShortcut').then(result => { if (result?.saved) status.textContent = '업무 메모장 바로가기를 저장했습니다.'; }).catch(e => setError(e.message)));
  const current = button('오늘', () => changeDate(today(), true));
  const filter = node('select'); filter.setAttribute('aria-label', '업무 보기');
  for (const [value, label] of [['active', '전체 업무'], ['pending', '미완료'], ['done', '완료'], ['repeat', '반복 업무'], ['archived', '삭제한 업무']]) filter.add(new Option(label, value));
  const guide=button('사용 가이드 영상',()=>window.desktop.invoke('open',{url:'/desktop-guide',title:'오늘의 내 업무 사용 가이드'}).catch(e=>setError(e.message)));
  heading.append(title,openNotes);
  const tools=node('details','hw-tools');tools.append(node('summary','','날짜 · 보기 · 도구'));const toolBody=node('div','hw-tool-body');toolBody.append(date,weekday,current,filter,refresh,downloadNotes,guide);tools.append(toolBody);
  const status = node('p', 'hw-status'); status.setAttribute('role', 'status');
  const error = node('div', 'hw-error'); error.setAttribute('role', 'alert'); error.hidden = true;
  const errorText = node('span'); const retry = button('다시 시도', () => pending ? void sendPending() : void load()); error.append(errorText, retry);
  const form = node('form', 'hw-add');
  const input = node('input'); input.placeholder = '해야 할 일을 입력하세요'; input.maxLength = 300; input.required = true; input.setAttribute('aria-label', '추가할 업무');
  const repeat = makeRepeat([]); const add = node('button', 'hw-primary', '＋ 추가'); add.type = 'submit';
  const addSettings=window.NenovaTaskControls.create();const settingsToggle=node('details','hw-settings');settingsToggle.append(node('summary','','시간 · 바로가기 설정'),addSettings.root);
  form.append(input, repeat.root, add,settingsToggle);
  const viewBar=node('div','hw-viewbar'),listView=button('목록',()=>{timeline=false;renderTasks();}),timeView=button('시간표',()=>{timeline=true;expanded=true;renderTasks();});viewBar.append(listView,timeView);
  const rows = node('div', 'hw-rows');
  const more = button('전체 보기', () => { if (!expanded) { expanded = true; renderTasks(); } else if (snapshot?.nextOffset != null) void loadMore(); else { expanded = false; renderTasks(); } }); more.hidden = true;
  const progress=node('progress','hw-progress');progress.max=1;progress.value=0;progress.setAttribute('aria-label','업무 완료율');
  panel.append(heading,count,progress,tools,status,error,form,viewBar,rows,more); root.append(panel, feeds, feedDetail);

  function makeRepeat(values, frequency) {
    const wrap = node('div', 'hw-repeat'); const select = node('select'); select.setAttribute('aria-label', '반복 기준');
    for (const [v, t] of [['once', '반복 없음'], ['daily', '매일'], ['weekly', '매주 · 요일 선택'], ['monthly', '매월 · 같은 날짜']]) select.add(new Option(t, v));
    const choices = node('div', 'hw-days'); choices.setAttribute('role', 'group'); choices.setAttribute('aria-label', '반복할 요일');
    const checks = dayNames.map((name, index) => { const label = node('label'); const check = node('input'); check.type = 'checkbox'; check.checked = values.includes(index); label.append(check, document.createTextNode(name)); choices.append(label); return check; });
    select.value = frequency || (!values.length ? 'once' : values.length === 7 ? 'daily' : 'weekly');
    const monthlyHint = node('small', 'hw-muted', '29~31일에 시작하면 날짜가 없는 달에는 그달 말일에 표시됩니다.');
    const paint = () => { choices.hidden = select.value !== 'weekly'; monthlyHint.hidden = select.value !== 'monthly'; };
    select.addEventListener('change', () => { select.setCustomValidity(''); paint(); }); checks.forEach(c => c.addEventListener('change', () => select.setCustomValidity(''))); paint(); wrap.append(select, choices, monthlyHint);
    return { root: wrap, valid: () => { const ok = select.value !== 'weekly' || checks.some(c => c.checked); select.setCustomValidity(ok ? '' : '반복할 요일을 하나 이상 선택해 주세요.'); if (!ok) select.reportValidity(); return ok; }, get: () => select.value === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : select.value === 'weekly' ? checks.flatMap((c, i) => c.checked ? [i] : []) : [], frequency: () => select.value, reset: () => { select.value = 'once'; checks.forEach(c => c.checked = false); select.setCustomValidity(''); paint(); } };
  }
  function setError(text) { errorText.textContent = text; error.hidden = !text; }
  function lock() { form.querySelectorAll('input,select,button').forEach(e => e.disabled = !owner || busy || !snapshot); date.disabled = busy || !owner; filter.disabled = busy || !owner; openNotes.disabled = !owner; downloadNotes.disabled = !owner; retry.disabled = busy; }
  function stamp(value) { if (!value) return ''; const d = new Date(value); return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(d); }
  function changeDate(value, auto = false) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || busy) return false;
    if (editing || pending || input.value.trim() || addSettings.dirty()) { date.value = selectedDate; setError('작성 중인 업무를 저장하거나 수정 취소 후 날짜를 변경해 주세요. 추가 입력은 직접 지울 수 있습니다.'); return false; }
    selectedDate = value; followsToday = auto; date.value = value; expanded = false; confirmation = null;
    snapshot = null; renderTasks(); void load(); return true;
  }
  date.addEventListener('change', () => changeDate(date.value)); filter.addEventListener('change', () => { expanded = false; renderTasks(); });
  input.addEventListener('input', draftSignal);settingsToggle.addEventListener('input',draftSignal);
  form.addEventListener('submit', event => { event.preventDefault(); const title = input.value.trim(); if (!title || !snapshot || busy) return;
    if (!repeat.valid() || !addSettings.valid()) return; const entered = input.value;
    mutate('create', { title, ...addSettings.get(), startDate: selectedDate, weekdays: repeat.get(), frequency: repeat.frequency(), date: selectedDate }, () => { if (input.value === entered) { input.value = ''; repeat.reset(); addSettings.reset(); } input.focus(); });
  });
  function schedule() { clearTimeout(timer); if (owner && visible && online && !document.hidden) timer = setTimeout(() => void load(), Math.min(300000, 30000 * 2 ** failures)); }
  async function load() {
    clearTimeout(timer); if (!owner || !visible || !online || document.hidden || querying || busy) { schedule(); return; }
    if (followsToday && selectedDate !== today() && !editing && !pending && !input.value.trim()) { selectedDate = today(); date.value = selectedDate; snapshot = null; }
    const ticket = epoch, requestedDate = selectedDate, generation = ++readGeneration; querying = true;
    if (!snapshot) status.textContent = '개인 업무와 소식을 불러오는 중…';
    try { const data = await invoke({ method: 'GET', date: requestedDate, calendarMonth:requestedDate.slice(0,7),calendarWeek:requestedDate, offset: 0, limit: 200 });
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
    const target = fields.taskId && snapshot.tasks.find(task => rowKey(task) === String(fields.taskId) + '|' + fields.date);
    pending = { command: { action, expectedRevision: snapshot.revision, requestId: crypto.randomUUID(), date: selectedDate, ...fields }, done,
      baseline: target ? taskFingerprint(target) : null, retries: 0 };
    draftSignal();
    void sendPending();
  }
  async function sendPending() {
    if (!pending || busy || !owner) return;
    let retryUnchanged = false;
    const request = pending, ticket = epoch; readGeneration++; querying = false; busy = true; lock(); renderTasks(); setError('');
    try { const data = await invoke({ method: 'POST', command: request.command });
      if (ticket !== epoch) return;
      if (!data?.success) { const e = new Error(data?.error || '저장하지 못했습니다. 입력은 유지됩니다.'); e.conflict = data?.status === 409 || /CONFLICT|REVISION/i.test(data?.code || ''); throw e; }
      if (data.ownerId && data.ownerId !== owner) throw new Error('계정이 변경되어 결과를 표시하지 않습니다.');
      pending = null; confirmation = null; request.done?.(); status.textContent = '저장했습니다.';
      // Mutations of carried occurrences may return that original date: reload the selected view.
      busy = false; querying = false; await load();
    } catch (e) { if (ticket !== epoch) return; setError((e.conflict ? '다른 창에서 변경했습니다. 최신 자료를 읽고 입력은 유지합니다. ' : '') + (e.message || '저장 실패') + ' 다시 시도해 주세요.');
      if (e.conflict) {
        busy = false; await load();
        if (pending === request && snapshot) {
          const current = request.command.taskId && snapshot.tasks.find(task => rowKey(task) === String(request.command.taskId) + '|' + request.command.date);
          const unchanged = request.command.taskId ? current && taskFingerprint(current) === request.baseline : true;
          if (unchanged && request.retries < 1 && snapshot.revision !== request.command.expectedRevision) {
            request.retries++; request.command = { ...request.command, expectedRevision: snapshot.revision, requestId: crypto.randomUUID() }; retryUnchanged = true;
          }
        }
      }
    } finally { if (ticket === epoch) { busy = false; lock(); renderTasks(); if (!pending && request.command.taskId && !editing) focusTask(request.command.taskId); draftSignal(); schedule(); if (retryUnchanged) queueMicrotask(() => void sendPending()); } }
  }
  function renderData() { status.textContent = '마지막 갱신 ' + stamp(snapshot.syncedAt) + ' · 홈 표시 중 30초마다 확인'; renderTasks(); renderFeeds(); lock(); }
  function rowKey(task) { return String(task.id) + '|' + (task.occurrenceDate || selectedDate); }
  function taskFingerprint(task) { return JSON.stringify([task.title, task.startDate, task.weekdays, task.frequency, task.monthDay, task.occurrenceDate,task.startTime,task.endTime,task.shortcut, !!task.done, !!task.archived, !!task.stopped]); }
  function focusTask(id) { [...rows.querySelectorAll('.hw-task')].find(r => r.dataset.task.startsWith(String(id) + '|'))?.querySelector('button:not(:disabled),input:not(:disabled)')?.focus(); }
  function taskFields(task) { return { taskId: task.id, date: task.occurrenceDate || selectedDate }; }
  function renderTasks() {
    if (editing && rows.querySelector('.hw-edit')) {try{captureEdit();}catch{ return; }}
    const focusedEdit = rows.querySelector('.hw-edit')?.contains(document.activeElement) ? { name: document.activeElement.name, start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd } : null;
    rows.replaceChildren(); weekday.textContent = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', weekday: 'long' }).format(new Date(selectedDate + 'T12:00:00+09:00'));
    window.dispatchEvent(new CustomEvent('home-workspace-data',{detail:{owner,date:selectedDate,calendar:snapshot?.calendar,calendarWeek:snapshot?.calendarWeek}}));
    const all = snapshot?.tasks || []; const active = all.filter(t => !t.archived);
    progress.max=Math.max(1,active.length);progress.value=active.filter(t=>t.done).length;
    count.textContent = snapshot ? (snapshot.nextOffset != null ? '불러온 업무 ' : '') + active.filter(t => t.done).length + ' / ' + active.length + ' 완료' + (snapshot.nextOffset != null ? ' · 전체 ' + snapshot.totalTasks + '건' : '') : '';
    const items = all.filter(t => filter.value === 'archived' ? t.archived : !t.archived && (filter.value === 'pending' ? !t.done : filter.value === 'done' ? t.done : filter.value === 'repeat' ? (t.frequency||((t.weekdays||[]).length?'weekly':'once')) !== 'once' : true)).sort(window.NenovaTaskSettings.compare);
    listView.setAttribute('aria-pressed',String(!timeline));timeView.setAttribute('aria-pressed',String(timeline));
    if(timeline&&!editing&&owner){renderTimeline(items);more.hidden=snapshot?.nextOffset==null;more.textContent='업무 더 불러오기';draftSignal();return;}
    if (!owner) { rows.append(node('p', 'hw-empty', '로그인하면 개인 업무와 소식을 확인할 수 있습니다.')); }
    else if (snapshot && !items.length) rows.append(node('p', 'hw-empty', '선택한 날짜와 보기에 해당하는 업무가 없습니다.'));
    for (const task of (expanded ? items : items.slice(0, 8))) {
      const row = node('div', 'hw-task' + (task.done ? ' is-done' : '')); row.dataset.task = rowKey(task);
      if (editing === rowKey(task)) { renderEdit(row, task); rows.append(row); continue; }
      const label = node('label', 'hw-task-label'), check = node('input'); check.type = 'checkbox'; check.checked = !!task.done; check.disabled = busy || task.archived; check.setAttribute('aria-label', task.title + ' 완료');
      check.addEventListener('change', () => { const done = check.checked; check.checked = !!task.done; mutate('complete', { ...taskFields(task), done }); });
      label.append(check, node('span', '', task.title));
      const recurrence=task.frequency||(task.weekdays?.length?'weekly':'once');
      const repeatLabel = recurrence === 'monthly' ? `매월 ${task.monthDay || Number(task.startDate.slice(8))}일` : recurrence === 'daily' ? '매일' : recurrence === 'weekly' ? `매주 ${task.weekdays.map(d => dayNames[d]).join('·')}` : '일회';
      const meta = node('span', 'hw-task-meta', (task.carried ? '이월 ' + task.occurrenceDate + ' · ' : '') + (task.stopped ? '반복 종료' : repeatLabel));
      const time=node('time','hw-task-time',task.startTime||'미정');time.title=task.endTime?task.startTime+'–'+task.endTime:'';row.append(time,label,meta);
      if(task.shortcut){const go=button((task.shortcut.kind==='desktop'?'▣ ':'↗ ')+task.shortcut.label+' ↗',async()=>{go.disabled=true;try{await window.desktop.invoke('taskShortcut',{shortcut:task.shortcut});}catch(e){setError(e.message);}finally{go.disabled=busy;}},'hw-task-go');row.append(go);}
      const action = (text, fn) => { const b = button(text, fn); b.disabled = busy; row.append(b); return b; };
      if (task.archived) action('복구', () => mutate('restore', taskFields(task)));
      else { action('수정', () => { editing = rowKey(task); editDraft = { title: task.title, startDate: task.startDate || selectedDate, weekdays: task.weekdays || [], frequency: recurrence,...window.NenovaTaskSettings.normalize({},task) }; renderTasks(); rows.querySelector('.hw-edit input')?.focus(); });
        action('삭제', () => { confirmation = { key: rowKey(task), action: 'archive' }; renderTasks(); rows.querySelector('.hw-confirm button')?.focus(); });
        if (recurrence !== 'once' && !task.stopped) action('반복 종료', () => { confirmation = { key: rowKey(task), action: 'stop' }; renderTasks(); rows.querySelector('.hw-confirm button')?.focus(); }); }
      if (confirmation?.key === rowKey(task)) { const confirm = node('div', 'hw-confirm'); confirm.append(node('span', '', confirmation.action === 'stop' ? '오늘(또는 선택한 미래 날짜) 이후 반복을 종료합니다. 과거·미완료 기록은 유지됩니다.' : '이 날짜의 업무를 삭제합니다. 삭제한 업무에서 복구할 수 있습니다.'));
        const cancel = () => { confirmation = null; renderTasks(); focusTask(task.id); };
        const yes = button('확인', () => mutate(confirmation.action, taskFields(task))); yes.disabled = busy; confirm.append(yes, button('취소', cancel)); confirm.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!busy) cancel(); } }); row.append(confirm); }
      rows.append(row);
    }
    more.hidden = items.length <= 8 && snapshot?.nextOffset == null; more.textContent = expanded ? snapshot?.nextOffset != null ? '업무 더 불러오기' : '8건만 보기' : '전체 보기' + (snapshot?.totalTasks ? ' (' + snapshot.totalTasks + '건)' : '');
    if (focusedEdit?.name) { const field = rows.querySelector('.hw-edit')?.elements[focusedEdit.name]; field?.focus({ preventScroll: true }); if (field?.type === 'text') field.setSelectionRange(focusedEdit.start, focusedEdit.end); }
    draftSignal();
  }
  function renderTimeline(items){
    const times=[...new Set(['08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00',...items.map(t=>t.startTime).filter(Boolean)])].sort();
    for(const time of [...times,'']){const slot=node('div','hw-time-slot');slot.append(node('time','',time||'시간 미정'));const content=node('div','hw-time-items');for(const task of items.filter(t=>(t.startTime||'')===time)){content.append(button((task.carried?task.occurrenceDate+' 이월 · ':'')+task.title,()=>{editing=rowKey(task);editDraft={title:task.title,startDate:task.startDate,weekdays:task.weekdays,frequency:task.frequency,...window.NenovaTaskSettings.normalize({},task)};renderTasks();rows.querySelector('.hw-edit input')?.focus();}));}
      content.append(button('＋ 이 시간에 업무 추가',()=>{settingsToggle.open=true;addSettings.setStart(time);input.focus();},'hw-slot-add'));slot.append(content);rows.append(slot);}
  }
  let editRepeat,editSettings;
  function captureEdit() { const f = rows.querySelector('.hw-edit'); if (f) editDraft = { title: f.elements.title.value, startDate: f.elements.startDate.value, weekdays: editRepeat.get(), frequency: editRepeat.frequency(),...editSettings.get() }; }
  function renderEdit(row, task) {
    const f = node('form', 'hw-edit'), text = node('input'), start = node('input'); text.name = 'title'; text.value = editDraft.title; text.required = true; text.maxLength = 300; text.setAttribute('aria-label', '업무 제목 수정'); start.type = 'date'; start.name = 'startDate'; start.value = editDraft.startDate; start.required = true; start.setAttribute('aria-label', '반복 시작일'); editRepeat = makeRepeat(editDraft.weekdays,editDraft.frequency);editSettings=window.NenovaTaskControls.create(editDraft,menuGroups);
    const cancelEdit = () => { editing = null; editDraft = null; renderTasks(); rows.querySelector('[data-task="' + CSS.escape(rowKey(task)) + '"]>button')?.focus(); };
    const save = node('button', 'hw-primary', '저장'); save.type = 'submit'; const cancel = button('취소', cancelEdit); f.append(text, start, editRepeat.root,editSettings.root, save, cancel,node('small','hw-muted','선택 업무는 즉시, 반복 설정은 다음날부터 반영됩니다.'));
    f.querySelectorAll('input,select,button').forEach(e => e.disabled = busy);
    f.addEventListener('submit', e => { e.preventDefault();if(!editSettings.valid())return; captureEdit(); if (!editDraft.title.trim() || !editRepeat.valid()) return; mutate('update', { ...taskFields(task), ...editDraft, title: editDraft.title.trim() }, () => { editing = null; editDraft = null; }); });
    f.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!busy) cancelEdit(); } }); row.append(f);
  }
  function renderFeeds() {
    const focused = document.activeElement?.dataset.feedControl; feeds.replaceChildren();
    for (const lane of lanes) {
      const items = feedItems(lane.key); lane.at %= Math.max(1, items.length); const item = items[lane.at];
      const row = node('section', 'hw-feed'); row.setAttribute('aria-label', lane.key === 'guidance' ? '주의·업무 지침' : '수입부 피드백');
      row.append(node('strong', '', lane.key === 'guidance' ? '주의·업무 지침' : '수입부 피드백'));
      const copy = node('div', 'hw-feed-copy');
      if (snapshot?.feedErrors?.[lane.key]) copy.append(node('span', 'hw-error-copy', '조회 실패 · ' + snapshot.feedErrors[lane.key]));
      if (item) {
        copy.append(node('span', 'hw-feed-title', (lane.key === 'feedback' ? '' : item.isNew ? '새 소식 · ' : item.unread ? '미확인 · ' : '') + item.title));
        if (contentText(item.summary) && normalizedText(item.summary) !== normalizedText(item.title)) copy.append(node('span', 'hw-feed-summary', item.summary));
        if (lane.key === 'feedback') {
          const presentation = feedbackPresentation(item), meta = node('div', 'hw-feedback-meta');
          const badge = node('span', 'hw-feedback-state is-' + presentation.tone, presentation.label);
          badge.title = '업무 상태 · ' + presentation.description;
          meta.append(badge, node('small', 'hw-feed-read', item.unread ? (item.isNew ? '새 소식 · 읽지 않음' : '읽지 않음') : '읽음'), node('small', '', feedMeta(item, lane.key, false)));
          copy.append(meta);
        } else copy.append(node('small', '', feedMeta(item, lane.key)));
      }
      else if (!snapshot?.feedErrors?.[lane.key]) copy.append(node('span', '', !owner ? '로그인 후 확인' : !snapshot ? '소식 확인 중…' : '표시할 내용이 없습니다.'));
      row.append(copy); const controls = node('div', 'hw-feed-controls');
      const ctrl = (name, text, fn, disabled = false) => { const b = button(text, fn); b.dataset.feedControl = lane.key + ':' + name; b.setAttribute('aria-label', row.getAttribute('aria-label') + ' ' + text); b.disabled = disabled; controls.append(b); return b; };
      const move = d => { lane.at = (lane.at + d + items.length) % items.length; renderFeeds(); };
      const position = items.length ? (lane.at + 1) + '/' + items.length : '';
      if (lane.key === 'feedback') {
        const tones = items.map(item => feedbackPresentation(item).tone);
        const counts = node('small', 'hw-feedback-count', `표시 ${items.length}건 · 지연 ${tones.filter(t => t === 'overdue').length} · 필요 ${tones.filter(t => t === 'waiting').length} · 답변 ${tones.filter(t => t === 'answered').length}${position ? ' · ' + position : ''}`);
        counts.title = `표시 중 ${items.length}건 기준, 전체 현황은 원문에서 확인하세요. 필요: 요청 필요·답변 필요·재발 확인(지연 제외). 답변: 답변 도착·개선 확인. 지연 → 필요 → 처리 중 순서로 표시합니다.`;
        counts.setAttribute('aria-label', counts.textContent + '. ' + counts.title); controls.append(counts);
      } else controls.append(node('small', '', position));
      ctrl('prev', '이전', () => move(-1), items.length < 2); ctrl('next', '다음', () => move(1), items.length < 2);
      const pause = ctrl('pause', lane.paused ? '재생' : '일시정지', () => { lane.paused = !lane.paused; renderFeeds(); }, !items.length); pause.setAttribute('aria-pressed', String(lane.paused));
      ctrl('detail', '더보기', e => showDetail(lane, false, e), !item); ctrl('all', '전체', () => showDetail(lane, true), !items.length);
      row.append(controls); row.addEventListener('mouseenter', () => lane.hover = true); row.addEventListener('mouseleave', () => lane.hover = false); row.addEventListener('focusin', () => lane.focus = true); row.addEventListener('focusout', e => lane.focus = row.contains(e.relatedTarget));
      row.addEventListener('keydown', e => { if (items.length > 1 && ['ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); move(e.key === 'ArrowLeft' ? -1 : 1); } }); feeds.append(row);
    }
    if (focused) [...feeds.querySelectorAll('button')].find(b => b.dataset.feedControl === focused)?.focus({ preventScroll: true });
  }
  function contentText(value) { return typeof value === 'string' ? value.trim() : ''; }
  function normalizedText(value) { return contentText(value).replace(/\s+/g, ' '); }
  function feedItems(key) {
    const items = snapshot?.[key] || [];
    if (key !== 'feedback') return items;
    const priority = { overdue: 0, waiting: 1, progress: 2, answered: 3, unknown: 4 };
    // Stable sorting preserves the server's newest-first order within a status.
    return [...items].sort((a, b) => priority[feedbackPresentation(a).tone] - priority[feedbackPresentation(b).tone]);
  }
  function feedbackPresentation(item) {
    // Match farmQuality.qualityStatus: only an unanswered WAITING request can
    // exceed its answer due date. Read markers never determine workflow state.
    const rawDue = Object.prototype.hasOwnProperty.call(item, 'dueDate') ? item.dueDate : item.details?.dueDate;
    const due = typeof rawDue === 'string' && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(rawDue) ? rawDue.slice(0, 10) : '';
    const validDue = due && Number.isFinite(Date.parse(rawDue)) && Number.isFinite(Date.parse(due + 'T00:00:00Z')) && new Date(due + 'T00:00:00Z').toISOString().slice(0, 10) === due;
    if (item.status === 'WAITING' && validDue && due < today()) return { tone: 'overdue', label: '기한 초과', description: due + ' 답변 기한이 지났으며 아직 미답변입니다.' };
    const statuses = {
      NEW: ['waiting', '요청 필요', '농장 요청이 필요한 상태입니다.'],
      WAITING: ['waiting', '답변 필요', '농장 답변을 기다리는 상태입니다.'],
      RECURRED: ['waiting', '재발 확인', '재발이 기록되어 후속 확인이 필요합니다.'],
      OBSERVING: ['progress', '개선 관찰 중', '답변 이후 개선 적용 결과를 관찰 중입니다.'],
      ANSWERED: ['answered', '답변 도착', '농장 답변이 등록되었습니다. 개선 완료를 뜻하지 않습니다.'],
      CLOSED: ['answered', '개선 확인', '개선 확인으로 종료된 상태입니다.'],
    };
    const [tone, label, description] = statuses[item.status] || ['unknown', '상태 확인 필요', '업무 상태를 원문에서 확인하세요.'];
    return { tone, label, description };
  }
  function feedMeta(item, key, includeStatus = true) {
    const status = key === 'feedback' ? feedbackPresentation(item).label : contentText(item.statusLabel) || ({ CHECK: '확인 필요', CURRENT: '현재 지침' }[item.status] || '');
    return [includeStatus ? status : '', item.orderYear ? item.orderYear + '년 ' + (item.orderWeek ? item.orderWeek + '차' : '차수 미확인') : '', stamp(item.updatedAt)].filter(Boolean).join(' · ');
  }
  function appendFeedDetails(article, item, key) {
    const values = item.details && typeof item.details === 'object' ? item.details : {};
    const list = node('dl', 'hw-detail-fields');
    const field = (label, value) => {
      const lines = (Array.isArray(value) ? value : [value]).map(contentText).filter(Boolean);
      if (!lines.length) return;
      const body = node('dd');
      if (Array.isArray(value)) { const items = node('ul'); for (const line of lines) items.append(node('li', '', line)); body.append(items); }
      else body.textContent = lines[0];
      list.append(node('dt', '', label), body);
    };
    if (key === 'guidance') {
      for (const [name, label] of [['situation', '상황'], ['action', '조치'], ['caution', '주의사항'], ['checklist', '확인 목록'], ['contact', '담당·연락처'], ['reviewDate', '검토일']]) field(label, values[name]);
    } else {
      field('문제 내용', values.problem); field('요청 사항', values.request); field('최근 내용', values.latestBody); field('처리 기한', values.dueDate);
      const sourceLines = sources => sources.map(source => [contentText(source.productName), contentText(source.farmName), source.orderYear ? String(source.orderYear) + '년' : '', source.orderWeek ? String(source.orderWeek) + '차' : '차수 미확인'].filter(Boolean).join(' · '));
      if (Array.isArray(values.sources) && values.sources.length) field('이 이력에 연결된 품목·농장·차수', sourceLines(values.sources));
      else { field('연결된 농장', values.farms); field('연결된 품목', values.products); }
      if (Array.isArray(values.relatedSources) && values.relatedSources.length) field('관련 그룹 원본 · 개별 이력 연결 미확인', sourceLines(values.relatedSources));
      const kinds = { COMMENT: '코멘트', REQUEST: '농장 요청 / 재요청', RESPONSE: '농장 답변', APPLY: '개선 적용', CLOSE: '개선 확인', RECUR: '재발 확인' };
      if (Array.isArray(values.recentEvents)) field('최근 이력', values.recentEvents.map(event => [contentText(event.kindLabel) || kinds[event.kind] || '이력', stamp(event.createdAt), contentText(event.body)].filter(Boolean).join('\n')));
    }
    if (list.children.length) article.append(list);
    else if (contentText(item.summary) && normalizedText(item.summary) !== normalizedText(item.title)) article.append(node('p', '', item.summary));
    if (item.detailsTruncated) article.append(node('p', 'hw-error-copy', contentText(item.detailNotice) || '일부 상세 내용은 원문 보기에서 확인하세요.'));
  }
  function showDetail(lane, all) {
    detail = lane.key; detailTrigger = document.activeElement?.dataset.feedControl; feedDetail.replaceChildren(); feedDetail.hidden = false;
    const close = button('닫기', closeDetail); feedDetail.append(close);
    const items = feedItems(lane.key);
    for (const item of (all ? items : [items[lane.at]])) { const article = node('article'); article.append(node('h3', '', item.title), node('small', '', feedMeta(item, lane.key))); appendFeedDetails(article, item, lane.key);
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
  window.homeWorkspace = { selectDate:changeDate, beginAt(value,time){if(!changeDate(value,false))return false;settingsToggle.open=true;addSettings.setStart(time);input.focus();input.scrollIntoView({block:'center',behavior:reduced.matches?'instant':'smooth'});return true;}, applyState(next) {
    if(Array.isArray(next.menus)){menuGroups=next.menus;addSettings.setMenus(menuGroups);}
    const nextOwner = Object.prototype.hasOwnProperty.call(next, 'homeOwnerId') ? String(next.homeOwnerId || '') : owner;
    const changed = nextOwner !== owner, wasVisible = visible, wasOnline = online;
    if (changed) { epoch++; owner = nextOwner; snapshot = null; pending = null; editing = null; editDraft = null; confirmation = null; busy = false; querying = false; failures = 0; input.value = ''; repeat.reset(); addSettings.reset(); filter.value = 'active'; expanded = false; selectedDate = today(); date.value = selectedDate; followsToday = true; detail = null; feedDetail.hidden = true; feedDetail.replaceChildren(); setError(''); lanes.forEach(l => { l.at = 0; l.hover = false; l.focus = false; }); }
    if ('menuOpen' in next) visible = !!next.menuOpen; if ('online' in next) online = !!next.online;
    if (changed) { status.textContent = owner ? '개인 업무를 확인합니다.' : '로그인이 필요합니다.'; renderTasks(); renderFeeds(); lock(); }
    if (!visible || !online || !owner) clearTimeout(timer);
    if (owner && !online) status.textContent = '연결 대기 · ' + (snapshot ? '마지막 갱신 ' + stamp(snapshot.syncedAt) : '온라인 연결 후 다시 확인합니다.');
    if (owner && visible && online && (changed || !wasVisible || !wasOnline)) void load();
  } };
  renderTasks(); renderFeeds(); lock(); status.textContent = '로그인하면 개인 업무를 사용할 수 있습니다.';
})();
