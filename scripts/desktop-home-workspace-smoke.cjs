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
        fixture.situation = '입고 포장 손상 발견 시 사진과 수량을 기록합니다.\n'.repeat(18) + '상황 전체 내용 마지막 문장';
        fixture.products = Array.from({ length: 22 }, (_, i) => `실제 묶음 품목 ${i + 1} 아주 긴 품목명을 그대로 표시`);
        fixture.guidance = [{ id: 'g', title: '입고 포장 손상 확인', summary: '포장 손상이 발견되면 해당 농장과 품목을 확인하고 손상 수량과 사진을 기록한 뒤 담당자에게 전달합니다. '.repeat(3), status: 'CHECK', statusLabel: '확인 필요',
          details: { situation: fixture.situation, action: '입고 기록에 사진과 수량을 함께 남깁니다.', caution: '<img src=x onerror=alert(1)> 실제 문구를 그대로 표시', checklist: '농장명 확인\n품목명 확인\n담당자 전달', contact: '입고 담당자', reviewDate: '2026-10-09' },
          href: '/operations-knowledge', sourceKey: 'g:1', unread: true, isNew: false, updatedAt: '2026-10-09T01:00:00Z' },
          { id: 'g2', title: '중복 요약 없는 지침', summary: '중복 요약 없는 지침', status: 'CURRENT', statusLabel: '현재 지침', details: {}, detailsTruncated: true, detailNotice: '상세 내용이 커서 원문에서 전체 내용을 확인하세요.', href: '/operations-knowledge', sourceKey: 'g:2', updatedAt: '2026-10-08T01:00:00Z' }];
        fixture.feedback = [{ id: 'f', title: '입고 후 꽃잎 손상 확인 요청', summary: 'A농장 외 1곳 · 묶음 품목 22개: 꽃잎 손상으로 판매가 어려워 사진 확인과 교환 여부 답변을 요청합니다.', status: 'WAITING', statusLabel: '미답변', dueDate: date, orderYear: 2026, orderWeek: '40-01',
          details: { farms: ['A농장', 'B농장'], products: fixture.products, sources: fixture.products.map((productName, i) => ({ productName, farmName: i % 2 ? 'B농장' : 'A농장', orderYear: 2026, orderWeek: '40-01', sourceKey: i + 1 })), relatedSources: [{ productName: '개별 연결이 확인되지 않은 품목', farmName: '관련 C농장', orderYear: 2026, orderWeek: '40-02' }],
            problem: '꽃잎 손상이 확인되었습니다.\n'.repeat(24) + '문제 상세 마지막 문장', request: '사진 확인과 교환 가능 여부 답변을 부탁드립니다.', latestBody: '현장 사진 3장을 담당자가 검토 중입니다.', dueDate: '2026-10-12', recentEvents: [{ kind: 'RESPONSE', body: '추가 사진 수신\n두 번째 농장도 확인', createdAt: '2026-10-09T03:00:00Z' }] },
          href: '/sales/farm-quality?year=2026&caseKey=f', sourceKey: 'f:2026:1', unread: true, isNew: true, updatedAt: '2026-10-09T02:00:00Z' }];
        const snapshot = () => ({ success: true, ownerId: fixture.owner, schemaVersion: 1, date, revision: fixture.revision, tasks: fixture.tasks, nextOffset: null, totalTasks: fixture.tasks.length, guidance: fixture.guidance, feedback: fixture.feedback, feedErrors: {}, syncedAt: '2026-10-09T01:00:00Z' });
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
      assert.match(await page.$eval('.hw-feed', e => e.textContent), /확인 필요/);
      assert.equal(await page.$eval('.hw-feed-summary', e => e.textContent), await page.evaluate(() => fixture.guidance[0].summary));
      assert.match(await page.$$eval('.hw-feed-summary', e => e[1].textContent), /꽃잎 손상/);
      const kstToday = await page.evaluate(() => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date()));
      const statusCases = [
        ['WAITING', '2025-12-31', 'overdue', '기한 초과'],
        ['WAITING', kstToday, 'waiting', '답변 필요'],
        ['WAITING', '2099-01-01', 'waiting', '답변 필요'],
        ['WAITING', '2026-02-30', 'waiting', '답변 필요'],
        ['WAITING', '2025-12-31Tinvalid', 'waiting', '답변 필요'],
        ['WAITING', null, 'waiting', '답변 필요'],
        ['NEW', '2025-12-31', 'waiting', '요청 필요'],
        ['RECURRED', '2025-12-31', 'waiting', '재발 확인'],
        ['OBSERVING', '2025-12-31', 'progress', '개선 관찰 중'],
        ['ANSWERED', '2025-12-31', 'answered', '답변 도착'],
        ['CLOSED', '2025-12-31', 'answered', '개선 확인'],
        ['OVERDUE', '2025-12-31', 'unknown', '상태 확인 필요'],
      ];
      for (const [status, dueDate, tone, label] of statusCases) {
        await page.evaluate(async ({ status, dueDate }) => {
          Object.assign(fixture.feedback[0], { status, dueDate, unread: true, isNew: true, detailsTruncated: true });
          fixture.feedback[0].details.dueDate = '2025-01-01';
          [...document.querySelectorAll('.hw-heading button')].find(b => b.textContent === '다시 조회').click();
          await new Promise(resolve => setTimeout(resolve, 0));
        }, { status, dueDate });
        const actual = await page.$eval('.hw-feedback-state', e => ({ label: e.textContent, className: e.className }));
        assert.equal(actual.label, label); assert.ok(actual.className.includes('is-' + tone), `${status}/${dueDate} uses the real workflow state, never read status`);
        assert.equal(await page.$eval('.hw-feed-read', e => e.textContent), '새 소식 · 읽지 않음');
        assert.match(await page.$$eval('.hw-feed-summary', e => e[1].textContent), /A농장.*품목 22개.*꽃잎 손상/);
      }
      await page.evaluate(async () => {
        Object.assign(fixture.feedback[0], { status: 'WAITING', dueDate: '2025-12-31', unread: false, isNew: false, detailsTruncated: false });
        [...document.querySelectorAll('.hw-heading button')].find(b => b.textContent === '다시 조회').click();
        await new Promise(resolve => setTimeout(resolve, 0));
      });
      assert.equal(await page.$eval('.hw-feed-read', e => e.textContent), '읽음');
      assert.equal(await page.$eval('.hw-feedback-state', e => e.textContent), '기한 초과', 'reading never marks a reply complete');
      await page.evaluate(async () => {
        fixture.savedDetails = fixture.feedback[0].details;
        fixture.feedback[0].details = {}; fixture.feedback[0].detailsTruncated = true;
        [...document.querySelectorAll('.hw-heading button')].find(b => b.textContent === '다시 조회').click();
        await new Promise(resolve => setTimeout(resolve, 0));
      });
      assert.equal(await page.$eval('.hw-feedback-state', e => e.textContent), '기한 초과', 'top-level due date survives the detailed-feed size budget');
      await page.evaluate(async () => {
        fixture.feedback[0].details = fixture.savedDetails; fixture.feedback[0].detailsTruncated = false;
        delete fixture.feedback[0].dueDate;
        [...document.querySelectorAll('.hw-heading button')].find(b => b.textContent === '다시 조회').click();
        await new Promise(resolve => setTimeout(resolve, 0));
      });
      assert.equal(await page.$eval('.hw-feedback-state', e => e.textContent), '기한 초과', 'older feed details due date remains compatible');
      const statusGeometry = await page.$eval('.hw-feedback-meta', e => ({ width: e.scrollWidth, client: e.clientWidth, height: e.getBoundingClientRect().height }));
      assert.ok(statusGeometry.width <= statusGeometry.client + 1 && statusGeometry.height < 50, 'status and read marker fit the existing compact metadata line');
      await page.focus('[data-feed-control="guidance:next"]'); await page.keyboard.press('ArrowRight');
      assert.equal(await page.$eval('.hw-feed', e => e.querySelectorAll('.hw-feed-summary').length), 0, 'identical title and summary are not repeated');
      await page.keyboard.press('ArrowLeft');
      await page.click('[data-feed-control="guidance:pause"]');
      assert.equal(await page.$eval('[data-feed-control="guidance:pause"]', e => e.getAttribute('aria-pressed')), 'true');
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
      const guidanceDetail = await page.$eval('.hw-detail', e => e.textContent);
      for (const label of ['상황', '조치', '주의사항', '확인 목록', '담당·연락처', '검토일', '상황 전체 내용 마지막 문장']) assert.ok(guidanceDetail.includes(label));
      assert.ok(guidanceDetail.includes(await page.evaluate(() => fixture.situation)), 'full guidance is not shortened to ticker summary');
      assert.equal((await page.$$('.hw-detail img')).length, 0, 'structured details remain inert text');
      assert.equal(await page.evaluate(() => document.activeElement.textContent), '닫기');
      await page.keyboard.press('Escape'); assert.equal(await page.$eval('.hw-detail', e => e.hidden), true);
      assert.equal(await page.evaluate(() => document.activeElement.dataset.feedControl), 'guidance:detail');
      await page.click('[data-feed-control="feedback:detail"]');
      const feedbackDetail = await page.$eval('.hw-detail', e => e.textContent);
      for (const name of await page.evaluate(() => fixture.products)) assert.ok(feedbackDetail.includes(name), 'every grouped product is visible');
      for (const text of ['A농장', 'B농장', '이 이력에 연결된 품목·농장·차수', '관련 그룹 원본 · 개별 이력 연결 미확인', '개별 연결이 확인되지 않은 품목', '관련 C농장', '문제 상세 마지막 문장', '교환 가능 여부', '현장 사진 3장', '추가 사진 수신', '농장 답변', '2026년', '40-01차']) assert.ok(feedbackDetail.includes(text));
      assert.equal(await page.$$eval('.hw-detail-fields dt', elements => elements.filter(e => ['연결된 농장','연결된 품목'].includes(e.textContent)).length), 0, 'paired sources avoid duplicate farm/product lists');
      assert.equal(await page.$$eval('.hw-detail-fields dd,.hw-feed-copy', elements => elements.every(e => e.scrollWidth <= e.clientWidth + 1 && !['hidden', 'clip', 'auto', 'scroll'].includes(getComputedStyle(e).overflowY))), true, 'summary and details wrap without clipping or nested scrolling');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      fs.mkdirSync(path.join(root, 'desktop/test-output'), { recursive: true });
      await page.screenshot({ path: path.join(root, `desktop/test-output/home-news-detail-${width}.png`), fullPage: true });
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => document.activeElement.dataset.feedControl), 'feedback:detail');
      await page.click('[data-feed-control="guidance:all"]');
      assert.equal((await page.$$('.hw-detail article')).length, 2);
      assert.match(await page.$eval('.hw-detail', e => e.textContent), /상세 내용이 커서 원문에서 전체 내용을 확인하세요/);
      assert.equal(await page.$$eval('.hw-detail article', elements => elements[1].querySelector('button').textContent), '원문 보기');
      await page.keyboard.press('Escape');
      await page.screenshot({ path: path.join(root, `desktop/test-output/home-workspace-${width}.png`), fullPage: true });
      await page.evaluate(async () => {
        const base = fixture.feedback[0];
        fixture.feedback = ['CLOSED','OBSERVING','NEW','WAITING','ANSWERED','RECURRED'].map((status, index) => ({ ...base, id: String(index), sourceKey: 'priority:' + index, title: status + ' 순환 검증', status, dueDate: '2025-12-31' }));
        [...document.querySelectorAll('.hw-heading button')].find(b => b.textContent === '다시 조회').click();
        await new Promise(resolve => setTimeout(resolve, 0));
      });
      assert.match(await page.$eval('.hw-feedback-count', e => e.textContent), /^표시 6건 · 지연 1 · 필요 2 · 답변 2 · 1\/6$/);
      assert.match(await page.$eval('.hw-feedback-count', e => e.getAttribute('aria-label')), /지연 제외.*답변 도착·개선 확인/);
      assert.match(await page.$eval('.hw-feedback-count', e => e.getAttribute('aria-label')), /표시 중 6건 기준, 전체 현황은 원문에서 확인/);
      await page.click('[data-feed-control="feedback:pause"]');
      for (const status of ['WAITING','NEW','RECURRED','OBSERVING','CLOSED','ANSWERED']) {
        assert.equal(await page.$$eval('.hw-feed-title', e => e[1].textContent), status + ' 순환 검증');
        await page.click('[data-feed-control="feedback:detail"]');
        assert.equal(await page.$eval('.hw-detail h3', e => e.textContent), status + ' 순환 검증', 'detail follows the displayed priority item');
        await page.keyboard.press('Escape'); await page.click('[data-feed-control="feedback:next"]');
      }
      await page.click('[data-feed-control="feedback:all"]');
      assert.deepEqual(await page.$$eval('.hw-detail h3', e => e.map(h => h.textContent)), ['WAITING','NEW','RECURRED','OBSERVING','CLOSED','ANSWERED'].map(s => s + ' 순환 검증'), 'all details use the same stable status priority');
      await page.keyboard.press('Escape');
      const countsGeometry = await page.$eval('.hw-feedback-count', e => ({ width: e.scrollWidth, client: e.clientWidth, height: e.getBoundingClientRect().height }));
      assert.ok(countsGeometry.width <= countsGeometry.client + 1 && countsGeometry.height < 25, 'counts use one existing control-line slot');
      await page.screenshot({ path: path.join(root, `desktop/test-output/home-feedback-status-${width}.png`), fullPage: true });
      await page.evaluate(async () => {
        fixture.feedback = [];
        [...document.querySelectorAll('.hw-heading button')].find(b => b.textContent === '다시 조회').click();
        await new Promise(resolve => setTimeout(resolve, 0));
      });
      assert.equal(await page.$eval('.hw-feedback-count', e => e.textContent), '표시 0건 · 지연 0 · 필요 0 · 답변 0');
      await page.type('.hw-add>input', '삭제되어야 하는 계정 초안');
      await page.evaluate(() => { fixture.owner = ''; emitState({ homeOwnerId: '', online: false }); });
      assert.equal(await page.$eval('.hw-add>input', e => e.value), '');
      assert.equal((await page.$$('.hw-task')).length, 0);
      assert.equal(await page.$eval('.hw-add>button', e => e.disabled), true);
      assert.deepEqual(errors, []);
      console.log(`${width}x1080: feedback colors/real status/due-date/read separation, CHECK guidance, summary/full details, wrapping/text safety, controls/pause/focus and tasks/account regressions passed`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
