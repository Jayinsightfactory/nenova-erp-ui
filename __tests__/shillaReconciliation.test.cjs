const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {test}=require('node:test');
const modulePromise=import('../lib/shillaReconciliation.js');
const scope={year:'2026',from:'2026-06-01',to:'2026-06-30',periods:['23']};
const item={year:'2026',period:'23',name:'수국',unit:'EA',qty:2,price:100,amount:200,source:'23차 3행'};
const receipt={date:'2026-06-04',site:'서울',receiptNo:'100',receiptItem:'1',code:'A',name:'수국',spec:'',unit:'EA',qty:2,price:100,amount:200};
const input=()=>({scope:structuredClone(scope),db:[{...item}],excel:[{...item}],receipts:[{...receipt}]});
test('exact identity and explicit zero; missing remains unavailable',async()=>{
 const {reconcileShilla}=await modulePromise;
 assert.equal(reconcileShilla(input()).complete,true);
 const zero=input();zero.db[0].price=zero.excel[0].price=zero.receipts[0].price=0;zero.db[0].amount=zero.excel[0].amount=zero.receipts[0].amount=0;
 assert.equal(reconcileShilla(zero).complete,true);
 zero.db[0].price=null;assert.equal(reconcileShilla(zero).complete,false);
 assert.equal(reconcileShilla({...input(),db:[]}).rows[0].dbExcel.status,'자료 없음');
});
test('cross year, subperiod and offsetting errors remain separate',async()=>{
 const {reconcileShilla}=await modulePromise;const x=input();x.db.push({...item,year:'2025',qty:99},{...item,period:'23-2',qty:99});
 assert.equal(reconcileShilla(x).counts.db,1);
 x.scope.periods.push('24');x.db=[{...item,qty:1,amount:100},{...item,period:'24',qty:3,amount:300}];x.excel.push({...item,period:'24'});x.receipts[0].qty=4;x.receipts[0].amount=400;
 const r=reconcileShilla(x);assert.equal(r.rows[0].status,'일치');assert.equal(r.periodDifferences.length,2);assert.equal(r.complete,false);
});
test('parser zero-padded period keys and purchase-price changes',async()=>{
 const {reconcileShilla}=await modulePromise;const x=input();x.scope.periods=['01'];x.db[0].period='1';x.excel[0].period='01';
 assert.equal(reconcileShilla(x).complete,true);
 x.db[0].costPrice=50;x.excel[0].costPrice=60;
 assert.equal(reconcileShilla(x).rows[0].dbExcel.costPrice,true);
 x.scope.periods=['1','01'];assert.throws(()=>reconcileShilla(x),/차수/);
});
test('equal totals cannot hide price-bucket quantity redistribution or spec ambiguity',async()=>{
 const {reconcileShilla}=await modulePromise;const x=input();x.db=[1,2,3].map(price=>({...item,price,qty:2,amount:2*price}));
 x.excel=[1,2,3].map((price,i)=>({...item,price,qty:[3,0,3][i],amount:[3,0,3][i]*price}));
 assert.equal(reconcileShilla(x).rows[0].dbExcel.bucketDifference,true);
 const spec=input();spec.receipts[0].spec='화이트';assert.equal(reconcileShilla(spec).unmatched.length,1);
});
test('unit mapping requires explicit positive factor and confirmation; supply preserved',async()=>{
 const {reconcileShilla,receiptIdentity,itemIdentity}=await modulePromise;const x=input();x.receipts[0]={...receipt,unit:'PK',qty:1,price:200};
 assert.equal(reconcileShilla(x).unmatched.length,1);
 x.mappings={[receiptIdentity(x.receipts[0])]:{target:itemIdentity(item),factor:2}};
 assert.equal(reconcileShilla(x).unmatched.length,1);
 x.mappings[receiptIdentity(x.receipts[0])].unitConfirmed=true;
 assert.equal(reconcileShilla(x).complete,true);
 const mapped=reconcileShilla(x).rows[0].srm.rows[0];assert.equal(mapped.originalQty,1);assert.equal(mapped.qty,2);assert.equal(mapped.originalUnit,'PK');assert.equal(mapped.unit,'EA');
 x.mappings[receiptIdentity(x.receipts[0])].factor=0;assert.throws(()=>reconcileShilla(x),/배수/);
});
test('price changes, duplicate receipts, invalid dates, missing values and gross conversion',async()=>{
 const {reconcileShilla}=await modulePromise;
 const price=input();price.db[0].price=90;assert.equal(reconcileShilla(price).rows[0].dbExcel.price,true);
 const dup=input();dup.receipts.push({...receipt});assert.match(reconcileShilla(dup).issues[0],/중복/);
 const outside=input();outside.receipts[0].date='2025-06-04';assert.throws(()=>reconcileShilla(outside),/기간/);
 const invalid=input();invalid.scope.from='2026-02-30';assert.throws(()=>reconcileShilla(invalid),/기간/);
 const missing=input();missing.receipts[0].qty='';assert.throws(()=>reconcileShilla(missing),/누락/);
 const gross=input();gross.db[0].price=gross.excel[0].price=110;gross.db[0].amount=gross.excel[0].amount=220;gross.excelGross=true;assert.equal(reconcileShilla(gross).complete,true);
});
test('no fuzzy matching hides unknown material, no inferred packaging',async()=>{
 const {reconcileShilla}=await modulePromise;const x=input();x.receipts[0].name='[수입] 수국';assert.equal(reconcileShilla(x).unmatched.length,1);
 const spec=input();spec.receipts[0].name='수국 화이트';assert.equal(reconcileShilla(spec).complete,false);
});
test('live collector adapter serializes month slices, projects allowed fields and fails closed',async()=>{
 const code=fs.readFileSync('public/shilla-connector/collector.js','utf8').replace('export async function','async function');
 let fail=false;const calls=[],listeners={};
 const ajax={getAttribute:()=>'/ui/sp/pro/gr/findGrSpListEai.do',addEventListener:(k,f)=>listeners[k]=f,removeEventListener:k=>delete listeners[k]};
 const values={};const page={querySelector:()=>ajax,set:(k,v)=>values[k]=v,onFindList:()=>{
   const start=values['searchParam.fdate'];calls.push([start.getMonth()+1,values['searchParam.tdate'].getDate()]);
   queueMicrotask(()=>listeners.response({detail:{response:{HEADER:{result_code:fail?'9999':'0000'},lt_srmif6_re:[{budat:`2026${String(start.getMonth()+1).padStart(2,'0')}01`,werks_na:'서울',belnr:'1',buzei:'1',matnr:'A',maktx:'수국',groes:'화이트',meins:'EA',menge:2,netpr:100,wrbtr:200,privateField:'must never leave browser'}]}}}));
 }};
 const context={location:{origin:'https://www.shillasrm.com',pathname:'/afterLoginOK.do',href:'https://www.shillasrm.com/afterLoginOK.do'},document:{querySelector:()=>page},URL,Date,setTimeout,clearTimeout};
 vm.createContext(context);vm.runInContext(code,context);
 const result=await context.collectReceipts('2026-01-01','2026-03-31');assert.equal(result.success,true);assert.deepEqual(calls,[[1,31],[2,28],[3,31]]);assert.equal(result.rows.length,3);assert.equal('privateField' in result.rows[0],false);assert.equal(result.source.complete,true);
 fail=true;const error=await context.collectReceipts('2026-01-01','2026-01-31');assert.equal(error.success,false);assert.equal('rows' in error,false);
});
test('SQL SELECT-only exact year and hotel; extension origins restricted',()=>{
 const sql=fs.readFileSync('lib/shillaReconciliationServer.js','utf8');assert.match(sql,/m.OrderYear=@year/);assert.match(sql,/m.PartnerCode=N'shilla'/);assert.doesNotMatch(sql,/\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|EXEC)\b/);
 const manifest=JSON.parse(fs.readFileSync('public/shilla-connector/manifest.json'));assert.deepEqual(manifest.permissions,['scripting']);assert.deepEqual(manifest.host_permissions,['https://www.shillasrm.com/*']);
 const background=fs.readFileSync('public/shilla-connector/background.js','utf8');assert.match(background,/sender.frameId!==0/);assert.match(background,/candidates.length!==1/);
});
test('multipart API parses workbook, reloads DB, compares and rejects wrong source scope',async()=>{
 const http=require('node:http'),XLSX=require('xlsx'),babel=require('next/dist/compiled/babel/core');
 const parser=await import('../lib/shillaPnlParse.js'),policy=await import('../lib/shillaPnlImportPolicy.js'),helpers=await modulePromise;
 const source=fs.readFileSync('pages/api/raum/shilla-analysis.js','utf8');
 const transformed=babel.transformSync(source,{plugins:[require('next/dist/compiled/babel/plugin-transform-modules-commonjs')],configFile:false,babelrc:false}).code;
 let reads=0;
 const m={exports:{}};
 new Function('require','module','exports',transformed)(name=>{
   if(name.endsWith('/auth'))return{withAuth:fn=>fn};
   if(name.endsWith('/shillaPnlParse'))return parser;
   if(name.endsWith('/shillaPnlImportPolicy'))return policy;
   if(name.endsWith('/shillaReconciliation'))return helpers;
   if(name.endsWith('/shillaReconciliationServer'))return{loadShillaAnalysisRows:async year=>{reads++;assert.equal(year,'2026');return[{...item,period:'01',costPrice:50}];}};
   return require(name);
 },m,m.exports);
 const server=http.createServer((req,res)=>{res.status=n=>{res.statusCode=n;return res;};res.json=obj=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(obj));};m.exports.default(req,res);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([
   ['신라호텔 1차(06.04)'],['품명','칼라','입고수량','매입단가','매입액','매출단가','매출액','이익','이익율','네노바이익 (60%)','미우이익 (40%)'],
   ['수국','',2,50,100,100,200,100,.5,60,40],['합계','',2,'',100,'',200,100,'',60,40]
  ]),'1차');
  const bytes=XLSX.write(wb,{type:'buffer',bookType:'xlsx'});
  const call=async(mode,payload)=>{const body=new FormData();body.append('file',new Blob([bytes]),'fixture.xlsx');body.append('year','2026');body.append('mode',mode);if(payload)body.append('payload',JSON.stringify(payload));const res=await fetch(`http://127.0.0.1:${server.address().port}/`,{method:'POST',body});return{status:res.status,data:await res.json()};};
  const prepared=await call('prepare');assert.equal(prepared.status,200);assert.equal(prepared.data.periods[0].period,'01');assert.equal(prepared.data.dbCount,1);
  const payload={from:scope.from,to:scope.to,periods:['01'],receipts:[receipt],mappings:{},excelGross:false,source:{from:scope.from,to:scope.to,complete:true,origin:'https://www.shillasrm.com',readAt:new Date().toISOString()}};
  const compared=await call('compare',payload);assert.equal(compared.status,200);assert.equal(compared.data.counts.excel,1);assert.equal(compared.data.totals.db,200);assert.equal(reads,2);
  payload.source.from='2026-05-01';const rejected=await call('compare',payload);assert.equal(rejected.status,400);assert.match(rejected.data.error,/입고 조회자료/);
 } finally {await new Promise(resolve=>server.close(resolve));}
});
