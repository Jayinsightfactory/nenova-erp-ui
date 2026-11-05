// Real tested UI, synthetic fixtures only. No request is forwarded to an ERP API.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), net = require('node:net'), crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const jwt = require('jsonwebtoken'), puppeteer = require('puppeteer-core');
const { createWorkflowGuideRecorder } = require('./lib/workflow-guide-recorder.cjs');
const root = process.cwd(), dry = process.argv.includes('--dry-run');
const onlyScenario=process.argv.includes('--scenario')?process.argv[process.argv.indexOf('--scenario')+1]:null;
if(onlyScenario&&!dry)throw Error('Single scenario is for dry-run checks only');
const registryPath = path.join(root, 'config/workflow-guides.json');
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
const workflow = registry.workflows.find(item => item.id === 'incoming-approval');
const clone = value => JSON.parse(JSON.stringify(value));
const products = [{ ProdKey: 1, ProdName: '장미 레드 50' }, { ProdKey: 2, ProdName: '장미 핑크 50' }].map(product => ({ ...product, OutUnit: '단', EstUnit: '단', isDeleted: false, BunchOf1Box: 10, SteamOf1Bunch: 10, SteamOf1Box: 100 }));
const docId = '11111111-1111-8111-8111-111111111111', lineId = '44444444-4444-8444-8444-444444444444';
const header = { WarehouseKey: 9001, OrderYear: '2026', OrderWeek: '41-01', FarmName: '연습농장 가', InvoiceNo: 'GUIDE-001', AWB: '연습용', InputDate: '2026-10-08', UploadDtm: '2026-10-08', totalBox: 10, totalBunch: 100, totalSteam: 1000, GrossWeight: 20, ChargeableWeight: 20, FreightRateUSD: 2 };
const before = [{ WdetailKey: 101, ProdKey: 1, ProdName: products[0].ProdName, OrderCode: '연습', BoxQuantity: 10, BunchQuantity: 100, SteamQuantity: 1000, SteamOf1Box:100, SteamOf1Bunch:10, OutQuantity: 100, EstQuantity: 100, UPrice: 1, TPrice: 100, 주문코드: '연습', 단위: '단', 단송이: 10, 박스송이: 100, 단가: 1, 총액: 100 }];
const scenarioTitles = { farm: '농장만 수정', product: '품목·수량 함께 변경', quantity: '수량만 변경·부족 문제 해결',add:'기존 입고에 품목·수량 추가',cancel:'기존 입고의 품목·수량 취소' };

