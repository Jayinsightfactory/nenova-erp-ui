const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');
const root = path.resolve(__dirname, '..');
(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    for (const width of [1920, 800]) {
      const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.setViewport({ width, height: 1080 });
      await page.evaluateOnNewDocument(() => {
        const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
        window.fixture = { owner: 'fixture-A', revision: 1, fail: false, calls: [], tasks: [{ id: 'one', title: '길이가 긴 업무 제목을 생략하지 않고 표시하는 개인 업무', startDate: date, occurrenceDate: date, weekdays: [5], done: false }] };
        const snapshot = () => ({ success: true, ownerId: fixture.owner, schemaVersion: 1, date, revision: fixture.revision, tasks: fixture.tasks, nextOffset: null, totalTasks: fixture.tasks.length, guidance: [{ id: 'g', title: '2026년 업무 지침', summary: '전체 상세 내용', href: '/operations-knowledge', sourceKey: 'g:1', unread: true, updatedAt: '2026-10-09T01:00:00Z' }], feedback: [], feedErrors: {}, syncedAt: '2026-10-09T01:00:00Z' });
        const state = () => ({ homeOwnerId: fixture.owner, menuOpen: true, online: true, windows: [], tabs: [], menus: [], favorites: [], version: '1.3.5' });
        window.desktop = { onState(cb) { window.emitState = cb; }, async invoke(action, payload) {
          fixture.calls.push({ action, payload });
          if (action === 'state') return state();
          if (action === 'homeWorkspace') {
            if (fixture.fail) throw new Error('fixture 저장 실패');
            if (payload.method === 'POST' && fixture.conflict) { fixture.conflict = false; fixture.revision++; return { success: false, status: 409, error: '다른 창 변경' }; }
            if (payload.method === 'POST') { const c = payload.command; fixture.revision++;
              if (c.action === 'create') fixture.tasks.push({ id: 'new', title: c.title, startDate: c.startDate, occurrenceDate: c.date, weekdays: c.weekdays, done: false });
              if (c.action === 'complete') fixture.tasks.find(t => t.id === c.taskId).done = c.done;
              if (c.action === 'update') Object.assign(fixture.tasks.find(t => t.id === c.taskId), { title: c.title, weekdays: c.weekdays });
              if (c.action === 'archive') fixture.tasks.find(t => t.id === c.taskId).archived = true;
              if (c.action === 'restore') fixture.tasks.find(t => t.id === c.taskId).archived = false;
            } return snapshot();
          } return {};
        } };
      });
      await page.goto('file:///' + path.join(root, 'desktop/shell/index.html').replaceAll('\\', '/'));
      await page.waitForFunction(() => document.querySelector('.hw-task'));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await page.$eval('.hw-count', e => e.textContent), '0 / 1 완료');
      await page.type('.hw-add>input', '<img src=x onerror=alert(1)>');
      await page.evaluate(() => fixture.fail = true); await page.click('.hw-add>button');
      await page.waitForFunction(() => !document.querySelector('.hw-error').hidden);
      assert.equal(await page.$eval('.hw-add>input', e => e.value), '<img src=x onerror=alert(1)>');
      await page.evaluate(() => fixture.fail = false); await page.click('.hw-error button');
      await page.waitForFunction(() => document.querySelectorAll('.hw-task').length === 2);
      assert.equal(await page.$eval('.hw-add>input', e => e.value), '');
      assert.equal((await page.$$('.hw img')).length, 0);
      await page.click('.hw-task-label'); await page.waitForFunction(() => document.querySelector('.hw-count').textContent === '1 / 2 완료');
      await page.click('.hw-task>button'); await page.waitForSelector('.hw-edit input');
      await page.focus('.hw-edit input'); await page.keyboard.press('Escape'); assert.equal((await page.$$('.hw-edit')).length, 0);
      assert.equal(await page.evaluate(() => document.activeElement.textContent), '수정');
      await page.click('.hw-task>button'); await page.$eval('.hw-edit input', e => { e.value = '충돌 후 유지할 수정 초안'; e.dispatchEvent(new Event('input', { bubbles: true })); });
      const priorDate = await page.$eval('.hw-heading input', e => e.value);
      await page.$eval('.hw-heading input', e => { e.value = '2025-12-31'; e.dispatchEvent(new Event('change', { bubbles: true })); });
      assert.equal(await page.$eval('.hw-heading input', e => e.value), priorDate);
      await page.evaluate(() => fixture.conflict = true); await page.click('.hw-edit button[type=submit]');
      await page.waitForFunction(() => document.querySelector('.hw-error').textContent.includes('다른 창'));
      assert.equal(await page.$eval('.hw-edit input', e => e.value), '충돌 후 유지할 수정 초안');
      await page.click('.hw-error button'); await page.waitForFunction(() => !document.querySelector('.hw-edit'));
      assert.equal(await page.$eval('.hw-task-label span', e => e.textContent), '충돌 후 유지할 수정 초안');
      await page.focus('.hw-task-label input'); await page.keyboard.press('ArrowDown');
      assert.equal(await page.evaluate(() => document.activeElement.closest('.hw-task').dataset.task.startsWith('new|')), true);
      await page.click('[data-feed-control="guidance:detail"]'); assert.equal(await page.$eval('.hw-detail', e => e.hidden), false);
      await page.keyboard.press('Escape'); assert.equal(await page.$eval('.hw-detail', e => e.hidden), true);
      assert.equal(await page.evaluate(() => document.activeElement.dataset.feedControl), 'guidance:detail');
      fs.mkdirSync(path.join(root, 'desktop/test-output'), { recursive: true });
      await page.screenshot({ path: path.join(root, `desktop/test-output/home-workspace-${width}.png`), fullPage: true });
      await page.type('.hw-add>input', '삭제되어야 하는 계정 초안');
      await page.evaluate(() => { fixture.owner = ''; emitState({ homeOwnerId: '', online: false }); });
      assert.equal(await page.$eval('.hw-add>input', e => e.value), '');
      assert.equal((await page.$$('.hw-task')).length, 0);
      assert.equal(await page.$eval('.hw-add>button', e => e.disabled), true);
      assert.deepEqual(errors, []);
      console.log(`${width}x1080: layout, create/failure/retry, text safety, complete, conflict/draft preservation, date guard, row arrows, edit/detail Escape focus, account reset passed`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
