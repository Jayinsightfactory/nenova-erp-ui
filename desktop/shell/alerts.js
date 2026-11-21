'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const clock = ms => ms ? new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms)) : '';

  function render(state) {
    const alerts = Array.isArray(state?.alerts) ? state.alerts : [];
    const approvals = alerts.filter(item => item.approval).length;
    $('count').textContent = state?.admin ? `전체 ${alerts.length}건 · 승인 필요 ${approvals}건` : '확인 중';
    const stale = Number.isFinite(state?.ageSec) && state.ageSec > 600;
    $('checked').textContent = state?.checkedAt ? `${clock(state.checkedAt)} 확인` : '';
    $('status').textContent = state?.failed ? '알림을 불러오지 못했습니다. 잠시 뒤 다시 확인합니다.'
      : stale ? `PM 자료가 ${Math.round(state.ageSec / 60)}분 전 것입니다.`
        : state?.admin && !alerts.length ? '지금 승인·확인할 일이 없습니다.' : '';
    const list = $('list');
    list.replaceChildren(...alerts.map(item => {
      const li = el('li', [item.approval ? 'approval' : '', item.fresh ? 'fresh' : ''].filter(Boolean).join(' '));
      const row = el('div', 'row');
      const title = el('span', 'title', item.title);
      if (item.fresh) title.append(el('span', 'new', '새 알림'));
      row.append(title);
      if (item.since) row.append(el('span', 'since', item.since));
      li.append(row);
      if (item.todo) li.append(el('span', 'todo', item.todo));
      if (item.detail) { const p = el('p', 'detail'); p.append(el('span', 'label', '내용'), document.createTextNode(item.detail)); li.append(p); }
      if (item.decision) { const p = el('p', 'decision'); p.append(el('span', 'label', '정할 것'), document.createTextNode(item.decision)); li.append(p); }
      const copy = el('button', 'copy', '클로드 지시문 복사'); copy.type = 'button';
      copy.addEventListener('click', async () => {
        try { await window.alerts.invoke('copy', { sig: item.sig }); copy.textContent = '복사됨 · 클로드에 붙여 넣으세요'; }
        catch { copy.textContent = '복사하지 못했습니다'; }
      });
      li.append(copy);
      return li;
    }));
  }

  async function act(action, button) {
    if (button) button.disabled = true;
    try { const result = await window.alerts.invoke(action); if (result && Array.isArray(result.alerts)) render(result); }
    catch { $('status').textContent = '요청을 처리하지 못했습니다.'; }
    finally { if (button) button.disabled = false; }
  }

  window.alerts.onState(render);
  $('openPm').addEventListener('click', event => act('openPm', event.currentTarget));
  $('refresh').addEventListener('click', event => act('refresh', event.currentTarget));
  $('close').addEventListener('click', () => act('close'));
  void act('state');
})();
