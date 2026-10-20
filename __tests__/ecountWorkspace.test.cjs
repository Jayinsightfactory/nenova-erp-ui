'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const p=require('../lib/ecountWorkspacePolicy.cjs');
const menus=require('../data/ecount-workbench/source-menu.json').menus;
const menuId=menus.find(m=>m.program===p.PROGRAMS.sales).id;
const base={dataset:'sales',menuId,action:'import',expectedRevision:0,reasonCode:'IMPORT',periodFrom:'2026-01-01',periodTo:'2026-01-31',rows:[{qty:'1.2500',unitPrice:'100',supplyAmt:'125',vat:'12.50',total:'137.50',refDate:'2026-01-03',custName:'SENSITIVE_NAME',account:'SENSITIVE_ACCOUNT',memo:'SENSITIVE_MEMO',password:'SECRET'}]};
const user={userId:'synthetic-admin',authority:1,accountActive:true};
const quoteBase={dataset:'quote',menuId:menus.find(m=>m.program===p.PROGRAMS.quote).id,action:'import',expectedRevision:0,reasonCode:'IMPORT',periodFrom:'2026-01-01',periodTo:'2026-01-31',rows:[{refDate:'2026/01/03 -12',estimateTotal:'12345678901234567890.12345678',custName:'PRIVATE_CUSTOMER',prodName:'PRIVATE_PRODUCT',memo:'PRIVATE_MEMO',status:'PRIVATE_STATUS'}]};
assert(Object.keys(p.PROGRAMS).every(key=>/^[A-Za-z][A-Za-z0-9]{0,9}$/.test(key)));
assert.deepEqual(p.SOURCE_DATASETS,['cash','ar','ap','sales']);
const purchaseBase={...quoteBase,dataset:'purchase',menuId:menus.find(m=>m.program==='E040304').id,rows:[{refDate:'2026/01/03 -12',amountTotal:'12345678901234567890.12345678',foreignTotal:'0.00000001',exchangeRate:'1300.00000000',custName:'PRIVATE_CUSTOMER',memo:'PRIVATE_MEMO'}]};
const buyStatusBase={...purchaseBase,dataset:'buyStatus',menuId:'MENUTREE_000583',rows:[{refDate:'2026/01/03 -1',qty:'1.00000001',boxQty:'2.00000002',unitPrice:'12345678901234567890.12345678',foreignAmount:'4',supplyAmt:'5',exchangeRate:'6',total:'7',weight:'8',custName:'PRIVATE_CUSTOMER',invoiceNumber:'PRIVATE_INVOICE',paymentDate:'PRIVATE_DATE'}]};
const safePurchaseStatus=p.prepareImport(buyStatusBase);assert.equal(safePurchaseStatus.menuId,'MENUTREE_000513');assert.equal(safePurchaseStatus.completeness,'unknown');assert.equal(safePurchaseStatus.rows[0].unitPrice,'12345678901234567890.12345678');assert(!JSON.stringify(safePurchaseStatus).includes('PRIVATE_'));assert.equal(p.prepareImport({...buyStatusBase,menuId:'MENUTREE_000513'}).hash,safePurchaseStatus.hash);assert.equal(p.prepareImport({...buyStatusBase,rows:safePurchaseStatus.rows}).hash,safePurchaseStatus.hash);
assert.notEqual(safePurchaseStatus.hash,p.prepareImport({...buyStatusBase,periodFrom:'2025-01-01',periodTo:'2025-01-31'}).hash);
assert.throws(()=>p.prepareImport({...buyStatusBase,menuId:purchaseBase.menuId}),/INVALID_SCOPE/);
assert.throws(()=>p.sanitizeRows('buyStatus',[{qty:'1e3'}]),/INVALID_DECIMAL/);
const settlementCases=[['saleQuery','E040206','amount','MENUTREE_000492'],['poQuery','E040302','orderTotal','MENUTREE_000509'],['receipt','E040217','amount','MENUTREE_001680'],['payment','E040310','amount','MENUTREE_001682']];
const settlementInputs=settlementCases.map(([dataset,program,key,canonical])=>{const input={...purchaseBase,dataset,menuId:canonical,rows:[{refDate:'2026/01/03 -1',[key]:'12345678901234567890.12345678',custName:'PRIVATE_NAME',memo:'PRIVATE_MEMO',dueDate:'PRIVATE_DUE',status:'PRIVATE_STATUS'}]};const clean=p.prepareImport(input);assert.equal(clean.program,program);assert.equal(clean.rows[0][key],'12345678901234567890.12345678');assert.equal(clean.completeness,'unknown');assert(!JSON.stringify(clean).includes('PRIVATE_'));assert.equal(p.prepareImport({...input,rows:clean.rows}).hash,clean.hash);assert.notEqual(p.prepareImport({...input,periodFrom:'2025-01-01',periodTo:'2025-01-31'}).hash,clean.hash);for(const alias of menus.filter(m=>m.program===program))assert.equal(p.prepareImport({...input,menuId:alias.id}).hash,clean.hash);assert.throws(()=>p.prepareImport({...input,menuId:quoteBase.menuId}),/INVALID_SCOPE/);return input;});
const discountBase={...purchaseBase,dataset:'discount',menuId:menus.find(m=>m.program==='E040216').id,rows:[]};assert.equal(p.scopeOf(discountBase).program,'E040216');assert.throws(()=>p.prepareImport(discountBase),/IMPORT_NOT_VERIFIED/);assert.throws(()=>p.prepareImport({...discountBase,rows:[{salesAmount:'1'}]}),/IMPORT_NOT_VERIFIED/);assert.throws(()=>p.sanitizeRows('discount',[{salesAmount:'1',sourceDateLabel:'10/20'}]),/UNVERIFIED_SOURCE_DATE/);assert.throws(()=>p.sanitizeRows('discount',[{salesAmount:'1',refDate:'2026-10-20'}]),/UNVERIFIED_SOURCE_DATE/);
const discountSafe=p.sanitizeRows('discount',[{salesAmount:'12345678901234567890.12345678',accountingAmount:'0',difference:'-0.00000001',custName:'PRIVATE_NAME'}]);assert.equal(discountSafe[0].difference,'-0.00000001');assert(!JSON.stringify(discountSafe).includes('PRIVATE_'));
const buyDiscBase={...discountBase,dataset:'buyDisc',menuId:'MENUTREE_000518'};assert.equal(p.scopeOf(buyDiscBase).program,'E040313');assert.deepEqual(p.scopeOf({...buyDiscBase,menuId:'MENUTREE_000588'}),p.scopeOf(buyDiscBase));assert.notEqual(p.scopeOf(buyDiscBase).program,p.scopeOf(discountBase).program);assert.throws(()=>p.prepareImport(buyDiscBase),/IMPORT_NOT_VERIFIED/);assert.throws(()=>p.prepareImport({...buyDiscBase,rows:[{purchaseAmount:'1'}]}),/IMPORT_NOT_VERIFIED/);assert.throws(()=>p.sanitizeRows('buyDisc',[{purchaseAmount:'1',sourceDateLabel:'10/20'}]),/UNVERIFIED_SOURCE_DATE/);assert.equal(p.sanitizeRows('buyDisc',[{purchaseAmount:'12345678901234567890.12345678'}])[0].purchaseAmount,'12345678901234567890.12345678');
const unfulfilledInputs=[['unsold','MENUTREE_000499','MENUTREE_000578'],['unbought','MENUTREE_000516','MENUTREE_000586']].map(([dataset,menuId,alias])=>{const input={...discountBase,dataset,menuId};assert.deepEqual(p.scopeOf(input),p.scopeOf({...input,menuId:alias}));assert.throws(()=>p.prepareImport(input),/IMPORT_NOT_VERIFIED/);assert.throws(()=>p.prepareImport({...input,rows:[{qty:'1'}]}),/IMPORT_NOT_VERIFIED/);assert.throws(()=>p.sanitizeRows(dataset,[{qty:'1',refDate:'2026-10-20'}]),/UNVERIFIED_SOURCE_DATE/);const clean=p.sanitizeRows(dataset,[{qty:'12345678901234567890.12345678',unfulfilledQty:'0',vat:'0',custName:'PRIVATE_NAME',dueDate:'PRIVATE_DATE'}]);assert.equal(clean[0].qty,'12345678901234567890.12345678');assert(!JSON.stringify(clean).includes('PRIVATE_'));return input;});
const quoteStatBase={...discountBase,dataset:'quoteStat',menuId:'MENUTREE_000495'};assert.equal(p.scopeOf(quoteStatBase).program,'E040208');assert.throws(()=>p.prepareImport(quoteStatBase),/IMPORT_NOT_VERIFIED/);assert.throws(()=>p.sanitizeRows('quoteStat',[{qty:'1',refDate:'2026-10-20'}]),/UNVERIFIED_SOURCE_DATE/);
const orderInputs=[['orderQuery','E040204'],['orderStat','E040209'],['poStat','E040306']].map(([dataset,program])=>{const input={...discountBase,dataset,menuId:menus.find(m=>m.program===program).id};assert.throws(()=>p.prepareImport(input),/IMPORT_NOT_VERIFIED/);for(const alias of menus.filter(m=>m.program===program))assert.deepEqual(p.scopeOf({...input,menuId:alias.id}),p.scopeOf(input));const key=p.FIELDS[dataset][0];assert.throws(()=>p.sanitizeRows(dataset,[{[key]:'1',refDate:'2026-10-20'}]),/UNVERIFIED_SOURCE_DATE/);const clean=p.sanitizeRows(dataset,[{[key]:'12345678901234567890.12345678',custName:'PRIVATE_NAME'}]);assert.equal(clean[0][key],'12345678901234567890.12345678');assert(!JSON.stringify(clean).includes('PRIVATE_'));return input;});
const safePurchase=p.prepareImport(purchaseBase);assert.equal(safePurchase.program,'E040304');assert.equal(safePurchase.completeness,'unknown');assert.equal(safePurchase.rows[0].sourceDateLabel,'2026/01/03 -12');assert.equal(safePurchase.rows[0].amountTotal,'12345678901234567890.12345678');assert(!JSON.stringify(safePurchase).includes('PRIVATE_'));assert.equal(p.prepareImport({...purchaseBase,rows:safePurchase.rows}).hash,safePurchase.hash);
assert.notEqual(safePurchase.hash,p.prepareImport({...purchaseBase,periodFrom:'2025-01-01',periodTo:'2025-01-31'}).hash);
assert.throws(()=>p.prepareImport({...purchaseBase,menuId:quoteBase.menuId}),/INVALID_SCOPE/);
assert.throws(()=>p.sanitizeRows('purchase',[{amountTotal:'1e3'}]),/INVALID_DECIMAL/);
assert.throws(()=>p.sanitizeRows('purchase',[{amountTotal:'1',quoteStatus:'completed',statusEvidence:'row_cell'}]),/INVALID_QUOTE_STATUS/);
const safeQuote=p.prepareImport(quoteBase);assert.equal(safeQuote.rows[0].estimateTotal,'12345678901234567890.12345678');assert.equal(safeQuote.rows[0].sourceDateLabel,'2026/01/03 -12');assert(!JSON.stringify(safeQuote).includes('PRIVATE_'));
assert.equal(safeQuote.hash,'639c3bea7a317fde356c6ed05c108e9ba1cb6e384295bab98b82700b28c9dea8'); // Pre-status persisted checksum fixture.
assert.equal(Object.hasOwn(safeQuote.rows[0],'quoteStatus'),false);
const statusQuote=p.prepareImport({...quoteBase,rows:quoteBase.rows.map(row=>({...row,quoteStatus:'in_progress',statusEvidence:'row_cell'}))});
assert.equal(statusQuote.rows[0].quoteStatus,'in_progress');assert.equal(statusQuote.rows[0].statusEvidence,'row_cell');assert.notEqual(statusQuote.hash,safeQuote.hash);
assert.equal(p.prepareImport({...quoteBase,rows:statusQuote.rows}).hash,statusQuote.hash);
const filterEvidence=p.prepareImport({...quoteBase,rows:quoteBase.rows.map(row=>({...row,quoteStatus:'in_progress',statusEvidence:'query_filter'}))});assert.notEqual(filterEvidence.hash,statusQuote.hash);
const completedQuote=p.prepareImport({...quoteBase,rows:quoteBase.rows.map(row=>({...row,quoteStatus:'completed',statusEvidence:'row_cell'}))});assert.notEqual(completedQuote.hash,statusQuote.hash);assert.equal(completedQuote.rows[0].quoteStatus,'completed');
assert.notEqual(statusQuote.hash,p.prepareImport({...quoteBase,rows:statusQuote.rows,periodFrom:'2025-01-01',periodTo:'2025-01-31'}).hash);
for(const invalid of [{quoteStatus:'in_progress'},{statusEvidence:'row_cell'},{quoteStatus:null,statusEvidence:null},{quoteStatus:'done',statusEvidence:'row_cell'},{quoteStatus:'in_progress',statusEvidence:'PRIVATE_NOTE'},{quoteStatus:'in_progress',statusEvidence:'row_cell',isSubtotal:true}]) assert.throws(()=>p.sanitizeRows('quote',[{estimateTotal:'1',...invalid}]),/INVALID_QUOTE_STATUS/);
assert.throws(()=>p.sanitizeRows('sales',[{qty:'1',quoteStatus:'in_progress',statusEvidence:'row_cell'}]),/INVALID_QUOTE_STATUS/);
assert.notEqual(safeQuote.hash,p.prepareImport({...quoteBase,periodFrom:'2025-01-01',periodTo:'2025-01-31'}).hash);
assert(p.authorized(user));
for(const denied of [null,{...user,authority:2},{...user,accountActive:false},{authority:1}]) assert(!p.authorized(denied));
const data=p.prepareImport(base);
assert.equal(data.rows[0].qty,'1.2500');
assert(!JSON.stringify(data).includes('SENSITIVE'));
assert(!JSON.stringify(data).includes('SECRET'));
assert.equal(data.completeness,'unknown');
assert.notEqual(data.hash,p.prepareImport({...base,periodFrom:'2025-01-01',periodTo:'2025-01-31'}).hash);
assert.equal(p.prepareImport({...base,periodFrom:null,periodTo:null}).periodFrom,null);
assert.throws(()=>p.prepareImport({...base,periodTo:null}),/INVALID_PERIOD/);
assert.throws(()=>p.prepareImport({...base,periodFrom:'2026-02-30'}),/INVALID_DATE/);
assert.throws(()=>p.prepareImport({...base,rows:[{qty:'1e5'}]}),/INVALID_DECIMAL/);
assert.throws(()=>p.prepareImport({...base,rows:[{qty:Infinity}]}),/INVALID_DECIMAL/);
assert.throws(()=>p.prepareImport({...base,rows:[{memo:'only private'}]}),/EMPTY_SAFE_ROW/);
assert.throws(()=>p.scopeOf({...base,dataset:'cash'}),/INVALID_SCOPE/);
assert.throws(()=>p.assertRevision(2,1),/REVISION_CONFLICT/);
assert.throws(()=>p.expectedRevision('0'),/INVALID_REVISION/);
assert.throws(()=>p.reason('personal free text','import'),/INVALID_REASON/);
assert.equal(p.decimal('1,234.5000'),'1234.5000');
assert.equal(p.decimal('999,999,999,999,999,999,999,999.12345678'),'999999999999999999999999.12345678');
assert.throws(()=>p.decimal('9,999,999,999,999,999,999,999,999.12345678'),/INVALID_DECIMAL/);
assert.throws(()=>p.decimal('-9,999,999,999,999,999,999,999,999'),/INVALID_DECIMAL/);
assert.equal(p.decimal('0'),'0');
assert.equal(p.sourceDate('2026/01/03'),'2026-01-03');
assert.equal(p.sourceDate('2026-01-03 00:00:00'),'2026-01-03');
assert.throws(()=>p.sourceDate('01/03/2026'),/INVALID_DATE/);
for(const label of ['2026/01/03 오전  12:00:00','2026/01/03 오후  12:00:00','2026/01/03 오전  1:02:03','2026/01/03 오후  11:59:59','2026/01/03 -1','2026/01/03 -12']) {
  const parsed=p.normalizeSourceDate(label);assert.equal(parsed.refDate,'2026-01-03');assert.equal(parsed.sourceDateLabel,label);
  const rows=p.sanitizeRows('sales',[{qty:'1',refDate:label}]);assert.equal(rows[0].sourceDateLabel,label);assert.deepEqual(p.sanitizeRows('sales',rows),rows);
}
for(const label of ['2026/01/03 오전  0:00:00','2026/01/03 오후  13:00:00','2026/01/03 오전  1:60:00','2026/01/03 오후  1:00:60','2026/02/30 -1','2026/01/03 SENSITIVE_NAME','2026/01/03 -123456789']) assert.throws(()=>p.normalizeSourceDate(label),/INVALID_DATE/);
const month=p.sanitizeRows('sales',[{qty:'1',refDate:'2026/01  계',isSubtotal:true}]);
assert.equal(month[0].refDate,null);assert.equal(month[0].sourceDateLabel,'2026/01  계');assert.deepEqual(p.sanitizeRows('sales',month),month);
assert.throws(()=>p.normalizeSourceDate('2026/13  계',true),/INVALID_DATE/);
assert.throws(()=>p.normalizeSourceDate('2026/01  계',false),/INVALID_SUBTOTAL_DATE/);
assert.throws(()=>p.sanitizeRows('sales',[{qty:'1',refDate:'2026-01-04',sourceDateLabel:'2026/01/03 -1'}]),/SOURCE_DATE_MISMATCH/);
assert.throws(()=>p.date('2026/01/03'),/INVALID_DATE/); // Period inputs stay strict ISO.
for(const alias of menus.filter(m=>m.program===p.PROGRAMS.sales)) assert.equal(p.scopeOf({dataset:'sales',menuId:alias.id}).menuId,p.scopeOf(base).menuId);
assert.throws(()=>p.decimal('12,34'),/INVALID_DECIMAL/);

