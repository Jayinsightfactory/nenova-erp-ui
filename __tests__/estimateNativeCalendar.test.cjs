const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const imports=Promise.all([
  import('../lib/estimateCalendarEligibility.js'),import('../lib/exeEstimateViewSql.js'),
  import('../lib/profitEstimateCalendarView.js'),import('../lib/profitReportStoredCalculation.js'),
]);
const scope={orderYear:'2030',major:'34'};
const row=()=>({category:'콜롬비아 카네이션',variant:'normal',auto:{N:1000,L:-300,O:25,Q:10,R:2,S:1,H:5,E:3,F:7},manual:{AC:0,AJ:0},stock:{evidenceValue:7}});
const evidence=()=>({...scope,byCategory:{'콜롬비아 카네이션':{raw:{L:-300,O:25},offTime:{L:-200,O:0},offTimeCount:2,missingDateCount:0}}});

test('four native SQL paths share exact calendar join; selected weekdays include deductions and weekends',async()=>{
  const [helper,sql]=await imports;
  assert.equal(helper.estimateCalendarJoinSql(),'JOIN PeriodDay pd ON e.EstimateDtm = pd.BaseYmd');
  assert.equal(helper.estimateCalendarExistsSql('e','d'),'EXISTS (SELECT 1 FROM PeriodDay d WHERE e.EstimateDtm = d.BaseYmd)');
  for (const name of ['sqlEstimateGetData','sqlEstimateGetDetail','sqlEstimateGetPrintDetail','sqlEstimateGetExcelDetail']) {
    const text=sql[name]({orderYearWeek:'203034',custKey:72,weekDayIn:'1,7'});
    const deduction=text.slice(text.indexOf('FROM Estimate e'));
    assert.match(deduction,/JOIN PeriodDay pd ON e\.EstimateDtm = pd\.BaseYmd/);
    assert.doesNotMatch(deduction,/LEFT JOIN PeriodDay pd ON e\.EstimateDtm/);
    assert.doesNotMatch(deduction,/OR pd\.WeekDay IS NULL/);
    assert.match(deduction,/sm\.OrderYearWeek = @orderYearWeek/);
    assert.match(deduction,/sm\.CustKey = @custKey/);
    if(name!=='sqlEstimateGetDetail') assert.match(deduction,/pd\.WeekDay IN \(1,7\)/);
  }
  const items=[{EstimateKey:11,WeekDay:1},{EstimateKey:12,WeekDay:7},{EstimateKey:13,WeekDay:4},{EstimateKey:14,WeekDay:null},{EstimateKey:15,WeekDay:1}];
  assert.deepEqual(sql.filterItemsByExeWeekDay(items,['일','토']).map(r=>r.EstimateKey),[11,12,15],'distinct same-valued valid rows remain distinct');
  assert.deepEqual(sql.filterItemsByExeWeekDay(items,[]),[]);
  assert.equal(sql.filterItemsByExeWeekDay(items,null).length,4,'all weekdays still excludes missing calendar metadata');
  assert.deepEqual(sql.filterItemsByExeWeekDay(items,['수']).map(r=>r.EstimateKey),[13]);
});

test('independent finance estimate audit uses the same exact calendar predicate',async()=>{
  const [helper]=await imports;
  const source=fs.readFileSync('lib/profitIndependentAuditSource.js','utf8');
  const body=source.slice(source.indexOf('const scopeSql'),source.indexOf('export async function readIndependentSources')).replaceAll('export ','');
  const sql=new Function('CASE_CATEGORY','stockablePurchaseItemSql','estimateCalendarJoinSql',`${body};return independentSourceSql();`)('p.Category',()=> '1=1',helper.estimateCalendarJoinSql);
  const query=sql.slice(sql.indexOf('FROM Estimate e'),sql.indexOf('SELECT wm.OrderYear'));
  assert.match(query,/JOIN PeriodDay pd ON e\.EstimateDtm = pd\.BaseYmd/);
  assert.match(query,/sm\.OrderYear=@year/);assert.match(query,/BETWEEN 1 AND @major/);
});

