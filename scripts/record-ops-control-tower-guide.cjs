// Actual local /ops UI with a synthetic admin session. Every API is intercepted and every
// non-local request is blocked, so no ERP/Orbit connection or write can happen.
const fs = require('node:fs'), path = require('node:path'), net = require('node:net'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process'), jwt = require('jsonwebtoken'), puppeteer = require('puppeteer-core');
const { createWorkflowGuideRecorder } = require('./lib/workflow-guide-recorder.cjs');
const dry = process.argv.includes('--dry-run'), root = process.cwd();
const WORKFLOW = 'ops-control-tower', GUIDE = 'overview';

async function main() {
  fs.mkdirSync(path.join(root, '.verify'), { recursive: true });
  const listener = net.createServer(); await new Promise(r => listener.listen(0, '127.0.0.1', r));
  const port = listener.address().port; await new Promise(r => listener.close(r));
  const secret = crypto.randomUUID(), base = 'http://127.0.0.1:' + port, log = fs.openSync('.verify/ops-guide-server.log', 'w');
  // ORBIT_OWNER_TOKEN is blanked on purpose: the page then renders its sample cards only and never embeds live Orbit screens.
  const server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '-p', String(port)], { env: { ...process.env, DB_SERVER: '', JWT_SECRET: secret, ORBIT_OWNER_TOKEN: '' }, stdio: ['ignore', log, log], windowsHide: true });
  fs.closeSync(log); let browser;
  try {
    for (let i = 0; i < 90; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch {} if (i === 89) throw Error('UI server unavailable'); await new Promise(r => setTimeout(r, 1000)); }
    browser = await puppeteer.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox'] });
    const page = await browser.newPage(); page.setDefaultTimeout(20000); page.on('pageerror', e => console.log('UI ERROR', e.message));
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    const cookie = userId => page.setCookie({ name: 'nenovaToken', value: jwt.sign({ userId, userName: '연습 관리자', authority: 4, accountActive: true }, secret, { expiresIn: '1h' }), url: base });
    let external = 0, writes = 0;
    await page.setRequestInterception(true); page.on('request', req => {
      const u = new URL(req.url());
      if (!['127.0.0.1', 'localhost'].includes(u.hostname)) { external++; return req.abort(); }
      if (!u.pathname.startsWith('/api/')) return req.continue();
      if (req.method() !== 'GET') writes++;
      const body = { success: true, items: [], rows: [], data: [] };
      if (u.pathname === '/api/auth/me') body.user = { userId: 'nenovaSS3', userName: '연습 관리자', authority: 4, deptName: '경영지원', accountActive: true };
      return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });

    // Gate check first: a non-admin account must get the 404 page, not the control tower.
    await cookie('guide-staff');
    const denied = await page.goto(base + '/ops', { waitUntil: 'networkidle0', timeout: 120000 });
    assert.equal(denied.status(), 404, 'non-admin must receive 404');
    assert(!(await page.evaluate(() => document.body.innerText)).includes('운영 관제탑'), 'non-admin must not see the page');

    await cookie('nenovaSS3');
    const ok = await page.goto(base + '/ops', { waitUntil: 'networkidle0', timeout: 120000 });
    assert.equal(ok.status(), 200);
    await page.waitForFunction(() => document.querySelector('h1')?.innerText.includes('운영 관제탑'));
    const text = await page.evaluate(() => document.body.innerText);
    for (const label of ['업무 흐름 9단계', '전산 실제 처리 요약', '병목 · 이상', '부서별 현황', '솔루션 판매 파이프라인', '샘플 · 실데이터 아님']) assert(text.includes(label), 'missing section: ' + label);
    assert.equal(await page.$$eval('.f9', nodes => nodes.length), 9, 'nine flow steps');
    assert.equal(await page.$$eval('iframe', nodes => nodes.length), 0, 'fixture run must not embed live Orbit screens');
    console.log('page ready', new URL(page.url()).pathname);

    const rec = dry ? null : await createWorkflowGuideRecorder(page, { workflowId: WORKFLOW, guideId: GUIDE, title: '운영 관제탑 한눈에 보기', sourceFiles: ['pages/ops.js'], fixtureOnly: true });
    const say = async (text, ms = 5000) => { if (rec) { await rec.caption(text); await rec.pause(ms); } };
    const show = async heading => {
      const box = await page.evaluate(heading => {
        const h = [...document.querySelectorAll('.ops h2')].find(node => node.innerText.trim() === heading);
        const card = h.closest('.card'); card.scrollIntoView({ block: 'start' }); window.scrollBy(0, -70);
        const r = h.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, heading);
      await page.mouse.move(box.x, box.y, { steps: 12 });
    };

    rec?.chapter('overview', '화면 구성 한눈에 보기');
    await say('운영 관제탑은 관리자 계정만 열 수 있는 읽기 전용 화면입니다.\n다른 계정으로 주소를 열면 "없는 페이지"로 보입니다.');
    await show('업무 흐름 9단계');
    await say('맨 위는 발주부터 이익까지 9단계 업무 흐름입니다.\n단계마다 담당 부서와 오늘 처리 건수가 보입니다.');
    await show('전산 실제 처리 요약');
    await say('전산 실제 처리 요약은 직원별 저장 건수, 일치율, 변경없음 건수를 보여 줍니다.');
    await show('병목 · 이상');
    await say('병목 · 이상 칸은 색으로 급한 정도를 구분합니다.\n빨강은 조치 필요, 노랑은 주의, 초록은 정상입니다.');
    await show('부서별 현황');
    await say('부서별 현황은 부서마다 담당자와 오늘 처리량, 집중하고 있는 업무를 보여 줍니다.');

    rec?.chapter('sample-data', '샘플 표시와 실데이터 구분');
    await page.evaluate(() => window.scrollTo(0, 0));
    const tag = await page.$('.ops-note .badge'); const tb = await tag.boundingBox();
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 12 });
    await say('"샘플 · 실데이터 아님" 표시가 붙은 칸의 숫자는 모양 확인용 예시입니다.\n실제 수치로 판단하면 안 됩니다.', 5500);
    await say('"실데이터" 표시가 붙은 칸만 실제 전산 처리 화면입니다.\n연습 화면에서는 실제 화면을 연결하지 않아 안내 문구만 보입니다.', 5500);
    await show('솔루션 판매 파이프라인');
    await say('솔루션 판매 파이프라인은 자리만 잡아 둔 "준비 중" 칸입니다.\n이 화면에서는 입력하거나 저장하는 기능이 없습니다.', 5500);

    assert.equal(writes, 0, 'guide must not issue write requests');
    if (rec) {
      const result = await rec.stop();
      const file = 'config/workflow-guides.json', registry = JSON.parse(fs.readFileSync(file, 'utf8'));
      const guide = registry.workflows.find(w => w.id === WORKFLOW).guides.find(g => g.id === GUIDE);
      guide.status = 'ready'; guide.chapters = result.chapters;
      fs.writeFileSync(file, JSON.stringify(registry, null, 2) + '\n');
    }
    console.log(JSON.stringify({ passed: true, dry, nonAdminStatus: 404, blockedExternalRequests: external, productionWrites: writes }));
  } finally { await browser?.close(); server.kill(); }
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; });
