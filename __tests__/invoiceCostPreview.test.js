import test from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import {prepareInvoiceCostPreview,calculateInvoiceCostPreview,createInvoiceCostPreviewHandler} from '../lib/invoiceCostPreview.js';
import {createInvoicePreviewCostWorkbook,createInvoiceCostWorkbook,createNativeCostWorkbook} from '../lib/invoiceReceiptCostExport.js';
import {INVOICE_COST_FORMULAS} from '../lib/invoiceReceiptCost.js';
import {readFileSync} from 'node:fs';
import {invoiceCostExportFixture} from './invoiceReceiptCostExport.test.js';

const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
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
for(const formula of Object.values(INVOICE_COST_FORMULAS))test(`${formula.formulaId} invoice-only keeps verified formula and Excel template`,async()=>{
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
 assert.match(readFileSync('pages/import/tools.js','utf8'),/invoiceCostIntent\?'cost':'receipt'/);
 assert.match(readFileSync('components/import-tools/InvoiceReceiptWorkbench.js','utf8'),/InvoiceDraftCost document={documentValue}/);
});
