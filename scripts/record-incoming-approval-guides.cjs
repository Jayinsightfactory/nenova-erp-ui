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
const header = { WarehouseKey: 9001, OrderYear: '2026', OrderWeek: '45-01', FarmName: '연습농장 가', InvoiceNo: 'GUIDE-001', AWB: '000-1234 5678', InputDate: '2026-11-05', UploadDtm: '2026-11-05', totalBox: 10, totalBunch: 100, totalSteam: 1000, GrossWeight: 20, ChargeableWeight: 20, FreightRateUSD: 2 };
const before = [{ WdetailKey: 101, ProdKey: 1, ProdName: products[0].ProdName, OrderCode: '연습', BoxQuantity: 10, BunchQuantity: 100, SteamQuantity: 1000, SteamOf1Box:100, SteamOf1Bunch:10, OutQuantity: 100, EstQuantity: 100, UPrice: 1, TPrice: 100, 주문코드: '연습', 단위: '단', 단송이: 10, 박스송이: 100, 단가: 1, 총액: 100 }];
const scenarioTitles = { farm: '농장만 수정', price: '입고 단가만 변경', product: '품목·수량 함께 변경', quantity: '수량만 변경·부족 문제 해결',add:'기존 입고에 품목·수량 추가',cancel:'기존 입고의 품목·수량 취소' };

