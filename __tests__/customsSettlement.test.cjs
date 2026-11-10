const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');
const { buildSettlementPlan, mergeOverlay } = require('../lib/customsSettlementPlan.cjs');
const { applySettlementPlan, readLedger } = require('../lib/customsSettlementStore.cjs');
const { inspectSettlementZip } = require('../lib/customsSettlementZip.cjs');
const { parseSettlementPage } = require('../lib/customsSettlementParser.cjs');
const jobs = require('../lib/customsSettlementJobs.cjs');
const receipt = (id = 'TEST-001', total = 110) => ({ issuer: 'SUNYUL', documentId: id, sourceHash: 'a'.repeat(64), awb: '123-12345678', date: '2026-08-30', charges: [{ code: 'HANDLING', net: total / 1.1, vat: total - total / 1.1, total }], total });
// Integers are intentionally literal: no floating-point invoice derivation.
function doc(id = 'TEST-001', net = 100) { return { ...receipt(id), charges: [{ code: 'HANDLING', net, vat: net / 10, total: net + net / 10 }], total: net + net / 10 }; }
const targetKey = 'country|태국|01';
const base = () => ({ year: 2026, major: 35, receipts: [doc()], candidates: [{ year: 2026, orderWeek: '35-01', awb: '12312345678', targetKey }], mapping: { country: { HANDLING: { field: 'SunYul1_1', basis: 'total' } } } });
test('positive exact scope and separate documents sum', () => { const input = base(); input.receipts.push(doc('TEST-002', 200)); const p = buildSettlementPlan(input); assert.equal(p.patches[0].amount, 330); assert.equal(p.canApply, true); });
test('prior year, unknown AWB, ambiguous targets, and document mismatch reject', () => {
  for (const mutate of [x => { x.candidates[0].year = 2025; }, x => { x.candidates[0].awb = '12399999999'; }, x => x.candidates.push({ ...x.candidates[0], targetKey: 'country|중국|01' }), x => x.receipts.push(doc('TEST-001', 200))]) { const x = base(); mutate(x); assert.ok(buildSettlementPlan(x).issues.length); }
});
test('explicit zero/manual preserved, equal covered, unknown charge blocked', () => {
  for (const value of [0, 90]) assert.equal(buildSettlementPlan({ ...base(), saved: { [targetKey]: { SunYul1_1: value } } }).patches[0].status, 'conflict');
  assert.equal(buildSettlementPlan({ ...base(), saved: { [targetKey]: { SunYul1_1: 110 } } }).patches[0].status, 'covered');
  assert.deepEqual(mergeOverlay({ SunYul1_1: 0 }, { SunYul1_1: 110 }), { SunYul1_1: 0 });
  assert.ok(buildSettlementPlan({ ...base(), mapping: {} }).issues.length);
});
test('bad arithmetic and omitted year never default', () => { const x = base(); x.receipts[0].charges[0].vat++; assert.throws(() => buildSettlementPlan(x)); assert.throws(() => buildSettlementPlan({ ...base(), year: undefined })); });
test('atomic file apply reruns same policy; stale abort, repeated document no-op', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'customs-settlement-test-'));
  const makePlan = async ledger => buildSettlementPlan({ ...base(), applied: ledger.documents });
  const initial = await makePlan(await readLedger(root, 2026, 35));
  await assert.rejects(applySettlementPlan({ root, year: 2026, major: 35, expectedDigest: 'stale', confirmed: true, actor: 'TEST', makePlan }), /바뀌었습니다/);
  const first = await applySettlementPlan({ root, year: 2026, major: 35, expectedDigest: initial.planDigest, confirmed: true, actor: 'TEST', makePlan });
  assert.equal(first.erpWrites, 0); const again = await makePlan(await readLedger(root, 2026, 35));
  assert.equal(again.canApply, false); assert.equal((await readLedger(root, 2026, 35)).revision, 1);
});
test('ZIP raw hash deduplicates and refuses non PDF/path traversal', async () => {
  const zip = new JSZip(); zip.file('a.pdf', '%PDF-test'); zip.file('b.pdf', '%PDF-test');
  assert.equal((await inspectSettlementZip(await zip.generateAsync({ type: 'nodebuffer' }))).files.length, 1);
  zip.file('../secret.txt', 'x'); await assert.rejects(inspectSettlementZip(await zip.generateAsync({ type: 'nodebuffer' })), /PDF 외/);
});
function syntheticPage() {
  const items = [], add = (str, x, y) => items.push({ str: String(str), x: x * 1000, y: y * 1000, width: 10, height: 8 });
  add('2026-08-30', .21, .73); add('12345-26-123456M', .42, .73); add('12312345678', .42, .71);
  ['관세','부가세','통관수수료','검역대행수수료','비용합계(a)'].forEach((s,i)=>add(s,.09,.56-i*.02));
  const amounts = [[0,0,1200],[0,0,5000],[27000,2700,29700],[40000,4000,44000]];
  amounts.forEach((row,i)=>row.forEach((value,j)=>add(value,[.30,.42,.53][j],.56-i*.02)));
  add(79900,.53,.48);
  return { page: 1, width: 1000, height: 1000, items };
}
test('first page parser verifies tax exception and excludes payment rows', () => {
  const page = syntheticPage(); page.items.push({str:'99999999',x:530,y:420,width:10,height:8});
  const result = parseSettlementPage(page,'a'.repeat(64)); assert.equal(result.total,79900); assert.equal(result.charges[0].net,0);
  assert.throws(()=>parseSettlementPage({...page,page:2},'a'.repeat(64)));
});
test('only unreadable fee VAT may be derived, with explicit provenance', () => {
  const page = syntheticPage(); page.items.find(i=>i.str==='2700').str='거700';
  assert.equal(parseSettlementPage(page,'a'.repeat(64)).charges[2].vatSource,'VAT_DERIVED_FROM_NET_TOTAL');
  page.items.find(i=>i.str==='29700').str='29701'; assert.throws(()=>parseSettlementPage(page,'a'.repeat(64)));
  const wrong=syntheticPage();wrong.items.find(i=>i.str==='79900').str='7990';assert.throws(()=>parseSettlementPage(wrong,'a'.repeat(64)));
});
test('split manual second/third parts compare whole group; ItemCount 0 is protected', () => {
  const saved = {[targetKey]:{SunYul1_2:80,SunYul1_3:30}};
  assert.equal(buildSettlementPlan({...base(),saved}).patches[0].status,'covered');
  saved[targetKey].SunYul1_3=31; assert.equal(buildSettlementPlan({...base(),saved}).patches[0].status,'conflict');
  const x=base();x.candidates[0].targetKey='colombia|35-01';x.mapping={colombia:{HANDLING:{field:'ActualQuarantineAgencyFee',basis:'net'}}};x.saved={'colombia|35-01':{ItemCount:0}};
  assert.ok(buildSettlementPlan(x).issues.some(i=>i.code==='ITEM_COUNT_CONFLICT'));
});
test('later split extends file source total, duplicate ZIP/doc never re-adds', async () => {
  const first=buildSettlementPlan(base()); const input=base();input.applied=first.documents;input.receipts=[doc('TEST-002',200)];
  assert.equal(buildSettlementPlan(input).patches[0].amount,330);
});
test('wrong-year ledger and corrupt file fail closed', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'customs-bad-scope-'));
  await fs.writeFile(path.join(root,'2026-35.json'),JSON.stringify({version:1,year:'2025',major:'35',revision:1,documents:[],values:{},history:[]}));
  await assert.rejects(readLedger(root,2026,35),/읽지 못했습니다/);
});
test('jobs isolate owner, keep PDF sidecar not JSON, reject other pages, delete raw source', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'customs-jobs-test-')),zip=new JSZip();zip.file('35-1차 12312345678 분할2.pdf','%PDF-synthetic');
  const input={year:2026,major:35,zipBase64:(await zip.generateAsync({type:'nodebuffer'})).toString('base64')};
  const job=await jobs.createSettlementJob('A',input,{root});assert.equal(await jobs.getSettlementJob('B',job.jobId,{root}),null);
  const raw=await fs.readFile(path.join(root,job.jobId+'.json'),'utf8');assert(!raw.includes('pdfBase64'));assert(!raw.includes('%PDF-'));
  const claim=await jobs.claimSettlementJob({root});assert.equal(claim.firstPageOnly,true);
  await assert.rejects(jobs.finishSettlementJob({...claim,result:{sourceHash:claim.sourceHash,pageCount:8,pages:[syntheticPage(),{...syntheticPage(),page:2}]}},{root}),/첫 페이지/);
  await jobs.finishSettlementJob({...claim,result:{sourceHash:claim.sourceHash,pageCount:8,pages:[syntheticPage()]}},{root});
  await assert.rejects(fs.stat(path.join(root,job.jobId,claim.sourceHash+'.pdf')),/ENOENT/);
  const result=await jobs.getSettlementJob('A',job.jobId,{root});assert.equal(result.files[0].status,'READY');assert.equal(result.files[0].hint.part,'2');
});
test('expired job cleans raw PDF and allows same ZIP retry; stale claim is recovered', async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'customs-ttl-test-')),zip=new JSZip();zip.file('a.pdf','%PDF-test-ttl');
  const input={year:2026,major:35,zipBase64:(await zip.generateAsync({type:'nodebuffer'})).toString('base64')};
  const job=await jobs.createSettlementJob('A',input,{root}),claim=await jobs.claimSettlementJob({root});
  const filename=path.join(root,job.jobId+'.json'),record=JSON.parse(await fs.readFile(filename));record.files[0].claimedAt=Date.now()-301000;await fs.writeFile(filename,JSON.stringify(record));
  const recovered=await jobs.claimSettlementJob({root});assert.notEqual(recovered.claimToken,claim.claimToken);
  record.createdAt=Date.now()-7200001;await fs.writeFile(filename,JSON.stringify(record));
  const retried=await jobs.createSettlementJob('A',input,{root});assert.notEqual(retried.jobId,job.jobId);
  await assert.rejects(fs.stat(path.join(root,job.jobId,claim.sourceHash+'.pdf')),/ENOENT/);
});
test('replay bypass, explicit evidence snapshot, manual preservation and CO actual agency', async()=>{
  const evidence=await import('../lib/customsSettlementEvidence.js'),context=await import('../lib/erpReadContext.js'),calc=await import('../lib/customsForwardingCalc.js');
  await context.withErpReadContext({queryFn:async()=>({recordset:[]})},async()=>{assert.equal((await evidence.loadSettlementEvidence(2026,35)).diagnostic,'SETTLEMENT_EXTERNAL_EVIDENCE_NOT_SUPPLIED');});
  const ledger={version:1,year:'2026',major:'35',revision:1,documents:buildSettlementPlan(base()).documents,history:[],values:{[targetKey]:{SunYul1_1:110}}};
  await context.withErpReadContext({queryFn:async()=>({recordset:[]}),externalEvidence:{'customs-settlement:2026:35':ledger}},async()=>{assert.equal(await evidence.loadSettlementEvidence(2026,35),await evidence.loadSettlementEvidence(2026,35));});
  const original={SunYul1_2:99};assert.equal(evidence.settlementCountryRow(original,ledger,'태국').SunYul1_1,110);assert.equal(original.SunYul1_2,99);
  assert.equal(calc.computeColombiaCustomsTotal({ItemCount:4,ActualQuarantineAgencyFee:0},{QuarantinePerItemRate:10000}),0);
});
test('goods country matching ignores freight and prior year, shared CO stays one pool',async()=>{
  const {settlementContextFromRows}=await import('../lib/customsSettlementContext.js');
  const goods={OrderYear:'2026',OrderWeek:'35-01',OrderNo:'12312345678',WarehouseKey:1,ProdKey:1,CounName:'태국',FlowerName:'덴드륨',ProdName:'DENDROBIUM'};
  const r=settlementContextFromRows({year:2026,major:35,warehouse:[goods,{...goods,WarehouseKey:2,ProdKey:2,CounName:'중국',ProdName:'운송료'},{...goods,OrderYear:'2025'}],countries:[],colombia:[],confirmed:false});assert.equal(r.candidates.length,1);assert.equal(r.candidates[0].targetKey,targetKey);
  const co=settlementContextFromRows({year:2026,major:35,warehouse:[{...goods,CounName:'콜롬비아',FlowerName:'장미',ProdName:'ROSE'},{...goods,WarehouseKey:3,CounName:'콜롬비아',FlowerName:'수국',ProdName:'HYDRANGEA'}],countries:[],colombia:[],confirmed:false});assert.equal(co.candidates[0].targetKey,'colombia|35-01');
});
test('Thai report sees new file SunYul as gross; legacy manual net policy unchanged',async()=>{
  const {resolveApprovedThaiCustoms}=await import('../lib/profitReportActualCosts.mjs');
  const args={goods:100,freight:10,freightSource:'sql',rate:1000,orderYear:2026,major:35};
  const input={policyInput:{orderYear:'2026',major:35,row:{Customs1:0,Customs2:0,SunYul1:110,SunYul2:0},gw:{GW1:100,GW2:0},inboundWeeks:['35-01']}};
  assert.equal(resolveApprovedThaiCustoms(input,args).components.sunYul,110);
  input.policyInput.row.SettlementSunYulGrossPhases=[1];assert.ok(Math.abs(resolveApprovedThaiCustoms(input,args).components.sunYul-100)<1e-8);
});