test('real live and historical evidence loaders share exact predicate, raw source scope, and freight O',async()=>{
  const [helper]=await imports;
  const text=fs.readFileSync('lib/profitReport.js','utf8');
  const body=text.slice(text.indexOf('export async function estimateByCategory'),text.indexOf('/** Q 구매금액')).replaceAll('export ','');
  let sqls=[];
  const query=async(statement,params)=>{
    sqls.push(statement);
    assert.equal(params.yr.value,'2030');assert.equal(params.pfx.value,'34-%');assert.equal(params.yw.value,'203034');
    assert.match(statement,/sm\.OrderYear=@yr/);assert.match(statement,/sm\.OrderWeek LIKE @pfx/);
    assert.match(statement,/sm\.OrderYearWeek/);assert.match(statement,/sm\.isFix,0\)=1/);
    if(statement.includes('calendarSource')) {
      assert.match(statement,/EXISTS \(SELECT 1 FROM PeriodDay estimateDay WHERE e\.EstimateDtm = estimateDay\.BaseYmd\)/);
      assert.match(statement,/ExactMatch=0 AND DateCovered=1 AND OffMidnight=1/);
      return {recordset:[{Category:'콜롬비아 카네이션',Col:'L',RawAmount:-300,OffTimeAmount:-200,OffTimeCount:2,MissingDateCount:0},
        {Category:'콜롬비아 카네이션',Col:'O',RawAmount:-25,OffTimeAmount:0,OffTimeCount:0,MissingDateCount:1}]};
    }
    assert.match(statement,/JOIN PeriodDay pd ON e\.EstimateDtm = pd\.BaseYmd/);
    return {recordset:[{Category:'콜롬비아 카네이션',Col:'L',v:-100},{Category:'콜롬비아 카네이션',Col:'O',v:-25}]};
  };
  const deps={query,sql:{NVarChar:'nvarchar'},CASE_CATEGORY:'p.Category',nonValueWeightSql:()=> '1=1',...helper,
    freightSalesByCategory:async()=>({'콜롬비아 카네이션':50})};
  const f=new Function(...Object.keys(deps),`${body};return {estimateByCategory,estimateCalendarEvidenceByCategory};`)(...Object.values(deps));
  assert.deepEqual(await f.estimateByCategory('34','2030'),{L:{'콜롬비아 카네이션':-100},O:{'콜롬비아 카네이션':25}});
  const facts=await f.estimateCalendarEvidenceByCategory('34','2030');
  assert.deepEqual(facts.byCategory['콜롬비아 카네이션'].raw,{L:-300,O:25},'raw O includes the SAME freight-sales source as live calculation');
  assert.equal(facts.byCategory['콜롬비아 카네이션'].missingDateCount,1);assert.equal(sqls.length,2);
});

test('frozen clone removes two covered off-time deductions, keeps one valid, preserves every unrelated cell',async()=>{
  const [,,view,calc]=await imports;
  const original=calc.materializeProfitPayload({...scope,rows:[row()],readMode:'stored',financialReadPolicy:{frozen:true}});
  const bytes=JSON.stringify(original),result=view.applyProfitEstimateCalendarView(original,evidence(),scope);
  assert.equal(result.rows[0].calc.L,-100);assert.equal(result.rows[0].calc.C,original.rows[0].calc.C+200);
  assert.equal(result.rows[0].calc.J,original.rows[0].calc.J+200);assert.equal(result.rows[0].calc.K,result.rows[0].calc.J/result.rows[0].calc.C);
  assert.equal(result.rows[0].calc.M,100/result.rows[0].calc.C);
  for(const key of ['N','E','F','G','H','I','P','Q','R','S','T','U','AC','AJ']) {
    assert.equal(result.rows[0].calc[key],original.rows[0].calc[key],key);
    if(Object.hasOwn(original.totals,key))assert.equal(result.totals[key],original.totals[key],`totals ${key}`);
  }
  assert.equal(result.totals.C,original.totals.C+200);assert.equal(result.totals.L,-100);
  assert.equal(JSON.stringify(original),bytes,'no raw/saved payload mutation');
  assert.equal(view.applyProfitEstimateCalendarView(result,evidence(),scope),result,'marker prevents double application');
  assert.equal(calc.profitDisplayCalculation(result).rows[0].calc.L,-100,'shared screen/print/XLSX display uses corrected frozen calc');
  assert.equal(calc.isMaterializedProfitPayload(result),true);
});

