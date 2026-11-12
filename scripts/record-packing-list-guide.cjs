// 수입부 "패킹리스트 만들기(인보이스 → 입고용 엑셀)" 가이드 녹화. 실제 /import/tools?popup=1 의 Packing List 화면을 로컬에서 띄우고
// 모든 API 를 연습용 자료로 가로챈다. 외부 요청은 전부 막는다 → 전산(ERP) 연결·저장·입고 등록이 일어나지 않는다.
// 단계 번호·제목은 data/import-handover.json 의 글 매뉴얼과 같은 것을 쓴다(record-product-new-guide.cjs 와 같은 방식).
const fs = require('node:fs'), path = require('node:path'), net = require('node:net'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process'), jwt = require('jsonwebtoken'), puppeteer = require('puppeteer-core');
const { createWorkflowGuideRecorder } = require('./lib/workflow-guide-recorder.cjs');
const dry = process.argv.includes('--dry-run'), root = process.cwd();
const WORKFLOW = 'packing-list-from-invoice', GUIDE = 'import';

// 연습용 자료(실제 농장·품목·단가 아님). 콜롬비아 인보이스 한 건, 10줄.
// [인보이스에 적힌 품명, 상자 수, 상자당 송이, 단당 송이, 송이 단가(USD), 길이]
const LINES = [
  ['ROSE FREEDOM 50CM', 4, 100, 25, 0.22, 50], ['ROSE EXPLORER 50CM', 3, 100, 25, 0.25, 50], ['ROSE MONDIAL 50CM', 2, 100, 25, 0.24, 50],
  ['ROSE VENDELA 60CM', 2, 100, 25, 0.28, 60], ['ROSE PINK FLOYD 60CM', 3, 100, 25, 0.30, 60], ['ROSE TIBET 60CM', 1, 100, 25, 0.26, 60],
  ['CARNATION MOONLIGHT', 5, 300, 20, 0.12, 0], ['CARNATION NOVA', 2, 300, 20, 0.13, 0],
  ['CANDLELIGHT ROSE 50 CM', 2, 100, 25, 0.27, 50], ['DEEP PURPLE ROSE 60 CM', 2, 100, 25, 0.29, 60],
];
const money = n => Math.round(n * 100) / 100;
const TOTAL_STEMS = LINES.reduce((s, l) => s + l[1] * l[2], 0), TOTAL_USD = money(LINES.reduce((s, l) => s + money(l[1] * l[2] * l[4]), 0));
const STEMS_TEXT = TOTAL_STEMS.toLocaleString('ko-KR'), USD_TEXT = TOTAL_USD.toLocaleString('en-US');
// 전산 품목과 이름이 같지 않아 사람이 연결해야 하는 두 줄(하나는 후보를 바로 고르고, 하나는 검색어로 좁힌다).
const UNCONFIRMED = [
  { desc: 'CANDLELIGHT ROSE 50 CM', pick: 99201, search: null },
  { desc: 'DEEP PURPLE ROSE 60 CM', pick: 99203, search: 'DEEP PURPLE' },
];
const ERP = [
  [99101, 'ROSE FREEDOM 50CM', '장미'], [99102, 'ROSE EXPLORER 50CM', '장미'], [99103, 'ROSE MONDIAL 50CM', '장미'], [99104, 'ROSE VENDELA 60CM', '장미'],
  [99105, 'ROSE PINK FLOYD 60CM', '장미'], [99106, 'ROSE TIBET 60CM', '장미'], [99107, 'CARNATION MOONLIGHT', '카네이션'], [99108, 'CARNATION NOVA', '카네이션'],
  [99201, 'ROSE CANDLELIGHT 50CM', '장미'], [99202, 'ROSE CANDLELIGHT 60CM', '장미'], [99203, 'ROSE DEEP PURPLE 60CM', '장미'], [99204, 'ROSE DEEP PURPLE 70CM', '장미'],
].map(([key, name, flower]) => ({ ProdKey: key, ProdName: name, ProdCode: 'PRAC-' + key, FlowerName: flower, CounName: '콜롬비아', country: 'CO', selectable: true, legacyExportSafe: true }));
const FILE_NAME = '46-1 연습 농장 인보이스.pdf', INVOICE_NO = 'PRAC-046';

async function main() {
  const { upsertPackingErpMatch } = await import('../lib/importPackingErpMatches.js');
  const manual = JSON.parse(fs.readFileSync(path.join(root, 'data/import-handover.json'), 'utf8')).manuals.find(m => m.id === WORKFLOW);
  assert(manual, 'data/import-handover.json 에 패킹리스트 만들기 매뉴얼이 있어야 함');
  const registry = JSON.parse(fs.readFileSync(path.join(root, 'config/workflow-guides.json'), 'utf8'));
  const workflow = registry.workflows.find(w => w.id === WORKFLOW);
  assert(workflow, 'config/workflow-guides.json 에 ' + WORKFLOW + ' 등록 필요');
  assert.equal(manual.steps.length, workflow.requiredScenarios.length, '글 단계 수 = 영상 시나리오 수');

  fs.mkdirSync(path.join(root, '.verify'), { recursive: true });
  const { PDFDocument } = require('pdf-lib'), pdf = await PDFDocument.create(), sheet = pdf.addPage([612, 792]);
  sheet.drawText(`PRACTICE FARM / INVOICE ${INVOICE_NO} / 10 lines / USD ${TOTAL_USD.toFixed(2)}`, { x: 35, y: 730, size: 12 });
  LINES.forEach((l, i) => sheet.drawText(`${l[0]}  ${l[1]} boxes  ${l[1] * l[2]} stems  USD ${money(l[1] * l[2] * l[4]).toFixed(2)}`, { x: 35, y: 700 - i * 18, size: 10 }));
  const dummy = path.join(root, '.verify', FILE_NAME); fs.writeFileSync(dummy, await pdf.save());
  const downloads = path.join(root, '.verify', 'packing-guide-downloads'); fs.rmSync(downloads, { recursive: true, force: true }); fs.mkdirSync(downloads, { recursive: true });

  const invoice = { farm: '연습 농장', supplier: '연습 농장', invoice: INVOICE_NO, currency: 'USD', date: '2026-11-06', invoice_total: TOTAL_USD, freight_total: 0,
    products: LINES.map((l, i) => ({ description: l[0], pcs: l[1], steam_box: l[2], bunch_st: l[3], total_stems: l[1] * l[2], u_price: l[4], t_price: money(l[1] * l[2] * l[4]), stem_length: l[5] || undefined, source_page: 1, source_row: i + 1 })) };
  const payload = { content: [{ type: 'text', text: JSON.stringify({ invoices: [invoice] }) }], stop_reason: 'end_turn', source: 'ai' };

  const listener = net.createServer(); await new Promise(r => listener.listen(0, '127.0.0.1', r));
  const port = listener.address().port; await new Promise(r => listener.close(r));
  const secret = crypto.randomUUID(), base = 'http://127.0.0.1:' + port, log = fs.openSync('.verify/packing-list-guide-server.log', 'w');
  const server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '-p', String(port)], { env: { ...process.env, DB_SERVER: '', JWT_SECRET: secret }, stdio: ['ignore', log, log], windowsHide: true });
  fs.closeSync(log); let browser;
  try {
    for (let i = 0; i < 90; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch {} if (i === 89) throw Error('UI server unavailable'); await new Promise(r => setTimeout(r, 1000)); }
    browser = await puppeteer.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox'] });
    const page = await browser.newPage(); page.setDefaultTimeout(20000); page.on('pageerror', e => console.log('UI ERROR', e.message));
    page.on('dialog', d => { console.log('DIALOG', d.message()); d.accept(); });
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await page.setCookie({ name: 'nenovaToken', value: jwt.sign({ userId: 'guide-import', userName: '연습 담당자', authority: 4, accountActive: true }, secret, { expiresIn: '1h' }), url: base });
    const cdp = await page.createCDPSession(); await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true });

    let external = 0, parseCalls = 0, matchRevision = 0, matchValue = { version: 1, entries: [] }; const saved = [], otherApi = [];
    await page.setRequestInterception(true); page.on('request', req => {
      const u = new URL(req.url());
      if (!/^https?:$/.test(u.protocol)) return req.continue(); // data:/blob: 은 화면 안의 그림·내려받기 자료
      if (!['127.0.0.1', 'localhost'].includes(u.hostname)) { external++; console.log('BLOCKED EXTERNAL', req.url().slice(0, 120)); return req.abort(); }
      if (!u.pathname.startsWith('/api/')) return req.continue();
      let body = { success: true, products: [], value: null, revision: 0, items: [], rows: [], history: [], data: [] }, status = 200;
      if (u.pathname === '/api/auth/me') body.user = { userId: 'guide-import', userName: '연습 담당자', authority: 4, deptName: '수입부', accountActive: true };
      if (u.pathname === '/api/import/tools/product-matches') {
        if (req.method() === 'POST') {
          const b = JSON.parse(req.postData() || '{}'); assert.equal(b.expectedRevision, matchRevision);
          matchValue = upsertPackingErpMatch(matchValue, b, ERP); matchRevision++; saved.push(b);
        }
        body = { success: true, value: matchValue, revision: matchRevision, products: ERP };
      } else if (u.pathname === '/api/import/tools/parse-pdf') {
        const b = JSON.parse(req.postData() || '{}');
        if (b.cacheOnly) { status = 404; body = { error: 'No cached document' }; } else { parseCalls++; body = payload; }
      } else if (u.pathname.startsWith('/api/import/') && u.pathname !== '/api/import/tools/upload-history') otherApi.push(req.method() + ' ' + u.pathname);
      return req.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
    });

    const ok = await page.goto(base + '/import/tools?popup=1', { waitUntil: 'networkidle0', timeout: 120000 });
    assert.equal(ok.status(), 200);
    await page.waitForSelector('button[aria-label="콜롬비아"]');
    console.log('page ready', new URL(page.url()).pathname);
    await page.screenshot({ path: '.verify/packing-list-guide-start.png' });

    const rec = dry ? null : await createWorkflowGuideRecorder(page, { workflowId: WORKFLOW, guideId: GUIDE, title: '패킹리스트 만들기', sourceFiles: workflow.sourceFiles, fixtureOnly: true });
    let number = 0, shotNo = 0;
    const say = async (text, ms = 6000) => {
      const lines = String(text).split('\n'); assert(lines.length <= 2 && lines.every(l => l.length <= 54), `자막은 2줄·줄당 54자 이하: ${text}`);
      if (rec) { await rec.caption(`${number}. ${manual.steps[number - 1].title}\n${text}`); await rec.pause(ms); }
    };
    const step = async (text, ms = 6500) => {
      const s = manual.steps[number]; number++;
      assert.equal(s.no, number);
      rec?.chapter(workflow.requiredScenarios[number - 1], `${number}. ${s.title}`);
      await say(text, ms);
    };
    // 화면 요소에 녹화용 이름표만 붙인다(모양·동작은 그대로).
    const tag = async (id, finder, arg) => {
      const found = await page.evaluate((id, finder, arg) => {
        const node = finder === 'css' ? document.querySelector(arg)
          : finder === 'text' ? [...document.querySelectorAll(arg[0])].find(n => n.innerText.trim() === arg[1])
          : finder === 'button' ? [...document.querySelectorAll('button')].find(b => b.innerText.trim().startsWith(arg)) : null;
        if (!node) return false; node.setAttribute('data-guide-id', id); return true;
      }, id, finder, arg);
      assert(found, `화면에서 찾지 못함: ${finder} ${JSON.stringify(arg)}`);
      return `[data-guide-id="${id}"]`;
    };
    // 표가 화면 맨 아래쪽에 있으면 가운데로 올릴 수 없다 → 화면에 보이지 않는 여백만 아래에 둔다(내용·동작은 그대로).
    await page.evaluate(() => { const s = document.createElement('div'); s.id = 'guide-bottom-space'; s.style.cssText = 'height:700px;flex:none'; document.body.append(s); });
    // 입고 작업 화면은 이 영상의 범위 밖이고 연습 자료로는 채울 수 없어, 녹화 중에는 그 영역의 내용을 비워 둔다.
    await page.addStyleTag({ content: '#packing-receipt-stage > * { visibility: hidden !important; }' });
    // 확대 대상: 화면 y 70~900 안, 확대창(약 1370×590) 안에 들어와야 글자가 잘리지 않는다.
    // 읽는 칸은 마우스 표시를 칸 바깥 옆으로 비켜 두고, 누를 버튼은 글자가 없는 가장자리를 누른다.
    const focus = async (selector, { click = false, fx = 0.9, fy = 0.5 } = {}) => {
      await page.$eval(selector, n => n.scrollIntoView({ block: 'center', behavior: 'instant' }));
      // 화면 가득 찬 줄은 글이 왼쪽에만 있어 중앙 확대 시 잘린다 → 녹화 중에만 칸 너비를 글 크기에 맞춘다(내용·동작은 그대로).
      const measure = () => page.$eval(selector, n => { const b = n.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
      let r = await measure();
      if (r.w > 1340) { await page.$eval(selector, n => { n.style.width = 'fit-content'; n.style.maxWidth = '100%'; }); r = await measure(); }
      const cy = r.y + r.h / 2;
      if (!(cy >= 70 && cy <= 900)) await page.screenshot({ path: '.verify/packing-list-guide-error.png' });
      assert(cy >= 70 && cy <= 900, `확대 범위 밖: ${selector} ${JSON.stringify(r)}`);
      assert(r.w <= 1340 && r.h <= 560, `확대창보다 큼(글자 잘림): ${selector} ${JSON.stringify(r)}`);
      const p = click ? { x: r.x + r.w * fx, y: r.y + r.h * fy } : (r.x + r.w + 40 < 1900 ? { x: r.x + r.w + 40, y: cy } : { x: Math.max(8, r.x - 40), y: cy });
      await page.mouse.move(p.x, p.y, { steps: 14 });
      if (process.env.GUIDE_SHOTS) { // 점검용: 1.4배 확대창이 비추는 범위(약 1371×593)를 그대로 찍는다
        const ww = 1371, hh = 593, cx = r.x + r.w / 2, x0 = Math.max(0, Math.min(1920 - ww, cx - ww / 2)), y0 = Math.max(70, Math.min(900 - hh, cy - hh / 2));
        fs.mkdirSync('.verify/zoom-check', { recursive: true });
        await page.screenshot({ path: `.verify/zoom-check/s${number}-${String(++shotNo).padStart(2, '0')}.png`, clip: { x: x0, y: y0, width: ww, height: hh } });
      }
      if (rec) { await rec.pause(1000); await rec.focus(selector, number); }
      return p;
    };
    const press = async (selector, opts = {}) => { const p = await focus(selector, { ...opts, click: true }); await page.mouse.click(p.x, p.y); };
    const out = async (ms = 0) => { if (rec) { if (ms) await rec.pause(ms); await rec.unfocus(); } await page.mouse.move(1880, 520, { steps: 6 }); };
    const results = '[data-testid="packing-results"]';
    const resultStatus = () => page.$eval(results + ' p[role="status"]', n => n.innerText.replace(/\s+/g, ' '));
    const pageText = () => page.evaluate(() => document.body.innerText);
    const downloadReady = () => page.waitForFunction(() => [...document.querySelectorAll('[data-testid="packing-results"] article header button')].some(b => b.innerText.includes('⬇ 다운로드') && !b.disabled));

    // 1. 나라 고르기
    await step('인보이스를 보낸 농장의 나라(콜롬비아) 버튼을 찾아 누릅니다.\n나라마다 읽는 규칙이 달라 잘못 고르면 값이 틀립니다.');
    await press('button[aria-label="콜롬비아"]', { fx: 0.9, fy: 0.9 });
    await page.waitForSelector('input[type="file"][accept=".pdf"]');
    await out();
    await say('콜롬비아의 "인보이스 업로드" 화면으로 바뀌었습니다.\n다음 단계에서 이 칸에 PDF 를 올립니다.', 3000);
    await focus(await tag('uploadTitle', 'text', ['div', '인보이스 업로드 (PDF)']));
    await out(2500);

    // 2. 인보이스 PDF 올리기
    await step('파일 이름에 차수 번호(46-1)가 있는지 보고, 칸을 눌러 PDF 를 올립니다.\n파일 이름의 차수가 결과 엑셀의 차수가 됩니다.');
    const zone = '[role="button"][aria-label*="인보이스"]';
    const chooserPromise = page.waitForFileChooser();
    await press(zone, { fx: 0.95, fy: 0.85 });
    const chooser = await chooserPromise; await chooser.accept([dummy]);
    await page.waitForFunction(n => document.body.innerText.includes(n), {}, FILE_NAME);
    await out();
    await say('올리면 파일 이름과 크기가 나오고, 곧바로 읽기가 시작됩니다.\n읽기가 끝나면 아래 안내가 "DB 매칭 미리보기"로 바뀝니다.', 3000);
    await page.evaluate(n => { [...document.querySelectorAll('div')].filter(d => d.innerText.includes(n) && d.innerText.includes('제거')).pop().setAttribute('data-guide-id', 'fileBox'); }, FILE_NAME);
    await focus('[data-guide-id="fileBox"]');
    await out();
    await page.waitForFunction(() => /DB 매칭 미리보기 10행/.test(document.body.innerText));
    await focus(await tag('analysisStatus', 'css', '[role="status"][aria-live="polite"]'));
    await out(3000);
    assert.equal(parseCalls, 1, '읽기 요청은 한 번(가로챈 연습 응답)');

    // 3. 읽힌 값 확인
    await step('농장 이름, 인보이스 번호, 행 수, 송이 합계, 원본 합계를 원문과 비교합니다.\n여기서 읽힌 값이 그대로 입고용 엑셀이 됩니다.', 7000);
    const head = await tag('resultHead', 'css', results + ' article header > div:first-child');
    const headText = await page.$eval(head, n => n.innerText.replace(/\s+/g, ' '));
    assert(headText.includes('연습 농장') && headText.includes(INVOICE_NO), '농장·인보이스 번호가 읽혀야 함: ' + headText);
    assert(headText.includes('10행'), '행 수 10: ' + headText);
    assert(headText.includes('송이 합계 ' + STEMS_TEXT + '송이'), `송이 합계 ${TOTAL_STEMS}: ` + headText);
    assert(headText.includes('송장 총액 ' + USD_TEXT + ' USD') && headText.includes('상품 ' + USD_TEXT + ' USD'), `상품·송장 총액 ${TOTAL_USD}: ` + headText);
    await focus(head);
    await out(4000);
    const counts0 = await resultStatus();
    console.log('before matching:', counts0);
    assert(/유사 1 · 미매칭 1 · 매칭 확인 2건/.test(counts0), '미확인 품종 2건: ' + counts0);
    await say('맨 위 줄은 정확·유사·미매칭 개수입니다. 확인할 줄이 2건 남았습니다.\n숫자가 틀리면 「인식값 수정」에서 원문 PDF 를 보며 고칩니다.', 4500);
    await focus(await tag('counts', 'css', results + ' p[role="status"]'));
    await out(3500);

    // 4. 미확인 품종 연결
    await step('미확인 줄의 품목 이름을 눌러 전산 품목 창을 엽니다.\n인보이스의 품종·길이와 후보를 비교해 맞는 것을 고릅니다.');
    let linked = 0;
    for (const item of UNCONFIRMED) {
      const label = `${item.desc} 전산 품목 매칭`;
      assert(await page.$(`[aria-label="${label}"]`), '미확인 줄의 연결 버튼이 보여야 함: ' + item.desc);
      if (linked > 0) await say('다음 미확인 줄도 같은 방법으로 연결합니다.\n이번에는 검색어를 넣어 후보를 좁혀 봅니다.', 3000);
      await press(`[aria-label="${label}"]`, { fx: 0.5, fy: 0.5 });
      await page.waitForSelector('[data-testid="packing-match-dialog"]');
      await out();
      await say(`"원문"이 인보이스에 적힌 이름입니다. 아래 후보의 이름·길이를 비교합니다.\n${item.search ? '후보가 많으면 검색칸에 품종을 넣어 좁힙니다.' : '추천은 확정이 아니므로 이름과 길이를 눈으로 확인합니다.'}`, 4500);
      await focus(await tag('dialogSource', 'css', '[data-testid="packing-match-dialog"] p'));
      await out(2500);
      if (item.search) {
        const box = '[aria-label="전산 품목 검색"]';
        await focus(box, { click: true, fx: 0.97 }); await page.click(box); await page.type(box, item.search, { delay: rec ? 140 : 0 });
        if (rec) await rec.pause(1800);
        await out();
      }
      const cand = `[data-candidate="${item.pick}"]`;
      await page.waitForSelector(cand);
      console.log('후보', item.pick, await page.$eval(cand, n => n.innerText.replace(/\s+/g, ' ')));
      await say('맞는 후보를 누르면 바로 저장되고 창이 닫힙니다.\n이 연결은 팀 공용으로 저장되어 다음 인보이스에도 적용됩니다.', 3500);
      await press(cand, { fx: 0.97, fy: 0.5 });
      await page.waitForFunction(() => !document.querySelector('[data-testid="packing-match-dialog"]'));
      await out();
      linked++;
      assert.equal(matchRevision, linked, '품목 연결 저장 요청 수');
      assert.equal(saved.at(-1).prodKey, item.pick, '연결한 전산 품목 번호');
      assert(JSON.stringify(saved.at(-1)).includes(item.desc), '원문 이름이 저장 요청에 있어야 함: ' + JSON.stringify(saved.at(-1)));
      if (linked < UNCONFIRMED.length) {
        await say('연결한 줄은 "확인 필요" 목록에서 빠지고 남은 개수가 줄었습니다.\n아직 남은 줄이 있으면 같은 방법으로 이어서 연결합니다.', 3000);
        await focus(await tag('counts1', 'css', results + ' p[role="status"]'));
        await out(3000);
      }
    }
    // 마지막 줄을 연결하면 앱이 스스로 「입고 작업」 화면으로 넘어간다(입고 단계 자체는 이 영상의 범위 밖).
    await page.waitForFunction(() => [...document.querySelectorAll('nav[aria-label="인보이스 작업 선택"] button')].find(b => b.innerText.includes('입고 작업'))?.getAttribute('aria-pressed') === 'true');
    await new Promise(r => setTimeout(r, 1800)); // 앱이 입고 작업 위치로 부드럽게 스크롤하는 동안 기다린다
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise(r => setTimeout(r, 500));

    // 5. 합계 확인하고 내려받기
    await step('미확인 품종을 모두 연결하자 화면이 「입고 작업」으로 넘어갔습니다.\n엑셀을 받으려면 위쪽 「파일 · 품목 매칭」 탭으로 돌아옵니다.', 7000);
    await press(await tag('backTab', 'button', '파일 · 품목 매칭'), { fx: 0.95, fy: 0.5 });
    await downloadReady();
    await out();
    const text5 = await pageText();
    assert(!text5.includes('합계 불일치') && !text5.includes('합계가 인보이스와 불일치'), '합계 불일치 안내가 없어야 함');
    assert(!text5.includes('다운로드 차단'), '다운로드 차단 표시가 없어야 함');
    const counts1 = await resultStatus();
    console.log('after matching:', counts1);
    assert(/정확 8 · 팀 공용 수동 2/.test(counts1) && counts1.includes('품목 매칭 완료'), '연결 결과가 개수에 반영돼야 함: ' + counts1);
    await say('맨 위 줄이 "정확 8 · 팀 공용 수동 2 … 품목 매칭 완료"로 바뀌었습니다.\n직접 연결한 2건은 "팀 공용 수동"으로 센 것입니다.', 4000);
    await focus(await tag('counts2', 'css', results + ' p[role="status"]'));
    await out(3500);
    const head2 = await tag('resultHead2', 'css', results + ' article header > div:first-child');
    const head2Text = await page.$eval(head2, n => n.innerText.replace(/\s+/g, ' '));
    console.log('생성된 결과:', head2Text);
    assert(head2Text.includes('송이 합계 ' + STEMS_TEXT + '송이') && head2Text.includes('송장 총액 ' + USD_TEXT + ' USD'), '엑셀 합계가 인보이스와 같아야 함');
    await say('농장 이름·인보이스 번호·송이 합계·송장 총액이 인보이스와 같은지 봅니다.\n빨간 「합계 불일치」 안내가 없으면 합계가 같은 것입니다.', 6000);
    await focus(head2);
    await out(4500);
    const btn = await tag('download', 'css', results + ' article header button');
    assert.equal(await page.$eval(btn, n => n.disabled), false, '다운로드 버튼이 눌러져야 함');
    await say('「⬇ 다운로드」가 잠금(🔒)에서 풀려 눌러집니다. 눌러서 저장합니다.\n파일 이름은 차수·나라·농장·인보이스 번호로 자동으로 붙습니다.', 3500);
    await press(btn, { fx: 0.9, fy: 0.5 });
    let file = null;
    for (let i = 0; i < 40 && !file; i++) { await new Promise(r => setTimeout(r, 500)); file = fs.readdirSync(downloads).find(f => f.endsWith('.xlsx')); }
    assert(file, '다운로드된 .xlsx 가 있어야 함');
    const size = fs.statSync(path.join(downloads, file)).size; assert(size > 2000, '엑셀 크기: ' + size);
    console.log('다운로드 파일:', file, size, 'bytes');
    await out();
    await say('엑셀이 브라우저의 다운로드 폴더에 저장되었습니다.\n저장된 엑셀은 열어서 인보이스 합계와 한 번 더 대조합니다.', 2500);
    await out(5000);

    assert.equal(number, manual.steps.length);
    assert.equal(external, 0, '외부 요청 0');
    // 입고 작업 화면이 스스로 부르는 API 도 모두 연습용 가짜 응답으로 막혀 있다(서버·DB 로 나가지 않음).
    console.log('가로챈 기타 import API:', [...new Set(otherApi)].join(', ') || '없음');
    await page.screenshot({ path: '.verify/packing-list-guide-result.png' });
    if (rec) {
      await rec.pause(2500);
      const result = await rec.stop();
      const guide = workflow.guides.find(g => g.id === GUIDE);
      guide.status = 'ready'; guide.chapters = result.chapters;
      fs.writeFileSync(path.join(root, 'config/workflow-guides.json'), JSON.stringify(registry, null, 2) + '\n');
    }
    console.log(JSON.stringify({ passed: true, dry, steps: number, blockedExternalRequests: external, parseCalls, linkedSaves: saved.length, savedKeys: saved.map(s => s.prodKey), download: file, productionWrites: 0 }));
  } finally { await browser?.close(); server.kill(); }
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; });
