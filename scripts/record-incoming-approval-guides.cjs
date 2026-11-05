// Real tested UI, synthetic fixtures only. No request is forwarded to an ERP API.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), net = require('node:net'), crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const jwt = require('jsonwebtoken'), puppeteer = require('puppeteer-core'), XLSX = require('xlsx');
const { createWorkflowGuideRecorder } = require('./lib/workflow-guide-recorder.cjs');
const root = process.cwd(), dry = process.argv.includes('--dry-run');
const registryPath = path.join(root, 'config/workflow-guides.json');
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
const workflow = registry.workflows.find(item => item.id === 'incoming-approval');
const clone = value => JSON.parse(JSON.stringify(value));
const products = [{ ProdKey: 1, ProdName: '장미 레드 50' }, { ProdKey: 2, ProdName: '장미 핑크 50' }].map(product => ({ ...product, OutUnit: '단', EstUnit: '단', isDeleted: false, BunchOf1Box: 10, SteamOf1Bunch: 10, SteamOf1Box: 100 }));
const docId = '11111111-1111-8111-8111-111111111111', lineId = '44444444-4444-8444-8444-444444444444';
const header = { WarehouseKey: 9001, OrderYear: '2026', OrderWeek: '41-01', FarmName: '연습농장 가', InvoiceNo: 'GUIDE-001', AWB: '연습용', InputDate: '2026-10-08', UploadDtm: '2026-10-08', totalBox: 10 };
const before = [{ WdetailKey: 101, ProdKey: 1, ProdName: products[0].ProdName, OrderCode: '연습', BoxQuantity: 10, BunchQuantity: 100, SteamQuantity: 1000, OutQuantity: 100, EstQuantity: 100, UPrice: 1, TPrice: 100 }];
const scenarioTitles = { farm: '농장만 수정', product: '수량은 같고 품목만 수정', quantity: '입고·분배 수량 감소' };

