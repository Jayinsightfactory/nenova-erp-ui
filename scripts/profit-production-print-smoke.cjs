// Opt-in production presentation QA. No PDF, source data, or credentials are uploaded.
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');

(async () => {
  const token = process.env.NENOVAWEB_SERVICE_TOKEN;
  assert.ok(token, 'Configured service credential is unavailable');
  const year = String(process.env.PROBE_YEAR || '2026');
  const weeks = String(process.env.PROBE_WEEKS || '18,38,39').split(',').map(w => w.trim().padStart(2, '0')).sort();
  assert.match(year, /^20\d\d$/);
  assert.ok([1, 3].includes(weeks.length) && new Set(weeks).size === weeks.length);
  assert.ok(weeks.every(w => /^\d{2}$/.test(w) && +w >= 1 && +w <= 53));
  const origin = 'https://nenovaweb.com';
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: process.env.CI ? ['--no-sandbox'] : [] });
  let blockedWrites = 0;
  const requested = [], statuses = [];
  try {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.evaluateOnNewDocument(() => {
      window.__profitPrintCalls = 0;
      window.print = () => { try { window.top.__profitPrintCalls += 1; } catch { window.__profitPrintCalls += 1; } };
    });
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (!['GET', 'HEAD'].includes(request.method())) { blockedWrites++; return request.abort('blockedbyclient'); }
      const url = new URL(request.url());
      if (url.origin === origin && url.pathname.startsWith('/api/')) {
        if (url.pathname === '/api/sales/profit-report-output') {
          assert.equal(url.searchParams.get('year'), year);
          assert.ok(weeks.includes(url.searchParams.get('week')));
          requested.push(url.searchParams.get('week'));
        }
        return request.continue({ headers: { ...request.headers(), authorization: `Bearer ${token}` } });
      }
      return request.continue();
    });
    page.on('response', response => { if (new URL(response.url()).pathname === '/api/sales/profit-report-output') statuses.push(response.status()); });
    await page.goto(`${origin}/sales/profit-report?year=${year}&week=${weeks.at(-1)}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.startsWith('엑셀 다운로드') && !b.disabled), { timeout: 150000 });
    const findSummary = prefix => page.evaluateHandle(p => [...document.querySelectorAll('summary')].find(s => s.textContent.startsWith(p)), prefix);
    const columnSummary = await findSummary('엑셀·인쇄 항목');
    assert.match(await columnSummary.evaluate(e => e.textContent), /22\/22/);
    for (const width of [1920, 390]) {
      await page.setViewport({ width, height: 1080 });
      const screenColumns = await page.$('[data-testid="profit-columns-button"]');
      assert.match(await screenColumns.evaluate(e => e.textContent), /22\/22/);
      await screenColumns.focus();
      await page.keyboard.press('Space');
      await page.waitForSelector('[data-testid="profit-columns-panel"]');
      const panelBounds = await page.$eval('[data-testid="profit-columns-panel"]', panel => {
        const box = panel.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: innerWidth, height: innerHeight };
      });
      assert.ok(panelBounds.left >= 0 && panelBounds.right <= panelBounds.width && panelBounds.top >= 0 && panelBounds.bottom <= panelBounds.height);
      await page.keyboard.press('ArrowDown');
      assert.equal(await page.$eval('[data-testid="profit-columns-panel"]', e => [...e.querySelectorAll('input')].indexOf(document.activeElement)), 1);
      await page.keyboard.press('Escape');
      assert.equal(await screenColumns.evaluate(e => document.activeElement === e), true);
      await columnSummary.asElement().focus();
      await page.keyboard.press('Space');
      const bounds = await columnSummary.evaluate(summary => {
        const box = summary.parentElement.querySelector('fieldset').getBoundingClientRect();
        return { left: box.left, right: box.right, width: innerWidth, open: summary.parentElement.open };
      });
      assert.equal(bounds.open, true);
      assert.ok(bounds.left >= -1 && bounds.right <= bounds.width + 1, 'column selection must stay inside viewport');
      await page.keyboard.press('Escape');
      assert.equal(await columnSummary.evaluate(e => !e.parentElement.open && document.activeElement === e), true);
    }
    await page.setViewport({ width: 1920, height: 1080 });
    const weekSummary = await findSummary('엑셀·인쇄 차수 선택');
    await weekSummary.asElement().click();
    await weekSummary.evaluate((summary, selected) => {
      for (const input of summary.parentElement.querySelectorAll('input[type="checkbox"]')) {
        const label = input.closest('label')?.textContent || '';
        const match = label.match(/(\d+)차/);
        if (!match) throw Error('Week checkbox lacks scope label');
        const wanted = selected.includes(match[1].padStart(2, '0'));
        if (input.checked !== wanted) input.click();
      }
    }, weeks);
    await page.keyboard.press('Escape');
    const printButton = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find(b => /^인쇄/.test(b.textContent) && !b.disabled));
    assert.ok(printButton.asElement(), 'Print action must exist');
    await printButton.asElement().click();
    await page.waitForFunction(() => window.__profitPrintCalls === 1, { timeout: 180000 });
    assert.equal(await page.evaluate(() => window.__profitPrintCalls), 1);
    const frame = page.frames().find(f => f !== page.mainFrame() && f.url() === 'about:srcdoc');
    assert.ok(frame, 'Print document iframe must exist');
    const sections = await frame.evaluate(() => [...document.querySelectorAll('.profit-print-page')].map(section => {
      const outer = section.getBoundingClientRect();
      const cells = [...section.querySelectorAll('th,td')];
      return { headers: [...section.querySelectorAll('th')].map(c => c.textContent),
        numbers: cells.map(c => c.textContent.trim()).filter(v => /^-?[\d,]+(?:\.\d+)?%?$/.test(v)),
        fits: cells.every(c => { const r = c.getBoundingClientRect(); return r.left >= outer.left - 1 && r.right <= outer.right + 1 && r.bottom <= outer.bottom + 1; }) };
    }));
    assert.equal(sections.length, weeks.length);
    for (const section of sections) { assert.equal(section.headers.length, 22); assert.ok(section.fits, 'All table cells must fit their printed page'); }
    const printHtml = await frame.content();
    const pdfPage = await context.newPage();
    await pdfPage.setContent(printHtml, { waitUntil: 'load' });
    await pdfPage.emulateMediaType('print');
    const pdf = await pdfPage.pdf({ preferCSSPageSize: true, printBackground: true });
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const document = await getDocument({ data: new Uint8Array(pdf), useSystemFonts: true }).promise;
    assert.equal(document.numPages, weeks.length, 'Each selected week must occupy exactly one page');
    for (let i = 1; i <= document.numPages; i++) {
      const pdfSheet = await document.getPage(i);
      const viewport = pdfSheet.getViewport({ scale: 1 });
      assert.ok(Math.abs(viewport.width - 841.89) < 2 && Math.abs(viewport.height - 595.28) < 2, 'A4 landscape required');
      const text = (await pdfSheet.getTextContent()).items.map(item => item.str).join('');
      assert.ok(text.includes(`${year}년`) && text.includes(`${Number(weeks[i - 1])}차`));
      const normalizedText = text.replace(/\s/g, '');
      for (const header of sections[i - 1].headers) assert.ok(normalizedText.includes(header.replace(/\s/g, '')), 'All selected column headers must survive PDF rendering');
      for (const number of sections[i - 1].numbers) assert.ok(normalizedText.includes(number), 'Printed numeric cell must survive PDF rendering');
    }
    await document.destroy();
    assert.deepEqual([...new Set(requested)].sort(), weeks);
    assert.ok(statuses.length >= weeks.length && statuses.every(status => status === 200));
    assert.equal(blockedWrites, 0);
    console.log(JSON.stringify({ printSmoke: 'PASS', year, weeks, pages: weeks.length, pageSize: 'A4 landscape', defaultColumns: 22, printCalls: 1, viewports: [1920, 390], actualBusinessWrites: 0 }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error.name + ': ' + error.message); process.exitCode = 1; });