// Execute the real store against a transactional SQL adapter, without opening a DB connection.
let db={head:null,versions:[],audit:[]},failAudit=false,sourceMismatch=false,uppercaseSql=false,sqlCalls=[];
const type=()=>({});const sql={VarChar:type,NVarChar:type,Char:type,Int:{},DateTime2:{},UniqueIdentifier:{},MAX:1};
const result=recordset=>({recordset});
async function q(text,params={}) {
  sqlCalls.push(text);
  // SQL Server 156 reproduced on production read-only history/metadata: ROWCOUNT is reserved even as an alias.
  if(/\bAS\s+rowCount\b/i.test(text)) throw Object.assign(new Error('SQL_RESERVED_ALIAS'),{number:156});
  const v=Object.fromEntries(Object.entries(params).map(([k,x])=>[k,x.value]));
  if(text.includes('sp_getapplock')) return result([]);
  if(text.includes('FROM ecount_work.Head')) return result(db.head?[{...db.head,versionId:uppercaseSql?db.head.versionId.toUpperCase():db.head.versionId}]:[]);
  if(text.startsWith('SELECT s.Dataset AS dataset')) return result([{dataset:'sales',sourceSnapshotKey:77,rowCount:1,periodFrom:null,periodTo:null}]);
  if(text.startsWith('SELECT TOP 100 VersionId')) return result(db.versions.map(r=>({versionId:r.versionId,rowCount:JSON.parse(r.rows).length,sourceSnapshotKey:r.sourceSnapshotKey,sourceTakenAt:r.sourceTakenAt})));
  if(text.startsWith('SELECT TOP 100 Revision')) return result(db.audit.map(r=>({revision:r.revision,versionId:r.version,previousVersionId:r.previous,action:r.action})));
  if(text.includes('FROM dbo.WebEcountSnapshot')) return result([{SnapshotKey:77,PeriodFrom:null,PeriodTo:null,RowCnt:sourceMismatch?2:1,TakenAt:new Date('2026-01-01T00:00:00Z')}]);
  if(text.includes('FROM dbo.WebEcountRow')) {assert(text.includes('SnapshotKey=@snapshot AND Dataset=@dataset'));assert.equal(v.snapshot,77);assert(!text.includes('SELECT Payload'));return result([{qty:'2',supplyAmt:'10',vat:'1',total:'11',isSubtotal:false},{qty:'2',supplyAmt:'10',vat:'1',total:'11',isSubtotal:true}]);}
  if(text.includes('FROM ecount_work.Version')) return result(db.versions.filter(r=>v.version?r.versionId===v.version:r.hash===v.hash).map(r=>({...r,versionId:uppercaseSql?r.versionId.toUpperCase():r.versionId,VersionId:r.versionId})));
  if(text.startsWith('INSERT INTO ecount_work.Version')) {db.versions.push({versionId:v.version,hash:v.hash,rows:v.rows,sourceSnapshotKey:v.snapshot,sourceTakenAt:v.sourceTakenAt});return result([]);}
  if(text.startsWith('INSERT INTO ecount_work.Head')||text.startsWith('UPDATE ecount_work.Head')) {db.head={versionId:v.version,revision:v.revision};return result([]);}
  if(text.startsWith('INSERT INTO ecount_work.Audit')) {if(failAudit) throw Error('synthetic transaction error');db.audit.push({...v});return result([]);}
  throw Error('Unsupported test query');
}
let queue=Promise.resolve();
async function withTransaction(fn) {
  const work=queue.then(async()=>{const before=structuredClone(db);try{return await fn(q);}catch(e){db=before;throw e;}});
  queue=work.catch(()=>{});return work;
}
const storeSource=fs.readFileSync(path.join(__dirname,'../lib/ecountWorkspaceStore.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/export async function /g,'async function ');
const context={crypto,query:q,withTransaction,sql,policy:p,effectiveAuthority:u=>u.Authority};
vm.createContext(context);vm.runInContext(storeSource+'\nthis.saveVersion=saveVersion;this.readWorkspace=readWorkspace;',context);
(async()=>{
  const first=await context.saveVersion(base,user);assert.equal(first.revision,1);assert.equal(db.versions.length,1);assert.equal(db.audit.length,1);
  const history=await context.readWorkspace({...base,view:'history'});assert.equal(history.revision,1);assert.equal(history.versions.length,1);assert.equal(history.versions[0].rowCount,1);assert.equal(history.events.length,1);
  const metadata=await context.readWorkspace({...base,view:'metadata'});assert.equal(metadata.sources[0].rowCount,1);assert.equal(metadata.sources[0].completeness,'unknown');assert.equal(metadata.sources[0].periodFrom,null);
  await assert.rejects(context.saveVersion(base,user),/REVISION_CONFLICT/); // Lost response: require reload, do not silently replay.
  assert(!JSON.stringify(db).includes('SENSITIVE'));assert(!JSON.stringify(db).includes(user.userId));
  uppercaseSql=true;
  const duplicate=await context.saveVersion({...base,expectedRevision:1},user);assert.equal(duplicate.idempotent,true);assert.equal(duplicate.versionId,first.versionId);assert.equal(db.versions.length,1);assert.equal(db.audit.length,1);
  uppercaseSql=false;
  const changes={...base,expectedRevision:1,rows:[{qty:'3'}]};
  const racers=await Promise.allSettled([context.saveVersion(changes,user),context.saveVersion(changes,user)]);
  assert.equal(racers.filter(r=>r.status==='fulfilled').length,1);assert.equal(racers.find(r=>r.status==='rejected').reason.message,'REVISION_CONFLICT');
  assert.equal(db.head.revision,2);assert.equal(db.versions.length,2);
  const rollback=await context.saveVersion({...base,action:'activate',versionId:first.versionId,reasonCode:'ROLLBACK',expectedRevision:2},user);
  assert.equal(rollback.revision,3);assert.equal(db.head.versionId,first.versionId);assert.equal(db.versions.length,2);assert.equal(db.audit.length,3);
  const before=JSON.stringify(db);failAudit=true;
  await assert.rejects(context.saveVersion({...base,expectedRevision:3,rows:[{qty:'5'}]},user));assert.equal(JSON.stringify(db),before);failAudit=false;
  sourceMismatch=true;
  await assert.rejects(context.saveVersion({...base,action:'import-latest',expectedRevision:3},user),/SOURCE_ROW_COUNT_MISMATCH/);assert.equal(JSON.stringify(db),before);
  sourceMismatch=false;
  const latest=await context.saveVersion({...base,action:'import-latest',expectedRevision:3},user);assert.equal(latest.revision,4);
  assert.equal(JSON.parse(db.versions.at(-1).rows).length,2); // Legacy RowCnt=1 detail + retained subtotal.
  assert.equal(db.versions.at(-1).sourceSnapshotKey,77);assert.equal(db.versions.at(-1).sourceTakenAt.toISOString(),'2026-01-01T00:00:00.000Z');
  assert(sqlCalls.some(s=>s.includes('JSON_VALUE(Payload')));
  assert(!sqlCalls.some(s=>/\b(INSERT INTO|UPDATE|DELETE FROM)\s+(?:dbo\.)?(Order|Shipment|Stock|Estimate|WebEcountSnapshot|WebEcountRow)/i.test(s)));
  const api=fs.readFileSync(path.join(__dirname,'../pages/api/ecount/workspace.js'),'utf8');
  assert(api.includes('verifyReqUser(req)'));assert(!api.includes('withAuth('));assert(!api.includes('console.'));
  let verified=null,storeCalls=0,active=true;
  const apiContext={URL,policy:p,verifyReqUser:()=>verified,activeAdmin:async()=>active,installed:async()=>true,readWorkspace:async()=>{storeCalls++;return {success:true};},saveVersion:async()=>{storeCalls++;return {success:true};}};
  vm.createContext(apiContext);
  vm.runInContext(api.replace(/^import .*;\r?\n/gm,'').replace('export default async function handler','async function handler').replace('export const config','const config')+'\nthis.handler=handler;',apiContext);
  const response=()=>({code:0,body:null,setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
  const req={method:'GET',headers:{host:'localhost'},query:{dataset:'sales',menuId}};
  let res=response();await apiContext.handler(req,res);assert.equal(res.code,401);assert.equal(storeCalls,0);
  verified={...user,authority:2};res=response();await apiContext.handler(req,res);assert.equal(res.code,403);assert.equal(storeCalls,0);
  verified=user;active=false;res=response();await apiContext.handler(req,res);assert.equal(res.code,403);assert.equal(storeCalls,0);
  active=true;res=response();await apiContext.handler({...req,method:'POST',headers:{host:'localhost',origin:'https://untrusted.invalid'}},res);assert.equal(res.code,403);assert.equal(storeCalls,0);
  res=response();await apiContext.handler(req,res);assert.equal(res.code,200);assert.equal(storeCalls,1);
  const statusQueriesBefore=sqlCalls.length;
  await assert.rejects(context.saveVersion({...buyStatusBase,action:'import-latest'},user),/SOURCE_IMPORT_UNSUPPORTED/);assert.equal(sqlCalls.length,statusQueriesBefore);
  db={head:null,versions:[],audit:[]};const statusFirst=await context.saveVersion(buyStatusBase,user);
  assert.equal((await context.saveVersion({...buyStatusBase,expectedRevision:1},user)).idempotent,true);
  await context.saveVersion({...buyStatusBase,expectedRevision:1,rows:[{qty:'2'}],reasonCode:'CORRECTION'},user);
  await context.saveVersion({...buyStatusBase,expectedRevision:2,action:'activate',versionId:statusFirst.versionId,reasonCode:'ROLLBACK'},user);
  assert.equal(db.head.versionId,statusFirst.versionId);assert.equal(db.audit.length,3);assert.equal(db.versions.length,2);
  for(const input of settlementInputs){const count=sqlCalls.length;await assert.rejects(context.saveVersion({...input,action:'import-latest'},user),/SOURCE_IMPORT_UNSUPPORTED/);assert.equal(sqlCalls.length,count);db={head:null,versions:[],audit:[]};const first=await context.saveVersion(input,user);assert.equal((await context.saveVersion({...input,expectedRevision:1},user)).idempotent,true);const key=p.FIELDS[input.dataset][0];await context.saveVersion({...input,expectedRevision:1,reasonCode:'CORRECTION',rows:[{[key]:'2'}]},user);await context.saveVersion({...input,action:'activate',expectedRevision:2,versionId:first.versionId,reasonCode:'ROLLBACK'},user);assert.equal(db.head.versionId,first.versionId);assert.equal(db.audit.length,3);assert.equal(db.versions.length,2);}
  for(const action of ['import','import-latest','activate']){const count=sqlCalls.length;await assert.rejects(context.saveVersion({...buyDiscBase,action},user),/IMPORT_NOT_VERIFIED/);assert.equal(sqlCalls.length,count);await assert.rejects(context.saveVersion({...discountBase,action},user),/IMPORT_NOT_VERIFIED/);assert.equal(sqlCalls.length,count);}
  for(const input of unfulfilledInputs)for(const action of ['import','import-latest','activate']){const count=sqlCalls.length;await assert.rejects(context.saveVersion({...input,action},user),/IMPORT_NOT_VERIFIED/);assert.equal(sqlCalls.length,count);}
  for(const action of ['import','import-latest','activate']){const count=sqlCalls.length;await assert.rejects(context.saveVersion({...quoteStatBase,action},user),/IMPORT_NOT_VERIFIED/);assert.equal(sqlCalls.length,count);}
  for(const input of orderInputs)for(const action of ['import','import-latest','activate']){const count=sqlCalls.length;await assert.rejects(context.saveVersion({...input,action},user),/IMPORT_NOT_VERIFIED/);assert.equal(sqlCalls.length,count);}
  const purchaseQueriesBefore=sqlCalls.length;
  await assert.rejects(context.saveVersion({...purchaseBase,action:'import-latest'},user),/SOURCE_IMPORT_UNSUPPORTED/);assert.equal(sqlCalls.length,purchaseQueriesBefore);
  db={head:null,versions:[],audit:[]};
  const purchaseFirst=await context.saveVersion(purchaseBase,user);assert.equal(purchaseFirst.revision,1);
  const purchaseDuplicate=await context.saveVersion({...purchaseBase,expectedRevision:1},user);assert.equal(purchaseDuplicate.idempotent,true);assert.equal(db.audit.length,1);
  await context.saveVersion({...purchaseBase,expectedRevision:1,reasonCode:'CORRECTION',rows:[{amountTotal:'2'}]},user);
  await context.saveVersion({...purchaseBase,action:'activate',expectedRevision:2,versionId:purchaseFirst.versionId,reasonCode:'ROLLBACK'},user);
  assert.equal(db.head.versionId,purchaseFirst.versionId);assert.equal(db.versions.length,2);assert.equal(db.audit.length,3);assert.equal(JSON.parse(db.versions[0].rows)[0].exchangeRate,'1300.00000000');
  const queriesBefore=sqlCalls.length;
  await assert.rejects(context.saveVersion({...quoteBase,action:'import-latest'},user),/SOURCE_IMPORT_UNSUPPORTED/);assert.equal(sqlCalls.length,queriesBefore);
  db={head:null,versions:[],audit:[]};
  const quoteFirst=await context.saveVersion(quoteBase,user);assert.equal(quoteFirst.revision,1);
  const quoteNext=await context.saveVersion({...quoteBase,expectedRevision:1,reasonCode:'CORRECTION',rows:[{estimateTotal:'2',refDate:'2026-01-03',quoteStatus:'in_progress',statusEvidence:'row_cell'}]},user);assert.equal(quoteNext.revision,2);
  assert.equal(JSON.parse(db.versions[1].rows)[0].statusEvidence,'row_cell');
  const quoteRestored=await context.saveVersion({...quoteBase,action:'activate',expectedRevision:2,versionId:quoteFirst.versionId,reasonCode:'ROLLBACK'},user);assert.equal(quoteRestored.revision,3);assert.equal(db.head.versionId,quoteFirst.versionId);assert.equal(db.audit.length,3);
  assert.equal(JSON.parse(db.versions[0].rows)[0].estimateTotal,'12345678901234567890.12345678');
  assert.equal(Object.hasOwn(JSON.parse(db.versions[0].rows)[0],'quoteStatus'),false);
  assert(!/\bCREATE\s+(TABLE|SCHEMA)/i.test(storeSource));
  const ddl=fs.readFileSync(path.join(__dirname,'../docs/migrations/20261020_ecount_workspace.sql'),'utf8');assert(ddl.includes('INSTEAD OF UPDATE, DELETE'));assert(ddl.includes('FOREIGN KEY(RootKey,MenuId,Program,Dataset,VersionId)'));
  console.log('PASS ECOUNT workspace: privacy projection, authorization, exact decimals, year/period separation, idempotency, race, rollback, atomic audit, snapshot consistency. SQL execution not performed.');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