function correction(scenario) {
  const item=(p,qty,source=101)=>({sourceWdetailKey:source,prodName:p.ProdName,orderCode:'연습',boxQty:qty/10,bunchQty:qty,steamQty:qty*10,steamOf1Box:100,steamOf1Bunch:10,unitPrice:1,totalPrice:qty});
  return {warehouseKey:9001,orderYear:'2026',orderWeek:'41-01',mode:scenario==='farm'?'FARM':'REPLACE',editKind:{farm:'FARM',product:'PRODUCT',quantity:'QUANTITY',add:'ADD',cancel:'CANCEL'}[scenario],farmName:scenario==='farm'?'연습농장 나':header.FarmName,
    ...(scenario==='farm'?{}:{fileName:'입고행 직접 정정',fileMeta:{},items:scenario==='add'?[item(products[0],100),item(products[1],20,null)]:[item(scenario==='product'?products[1]:products[0],scenario==='quantity'?80:scenario==='cancel'?0:100)]})};
}
function previewFor(c) {
  const scenario={FARM:'farm',PRODUCT:'product',QUANTITY:'quantity',ADD:'add',CANCEL:'cancel'}[c.editKind]??(c.mode==='FARM'?'farm':c.items?.[0]?.prodName===products[1].ProdName?'product':'quantity');
  const after=c.mode==='FARM'?clone(before):c.items.map(item=>{const p=products.find(p=>p.ProdName===item.prodName);assert(p,'fixture exact product');return {SourceWdetailKey:item.sourceWdetailKey,ProdKey:p.ProdKey,ProdName:p.ProdName,OrderCode:item.orderCode,BoxQuantity:Number(item.boxQty),BunchQuantity:Number(item.bunchQty),SteamQuantity:Number(item.steamQty),SteamOf1Box:Number(item.steamOf1Box),SteamOf1Bunch:Number(item.steamOf1Bunch),OutQuantity:Number(item.bunchQty),EstQuantity:Number(item.bunchQty),UPrice:Number(item.unitPrice),TPrice:Number(item.totalPrice)};});
  const keys=[...new Set([...before,...after].map(r=>r.ProdKey))];
  const changes=keys.map(pk=>{const sum=rows=>rows.filter(r=>r.ProdKey===pk).reduce((n,r)=>n+r.OutQuantity,0);return {prodKey:pk,prodName:products.find(p=>p.ProdKey===pk).ProdName,unit:'단',before:sum(before),after:sum(after),delta:sum(after)-sum(before)};});
  return {success:true,canCommit:true,issues:[],farmBefore:header.FarmName,farmAfter:c.farmName,before,after,changes,scenario};
}
function factsFor(request) {
  const preview = previewFor(request.correction);
  return { receipt: { header, details: before }, receiptPlan: { ...preview, keys: preview.changes.map(c=>c.prodKey), detailsChanged: preview.scenario !== 'farm' }, products,
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
async function recordRole(browser, base, secret, role) {
  const isImport = role === 'import', requests = isImport ? [] : ['farm', 'product', 'quantity'].map(requestFixture);
  const page = await browser.newPage();page.setDefaultNavigationTimeout(120000);const errors = [], posts = [];
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
      if (u.pathname === '/api/products/search') data.products = products;
      if (u.pathname === '/api/auth/me') data.user = user;
      if (u.pathname === '/api/warehouse') data.masters = [header];
      if (u.pathname === '/api/warehouse/9001') data.items = before;
      if (u.pathname === '/api/warehouse/correction') data = { success: true, draftOwner: user.userId, header, baselineDigest:'c'.repeat(64), details: before, farms: [{ FarmName: header.FarmName }, { FarmName: '연습농장 나' }], history: [] };
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
            assert(!isImport); assert(body.matching.financial.prepared || body.matching.financial.acknowledged);
            request.matching = body.matching; request.reviewedBy='guide-support'; request.revision++; data.revision=request.revision;
          }
          if (body.action === 'preview') {
            const p = previewFor(request.correction), quantity = p.scenario === 'quantity' ? 40 : 60, pk = p.scenario === 'product' ? 2 : 1;
            const common = { customer: '연습 꽃집', year: '2026', week: '41-01', unit: '단' };
            const groups = !request.matching.rows.length ? [] : p.scenario === 'product' ? [{ ...common, key: '10:1', product: products[0].ProdName, before: 60, after: 0, beforeAmount: 60000, afterAmount: 0, beforeVat: 6000, afterVat: 0, stockDelta: 60 }, { ...common, key: '10:2', product: products[1].ProdName, before: 0, after: 60, beforeAmount: 0, afterAmount: 60000, beforeVat: 0, afterVat: 6000, stockDelta: -60 }] : [{ ...common, key: '10:1', product: products[0].ProdName, before: 60, after: quantity, beforeAmount: 60000, afterAmount: quantity * 1000, beforeVat: 6000, afterVat: quantity * 100, stockDelta: 60 - quantity }];
            const beforeTotals = { N: 60000, I: 16800, E: 0, F: 11200, J: 43200, K: .72 }, afterTotals = p.scenario === 'quantity' ? { N: 60000, I: 16800, E: 0, F: 7200, J: 43200, K: .72 } : beforeTotals;
            data = { ...p, digest: 'a'.repeat(64), previewToken: 'synthetic-guide-token', groups, farmEvidence: (request.matching.farmGroups??[]).map(group => ({ shipmentKey: group.shipmentKey, prodKey: group.prodKey, before: group.prodKey === 1 ? [{ FarmKey: 1, ShipmentQuantity: 60 }] : [], after: group.assignments.map(item => ({ FarmKey: Number(item.farmKey), ShipmentQuantity: Number(item.quantity) })) })), financialSummary: { costs: { invoices: [{ beforeTotal: 28000, afterTotal: p.scenario === 'quantity' ? 24000 : 28000, preserveEconomics: p.scenario === 'farm' }], freight: [{ beforeTotal: 28000, afterTotal: p.scenario === 'quantity' ? 24000 : 28000 }] }, profitBefore: [{ orderYear: '2026', major: '41', totals: beforeTotals }, { orderYear: '2026', major: '44', totals: beforeTotals }], profitAfter: [{ orderYear: '2026', major: '41', totals: afterTotals }, { orderYear: '2026', major: '44', totals: afterTotals }] }, stockPreview: p.scenario === 'farm' ? [] : [{ StockKey: 41, ProdKey: pk, OrderYear: '2026', OrderWeek: '41-01', Stock: 40, projected: 40 }, { StockKey: 44, ProdKey: pk, OrderYear: '2026', OrderWeek: '44-01', Stock: 25, projected: 25 }], externalDocuments: '이미 발송한 견적서는 정정 후 재발행이 필요합니다. 외부 회계 전표는 자동 변경하지 않습니다.' };
            if(p.scenario==='product'&&!request.matching.financial.acknowledged){data.canCommit=false;data.issues=[{code:'APPROVAL_COST_NEW_PRODUCT',message:'변경 품목의 원가 근거를 확인하세요.'}];}
            if (p.scenario === 'quantity') {
              const acknowledged = request.matching.stockAdjustment?.acknowledged === true;
              if (acknowledged) assert.deepEqual(request.matching.stockAdjustment.rows, [{ prodKey: 1, quantity: 5, year: '2026', week: '44-01' }]);
              data.canCommit = acknowledged;
              data.stockAdjustmentPreview = { required: !acknowledged, canAdjust: true, applied: acknowledged, fingerprint: 'b'.repeat(64), rows: [{ prodKey: 1, prodName: products[0].ProdName, unit: '단', year: '2026', week: '44-01', quantity: 5, currentRemain: acknowledged ? 45 : 40, future: [{ year: '2026', week: '44-01', remain: acknowledged ? 0 : -5 }] }] };
              data.stockPreview = [{ StockKey: 41, ProdKey: 1, OrderYear: '2026', OrderWeek: '41-01', Stock: 40, projected: 40 }, { StockKey: 44, ProdKey: 1, OrderYear: '2026', OrderWeek: '44-01', Stock: -5, projected: acknowledged ? 0 : -5 }];
              if (!acknowledged) { data.issues = [{ code:'APPROVAL_STOCK_SHORTAGE',message: '후속 차수에 5단이 부족합니다. 표시된 수량의 재고조정 동의가 필요합니다.' }]; delete data.financialSummary; }
            }
          }
          if (body.action === 'approve') { assert(!isImport && body.confirmed); request.status = 'applied'; request.result = { warehouseKey: 9001, shipmentGroups: request.matching.rows?.length ? 1 : 0, stockProducts: previewFor(request.correction).scenario === 'farm' ? 0 : previewFor(request.correction).changes.length }; request.appliedAt = '2026-11-04 10:00'; request.evidence = { receiptChanges: previewFor(request.correction).changes }; }
        }
      }
      await r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    } catch (error) { errors.push(`Fixture: ${error.message}`); if (!r.isInterceptResolutionHandled()) await r.abort(); }
  });
  await page.goto(`${base}/import/tools?tab=incoming&warehouseKey=9001&from=2026-10-01&to=2026-11-30`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('nav[aria-label="입고 정정 처리 단계"]');
  const rec = dry ? { caption: async () => {}, chapter: () => {}, pause: async () => {}, stop: async () => null } : await createWorkflowGuideRecorder(page, { root, workflowId: workflow.id, guideId: role, title: `${isImport ? '수입부' : '영업지원'} 입고 수정 가이드`, sourceFiles: workflow.sourceFiles, fixtureOnly: true });
  const hold = async (text, seconds = 5) => { await rec.caption(text); await rec.pause(seconds * 1000); };
  let pointer = { x: 40, y: 80 };
  const movePointer = async (x, y) => { const start = pointer; for (let step = 1; step <= (dry ? 1 : 12); step++) { const ratio = step / (dry ? 1 : 12); await page.mouse.move(start.x + (x - start.x) * ratio, start.y + (y - start.y) * ratio); await rec.pause(25); } pointer = { x, y }; };
  const moveClick = async element => {
    assert(element, 'Guide target missing'); await element.evaluate(node => node.scrollIntoView({ behavior: 'instant', block: 'center' }));
    const box = await element.boundingBox(); assert(box, 'Guide target not visible');
    await movePointer(box.x + box.width / 2, box.y + box.height / 2); await rec.pause(450); await element.click(); await rec.pause(600);
  };
  const click = async (text, scope = 'body') => {
    await page.waitForFunction(({ text, scope }) => [...(document.querySelector(scope)?.querySelectorAll('button,a,summary') ?? [])].some(node => node.textContent.trim() === text && !node.disabled), { timeout: 15000 }, { text, scope }).catch(() => { throw Error(`Missing enabled button: ${text}`); });
    const handle = await page.evaluateHandle(({ text, scope }) => [...document.querySelector(scope).querySelectorAll('button,a,summary')].find(node => node.textContent.trim() === text && !node.disabled), { text, scope }); assert(handle.asElement(), `Missing enabled button: ${text}`); await moveClick(handle.asElement()); await handle.dispose();
  };
  const select = async (selector, value) => {
    const element = await page.$(selector); assert(element, `Missing select: ${selector}`);
    await element.evaluate(node => node.scrollIntoView({ behavior: 'instant', block: 'center' })); const box = await element.boundingBox();
    await movePointer(box.x + box.width / 2, box.y + box.height / 2); await element.focus(); await rec.pause(450);
    await element.select(String(value)); await rec.pause(700); assert.equal(await element.evaluate(node => node.value), String(value), `Selection did not persist: ${selector}`);
  };
  const fill = async (selector, text) => { const element = await page.$(selector); assert(element, `Missing input: ${selector}`); await moveClick(element); await element.focus(); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace'); await element.type(String(text), { delay: dry ? 0 : 60 }); await rec.pause(500); assert.equal(await element.evaluate(node => node.value), String(text), `Input did not replace value: ${selector}`); };
  const checkedLabel = async text => { const handle = await page.evaluateHandle(text => [...document.querySelectorAll('label')].find(label => label.textContent.includes(text))?.querySelector('input[type="checkbox"]'), text); assert(handle.asElement(), `Missing checkbox: ${text}`); await moveClick(handle.asElement()); await handle.dispose(); };
  let stopped = false;
  try {
    await hold(isImport ? '수입부는 기존 입고에서 수정할 내용과 사유를 입력하고 요청합니다.\n영업지원 최종 확정 전까지 원장은 바뀌지 않습니다.' : '요청을 열면 시스템이 입고·분배·재고·원가·손익을 자동 검증합니다.\n실제 문제가 있는 부분만 해결하고 최종 확정합니다.', 7);
    if(!isImport)await click('검토·확정');
    for(const [index,scenario] of (isImport?['farm','product','quantity','add','cancel']:['farm','product','quantity']).filter(s=>!onlyScenario||s===onlyScenario).entries()){
      console.log(`${dry?'CHECK':'RECORD'} ${role}: ${scenario}`);rec.chapter(scenario,scenarioTitles[scenario]);
      if(isImport){
        await hold(`${index+1}. ${scenarioTitles[scenario]}\n선택 농장의 기존 입고 안에서 수정합니다.`,5);
        await page.waitForSelector('[data-row-key="9001"]');await moveClick(await page.$('[data-row-key="9001"]'));await click('수입부 수정 요청');
        await page.waitForSelector('dialog[open] select[aria-label="수정 종류"]');
        if(scenario==='farm')await select('select[aria-label="변경 농장"]','연습농장 나');
        else{
          await select('select[aria-label="수정 종류"]',{product:'PRODUCT',quantity:'QUANTITY',add:'ADD',cancel:'CANCEL'}[scenario]);
          if(scenario==='product'){
            await fill('input[aria-label="1행 품목 검색"]',products[1].ProdName);
            await fill('input[aria-label="1행 최종수량"]','90');
            await hold('기존 포장·매입값을 제안값으로 보존하고 다른 품목과 최종 90단을 정합니다.\n새 품목의 원가 근거는 영업지원 검증 문제로 전달됩니다.',6);
          }else if(scenario==='add'){
            await click('품목·수량 추가','dialog');await fill('input[aria-label="2행 품목 검색"]',products[1].ProdName);await fill('input[aria-label="2행 최종수량"]','20');
            const target=await page.$('input[aria-label="2행 단가"]');await target.evaluate(n=>n.closest('details').open=true);
            await fill('input[aria-label="2행 단가"]','1');await fill('input[aria-label="2행 총액"]','20');
            await hold('추가 품목과 최종 20단을 정하면 품목마스터 기준으로 포장을 계산합니다.\n현재 입고에 매입 근거가 없는 경우에만 확인한 단가·총액을 입력합니다.',6);
          }else if(scenario==='cancel'){await click('이 행 전량 취소','dialog');await hold('선택 입고의 해당 행을 최종 수량 0으로 취소합니다.\n입고 건 전체를 삭제하지 않고 기존 이력을 보존합니다.',6);
          }else{await fill('input[aria-label="1행 최종수량"]','80');await hold('같은 품목의 최종 수량을 80단으로 바꿉니다.\n기존 같은 입고행의 포장비율과 금액을 비례 계산합니다.',6);}
        }
        await fill('input[aria-label="수정 사유"]',`${scenarioTitles[scenario]} · 실제 파킹 자료 확인`);
        if(dry&&scenario==='quantity')await page.screenshot({path:'.verify/simple-import-quantity.png',fullPage:false});
        await click('변경 요약 확인');await page.waitForSelector('[aria-label="요청 변경 요약"]');
        await hold('기존값과 수정 후 최종값을 확인한 뒤 요청합니다.\n품목·수량 추가와 취소도 이 입고 안의 행을 대상으로 합니다.',6);
        await click('영업지원에 수정 요청','dialog');await page.waitForFunction(()=>document.querySelector('dialog')?.textContent.includes('영업지원에 수정 요청했습니다.'));
        await hold('영업지원에 검토 대기로 전달했습니다.\n별도의 초안 제출 단계 없이 요청이 완료됩니다.',5);await click('목록으로 돌아가기','dialog');
      }else{
        await click(`#${index+1} 열기`);await page.waitForFunction(()=>document.body.textContent.includes('최종 반영 전후'));
        await hold(`${index+1}. ${scenarioTitles[scenario]}\n요청값과 자동 검증 결과를 확인합니다.`,5);
        if(dry&&scenario==='farm')await page.screenshot({path:'.verify/simple-support-no-problem.png',fullPage:false});
        if(scenario==='farm')await hold('문제가 없으면 편집기 없이 변경 요약과 최종 확정만 보입니다.\n농장만 바뀌므로 분배·재고·견적·매출 금액을 보존합니다.',7);
        if(scenario==='product'){
          await hold('새 품목의 원가 근거가 필요한 경우에만 원가 문제 카드가 나옵니다.\n기존 다른 품목의 단가·중량을 임의로 확정하지 않습니다.',7);
          const freight=await page.evaluateHandle(()=>[...document.querySelectorAll('summary')].find(n=>n.textContent.includes('원가 배분 기준')));await moveClick(freight.asElement());await freight.dispose();
          await fill('input[aria-label="운송 1 박스 중량"]','2.5');
          await fill('input[aria-label="원가·손익 정정 사유"]','새 품목의 실제 중량·원가 근거 확인');await checkedLabel('연결 원가와 손익 정정 내용을 확인했습니다');
          await click('문제 해결 후 다시 검증');await page.waitForFunction(()=>document.body.textContent.includes('자동 검증 완료'));
        }
        if(scenario==='quantity'){
          await page.waitForSelector('[aria-label="부족재고 명시 확인"]');await page.$eval('[aria-label="부족재고 명시 확인"]',n=>n.scrollIntoView({block:'center'}));
          await hold('실제 부족이 있는 경우 품목·차수·정확한 부족수량을 확인합니다.\n임의 업체 분배를 줄이지 않습니다. 다른 배분 조정도 선택할 수 있습니다.',7);
          await checkedLabel('표시된 부족수량만 재고조정하는 데 동의합니다');await click('문제 해결 후 다시 검증');await page.waitForFunction(()=>document.body.textContent.includes('자동 검증 완료'));
          await hold('명시 동의한 5단만 최종 확정 시 재고조정합니다.\n검산이 실패하면 입고·원가·손익을 포함해 함께 되돌립니다.',6);
        }
        await page.$eval('[aria-label="원가·손익 최종 검산"]',n=>n.scrollIntoView({block:'center'}));await hold('요약에서 원가·손익의 변경 금액을 확인합니다.\n세부 검산과 후속 재고는 필요한 경우 펼쳐 봅니다.',6);
        await click('최종 확정');await page.waitForFunction(()=>document.querySelector('[aria-label="정정 요청 상세"]')?.textContent.includes('적용 완료'));
        await hold('적용 완료 결과를 확인합니다.\n이미 발송한 견적서는 정정 내용으로 다시 발행하세요.',5);await click('요청 목록으로');
      }
    }
    if(!isImport){await click('처리 이력');await hold('처리 이력에서 결과를 다시 확인할 수 있습니다.\n통신 오류 때는 같은 작업번호로 결과를 다시 확인하세요.',5);}
    assert.deepEqual(errors, []);
    assert.equal(posts.filter(body => body.action === (isImport ? 'submit' : 'approve')).length, onlyScenario?1:isImport?5:3);
    const result = await rec.stop(); stopped = true;
    if (!dry) { const guide = workflow.guides.find(item => item.id === role); guide.status = 'ready'; guide.chapters = result.chapters; fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n'); }
    console.log(`PASS ${role}: actual UI ${dry ? 'dry run' : 'recording'}, farm/product/quantity, all APIs synthetic, ERP writes=0`);
  } finally { if (!stopped) { await page.screenshot({ path: `.verify/guide-${role}-failure.png` }).catch(() => {}); await rec.stop().catch(() => {}); } await page.close(); }
}
async function main() {
  fs.mkdirSync(path.join(root, '.verify'), { recursive: true });
  const listener = net.createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve)); const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  const secret = crypto.randomUUID(), base = `http://127.0.0.1:${port}`;
  const dev=process.argv.includes('--dev'),instrumentation=path.join(root,'instrumentation.js'),original=dev?fs.readFileSync(instrumentation):null;
  if(dev){fs.writeFileSync(path.join(root,'.verify/instrumentation-before-guide.js'),original);fs.writeFileSync(instrumentation,'// Synthetic guide development server only; restored in finally.\nexport async function register() {}\n');}
  const log=fs.openSync(path.join(root,'.verify/simple-guide-server.log'),'w');
  const server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), ...(process.argv.includes('--dev')?['dev','--webpack']:['start']), '-p', String(port)], { env: { ...process.env, DB_SERVER: '', JWT_SECRET: secret }, stdio: ['ignore',log,log], windowsHide: true });fs.closeSync(log); let browser;
  try {
    for (let count = 0; count < 60; count++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch {} if (count === 59) throw Error('Local UI server did not start; build the final UI first'); await new Promise(resolve => setTimeout(resolve, 1000)); }
    browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox'] });
    const chosen = process.argv.includes('--role') ? [process.argv[process.argv.indexOf('--role') + 1]] : ['import', 'sales-support'];
    for (const role of chosen) { assert(['import', 'sales-support'].includes(role)); await recordRole(browser, base, secret, role); }
  } finally { await browser?.close(); server.kill();if(dev)fs.writeFileSync(instrumentation,original); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
