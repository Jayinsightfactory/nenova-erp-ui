// 회의정리 사용 가이드 녹화 — 실제 로컬 화면 + 가상의 연습 자료. 모든 /api 요청은 이 스크립트 안의 연습용 응답으로 대신한다.
//   전산 DB·운영 서버·AI 서비스에 연결하지 않는다.  --dry-run: 녹화 없이 조작만 검증(화면 사진은 .verify/meetings-shots)
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), net = require('node:net'), crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process'), jwt = require('jsonwebtoken'), puppeteer = require('puppeteer-core');
const { createWorkflowGuideRecorder } = require('./lib/workflow-guide-recorder.cjs');

const dry = process.argv.includes('--dry-run'), ID = 'work-meetings', CONFIG = 'config/workflow-guides.json';
const ENTRY = {
  id: ID, title: '회의 내용을 화이트보드로 정리하기', entryPaths: ['/work/meetings'],
  sourceFiles: ['pages/work/meetings.js', 'components/meetings/MeetingBoard.js', 'components/meetings/boardExport.js', 'lib/meetingBoard.js'],
  requiredScenarios: ['new', 'paste', 'organize', 'edit', 'move', 'source', 'save', 'export', 'reopen'],
  guides: [{ id: 'staff', role: '직원', title: '회의 내용 넣기부터 보드 고치기 · 저장 · 다시 열기', status: 'draft', src: `/guides/${ID}/staff.mp4`, captions: `/guides/${ID}/staff.ko.vtt`, proof: `/guides/${ID}/staff.proof.json`, chapters: [] }],
};
const SOURCE = [
  '11월 셋째 주 연습 주간 회의 (가상의 연습 자료)',
  '연습 팀장: 다음 주 연습 장미 입고가 하루 늦어질 것 같습니다.',
  '연습 대리: 그러면 수요일 출고분은 목요일로 미루겠습니다.',
  '연습 팀장: 좋습니다. 수요일 출고분은 목요일로 미루는 것으로 정합시다.',
  '연습 대리: 거래처 안내 문자는 제가 금요일까지 보내겠습니다.',
  '연습 사원: 연말 꽃다발 포장 상자가 모자랍니다. 상자를 더 주문해야 합니다.',
  '연습 팀장: 상자 규격은 아직 못 정했으니 다음 회의에서 다시 봅시다.',
  '연습 사원: 상자 견적은 누가 받을지 정하지 못했습니다.',
].join('\n');
const EXTRACTION = {
  title: '연습 주간 회의',
  topics: [
    { key: 't1', title: '장미 입고 지연과 출고 일정', quote: '다음 주 연습 장미 입고가 하루 늦어질 것 같습니다.', points: [
      { text: '다음 주 장미 입고가 하루 늦어질 듯', quote: '다음 주 연습 장미 입고가 하루 늦어질 것 같습니다.' },
      { text: '수요일 출고분을 목요일로 미루자는 의견', quote: '그러면 수요일 출고분은 목요일로 미루겠습니다.' }] },
    { key: 't2', title: '연말 포장 상자', quote: '연말 꽃다발 포장 상자가 모자랍니다.', points: [{ text: '포장 상자가 모자라 더 주문해야 함', quote: '상자를 더 주문해야 합니다.' }] },
  ],
  decisions: [{ text: '수요일 출고분은 목요일로 미룬다', topic: 't1', quote: '수요일 출고분은 목요일로 미루는 것으로 정합시다.' }],
  actions: [
    { text: '거래처 안내 문자 보내기', owner: '연습 대리', due: '금요일까지', topic: 't1', quote: '거래처 안내 문자는 제가 금요일까지 보내겠습니다.' },
    { text: '포장 상자 견적 받기', owner: '', due: '', topic: 't2', quote: '상자 견적은 누가 받을지 정하지 못했습니다.' },
  ],
  questions: [{ text: '포장 상자 규격을 무엇으로 할지', topic: 't2', quote: '상자 규격은 아직 못 정했으니 다음 회의에서 다시 봅시다.' }],
  relations: [],
};

