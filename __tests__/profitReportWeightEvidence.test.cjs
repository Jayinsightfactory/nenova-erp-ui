const assert = require('node:assert/strict');
const fs = require('node:fs');
const { resolveFreightWeightEvidence } = require('../lib/freightWeightEvidence.cjs');
const record = require('../data/profit-report-evidence/awb-weight-attestations.v1.json').records[0];
const clone = value => structuredClone(value);

async function main() {
  const freight = await import('../lib/freightCalc.js');
  const order = await import('../lib/orderUtils.js');
  const arrival = await import('../lib/pivotArrivalCalc.js');
  const country = await import('../lib/countryClassification.js');
  const carry = await import('../lib/profitReportAcquisitionCarry.mjs');
  const policy = await import('../lib/profitReportActualCosts.mjs');
  const masters = [7470,7471,7474].map((WarehouseKey,index) => ({ WarehouseKey,
    OrderYear:'2026', OrderWeek:'39-01', OrderNo:'217-10637233',
    FarmName:['Krung','Super Fresh','EXCEL'][index], GrossWeight:null, ChargeableWeight:null }));
  const goods = (WarehouseKey,ProdKey,qty) => ({ WarehouseKey,WdetailKey:ProdKey,ProdKey,
    ProdName:'Thai orchid',CounName:'태국',FlowerName:'덴드륨',FarmName:'flower',
    BoxQuantity:1,BunchQuantity:qty,SteamQuantity:qty,OutQuantity:qty,EstQuantity:qty,
    SteamOf1Box:qty,SteamOf1Bunch:1,OutUnit:'송이',UPrice:1,TPrice:qty });
  const details = [goods(7470,101,10),goods(7471,102,20),
    ...record.nonInventoryAuxiliaryRows.map(row => ({...row,WarehouseKey:7474,ProdName:null,CounName:null,FarmName:'EXCEL'})),
    {WarehouseKey:7474,WdetailKey:42866,ProdKey:2182,ProdName:'운송료',FarmName:'EXCEL',BunchQuantity:270.5,UPrice:1.65,TPrice:446.325},
    {WarehouseKey:7474,WdetailKey:42867,ProdKey:2182,ProdName:'운송료',FarmName:'EXCEL',BunchQuantity:0,UPrice:0,TPrice:325.99}];
  const classifier={weightOfRow:freight.freightWeightOfRow,isGrossWeightItem:freight.isGrossWeightItem,
    isChargeableWeightItem:freight.isChargeableWeightItem,isFreightRow:freight.isFreightRow,baseCountry:country.baseCountry};
  const fixture = {masters,rows:details,...classifier};
  const before = JSON.stringify(fixture);
  const positive = resolveFreightWeightEvidence(fixture);
  assert.equal(positive.grossWeight,164); assert.equal(positive.chargeableWeight,225.5);
  assert.deepEqual(positive.sourceRefs,[record.id]);
  assert.deepEqual(positive.auxiliaryDetailKeys,[42868,42869]);
  assert.equal(positive.evidence[0].source,'user_confirmed_awb_photo');
  assert.equal(JSON.stringify(fixture),before,'helper input immutable');
  for (const change of [{OrderYear:'2025'},{OrderYear:'2027'},{OrderWeek:'39-02'},
    {OrderWeek:'40-01'},{OrderNo:'21710637234'},{OrderYear:null},{OrderWeek:null}]) {
    assert.equal(resolveFreightWeightEvidence({...fixture,masters:masters.map(m=>({...m,...change}))}).matched,false,JSON.stringify(change));
  }
  for (const change of [{WarehouseKey:7475},{FarmName:'EXCEL OTHER'},{isDeleted:1}]) {
    assert.equal(resolveFreightWeightEvidence({...fixture,masters:masters.map(m=>m.WarehouseKey===7474?{...m,...change}:m)}).matched,false);
  }
  assert.equal(resolveFreightWeightEvidence({...fixture,masters:[...masters,masters[0]]}).matched,false,'duplicate group master');
  assert.equal(resolveFreightWeightEvidence({...fixture,rows:[...details,{...goods(7470,103,1),CounName:'중국'}]}).matched,false,'mixed country');
  assert.equal(resolveFreightWeightEvidence({...fixture,rows:details.map(row=>row.ProdName==='운송료'?{...row,CounName:'한국'}:row)}).grossWeight,164,'freight placeholder country does not change Thai goods context');
  const aliased=details.map(row=>row.ProdKey===null?{...row,OutQuantity:0,EvidenceOutQuantity:null,
    SteamOf1Bunch:99,EvidenceSteamOf1Bunch:row.SteamOf1Bunch}:row);
  assert.equal(resolveFreightWeightEvidence({...fixture,rows:aliased}).grossWeight,164,'raw detail evidence survives display/product aliases');
  assert.equal(resolveFreightWeightEvidence({...fixture,isGrossWeightItem:value=>value==='special named GW',
    rows:[...details,{WarehouseKey:7474,ProdName:'special named GW',SteamQuantity:0}]}).grossWeight,0,'injected canonical predicate, not a second name rule');
  for (const expected of record.nonInventoryAuxiliaryRows) for (const [field,value] of Object.entries(expected)) {
    const rows=details.map(row=>row.WdetailKey===expected.WdetailKey?{...row,[field]:value===null?0:field==='OrderCode'?'9':Number(value)+1}:row);
    assert.deepEqual(resolveFreightWeightEvidence({...fixture,rows}).photoFields,[],`fingerprint ${expected.WdetailKey}.${field}`);
  }
  assert.deepEqual(resolveFreightWeightEvidence({...fixture,rows:[...details,details[2]]}).photoFields,[],'duplicate detail blocks photo');
  assert.deepEqual(resolveFreightWeightEvidence({...fixture,rows:details.filter(r=>r.WdetailKey!==42868)}).photoFields,[],'missing detail blocks photo');
  for (const value of [0,200]) {
    for (const inputs of [
      {masters:masters.map(m=>m.WarehouseKey===7470?{...m,GrossWeight:value,ChargeableWeight:value}:m)},
      {snapshots:[{WarehouseKey:7474,GrossWeight:value,ChargeableWeight:value}]},
      {manual:{GrossWeight:value,ChargeableWeight:value}},
      {rows:[...details,{WarehouseKey:7474,WdetailKey:500,ProdKey:3100,ProdName:'Gross weigth',SteamQuantity:value},
        {WarehouseKey:7474,WdetailKey:501,ProdKey:3101,ProdName:'Chargeable weight',SteamQuantity:value}]},
    ]) {
      const resolved=resolveFreightWeightEvidence({...fixture,...inputs});
      assert.equal(resolved.grossWeight,value);assert.equal(resolved.chargeableWeight,value);
      assert.deepEqual(resolved.photoFields,[],'explicit native0/value preserved');
      assert.equal(resolved.nativeDifferences.length,2,'native/photo conflict remains visible');
    }
  }
  for (const [header,expected] of [[{GrossWeight:300,ChargeableWeight:null},[300,null]],
    [{GrossWeight:null,ChargeableWeight:100},[null,100]]]) {
    const resolved=resolveFreightWeightEvidence({...fixture,masters:masters.map(m=>m.WarehouseKey===7474?{...m,...header}:m)});
    assert.deepEqual([resolved.grossWeight,resolved.chargeableWeight],expected,'partial native/photo inverted pair rejected');
    assert.deepEqual(resolved.photoFields,[]);assert.equal(resolved.photoRejectedReason,'native_photo_weight_pair_conflict');
  }

  // Execute both production SELECT loaders using an adapter that cannot write.
  let liveMasters=clone(masters), liveDetails=clone(details), snapshots=[], selected=[];
  const query=async(sql,params={})=>{
    assert.match(sql.trim(),/^SELECT\b/i);assert.doesNotMatch(sql,/\b(INSERT|UPDATE|DELETE|MERGE|EXEC|CREATE|ALTER|DROP|INTO)\b/i);
    if(sql.includes('wm.OrderNo AS AWB')) return {recordset:liveDetails.flatMap(row=>{
      const m=liveMasters.find(m=>m.WarehouseKey===row.WarehouseKey);
      if(!m || String(m.OrderYear)!==params.yr.value || !m.OrderWeek.startsWith(params.pfx.value.replace('%','')))return[];
      return[{...row,OrderYear:m.OrderYear,OrderWeek:m.OrderWeek,AWB:m.OrderNo,farm:m.FarmName,inv:'',
        masterGW:m.GrossWeight,masterCW:m.ChargeableWeight,prodName:row.ProdName,flowerName:row.FlowerName,counName:row.CounName}];
    })};
    if(sql.includes('FROM WarehouseMaster\n')) {
      selected=liveMasters.filter(m=>order.buildOrderYearWeek(m.OrderYear,m.OrderWeek)>=params.yws.value&&order.buildOrderYearWeek(m.OrderYear,m.OrderWeek)<=params.ywe.value);
      return{recordset:selected};
    }
    if(sql.includes('FROM WarehouseDetail wd'))return{recordset:liveDetails.filter(row=>selected.some(m=>m.WarehouseKey===row.WarehouseKey))};
    if(sql.includes('FROM FreightCost'))return{recordset:snapshots};
    return{recordset:[]};
  };
  const deps={...freight,...order,...arrival,...country,...carry,...policy,resolveFreightWeightEvidence,
    query,sql:{NVarChar:'nvarchar'},loadOverrides:()=>({}),loadSourceWorkbookFxRows:async()=>[],resolveFreightExchangeRate:()=>({rate:99999})};
  const pivotCode=fs.readFileSync('lib/pivotFreightArrival.js','utf8').replace(/^import\s[\s\S]*?from ['"][^'"]+['"];\r?\n/gm,'')
    .replace(/^export \{[^}]+\};/gm,'').replace(/^export /gm,'');
  const getArrival=new Function(...Object.keys(deps),pivotCode+';return getArrivalCostsForWeekRange;')(...Object.values(deps));
  const customsSource=fs.readFileSync('lib/customsForwarding.js','utf8');
  const gwCode=customsSource.slice(customsSource.indexOf('export async function loadWarehouseGw'),customsSource.indexOf('// 장미 인보이스'));
  const loadGw=new Function(...Object.keys(deps),gwCode.replace('export ','')+';return loadWarehouseGw;')(...Object.values(deps));
  const gw=await loadGw('39','2026',{reportWeightEvidence:true});
  assert.equal(gw.countries['태국'].GW1,164);assert.equal(gw.countries['태국'].CW1,225.5);
  assert.equal(gw.weightEvidence['태국'].length,1,'many details/masters count once');
  assert.equal((await loadGw('39','2026')).countries['태국'],undefined,'shared input UI unchanged');
  const args={weekStart:'39-01',weekEnd:'39-01',orderYear:'2026',aggregate:'weighted',reportActualCosts:true,
    reportExchangeRate:{country:'태국',currency:'USD',rate:2},reportCustomsCost:{orderYear:'2026',major:39,total:100,source:'approved_estimate'}};
  const result=await getArrival(args);
  assert.deepEqual(Object.keys(result),['101','102']);
  const pool=result[101].estimateDetails[0];
  assert.equal(pool.totalStems,30,'existing orphan-zero classification unchanged');
  assert.equal(pool.freightUSD,772.315,'stored freight preserved, never225.5*1.65+325.99');
  assert.equal(result[101].weightEvidence.length,1);
  assert.equal(result[101].weightEvidence[0].grossWeight,gw.countries['태국'].GW1);
  assert.equal(result[101].source,'approved_estimate');
  assert.ok(Math.abs(result[101].arrivalCost*10+result[102].arrivalCost*20-((30+772.315)*2+100))<1e-7);
  const orphan={...goods(7470,110,200),ProdKey:null,ProdName:null,CounName:null,TPrice:70};
  liveDetails.push(orphan);
  const withOrphan=await getArrival(args);
  assert.equal(withOrphan[101].estimateDetails[0].totalStems,230);
  assert.equal(withOrphan[101].estimateDetails[0].unallocatedRows[0].goodsUSD,70);
  const orphanPool=withOrphan[101].estimateDetails[0].unallocatedRows[0];
  assert.ok(Math.abs(withOrphan[101].arrivalCost*10+withOrphan[102].arrivalCost*20+(70+orphanPool.freightUSD)*2+orphanPool.customsKRW-((100+772.315)*2+100))<1e-7);
  liveDetails=clone(details);
  liveMasters=masters.map(m=>({...m,OrderYear:'2025'}));
  assert.deepEqual(await getArrival({...args,orderYear:'2025',reportCustomsCost:{...args.reportCustomsCost,orderYear:'2025'}}),{});
  liveMasters=clone(masters);
  liveMasters[0].GrossWeight=0;
  assert.equal((await loadGw('39','2026',{reportWeightEvidence:true})).countries['태국'].GW1,0);
  assert.deepEqual(await getArrival(args),{},'explicit0 is not overridden to manufacture a valid allocation');
  liveMasters=clone(masters);
  snapshots=[{FreightKey:1,WarehouseKey:7470,GrossWeight:200,ChargeableWeight:300}];
  assert.equal((await loadGw('39','2026',{reportWeightEvidence:true})).countries['태국'].GW1,200);
  assert.deepEqual((await getArrival(args))[101].weightEvidence,[],'new saved snapshot wins');
  snapshots=[];
  liveDetails[2].SteamQuantity=210;
  assert.deepEqual(await getArrival(args),{},'changed source fingerprint blocks photo fallback');
  assert.equal(JSON.stringify({masters,rows:details,...classifier}),before,'no mutation of original fixture');

  const files=require('../lib/profitReportCalcHash.cjs').listFiles(process.cwd());
  assert.ok(files.includes('lib/freightWeightEvidence.cjs'));
  assert.ok(files.includes('data/profit-report-evidence/awb-weight-attestations.v1.json'));
  const {buildProfitReportAudit}=await import('../lib/profitReportAudit.js');
  const audit=buildProfitReportAudit([{category:'태국',manual:{},source:{H:'approved_estimate'},auto:{Q:30},
    actualCostEvidence:{weightEvidence:positive.evidence},
    beginStock:{priceEvidenceSources:[record.id]},stock:{priceEvidenceSources:[record.id]}}]);
  assert.ok(JSON.stringify(audit).includes('USER_CONFIRMED_WEIGHT_EVIDENCE'));
  assert.ok(JSON.stringify(audit).includes('INVENTORY_PHOTO_WEIGHT_EVIDENCE'));
  const nativeAudit=buildProfitReportAudit([{category:'태국',manual:{H:0},auto:{Q:30},
    actualCostEvidence:{weightNativeDifferences:resolveFreightWeightEvidence({...fixture,manual:{GrossWeight:0}}).nativeDifferences}}]);
  assert.ok(JSON.stringify(nativeAudit).includes('PHOTO_WEIGHT_NATIVE_DIFFERENCE'));
  const apiSource=fs.readFileSync('pages/api/sales/profit-report.js','utf8');
  assert.ok(apiSource.includes('approvedPreviousCost?.weightEvidence'),'previousF to currentE provenance');
  assert.ok(apiSource.includes('approvedCost?.weightEvidence'),'currentF provenance');
  console.log('profitReportWeightEvidence: exact scope/fingerprints/native0/SELECT loaders/freight conservation/provenance PASS');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
