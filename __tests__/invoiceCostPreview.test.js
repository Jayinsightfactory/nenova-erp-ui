import test from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import {prepareInvoiceCostPreview,calculateInvoiceCostPreview,createInvoiceCostPreviewHandler} from '../lib/invoiceCostPreview.js';
import {createInvoicePreviewCostWorkbook,createInvoiceCostWorkbook,createNativeCostWorkbook} from '../lib/invoiceReceiptCostExport.js';
import {INVOICE_COST_FORMULAS} from '../lib/invoiceReceiptCost.js';
import {readFileSync} from 'node:fs';
import {rememberInvoiceCostInput,restoreInvoiceCostInput} from '../lib/invoiceCostEditing.js';
import {applyInvoiceAllocation,allocationSource} from '../lib/invoiceProductAllocation.js';
import {auInvoiceTariffDefault} from '../lib/auInvoiceTariffDefaults.js';
import {invoiceCostExportFixture} from './invoiceReceiptCostExport.test.js';
import {AU_ORIGINAL_DEFAULTS} from '../lib/auOriginalCostInputs.js';
import {nlCompanyTemplateCost} from '../lib/nlCompanyTemplateCost.js';
import {nlComparisonForExport} from '../lib/nlCostCustomerComparison.js';

test('AU source customs recomputed server-side; missing GW blocks; original formula download equals preview',async()=>{
 const f=fixture(),p=await prepare(f);
 const input={...f.input,auOriginalMode:'FORMULA',auOriginal:{...AU_ORIGINAL_DEFAULTS,gw:265.5,itemCount:1},customsTotalKRW:1};
 const calculated=calculateInvoiceCostPreview(p,request(p,input));
 assert.equal(calculated.input.customsTotalKRW,255130);
 assert.equal(calculated.input.expenseBasis,'ESTIMATED');
 assert.equal(input.customsTotalKRW,1);
 const s=XLSX.read(await createInvoicePreviewCostWorkbook(calculated),{cellFormula:true}).Sheets['원본 양식 계산'];
 assert.equal(s.N9.v,255130);assert.equal(s.W18?.v,undefined);assert.ok(Math.abs(s.W22.v)<0.01);
 assert.equal(s.W19.v,255130);assert.equal(s.D7.v,265.5);
 for(const gw of ['',false,null])assert.throws(()=>calculateInvoiceCostPreview(p,request(p,{...input,auOriginal:{...input.auOriginal,gw}})),/GW/);
 const zero=calculateInvoiceCostPreview(p,request(p,{...input,auOriginal:{gw:0,itemCount:0,baeksangRateKRW:0,clearanceFeeKRW:0,inspectionRateKRW:0,domesticTransportKRW:0}}));
 assert.equal(zero.input.customsTotalKRW,0);
});

