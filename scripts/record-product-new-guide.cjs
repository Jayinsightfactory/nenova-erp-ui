// 수입부 "신규 품목 등록" 가이드 녹화. 실제 /master/products 화면을 로컬에서 띄우고 모든 API 를 연습용 자료로 가로챈다.
// 외부 요청은 전부 막는다 → 전산(ERP) 연결·저장이 일어나지 않는다. 단계 번호·제목은 data/import-handover.json 의 글 매뉴얼과 같은 것을 쓴다.
const fs = require('node:fs'), path = require('node:path'), net = require('node:net'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process'), jwt = require('jsonwebtoken'), puppeteer = require('puppeteer-core');
const { createWorkflowGuideRecorder } = require('./lib/workflow-guide-recorder.cjs');
const dry = process.argv.includes('--dry-run'), root = process.cwd();
const WORKFLOW = 'product-new-registration', GUIDE = 'import';

// 연습용 자료(실제 품목·농장·단가 아님). 인보이스 한 줄을 보고 등록한다는 설정.
// 값의 모양(코드 규칙·이름 규칙·단위)은 실제 등록 기록의 가장 흔한 조합을 따랐다: 콜롬비아 장미 = 단/단, 1박스 10단, 1단 10송이, 1박스 100송이.
const PRACTICE = { name: 'ROSE / Freedom 60cm', country: '콜롬비아', flower: '장미', outUnit: '단', estUnit: '단', bunchOf1Box: '10', steamOf1Bunch: '10', steamOf1Box: '100' };
const row = (key, code, name, extra = {}) => ({ ProdKey: key, ProdCode: code, ProdName: name, DisplayName: null, ProdGroup: null, FlowerName: '장미', CounName: '콜롬비아', CountryFlower: '콜롬비아장미', Cost: 0, OutUnit: '단', EstUnit: '단', BunchOf1Box: 10, SteamOf1Bunch: 10, SteamOf1Box: 100, BoxWeight: null, BoxCBM: null, TariffRate: null, Stock: 0, isDeleted: 0, Descr: null, UsageCount: 0, RecentUsageCount: 0, orderCount: 0, MappingCount: 0, ...extra });

async function main() {
  const manual = JSON.parse(fs.readFileSync(path.join(root, 'data/import-handover.json'), 'utf8')).manuals.find(m => m.id === WORKFLOW);
  assert(manual, 'data/import-handover.json 에 신규 품목 등록 매뉴얼이 있어야 함');
  const registry = JSON.parse(fs.readFileSync(path.join(root, 'config/workflow-guides.json'), 'utf8'));
  const workflow = registry.workflows.find(w => w.id === WORKFLOW);
  assert(workflow, 'config/workflow-guides.json 에 ' + WORKFLOW + ' 등록 필요');
  assert.equal(manual.steps.length, workflow.requiredScenarios.length, '글 단계 수 = 영상 시나리오 수');

  fs.mkdirSync(path.join(root, '.verify'), { recursive: true });
  const listener = net.createServer(); await new Promise(r => listener.listen(0, '127.0.0.1', r));
  const port = listener.address().port; await new Promise(r => listener.close(r));
  const secret = crypto.randomUUID(), base = 'http://127.0.0.1:' + port, log = fs.openSync('.verify/product-new-guide-server.log', 'w');
  const server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '-p', String(port)], { env: { ...process.env, DB_SERVER: '', JWT_SECRET: secret }, stdio: ['ignore', log, log], windowsHide: true });
  fs.closeSync(log); let browser;
  try {
    for (let i = 0; i < 90; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch {} if (i === 89) throw Error('UI server unavailable'); await new Promise(r => setTimeout(r, 1000)); }
    browser = await puppeteer.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox'] });
    const page = await browser.newPage(); page.setDefaultTimeout(20000); page.on('pageerror', e => console.log('UI ERROR', e.message));
    page.on('dialog', d => { console.log('DIALOG', d.message()); d.accept(); });
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await page.setCookie({ name: 'nenovaToken', value: jwt.sign({ userId: 'guide-import', userName: '연습 담당자', authority: 4, accountActive: true }, secret, { expiresIn: '1h' }), url: base });

    const products = [
      row(99001, 'ROS01-CO901', 'ROSE / Freedom 50cm', { DisplayName: '장미 / 프리덤 50CM', Stock: 12 }),
      row(99002, 'ROS01-CO902', 'ROSE / Mondial 50cm', { DisplayName: '장미 / 몬디알 50CM', Stock: 4 }),
      row(99003, 'ROS01-CO903', 'ROSE / Freedom 70cm', { DisplayName: '장미 / 프리덤 70CM' }),
      row(99004, 'CAR01-CO0911', 'CARNATION Honey', { FlowerName: '카네이션', CountryFlower: '콜롬비아카네이션', DisplayName: '카네이션 HONEY', OutUnit: '박스', BunchOf1Box: 15, SteamOf1Bunch: 20, SteamOf1Box: 300 }),
    ];
    let external = 0, saves = 0, savedBody = null;
    await page.setRequestInterception(true); page.on('request', req => {
      const u = new URL(req.url());
      if (!['127.0.0.1', 'localhost'].includes(u.hostname)) { external++; return req.abort(); }
      if (!u.pathname.startsWith('/api/')) return req.continue();
      let body = { success: true, items: [], rows: [], data: [] }, status = 200;
      if (u.pathname === '/api/auth/me') body.user = { userId: 'guide-import', userName: '연습 담당자', authority: 4, deptName: '수입부', accountActive: true };
      if (u.pathname === '/api/master') {
        const entity = u.searchParams.get('entity');
        if (entity === 'codes') body = { success: true, countries: [{ CounName: '콜롬비아' }, { CounName: '중국' }, { CounName: '네덜란드' }], flowers: [{ FlowerName: '장미' }, { FlowerName: '카네이션' }, { FlowerName: '수국' }] };
        if (entity === 'products' && req.method() === 'GET') body = { success: true, data: products };
        if (entity === 'products' && req.method() === 'POST') {
          saves++; savedBody = JSON.parse(req.postData() || '{}');
          const v = savedBody.values || {};
          const saved = row(99010, v.ProdCode || '', v.ProdName, { DisplayName: v.DisplayName || null, FlowerName: v.FlowerName, CounName: v.CounName, CountryFlower: v.CounName + v.FlowerName, OutUnit: v.OutUnit, EstUnit: v.EstUnit, BunchOf1Box: Number(v.BunchOf1Box), SteamOf1Bunch: Number(v.SteamOf1Bunch), SteamOf1Box: Number(v.SteamOf1Box) });
          products.push(saved); status = 201; body = { success: true, saved, message: '품목 저장 및 대조 완료' };
        }
      }
      return req.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
    });

    const ok = await page.goto(base + '/master/products', { waitUntil: 'networkidle0', timeout: 120000 });
    assert.equal(ok.status(), 200);
    await page.waitForFunction(() => document.body.innerText.includes('ROSE / Freedom 50cm'));
    console.log('page ready', new URL(page.url()).pathname);
    assert(await page.$('details summary'), '품목관리 화면에 사용 가이드 영상 칸이 있어야 함');
    await page.screenshot({ path: '.verify/product-new-guide-start.png' });

    const rec = dry ? null : await createWorkflowGuideRecorder(page, { workflowId: WORKFLOW, guideId: GUIDE, title: '신규 품목 등록', sourceFiles: workflow.sourceFiles, fixtureOnly: true });
    let number = 0;
    const say = async (text, ms = 6000) => {
      const lines = String(text).split('\n'); assert(lines.length <= 2 && lines.every(l => l.length <= 54), `자막은 2줄·줄당 54자 이하: ${text}`);
      if (rec) { await rec.caption(`${number}. ${manual.steps[number - 1].title}\n${text}`); await rec.pause(ms); }
    };
    const step = async text => {
      const s = manual.steps[number]; number++;
      assert.equal(s.no, number);
      rec?.chapter(workflow.requiredScenarios[number - 1], `${number}. ${s.title}`);
      await say(text, 6500);
    };
    // 화면 요소에 녹화용 이름표만 붙인다(모양·동작은 그대로).
    const tag = async (id, finder, arg) => {
      const found = await page.evaluate((id, finder, arg) => {
        const byLabel = text => [...document.querySelectorAll('.modal .form-group')].find(g => g.querySelector('.form-label')?.innerText.trim().startsWith(text))?.querySelector('input,select');
        const byButton = text => [...document.querySelectorAll('button')].find(b => b.innerText.trim().startsWith(text));
        const node = finder === 'label' ? byLabel(arg) : finder === 'button' ? byButton(arg) : document.querySelector(arg);
        if (!node) return false; node.setAttribute('data-guide-id', id); return true;
      }, id, finder, arg);
      assert(found, `화면에서 찾지 못함: ${finder} ${arg}`);
      return `[data-guide-id="${id}"]`;
    };
    const focus = async (selector, dx = 0) => {
      await page.$eval(selector, n => n.scrollIntoView({ block: 'center', behavior: 'instant' }));
      const p = await page.$eval(selector, n => { const r = n.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      if (p.y < 70) return mark(selector);
      assert(p.y >= 70 && p.y <= 900, `확대 범위 밖: ${selector} ${JSON.stringify(p)}`);
      await page.mouse.move(p.x + dx, p.y, { steps: 14 });
      if (rec) { await rec.pause(1200); await rec.focus(selector, number); }
    };
    // 화면 맨 윗줄(y<70)은 영상 확대 범위 밖이다 → 전체 화면에서 번호·테두리로 위치만 표시하고, 확대는 결과가 나타나는 곳에서 한다.
    const mark = async selector => {
      const p = await page.$eval(selector, (node, number) => {
        const r = node.getBoundingClientRect(), host = document.getElementById('nenova-guide-capture');
        if (host) {
          const m = document.createElement('div'); m.dataset.guideFocus = 'true';
          m.style.cssText = `position:fixed;left:${r.left - 6}px;top:${r.top - 6}px;width:${r.width + 12}px;height:${r.height + 12}px;border:4px solid #f59e0b;border-radius:8px;box-sizing:border-box`;
          const b = document.createElement('div'); b.dataset.guideFocus = 'true'; b.textContent = `${number} 단계`;
          b.style.cssText = 'position:fixed;left:20px;top:10px;background:#12335b;color:white;border:3px solid #f59e0b;border-radius:12px;padding:5px 15px;font-size:26px;font-weight:bold';
          host.append(b, m);
        }
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }, number);
      await page.mouse.move(p.x, p.y, { steps: 14 });
      if (rec) await rec.pause(3000);
    };
    const out = async (ms = 0) => { if (rec) { if (ms) await rec.pause(ms); await rec.unfocus(); } };
    const type = async (selector, value) => { await page.click(selector); await page.type(selector, value, { delay: rec ? 140 : 0 }); if (rec) await rec.pause(1800); };
    const choose = async (selector, value) => { await page.select(selector, value); if (rec) await rec.pause(1800); };
    const value = selector => page.$eval(selector, n => n.value);

    // 1. 이미 있는 품목인지 먼저 찾기
    await step('처음 보는 품목이 나오면, 등록 전에 검색창에서 이미 있는 품목인지 찾습니다.\n같은 품목을 두 번 만들면 주문·입고·재고가 둘로 갈라집니다.');
    const search = await tag('search', 'css', '.filter-bar input.filter-input');
    await focus(search);
    await type(search, 'Freedom');
    await page.waitForFunction(() => !document.body.innerText.includes('ROSE / Mondial 50cm'));
    await out();
    await say('"Freedom"으로 찾으니 50cm·70cm 는 있고 60cm 는 없습니다.\n길이·색·등급이 다르면 다른 품목이므로 60cm 를 새로 등록합니다.', 3000);
    // 행 전체를 잡으면 확대 중심이 오른쪽으로 가서 품목코드 칸이 잘린다 → 코드 칸을 잡아 왼쪽(코드·품목명)이 보이게 한다.
    const cell = async (id, rowText, nth) => {
      const ok = await page.evaluate((id, rowText, nth) => { const tr = [...document.querySelectorAll('table.tbl tbody tr')].find(r => r.innerText.includes(rowText)); const td = tr?.querySelector(`td:nth-child(${nth})`); if (!td) return false; td.setAttribute('data-guide-id', id); return true; }, id, rowText, nth);
      assert(ok, `목록에서 찾지 못함: ${rowText} ${nth}번째 칸`);
      return `[data-guide-id="${id}"]`;
    };
    const found = await cell('found', 'ROSE / Freedom 70cm', 3);
    await focus(found, 70);
    await out(4000);

    // 2. 신규 등록 창 열기
    await step('오른쪽 위 "＋ 신규" 버튼을 눌러 신규 품목 등록 창을 엽니다.');
    const add = await tag('add', 'button', '＋ 신규');
    await focus(add);
    await page.click(add);
    await page.waitForFunction(() => document.querySelector('.modal .modal-title')?.innerText.includes('신규 품목 등록'));
    await out();
    await say('"신규 품목 등록" 창이 열렸습니다. 위에서부터 차례로 채웁니다.\n품목명·꽃 종류·국가·단위는 반드시 넣어야 저장됩니다.', 2500);
    const title = await tag('title', 'css', '.modal .modal-header');
    await focus(title);
    await out(2500);

    // 3. 품목코드·품목명·웹 표시 이름
    await step('품목코드 칸은 비워 둡니다. 코드는 등록 뒤에 영업지원이 붙입니다.\n품목명은 기존 품목과 같은 모양으로 넣습니다. (ROSE / 품종 길이)', 7500);
    const code = await tag('code', 'label', '품목코드');
    await focus(code);
    await out(2500);
    assert.equal(await value(code), '', '품목코드는 비워 둔다');
    const name = await tag('name', 'label', '품목명');
    await focus(name);
    await type(name, PRACTICE.name);
    await out();
    const auto = await tag('auto', 'button', '✨ 자동');
    const display = await tag('display', 'label', '자연어명');
    await say('자연어명은 주문·견적 화면에 보이는 한글 이름입니다.\n"자동" 버튼으로 채운 뒤, 어색하면 직접 고칩니다.', 4500);
    await focus(auto);
    await page.click(auto);
    if (rec) await rec.pause(2500);
    assert((await value(display)).length > 0, '자연어명이 자동으로 채워져야 함');
    await out();

    // 4. 꽃 종류와 국가
    await step('꽃 종류와 국가는 반드시 고릅니다. 인보이스를 보낸 농장의 국가와 꽃을 봅니다.\n이 두 값으로 분배·확정·원가 계산의 묶음이 정해집니다.');
    const flower = await tag('flower', 'label', '꽃 종류');
    await focus(flower);
    await choose(flower, PRACTICE.flower);
    await out();
    const country = await tag('country', 'label', '국가');
    await focus(country);
    await choose(country, PRACTICE.country);
    await out();

    // 5. 단위와 박스 환산
    await step('출고·견적 단위, 1박스 단수, 1단 송이수를 넣습니다. (콜롬비아 장미: 단·단·10·10)\n같은 국가·꽃의 기존 품목 값을 따르고, 인보이스 수량이 다르면 그 숫자를 넣습니다.', 7500);
    const outUnit = await tag('outUnit', 'label', '출고단위');
    await focus(outUnit);
    await choose(outUnit, PRACTICE.outUnit);
    const estUnit = await tag('estUnit', 'label', '견적단위');
    await choose(estUnit, PRACTICE.estUnit);
    await out();
    const bunch = await tag('bunch', 'label', '1박스 당 단수');
    await focus(bunch);
    await type(bunch, PRACTICE.bunchOf1Box);
    const stem = await tag('stem', 'label', '1단 당 송이수');
    await type(stem, PRACTICE.steamOf1Bunch);
    await out();
    await say(`1박스 당 송이수는 직접 넣습니다. 단수 × 송이수(${PRACTICE.bunchOf1Box} × ${PRACTICE.steamOf1Bunch} = ${PRACTICE.steamOf1Box}) 값입니다.\n비우거나 틀리면 박스·단·송이 환산 수량이 틀어집니다.`, 4500);
    const box = await tag('box', 'label', '1박스 당 송이수');
    await focus(box);
    await type(box, PRACTICE.steamOf1Box);
    await out();

    // 6. 비워 둘 칸 확인 — 실제 등록 기록에서 출고단가 0%, 박스 무게·CBM·관세율 1%만 채워져 있다.
    await step('출고단가와 운송 원가용 칸(박스 무게·CBM·관세율)은 보통 비워 둡니다.\n비워 두면 꽃 종류 기본값으로 계산됩니다. 값을 따로 받은 품목만 넣습니다.');
    const weight = await tag('weight', 'label', '박스당 무게');
    await focus(weight);
    await out(3500);
    assert.equal(await value(weight), '', '운송 원가용 칸은 비워 둔다');

    // 7. 저장하고 목록에서 확인
    await step('입력한 값을 위에서부터 한 번 더 읽어 본 뒤 "저장"을 누릅니다.\n품목명·꽃 종류·국가·단위가 비어 있으면 저장되지 않습니다.');
    const save = await tag('save', 'button', '💾 저장');
    await focus(save);
    await page.click(save);
    await page.waitForFunction(() => !document.querySelector('.modal .modal-title'));
    await out();
    await page.waitForFunction(name => document.body.innerText.includes(name), {}, PRACTICE.name);
    const saved = await page.evaluate(name => { const tr = [...document.querySelectorAll('table.tbl tbody tr')].find(r => r.innerText.includes(name)); if (!tr) return null; tr.setAttribute('data-guide-id', 'saved'); return tr.innerText.replace(/\s+/g, ' '); }, PRACTICE.name);
    assert(saved, '저장한 품목이 목록에 보여야 함');
    await say('목록에 새 품목이 나타나면 등록된 것입니다. 꽃·국가·단위·단수를 확인합니다.\n요청한 사람과 영업지원에 알립니다. 품목코드는 영업지원이 이어서 붙입니다.', 3000);
    await focus(await cell('savedName', PRACTICE.name, 3), 70);
    await out(3500);
    await focus(await cell('savedBunch', PRACTICE.name, 9), -40);
    await out(3500);

    assert.equal(saves, 1, '저장 요청은 한 번');
    assert.ok(!savedBody.values.ProdCode, '품목코드 없이 등록');
    assert.deepEqual({ n: savedBody.values.ProdName, f: savedBody.values.FlowerName, c: savedBody.values.CounName, o: savedBody.values.OutUnit, e: savedBody.values.EstUnit, b: savedBody.values.BunchOf1Box, s: savedBody.values.SteamOf1Bunch, x: savedBody.values.SteamOf1Box },
      { n: PRACTICE.name, f: PRACTICE.flower, c: PRACTICE.country, o: PRACTICE.outUnit, e: PRACTICE.estUnit, b: PRACTICE.bunchOf1Box, s: PRACTICE.steamOf1Bunch, x: PRACTICE.steamOf1Box });
    assert.equal(savedBody.prodKey, undefined, '신규 등록이어야 함');
    assert.equal(number, manual.steps.length);
    await page.screenshot({ path: '.verify/product-new-guide-result.png' });
    if (rec) {
      await rec.pause(2500);
      const result = await rec.stop();
      const guide = workflow.guides.find(g => g.id === GUIDE);
      guide.status = 'ready'; guide.chapters = result.chapters;
      fs.writeFileSync(path.join(root, 'config/workflow-guides.json'), JSON.stringify(registry, null, 2) + '\n');
    }
    console.log(JSON.stringify({ passed: true, dry, steps: number, blockedExternalRequests: external, syntheticSaves: saves, productionWrites: 0, savedRow: saved }));
  } finally { await browser?.close(); server.kill(); }
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; });
