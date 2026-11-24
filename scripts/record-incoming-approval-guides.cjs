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
  let manualSaves = 0;
  let identitySaves = 0;
  let guideRound='', nativeRow=clone(before[0]), nativeSaves=0;
  const history=[{id:1,kind:'WAREHOUSE_CORRECTION',product:before[0].ProdName,actor:'수입부 연습',
    at:'2026-11-05T01:00:00.000Z',reason:'수량 확인',before:{BoxQuantity:9},after:{BoxQuantity:10}}];
  let guideInvoice = header.InvoiceNo;
  let manualPreviewBody;
  const {manualWarehouseLine}=await import('../lib/manualWarehouseUpload.js');
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
      if (u.pathname === '/api/warehouse') {data.canEditDetail=isImport; data.canReadDetailHistory=true; data.masters = Array.from({length:12},(_,i)=>({...header,WarehouseKey:9001+i,
        OrderWeek:[header.OrderWeek,'45-02','47-02','47-02'][i]??'46-01',
        FarmName:i?'다른 농장':header.FarmName,InvoiceNo:i?`GUIDE-${i+1}`:guideInvoice,
        AWB:i===1?null:header.AWB,totalBox:i===1?null:header.totalBox,RoundSuffix:i===0?guideRound:i===2?'A':i===3?'B':''}));}
      if (u.pathname === '/api/warehouse/detail-actions') {
        if(r.method()==='POST'){
          const input=JSON.parse(r.postData());
          assert(isImport);
          assert.deepEqual([input.warehouseKey,input.orderYear,input.orderWeek,input.expectedSuffix],[9001,'2026','45-01',guideRound]);
          history.unshift({id:history.length+1,kind:'WAREHOUSE_ROUND_LABEL',actor:user.userName,at:'2026-11-05T01:02:00.000Z',before:guideRound,after:input.suffix});
          guideRound=input.suffix;
          data={success:true,warehouseKey:9001,suffix:guideRound};
        }else data={success:true,history};
      }
      if (u.pathname === '/api/warehouse/identity') {
        const input=r.method()==='PATCH'?JSON.parse(r.postData()):Object.fromEntries(u.searchParams);
        const linked=Number(input.warehouseKey)===9002;
        if(r.method()==='PATCH'){
          assert(isImport&&!linked);
          assert.deepEqual([input.orderYear,input.orderWeek,input.field,input.expectedInvoiceNo,input.expectedAwb],
            ['2026','45-01','invoiceNo','GUIDE-001',header.AWB]);
          guideInvoice=input.value;
          identitySaves++;
        }
        data={success:true,header:{...header,InvoiceNo:linked?'GUIDE-2':guideInvoice,OrderNo:linked?null:header.AWB},
          issues:linked?[{code:'DOCUMENT',message:'이 입고에는 웹 인보이스 문서가 연결되어 있습니다.'}]:[]};
      }
      if (u.pathname === '/api/warehouse' && u.searchParams.get('manualOptions')==='1') {
        data={success:true,farms:[{FarmName:'연습농장 가',FarmKey:1}],periods:[
          {OrderYear:'2026',OrderWeek:'45-01'},{OrderYear:'2026',OrderWeek:'45-02'},
          {OrderYear:'2027',OrderWeek:'45-01'},{OrderYear:'2027',OrderWeek:'02-01'},
        ]};
      }
      if (u.pathname === '/api/warehouse' && r.method() === 'POST') {
        assert(isImport,'fixture import authorization');
        const body=JSON.parse(r.postData());
        if(body.source==='manual'){
          const preview=body.items.map(row=>({...manualWarehouseLine(row,products.find(product=>product.ProdKey===row.prodKey)),prodName:row.prodName,prodKey:row.prodKey}));
          assert.equal(body.farmName,'연습농장 가');
          assert.equal(body.orderYear,'2026');
          assert.equal(body.orderWeek,'45-01');
          assert.deepEqual(preview.map(line=>[line.steamQty,line.bunchQty,line.totalPrice]),[[100,10,25],[200,20,0]]);
          if(body.previewOnly){manualPreviewBody=body;data={success:true,manualPreview:preview,previewToken:'guide-manual-preview'};}
          else {
            assert.equal(body.operationId,manualPreviewBody.operationId);
            assert.equal(body.previewToken,'guide-manual-preview');
            manualSaves++;
            if(dry && manualSaves===1) return r.respond({status:502,contentType:'application/json',body:'{"success":false}'});
            data={success:true,warehouseKey:9201};
          }
          return r.respond({status:200,contentType:'application/json',body:JSON.stringify(data)});
        }
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
      if (u.pathname === '/api/warehouse/9001') data.items = [nativeRow];
      if (u.pathname === '/api/warehouse/9002') data.items = [{ ...before[0], BoxQuantity: null, IsWeightRow: false, ReceiptGoodsLines: 1 }];
      if (u.pathname === '/api/warehouse/correction') data = { success: true, draftOwner: user.userId, header, baselineDigest:'c'.repeat(64), details: before, farms: [{ FarmName: header.FarmName }, { FarmName: '연습농장 나' }], history: [] };
      if(u.pathname==='/api/warehouse/correction'&&r.method()==='POST'){
        const input=JSON.parse(r.postData());
        if(input.mode==='NATIVE_QUANTITY'){
          assert(isImport);
          assert.deepEqual(input.detail.expected,{BoxQuantity:10,BunchQuantity:100,SteamQuantity:1000});
          const blocked=input.warehouseKey===9002;
          const after={...nativeRow,...Object.fromEntries(['BoxQuantity','BunchQuantity','SteamQuantity'].map(k=>[k,input.detail[k]])),
            OutQuantity:input.detail.BunchQuantity,EstQuantity:input.detail.BunchQuantity,TPrice:input.detail.BunchQuantity};
          if(input.action==='preview')data={success:true,canCommit:!blocked,baselineDigest:'e'.repeat(64),
            issues:blocked?[{code:'NATIVE_ELIGIBILITY_BLOCKED',message:'현재 차수에 확정된 품목이 있습니다.'}]:[],
            nativeQuantity:{before:nativeRow,after}};
          else{
            assert(!blocked);assert.equal(input.detail.detailKey,101);assert.equal(input.orderWeek,'45-01');
            assert(input.confirmed&&input.operationId&&input.reason);assert.equal(input.baselineDigest,'e'.repeat(64));
            history.unshift({id:history.length+1,kind:'WAREHOUSE_CORRECTION',actor:user.userName,product:nativeRow.ProdName,
              at:'2026-11-05T01:03:00.000Z',reason:input.reason,before:nativeRow,after});
            nativeRow={...after,총액:after.TPrice};nativeSaves++;
            data={success:true,warehouseKey:9001,erpWritePerformed:false};
          }
        }else data={...previewFor(input),canCommit:false,issues:[{message:'현재 차수에 확정된 품목이 있습니다. 영업지원에 수정 요청하세요.'}]};
      }
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
          if (body.action === 'submit') { assert(isImport); if(previewFor(request.correction).scenario==='product')await new Promise(resolve=>setTimeout(resolve,dry?250:5500)); request.status = 'requested'; request.revision++; data={...data,status:request.status,requestId:request.requestId,revision:request.revision}; }
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
            if(previewFor(request.correction).scenario==='product'&&!dry)await new Promise(resolve=>setTimeout(resolve,5500));
            if(loseApproval){loseApproval=false;lostApproval=body;return await r.respond({status:409,contentType:'application/json',body:JSON.stringify({success:false,error:'응답 유실 재시도 검증'})});}
            if(lostApproval&&!replayedApproval){assert.equal(body.operationId,lostApproval.operationId);assert.equal(body.requestId,lostApproval.requestId);replayedApproval=true;} assert(!isImport && body.confirmed); request.status = 'applied'; data.status='applied'; request.result = { warehouseKey: 9001, shipmentGroups: request.matching.rows?.length ? 1 : 0, stockProducts: previewFor(request.correction).scenario === 'farm' ? 0 : previewFor(request.correction).changes.length }; request.appliedAt = '2026-11-04 10:00'; request.evidence = { receiptChanges: previewFor(request.correction).changes }; }
        }
      }
      await r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    } catch (error) { errors.push(`Fixture: ${error.message}`); if (!r.isInterceptResolutionHandled()) await r.abort(); }
  });
  await page.goto(`${base}/import/tools?tab=incoming&warehouseKey=9001&from=2026-10-01&to=2026-11-30`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('nav[aria-label="입고 정정 처리 단계"]');
  const rec = dry ? { caption: async () => {}, chapter: () => {}, pause: async () => {}, focus:async()=>{},stop: async () => null,unfocus:async()=>{} } : await createWorkflowGuideRecorder(page, { root, workflowId: workflow.id, guideId: role, title: `${isImport ? '수입부' : '영업지원'} 입고 작업 가이드`, sourceFiles: workflow.sourceFiles, fixtureOnly: true, encodingPreset: 'veryfast', crf:isImport?27:23 });
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
  const selectReceipt = async (warehouseKey=9001) => {
    const selector = `[data-row-key="${warehouseKey}"]`;
    const target = await page.waitForSelector(selector + ' td:first-child', {visible:true});
    await focusTarget(target);
    await page.focus(selector);
    await page.keyboard.press('Enter');
    await page.waitForSelector(selector + '[aria-selected="true"]');
    await unfocusTarget();
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
          await selectReceipt(9002);
          const reference = await page.waitForFunction(()=>[...document.querySelectorAll('td span[tabindex="0"]')].find(node=>node.textContent==='10 참고'));
          await reference.asElement().focus();
          await page.waitForFunction(()=>document.body.textContent.includes('1000송이 ÷ 100송이/박스'));
          await hold('박스 수량 미기재 행에서 근거가 충분하면 참고 수량을 보여줍니다. 원장 합계에는 반영하지 않습니다.',5);
          await reference.dispose();
          await click('인보이스·AWB 조정');
          assert.equal(await page.$eval('details[open] a[href="/import/tools?tab=packing"]',node=>node.textContent),'패킹리스트 업무도구 열기');
          await hold('등록한 원장 번호는 잠겨 있습니다. 등록 전 자료는 업무도구에서 입고 초안을 열어 수정합니다.',5);
          await click('인보이스·AWB 조정');
          if (dry) {
            const ledger = '.incoming-ledger';
            const rowHeight = await page.$eval('[data-row-key="9002"]',node=>node.getBoundingClientRect().height);
            assert(rowHeight <= 32, `Compact master row height: ${rowHeight}px`);
            await page.screenshot({path:'.verify/warehouse-ledger-desktop.png'});
            await page.setViewport({width:390,height:844});
            const widths = await page.$eval(ledger,node=>({ content:node.scrollWidth, container:node.clientWidth, viewport:window.innerWidth, document:document.documentElement.scrollWidth }));
            assert(widths.content<=widths.container+4 && widths.document<=widths.viewport, `Table scrolling must stay inside the ledger: ${JSON.stringify(widths)}`);
            await page.screenshot({path:'.verify/warehouse-ledger-mobile.png'});
            await page.setViewport({width:1920,height:1080});
          }
          const roundInput = 'input[aria-label="차수 검색"]';
          await hold('차수 열 위에서 45를 입력하면 45차 전체가 나옵니다. 45-01을 입력하면 해당 세부차수만 표시됩니다.',4);
          await fill(roundInput, '45');
          await page.waitForFunction(() => document.querySelectorAll('tr[data-row-key][aria-selected]').length === 2);
          await fill(roundInput, '45-01');
          await page.waitForFunction(() => document.querySelectorAll('tr[data-row-key][aria-selected]').length === 1);
          if (dry) {
            await fill(roundInput, '４５차');
            await page.waitForFunction(() => document.querySelectorAll('tr[data-row-key][aria-selected]').length === 2);
            await fill(roundInput, '45 – 02');
            await page.waitForSelector('[data-row-key="9002"]');
            await fill(roundInput, '45-01');
          }
          await hold('농장명·인보이스·AWB 열 위에서 각각 검색할 수 있습니다. 여러 칸을 채우면 모든 조건과 일치하는 건만 표시됩니다.',4);
          await fill('input[aria-label="인보이스 검색"]','guide-001');
          await page.waitForFunction(()=>document.querySelectorAll('tr[data-row-key][aria-selected]').length===1);
          await fill('input[aria-label="AWB 검색"]','12345678');
          await page.waitForSelector('[data-row-key="9001"]');
          await fill('input[aria-label="농장명 검색"]','연습농장');
          await page.waitForFunction(()=>document.querySelectorAll('tr[data-row-key][aria-selected]').length===1);
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
          await selectReceipt();
          const scrollBar = '[aria-label="입고 상세 열 좌우 이동"]';
          await page.waitForSelector(scrollBar);
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
        await page.waitForSelector('[data-row-key="9001"]');await selectReceipt();if(scenario==='product'){await click('농장·품목 수정 / 파일 교체');await page.waitForSelector('select[aria-label="수정 방식"]');await select('select[aria-label="수정 방식"]','PRODUCT');}else await click('수입부 수정 요청');
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
            await fill('input[aria-label="1행 품목 검색"]',products[1].ProdName);await hold('검색창 아래 후보의 품목명과 단위를 확인하고 선택합니다.',3);await click(`${products[1].ProdName} · ${products[1].OutUnit}`,'dialog');
            await fill('input[aria-label="1행 최종수량"]','90');
            await hold('기존 포장·매입값을 제안값으로 보존하고 다른 품목과 최종 90단을 정합니다.\n새 품목의 원가 근거는 영업지원 검증 문제로 전달됩니다.',6);
          }else if(scenario==='add'){
            await click('품목·수량 추가','dialog');await fill('input[aria-label="2행 품목 검색"]',products[1].ProdName);await click(`${products[1].ProdName} · ${products[1].OutUnit}`,'dialog');await fill('input[aria-label="2행 최종수량"]','20');
            const target=await page.$('input[aria-label="2행 단가"]');await target.evaluate(n=>n.closest('details').open=true);
            await fill('input[aria-label="2행 단가"]','1');await fill('input[aria-label="2행 총액"]','20');
            await hold('추가 품목과 최종 20단을 정하면 품목마스터 기준으로 포장을 계산합니다.\n현재 입고에 매입 근거가 없는 경우에만 확인한 단가·총액을 입력합니다.',6);
          }else if(scenario==='cancel'){await click('이 행 전량 취소','dialog');await hold('선택 입고의 해당 행을 최종 수량 0으로 취소합니다.\n입고 건 전체를 삭제하지 않고 기존 이력을 보존합니다.',6);
          }else{await fill('input[aria-label="1행 최종수량"]','80');await hold('같은 품목의 최종 수량을 80단으로 바꿉니다.\n기존 같은 입고행의 포장비율과 금액을 비례 계산합니다.',6);}
        }
        await fill('input[aria-label="수정 사유"]',`${scenarioTitles[scenario]} · 실제 파킹 자료 확인`);
        if(dry&&scenario==='quantity')await page.screenshot({path:'.verify/simple-import-quantity.png',fullPage:false});
        await click('변경 요약 확인');await page.waitForSelector('[aria-label="요청 변경 요약"]');
        await hold('바뀐 항목만 비교하고 강조된 수정값을 확인한 뒤 요청합니다.\n품목·수량 추가와 취소도 이 입고 안의 행을 대상으로 합니다.',6);
        await click('영업지원에 수정 요청','dialog');if(!dry&&scenario==='product')await hold('작업 로그에서 영업지원에 접수하는 동안 진행 상태를 볼 수 있습니다.',3);await page.waitForFunction(()=>document.querySelector('dialog')?.textContent.includes('영업지원에 수정 요청했습니다.'));
        await page.waitForFunction(()=>document.querySelector('[aria-label="작업 로그"]')?.textContent.includes('검토 대기로 등록'));
        await hold('작업 로그의 검토 대기 등록 완료를 확인합니다.\n영업지원은 요청 상세에서 서버 처리 이력을 확인할 수 있습니다.',5);
        if(await page.$('dialog[open]'))await click('목록으로 돌아가기','dialog[open]');
        await page.waitForFunction(()=>!document.querySelector('dialog[open]')&&document.body.textContent.includes('수입부 수정 요청'));
        assert.equal(requests.at(-1).status,'requested','return to list follows successful submission');
      }else{
        const scenarioRequest=requests.find(item=>previewFor(item.correction).scenario===scenario);
        assert(scenarioRequest,'Scenario request fixture missing');
        await click(`#${scenarioRequest.requestId} 열기`);await page.waitForFunction(()=>document.body.textContent.includes('최종 반영 전후'));
        await page.waitForFunction(()=>{
          const log=document.querySelector('[aria-label="작업 로그"]')?.textContent ?? '';
          return log.includes('요청 내용과 처리 이력을 불러왔습니다.') &&
            (log.includes('검증 결과를 확인할 수 있습니다.') || log.includes('검토가 필요한 항목이 있습니다.'));
        });
        await hold(`${index+1}. ${scenarioTitles[scenario]}\n바뀐 입고 항목과 작업 로그의 자동 검증 결과를 확인합니다.`,5);
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
    if(!['packing-quantity','manual-upload','inline-numbers','native-detail'].includes(onlyScenario)){
      if(!isImport){await click('처리 이력');await hold('처리 이력에서 결과를 다시 확인할 수 있습니다.\n통신 오류 때는 같은 작업번호로 결과를 다시 확인하세요.',5);}
      await click('처리 이력');await hold('처리 이력에는 요청·검토 대기부터 완료·반려·취소까지 표시합니다. 요청을 열면 상태 변경 기록을 확인합니다.',6);await click(onlyScenario==='price'&&!isImport?'#4 열기':'#1 열기');await page.waitForFunction(()=>document.querySelector('[aria-label="작업 로그"]')?.textContent.includes('요청 내용과 처리 이력을 불러왔습니다.'));await click(`요청 처리 이력 (${isImport?2:3}건)`);await hold('요청 등록과 처리 기록을 확인합니다. 요청하지 않은 직접 수정은 입고 수정창의 수정 이력에서 확인합니다.',6);
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
    if (isImport && (!onlyScenario || onlyScenario==='manual-upload')) {
      console.log(`${dry?'CHECK':'RECORD'} import: manual-upload`);
      await page.goto(`${base}/incoming?popup=1`,{waitUntil:'networkidle0'});
      await rec.restoreOverlay?.();
      stepNumber=8;
      rec.chapter('manual-upload','8. 여러 품목 수기로 입고 등록');
      await hold('파일 없이 입고할 때 업로드 옆의 수기 업로드를 선택합니다.',5);
      await click('수기 업로드');
      const modal='[role="dialog"]';
      await page.waitForSelector(modal+' select[aria-label="입고 농장"] option[value="연습농장 가"]');
      if(dry){
        await page.keyboard.press('Escape');
        await page.waitForSelector(modal,{hidden:true});
        await page.waitForFunction(()=>document.activeElement?.textContent.trim()==='수기 업로드');
        await page.keyboard.press('Enter');
        await page.waitForSelector(modal+' select[aria-label="입고 농장"] option[value="연습농장 가"]');
        await page.setViewport({width:390,height:844});
        assert(await page.$eval(modal,node=>node.getBoundingClientRect().width<=window.innerWidth));
        await page.setViewport({width:1920,height:1080});
      }
      await fill(modal+' input[aria-label="농장 검색"]','연습농장');
      await select(modal+' select[aria-label="입고 농장"]','연습농장 가');
      const yearSelect=modal+' select[aria-label="입고 연도"]';
      const weekSelect=modal+' select[aria-label="입고 세부차수"]';
      await select(yearSelect,'2026');
      await select(weekSelect,'45-01');
      await hold('연도와 세부차수를 각각 선택하고 실제 입고일을 확인합니다. 품목은 검색한 목록에서 선택합니다.',5);
      const chooseManualProduct=async (row,query)=>{
        const input=modal+` input[aria-label="${row}행 품목 검색"]`;
        await fill(input,query);
        await page.focus(input);
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
      };
      await chooseManualProduct(1,'레드');
      await fill(modal+' input[aria-label="1행 입고 수량"]','100');
      await fill(modal+' input[aria-label="1행 송이/단"]','10');
      await fill(modal+' input[aria-label="1행 금액"]','25');
      await hold('100송이, 한 단 10송이, 행 금액 25를 입력했습니다. 송이당 단가는 계산됩니다.',5);
      await click('품목 행 추가',modal);
      await chooseManualProduct(2,'핑크');
      await fill(modal+' input[aria-label="2행 입고 수량"]','200');
      await fill(modal+' input[aria-label="2행 송이/단"]','10');
      await fill(modal+' input[aria-label="2행 금액"]','0');
      await click('등록 미리보기',modal);
      await page.waitForSelector('[aria-label="수기 입고 검증 결과"]');
      await page.waitForFunction(()=>document.querySelector('[aria-label="수기 입고 검증 결과"]')?.textContent.includes('2026년 45-01'));
      if(dry){
        await select(yearSelect,'2027');
        assert.equal(await page.$eval(weekSelect,node=>node.value),'');
        assert.equal(await page.$eval(weekSelect,node=>[...node.options].some(option=>option.value==='45-02')),false);
        assert.equal(await page.$('[aria-label="수기 입고 검증 결과"]'),null);
        await select(yearSelect,'2026');
        await select(weekSelect,'45-01');
        await click('등록 미리보기',modal);
        await page.waitForSelector('[aria-label="수기 입고 검증 결과"]');
      }
      await hold('미리보기에서 두 품목의 실제 송이·출고·견적 수량과 금액을 확인합니다.',5);
      const check=await page.$(modal+' input[type="checkbox"]');
      await moveClick(check);
      await click('입고 등록',modal);
      if(dry) await click('같은 등록 결과 다시 확인',modal);
      await page.waitForFunction(()=>document.body.innerText.includes('수기 입고 #9201 등록 완료'));
      await hold('원장번호가 표시되면 등록이 완료됐습니다.',5);
      assert.equal(manualSaves,dry?2:1);
    }
    if(isImport&&(!onlyScenario||onlyScenario==='inline-numbers')){
      console.log(`${dry?'CHECK':'RECORD'} import: inline-numbers`);
      await page.goto(`${base}/incoming?popup=1`,{waitUntil:'networkidle0'});
      await rec.restoreOverlay?.();
      stepNumber=9;
      rec.chapter('inline-numbers','9. 원장 인보이스·AWB 번호 수정');
      const linked='button[aria-label="AWB 수정 · 입고 9002"]';
      const editable='button[aria-label="인보이스 수정 · 입고 9001"]';
      await page.waitForSelector(editable);
      await hold('원장 목록에서 인보이스나 AWB의 편집 버튼을 누르면 해당 셀을 확인할 수 있습니다.',4);
      await moveClick(await page.$(editable));
      const newNumber='input[aria-label="인보이스 새 번호"]';
      await page.waitForSelector(newNumber);
      await fill(newNumber,'GUIDE-001-R');
      await hold('번호를 바꾸고 저장하면 대상 입고번호와 저장 결과가 표시됩니다.',4);
      await click('저장','[data-row-key="9001"]');
      await page.waitForFunction(()=>document.body.innerText.includes('입고 #9001 인보이스 저장 완료'));
      await moveClick(await page.waitForSelector(linked));
      await page.waitForFunction(()=>document.body.textContent.includes('이 입고에는 웹 인보이스 문서가 연결되어 있습니다.'));
      assert.equal(await page.$('input[aria-label="AWB 새 번호"]'),null);
      await hold('등록 문서가 연결된 경우 저장 대신 기존 입고 작업 링크가 표시됩니다.',5);
      await click('닫기','[data-row-key="9002"]');
      const round='input[aria-label="차수 검색"]';
      await fill(round,'47-02.A');
      await page.waitForSelector('[data-row-key="9003"]');
      assert.equal(await page.$('[data-row-key="9004"]'),null);
      assert.match(await page.$eval('[data-row-key="9003"]',row=>row.innerText),/47-02\.A.*26-11-05/s);
      if(dry){
        await fill(round,'47-02A');
        await page.waitForSelector('[data-row-key="9003"]');
        await page.setViewport({width:390,height:844});
        assert(await page.$eval('.incoming-ledger',node=>node.scrollWidth<=node.clientWidth+4));
        await page.setViewport({width:1920,height:1080});
      }
      await hold('저장된 A/B 접미는 점을 넣어서 표시하고, 입력일은 연도 두 자리로 표시합니다.',5);
      assert.equal(identitySaves,1);
    }
    if(!onlyScenario||onlyScenario==='native-detail'){
      console.log(`${dry?'CHECK':'RECORD'} ${role}: native-detail`);
      await page.goto(`${base}/incoming?popup=1&warehouseKey=9001`,{waitUntil:'networkidle0'});
      await rec.restoreOverlay?.();
      stepNumber=isImport?10:5;
      rec.chapter('native-detail',isImport?'10. 차수 표시와 상세 수량 수정':'5. 원장 차수·수량 변경 이력');
      if(isImport){
        const trigger='button[aria-label="차수 표시 수정 · 입고 9001"]';
        await moveClick(await page.waitForSelector(trigger));
        await page.select('[data-row-key="9001"] select','B');
        await hold('차수 옆에서 B를 선택합니다. 표시만 바뀌고 업무 차수는 유지됩니다.',4);
        await click('저장','[data-row-key="9001"]');
        await page.waitForFunction(()=>document.querySelector('[data-row-key="9001"]')?.innerText.includes('45-01.B'));
        const edit='button[aria-label="상세 수량 수정 · 장미 레드 50"]';
        await moveClick(await page.waitForSelector(edit));
        const modal='[role="dialog"]';
        await fill(modal+' label:nth-child(2) input[type="number"]','105');
        await fill(modal+' input[maxlength="500"]','연습 단 수량 확인');
        await click('변경 확인',modal);
        await page.waitForFunction(()=>document.querySelector('[role="dialog"]')?.innerText.includes('100 → 105'));
        await hold('수량과 합계를 확인한 다음 수량 저장을 누릅니다. 확정된 입고는 저장할 수 없습니다.',4);
        await click('수량 저장',modal);
        await page.waitForFunction(()=>document.body.innerText.includes('입고 #9001 상세 수량 저장 완료'));
        assert.equal(nativeSaves,1);
      }else{
        assert.equal(await page.$('button[aria-label="차수 표시 수정 · 입고 9001"]'),null);
        assert.equal(await page.$('button[aria-label^="상세 수량 수정"]'),null);
      }
      const historySummary=await page.evaluateHandle(()=>[...document.querySelectorAll('summary')].find(n=>n.textContent.startsWith('차수·수량 변경 이력')));
      assert(historySummary.asElement());
      await moveClick(historySummary.asElement());await historySummary.dispose();
      await page.waitForFunction(()=>document.querySelector('details[open] article')?.innerText.includes('수입부 연습'));
      await hold('변경 이력에서 수정한 사람, 시간과 수량 전후를 확인합니다.',5);
    }
    assert.deepEqual(errors, []);
    assert.equal(posts.filter(body => body.action === (isImport ? 'submit' : 'approve')).length, (['packing-quantity','manual-upload','inline-numbers','native-detail'].includes(onlyScenario)?0:onlyScenario?1:isImport?6:4)+(dry&&!isImport&&onlyScenario!=='native-detail'?1:0));
    if(dry&&!isImport&&onlyScenario!=='native-detail')assert(replayedApproval,'lost approval retry must reuse the same operation');
    const result = await rec.stop(); stopped = true;
    if (!dry) {
      const latestRegistry = JSON.parse(fs.readFileSync(registryPath,'utf8'));
      const guide = latestRegistry.workflows.find(item => item.id === workflow.id).guides.find(item => item.id === role);
      guide.status = 'ready';
      guide.chapters = result.chapters;
      fs.writeFileSync(registryPath, JSON.stringify(latestRegistry, null, 2) + '\n');
    }
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