const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
test('AU source-bound historical tariffs, manual zero and changed product defaults',async()=>{
 const f=fixture();Object.assign(f.products[0],{ProdKey:2999,ProdName:'Copper Glow'});f.document.lines[0].prodKey=2999;
 const p=await prepare(f);assert.equal(p.document.reviewedMetadata.invoiceCostInput.lineInputs[0].tariffRate,.069);
 assert.match(p.document.reviewedMetadata.tariffDefaults[id].label,/39-1.*I18/);
 for(const value of [0,.08,-1,'']){
  f.document.reviewedMetadata.invoiceCostInput={lineInputs:[{lineId:id,tariffRate:value}]};
  assert.equal((await prepare(f)).document.reviewedMetadata.invoiceCostInput.lineInputs[0].tariffRate,value);
 }
 delete f.document.reviewedMetadata.invoiceCostInput;
 const remembered=rememberInvoiceCostInput(p.document,{exchangeRateKRW:1000,lineInputs:[{lineId:id,tariffRate:.069}]});
 Object.assign(f.products[0],{ProdKey:2998,ProdName:'Wolly Bush Red Tip'});f.document.lines[0].prodKey=2998;
 const changed=await prepare(f),restored=restoreInvoiceCostInput(changed.document,remembered);
 assert.equal(restored.reviewedMetadata.invoiceCostInput.lineInputs[0].tariffRate,0);
 assert.match(restored.reviewedMetadata.tariffDefaults[id].label,/승인/);
 for(const bad of [{orderYear:'2025'},{orderYear:'2027'},{orderWeek:'38-01'},{reviewedMetadata:{country:'US',transportMode:'AIR'}}])assert.equal(auInvoiceTariffDefault({...f.document,...bad},f.products[0]),null);
 for(const bad of [{ProdKey:123},{ProdName:'Unknown'},{isDeleted:true},{CounName:'미국'}])assert.equal(auInvoiceTariffDefault(f.document,{...f.products[0],...bad}),null);
 assert.equal(auInvoiceTariffDefault(f.document,{...f.products[0],ProdKey:2997,ProdName:'Wolly Bush Green Tip '}).tariffRate,0);
});
test('cost edit preserves header and unchanged row inputs; changed product requires new tariff and preview',()=>{
 const f=fixture(),doc=f.document;
 doc.reviewedMetadata.invoiceCostInput={lineInputs:[{lineId:id,stemsPerBunch:5,bunchesPerBox:30}]};
 const saved=rememberInvoiceCostInput(doc,{exchangeRateKRW:1000,customsTotalKRW:10000,freightAmount:0,lineInputs:[{lineId:id,tariffRate:0}]});
 assert.equal(restoreInvoiceCostInput(doc,saved).reviewedMetadata.invoiceCostInput.lineInputs[0].tariffRate,0);
 const changed=structuredClone(doc);changed.lines[0].prodKey=2998;
 const restored=restoreInvoiceCostInput(changed,saved).reviewedMetadata.invoiceCostInput;
 assert.equal(restored.exchangeRateKRW,1000);assert.equal(restored.customsTotalKRW,10000);assert.equal(restored.freightAmount,0);
 assert.equal(restored.lineInputs[0].tariffRate,undefined);assert.equal(restored.lineInputs[0].stemsPerBunch,5);
 assert.equal(restored.formulaApplicabilityConfirmed,false);
 for(const field of ['orderYear','orderWeek','sourceHash','documentId']){const other={...doc,[field]:'different'};assert.equal(restoreInvoiceCostInput(other,saved),other);}
});
test('cost view exposes Woolly editor even with no prepare issue and renders matched names',()=>{
 const draft=readFileSync(new URL('../components/import-tools/InvoiceDraftCost.js',import.meta.url),'utf8');
 const review=readFileSync(new URL('../components/import-tools/InvoiceReceiptCostReview.js',import.meta.url),'utf8');
 const bench=readFileSync(new URL('../components/import-tools/InvoiceReceiptWorkbench.js',import.meta.url),'utf8');
 assert.match(draft,/Woolly bush 품목 선택·변경/);assert.match(draft,/restoreInvoiceCostInput/);
 assert.match(review,/matchedProduct\.ProdName/);assert.match(review,/onClick=\{onEditAllocation\}/);
 assert.match(bench,/onEditAllocation=.*setAllocationOpen\(true\)/);
});
function fixture(){
 const document={orderYear:'2026',orderWeek:'44-01',sourceHash:'ab'.repeat(32),originalFileName:'44-01 호주 CI.pdf',
  invoiceNo:'41002',farmKey:null,invoiceYear:null,rawMetadata:{},reviewedMetadata:{country:'AU',transportMode:'AIR',inputDate:'2026-10-26'},
  lines:[{lineId:id,lineNo:1,originalName:'Wax flower White',prodKey:123,boxQuantity:4,bunchQuantity:120,stemQuantity:600,
   priceUnit:'단',unitPrice:8.5,lineAmount:1020,currency:'AUD',reviewed:{confirmed:true},sourceEvidence:{}}]};
 const products=[{ProdKey:123,ProdName:'Wax flower White',CounName:'호주',CountryFlower:'왁스',OutUnit:'단',EstUnit:'단',SteamOf1Box:150,SteamOf1Bunch:5,BunchOf1Box:30,isDeleted:0}];
 const queries=[];const queryFn=async(sql,params)=>{assert.match(sql,/SELECT.*ProdKey/s);assert.doesNotMatch(sql,/\b(UPDATE|DELETE|INSERT|EXEC|Warehouse|StockMaster|Shipment|WebInvoice)\b/i);queries.push({sql,params});return{recordset:structuredClone(products)};};
 const input={...INVOICE_COST_FORMULAS.AU_CNF_BUNCH_V1,formulaApplicabilityConfirmed:true,formulaEffectiveDate:'2026-10-26',
  nativeCurrency:'AUD',freightCurrency:'AUD',exchangeRateKRW:1000,exchangeRateType:'TEST_ONLY',exchangeRateDate:'2026-10-26',freightAmount:0,
  customsTotalKRW:10000,costSourceId:'TEST_ONLY',allocationScope:'SINGLE_INVOICE',allocationShareNumerator:1,allocationShareDenominator:1,
  lineInputs:[{lineId:id,tariffRate:0,stemsPerBunch:5,bunchesPerBox:30}]};
 return{document,products,queries,queryFn,input,types:{Int:'INT'}};
}
const prepare=f=>prepareInvoiceCostPreview({...f,request:{document:f.document}});
const request=(p,input)=>({baselineDigest:p.baselineDigest,input});
test('Woolly product change revalidates, rejects old digest and exports with exact totals in each year',async()=>{
 for(const year of ['2025','2026']){
  const f=fixture();f.document.orderYear=year;f.document.reviewedMetadata.inputDate=`${year}-10-26`;
  const line=f.document.lines[0];line.originalName='Woolly bush';line.prodKey=2997;
  f.document.rawMetadata.allocationSources=[allocationSource(line)];
  line.sourceEvidence={allocationSourceId:id};line.reviewed.allocationConfirmed=true;
  f.products.splice(0,1,...[2997,2998].map((ProdKey,i)=>({...f.products[0],ProdKey,ProdName:`Wolly Bush ${i?'Red':'Green'} Tip`,country:'AU',selectable:true})));
  const old=await prepare(f);assert.deepEqual(old.issues,[]);
  f.document=applyInvoiceAllocation(f.document,id,[{...line,prodKey:2998}],f.products);
  const next=await prepare(f);assert.deepEqual(next.issues,[]);assert.notEqual(old.baselineDigest,next.baselineDigest);
  assert.throws(()=>calculateInvoiceCostPreview(next,request(old,f.input)),/변경/);
  f.input.formulaEffectiveDate=`${year}-10-26`;f.input.exchangeRateDate=`${year}-10-26`;
  const result=calculateInvoiceCostPreview(next,request(next,f.input));assert.equal(result.preview.status,'APPROVED');
  assert.equal(next.document.receiptLines[0].prodKey,2998);assert.equal(next.document.receiptLines[0].lineAmount,1020);
  assert.equal(result.preview.totals.totalCostKRW,1030000);assert.ok((await createInvoicePreviewCostWorkbook(result)).length>1000);
 }
});
test('new AU upload calculates and exports without FarmKey, native receipt, CW, draft save or approval',async()=>{
 const f=fixture(),before=JSON.stringify(f.document),p=await prepare(f);assert.deepEqual(p.issues,[]);
 assert.deepEqual(p.document.operations,[]);assert.equal(p.document.receiptStatus,'INVOICE_PREVIEW');
 const result=calculateInvoiceCostPreview(p,request(p,f.input));assert.equal(result.preview.status,'APPROVED',JSON.stringify(result.preview.issues));
 assert.equal(result.preview.totals.totalCostKRW,1030000);
 const book=XLSX.read(await createInvoicePreviewCostWorkbook(result));
 const s=book.Sheets['2026 44-01'];assert.match(s.B1.v,/인보이스 41002.*입고 미반영/);assert.match(s.B1.v,/TEST_ONLY/);
 assert.equal(p.document.receiptLines[0].lineAmount,1020);assert.equal(p.document.receiptLines[0].unitPrice,8.5);
 assert.equal(JSON.stringify(f.document),before);assert.equal(f.queries.length,1);
 await assert.rejects(createNativeCostWorkbook(result));await assert.rejects(createInvoiceCostWorkbook({document:p.document,revision:result.preview,snapshot:{input:f.input}}));
});
test('native TPrice is not silently substituted or divided in upload route',async()=>{
 const f=fixture();f.document.lines[0].lineAmount=5100;const p=await prepare(f);
 assert.ok(p.issues.some(i=>i.code==='INVOICE_AMOUNT_MISMATCH'));assert.equal(p.document.receiptLines[0].unitPrice,8.5);
 assert.throws(()=>calculateInvoiceCostPreview(p,request(p,f.input)),/수량×단가/);
});
for(const[name,mutate,code]of[
 ['unmatched',f=>f.document.lines[0].prodKey=null,'PRODUCT_REQUIRED'],
 ['deleted',f=>f.products[0].isDeleted=1,'PRODUCT_REQUIRED'],
 ['country',f=>f.products[0].CounName='미국','PRODUCT_COUNTRY_CONFLICT'],
 ['review',f=>f.document.lines[0].reviewed.confirmed=false,'SOURCE_REVIEW_REQUIRED'],
 ['conversion',f=>f.document.lines[0].sourceEvidence.conversionValidation={status:'MISMATCH'},'CONVERSION_REVIEW_REQUIRED'],
 ['warnings',f=>f.document.sourceWarnings=['원문 확인'],'SOURCE_WARNING'],
 ['allocation',f=>f.document.lines[0].originalName='Woolly bush Green Tip','PRODUCT_ALLOCATION_REQUIRED'],
 ['quantity',f=>f.document.lines[0].bunchQuantity=12,'INVOICE_AMOUNT_MISMATCH'],
 ['price unit',f=>f.document.lines[0].priceUnit='박스','INVOICE_AMOUNT_MISMATCH'],
 ['date',f=>f.document.reviewedMetadata.inputDate='2026-02-30','INPUT_DATE_REQUIRED'],
 ['transport',f=>f.document.reviewedMetadata.transportMode='','TRANSPORT_REQUIRED'],
])test(`blocks ${name} with row issue`,async()=>{const f=fixture();mutate(f);const p=await prepare(f);assert.ok(p.issues.some(i=>i.code===code),JSON.stringify(p.issues));assert.throws(()=>calculateInvoiceCostPreview(p,request(p,f.input)));});
test('prior year same week remains separate, changed year/date and baseline reject',async()=>{
 const f=fixture(),a=await prepare(f);f.document.orderYear='2025';f.document.reviewedMetadata.inputDate='2025-10-26';const b=await prepare(f);
 assert.equal(b.document.orderYear,'2025');assert.notEqual(a.baselineDigest,b.baselineDigest);
 assert.throws(()=>calculateInvoiceCostPreview(b,request(a,f.input)),/변경/);
 f.document.reviewedMetadata.inputDate='2026-10-26';assert.ok((await prepare(f)).issues.some(i=>i.code==='SOURCE_YEAR_CONFLICT'));
});
test('input and Product changes invalidate prepared download; missing cost and wrong formula fail closed',async()=>{
 const f=fixture(),p=await prepare(f);f.products[0].SteamOf1Bunch=10;
 const changed=await prepare(f);assert.throws(()=>calculateInvoiceCostPreview(changed,request(p,f.input)),/변경/);
 const noCost=calculateInvoiceCostPreview(p,request(p,{...f.input,customsTotalKRW:null}));assert.equal(noCost.preview.status,'REVIEW_REQUIRED');
 await assert.rejects(createInvoicePreviewCostWorkbook(noCost));
 assert.throws(()=>calculateInvoiceCostPreview(p,request(p,{...f.input,formulaId:'NL_AMOUNT_V1'})),/공식/);
});
// CLOUD has its own category/farm-specific fixture in chinaCloudCostWorkbook.test.js.
for(const formula of Object.values(INVOICE_COST_FORMULAS).filter(f=>f.formulaId!=='CN_CLOUD_CBM_V1'))test(`${formula.formulaId} invoice-only keeps verified formula and Excel template`,async()=>{
 const f=invoiceCostExportFixture(1,formula.formulaId),names={AU:'호주',US:'미국',VN:'베트남',TH:'태국',CO:'콜롬비아',EC:'에콰도르',CN:'중국',NL:'네덜란드',NZ:'뉴질랜드'};
 const line=f.document.lines[0],quantity=f.document.operations[0].result.lineMappings[0].outQuantity;
 line.bunchQuantity=quantity;line.stemQuantity=quantity*5;line.boxQuantity=quantity/20;
 line.priceUnit=({BUNCH:'단',BOX:'박스',STEM:'송이'})[line.priceUnit];line.reviewed={confirmed:true};
 Object.assign(f.document,{originalFileName:'TEST_ONLY.pdf',rawMetadata:{},operations:[],farmKey:null,revision:null});
 const products=[{ProdKey:line.prodKey,ProdName:line.originalName,CounName:names[formula.country],OutUnit:'단',EstUnit:'단',SteamOf1Box:100,SteamOf1Bunch:5,BunchOf1Box:20,isDeleted:0}];
 const p=await prepareInvoiceCostPreview({queryFn:async sql=>{assert.doesNotMatch(sql,/\b(INSERT|UPDATE|DELETE|EXEC)\b/);return{recordset:products};},types:{Int:'INT'},request:{document:f.document}});
 assert.deepEqual(p.issues,[],formula.formulaId);const result=calculateInvoiceCostPreview(p,request(p,f.snapshot.input));
 assert.equal(result.preview.status,'APPROVED',JSON.stringify(result.preview.issues));
 const book=XLSX.read(await createInvoicePreviewCostWorkbook(result));assert.match(book.Sheets['2026 41-02'].B1.v,/인보이스 CURRENT-EXPORT/);
 assert.ok(Math.abs(result.preview.totals.totalCostKRW-f.revision.totalCostKRW)<0.01);
});
function response(){return{statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(s){this.statusCode=s;return this;},json(d){this.body=d;return this;},send(d){this.body=d;return this;}};}
test('HTTP exports verified bytes; no unsupported AU existing-link route or writes',async()=>{
 const f=fixture(),handler=createInvoiceCostPreviewHandler({...f,authorize:u=>u?.allowed});
 const p=await prepare(f),res=response();await handler({method:'POST',user:{allowed:true},body:{action:'download',document:f.document,...request(p,f.input)}},res);
 assert.equal(res.statusCode,200,JSON.stringify(res.body));assert.ok(Buffer.isBuffer(res.body));assert.equal(f.queries.length,3);
 const unauthorized=response();await handler({method:'POST',user:{},body:{}},unauthorized);assert.equal(unauthorized.statusCode,403);
 const invalid=response();await handler({method:'POST',user:{allowed:true},body:{action:'commit'}},invalid);assert.equal(invalid.statusCode,400);
});
test('post-render Product change blocks download',async()=>{
 const f=fixture(),p=await prepare(f),handler=createInvoiceCostPreviewHandler({...f,authorize:()=>true,generate:async()=>{f.products[0].OutUnit='송이';return Buffer.from('test');}}),res=response();
 await handler({method:'POST',body:{action:'download',document:f.document,...request(p,f.input)}},res);assert.equal(res.statusCode,409);
});
test('UI has independent upload and existing data paths, no receipt/write request in invoice calculator',()=>{
 const ui=readFileSync('components/import-tools/InvoiceDraftCost.js','utf8');assert.doesNotMatch(ui,/link-existing|\/commit|saveDraft|\/cost-export|\/cost['"`]/);
 assert.match(ui,/baselineDigest/);assert.match(ui,/active.current!==serialized/);
 assert.match(ui,/className={styles.invoiceCostPreview}/);assert.match(readFileSync('styles/InvoiceReceipt.module.css','utf8'),/\.invoiceCostPreview\s*\{\s*display:block/);
 assert.match(readFileSync('pages/import/tools.js','utf8'),/IndependentCostWorkspace key=\{userId\}/);
 assert.match(readFileSync('components/import-tools/IndependentCostWorkspace.js','utf8'),/workspaceMode="cost"/);
 assert.match(readFileSync('components/import-tools/InvoiceReceiptWorkbench.js','utf8'),/InvoiceDraftCost document={documentValue}/);
});
test('NL 48-1 direct invoice draft consolidates 10 raw CI lines into 7 genNL rows with exact bunch ratios and customer split',async()=>{
 const nlProducts=[
  {ProdKey:114,ProdName:'Amaryllis / Loyalty',CounName:'네덜란드',CountryFlower:'네덜란드',OutUnit:'송이',EstUnit:'송이',SteamOf1Box:0,SteamOf1Bunch:0,BunchOf1Box:0,isDeleted:0},
  {ProdKey:116,ProdName:'Amaryllis / Mont Blanc 12st White',CounName:'네덜란드',CountryFlower:'네덜란드',OutUnit:'송이',EstUnit:'송이',SteamOf1Box:0,SteamOf1Bunch:0,BunchOf1Box:0,isDeleted:0},
  {ProdKey:119,ProdName:'Amaryllis / Rilona (Salmon) 12st',CounName:'네덜란드',CountryFlower:'네덜란드',OutUnit:'송이',EstUnit:'송이',SteamOf1Box:0,SteamOf1Bunch:0,BunchOf1Box:0,isDeleted:0},
  {ProdKey:1732,ProdName:'Skimmia / Champagne',CounName:'네덜란드',CountryFlower:'네덜란드',OutUnit:'단',EstUnit:'단',SteamOf1Box:null,SteamOf1Bunch:3,BunchOf1Box:1,isDeleted:0},
  {ProdKey:1733,ProdName:'Skimmia / Conf Kew Ger Green',CounName:'네덜란드',CountryFlower:'네덜란드',OutUnit:'단',EstUnit:'단',SteamOf1Box:0,SteamOf1Bunch:3,BunchOf1Box:1,isDeleted:0},
  {ProdKey:1737,ProdName:'Skimmia / Jap Rubella Red',CounName:'네덜란드',CountryFlower:'네덜란드',OutUnit:'단',EstUnit:'단',SteamOf1Box:0,SteamOf1Bunch:3,BunchOf1Box:1,isDeleted:0},
  {ProdKey:3445,ProdName:'Hydrangea Classic Verena Green/Red 60cm-20cm ',CounName:'네덜란드',CountryFlower:'네덜란드',OutUnit:'송이',EstUnit:'송이',SteamOf1Box:30,SteamOf1Bunch:0,BunchOf1Box:0,isDeleted:0},
 ];
 const raw10=[
  ['CL30','HIPPEASTRUM MONT BLANC 12x 4 80cm',116,12,2.54,30.48],
  ['CL30','HIPPEASTRUM RILONA 12x 4 85cm',119,12,3.36,40.32],
  ['CLR','HYDRANGEA CLASSIC VERENA GREEN/RED 60cm 18cm',3445,50,3.85,192.5],
  ['KCL03','SKIMMIA KEW GREEN 45cm',1733,360,1.49,536.4],
  ['YCL10','HIPPEASTRUM LOYALTY 12x 4 80cm',114,12,3.37,40.44],
  ['YCL10','HIPPEASTRUM MONT BLANC 12x 4 80cm',116,12,2.54,30.48],
  ['YCL10','HIPPEASTRUM RILONA 12x 4 85cm',119,12,3.36,40.32],
  ['CL4','SKIMMIA DYED CHAMPAGNE 45cm',1732,90,1.55,139.5],
  ['CL4','SKIMMIA KEW GREEN 45cm',1733,90,1.49,134.1],
  ['CL4','SKIMMIA RUBELLA 50cm',1737,90,1.5,135],
 ].map(([cl,originalName,prodKey,stemQuantity,unitPrice,lineAmount],i)=>({
  lineId:`bbbbbbbb-bbbb-4bbb-8bbb-${String(i+1).padStart(12,'0')}`,
  lineNo:i+1,originalName,prodKey,boxQuantity:null,bunchQuantity:null,stemQuantity,
  priceUnit:'송이',unitPrice,lineAmount,currency:'EUR',reviewed:{confirmed:true},
  sourceEvidence:{invoiceCustomerCode:cl},
 }));
 const document={orderYear:'2026',orderWeek:'48-01',sourceHash:'cd'.repeat(32),originalFileName:'48-1_NL_CI_UPDATED.pdf',
  invoiceNo:'1223663',farmKey:null,invoiceYear:'2026',rawMetadata:{},
  reviewedMetadata:{country:'NL',transportMode:'AIR',inputDate:'2026-11-25',gw:111.9,cw:125,
   costInputs:{freight:{currency:'EUR',amount:353.84,source:'invoice'},docFee:{currency:'EUR',amount:50,source:'invoice'}}},
  lines:raw10};
 const queryFn=async sql=>{assert.doesNotMatch(sql,/\b(INSERT|UPDATE|DELETE|EXEC)\b/i);return{recordset:structuredClone(nlProducts)};};
 const p=await prepareInvoiceCostPreview({queryFn,types:{Int:'INT'},request:{document}});
 assert.deepEqual(p.issues,[]);
 assert.equal(p.document.lines.length,7);
 assert.deepEqual(p.document.lines.map(l=>[l.prodKey,l.stemQuantity,l.bunchQuantity,l.lineAmount]),[
  [116,24,24,60.96],[119,24,24,80.64],[1733,450,150,670.5],[1737,90,30,135],[114,12,12,40.44],[3445,50,50,192.5],[1732,90,30,139.5],
 ]);
 const lineInputs=p.document.reviewedMetadata.invoiceCostInput.lineInputs;
 assert.deepEqual(lineInputs.map(l=>l.stemsPerBunch),[1,1,3,3,1,1,3]);
 const tpl=nlCompanyTemplateCost(p.document.receiptLines.map((l,i)=>({...l,effectiveTariffRate:lineInputs[i].tariffRate})),{gw:111.9,freight:403.84,exchangeRate:1750});
 const formula=INVOICE_COST_FORMULAS.NL_AMOUNT_V1;
 const input={...p.document.reviewedMetadata.invoiceCostInput,...formula,formulaApplicabilityConfirmed:true,
  nativeCurrency:'EUR',freightCurrency:'EUR',freightAmount:403.84,exchangeRateKRW:1750,exchangeRateType:'MANUAL',exchangeRateDate:'2026-11-25',
  customsTotalKRW:tpl.total,expenseBasis:'ESTIMATED',estimateSource:tpl.estimateSource,nlTemplateCosts:tpl.costs,lineInputs};
 const calc=calculateInvoiceCostPreview(p,request(p,input));
 assert.equal(calc.preview.status,'APPROVED');
 calc.nlComparison=await nlComparisonForExport({document:calc.document});
 assert.equal(calc.nlComparison.status,'READY');
 assert.equal(calc.nlComparison.rows.reduce((s,r)=>s+r.other,0),740);
 const orig=XLSX.read(await createInvoicePreviewCostWorkbook(calc),{cellFormula:true}).Sheets['원본 양식 계산'];
 assert.ok(Math.abs(orig.S6.v - 164288.54570430366) < 1e-6);
 assert.ok(Math.abs(orig.Q10.v - 588762.5457043037) < 1e-6);
 assert.ok(Math.abs(orig.O15.v - 6938.691489) < 1e-4);
 assert.ok(Math.abs(orig.O17.v - 12211.004311) < 1e-4);
});
import './costStepGuide.test.cjs';
