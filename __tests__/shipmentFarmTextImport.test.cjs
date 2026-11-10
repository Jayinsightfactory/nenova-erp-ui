const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const XLSX=require('xlsx'),ExcelJS=require('exceljs'),JSZip=require('jszip');
const suffix=process.platform==='win32'?'-msvc':process.platform==='linux'?'-gnu':'';
const {transformSync}=require(`@next/swc-${process.platform}-${process.arch}${suffix}`);
const cache=new Map();
const allowed=new Set(['shipmentFarmText','shipmentFarmWorkbook','shipmentFarmImport','shipmentFarmAssignments','shipmentFarmCandidates','shipmentImportQty','orderUtils','shipmentImport','shipmentFixScopeCore','shipmentFixScope','shipmentDescr','distributeUnits','pivotProdName','orderImportCustomerMatch','sourceProductScope','shipmentImportSourceScope']);
function load(name){
  if(cache.has(name))return cache.get(name).exports;
  const mod={exports:{}};cache.set(name,mod);
  const file=path.resolve('lib',`${name}.js`);
  const out=transformSync(fs.readFileSync(file,'utf8'),false,Buffer.from(JSON.stringify({filename:file,jsc:{target:'es2020',parser:{syntax:'ecmascript'}},module:{type:'commonjs'}})));
  const forbidden=()=>{throw new Error('Unexpected real DB/write dependency');};
  new Function('require','module','exports',out.code)(id=>{
    if(id==='./db' || id==='./db.js')return {query:forbidden,withTransaction:forbidden,sql:{Int:'Int',NVarChar:'NVarChar',Float:'Float'}};
    if(!id.startsWith('.'))return require(id);
    const dep=path.basename(id).replace(/\.(js|cjs)$/,'');
    if(allowed.has(dep))return load(dep);
    return new Proxy({},{get:(_,key)=>key==='__esModule'?true:forbidden});
  },mod,mod.exports);return mod.exports;
}
const text=load('shipmentFarmText'),store=load('shipmentFarmImport'),excel=load('shipmentFarmWorkbook');
const sample=`42-2 장미 농장분배\n-라움\n퀵샌드 40단(엘리떼 30단, 발로레스 10단)\n몬디알 120단\n(마티나 20, 키쿠얄 60, 나투 40)\n-일신\n퀵샌드 20단(10단 티바, 10단 재고)`;
test('multiline, reversed farm quantity, omitted single-farm quantity and cm',()=>{
  const p=text.parseFarmText(sample);assert.deepEqual(p.errors,[]);assert.equal(p.entries.length,3);assert.equal(p.entries[2].farms[0].name,'티바');
  const single=text.parseFarmText('42-2 카네이션 농장분배\n-꽃길\n문라이트 2(아유라)').entries[0];assert.equal(single.farms[0].quantity,2);
  assert.equal(text.parseFarmText('-주광\n몬디알 60cm 110단(나투 60, 키쿠얄 50)').entries[0].quantity,110);
  assert.ok(text.parseFarmText('-라움\n퀵샌드 40단(엘리떼, 발로레스)').errors.length);
  assert.ok(text.parseFarmText('의미 불명 내용').errors.length);
});
const baseRow=()=>({key:'1|2',custKey:1,prodKey:2,custName:'라움',prodName:'Quicksand',productLabel:'Quicksand',productFamily:'rose',sheetName:'장미',cells:['장미!R4C2'],uploadQty:40,excelQty:40,originalTotal:40,outUnit:'단',currentOutQty:40});
function fixtureQuery(year='2026'){
  return async(sql,params)=>{
    if(sql.includes('LEFT JOIN ShipmentFarm')){
      assert.equal(params.yr.value,year);assert.equal(params.wk.value,'45-01');
      return {recordset:[{CustKey:1,ProdKey:2,SdetailKey:year==='2026'?6:5,FarmKey:3,ShipmentQuantity:40,FarmName:'Elite'}]};
    }
    if(sql.includes('FROM ViewWarehouse')){assert.match(sql,/vw\.ProdKey=@pk/);assert.doesNotMatch(sql,/OrderYear|OrderWeek/);return {recordset:[{FarmKey:3,FarmName:'Elite',FarmCode:'El'},{FarmKey:4,FarmName:'Valores',FarmCode:'Va'}]};}
    if(sql.includes('FROM Product'))return {recordset:[{OutUnit:'단',BunchOf1Box:10,SteamOf1Box:100}]};
    throw new Error(sql);
  };
}
function book(){return {SheetNames:['장미'],Sheets:{장미:XLSX.utils.aoa_to_sheet([['x']])}};}
test('integrated preview: cross-year identity, chat heading ignored, sum mismatch, duplicate and farm alias near-miss',async()=>{
  for(const year of ['2025','2026']){
    const p={rows:[baseRow()],orderYear:year,week:'45-01'};
    await store.buildFarmImportPreview({XLSX,workbook:book(),preview:p,text:sample.split('\n몬디알')[0],queryFn:fixtureQuery(year)});
    assert.equal(p.farmImport.errors.length,0);assert.equal(p.rows[0].farmChanged,true);assert.equal(p.rows[0].farmAssignments.length,2);
  }
  for(const input of ['-라움\n퀵샌드 30단(엘리떼 30)', '-라움\n퀵샌드 40단(없는농장)', '-라움\n퀵샌드 40단(엘리떼)\n퀵샌드 40단(엘리떼)']){
    const p={rows:[baseRow()],orderYear:'2026',week:'45-01'};
    await store.buildFarmImportPreview({XLSX,workbook:book(),preview:p,text:input,queryFn:fixtureQuery()});assert.ok(p.farmImport.errors.length,input);
  }
  const p={rows:[{...baseRow(),uploadQty:30,excelQty:30,originalTotal:30}],orderYear:'2026',week:'45-01'};
  await store.buildFarmImportPreview({XLSX,workbook:book(),preview:p,queryFn:fixtureQuery()});assert.ok(p.farmImport.errors.length);
});
test('ambiguous product and farm stay blocked until explicit selection; cm never confused with quantity',()=>{
  const entry={customer:'라움',product:'몬디알 60cm',family:'rose'};
  const a={...baseRow(),productLabel:'Mondial 50',prodName:'Mondial 50'},b={...baseRow(),key:'1|3',prodKey:3,productLabel:'Mondial 60',prodName:'Mondial 60'};
  assert.equal(text.matchFarmEntry(entry,[a,b]).prodKey,3);
  assert.equal(text.matchFarmEntry({...entry,product:'몬디알'},[a,b]),null);
  assert.equal(text.matchFarmEntry({...entry,product:'몬디알'},[a,b],'1|2').prodKey,2);
});
test('locked farm snapshot: stale rejected, repeat target accepted; farm-only money/dates/order invariant',async()=>{
  const row={...baseRow(),farmBefore:[{farmKey:3,shipmentQuantity:40}],farmAssignments:[{farmKey:3,shipmentQuantity:30},{farmKey:4,shipmentQuantity:10}]};
  await store.validateImportFarmRow(fixtureQuery(),row,{shipmentFarmRows:[{FarmKey:3,ShipmentQuantity:40}]},40);
  await assert.rejects(store.validateImportFarmRow(fixtureQuery(),row,{shipmentFarmRows:[{FarmKey:3,ShipmentQuantity:35}]},40),/검증 이후/);
  await store.validateImportFarmRow(fixtureQuery(),row,{shipmentFarmRows:[{FarmKey:3,ShipmentQuantity:30},{FarmKey:4,ShipmentQuantity:10}]},40);
  await assert.rejects(store.validateImportFarmRow(fixtureQuery(),row,{shipmentFarmRows:[{FarmKey:3,ShipmentQuantity:40}]},20),/합계/);
  const before={shipmentDetailRow:{OutQuantity:40,Amount:100,Vat:10,isFix:0,Descr:'old'},shipmentDateRows:[{ShipmentQuantity:40}],orderDetailRow:{OutQuantity:40}};
  const after=structuredClone(before);after.shipmentDetailRow.Descr='new';text.assertFarmOnlyPreserved(before,after);
  for(const field of ['OutQuantity','Amount','Vat','isFix']){const drift=structuredClone(after);drift.shipmentDetailRow[field]++;assert.throws(()=>text.assertFarmOnlyPreserved(before,drift),/롤백/);}
  after.shipmentDateRows[0].ShipmentQuantity=20;assert.throws(()=>text.assertFarmOnlyPreserved(before,after),/롤백/);
});
async function sourceWorkbook(){
  const w=new ExcelJS.Workbook(),s=w.addWorksheet('장미');
  s.pageSetup={paperSize:8,orientation:'portrait',scale:46,fitToPage:true};
  s.pageMargins={left:.25,right:.25,top:.75,bottom:.75,header:.3,footer:.3};
  s.columns=[{width:32},{width:14},{width:14},{width:14}];
  s.addRows([['4501 콜 장미'],['','라움','주문','입고'],['Quicksand',40,40,40],['합계',40,40,40]]);
  s.getRow(3).height=22;s.getCell('B3').alignment={horizontal:'center',indent:1};
  return Buffer.from(await w.xlsx.writeBuffer());
}
test('raw OOXML export preserves exact page setup, margins, widths, heights, numeric quantities and formulas; repeated export stable',async()=>{
  const buffer=await sourceWorkbook(),row=baseRow();row.farmSource={customer:'라움',product:'퀵샌드',quantity:40,unit:'단',family:'rose',farms:[{name:'Elite',quantity:30,unit:'단'},{name:'Valores',quantity:10,unit:'단'}]};
  const plan=await excel.planFarmWorkbook(buffer,[row]);assert.deepEqual(plan.errors,[]);
  const token=excel.signFarmExport(buffer,plan,'user','secret');assert.deepEqual(excel.verifyFarmExport(buffer,token,'user','secret'),plan);
  assert.throws(()=>excel.verifyFarmExport(buffer,token,'other','secret'),/계정/);
  assert.throws(()=>excel.verifyFarmExport(Buffer.from('x'),token,'user','secret'),/파일/);
  const output=await excel.exportFarmWorkbook(buffer,plan),before=await JSZip.loadAsync(buffer),after=await JSZip.loadAsync(output);
  const original=await before.file('xl/worksheets/sheet1.xml').async('string'),changed=await after.file('xl/worksheets/sheet1.xml').async('string');
  for(const tag of ['pageSetup','pageMargins','cols','sheetFormatPr']){
    const pattern=new RegExp(`<${tag}\\b[^>]*(?:\\/>|>[\\s\\S]*?<\\/${tag}>)`);assert.equal(changed.match(pattern)?.[0],original.match(pattern)?.[0],tag);
  }
  assert.equal(await after.file('xl/styles.xml').async('string'),await before.file('xl/styles.xml').async('string'));
  assert.ok(changed.includes(original.match(/<row r="3"[\s\S]*?<\/row>/)[0]));
  const decoded=XLSX.read(output,{type:'buffer'});assert.equal(decoded.Sheets['장미'].B3.v,40);
  assert.equal(text.readFarmSheet(XLSX,decoded)[0].farms.length,2);
  const next=await excel.planFarmWorkbook(output,[row]);assert.equal(next.patches[0].start,plan.patches[0].start);
  const again=await excel.exportFarmWorkbook(output,next),last=await JSZip.loadAsync(again);
  assert.equal(await last.file('xl/worksheets/sheet1.xml').async('string'),changed);
  // Main parser must not mistake printed notes / annotation sheet for order rows.
  const imported=load('shipmentImport').parseAllocationWorkbook(XLSX,decoded);assert.equal(imported.rows.length,1);assert.equal(imported.rows[0].uploadQty,40);
});
test('explicit print boundary blocks overflow rather than enlarging page or scale',async()=>{
  const buffer=await sourceWorkbook(),w=new ExcelJS.Workbook();await w.xlsx.load(buffer);w.worksheets[0].pageSetup.printArea='A1:D4';
  const input=Buffer.from(await w.xlsx.writeBuffer()),row=baseRow();row.farmSource={customer:'라움',product:'퀵샌드',quantity:40,unit:'단',farms:[{name:'Elite',quantity:40}]};
  const plan=await excel.planFarmWorkbook(input,[row]);assert.ok(plan.errors.length);assert.equal(plan.patches.length,0);
});
test('blank heading cells hold printed notes without changing sheet extent, row heights or existing cells',async()=>{
  const w=new ExcelJS.Workbook();await w.xlsx.load(await sourceWorkbook());
  const s=w.worksheets[0];s.getCell('A1').value=null;s.getRow(1).height=141;
  const buffer=Buffer.from(await w.xlsx.writeBuffer()),row=baseRow();
  row.farmSource={customer:'라움',product:'퀵샌드',quantity:40,unit:'단',family:'rose',farms:[{name:'Elite',quantity:40,unit:'단'}]};
  const plan=await excel.planFarmWorkbook(buffer,[row]);assert.deepEqual(plan.errors,[]);assert.ok(plan.patches[0].blocks.length);
  const out=await excel.exportFarmWorkbook(buffer,plan),a=await JSZip.loadAsync(buffer),b=await JSZip.loadAsync(out);
  const before=await a.file('xl/worksheets/sheet1.xml').async('string'),after=await b.file('xl/worksheets/sheet1.xml').async('string');
  for(const tag of ['dimension','pageSetup','pageMargins','cols']) {
    const re=new RegExp(`<${tag}\\b[^>]*(?:\\/>|>[\\s\\S]*?<\\/${tag}>)`);assert.equal(before.match(re)?.[0],after.match(re)?.[0],tag);
  }
  const opened=new ExcelJS.Workbook();await opened.xlsx.load(out);assert.equal(opened.worksheets[0].getRow(1).height,141);assert.equal(opened.worksheets[0].getRow(3).height,22);assert.equal(opened.worksheets[0].getCell('B3').value,40);
  const next=await excel.planFarmWorkbook(out,[row]),again=await excel.exportFarmWorkbook(out,next),z=await JSZip.loadAsync(again);
  assert.equal(await z.file('xl/worksheets/sheet1.xml').async('string'),after);assert.equal(await z.file('xl/styles.xml').async('string'),await b.file('xl/styles.xml').async('string'));
  const clearPlan=await excel.planFarmWorkbook(out,[]),cleared=XLSX.read(await excel.exportFarmWorkbook(out,clearPlan),{type:'buffer'});
  assert.equal(cleared.Sheets['장미'].A1?.v,undefined);assert.deepEqual(text.readFarmSheet(XLSX,cleared),[]);assert.equal(cleared.Sheets['장미'].B3.v,40);
  const changed=XLSX.read(out,{type:'buffer'});changed.Sheets['장미'].A1.v='사용자가 메모를 직접 수정';
  const changedBuffer=XLSX.write(changed,{type:'buffer',bookType:'xlsx'});
  await assert.rejects(excel.planFarmWorkbook(changedBuffer,[row]),/직접 수정/);
});
test('reupload keeps farm annotations, quantity-zero clears them, modified quantity must reconcile',async()=>{
  const workbook=book();workbook.SheetNames.push(text.FARM_SHEET);workbook.Sheets[text.FARM_SHEET]=XLSX.utils.aoa_to_sheet([
    ['NENOVA_FARM_V1'],['업체','품목','총수량','단위','농장','수량','품종'],['라움','Quicksand',40,'단','Elite',40,'rose'],
  ]);
  for(const quantity of [40,0,30]){
    const p={rows:[{...baseRow(),uploadQty:quantity,originalTotal:quantity,excelQty:quantity}],orderYear:'2026',week:'45-01'};
    await store.buildFarmImportPreview({XLSX,workbook,preview:p,queryFn:fixtureQuery()});
    assert.equal(p.farmImport.errors.length>0,quantity===30);
    if(quantity===0){assert.equal(p.rows[0].farmAssignments,undefined);assert.equal(p.rows[0].farmSource,undefined);assert.equal(p.rows[0].farmChanged,true);}
    if(quantity===40)assert.equal(p.rows[0].farmChanged,false);
  }
});
