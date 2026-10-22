const assert = require('node:assert/strict');
const fs = require('node:fs');
async function main() {
  const policy = await import('../lib/profitReportActualCosts.mjs');
  const calc = await import('../lib/profitReportCalc.js');
  const audit = await import('../lib/profitFormulaAudit.mjs');
  const row = { GW1: 10, GW2: 0, BakSangRateApplied: 4, Customs1: 20, SunYul1: 11,
    WorldFreight1: 22, WorldFreight1Manual: 1, Quarantine1: 0 };
  assert.equal(policy.resolveThaiStoredCustoms({ row, inbound: true }).total, 90);
  for (const field of ['BakSangRateApplied','Customs1','SunYul1','WorldFreight1','Quarantine1']) {
    assert.equal(policy.resolveThaiStoredCustoms({ row: { ...row, [field]: null }, inbound: true }).total, null, field);
    assert.ok(policy.resolveThaiStoredCustoms({ row: { ...row, [field]: 0 }, inbound: true }).total != null, field+' zero');
  }
  assert.equal(policy.resolveThaiStoredCustoms({ inbound: true, gw: { GW1: 170 } }).total, null);
  assert.equal(policy.resolveThaiStoredCustoms({row:{...row,WorldFreight1Manual:0},inbound:true}).total,null,'saved recommendation is not actual');
  assert.equal(policy.resolveThaiStoredCustoms({row,inbound:true,inboundWeeks:['34-02']}).total,null,'missing second inbound must not be zeroed');
  assert.equal(policy.resolveThaiStoredCustoms({}).total, 0);
  assert.deepEqual(policy.allocateActualCustoms([{key:'a',gw:1,complete:true},{key:'b',gw:3,complete:true}],400),{a:100,b:300});
  assert.deepEqual(policy.allocateActualCustoms([{key:'a',gw:1,complete:false}],400),{});
  const empty = {category:'태국', source:{H:'actual_cost_missing'}, manual:{},
    auto:{N:100,L:0,O:0,Q:10,S:1,R:2,H:null,E:0,F:0}};
  const c = calc.computeProfitRow(empty);
  assert.equal(c.G,22); for (const k of ['H','I','J','K']) assert.equal(c[k],null,k);
  assert.equal(calc.computeProfitRow({...empty,manual:{H:0}}).I,22,'explicit zero stays valid');
  const totals = calc.computeProfitTotals([{...empty,calc:c}]);
  c.D=calc.calcRevenueRatio(c,totals);c.U=calc.calcPurchaseRatio(c,totals);
  assert.equal(totals.H,null);assert.equal(totals.K,null);
  assert.equal(audit.auditProfitFormulas({rows:[empty]},[{...empty,calc:c}],totals).status,'MATCH');
  assert.equal(calc.computeFifoStockUnitPrice({endQty:2,unit:'단',layers:[
    {offset:0,qty:5,price:null,strictCostEvidence:true},{offset:1,qty:5,price:100,strictCostEvidence:true},
  ]}).status,'NO_PRICED_PURCHASE','missing actual cost cannot borrow an older price');

  // Execute the real loader/allocator with a SELECT-only fixture adapter. No DB connection.
  const freight = await import('../lib/freightCalc.js');
  const order = await import('../lib/orderUtils.js');
  const arrival = await import('../lib/pivotArrivalCalc.js');
  const country = await import('../lib/countryClassification.js');
  const carry = await import('../lib/profitReportAcquisitionCarry.mjs');
  const m = (year,week,key) => ({OrderYear:year,OrderWeek:week,WarehouseKey:key,OrderNo:'same-AWB',FarmName:'flower',GrossWeight:10,ChargeableWeight:20});
  const masters=[m('2026','34-01',1),m('2026','34-02',2),m('2025','34-01',3)];
  const goods=(wk,key,unit,qty,stems)=>({WarehouseKey:wk,WdetailKey:key,ProdKey:key,ProdName:'orchid',FlowerName:'덴드륨',CounName:'태국',OutUnit:unit,OutQuantity:qty,BunchQuantity:qty,SteamQuantity:stems,BoxQuantity:0,UPrice:1,TPrice:stems,SteamOf1Bunch:10});
  const transport=wk=>({WarehouseKey:wk,WdetailKey:100+wk,ProdKey:999,ProdName:'운송료',TPrice:30,UPrice:30,BunchQuantity:1});
  let details=[goods(1,11,'단',2,20),goods(1,12,'송이',10,10),transport(1),goods(2,21,'단',1,10),transport(2),goods(3,31,'단',1,10),transport(3)];
  let selected=[]; let queries=0;
  const query=async(q,params={})=>{
    queries++;assert(!/\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|EXEC)\b/i.test(q));
    if(q.includes('FROM WarehouseMaster\n')){
      selected=masters.filter(r=>order.buildOrderYearWeek(r.OrderYear,r.OrderWeek)>=params.yws.value&&order.buildOrderYearWeek(r.OrderYear,r.OrderWeek)<=params.ywe.value);
      return {recordset:selected};
    }
    if(q.includes('FROM WarehouseDetail wd'))return {recordset:details.filter(r=>selected.some(m=>m.WarehouseKey===r.WarehouseKey))};
    return {recordset:[]};
  };
  const deps={...freight,...order,...arrival,...country,...carry,...policy,query,sql:{NVarChar:'nvarchar'},loadOverrides:()=>({}),loadSourceWorkbookFxRows:async()=>[],resolveFreightExchangeRate:()=>({rate:99999})};
  const code=fs.readFileSync('lib/pivotFreightArrival.js','utf8').replace(/^import\s[\s\S]*?from ['"][^'"]+['"];\r?\n/gm,'')
    .replace(/^export \{[^}]+\};/gm,'').replace(/^export /gm,'');
  const api=new Function(...Object.keys(deps),code+'\nreturn {getArrivalCostsForWeekRange};')(...Object.values(deps));
  const args={weekStart:'34-01',weekEnd:'34-02',orderYear:'2026',aggregate:'weighted',reportActualCosts:true,
    reportExchangeRate:{country:'태국',currency:'USD',rate:2},reportCustomsCost:{orderYear:'2026',major:34,total:100,source:'sql_actual_cost'}};
  const result=await api.getArrivalCostsForWeekRange(args);
  assert.deepEqual(Object.keys(result).sort(),['11','12','21']);
  assert.equal(result[11].displayUnit,'단');assert.equal(result[12].displayUnit,'송이');
  const sum=2*result[11].arrivalCost+10*result[12].arrivalCost+result[21].arrivalCost;
  assert.ok(Math.abs(sum-(40*2+60*2+100))<1e-7,'goods + actual freight + H conservation');
  const one=await api.getArrivalCostsForWeekRange({...args,weekEnd:'34-01'});
  assert.equal(one[11].arrivalCost,result[11].arrivalCost,'major H not duplicated when one subweek is requested');
  const prior=await api.getArrivalCostsForWeekRange({...args,orderYear:'2025',weekEnd:'34-01',reportCustomsCost:{...args.reportCustomsCost,orderYear:'2025'}});
  assert.deepEqual(Object.keys(prior),['31']);
  for(const change of [{total:null},{source:'gw_auto'},{orderYear:'2025'},{major:35}])assert.deepEqual(await api.getArrivalCostsForWeekRange({...args,reportCustomsCost:{...args.reportCustomsCost,...change}}),{});
  for (const missing of [null, undefined, '', NaN, Infinity, -1]) {
    details.push({...transport(1),WdetailKey:200,TPrice:missing});
    assert.deepEqual(await api.getArrivalCostsForWeekRange(args),{},'every freight line needs a recorded finite nonnegative amount');
    details.pop();
  }
  details.push({...transport(1),WdetailKey:200,TPrice:0});
  assert.equal((await api.getArrivalCostsForWeekRange(args))[11].arrivalCost,result[11].arrivalCost,'additional recorded zero is valid');
  details.pop();
  details.push({...goods(1,41,'단',1,10),ProdKey:null});
  assert.deepEqual(await api.getArrivalCostsForWeekRange(args),{},'unmatched invoice line blocks partial cost allocation');
  details=details.filter(r=>r.WdetailKey!==41).map(r=>r.ProdName==='운송료'?{...r,TPrice:0}:r);
  const free=await api.getArrivalCostsForWeekRange({...args,reportCustomsCost:{...args.reportCustomsCost,total:0}});
  assert.equal(free[11].arrivalCost,20,'recorded zero freight/customs never replaced by defaults');
  assert.ok(queries>0);
  console.log('profitReportActualCosts: SQL-only fixture, conservation, zero/null, missing, units, subweeks, cross-year and no-write PASS');
}
main().catch(e=>{console.error(e);process.exitCode=1});
