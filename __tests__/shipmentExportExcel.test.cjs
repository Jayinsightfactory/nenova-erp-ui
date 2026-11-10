const test=require('node:test'),assert=require('node:assert/strict'),XLSX=require('xlsx');
const scope={orderYear:'2025',orderWeek:'46-01',custKey:null};
const base={OrderYear:'2025',OrderWeek:'46-01',CustKey:1,CustName:'연습업체',SdetailKey:1,ProdKey:1,ProdName:'연습품목',CountryFlower:'미국 수국',OutUnit:'박스',OutQuantity:1,SdateKey:1,ShipmentQuantity:.4,Timestamp:'2025-11-15 00:00:00.000',CalendarMatches:1};
const split=()=>[{...base},{...base,SdateKey:2,ShipmentQuantity:.6,Timestamp:'2025-11-16 00:00:00.000'},{...base,SdateKey:3,ShipmentQuantity:0,Timestamp:'2025-11-17 00:00:00.000'}];
test('saved Saturday/Sunday and fractions survive XLSX; dates chronological; mixed units separate',async()=>{
 const {shipmentExportLines,buildShipmentExportWorkbook}=await import('../lib/shipmentExportExcel.js');
 const rows=[...split().reverse(),{...base,SdetailKey:2,ProdKey:2,SdateKey:4,OutUnit:'단',OutQuantity:3,ShipmentQuantity:3}];
 const before=JSON.stringify(rows),lines=shipmentExportLines(rows,scope);assert.equal(lines.length,3);assert.equal(lines.filter(r=>r.OutUnit==='박스').reduce((s,r)=>s+r.qty,0),1);
 const wb=buildShipmentExportWorkbook(rows,scope),parsed=XLSX.read(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}),{type:'buffer'});
 assert.equal(parsed.SheetNames.length,2);assert(parsed.SheetNames[0].endsWith('11-15'));assert(parsed.SheetNames[1].endsWith('11-16'));
 const a=XLSX.utils.sheet_to_json(parsed.Sheets[parsed.SheetNames[0]],{header:1});
 assert(a[0][0].includes('2025-11-15 (토)'));assert(a.some(r=>r[2]==='총 수량 / 박스'));assert(a.some(r=>r[2]==='총 수량 / 단'));assert(a.some(r=>r[2]===.4));
 assert.equal(JSON.stringify(rows),before);
});
test('date-less details export once, no guessed weekday; zero saved dates not date-less',async()=>{
 const {shipmentExportLines}=await import('../lib/shipmentExportExcel.js');
 assert.equal(shipmentExportLines([{...base,SdateKey:null,ShipmentQuantity:null,Timestamp:null,CalendarMatches:0}],scope)[0].qty,1);
 assert.throws(()=>shipmentExportLines([{...base,ShipmentQuantity:0}],scope),/합계/);
 assert.equal(shipmentExportLines([],scope).length,0);
});
test('near misses: cross-year/subweek/customer, missing metadata, duplicate/date mismatch and quantity mismatch block',async()=>{
 const {shipmentExportLines}=await import('../lib/shipmentExportExcel.js');
 for(const change of [{OrderYear:'2026'},{OrderWeek:'46-02'},{OutUnit:null},{SdetailKey:0},{ShipmentQuantity:null},{ShipmentQuantity:-1},{ShipmentQuantity:.5},{CalendarMatches:0},{CalendarMatches:2},{Timestamp:'2025-11-15 12:00:00.000'},{SdateKey:null}])assert.throws(()=>shipmentExportLines([{...base,...change},split()[1]],scope));
 assert.throws(()=>shipmentExportLines(split(),{...scope,custKey:2}));
 assert.throws(()=>shipmentExportLines([base,{...base,SdateKey:2,ShipmentQuantity:.6}],scope));
 assert.throws(()=>shipmentExportLines([{...base,SdateKey:null},{...base,SdateKey:null}],scope));
});
test('explicit year required; prior/current year same week never defaulted or mixed',async()=>{
 const {requireOrderYear}=await import('../lib/orderUtils.js');
 assert.deepEqual(requireOrderYear('2025-46-01'),{orderYear:'2025',orderWeek:'46-01'});
 assert.deepEqual(requireOrderYear('46-01','2026'),{orderYear:'2026',orderWeek:'46-01'});
 for(const args of [['46-01'],['2025-46-01','2026'],['46-01','0'],['46-01','false'],['','2025']])assert.throws(()=>requireOrderYear(...args));
});
test('download API invokes scoped SQL, ignores stale draft overrides and returns real workbook',async()=>{
 const fs=require('node:fs'),{requireOrderYear}=await import('../lib/orderUtils.js');
 const {SHIPMENT_EXPORT_SQL,buildShipmentExportWorkbook}=await import('../lib/shipmentExportExcel.js');
 const source=fs.readFileSync('pages/api/shipment/excel-download.js','utf8').replace(/^import .*;\r?\n/gm,'').replace('export default','return');
 let calls=0;
 const handler=new Function('query','sql','withAuth','requireOrderYear','SHIPMENT_EXPORT_SQL','buildShipmentExportWorkbook','XLSX',source)(async(statement,params)=>{
  calls++;assert.equal(statement,SHIPMENT_EXPORT_SQL);assert.equal(params.year.value,'2025');assert.equal(params.week.value,'46-01');assert.equal(params.major.value,'202546');assert.equal(params.custKey.value,1);
  return {recordset:split()};
 },{NVarChar:'text',Int:'int'},fn=>fn,requireOrderYear,SHIPMENT_EXPORT_SQL,buildShipmentExportWorkbook,XLSX);
 const invoke=async(query,method='GET')=>{const res={headers:{},status(n){this.statusCode=n;return this;},setHeader(k,v){this.headers[k]=v;},send(body){this.body=body;return this;},json(body){this.body=body;return this;},end(){return this;}};await handler({method,query},res);return res;};
 for(const query of [{week:'46-01'},{week:'2025-46-01',year:'2026'},{week:'2025-46-01',custKey:'0'},{week:'2025-46-01',custKey:'1.5'},{week:'invalid'}])assert.equal((await invoke(query)).statusCode,400);
 assert.equal((await invoke({},'POST')).statusCode,405);assert.equal(calls,0);
 const res=await invoke({week:'2025-46-01',custKey:'1',dailyQtyInputs:'{"1|1":{"토":0,"일":99}}',shipDayConfigs:'{"미국 수국|-01":"월"}'});
 assert.equal(res.statusCode,200);assert.equal(calls,1);assert(res.headers['Content-Disposition'].includes('2025-46-01'));
 const wb=XLSX.read(res.body,{type:'buffer'});assert.equal(wb.SheetNames.length,2);assert(wb.SheetNames.some(s=>s.endsWith('11-16')));
});