async function main() {
  fs.mkdirSync('.verify/meetings-shots', { recursive: true });
  const registry = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  if (!registry.workflows.some(workflow => workflow.id === ID)) { registry.workflows.push(ENTRY); fs.writeFileSync(CONFIG, JSON.stringify(registry, null, 2) + '\n'); }
  const { boardFromExtraction, boardCounts } = await import('../lib/meetingBoard.js');
  const listener = net.createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve)); const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  const base = `http://localhost:${port}`, secret = crypto.randomUUID(), log = fs.openSync('.verify/meetings-guide-server.log', 'w');
  const server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '--webpack', '-p', String(port)], { env: { ...process.env, DB_SERVER: '', JWT_SECRET: secret, ANTHROPIC_API_KEY: '', PROFIT_REPORT_WEEKLY_SCHEDULER_DISABLED: '1' }, stdio: ['ignore', log, log], windowsHide: true }); fs.closeSync(log);
  let browser;
  try {
    for (let n = 0; n < 120; n++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch {} if (n === 119) throw Error('Local server startup failed'); await new Promise(resolve => setTimeout(resolve, 1000)); }
    browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox'] });
    const page = await browser.newPage(); await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 }); page.setDefaultTimeout(30000);
    const pageErrors = []; page.on('pageerror', error => pageErrors.push(String(error)));
    const user = { userId: 'guide', userName: '연습 담당자', authority: 1, deptName: '영업', accountActive: true };
    await page.setCookie({ name: 'nenovaToken', value: jwt.sign(user, secret, { expiresIn: '1h' }), url: base });
    const downloadDir = path.resolve('.verify/meetings-shots', crypto.randomUUID()); fs.mkdirSync(downloadDir, { recursive: true });
    const cdp = await page.createCDPSession(); await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });

    // 연습용 응답(메모리 안에서만 저장)
    const saved = new Map();
    const summary = meeting => ({ id: meeting.id, title: meeting.title, date: meeting.date, attendees: meeting.attendees, shared: meeting.shared, ownerName: user.userName, mine: true, canEdit: true, createdAt: meeting.createdAt, updatedAt: meeting.updatedAt, deletedAt: null, revision: meeting.revision, counts: boardCounts(meeting.board), sourceLength: meeting.sourceText.length });
    await page.setRequestInterception(true);
    page.on('request', async request => {
      const url = new URL(request.url());
      if (url.protocol === 'blob:' || url.protocol === 'data:') return request.continue();
      if (url.origin !== base) return request.abort();
      if (!url.pathname.startsWith('/api/')) return request.continue();
      let data = { success: true, items: [], rows: [], user };
      if (url.pathname === '/api/work/meetings') {
        const body = request.method() === 'POST' ? JSON.parse(request.postData() || '{}') : null;
        if (!body && url.searchParams.get('id')) { const meeting = saved.get(url.searchParams.get('id')); data = { success: true, meeting: { ...summary(meeting), sourceText: meeting.sourceText, board: meeting.board } }; }
        else if (!body) data = { success: true, meetings: [...saved.values()].map(summary) };
        else if (body.action === 'organize') { await new Promise(resolve => setTimeout(resolve, 1800)); data = { success: true, board: boardFromExtraction(EXTRACTION, body.sourceText), suggestedTitle: EXTRACTION.title }; }
        else if (body.action === 'save') {
          const stamp = '2026-11-16T01:00:00.000Z', id = body.id || crypto.randomUUID();
          const meeting = { id, title: body.title || '연습 회의', date: body.date, attendees: body.attendees, sourceText: body.sourceText, board: body.board, shared: !!body.shared, createdAt: stamp, updatedAt: stamp, revision: (saved.get(id)?.revision || 0) + 1 };
          saved.set(id, meeting); data = { success: true, meeting: { ...summary(meeting), sourceText: meeting.sourceText, board: meeting.board } };
        }
      }
      await request.respond({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(data) });
    });

    await page.goto(base + '/work/meetings', { waitUntil: 'networkidle0', timeout: 180000 });
    await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
    await page.waitForSelector('[data-act="new"]', { visible: true });
    const rec = dry ? { chapter() {}, caption: async () => {}, focus: async () => {}, unfocus: async () => {}, pause: ms => new Promise(resolve => setTimeout(resolve, Math.min(ms, 250))), stop: async () => ({}) }
      : await createWorkflowGuideRecorder(page, { workflowId: ID, guideId: 'staff', title: ENTRY.title, sourceFiles: ENTRY.sourceFiles, fixtureOnly: true });
    let shot = 0; const snap = async name => { if (dry) await page.screenshot({ path: `.verify/meetings-shots/${String(++shot).padStart(2, '0')}-${name}.png` }); };
    const center = selector => page.$eval(selector, node => node.scrollIntoView({ block: 'center', inline: 'nearest' }));
    const cardId = text => page.evaluate(text => [...document.querySelectorAll('[data-card]')].find(node => node.querySelector('.mtb-text')?.textContent.includes(text))?.dataset.card, text);
    const cardPos = id => page.$eval(`[data-card="${id}"]`, node => ({ left: parseInt(node.style.left, 10), top: parseInt(node.style.top, 10) }));
    const point = async selector => { const box = await (await page.$(selector)).boundingBox(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; };
    const clickAt = async selector => { const at = await point(selector); await page.mouse.move(at.x, at.y, { steps: 12 }); await rec.pause(500); await page.mouse.down(); await page.mouse.up(); };
    async function step(number, scenario, label, text, selector, action, after) {
      await page.waitForSelector(selector, { visible: true }); await center(selector);
      const title = `${number}. ${label}`;
      rec.chapter(scenario, title); await rec.caption(`${title} · ${text}`); await rec.pause(2600);
      await rec.focus(selector, number); await action(); await rec.pause(2600); await rec.unfocus();
      if (after) await after();
      await rec.pause(1800); await snap(scenario);
    }

    await snap('list-empty');
    await step(1, 'new', '새 회의 정리 시작', '회의정리 화면에서 [새 회의 정리하기]를 누릅니다.', '[data-act="new"]', async () => { await clickAt('[data-act="new"]'); await page.waitForSelector('#mt-source-text', { visible: true }); });

    await step(2, 'paste', '회의 내용 넣기', '회의록이나 메모, 카톡으로 오간 회의 내용을 그대로 넣습니다. 제목과 참석자는 비워도 됩니다.', '#mt-source-text', async () => {
      await page.click('#mt-source-text'); await page.keyboard.type(SOURCE, { delay: dry ? 0 : 14 });
      assert.equal(await page.$eval('#mt-source-text', node => node.value), SOURCE);
    }, async () => {
      await page.click('[data-field="attendees"]'); await page.keyboard.type('연습 팀장, 연습 대리, 연습 사원', { delay: dry ? 0 : 70 });
    });

    await step(3, 'organize', 'AI로 정리하기', '[정리하기]를 누르면 AI가 내용을 읽고 주제 · 결정 · 할 일 · 남은 질문 쪽지로 나눕니다.', '[data-act="organize"]', async () => {
      await clickAt('[data-act="organize"]'); await page.waitForSelector('[data-card]', { visible: true });
    }, async () => {
      await page.waitForFunction(() => !document.querySelector('[data-act="save"]')?.disabled); await rec.pause(600);
      await center('[data-board-wrap]');
      assert.equal(await page.$$eval('[data-card]', nodes => nodes.length), 9);
      assert.equal(await page.$eval('[data-field="title"]', node => node.value), '연습 주간 회의');
      await rec.caption('3. AI로 정리하기 · 한 장의 보드가 만들어졌습니다. 담당자와 기한이 분명하지 않은 할 일은 "확인 필요"로 표시됩니다.'); await rec.pause(4200);
    });

    const actionId = await cardId('포장 상자 견적 받기'); assert(actionId);
    await page.click(`[data-card="${actionId}"] .mtb-kind`); await page.waitForSelector(`[data-card="${actionId}"] [data-act="edit"]`);
    await step(4, 'edit', '쪽지 고치기', '쪽지를 누르고 [고치기]로 글과 담당자, 기한을 고칩니다. 여기서는 비어 있던 담당자를 채웁니다.', `[data-card="${actionId}"]`, async () => {
      await clickAt(`[data-card="${actionId}"] [data-act="edit"]`);
      const owner = `[data-card="${actionId}"] .mtb-edit-row label:first-child input`; await page.waitForSelector(owner, { visible: true });
      await page.click(owner); await page.keyboard.type('연습 사원', { delay: dry ? 0 : 140 }); await rec.pause(900);
      await clickAt(`[data-card="${actionId}"] [data-act="apply"]`);
      await page.waitForFunction(id => document.querySelector(`[data-card="${id}"] .mtb-meta`)?.textContent.includes('담당 연습 사원'), {}, actionId);
    });

    const questionId = await cardId('포장 상자 규격'); assert(questionId); const before = await cardPos(questionId);
    await step(5, 'move', '쪽지 옮기기', '쪽지를 잡고 끌어서 보기 좋은 자리로 옮깁니다. 이어진 선도 함께 따라옵니다.', `[data-card="${questionId}"]`, async () => {
      const at = await point(`[data-card="${questionId}"] .mtb-kind`);
      await page.mouse.move(at.x, at.y, { steps: 10 }); await rec.pause(400); await page.mouse.down();
      await page.mouse.move(at.x - 20, at.y + 150, { steps: dry ? 5 : 45 }); await rec.pause(300); await page.mouse.up();
      const moved = await cardPos(questionId); assert.equal(moved.top, before.top + 150); assert.equal(moved.left, before.left - 20);
    });

    const decisionId = await cardId('목요일로 미룬다'); assert(decisionId);
    await page.click(`[data-card="${decisionId}"] .mtb-kind`); await page.waitForSelector(`[data-card="${decisionId}"] [data-act="source"]`);
    await step(6, 'source', '원문에서 확인하기', '[원문 보기]를 누르면 이 쪽지가 회의 내용의 어느 문장에서 나왔는지 보여 줍니다.', `[data-card="${decisionId}"]`, async () => {
      await clickAt(`[data-card="${decisionId}"] [data-act="source"]`); await page.waitForSelector('.mt-drawer mark', { visible: true });
      assert.equal(await page.$eval('.mt-drawer mark', node => node.textContent), '수요일 출고분은 목요일로 미루는 것으로 정합시다.');
    }, async () => {
      await rec.caption('6. 원문에서 확인하기 · 오른쪽에 회의 내용이 열리고 근거 문장이 색으로 표시됩니다. [닫기]나 Esc로 닫습니다.'); await rec.pause(4200); await snap('source-open');
      await page.keyboard.press('Escape'); await page.waitForSelector('.mt-drawer', { hidden: true });
    });

    await step(7, 'save', '저장하기', '[저장하기]를 누르면 보드와 회의 내용이 함께 저장됩니다.', '[data-act="save"]', async () => {
      await clickAt('[data-act="save"]'); await page.waitForSelector('[data-notice="ok"]', { visible: true });
      assert.equal(saved.size, 1); const meeting = [...saved.values()][0];
      assert.equal(meeting.board.cards.find(card => card.id === actionId).owner, '연습 사원');
    });

    await step(8, 'export', '그림으로 받기', '[그림으로 받기]를 누르면 보드 한 장이 그림 파일로 내려받아집니다. 인쇄는 [인쇄하기]를 누릅니다.', '[data-act="png"]', async () => {
      await clickAt('[data-act="png"]');
      let file; for (let n = 0; n < 60 && !file; n++) { file = fs.readdirSync(downloadDir).find(name => name.endsWith('.png')); if (!file) await new Promise(resolve => setTimeout(resolve, 100)); }
      assert(file, 'PNG 파일이 내려받아져야 한다'); assert(fs.statSync(path.join(downloadDir, file)).size > 20000);
      if (dry) fs.copyFileSync(path.join(downloadDir, file), '.verify/meetings-shots/export.png');
    });

    await clickAt('[data-act="back"]'); await page.waitForSelector('[data-meeting] [data-act="open"]', { visible: true }); await rec.pause(1200);
    await step(9, 'reopen', '목록에서 다시 열기', '[목록으로 가기]로 나오면 저장한 회의가 보입니다. [열기]를 누르면 고친 그대로 다시 열립니다.', '[data-meeting] [data-act="open"]', async () => {
      await clickAt('[data-meeting] [data-act="open"]'); await page.waitForSelector('[data-card]', { visible: true });
    }, async () => {
      const reopened = await cardPos(questionId); assert.deepEqual(reopened, { left: before.left - 20, top: before.top + 150 });
      assert.equal(await page.$$eval('[data-card]', nodes => nodes.length), 9);
      await center('[data-board-wrap]'); await rec.caption('9. 목록에서 다시 열기 · 옮긴 자리와 고친 글이 그대로 열렸습니다.'); await rec.pause(3600);
    });
    assert.deepEqual(pageErrors, []);
    const result = await rec.stop();
    if (!dry) {
      const latest = JSON.parse(fs.readFileSync(CONFIG, 'utf8')), index = latest.workflows.findIndex(workflow => workflow.id === ID);
      latest.workflows[index] = { ...ENTRY, guides: [{ ...ENTRY.guides[0], status: 'ready', chapters: result.chapters }] };
      fs.writeFileSync(CONFIG, JSON.stringify(latest, null, 2) + '\n');
    }
    console.log(`PASS work-meetings guide ${dry ? '(dry-run)' : `recorded ${result.duration}s`}`);
  } finally { await browser?.close(); if (server.pid && server.exitCode === null) spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
