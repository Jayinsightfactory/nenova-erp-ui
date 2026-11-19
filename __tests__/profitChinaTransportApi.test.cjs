const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {transformSync}=require('next/dist/build/swc');
function compile(file,mocks={}){const filename=path.resolve(file),m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));const real=m.require.bind(m);m.require=id=>Object.hasOwn(mocks,id)?mocks[id]:real(id);m._compile(transformSync(fs.readFileSync(filename,'utf8'),{filename,jsc:{parser:{syntax:'ecmascript',jsx:true},target:'es2022'},module:{type:'commonjs'}}).code,filename);return m.exports;}
async function main(){
 const policy=await import('../lib/profitChinaTransport.mjs');let calls=0,release;
 const api=compile('pages/api/sales/profit-china-transport.js',{'../../../lib/auth':{withAuth:x=>x},'../../../lib/profitChinaTransport.mjs':policy,'../../../lib/profitChinaTransportData':{loadChinaTransportEvidence:()=>{}}});
 const handler=api.createChinaTransportHandler({load:scope=>{calls++;return new Promise(resolve=>release=()=>resolve({...scope,incoming:[]}));},id:()=> 'synthetic-job'});
 const call=async(query={},method='GET',owner='tester')=>{const res={setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};await handler({method,query,user:{userId:owner}},res);return res;};
 assert.equal((await call({year:'2026',week:'44'},'POST')).code,405);assert.equal((await call({week:'44'})).code,400);assert.equal(calls,0);
 const first=await call({year:'2026',week:'44'});assert.equal(first.code,202);await Promise.resolve();assert.equal(calls,1);
 assert.equal((await call({year:'2026',week:'44'})).code,202);assert.equal(calls,1,'dedup running job');
 assert.equal((await call({year:'2025',week:'44',jobId:first.body.jobId})).code,404);
 assert.equal((await call({year:'2026',week:'44',jobId:first.body.jobId},'GET','other')).code,404);
 release();await new Promise(resolve=>setImmediate(resolve));assert.equal((await call({year:'2026',week:'44',jobId:first.body.jobId})).code,200);
 const helper=compile('lib/profitChinaTransportData.js',{'./db.js':{query(){throw Error('unexpected SQL');},sql:{NVarChar:'nvarchar'}},'./profitReport.js':{CASE_CATEGORY:"N'중국'",refreshProfitCategorySql(){},stockablePurchaseItemSql:()=> '1=1',nonValueWeightSql:()=> '1=1',stockSnapshotByCategory:()=>{}},'./profitWorkbookRules.js':{freightSalesProductSql:()=> '(1=0)'},'./customsForwarding.js':{buildForwardingLedger:()=>({classifiedRows:[{category:'중국',orderYear:'2026',orderWeek:'44-01',farmName:'HUBFRESH',amount:0}]})}});
 let stockCalls=[];
 const evidence=await helper.loadChinaTransportEvidence({orderYear:'2026',major:'44'},{query:async(statement,params)=>{
   assert.equal(params.year.value,'2026');assert.equal(params.prefix.value,'44-%');assert.doesNotMatch(statement,/\b(?:INSERT|UPDATE|DELETE|MERGE|EXEC|CREATE|ALTER|DROP)\b/i);
   return {recordset:statement.includes('FROM WarehouseMaster')?[{Category:'중국',Stockable:1,OrderYear:'2026',OrderWeek:'44-01',FarmName:'HUBFRESH',ProdKey:1,OutUnit:'단',OutQuantity:5,TPrice:50}]:[{OrderYear:'2026',OrderWeek:'44-01',SdetailKey:1,ProdKey:1,OutQuantity:5,Amount:100,SfarmKey:1,FarmName:'HUBFRESH',ShipmentQuantity:2},{OrderYear:'2026',OrderWeek:'44-01',SdetailKey:1,ProdKey:1,OutQuantity:5,Amount:100,SfarmKey:2,FarmName:'Cloudland',ShipmentQuantity:3}]};},stockSnapshot:async(major,year,options)=>{stockCalls.push({major,year,options});return {snapshotAvailable:true,week:`${major}-01`,items:[]};}});
 assert.equal(evidence.shipments.length,1,'farm join must not multiply sales');assert.equal(evidence.shipments[0].assignments.length,2);assert.equal(evidence.shipments[0].amount,100);
 assert(evidence.warnings.some(x=>x.includes('0원 전표')));assert.deepEqual(stockCalls.map(x=>x.major),['43','44']);
 const januaryCalls=[];
 await helper.loadChinaTransportEvidence({orderYear:'2027',major:'01'},{query:async(statement,params)=>{
   if(statement.includes('FROM PeriodDay')){assert.equal(params.previousYear.value,'2026');assert.match(statement,/BETWEEN 1 AND 53/);return {recordset:[{OrderYear:'2026',Major:'53'}]};}
   assert.equal(params.year.value,'2027');assert.equal(params.prefix.value,'01-%');return {recordset:[]};
 },stockSnapshot:async(major,year)=>{januaryCalls.push([year,major]);return {snapshotAvailable:true,items:[]};}});
 assert.deepEqual(januaryCalls,[['2026','53'],['2027','01']],'January must use previous calendar year final major, including 53');
 const missingCalendar=await helper.loadChinaTransportEvidence({orderYear:'2027',major:'01'},{query:async()=>({recordset:[]}),stockSnapshot:async()=>({snapshotAvailable:true,items:[]})});
 assert(missingCalendar.warnings.includes('기초 재고 차수 확인 필요'),'missing calendar must not invent week 52');
 const source=fs.readFileSync('pages/api/sales/profit-china-transport.js','utf8')+fs.readFileSync('lib/profitChinaTransportData.js','utf8');
 assert.doesNotMatch(source,/saveProfit|loadWeeklyReportPayload|refreshSnapshot|execute\(|\.transaction\(/);
 const core=fs.readFileSync('lib/profitReport.js','utf8');assert.match(core,/options\.captureChinaItems === true && row\.Category === '중국'/);
 console.log('profitChinaTransportApi PASS: GET-only, scoped owner jobs, year separation, SELECT-only, farm joins, freight0, snapshot preservation');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