function correction(scenario) {
  const product = scenario === 'product' ? products[1] : products[0], qty = scenario === 'quantity' ? 80 : 100;
  return { warehouseKey: header.WarehouseKey, orderYear: header.OrderYear, orderWeek: header.OrderWeek, mode: scenario === 'farm' ? 'FARM' : 'REPLACE', farmName: scenario === 'farm' ? '연습농장 나' : header.FarmName,
    ...(scenario === 'farm' ? {} : { fileName: `${scenario === 'product' ? '품목' : '수량'}수정_연습.xlsx`, fileMeta: { farmName: header.FarmName, orderYear: '2026', orderWeek: '41-01', invoiceNo: 'GUIDE-001', inputDate: '2026-10-08' }, items: [{ prodName: product.ProdName, orderCode: '연습', boxQty: qty / 10, steamOf1Bunch: 10, steamOf1Box: 100, bunchQty: qty, steamQty: qty * 10, unitPrice: 1, totalPrice: qty }] }) };
}
function previewFor(c) {
  const scenario = c.mode === 'FARM' ? 'farm' : c.items?.[0]?.prodName === products[1].ProdName ? 'product' : 'quantity';
  const quantity = scenario === 'quantity' ? 80 : 100, pk = scenario === 'product' ? 2 : 1;
  const after = [{ ...before[0], ProdKey: pk, ProdName: products[pk - 1].ProdName, BoxQuantity: quantity / 10, BunchQuantity: quantity, SteamQuantity: quantity * 10, OutQuantity: quantity, EstQuantity: quantity, TPrice: quantity }];
  const changes = scenario === 'product' ? [{ prodKey: 1, prodName: products[0].ProdName, unit: '단', before: 100, after: 0, delta: -100 }, { prodKey: 2, prodName: products[1].ProdName, unit: '단', before: 0, after: 100, delta: 100 }] : [{ prodKey: 1, prodName: products[0].ProdName, unit: '단', before: 100, after: quantity, delta: quantity - 100 }];
  return { success: true, canCommit: true, issues: [], farmBefore: header.FarmName, farmAfter: c.farmName, before, after, changes, scenario };
}
function factsFor(request) {
  const preview = previewFor(request.correction);
  return { receipt: { header, details: before }, receiptPlan: { ...preview, keys: preview.scenario === 'product' ? [1, 2] : [1], detailsChanged: preview.scenario !== 'farm' }, products,
    receiptMappingSuggestions: [{ sourceWdetailKey: 101, targetRowIndex: 0 }],
    costFacts: { invoices: [{ document: { documentId: docId, revision: 1 } }], freightHeaders: [{ FreightKey: 51 }] },
    costInputSuggestions: [{ kind: 'INVOICE', sourceKey: docId, expectedRevision: 1, inputSchema: { formulaLabel: '중국 해상 실제원가', lineFields: ['tariffRate', 'otherCostPerUnitKRW'] }, input: { exchangeRateKRW: 200, freightAmount: 40, allocationShareNumerator: 1, allocationShareDenominator: 1, lineInputs: [{ lineId, tariffRate: 0, otherCostPerUnitKRW: 0 }] }, lineMappings: [{ sourceLineId: lineId, sourceLabel: products[0].ProdName, sourceProdKey: 1, targetRowIndex: 0, quantity: 100, quantityUnit: 'BUNCH' }] },
      { kind: 'FREIGHT', sourceKey: 51, expectedRevision: 51, input: { basis: 'GW', master: { warehouseKey: 9001, exchangeRate: 200, gw: 20, cw: 20, rateUSD: 2, docFeeUSD: 0, invoiceUSD: 100 }, customs: { bakSangRate: 0, handlingFee: 0, quarantinePerItem: 0, domesticFreight: 0, deductFee: 0, extraFee: 0 }, rows: [{ targetRowIndex: 0, boxWeight: 2, boxCBM: .1, stemsPerBox: 100, stemsPerBunch: 10, salePriceKRW: 1100, tariffRate: 0 }] } }],
    profitPeriods: [{ orderYear: '2026', major: '41', confirmed: true }, { orderYear: '2026', major: '44', confirmed: true }],
    masters: [{ ShipmentKey: 10, CustKey: 1, CustName: '연습 꽃집', OrderYear: '2026', OrderWeek: '41-01', OrderYearWeek: '202641', isFix: true, isDeleted: false }],
    details: [{ SdetailKey: 20, ShipmentKey: 10, ProdKey: 1, OutQuantity: 60, Cost: 1100, Amount: 60000, Vat: 6000, isFix: true }],
    dates: [{ SdateKey: 30, SdetailKey: 20, ShipmentQuantity: 60, EstQuantity: 60, Cost: 1100, Amount: 60000, Vat: 6000, DateText: '2026-10-08' }],
    farmAssignments: [{ SfarmKey: 40, SdetailKey: 20, FarmKey: 1, FarmName: header.FarmName, ShipmentQuantity: 60, EstQuantity: 60 }],
    farms: [{ FarmKey: 1, FarmName: header.FarmName }, { FarmKey: 2, FarmName: '연습농장 나' }],
    farmCandidates: { 1: [{ FarmKey: 1, FarmName: header.FarmName }, { FarmKey: 2, FarmName: '연습농장 나' }], 2: [{ FarmKey: 1, FarmName: header.FarmName }, { FarmKey: 2, FarmName: '연습농장 나' }] } };
}
function requestFixture(scenario, index) {
  const c = correction(scenario), p = previewFor(c);
  return { requestId: index + 1, status: 'requested', revision: 1, requestedBy: 'guide-import', reason: `${scenarioTitles[scenario]} · 확인한 파킹 자료로 정정 요청`, correction: c,
    baseline: { receipt: { header, details: before }, receiptPlan: p, products }, matching: { rows: [], farms: [], receiptMappings: [], farmGroups: [], financial: { acknowledged: false, reason: '', costInputs: [] } } };
}
function writePacking(scenario) {
  const c = correction(scenario), item = c.items[0], grid = [[], ['', '', header.FarmName, '', '', '', '41-01', '', '', '', 'GUIDE-001'], ['', '', '연습용', '', '', '', '2026-10-08'], [], ['COD', 'VARIETY NAME', '', '', 'SIZE', 'BOX', 'STEAM/BUNCH', 'STEAM/BOX', 'TOTAL\nBUNCH', 'TOTALSTEAM', 'U.PRICE', 'T.PRICE'], ['연습', item.prodName.replace(/ 50$/, ''), '', '', '50', item.boxQty, 10, 100, item.bunchQty, item.steamQty, 1, item.totalPrice]];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(grid), 'Packing');
  const file = path.join(root, '.verify', c.fileName); XLSX.writeFile(wb, file); return file;
}
async function recordRole(browser, base, secret, role) {
  const isImport = role === 'import', requests = isImport ? [] : ['farm', 'product', 'quantity'].map(requestFixture);
  const page = await browser.newPage(), errors = [], posts = [];
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
  const user = { userId: isImport ? 'guide-import' : 'guide-support', userName: isImport ? '수입부 연습' : '영업지원 연습', authority: isImport ? 4 : 2, deptName: isImport ? '수입부' : '영업지원', accountActive: true };
  await page.setCookie({ name: 'nenovaToken', value: jwt.sign(user, secret, { expiresIn: '1h' }), url: base });
  await page.setRequestInterception(true);
  page.on('request', async r => {
    try {
      const u = new URL(r.url()); if (u.origin !== base) return r.abort();
      if (!u.pathname.startsWith('/api/')) return r.continue();
      let data = { success: true, items: [], rows: [], data: [], products: [], countries: [], records: [], history: [], references: [], options: [], value: null, revision: 0 };
      if (u.pathname === '/api/auth/me') data.user = user;
      if (u.pathname === '/api/warehouse') data.masters = [header];
      if (u.pathname === '/api/warehouse/9001') data.items = before;
      if (u.pathname === '/api/warehouse/correction') data = { success: true, draftOwner: user.userId, header, details: before, farms: [{ FarmName: header.FarmName }, { FarmName: '연습농장 나' }], history: [] };
      if (u.pathname === '/api/warehouse/invoice-costs') data.costs = null;
      if (u.pathname === '/api/warehouse/approval') {
        if (r.method() === 'GET') {
          const request = requests.find(item => item.requestId === Number(u.searchParams.get('requestId')));
          data = request ? { success: true, permissions: { request: isImport, review: !isImport }, request, facts: factsFor(request) } : { success: true, permissions: { request: isImport, review: !isImport }, requests: requests.map(item => ({ RequestId: item.requestId, Status: item.status, RequestedBy: '수입부 연습', correction: item.correction, reason: item.reason, revision: item.revision })) };
        } else {
          const body = JSON.parse(r.postData()); posts.push(body); const request = requests.find(item => item.requestId === body.requestId);
          if (body.action === 'draftPreview') data = previewFor(body.correction);
          if (body.action === 'create') {
            const item = { ...requestFixture(previewFor(body.correction).scenario, requests.length), status: 'draft', correction: body.correction, reason: body.reason }; requests.push(item); data = { success: true, requestId: item.requestId, revision: 1 };
          }
          if (body.action === 'submit') { assert(isImport); request.status = 'requested'; request.revision++; }
          if (body.action === 'saveMatching') {
            assert(!isImport); const scenario = previewFor(request.correction).scenario;
            assert(body.matching.financial.acknowledged && body.matching.financial.reason);
            const target = body.matching.farmGroups.find(group => group.prodKey === (scenario === 'product' ? 2 : 1));
            assert.equal(target.assignments.reduce((sum, item) => sum + Number(item.quantity), 0), scenario === 'quantity' ? 40 : 60);
            if (scenario !== 'farm') assert.equal(body.matching.receiptMappings[0].sourceWdetailKey, 101);
            request.matching = body.matching; request.revision++;
          }
          if (body.action === 'preview') {
            const p = previewFor(request.correction), quantity = p.scenario === 'quantity' ? 40 : 60, pk = p.scenario === 'product' ? 2 : 1;
            const common = { customer: '연습 꽃집', year: '2026', week: '41-01', unit: '단' };
            const groups = p.scenario === 'farm' ? [] : p.scenario === 'product' ? [{ ...common, key: '10:1', product: products[0].ProdName, before: 60, after: 0, beforeAmount: 60000, afterAmount: 0, beforeVat: 6000, afterVat: 0, stockDelta: 60 }, { ...common, key: '10:2', product: products[1].ProdName, before: 0, after: 60, beforeAmount: 0, afterAmount: 60000, beforeVat: 0, afterVat: 6000, stockDelta: -60 }] : [{ ...common, key: '10:1', product: products[0].ProdName, before: 60, after: quantity, beforeAmount: 60000, afterAmount: quantity * 1000, beforeVat: 6000, afterVat: quantity * 100, stockDelta: 60 - quantity }];
            const beforeTotals = { N: 60000, G: 16800, E: 0, F: 11200, T: 43200, U: 72 }, afterTotals = p.scenario === 'quantity' ? { N: 40000, G: 12000, E: 0, F: 12000, T: 28000, U: 70 } : beforeTotals;
            data = { ...p, digest: 'a'.repeat(64), reviewToken: 'synthetic-guide-token', groups, financialSummary: { costs: { invoices: [{ beforeTotal: 28000, afterTotal: p.scenario === 'quantity' ? 24000 : 28000, preserveEconomics: p.scenario === 'farm' }], freight: [{ beforeTotal: 28000, afterTotal: p.scenario === 'quantity' ? 24000 : 28000 }] }, profitBefore: [{ orderYear: '2026', major: '41', totals: beforeTotals }, { orderYear: '2026', major: '44', totals: beforeTotals }], profitAfter: [{ orderYear: '2026', major: '41', totals: afterTotals }, { orderYear: '2026', major: '44', totals: afterTotals }] }, stockPreview: p.scenario === 'farm' ? [] : [{ StockKey: 41, ProdKey: pk, OrderYear: '2026', OrderWeek: '41-01', Stock: 40, projected: 40 }, { StockKey: 44, ProdKey: pk, OrderYear: '2026', OrderWeek: '44-01', Stock: 25, projected: 25 }], externalDocuments: '이미 발송한 견적서는 정정 후 재발행이 필요합니다. 외부 회계 전표는 자동 변경하지 않습니다.' };
          }
          if (body.action === 'approve') { assert(!isImport && body.confirmed); request.status = 'applied'; request.result = { warehouseKey: 9001, shipmentGroups: previewFor(request.correction).scenario === 'farm' ? 0 : 1, stockProducts: previewFor(request.correction).scenario === 'farm' ? 0 : 2 }; request.appliedAt = '2026-11-04 10:00'; request.evidence = { receiptChanges: previewFor(request.correction).changes }; }
        }
      }
      await r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    } catch (error) { errors.push(`Fixture: ${error.message}`); if (!r.isInterceptResolutionHandled()) await r.abort(); }
  });
  await page.goto(`${base}/import/tools?tab=incoming&warehouseKey=9001&from=2026-10-01&to=2026-11-30`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('nav[aria-label="입고 정정 처리 단계"]');
  const rec = dry ? { caption: async () => {}, chapter: () => {}, pause: async () => {}, stop: async () => null } : await createWorkflowGuideRecorder(page, { root, workflowId: workflow.id, guideId: role, title: `${isImport ? '수입부' : '영업지원'} 입고 수정 가이드`, sourceFiles: workflow.sourceFiles, fixtureOnly: true });
  const hold = async (text, seconds = 5) => { await rec.caption(text); await rec.pause(seconds * 1000); };
  const moveClick = async element => {
    assert(element, 'Guide target missing'); await element.evaluate(node => node.scrollIntoView({ behavior: 'instant', block: 'center' }));
    const box = await element.boundingBox(); assert(box, 'Guide target not visible');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: dry ? 1 : 24 }); await rec.pause(450); await element.click(); await rec.pause(600);
  };
  const click = async (text, scope = 'body') => { const handle = await page.evaluateHandle(({ text, scope }) => [...document.querySelector(scope).querySelectorAll('button,a,summary')].find(node => node.textContent.trim() === text && !node.disabled), { text, scope }); await moveClick(handle.asElement()); await handle.dispose(); };
  const select = async (selector, value) => { const element = await page.$(selector); await moveClick(element); await element.select(String(value)); await rec.pause(700); await page.keyboard.press('Tab'); };
  const fill = async (selector, text) => { const element = await page.$(selector); await moveClick(element); await element.click({ clickCount: 3 }); await page.keyboard.press('Backspace'); await element.type(String(text), { delay: dry ? 0 : 60 }); await rec.pause(500); };
  const checkedLabel = async text => { const handle = await page.evaluateHandle(text => [...document.querySelectorAll('label')].find(label => label.textContent.includes(text))?.querySelector('input[type="checkbox"]'), text); await moveClick(handle.asElement()); await handle.dispose(); };
  let stopped = false;
  try {
    await hold(isImport ? '수입부는 수정안을 만들고 영업지원에 요청합니다.\n초안 저장과 요청만으로는 입고·분배·재고가 바뀌지 않습니다.' : '영업지원은 요청 내용을 확인하고 분배를 매칭합니다.\n최종 확정할 때 입고·분배·재고·견적·매출이 함께 반영됩니다.', 7);
    if (!isImport) await click('매칭·확정');
    for (const [index, scenario] of ['farm', 'product', 'quantity'].entries()) {
      rec.chapter(scenario, scenarioTitles[scenario]);
      if (isImport) {
        await hold(`${index + 1}. ${scenarioTitles[scenario]}\n입고의 연도·차수·농장·인보이스를 확인하고 수정 요청을 시작합니다.`);
        await page.waitForSelector('[data-row-key="9001"]'); await moveClick(await page.$('[data-row-key="9001"]'));
        await click('수입부 수정 요청'); await page.waitForSelector('dialog[open] select[aria-label="수정 농장"]');
        if (scenario === 'farm') { await hold('품목별 수량은 그대로이고 농장 이름만 잘못된 경우입니다.\n수정 방식은 ‘농장만 수정’을 유지하고 올바른 농장을 선택합니다.'); await select('select[aria-label="수정 농장"]', '연습농장 나'); }
        else {
          await hold(scenario === 'product' ? '수량 100단은 그대로 두고 레드를 핑크로 바꾸는 예입니다.\n정확한 품목명으로 고친 전체 파킹 파일을 준비합니다.' : '입고 수량을 100단에서 80단으로 줄이는 예입니다.\n변경량 -20이 아니라 최종 수량 80이 담긴 전체 파일을 준비합니다.', 7);
          await select('select[aria-label="수정 방식"]', 'REPLACE');
          const input = await page.$('input[aria-label="수정 파킹 파일"]'); await input.uploadFile(writePacking(scenario));
          await page.waitForFunction(() => document.querySelector('dialog')?.textContent.includes('1행'));
        }
        await fill('input[aria-label="수정 사유"]', `${scenarioTitles[scenario]} · 파킹 자료 확인 완료`);
        await click('변경 내역 미리보기'); await page.waitForSelector('[aria-label="수정 미리보기"]');
        await hold('농장과 품목별 기존 수량·수정 후 수량·증감을 비교합니다.\n다른 입고를 선택하지 않았는지도 확인하세요.', 6);
        await checkedLabel('위 변경 내역과 기존 입고 교체를 확인했습니다.'); await click('수정 요청 초안 저장');
        await click('목록으로 돌아가기', 'dialog'); await page.waitForFunction(() => !document.querySelector('dialog'));
        await click(`#${index + 1} 열기`); await page.waitForSelector('[aria-label="정정 요청 상세"]');
        await hold('초안을 저장한 뒤 요청 상세를 다시 확인합니다.\n‘영업지원에 수정 요청’을 눌러야 검토 대기 상태로 전달됩니다.', 6);
        await click('영업지원에 수정 요청'); await page.waitForFunction(() => document.querySelector('[aria-label="정정 요청 상세"]')?.textContent.includes('검토 대기'));
        await hold('검토 대기 상태가 되었습니다. 영업지원의 최종 확정을 기다립니다.\n아직 실제 입고와 분배는 바뀌지 않습니다.');
        await click('요청 목록으로');
      } else {
        await click(`#${index + 1} 열기`); await page.waitForSelector('[aria-label="정정 요청 상세"]');
        await hold(`${index + 1}. ${scenarioTitles[scenario]}\n요청 사유와 농장·품목별 입고 최종 수량을 먼저 확인합니다.`, 6);
        if (scenario === 'farm') {
          await hold('농장만 바뀌면 분배 수량·재고·견적·매출 금액은 유지합니다.\n농장 배정 연결도 바꿔야 하는 행은 새 농장으로 매칭합니다.', 7);
        } else {
          await hold('변경할 업체·차수·품목·출고일을 확인하고 분배 행을 선택합니다.\n선택하지 않은 분배는 유지됩니다.');
          await moveClick(await page.$('input[aria-label="분배 30 선택"]'));
          if (scenario === 'product') {
            await select('select[aria-label="1행 대상 품목"]', '2');
            await checkedLabel('주문이 없으면 양수 신규 연결');
            await hold('대상 품목을 핑크로 바꾸고 최종 분배 60단과 판매단가를 확인합니다.\n단위가 다르면 수량을 환산하고, 대체품 주문이 없을 때만 신규 연결을 확인합니다.', 8);
          } else {
            await fill('input[aria-label="1행 최종수량"]', '40');
            await hold('기존 분배 60단을 최종 40단으로 줄입니다.\n감소만으로 끝낼 수 있으며 다른 품목을 억지로 추가할 필요는 없습니다.', 7);
          }
        }
        // Linked-cost/profit/farm controls are filled by the final UI-specific helper below.
        await matchLinkedControls({ page, scenario, moveClick, select, fill, hold, click, checkedLabel });
        await click('매칭 임시저장'); await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === '입고·분배·견적·매출 영향 검토' && !button.disabled));
        await hold('매칭 임시저장은 검토 내용을 보관하는 단계입니다.\n아직 ERP 원장은 바뀌지 않습니다.');
        await click('입고·분배·견적·매출 영향 검토');
        await page.waitForFunction(() => document.body.textContent.includes('최종 반영 전후'));
        await hold('분배 수량과 금액, 원가·손익, 농장 배정 및 후속 차수 재고를 검토합니다.\n잘못된 항목이 있으면 확정하지 말고 매칭을 고칩니다.', 8);
        await page.$eval('[aria-label="원가·손익 최종 검산"]', element => element.scrollIntoView({ block: 'start' }));
        await hold('원가와 이미 확정된 손익도 정정 전후 금액을 비교합니다.\n기존 확정본은 이력으로 남고, 검산한 새 정정본이 함께 저장됩니다.', 8);
        await checkedLabel('입고와 분배의 최종값'); await click('최종 확정');
        await page.waitForFunction(() => document.querySelector('[aria-label="정정 요청 상세"]')?.textContent.includes('적용 완료'));
        await hold('적용 완료 상태와 처리 결과를 확인합니다.\n이미 발송한 견적서는 정정된 내용으로 다시 발행해야 합니다.', 6);
        await click('요청 목록으로');
      }
    }
    if (!isImport) { await click('처리 이력'); await hold('처리 이력에서 적용 완료 요청을 다시 열어 결과를 확인할 수 있습니다.\n오류나 통신 중단 때는 이력부터 확인하고 안내된 같은 작업번호로 재시도하세요.', 8); }
    assert.deepEqual(errors, []);
    assert.equal(posts.filter(body => body.action === (isImport ? 'submit' : 'approve')).length, 3);
    const result = await rec.stop(); stopped = true;
    if (!dry) { const guide = workflow.guides.find(item => item.id === role); guide.status = 'ready'; guide.chapters = result.chapters; fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n'); }
    console.log(`PASS ${role}: actual UI ${dry ? 'dry run' : 'recording'}, farm/product/quantity, all APIs synthetic, ERP writes=0`);
  } finally { if (!stopped) await rec.stop().catch(() => {}); await page.close(); }
}
async function matchLinkedControls({ page, scenario, moveClick, select, fill, hold, click, checkedLabel }) {
  if (scenario !== 'farm') {
    await hold('수정 파일의 행을 기존 입고행에 연결합니다.\n품목만 바뀐 같은 입고라면 신규가 아니라 원래 입고행을 선택합니다.', 6);
    await select('select[aria-label="입고 연결 1행"]', '101');
  }
  await click('농장 배정표 검토');
  if (scenario === 'farm') await select('select[aria-label="10:1 농장 1"]', '2');
  if (scenario === 'quantity') await fill('input[aria-label="10:1 농장 수량 1"]', '40');
  if (scenario === 'product') {
    const add = await page.evaluateHandle(() => [...document.querySelectorAll('[aria-label="연결 원장 검토"] h5')].find(heading => heading.textContent.includes('장미 핑크'))?.parentElement.querySelector('button'));
    await moveClick(add.asElement()); await add.dispose();
    await select('select[aria-label="10:2 농장 1"]', '1'); await fill('input[aria-label="10:2 농장 수량 1"]', '60');
  }
  await hold(scenario === 'product' ? '원품목 배정은 0, 이동 품목 배정은 60단인지 확인합니다.\n농장별 배정 합계는 각 품목의 최종 분배수량과 같아야 합니다.' : scenario === 'quantity' ? '분배를 40단으로 줄였으므로 농장 배정도 최종 40단으로 맞춥니다.\n줄인 수량을 다른 품목에 추가하지 않아도 됩니다.' : '농장 연결만 바꾸고 기존 배정수량 60단은 그대로 둡니다.', 6);
  await click('연결 원가 검토');
  if (scenario !== 'farm') {
    await select(`select[aria-label="${docId} 원가 연결 1"]`, '0');
    if (scenario === 'quantity') await fill(`input[aria-label="${docId} 원가 수량 1"]`, '80');
    await hold(scenario === 'quantity' ? '인보이스 원문 행을 수정 입고행에 연결합니다.\n최종 연결수량도 입고 최종값인 80단으로 맞춥니다.' : '인보이스 원문 행을 새 품목의 수정 입고행에 연결합니다.\n입고 수량은 그대로이므로 최종 연결수량은 100단을 유지합니다.', 7);
    const freight = await page.evaluateHandle(() => [...document.querySelectorAll('summary')].find(node => node.textContent.includes('원가 배분 기준')));
    if (freight.asElement()) { await moveClick(freight.asElement()); await freight.dispose(); }
    await hold('운송원가의 환율·운임과 품목별 무게·단위·관세·판매단가를 확인합니다.\n품목이 바뀌었다면 새 품목의 실제 기준으로 고쳐야 합니다.', 7);
  } else await hold('농장만 바꾸는 경우에도 연결 원가와 확정 손익 대상을 확인합니다.\n수량과 경제값이 같으면 금액은 보존됩니다.', 6);
  await fill('input[aria-label="원가·손익 정정 사유"]', `${scenarioTitles[scenario]} · 연결 원가와 확정 손익 검토`);
  await checkedLabel('연결 원가와 손익 정정 내용을 확인했습니다');
}
async function main() {
  fs.mkdirSync(path.join(root, '.verify'), { recursive: true });
  const listener = net.createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve)); const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  const secret = crypto.randomUUID(), base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '-p', String(port)], { env: { ...process.env, DB_SERVER: '', JWT_SECRET: secret }, stdio: 'ignore', windowsHide: true }); let browser;
  try {
    for (let count = 0; count < 60; count++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch {} if (count === 59) throw Error('Local UI server did not start; build the final UI first'); await new Promise(resolve => setTimeout(resolve, 1000)); }
    browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox'] });
    const chosen = process.argv.includes('--role') ? [process.argv[process.argv.indexOf('--role') + 1]] : ['import', 'sales-support'];
    for (const role of chosen) { assert(['import', 'sales-support'].includes(role)); await recordRole(browser, base, secret, role); }
  } finally { await browser?.close(); server.kill(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
