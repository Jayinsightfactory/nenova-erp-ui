const assert = require('node:assert/strict');
(async () => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'file:///C:/Users/USER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [1920, 800]) {
      const page = await browser.newPage({ viewport: { width, height: 1080 } });
      let owner = true, cursorSeen = false;
      await page.route('**/api/**', async route => {
        const url = new URL(route.request().url());
        let data = { success: true };
        if (url.pathname === '/api/auth/me') data.user = { userId: 'nenovaSS3', userName: '검증 사용자', authority: 'admin' };
        if (url.pathname === '/api/work/activity') {
          if (route.request().method() !== 'GET') data = { success: true, acceptedIds: [] };
          else if (url.searchParams.has('me')) data = { success: true, userId: 'nenovaSS3', canView: owner, record: true };
          else { cursorSeen ||= url.searchParams.get('cursor') === 'page2'; data = { success: true, nextCursor: url.searchParams.has('cursor') ? null : 'page2', items: [{ id: 'event-1', receivedAt: '2026-10-14T01:23:45Z', userId: 'employee', userName: '테스트 사용자', source: 'desktop', kind: 'api', path: '/api/estimate/weekday-apply', label: '아주 긴 버튼 이름도 내용을 생략하지 않고 읽을 수 있어야 합니다', outcome: 'failure', status: 409, actionId: '11111111-2222-3333-4444-555555555555' }] }; }
        }
        if (url.pathname === '/api/admin/activity') data = { success: true, activities: [], userList: [] };
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
      });
      await page.goto(`${process.env.ACTIVITY_UI_BASE || 'http://127.0.0.1:20769'}/admin/activity?popup=1`);
      const panel = page.locator('.user-activity');
      await panel.waitFor();
      await panel.getByRole('button', { name: '로그 조회', exact: true }).focus();
      await page.keyboard.press('Enter');
      await panel.getByText('HTTP 409').waitFor();
      assert.equal(await panel.getByRole('heading').evaluate(el => el === document.activeElement), true);
      assert(await panel.evaluate(el => el.getBoundingClientRect().right <= window.innerWidth + 1));
      assert.equal(await panel.locator('td').first().evaluate(el => getComputedStyle(el).whiteSpace), 'normal');
      await panel.getByRole('button', { name: '다음 페이지' }).focus();
      await page.keyboard.press('Space');
      await page.waitForFunction(() => document.querySelector('.user-activity .paging button:last-child')?.disabled);
      assert(cursorSeen);
      await panel.getByRole('region').focus();
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Escape');
      await page.screenshot({ path: `outputs/activity-ui-${width}.png`, fullPage: true });
      owner = false;
      await page.reload();
      await page.waitForTimeout(300);
      assert.equal(await panel.count(), 0);
      await page.close();
      console.log(`PASS ${width}x1080 CSS/100%, wrap, horizontal scroll region, Enter/Space pagination, denied hidden`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