function correction(scenario) {
  if (scenario === 'price') return {warehouseKey:9001,orderYear:'2026',orderWeek:'45-01',mode:'REPLACE',editKind:'PRICE',farmName:header.FarmName,price:{sourceWdetailKey:101,expectedUnitPrice:1,unitPrice:2}};
  const item=(p,qty,source=101)=>({sourceWdetailKey:source,prodName:p.ProdName,orderCode:'연습',boxQty:qty/10,bunchQty:qty,steamQty:qty*10,steamOf1Box:100,steamOf1Bunch:10,unitPrice:1,totalPrice:qty});
  return {warehouseKey:9001,orderYear:'2026',orderWeek:'45-01',mode:scenario==='farm'?'FARM':'REPLACE',editKind:{farm:'FARM',product:'PRODUCT',quantity:'QUANTITY',add:'ADD',cancel:'CANCEL'}[scenario],farmName:scenario==='farm'?'연습농장 나':header.FarmName,
    ...(scenario==='farm'?{}:{fileName:'입고행 직접 정정',fileMeta:{},items:scenario==='add'?[item(products[0],100),item(products[1],20,null)]:[item(scenario==='product'?products[1]:products[0],scenario==='quantity'?80:scenario==='cancel'?0:100)]})};
}
function previewFor(c) {
  if (c.editKind === 'PRICE') {
    assert.equal(c.price.sourceWdetailKey, 101);
    assert.equal(c.price.expectedUnitPrice, 1);
    const after = [{...before[0],UPrice:c.price.unitPrice,TPrice:before[0].OutQuantity*c.price.unitPrice}];
    const changes = [{prodKey:1,prodName:products[0].ProdName,unit:'단',before:100,after:100,delta:0}];
    return {success:true,canCommit:true,issues:[],farmBefore:header.FarmName,farmAfter:c.farmName,before,after,changes,scenario:'price'};
  }
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
    profitPeriods: [{ orderYear: '2026', major: '45', confirmed: true }, { orderYear: '2026', major: '46', confirmed: true }],
    masters: [{ ShipmentKey: 10, CustKey: 1, CustName: '연습 꽃집', OrderYear: '2026', OrderWeek: '45-03', OrderYearWeek: '202645', isFix: true, isDeleted: false }, { ShipmentKey:11,CustKey:2,CustName:'연습 꽃집 나',OrderYear:'2026',OrderWeek:'45-03',OrderYearWeek:'202645',isFix:false,isDeleted:false }],
    details: [{ SdetailKey: 20, ShipmentKey: 10, ProdKey: 1, OutQuantity: 60, Cost: 1100, Amount: 60000, Vat: 6000, isFix: true },{SdetailKey:21,ShipmentKey:11,ProdKey:1,OutQuantity:20,Cost:1100,Amount:20000,Vat:2000,isFix:false}],
    dates: [{ SdateKey: 30, SdetailKey: 20, ShipmentQuantity: 60, EstQuantity: 60, Cost: 1100, Amount: 60000, Vat: 6000, DateText: '2026-11-05' },{SdateKey:31,SdetailKey:21,ShipmentQuantity:20,EstQuantity:20,Cost:1100,Amount:20000,Vat:2000,DateText:'2026-11-06'}],
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
  const {resolveReceiptBunch}=await import('../lib/receiptBunchQuantity.js');
  const isImport = role === 'import', requests = isImport ? [] : ['farm', 'product', 'quantity', 'price'].map(requestFixture);
  let loseApproval=dry&&!isImport,lostApproval=null,replayedApproval=false;
  const page = await browser.newPage();page.setDefaultNavigationTimeout(120000);const errors = [], posts = [];
  let packingSaves = 0;
  let mainNavigations=0;page.on('framenavigated',frame=>{if(frame===page.mainFrame())mainNavigations++;});
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
      if (u.pathname === '/api/warehouse') data.masters = Array.from({length:12},(_,i)=>({...header,WarehouseKey:9001+i,OrderWeek:i===1?'45-02':i?'46-01':header.OrderWeek,FarmName:i?'다른 농장':header.FarmName,InvoiceNo:i?`GUIDE-${i+1}`:header.InvoiceNo}));
      if (u.pathname === '/api/warehouse' && r.method() === 'POST') {
        assert(isImport,'fixture import authorization');
        const body=JSON.parse(r.postData());
        assert.equal(body.orderYear,'2026');
        const results=body.items.map((item,index)=>resolveReceiptBunch(products[index],{
          boxQuantity:item.boxQty,stemQuantity:item.steamQty,bunchQuantity:item.bunchQty,stemsPerBunch:item.steamOf1Bunch,
          stemsPerBox:item.steamOf1Box,confirmation:item.bunchConfirmation,legacyWorkbook:true,scopeKey:[body.orderYear,body.orderWeek,body.inputDate,body.sourceWorkbookHash,index],
        }));
        const bunchResolutions=Object.fromEntries(results.flatMap((result,index)=>
          ['derived','confirmed'].includes(result.status)?[[index,{quantity:result.quantity,status:result.status}]]:[]));
        if (results.some(result=>result.status==='review')) {
          return r.respond({status:400,contentType:'application/json',body:JSON.stringify({
            success:false,error:'단 수량을 확인할 품목이 있습니다.',bunchResolutions,
            errors:results.flatMap((result,index)=>result.status==='review'?[{row:index+1,prodName:products[index].ProdName,
              error:result.message,candidates:result.candidates,snapshot:result.snapshot}]:[]),
          })});
        }
        assert.deepEqual(results.map(item=>item.quantity),[40,40]);
        if (!body.previewOnly) packingSaves++;
        data={success:true,bunchQuantities:results.map(item=>item.quantity),bunchResolutions,warehouseKey:9200,message:'입고 등록 완료: 2/2개 품목'};
      }
      if (u.pathname === '/api/arrival-cost/latest') data.references = {'1|': [1000, 1350].map((cost,i)=>({cost,unit:'단',farm:`원가 농장 ${i+1}`,week:'45-01',orderYear:'2026',sourceKind:'INVOICE',referenceKey:String(i)}))};
      if (u.pathname === '/api/warehouse/9001') data.items = before;
      if (u.pathname === '/api/warehouse/correction') data = { success: true, draftOwner: user.userId, header, baselineDigest:'c'.repeat(64), details: before, farms: [{ FarmName: header.FarmName }, { FarmName: '연습농장 나' }], history: [] };
      if(u.pathname==='/api/warehouse/correction'&&r.method()==='POST')data={...previewFor(JSON.parse(r.postData())),canCommit:false,issues:[{message:'現在 차수에 확정된 품목이 있습니다. 영업지원에 수정 요청하세요.'.replace('現在','현재')}]};
      if (u.pathname === '/api/warehouse/invoice-costs') data.costs = null;
      if (u.pathname === '/api/warehouse/approval') {
        if (r.method() === 'GET') {
          const request = requests.find(item => item.requestId === Number(u.searchParams.get('requestId')));
          data = request ? { success: true, permissions: { request: isImport, review: !isImport }, history:[{FromStatus:null,ToStatus:'draft',Note:request.reason,CreatedAt:'2026-11-18T09:00:00'},{FromStatus:'draft',ToStatus:'requested',Note:request.reason,CreatedAt:'2026-11-18T09:01:00'},...(request.status==='applied'?[{FromStatus:'requested',ToStatus:'applied',Note:'영업지원 검토 후 최종 반영',CreatedAt:'2026-11-18T09:02:00'}]:[])], request, facts: factsFor(request) } : { success: true, permissions: { request: isImport, review: !isImport }, requests: requests.map(item => ({ RequestId: item.requestId, Status: item.status, RequestedBy: '수입부 연습', correction: item.correction, reason: item.reason, revision: item.revision })) };
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
            const p = previewFor(request.correction), quantity = Number(request.matching.rows?.[0]?.quantity??60), pk = p.scenario === 'product' ? 2 : 1;
            const common = { customer: '연습 꽃집', year: '2026', week: '45-03', unit: '단' };
            const groups = !request.matching.rows.length ? [] : p.scenario === 'product' ? [{ ...common, key: '10:1', product: products[0].ProdName, before: 60, after: 0, beforeAmount: 60000, afterAmount: 0, beforeVat: 6000, afterVat: 0, stockDelta: 60 }, { ...common, key: '10:2', product: products[1].ProdName, before: 0, after: 60, beforeAmount: 0, afterAmount: 60000, beforeVat: 0, afterVat: 6000, stockDelta: -60 }] : [{ ...common, key: '10:1', product: products[0].ProdName, before: 60, after: quantity, beforeAmount: 60000, afterAmount: quantity * 1000, beforeVat: 6000, afterVat: quantity * 100, stockDelta: 60 - quantity }];
            const beforeTotals = { N: 60000, I: 16800, E: 0, F: 11200, J: 43200, K: .72 }, afterTotals = p.scenario === 'quantity' ? { N: 60000, I: 16800, E: 0, F: 7200, J: 43200, K: .72 } : beforeTotals;
            data = { ...p, digest: 'a'.repeat(64), previewToken: 'synthetic-guide-token', groups, farmEvidence: (request.matching.farmGroups??[]).map(group => ({ shipmentKey: group.shipmentKey, prodKey: group.prodKey, before: group.prodKey === 1 ? [{ FarmKey: 1, ShipmentQuantity: 60 }] : [], after: group.assignments.map(item => ({ FarmKey: Number(item.farmKey), ShipmentQuantity: Number(item.quantity) })) })), financialSummary: { costs: { invoices: [{ beforeTotal: 28000, afterTotal: p.scenario === 'quantity' ? 24000 : 28000, preserveEconomics: p.scenario === 'farm' }], freight: [{ beforeTotal: 28000, afterTotal: p.scenario === 'quantity' ? 24000 : 28000 }] }, profitBefore: [{ orderYear: '2026', major: '45', totals: beforeTotals }, { orderYear: '2026', major: '46', totals: beforeTotals }], profitAfter: [{ orderYear: '2026', major: '45', totals: afterTotals }, { orderYear: '2026', major: '46', totals: afterTotals }] }, stockPreview: p.scenario === 'farm' ? [] : [{ StockKey: 41, ProdKey: pk, OrderYear: '2026', OrderWeek: '45-01', Stock: 40, projected: 40 }, { StockKey: 44, ProdKey: pk, OrderYear: '2026', OrderWeek: '46-01', Stock: 25, projected: 25 }], externalDocuments: '이미 발송한 견적서는 정정 후 재발행이 필요합니다. 외부 회계 전표는 자동 변경하지 않습니다.' };
            if(p.scenario==='product'&&!request.matching.financial.acknowledged){data.canCommit=false;data.issues=[{code:'APPROVAL_COST_NEW_PRODUCT',message:'변경 품목의 원가 근거를 확인하세요.'}];}
            if (p.scenario === 'quantity') {
              const acknowledged = request.matching.stockAdjustment?.acknowledged === true;
              if (acknowledged) assert.deepEqual(request.matching.stockAdjustment.rows, [{ prodKey: 1, quantity: 5, year: '2026', week: '46-01' }]);
              data.canCommit = acknowledged;
              data.stockAdjustmentPreview = { required: !acknowledged, canAdjust: true, applied: acknowledged, fingerprint: 'b'.repeat(64), rows: [{ prodKey: 1, prodName: products[0].ProdName, unit: '단', year: '2026', week: '46-01', quantity: 5, currentRemain: 30, future: [{ year: '2026', week: '46-01', remain: acknowledged ? 0 : -5 }] }] };
              data.stockPreview = [{ StockKey: 41, ProdKey: 1, OrderYear: '2026', OrderWeek: '45-01', Stock: 40, projected: 20 }, { StockKey: 44, ProdKey: 1, OrderYear: '2026', OrderWeek: '46-01', Stock: 5, projected: acknowledged ? 0 : -5 }];
              if (!acknowledged) { data.issues = [{ code:'APPROVAL_STOCK_SHORTAGE',message: '후속 차수에 5단이 부족합니다. 표시된 수량의 재고조정 동의가 필요합니다.' }]; delete data.financialSummary; }
            }
          }
          if (body.action === 'approve') {
            if(loseApproval){loseApproval=false;lostApproval=body;return await r.respond({status:409,contentType:'application/json',body:JSON.stringify({success:false,error:'응답 유실 재시도 검증'})});}
            if(lostApproval&&!replayedApproval){assert.equal(body.operationId,lostApproval.operationId);assert.equal(body.requestId,lostApproval.requestId);replayedApproval=true;} assert(!isImport && body.confirmed); request.status = 'applied'; request.result = { warehouseKey: 9001, shipmentGroups: request.matching.rows?.length ? 1 : 0, stockProducts: previewFor(request.correction).scenario === 'farm' ? 0 : previewFor(request.correction).changes.length }; request.appliedAt = '2026-11-04 10:00'; request.evidence = { receiptChanges: previewFor(request.correction).changes }; }
        }
      }
      await r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    } catch (error) { errors.push(`Fixture: ${error.message}`); if (!r.isInterceptResolutionHandled()) await r.abort(); }
  });
  await page.goto(`${base}/import/tools?tab=incoming&warehouseKey=9001&from=2026-10-01&to=2026-11-30`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('nav[aria-label="입고 정정 처리 단계"]');
  const rec = dry ? { caption: async () => {}, chapter: () => {}, pause: async () => {}, focus:async()=>{},unfocus:async()=>{},stop: async () => null } : await createWorkflowGuideRecorder(page, { root, workflowId: workflow.id, guideId: role, title: `${isImport ? '수입부' : '영업지원'} 입고 수정 가이드`, sourceFiles: workflow.sourceFiles, fixtureOnly: true, encodingPreset: 'veryfast' });
  let stepNumber=1,currentCaption='1. 조작할 위치를 확인합니다.';
  const hold = async (text, seconds = 5) => { currentCaption=`${stepNumber}. ${text.replace(/^\d+\. /,'')}`;await rec.caption(currentCaption); await rec.pause(Math.min(seconds, 7) * 1000); };
  const focusTarget=async element=>{
    await rec.caption(currentCaption);
    await element.evaluate(n=>{n.scrollIntoView({behavior:'instant',block:'center'});n.dataset.incomingGuideTarget='current';});
    const b=await element.boundingBox();assert(b&&b.y>=0&&b.y+b.height<=1080,'Guide target must be fully visible');
    // Bottom-edge controls cannot be centred by scrolling past the end of the real UI.
    // Keep the full view and move captions above them, rather than crop or conceal them.
    await rec.focus('[data-incoming-guide-target="current"]',stepNumber,{staticHighlight:b.y+b.height/2<70||b.y+b.height/2>900,anchorLeft:b.width>1200,badgeLeft:1370});
  };
  const unfocusTarget=async()=>{await rec.unfocus();await page.evaluate(()=>document.querySelectorAll('[data-incoming-guide-target]').forEach(n=>delete n.dataset.incomingGuideTarget));};
  let pointer = { x: 40, y: 80 };
  const movePointer = async (x, y) => { const start = pointer; for (let step = 1; step <= (dry ? 1 : 12); step++) { const ratio = step / (dry ? 1 : 12); await page.mouse.move(start.x + (x - start.x) * ratio, start.y + (y - start.y) * ratio); await rec.pause(25); } pointer = { x, y }; };
  const moveClick = async (element,keepFocus=false) => {
    assert(element, 'Guide target missing'); await element.evaluate(node => node.scrollIntoView({ behavior: 'instant', block: 'center' }));
    const box = await element.boundingBox(); assert(box, 'Guide target not visible');
    await focusTarget(element);await movePointer(box.x + box.width / 2, box.y + box.height / 2); await rec.pause(450); await element.click(); await rec.pause(600);if(!keepFocus)await unfocusTarget();
  };
  const click = async (text, scope = 'body') => {
    await page.waitForFunction(({ text, scope }) => [...(document.querySelector(scope)?.querySelectorAll('button,a,summary') ?? [])].some(node => node.textContent.trim() === text && !node.disabled), { timeout: 15000 }, { text, scope }).catch(() => { throw Error(`Missing enabled button: ${text}`); });
    const handle = await page.evaluateHandle(({ text, scope }) => [...document.querySelector(scope).querySelectorAll('button,a,summary')].find(node => node.textContent.trim() === text && !node.disabled), { text, scope }); assert(handle.asElement(), `Missing enabled button: ${text}`); await moveClick(handle.asElement()); await handle.dispose();
  };
  const select = async (selector, value) => {
    const element = await page.$(selector); assert(element, `Missing select: ${selector}`);
    await element.evaluate(node => node.scrollIntoView({ behavior: 'instant', block: 'center' })); const box = await element.boundingBox();
    await focusTarget(element);await movePointer(box.x + box.width / 2, box.y + box.height / 2); await element.focus(); await rec.pause(450);
    await element.select(String(value)); await rec.pause(700); if(selector==='select[aria-label="수정 방식"]'&&value==='PRODUCT'){await page.waitForSelector('select[aria-label="수정 종류"]');assert.equal(await page.$eval('select[aria-label="수정 종류"]',n=>n.value),'PRODUCT');}else assert.equal(await element.evaluate(node => node.value), String(value), `Selection did not persist: ${selector}`);await unfocusTarget();
  };
  const fill = async (selector, text) => { const element = await page.$(selector); assert(element, `Missing input: ${selector}`); await moveClick(element,true); await element.focus(); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace'); await element.type(String(text), { delay: dry ? 0 : 60 }); await rec.pause(500); assert.equal(await element.evaluate(node => node.value), String(text), `Input did not replace value: ${selector}`);await unfocusTarget(); };
  const checkedLabel = async text => { const handle = await page.evaluateHandle(text => [...document.querySelectorAll('label')].find(label => label.textContent.includes(text))?.querySelector('input[type="checkbox"]'), text); assert(handle.asElement(), `Missing checkbox: ${text}`); await moveClick(handle.asElement()); await handle.dispose(); };
  let stopped = false;
  try {
    await hold(isImport ? '수입부는 기존 입고에서 수정할 내용과 사유를 입력하고 요청합니다.\n영업지원 최종 확정 전까지 원장은 바뀌지 않습니다.' : '요청을 열면 시스템이 입고·분배·재고·원가·손익을 자동 검증합니다.\n영향 차수별 분배 검토창에서 분배·확정 상태를 확인하고 수정합니다.', 7);
    if(!isImport)await click('검토·확정');
    for(const [index,scenario] of (isImport?['farm','product','quantity','add','cancel','price']:['farm','product','quantity','price']).filter(s=>!onlyScenario||s===onlyScenario).entries()){
      stepNumber=index+1;console.log(`${dry?'CHECK':'RECORD'} ${role}: ${scenario}`);rec.chapter(scenario,`${stepNumber}. ${scenarioTitles[scenario]}`);
      if(isImport){
        if(scenario==='farm'){
          await page.goto(`${base}/incoming?popup=1`,{waitUntil:'networkidle0'});
          await page.waitForSelector('[data-row-key="9001"]');
          const roundInput = 'input[aria-label="차수 검색"]';
          await hold('차수 열 위에서 45를 입력하면 45차 전체가 나옵니다. 45-01을 입력하면 해당 세부차수만 표시됩니다.',4);
          await fill(roundInput, '45');
          await page.waitForFunction(() => document.querySelectorAll('tr[data-row-key]').length === 2);
          await fill(roundInput, '45-01');
          await page.waitForFunction(() => document.querySelectorAll('tr[data-row-key]').length === 1);
          if (dry) {
            await fill(roundInput, '４５차');
            await page.waitForFunction(() => document.querySelectorAll('tr[data-row-key]').length === 2);
            await fill(roundInput, '45 – 02');
            await page.waitForSelector('[data-row-key="9002"]');
            await fill(roundInput, '45-01');
          }
          await hold('농장명·인보이스·AWB 열 위에서 각각 검색할 수 있습니다. 여러 칸을 채우면 모든 조건과 일치하는 건만 표시됩니다.',4);
          await fill('input[aria-label="인보이스 검색"]','guide-001');
          await page.waitForFunction(()=>document.querySelectorAll('tr[data-row-key]').length===1);
          await fill('input[aria-label="AWB 검색"]','12345678');
          await page.waitForSelector('[data-row-key="9001"]');
          await fill('input[aria-label="농장명 검색"]','연습농장');
          await page.waitForFunction(()=>document.querySelectorAll('tr[data-row-key]').length===1);
          if (dry) {
            await fill(roundInput, '45-02');
            await page.waitForFunction(() => !document.querySelector('[data-row-key="9001"]'));
            await fill(roundInput, '45-01');
            await fill('input[aria-label="AWB 검색"]', '99999999');
            await page.waitForFunction(() => !document.querySelector('[data-row-key="9001"]'));
            await page.setViewport({width: 820, height: 900});
            await page.focus('input[aria-label="AWB 검색"]');
            await page.keyboard.down('Control');
            await page.keyboard.press('a');
            await page.keyboard.up('Control');
            await page.keyboard.type('000-1234 5678');
            await page.waitForSelector('[data-row-key="9001"]');
            await page.setViewport({width: 1920, height: 1080});
          }
          await moveClick(await page.$('[data-row-key="9001"]'));
          const scrollBar = '[aria-label="입고 상세 열 좌우 이동"]';
          await page.waitForFunction(()=>document.body.textContent.includes('1,350원/단'));
          assert.equal(await page.evaluate(()=>document.body.textContent.includes('1,000원/단')),false);
          await hold('상세 목록 상단 가로 막대로 오른쪽 원가 열을 엽니다. 기본은 최고가 한 건을 표시합니다.',5);
          await page.$eval(scrollBar,node=>{node.scrollLeft=node.scrollWidth;});
          await page.waitForFunction(()=>Array.from(document.querySelectorAll('.ant-table-content')).some(node=>node.scrollLeft>100));
          await checkedLabel('최신원가 참고 상세 보기');
          await page.waitForFunction(()=>document.body.textContent.includes('1,000원/단'));
          await hold('최신원가 참고 상세 보기를 켜면 농장별 출처와 금액이 표시됩니다.',5);
          await click('농장·품목 수정 / 파일 교체');await page.waitForSelector('dialog[open] select[aria-label="수정 농장"]');
          await hold('직접 수정창에서 농장 검색을 입력하면 바로 아래 목록이 펼쳐집니다. 정확한 농장을 선택합니다.',6);await fill('input[aria-label="농장 검색"]','연습농장 나');await select('select[aria-label="수정 농장"]','연습농장 나');await fill('input[aria-label="수정 사유"]','농장 오선택 정정 요청');await click('변경 내역 미리보기');
          await hold('확정된 품목 때문에 직접 수정이 막혀도 요청할 수 있습니다. 확정 현황 확인·취소는 같은 연도·차수의 기존 견적서 창을 엽니다.',7);await click('영업지원 요청으로 전환');await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='영업지원에 요청 등록'&&!b.disabled));
          await hold('입력한 농장·사유를 유지한 요청 내용을 확인합니다. 농장명만 변경하면 기존 확정·수량·금액을 보존합니다.',6);await click('영업지원에 요청 등록');await page.waitForFunction(()=>document.body.textContent.includes('영업지원에 수정 요청을 등록했습니다.'));await hold('요청 등록 완료를 확인합니다. 영업지원이 검토하고 수정 반영과 필요한 재확정까지 처리합니다.',6);await click('목록으로 돌아가기');await page.goto(`${base}/import/tools?tab=incoming&warehouseKey=9001&from=2026-10-01&to=2026-11-30`,{waitUntil:'networkidle0'});continue;
        }
        await hold(`${index+1}. ${scenarioTitles[scenario]}\n선택 농장의 기존 입고 안에서 수정합니다.`,5);
        await page.waitForSelector('[data-row-key="9001"]');await moveClick(await page.$('[data-row-key="9001"]'));if(scenario==='product'){await click('농장·품목 수정 / 파일 교체');await page.waitForSelector('select[aria-label="수정 방식"]');await select('select[aria-label="수정 방식"]','PRODUCT');}else await click('수입부 수정 요청');
        await page.waitForSelector('dialog[open] select[aria-label="수정 종류"]');
        if(scenario==='farm'){
          await hold('농장 검색칸에 농장명 일부를 입력합니다. 대소문자와 공백을 구분하지 않습니다.\n검색은 기존 선택을 바꾸지 않으며, 목록에서 정확한 농장을 선택합니다.',5);
          await fill('input[aria-label="농장 검색"]','연습농장 나');
          await select('select[aria-label="변경 농장"]','연습농장 나');
        }
        else{
          await select('select[aria-label="수정 종류"]',{product:'PRODUCT',quantity:'QUANTITY',add:'ADD',cancel:'CANCEL',price:'PRICE'}[scenario]);
          if(scenario==='price'){
            await select('select[aria-label="단가 변경 입고행"]','101');
            await fill('input[aria-label="새 단가"]','2');
            await page.waitForFunction(()=>document.querySelector('dialog[open]')?.textContent.includes('수정 후 총액 200'));
            await hold('입고행과 기존 단가를 확인하고 새 단가 2를 입력합니다. 기존 100단에 맞춰 총액 200으로 계산됩니다.',6);
          }else if(scenario==='product'){
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
        await hold('영업지원에 검토 대기로 전달했습니다.\n별도의 초안 제출 단계 없이 요청이 완료됩니다.',5);
        if(await page.$('dialog[open]'))await click('목록으로 돌아가기','dialog[open]');
        await page.waitForFunction(()=>!document.querySelector('dialog[open]')&&document.body.textContent.includes('수입부 수정 요청'));
        assert.equal(requests.at(-1).status,'requested','return to list follows successful submission');
      }else{
        const scenarioRequest=requests.find(item=>previewFor(item.correction).scenario===scenario);
        assert(scenarioRequest,'Scenario request fixture missing');
        await click(`#${scenarioRequest.requestId} 열기`);await page.waitForFunction(()=>document.body.textContent.includes('최종 반영 전후'));
        await hold(`${index+1}. ${scenarioTitles[scenario]}\n요청값과 자동 검증 결과를 확인합니다.`,5);
        if(scenario==='price'){
          await page.waitForFunction(()=>[...document.querySelectorAll('caption')].some(x=>x.textContent==='입고 단가 변경'));
          await hold('요청된 기존·새 단가와 총액을 확인합니다. 품목과 수량은 유지하고 연결 원가·손익만 검토합니다.',7);
        }
        if(dry&&scenario==='farm')await page.screenshot({path:'.verify/simple-support-no-problem.png',fullPage:false});
        if(scenario==='farm')await hold('문제가 없어도 영향 차수별 분배 검토창을 열어 확인할 수 있습니다.\n농장만 바뀌므로 분배·재고·견적·매출 금액을 보존합니다.',7);
        if(scenario==='product'){
          await hold('새 품목의 원가 근거가 필요한 경우에만 원가 문제 카드가 나옵니다.\n기존 다른 품목의 단가·중량을 임의로 확정하지 않습니다.',7);
          const freight=await page.evaluateHandle(()=>[...document.querySelectorAll('summary')].find(n=>n.textContent.includes('원가 배분 기준')));await moveClick(freight.asElement());await freight.dispose();
          await fill('input[aria-label="운송 1 박스 중량"]','2.5');
          await fill('input[aria-label="원가·손익 정정 사유"]','새 품목의 실제 중량·원가 근거 확인');await checkedLabel('연결 원가와 손익 정정 내용을 확인했습니다');
          await click('문제 해결 후 다시 검증');await page.waitForFunction(()=>document.body.textContent.includes('자동 검증 완료'));
        }
        if(scenario==='quantity'){
          await click('영향 차수별 분배 검토·수정');await page.waitForSelector('dialog[open]');
          await hold('45-01 입고 이후 45-03의 업체별 분배를 검토합니다.\n기존 확정과 미확정 상태를 먼저 확인합니다.',7);
          await select('dialog[open] select','2026/45-03');
          if(dry){const filter=await page.$('dialog[open] select');await filter.focus();await page.keyboard.press('ArrowUp');assert.equal(await filter.evaluate(n=>n.value),'');await page.keyboard.press('ArrowDown');assert.equal(await filter.evaluate(n=>n.value),'2026/45-03');}
          assert(await page.$eval('dialog[open]',n=>n.textContent.includes('미확정 유지')));
          await page.keyboard.press('Escape');
          assert(await page.evaluate(()=>document.activeElement?.textContent==='영향 차수별 분배 검토·수정'));
          if(dry){await page.keyboard.press('Space');await page.waitForSelector('dialog[open]');await page.keyboard.press('Escape');assert(await page.evaluate(()=>document.activeElement?.textContent==='영향 차수별 분배 검토·수정'));}
          await page.keyboard.press('Enter');await page.waitForSelector('dialog[open]');
          if(dry){await (await page.$('input[aria-label="분배 30 선택"]')).focus();await page.keyboard.press('Space');}
          else await moveClick(await page.$('input[aria-label="분배 30 선택"]'));
          await fill('input[aria-label="1행 최종수량"]','50');
          await hold('선택한 분배의 최종수량을 60에서 50으로 수정합니다.\n기존 확정 행만 자동 해제 후 재확정하며 미확정 행은 그대로 유지합니다.',8);
          assert(await page.$eval('dialog[open]',n=>n.textContent.includes('입력값 미검증')));
          await click('분배 검토값 저장·다시 검증','dialog[open]');
          await page.waitForFunction(()=>!document.querySelector('dialog[open]')?.textContent.includes('입력값 미검증'));
          await hold('재검증한 재고 전후와 부족 문제를 확인합니다.\n검토값 저장만으로 ERP 원장이 바뀌지는 않습니다.',7);
          if(dry){
            await page.screenshot({path:'.verify/distribution-review-desktop.png'});
            for(let n=0;n<20;n++){await page.keyboard.press('Tab');assert(await page.evaluate(()=>document.querySelector('dialog[open]').contains(document.activeElement)),'native modal must contain Tab focus');}
            await page.keyboard.down('Shift');await page.keyboard.press('Tab');await page.keyboard.up('Shift');
            assert(await page.evaluate(()=>document.querySelector('dialog[open]').contains(document.activeElement)));
            await page.setViewport({width:390,height:844,deviceScaleFactor:1});
            assert(await page.$eval('dialog[open]',n=>{const r=n.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.height<=innerHeight;}),'mobile dialog stays in viewport');
            await page.screenshot({path:'.verify/distribution-review-mobile.png'});
            await page.setViewport({width:1920,height:1080,deviceScaleFactor:1});
          }
          await click('검토창 닫기','dialog[open]');
          await page.waitForSelector('[aria-label="부족재고 명시 확인"]');await page.$eval('[aria-label="부족재고 명시 확인"]',n=>n.scrollIntoView({block:'center'}));
          await hold('실제 부족이 있는 경우 품목·차수·정확한 부족수량을 확인합니다.\n임의 업체 분배를 줄이지 않습니다. 다른 배분 조정도 선택할 수 있습니다.',7);
          await checkedLabel('표시된 부족수량만 재고조정하는 데 동의합니다');await click('문제 해결 후 다시 검증');await page.waitForFunction(()=>document.body.textContent.includes('자동 검증 완료'));
          await hold('명시 동의한 5단만 최종 확정 시 재고조정합니다.\n검산이 실패하면 입고·원가·손익을 포함해 함께 되돌립니다.',6);
        }
        await page.$eval('[aria-label="원가·손익 최종 검산"]',n=>n.scrollIntoView({block:'center'}));await hold('요약에서 원가·손익의 변경 금액을 확인합니다.\n세부 검산과 후속 재고는 필요한 경우 펼쳐 봅니다.',6);
        await click('최종 확정');if(dry&&lostApproval&&!replayedApproval){await page.waitForFunction(()=>document.body.textContent.includes('응답 유실 재시도 검증'));await click('같은 확정 결과 다시 확인');}await page.waitForFunction(()=>document.querySelector('[aria-label="정정 요청 상세"]')?.textContent.includes('적용 완료'));
        await hold('적용 완료 결과를 확인합니다.\n이미 발송한 견적서는 정정 내용으로 다시 발행하세요.',5);await click('요청 목록으로');
      }
    }
    if(onlyScenario!=='packing-quantity'){
      if(!isImport){await click('처리 이력');await hold('처리 이력에서 결과를 다시 확인할 수 있습니다.\n통신 오류 때는 같은 작업번호로 결과를 다시 확인하세요.',5);}
      await click('처리 이력');await hold('처리 이력에는 요청·검토 대기부터 완료·반려·취소까지 표시합니다. 요청을 열면 상태 변경 기록을 확인합니다.',6);await click(onlyScenario==='price'&&!isImport?'#4 열기':'#1 열기');await click(`요청 처리 이력 (${isImport?2:3}건)`);await hold('요청 등록과 처리 기록을 확인합니다. 요청하지 않은 직접 수정은 입고 수정창의 수정 이력에서 확인합니다.',6);
    }
    if (isImport && (!onlyScenario || onlyScenario==='packing-quantity')) {
      console.log(`${dry?'CHECK':'RECORD'} import: packing-quantity`);
      await page.goto(`${base}/incoming?popup=1`,{waitUntil:'networkidle0'});
      await rec.restoreOverlay?.();
      stepNumber=7;
      rec.chapter('packing-quantity','7. 단 수량을 확인하고 새 입고 저장');
      await hold('엑셀 업로드에서 연습 패킹리스트를 엽니다.',5);
      const xlsx=require('xlsx-js-style');
      const grid=[['PACKING LIST'],['','','연습농장 가','','','','45-01','','','','GUIDE-NEW'],
        ['','','','','','','2026/11/05'],[],['COD','VARIETY NAME','','','SIZE','BOX','BUNCH/ST','STEAM BOX','TOTAL\nBUNCH','TOTAL STEAM','U.PRICE','T.PRICE'],
        ['1','장미 레드 50','','','',2,10,200,'',400,50,100],
        ['2','장미 핑크 50','','','',4,'','','',400,50,200]];
      const book=xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(book,xlsx.utils.aoa_to_sheet(grid),'연습');
      const file=path.join(root,'.verify','packing-quantity-guide.xlsx');
      xlsx.writeFile(book,file);
      const [chooser]=await Promise.all([page.waitForFileChooser({timeout:12000}),click('업로드 / Subir')]);
      await chooser.accept([file]);
      await page.waitForSelector('.modal input[placeholder="2026"]');
      await fill('.modal input[placeholder="2026"]','2026');
      await click('수량 검증','.modal');
      const review='.modal [aria-label="2행 단 수량 확인"]';
      await page.waitForSelector(review);
      if (dry) {
        await click('취소 / Cancelar', '.modal');
        await page.waitForSelector('.modal', { hidden: true });
        const [replacement] = await Promise.all([page.waitForFileChooser({ timeout: 12000 }), click('업로드 / Subir')]);
        await replacement.accept([file]);
        await page.waitForSelector('.modal input[placeholder="2026"]');
        assert.equal(await page.$(review), null, 'reopening a workbook clears the old confirmation');
        await click('수량 검증', '.modal');
        await page.waitForSelector(review);
        await page.$eval('.modal input[type=date]', input => {
          const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          set.call(input, '2026-11-21');
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.waitForSelector(review, {hidden:true, timeout:5000});
        await click('수량 검증', '.modal');
        await page.waitForSelector(review);
        await page.screenshot({path:'.verify/bunch-inline-review.png'});
      }
      await hold('원본 단당 송이가 맞는 첫 행은 40단을 자동 계산합니다.\n두 번째 행만 전산 기준 산식과 원본을 대조합니다.',5);
      await click('수량 선택',review);
      await fill(review+' input[maxlength="500"]','연습 원본의 40단 확인');
      await click('확인하고 입고 계속',review);
      await page.waitForFunction(()=>document.querySelector('.modal [role=status]')?.textContent.includes('수량 검증 완료'));
      if(dry)await page.screenshot({path:'.verify/bunch-inline-confirmed.png'});
      await hold('두 행에 각각 40단이 반영됐습니다.\n수량을 확인한 뒤 입고 저장을 선택합니다.',5);
      await click('입고 저장','.modal');
      await page.waitForFunction(()=>document.body.innerText.includes('입고 등록 완료: 2/2개 품목'));
      await hold('입고 등록 완료 메시지를 확인합니다.',5);
      assert.equal(packingSaves,1);
    }
    assert.deepEqual(errors, []);
    assert.equal(posts.filter(body => body.action === (isImport ? 'submit' : 'approve')).length, (onlyScenario==='packing-quantity'?0:onlyScenario?1:isImport?6:4)+(dry&&!isImport?1:0));
    if(dry&&!isImport)assert(replayedApproval,'lost approval retry must reuse the same operation');
    const result = await rec.stop(); stopped = true;
    if (!dry) { const guide = workflow.guides.find(item => item.id === role); guide.status = 'ready'; guide.chapters = result.chapters; fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n'); }
    console.log(`PASS ${role}: actual UI ${dry ? 'dry run' : 'recording'}, farm/product/quantity, all APIs synthetic, ERP writes=0`);
  } finally { if (!stopped) { console.error(JSON.stringify({role,mainNavigations,requestStatuses:requests.map(r=>r.status),actions:posts.map(p=>p.action)}));await page.screenshot({ path: `.verify/guide-${role}-failure.png` }).catch(() => {}); await rec.stop().catch(() => {}); } await page.close(); }
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
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