test('source L and O plus applied calc must BOTH reconcile; missing/null source never means explicit zero',async()=>{
  const [,,view,calc]=await imports;
  for(const mutate of [
    p=>delete p.rows[0].auto.L,p=>p.rows[0].auto.O=null,p=>p.rows[0].auto.L=0,
    p=>p.rows[0].auto.O=-25,p=>p.rows[0].calc.L=-100,p=>p.rows[0].calc.O=26,
    p=>p.totals.C=null,p=>delete p.totals.L,
  ]) {
    const p=calc.materializeProfitPayload({...scope,rows:[row()]});mutate(p);const before=JSON.stringify(p);
    const result=view.applyProfitEstimateCalendarView(p,evidence(),scope);
    assert.deepEqual(result.rows,p.rows);assert.deepEqual(result.totals,p.totals);
    assert.ok(result.estimateCalendarView.diagnostics.some(d=>d.status==='source_mismatch'));assert.equal(JSON.stringify(p),before);
  }
  const p=calc.materializeProfitPayload({...scope,rows:[{...row(),auto:{...row().auto,L:0,O:0}}]});
  const facts=evidence();facts.byCategory['콜롬비아 카네이션'].raw={L:0,O:0};facts.byCategory['콜롬비아 카네이션'].offTime={L:0,O:0};
  assert.equal(view.applyProfitEstimateCalendarView(p,facts,scope).estimateCalendarView.changed,true,'explicit numeric zero is valid source, not missing');
});

test('NULL/missing calendar dates and confirmed payloads remain original; year and major mismatch cannot project',async()=>{
  const [,,view,calc]=await imports;
  const p=calc.materializeProfitPayload({...scope,rows:[row()]});
  const missing=evidence();Object.assign(missing.byCategory['콜롬비아 카네이션'],{offTimeCount:0,missingDateCount:8});
  const hold=view.applyProfitEstimateCalendarView(p,missing,scope);
  assert.deepEqual(hold.rows,p.rows);assert.deepEqual(hold.totals,p.totals);assert.equal(hold.estimateCalendarView.changed,false);
  for(const facts of [{...evidence(),orderYear:'2029'},{...evidence(),major:'35'},{...scope,failed:true}]) {
    const held=view.applyProfitEstimateCalendarView(p,facts,scope);assert.deepEqual(held.rows,p.rows);assert.deepEqual(held.totals,p.totals);
  }
  const confirmed={...p,confirmed:{revisionNo:3},confirmedTotals:{...p.totals}};
  const result=view.applyProfitEstimateCalendarView(confirmed,evidence(),scope);
  assert.deepEqual(result.rows,confirmed.rows);assert.deepEqual(result.confirmedTotals,confirmed.confirmedTotals);
  assert.deepEqual(calc.profitDisplayCalculation(result).totals,calc.profitDisplayCalculation(confirmed).totals);
  assert.ok(result.estimateCalendarView.diagnostics.some(d=>d.status==='confirmed_preserved'));
});

test('projection preserves adjustment values, held profit, other category sources and O freight',async()=>{
  const [,,view,calc]=await imports;
  const a=row();a.manual={AC:17,AJ:-19};
  const p=calc.materializeProfitPayload({...scope,rows:[a,{...row(),category:'호주'}]});
  p.rows[0].calc.J=null;p.totals.J=null;
  const facts=evidence();facts.byCategory['콜롬비아 카네이션'].offTime.O=-10;
  const result=view.applyProfitEstimateCalendarView(p,facts,scope);
  assert.equal(result.rows[0].calc.O,35);assert.equal(result.rows[0].calc.C,p.rows[0].calc.C+210);
  assert.equal(result.rows[0].calc.J,null);assert.equal(result.totals.J,null);
  assert.equal(result.rows[0].calc.AC,17);assert.equal(result.rows[0].calc.AJ,-19);
  const allowed=new Set(['D']);
  for(const k of Object.keys(p.rows[1].calc))if(!allowed.has(k))assert.equal(result.rows[1].calc[k],p.rows[1].calc[k]);
});

