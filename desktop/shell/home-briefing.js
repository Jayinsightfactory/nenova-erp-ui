// 홈 화면 아침 브리핑 칸(읽기 전용). 메인 쪽이 받아 온 카드만 그린다. 칸 높이는 고정이고 넘치면 칸 안에서만 스크롤한다.
(() => {
  'use strict';
  const MARK = { red: '●', amber: '▲', green: '✓', gray: '–' };
  const REFRESH_MS = 5 * 60 * 1000;
  const live = { owner: '', generation: 0, busy: false, timer: null, loaded: false };
  const $ = id => document.getElementById(id);

  function setTone(tone) {
    const panel = $('briefingPanel');
    panel.classList.remove('is-red', 'is-amber', 'is-green', 'is-gray');
    panel.classList.add(`is-${tone}`);
    panel.dataset.state = tone;
  }

  function message(text, tone = 'gray') {
    setTone(tone);
    $('briefingSummary').textContent = text;
    $('briefingList').replaceChildren();
    $('briefingStamp').textContent = '';
  }

  function render(result) {
    const cards = Array.isArray(result?.cards) ? result.cards : [];
    if (!result || result.success !== true || !cards.length) return message('불러온 항목이 없습니다');
    setTone(['red', 'amber', 'green', 'gray'].includes(result.overall) ? result.overall : 'gray');
    $('briefingSummary').textContent = result.summary || '';
    const list = $('briefingList');
    const focusedId = list.contains(document.activeElement) ? document.activeElement.dataset.briefingCard : '';
    list.replaceChildren();
    for (const card of cards) {
      const row = document.createElement(card.href ? 'button' : 'div');
      row.className = `briefing-row is-${card.status}`;
      row.dataset.briefingCard = card.id;
      if (card.href) {
        row.type = 'button';
        row.addEventListener('click', () => { void window.desktop.invoke('open', { url: card.href, title: card.title }).catch(() => {}); });
      }
      const mark = document.createElement('span'); mark.className = 'briefing-mark'; mark.textContent = MARK[card.status] || MARK.gray; mark.setAttribute('aria-hidden', 'true');
      const title = document.createElement('span'); title.className = 'briefing-title'; title.textContent = card.title;
      const headline = document.createElement('strong'); headline.className = 'briefing-headline'; headline.textContent = card.headline;
      const state = document.createElement('span'); state.className = 'briefing-state'; state.textContent = card.statusLabel;
      row.append(mark, title, headline, state);
      // 한 줄 요약만 칸에 보이고, 자세한 줄은 마우스를 올리면(또는 눌러서 화면을 열면) 보인다.
      const detail = [...card.lines, ...(card.more > 0 ? [`외 ${card.more}건 더 있음`] : []), ...(card.href ? [`→ ${card.linkLabel || card.title} (눌러서 새 탭으로 열기)`] : [])];
      row.title = detail.join('\n');
      row.setAttribute('aria-label', `${card.statusLabel} · ${card.title} · ${card.headline}`);
      const item = document.createElement('div'); item.setAttribute('role', 'listitem'); item.append(row);
      list.append(item);
    }
    if (focusedId) [...list.querySelectorAll('[data-briefing-card]')].find(node => node.dataset.briefingCard === focusedId)?.focus({ preventScroll: true });
    const at = result.generatedAt ? new Date(result.generatedAt) : new Date();
    $('briefingStamp').textContent = `${new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' }).format(at)} 기준`;
  }

  function failureText(error) {
    const text = String(error?.message || '');
    const index = text.lastIndexOf('Error: ');
    return (index >= 0 ? text.slice(index + 7) : text).slice(0, 80) || '아침 브리핑을 불러오지 못했습니다.';
  }

  async function load() {
    clearTimeout(live.timer); live.timer = null;
    if (!live.owner || document.hidden) return;
    const generation = live.generation;
    if (!live.busy) {
      live.busy = true; $('briefingReload').disabled = true;
      if (!live.loaded) message('확인 중…');
      try {
        const result = await window.desktop.invoke('morningBriefing');
        if (generation === live.generation && live.owner) { render(result); live.loaded = true; }
      } catch (error) {
        // 실패를 초록이나 0으로 보이게 하지 않는다. 이전에 받은 카드도 지운다(오래된 숫자를 현재처럼 보이지 않게).
        if (generation === live.generation && live.owner) { message(failureText(error)); live.loaded = false; }
      } finally {
        if (generation === live.generation) { live.busy = false; $('briefingReload').disabled = false; }
      }
    }
    if (live.owner) live.timer = setTimeout(() => void load(), REFRESH_MS);
  }

  function applyState(next) {
    if (!next || !Object.prototype.hasOwnProperty.call(next, 'homeOwnerId') || (next.homeOwnerId || '') === live.owner) return;
    live.owner = next.homeOwnerId || ''; live.generation++; live.busy = false; live.loaded = false;
    clearTimeout(live.timer); live.timer = null;
    $('briefingReload').disabled = !live.owner; $('briefingOpen').disabled = !live.owner;
    if (live.owner) void load(); else message('로그인 후 확인할 수 있습니다.');
  }

  $('briefingReload').addEventListener('click', () => { live.busy = false; void load(); });
  $('briefingOpen').addEventListener('click', () => { void window.desktop.invoke('open', { url: '/briefing', title: '아침 브리핑' }).catch(() => {}); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { clearTimeout(live.timer); live.timer = null; } else if (live.owner) void load(); });
  message('로그인 후 확인할 수 있습니다.');
  window.homeBriefing = { applyState };
})();
