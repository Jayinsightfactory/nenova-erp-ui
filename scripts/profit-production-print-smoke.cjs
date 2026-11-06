// Opt-in production presentation QA. No PDF, source data, or credentials are uploaded.
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');

(async () => {
  const token = process.env.NENOVAWEB_SERVICE_TOKEN;
  assert.ok(token, 'Configured service credential is unavailable');
  const year = String(process.env.PROBE_YEAR || '2026');
  const weeks = String(process.env.PROBE_WEEKS || '18,38,39').split(',').map(w => w.trim().padStart(2, '0')).sort();
  const weeksView = process.env.PROBE_WEEKS_VIEW === 'true';
  assert.match(year, /^20\d\d$/);
  assert.ok([1, 3].includes(weeks.length) && new Set(weeks).size === weeks.length);
  assert.ok(weeks.every(w => /^\d{2}$/.test(w) && +w >= 1 && +w <= 53));
  if (weeksView) assert.ok(weeks.every((w, i) => i === 0 || Number(w) === Number(weeks[i - 1]) + 1), 'Weeks-view probe requires consecutive weeks to bound production reads');
  const origin = 'https://nenovaweb.com';
  const normalizePdfText = text => String(text).replace(/\s/g, '');
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: process.env.CI ? ['--no-sandbox'] : [] });
  let blockedWrites = 0;
  let blockedTelemetry = 0;
  let unexpectedMutationAttempts = 0;
  const blockedWriteEndpoints = new Map();
  const requested = [], statuses = [];
  const outputReads = [], sourceNotes = new Map();
  const reportReads = [];
  let stage = 'font-preflight', activePage = null;
  const mark = next => { stage = next; console.log(JSON.stringify({printSmokeStage:stage})); };
  try {
    const context = await browser.createBrowserContext();
    // Public synthetic text distinguishes missing CJK glyphs from production data.
    const fontProbe = await context.newPage();
    const syntheticTitle = `${year}년 ${Number(weeks[0])}차 매출이익 보고서`;
    await fontProbe.setContent(`<html lang="ko"><style>body{font-family:Arial,"Malgun Gothic",sans-serif}</style><h1>${syntheticTitle}</h1></html>`);
    await fontProbe.evaluate(() => document.fonts.ready);
    const fontPdf = await fontProbe.pdf({ format: 'A4' });
    const fontDocument = await getDocument({ data: new Uint8Array(fontPdf), useSystemFonts: true }).promise;
    const syntheticExtracted = (await (await fontDocument.getPage(1)).getTextContent()).items.map(item => item.str).join('');
    const fontPass = normalizePdfText(syntheticExtracted).includes(normalizePdfText(syntheticTitle));
    console.log(JSON.stringify({ printFontPreflight: fontPass ? 'PASS' : 'FAIL', syntheticTitleCodePoints: [...syntheticExtracted].map(c => c.codePointAt(0)), containsHangul: /[가-힣]/.test(syntheticExtracted) }));
    await fontDocument.destroy(); await fontProbe.close();
    assert.ok(fontPass, 'Synthetic Korean PDF title must survive font rendering and text extraction');
    const page = await context.newPage();
    activePage = page;
    const fillScopeInput = async (label, value) => {
      const selector = `input[aria-label="${label}"]`;
      await page.focus(selector);
      await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
      await page.keyboard.press('Backspace');
      if (value) await page.keyboard.type(value);
      assert.equal(await page.$eval(selector, e => e.value), value, `Exact ${label} value must be entered`);
    };
    await page.setViewport({ width: 1920, height: 1080 });
    await page.evaluateOnNewDocument(() => {
      window.__profitPrintCalls = 0;
      window.print = () => { try { window.top.__profitPrintCalls += 1; } catch { window.__profitPrintCalls += 1; } };
    });
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (!['GET', 'HEAD'].includes(request.method())) {
        blockedWrites++;
        const blockedUrl = new URL(request.url());
        // _app's global userActivityClient flushes metadata every five seconds.
        // Still abort it: this exception classifies an attempted telemetry send,
        // never permits a request or weakens the business-mutation assertion.
        if (request.method() === 'POST' && blockedUrl.origin === origin && blockedUrl.pathname === '/api/work/activity') blockedTelemetry++;
        else unexpectedMutationAttempts++;
        const endpoint = `${request.method()} ${blockedUrl.pathname}`;
        blockedWriteEndpoints.set(endpoint, (blockedWriteEndpoints.get(endpoint) || 0) + 1);
        return request.abort('blockedbyclient');
      }
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
    page.on('response', response => {
      const responseUrl = new URL(response.url());
      if (responseUrl.pathname === '/api/sales/profit-report') reportReads.push({year:responseUrl.searchParams.get('year'),week:responseUrl.searchParams.get('week'),status:response.status()});
      if (responseUrl.pathname !== '/api/sales/profit-report-output') return;
      statuses.push(response.status());
      if (response.status() === 200) outputReads.push(response.json().then(data => {
        sourceNotes.set(String(data.major), String(data.workbook?.Sheets?.['주차별 매출이익 보고서']?.['!profitPrint']?.userNote ?? ''));
      }));
    });
    mark('initial-report');
    await page.goto(`${origin}/sales/profit-report?year=${year}&week=${weeks.at(-1)}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('[data-testid="profit-query-empty"]');
    await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='조회')?.click());
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
    if (weeksView) {
      mark('weeks-scope-input');
      const modeButton = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '차수별'));
      await modeButton.asElement().click();
      await page.waitForSelector('[data-testid="profit-weeks-output"]');
      assert.equal(await page.$eval('h1', e => e.textContent.trim()), '📈 차수별 매출이익 보고서 — 조회 범위 확인 필요');
      assert.equal(await page.$eval('[data-testid="profit-weeks-output"] [data-testid="profit-print-button"]', b => b.disabled), true, 'Unloaded weeks scope must not print');
      for (const [label, value] of [['시작 차수', String(Number(weeks[0]))], ['마지막 차수', String(Number(weeks.at(-1)))]]) {
        await fillScopeInput(label, value);
      }
      assert.equal(await page.$eval('input[aria-label="차수별 보고서 연도"]', e => e.value), year);
      const query = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '조회'));
      await query.asElement().click();
      mark('weeks-query-ready');
      await page.waitForFunction(() => { const b = document.querySelector('[data-testid="profit-weeks-output"] [data-testid="profit-print-button"]'); return b && !b.disabled; }, { timeout: 180000 });
      const expectedWeeksTitle = `📈 차수별 매출이익 보고서 — ${Number(weeks[0])}~${Number(weeks.at(-1))}차 (${year})`;
      assert.equal(await page.$eval('h1', e => e.textContent.trim()), expectedWeeksTitle, 'Weeks heading must match the completed range and year');
      const available = await page.$$eval('[data-testid="profit-output-weeks"] input[type="checkbox"]', inputs => inputs.map(input => ({ week: input.closest('label').textContent.match(/(\d+)차/)[1].padStart(2, '0'), checked: input.checked })));
      assert.deepEqual(available.map(i => i.week), weeks);
      assert.ok(available.every(i => i.checked), 'All loaded weeks must initially be selected');
      mark('weeks-stale-scope-guard');
      await fillScopeInput('시작 차수', '');
      assert.equal(await page.$eval('[data-testid="profit-weeks-output"] [data-testid="profit-print-button"]', b => b.disabled), true, 'Edited scope must block stale output');
      assert.equal(await page.$eval('h1', e => e.textContent.trim()), '📈 차수별 매출이익 보고서 — 조회 범위 확인 필요', 'Edited scope must not display an old category title');
      await fillScopeInput('시작 차수', String(Number(weeks[0])));
      await query.asElement().click();
      await page.waitForFunction(() => !document.querySelector('[data-testid="profit-weeks-output"] [data-testid="profit-print-button"]').disabled);
      assert.equal(await page.$eval('h1', e => e.textContent.trim()), expectedWeeksTitle);
    }
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
    mark('print-dialog-ready');
    await page.waitForFunction(() => window.__profitPrintCalls === 1, { timeout: 180000 });
    assert.equal(await page.evaluate(() => window.__profitPrintCalls), 1);
    const frame = page.frames().find(f => f !== page.mainFrame() && f.url() === 'about:srcdoc');
    assert.ok(frame, 'Print document iframe must exist');
    const sections = await frame.evaluate(() => [...document.querySelectorAll('.profit-print-page')].map(section => {
      const outer = section.getBoundingClientRect();
      const cells = [...section.querySelectorAll('th,td')];
      const note = section.querySelector('.note');
      const noteRect = note?.getBoundingClientRect();
      const withoutNotes = section.cloneNode(true);
      withoutNotes.querySelectorAll('.note').forEach(note => note.remove());
      return { headers: [...section.querySelectorAll('th')].map(c => c.textContent),
        userNote: section.querySelector('.note > div')?.textContent || '',
        noteGeometry: noteRect ? { top: noteRect.top - outer.top, bottom: noteRect.bottom - outer.top,
          pageHeight: outer.height, fits: noteRect.left >= outer.left - 1 && noteRect.right <= outer.right + 1 && noteRect.bottom <= outer.bottom + 1,
          scrollHeight: note.scrollHeight, clientHeight: note.clientHeight, scale: section.dataset.printScale || null } : null,
        hasAutomaticStatus: /검증 보류|입력 안 됨|저장 참고값|수익률 원천 검증 전/.test(withoutNotes.textContent),
        numbers: cells.map(c => c.textContent.trim()).filter(v => /^-?[\d,]+(?:\.\d+)?%?$/.test(v)),
        fits: cells.every(c => { const r = c.getBoundingClientRect(); return r.left >= outer.left - 1 && r.right <= outer.right + 1 && r.bottom <= outer.bottom + 1; }) };
    }));
    assert.equal(sections.length, weeks.length);
    await Promise.all(outputReads);
    for (let i = 0; i < sections.length; i++) {
      assert.ok(sourceNotes.has(weeks[i]), 'Source note metadata must be read for the exact selected week');
      const expectedNote = sourceNotes.get(weeks[i]).split(/\r\n|\n|\r/).map(line => line.trim()).filter(Boolean).join(' · ');
      assert.equal(sections[i].userNote, expectedNote, 'Print note must preserve every source item in original order');
    }
    for (const section of sections) { assert.equal(section.headers.length, 22); assert.equal(section.hasAutomaticStatus, false); assert.ok(section.fits, 'All table cells must fit their printed page'); }
    const printHtml = await frame.content();
    const pdfPage = await context.newPage();
    await pdfPage.setContent(printHtml, { waitUntil: 'load' });
    await pdfPage.emulateMediaType('print');
    await pdfPage.evaluate(() => document.fonts.ready);
    const pdf = await pdfPage.pdf({ preferCSSPageSize: true, printBackground: true });
    const document = await getDocument({ data: new Uint8Array(pdf), useSystemFonts: true }).promise;
    assert.equal(document.numPages, weeks.length, 'Each selected week must occupy exactly one page');
    for (let i = 1; i <= document.numPages; i++) {
      const pdfSheet = await document.getPage(i);
      const viewport = pdfSheet.getViewport({ scale: 1 });
      assert.ok(Math.abs(viewport.width - 841.89) < 2 && Math.abs(viewport.height - 595.28) < 2, 'A4 landscape required');
      const pdfTextContent = await pdfSheet.getTextContent();
      const text = pdfTextContent.items.map(item => item.str).join('');
      const normalizedText = normalizePdfText(text);
      const expectedTitle = normalizePdfText(`${year}년 ${Number(weeks[i - 1])}차 매출이익 보고서`);
      const titleMatches = normalizedText.includes(expectedTitle);
      if (!titleMatches) console.log(JSON.stringify({ printTitleDiagnostic: 'FAIL', page: i, year, week: weeks[i - 1], containsHangul: /[가-힣]/.test(text), replacementGlyphCount: (text.match(/\uFFFD/g) || []).length, whitespaceCount: (text.match(/\s/g) || []).length }));
      assert.ok(titleMatches, 'Exact report title must survive PDF rendering (whitespace normalized)');
      for (const header of sections[i - 1].headers) assert.ok(normalizedText.includes(header.replace(/\s/g, '')), 'All selected column headers must survive PDF rendering');
      for (const number of sections[i - 1].numbers) assert.ok(normalizedText.includes(number), 'Printed numeric cell must survive PDF rendering');
      const userNote = sections[i - 1].userNote;
      assert.ok(!/[\r\n]/.test(userNote), 'Print note must use horizontal flow instead of source line breaks');
      if (userNote) {
        const expected = normalizePdfText(userNote);
        const noteMatches = normalizedText.includes(expected);
        if (!noteMatches) {
          // Privacy-safe diagnosis only: never print source/PDF text, names or notes.
          // Keep the exact assertion below unchanged; these measurements must not
          // normalize away missing glyphs, shorten the expected note or pass a tail.
          const anchorLength = [128,64,32,16,8].find(length => expected.length >= length && normalizedText.includes(expected.slice(0,length))) || 0;
          const anchor = anchorLength ? normalizedText.indexOf(expected.slice(0,anchorLength)) : -1;
          let prefixLength = 0;
          if (anchor >= 0) while (prefixLength < expected.length && normalizedText[anchor+prefixLength] === expected[prefixLength]) prefixLength++;
          const codePoint = value => value == null ? null : `U+${value.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')}`;
          let orderedCount = 0, cursor = Math.max(0,anchor);
          for (const character of expected) {
            const found = normalizedText.indexOf(character,cursor);
            if (found < 0) break;
            orderedCount++; cursor = found + character.length;
          }
          const positionSorted = [...pdfTextContent.items].sort((a,b) => Math.abs(a.transform[5]-b.transform[5]) < .5
            ? a.transform[4]-b.transform[4] : b.transform[5]-a.transform[5]).map(item=>item.str).join('');
          console.log(JSON.stringify({printNoteDiagnostic:'FAIL',page:i,week:weeks[i-1],expectedLength:expected.length,
            pdfNormalizedLength:normalizedText.length,pdfTextItems:pdfTextContent.items.length,anchorLength,anchor,prefixLength,
            suffixMatches:[128,64,32,16,8].map(length=>({length,matches:expected.length>=length&&normalizedText.includes(expected.slice(-length))})),
            orderedCount,expectedCodePoints:[...expected].length,positionSortedContainsNote:normalizePdfText(positionSorted).includes(expected),
            firstMismatch:anchor<0?null:{expected:codePoint(expected[prefixLength]),pdf:codePoint(normalizedText[anchor+prefixLength])},
            noteGeometry:sections[i-1].noteGeometry}));
        }
        assert.ok(noteMatches, 'Entire author note including its last item must survive PDF rendering');
      }
    }
    await document.destroy();
    assert.deepEqual([...new Set(requested)].sort(), weeks);
    assert.ok(statuses.length >= weeks.length && statuses.every(status => status === 200));
    if (blockedWrites) console.log(JSON.stringify({ blockedWriteDiagnostic: [...blockedWriteEndpoints].map(([endpoint, count]) => ({ endpoint, count })), actualBusinessWrites: 0 }));
    assert.equal(unexpectedMutationAttempts, 0, 'No business or unexpected mutation may be attempted');
    assert.equal(blockedWrites, blockedTelemetry, 'Every blocked mutation must be the exact same-origin activity POST');
    console.log(JSON.stringify({ printSmoke: 'PASS', view: weeksView ? 'weeks' : 'category', year, weeks, pages: weeks.length, pageSize: 'A4 landscape', defaultColumns: 22, printCalls: 1, viewports: [1920, 390], blockedTelemetry, unexpectedMutationAttempts, actualBusinessWrites: 0 }));
  } catch (error) {
    const scope = activePage ? await activePage.evaluate(() => ({
      title:document.querySelector('h1')?.textContent,
      inputs:['차수별 보고서 연도','시작 차수','마지막 차수'].map(label=>({label,value:document.querySelector(`input[aria-label="${label}"]`)?.value})),
      printDisabled:document.querySelector('[data-testid="profit-weeks-output"] [data-testid="profit-print-button"]')?.disabled,
      queryPending:[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='조회 중…'),
      rangeInvalid:document.body.innerText.includes('차수는 1~53차로 선택하세요.'),
      partialFailure:document.body.innerText.includes('범위 전체를 다시 조회한 뒤 출력하세요.'),
      dirtyBlocked:document.body.innerText.includes('미저장 변경을 저장하거나 취소')
    })).catch(()=>null) : null;
    console.error(JSON.stringify({printSmokeFailure:{stage,scope,reportReads,outputStatuses:statuses,outputWeeks:requested}}));
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error.name + ': ' + error.message); process.exitCode = 1; });
