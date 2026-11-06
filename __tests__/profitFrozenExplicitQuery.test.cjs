const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('calendar current+previous only; 53/year boundary and false/zero cannot widen recent window',async()=>{
 const {profitFinancialReadPolicy:f}=await import('../lib/profitReportReadPolicy.js');
 const current={orderYear:'2026',major:'44'},previous={orderYear:'2026',major:'43'};
 for(const week of ['39','42'])assert.equal(f('2026',week,current,previous).frozen,true);
 for(const week of ['43','44'])assert.equal(f('2026',week,current,previous).basis,'live');
 assert.equal(f('2025','44',current,previous).basis,'stored');
 for(const flag of [undefined,false,0])assert.equal(f('2026','42',current,previous,{liveAudit:flag}).frozen,true);
 assert.equal(f('2026','42',current,previous,{liveAudit:true}).basis,'live');
 assert.equal(f('2026','44',current,previous,{confirmed:true}).frozen,true);
 assert.equal(f('2025','53',{orderYear:'2026',major:'01'},{orderYear:'2025',major:'53'}).basis,'live');
 assert.equal(f('2025','52',{orderYear:'2026',major:'01'},{orderYear:'2025',major:'53'}).basis,'stored');
 assert.throws(()=>f('2026','42',current,null),/달력/);
 const calendar=await import('../lib/profitReportWeeklySchedule.js');
 const days=[{dateOnly:'2025-12-31',orderYearWeek:'202553'},...Array.from({length:6},(_,i)=>({dateOnly:`2026-01-0${i+1}`,orderYearWeek:'202601'}))];
 const january=calendar.resolveCurrentProfitWeek(days,'2026-01-01');assert.equal(calendar.resolvePreviousProfitWeek(days,january).major,'53');
 const {resolveCarriedRatesForCategories}=await import('../lib/profitReportTaxableRateCarry.js');let seen;
 const carried=await resolveCarriedRatesForCategories({orderYear:'2026',major:'01',categories:[{key:'호주',currency:'AUD'}],previousPeriod:async()=>({orderYear:'2025',major:'53'}),fetchWeekContext:async(y,m)=>{seen=[y,m];return {manual:{호주:{R:1000}}};}});
 assert.deepEqual(seen,['2025','53']);assert.equal(carried.호주.sourceMajor,'53');
});
test('production loader freezes every monetary cell; latest inputs are current+prior SQL not saved main fields',async()=>{
 const {profitFinancialReadPolicy}=await import('../lib/profitReportReadPolicy.js');
 const C=await import('../lib/profitReportStoredCalculation.js');
 const source=fs.readFileSync('pages/api/sales/profit-report.js','utf8');
 const body=source.slice(source.indexOf('export async function currentProfitPeriod'),source.indexOf('export async function loadAnnualMonthlyReportData')).replaceAll('export ','');
 const raw=(major,N)=>({major,orderYear:'2026',rows:[{category:'중국',variant:'normal',auto:{N,L:0,O:0,Q:2,S:0,E:0,F:0,H:0,R:10},manual:{H:0,R:10,AC:0,AJ:0},stock:{evidenceValue:0},beginStock:{evidenceValue:0}}]});
 const saved=C.materializeProfitPayload(raw('42',777)),before=JSON.stringify(saved);let calls=[],overlays=0,confirmed=false,fail=false,sourceVersion=0,invoiceVersion=0,changeInvoice=false;
 const deps={profitFinancialReadPolicy,materializeProfitPayload:C.materializeProfitPayload,manualInputManifest:{},
  getActiveConfirm:async()=>confirmed?{initialized:true,confirm:{}}:null,buildConfirmedPayload:async()=>({confirmed:{},rows:saved.rows,confirmedTotals:saved.totals}),
  readStoredProfitPayload:async()=>structuredClone(saved),storedProfitPayload:r=>{if(!r)throw Object.assign(Error('missing'),{code:'SNAPSHOT_NOT_READY'});return r.payload;},
  loadReportData:async(m)=>{calls.push(m);if(fail)throw Error('source failed');if(changeInvoice)invoiceVersion++;return raw(m,m==='44'?44964933:43892819);},
  loadSourceFingerprints:async()=>({map:new Map([['source',sourceVersion]])}),currentErpReadContext:()=>true,
  latestProfitInvoiceFence:async()=> String(invoiceVersion),
  applyTemplateDutyToReport:async(p,y,m,options)=>{overlays++;assert.equal(options.strict,true);assert.equal(options.latestReports.get('44').payload.rows[0].calc.N,44964933);assert.equal(options.previousPayload.rows[0].calc.N,43892819);return p;},
  saveProfitCache:()=>assert.fail('no writes'),loadProfitReportCalendar:async()=>[],resolveCurrentProfitWeek:()=>({orderYear:'2026',major:'44'}),resolvePreviousProfitWeek:()=>({orderYear:'2026',major:'43'}),
 };
 const L=new Function(...Object.keys(deps),`${body};return loadWeeklyReportPayload;`)(...Object.values(deps));
 const result=await L('42','2026');assert.equal(result.readMode,'stored');assert.deepEqual(result.rows,saved.rows);assert.deepEqual(result.totals,saved.totals);assert.equal(overlays,0);assert.deepEqual(calls,[]);assert.equal(JSON.stringify(saved),before);
 const latest=await L('44','2026');assert.deepEqual(calls,['44','43']);assert.equal(latest.rows[0].calc.N,44964933);assert.equal(latest.rows[0].calc.H,0);assert.equal(overlays,1);
 fail=true;await assert.rejects(L('44','2026'),/source failed/);fail=false;
 changeInvoice=true;await assert.rejects(L('44','2026'),e=>e.code==='PROFIT_SOURCES_CHANGED');changeInvoice=false;
 confirmed=true;const fixed=await L('44','2026');assert.equal(fixed.readMode,'confirmed');assert.deepEqual(fixed.confirmedTotals,saved.totals);assert.equal(overlays,2);
 assert.equal(C.profitDisplayCalculation(result).rows[0].calc.K,result.rows[0].calc.J/result.rows[0].calc.C);
});
test('invoice financial fence includes revision/document/operation/line identity and amounts; missing partial or malformed evidence holds',async()=>{
 const {latestProfitInvoiceFence:f,PROFIT_LATEST_INVOICE_FENCE_SQL:text}=await import('../lib/profitLatestInvoiceFence.js');
 const digest='a'.repeat(64),types={MAX:-1,NVarChar:()=> 'nvarchar'};let calls=[];
 const queryFn=async(statement,params)=>{calls.push({statement,params});return {recordset:[statement.includes('sys.tables')?{tableCount:4}:{digest}]};};
 assert.equal(await f(['2026','2025','2026'],{queryFn,types}),digest);assert.equal(calls.length,2);assert.equal(calls[1].params.years.value,'["2025","2026"]');
 for(const key of ['WebInvoiceCostRevision','WebInvoiceDocument','WebInvoiceOperation','WebInvoiceCostLine','ComponentAmountsJson','InputSnapshotJson','CostPerUnit','TotalCost','DocumentRevision'])assert(text.includes(key));
 assert.equal(await f(['2026'],{queryFn:async()=>({recordset:[{tableCount:0}]}),types}),'invoice-schema-absent');
 await assert.rejects(f(['2026'],{queryFn:async()=>({recordset:[{tableCount:3}]}),types}),e=>e.code==='PROFIT_INVOICE_FENCE_INCOMPLETE');
 await assert.rejects(f(['2026'],{queryFn:async s=>({recordset:[s.includes('sys.tables')?{tableCount:4}:{digest:null}]}),types}),e=>e.code==='PROFIT_INVOICE_FENCE_INCOMPLETE');
});
test('duty and average adapters reject frozen financial entrypoints before SQL',()=>{
 for(const file of ['lib/profitTemplateDutyData.js','lib/profitAverageData.js']){
  const text=fs.readFileSync(file,'utf8');assert.match(text,/preservesProfitMoney\(payload\)/);
 }
 const text=fs.readFileSync('pages/sales/profit-report.js','utf8');
 assert.doesNotMatch(text,/setValue\(p.major\);load\(/);
 assert.doesNotMatch(text,/load\(linked.major/);
 assert.doesNotMatch(text,/setMonthlyIncludeLive\(includeLive\);loadMonthly/);
 assert.match(text,/reportController.current\?\.abort/);assert.match(text,/profit-query-empty/);
 const source=fs.readFileSync('lib/profitReport.js','utf8');
 assert.match(source,/l.SourceKind=N'EXCEL' AND h.ArrivalLineKey=TRY_CONVERT\(INT,l.ArrivalLineKey\)/);
 assert.doesNotMatch(source,/CONVERT\(nvarchar\(120\),h.ArrivalLineKey\)/);
 // Legacy history keys are int and indexed; invoice synthetic keys use their own revision.
 const lookup=(kind,key)=>kind==='EXCEL'&&/^\d+$/.test(key)?Number(key):null;
 assert.equal(lookup('EXCEL','42'),42);assert.equal(lookup('INVOICE','42'),null);assert.equal(lookup('INVOICE','invoice:42'),null);
});
test('read context keeps serial replay default, enables fenced pool parallel reads only explicitly, and memoizes external failures',async()=>{
 const {withErpReadContext}=await import('../lib/erpReadContext.js');
 const {getKcsTaxableRate}=await import('../lib/kcsTaxableRate.js');
 let active=0,max=0;
 const queryFn=async()=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,5));active--;return {recordset:[]};};
 const {query}=await import('../lib/db.js');
 await withErpReadContext({queryFn},()=>Promise.all([query('SELECT 1'),query('SELECT 2')]));assert.equal(max,1);
 max=0;await withErpReadContext({queryFn,serializeReads:false},()=>Promise.all([query('SELECT 1'),query('SELECT 2')]));assert.equal(max,2);
 await assert.rejects(withErpReadContext({queryFn},()=>getKcsTaxableRate({currency:'USD',declarationDate:'2026-01-01'})),e=>e.code==='APPROVAL_EXTERNAL_EVIDENCE_REQUIRED');
 const original=process.env.KCS_TAXABLE_RATE_ENABLED;process.env.KCS_TAXABLE_RATE_ENABLED='false';
 try{await withErpReadContext({queryFn,allowExternalEvidenceReads:true},async()=>{
  const a=await getKcsTaxableRate({currency:'USD',declarationDate:'2026-01-01'});process.env.KCS_TAXABLE_RATE_ENABLED='true';
  const b=await getKcsTaxableRate({currency:'USD',declarationDate:'2026-01-01'});assert.deepEqual(b,a);assert.equal(b.reason,'disabled');
 });}finally{if(original===undefined)delete process.env.KCS_TAXABLE_RATE_ENABLED;else process.env.KCS_TAXABLE_RATE_ENABLED=original;}
 const instrumentation=fs.readFileSync('instrumentation.js','utf8');assert.match(instrumentation,/process.env.NEXT_RUNTIME === 'nodejs'/);assert.match(instrumentation,/startSalesSnapshotScheduler\(\)/);
});