test('canonical loader projects frozen reads, never latest; source failure is diagnostic; source payloads stay immutable',async()=>{
  const [,,view,calc]=await imports;
  const {profitFinancialReadPolicy}=await import('../lib/profitReportReadPolicy.js');
  const api=fs.readFileSync('pages/api/sales/profit-report.js','utf8');
  const body=api.slice(api.indexOf('export async function currentProfitPeriod'),api.indexOf('export async function loadAnnualMonthlyReportData')).replaceAll('export ','');
  const saved=calc.materializeProfitPayload({...scope,rows:[row()]});const bytes=JSON.stringify(saved);let fail=false,confirmed=false;
  const deps={...view,profitFinancialReadPolicy,materializeProfitPayload:calc.materializeProfitPayload,
    estimateCalendarEvidenceByCategory:async()=>{if(fail)throw Error('SQL unavailable');return evidence();},
    getActiveConfirm:async()=>confirmed?{initialized:true,confirm:{}}:null,
    buildConfirmedPayload:async()=>({...saved,confirmed:{revisionNo:1},confirmedTotals:saved.totals}),
    loadProfitReportCalendar:async()=>[],resolveCurrentProfitWeek:()=>({orderYear:'2030',major:'44'}),resolvePreviousProfitWeek:()=>({orderYear:'2030',major:'43'}),
    readStoredProfitPayload:async()=>saved,manualInputManifest:{},unclassifiedDetailsByCategory:async()=>[],
    settlementScopeFence:async()=>assert.fail('frozen and confirmed calendar projections must not read the latest settlement fence'),
  };
  const load=new Function(...Object.keys(deps),`${body};return loadWeeklyReportPayload;`)(...Object.values(deps));
  const got=await load('34','2030');assert.equal(got.rows[0].calc.L,-100);
  const {buildMonthlyProfitSummary}=await import('../lib/profitReportMonthly.js');
  const monthly=buildMonthlyProfitSummary([{major:'34',period:{startDate:'2030-08-15',endDate:'2030-08-21'},totals:got.totals,rows:got.rows}],'2030');
  assert.equal(monthly.months[7].totals.L,-100,'monthly consumer uses canonical corrected totals without recalc');
  assert.match(got.financialReadPolicy.label,/EXE 달력 차감/);
  fail=true;const held=await load('34','2030');assert.equal(held.rows[0].calc.L,-300);assert.ok(held.estimateCalendarView.diagnostics.some(d=>d.status==='source_unavailable'));
  fail=false;confirmed=true;assert.equal((await load('34','2030')).rows[0].calc.L,-300);
  assert.equal(JSON.stringify(saved),bytes);
});

test('XLSX/print worksheet receives identical corrected cells and original cost cells',async()=>{
  const [,,view,calc]=await imports;
  const {buildProfitReportXlsx}=await import('../lib/profitReportExcel.js');
  const p=calc.materializeProfitPayload({...scope,rows:[row()]});
  const result=view.applyProfitEstimateCalendarView(p,evidence(),scope);
  const display=calc.profitDisplayCalculation(result);
  const wb=buildProfitReportXlsx({major:'34',rows:display.rows,confirmedTotals:display.totals,returnWorkbook:true});
  const sheet=wb.Sheets['주차별 매출이익 보고서'];
  const address=Object.keys(sheet).find(key=>/^B\d+$/.test(key)&&sheet[key].v==='콜롬비아 카네이션');
  assert.ok(address);const n=address.slice(1);
  for(const key of ['L','O','C','J','K','I','H','G','E','F','Q','R','S'])assert.equal(sheet[`${key}${n}`].v,display.rows[0].calc[key],key);
});
