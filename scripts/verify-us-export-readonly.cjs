// Explicitly invoked operational read-only verification. No workbook/PII is written to disk.
// SMOKE_USER/SMOKE_PASS must be supplied privately; --base defaults to production.
const assert=require('node:assert/strict'),fs=require('node:fs'),XLSX=require('xlsx');
async function main(){
 const arg=name=>process.argv.find(a=>a.startsWith(name+'='))?.slice(name.length+1);
 const envFile=arg('--env-file');if(envFile)Object.assign(process.env,require('node:util').parseEnv(fs.readFileSync(envFile,'utf8')));
 assert(process.env.SMOKE_USER&&process.env.SMOKE_PASS,'Private smoke credentials required');
 const base=arg('--base')||'https://nenovaweb.com';
 const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:process.env.SMOKE_USER,password:process.env.SMOKE_PASS})});
 assert.equal(login.status,200,'Authentication failed');const token=(await login.json()).token;assert(token);
 const get=async(path)=>{const response=await fetch(base+path,{headers:{Authorization:'Bearer '+token}});assert.equal(response.status,200,'Read endpoint failed: '+path.split('?')[0]);return response.json();};
 const {query,sql}=await import('../lib/db.js');
 const {SHIPMENT_EXPORT_SQL,buildShipmentExportWorkbook,shipmentExportLines}=await import('../lib/shipmentExportExcel.js');
 const {buildEcountUploadSheet,mapExcelDetailRowToEcount}=await import('../lib/estimateEcountExcel.js');
 const {buildEstimatePrintWorksheet,buildEstimatePrintWorkbook}=await import('../lib/estimatePrintExcel.js');
 const rows=(await query(`SELECT sm.CustKey,sd.SdetailKey,sd.ProdKey,sd.OutQuantity,sd.Amount,sd.Vat,sd.isFix,dt.SdateKey,dt.EstQuantity,dt.Cost DateCost,dt.Amount DateAmount,dt.Vat DateVat,p.ProdCode,p.ProdName FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey JOIN Product p ON p.ProdKey=sd.ProdKey LEFT JOIN ShipmentDate dt ON dt.SdetailKey=sd.SdetailKey WHERE sm.OrderYear=N'2025' AND sm.OrderWeek=N'46-01' AND sm.isDeleted=0 AND p.CounName=N'미국' ORDER BY sd.SdetailKey,dt.SdateKey`)).recordset;
 const details=[...new Map(rows.map(r=>[r.SdetailKey,r])).values()],positive=rows.filter(r=>r.OutQuantity>0);
 assert.equal(details.length,29);assert.equal(details.filter(r=>r.OutQuantity>0).length,25);
 assert(positive.every(r=>r.isFix===true||r.isFix===1));
 const totals={out:details.reduce((s,r)=>s+Number(r.OutQuantity),0),quantity:rows.reduce((s,r)=>s+Number(r.EstQuantity),0),amount:rows.reduce((s,r)=>s+Number(r.DateAmount),0),vat:rows.reduce((s,r)=>s+Number(r.DateVat),0)};
 assert.equal(totals.out,79);assert.equal(totals.quantity,1690);assert(Math.abs(totals.amount+totals.vat-9785000)<.000001);
 assert.equal(details.reduce((s,r)=>s+Number(r.Amount)+Number(r.Vat),0),9785000);
 const codes=new Set(rows.map(r=>r.ProdCode)),keys=new Set(positive.map(r=>Number(r.SdateKey))),names=new Set(rows.map(r=>r.ProdName));
 const actualDetail=new Set(),ecount=[],allEcount=[],printed=[];let customers=0,shipmentSheets=0,shipmentLines=0;
 const roundtrip=book=>XLSX.read(XLSX.write(book,{type:'buffer',bookType:'xlsx'}),{type:'buffer'});
 for(const custKey of new Set(positive.map(r=>r.CustKey))){
  customers++;const params=new URLSearchParams({year:'2025',week:'46-01',custKey:String(custKey),weekDays:'월,화,수,목,금,토,일'});
  const excel=await get('/api/estimate?'+params+'&view=excelDetail');assert(excel.success);allEcount.push(...excel.rows);ecount.push(...excel.rows.filter(r=>codes.has(r.ProdCode)));
  const groupValues=(rs,code,cost,qty,amount,vat)=>{const map=new Map();for(const r of rs){const key=JSON.stringify([r[code],Number(r[cost])]);if(!map.has(key))map.set(key,[0,0,0]);const sum=map.get(key);sum[0]+=Number(r[qty]);sum[1]+=Number(r[amount]);sum[2]+=Number(r[vat]);}return map;};
  const expectedMoney=groupValues(positive.filter(r=>r.CustKey===custKey),'ProdCode','DateCost','EstQuantity','DateAmount','DateVat');
  const actualMoney=groupValues(excel.rows.filter(r=>codes.has(r.ProdCode)),'ProdCode','Cost','EstQuantity','Amount','Vat');
  assert.equal(actualMoney.size,expectedMoney.size,'ECOUNT product/cost groups differ');for(const [key,values] of expectedMoney){assert(actualMoney.has(key),'ECOUNT product/cost group missing');values.forEach((value,i)=>assert(Math.abs(value-actualMoney.get(key)[i])<.000001,'ECOUNT source quantity/money mismatch'));}
  const detail=await get('/api/estimate?'+params+'&byDate=1&itemsOnly=1');assert(detail.success);for(const r of detail.items)if(keys.has(Number(r.SdateKey)))actualDetail.add(Number(r.SdateKey));
  const print=await get('/api/estimate?'+params+'&byDate=1&itemsOnly=1&printDetail=1');assert(print.success);
  // Use the same complete customer rows and real builder as the download action.
  const worksheet=buildEstimatePrintWorksheet({custName:excel.rows[0]?.CustName??'',week:'46',printDate:new Date().toISOString().slice(0,10),printFormat:'estimate',rows:print.items});
  const book=roundtrip(buildEstimatePrintWorkbook([{name:'견적서',worksheet}]));
  const parsed=XLSX.utils.sheet_to_json(book.Sheets['견적서'],{header:1});
  const visible=parsed.filter(r=>typeof r[0]==='number'&&names.has(r[1]));
  const expected=print.items.filter(r=>names.has(r.ProdName)&&r.EstimateType==='정상출고');
  assert.equal(visible.length,expected.length,'Quote rows lost');
  for(let i=0;i<visible.length;i++){const a=visible[i],b=expected[i];assert.equal(a[2],b.UnitQuantity);assert.equal(a[3],Number(b.Cost));assert.equal(a[4],Number(b.Amount));assert.equal(a[5],Number(b.Vat));printed.push({quantity:Number(String(a[2]).replace(/단$/,'')),amount:a[4],vat:a[5]});}
  const paramsDb={year:{type:sql.NVarChar,value:'2025'},week:{type:sql.NVarChar,value:'46-01'},major:{type:sql.NVarChar,value:'202546'},custKey:{type:sql.Int,value:custKey}};
  const source=(await query(SHIPMENT_EXPORT_SQL,paramsDb)).recordset,scope={orderYear:'2025',orderWeek:'46-01',custKey};
  const expectedBook=roundtrip(buildShipmentExportWorkbook(source,scope));
  const res=await fetch(base+'/api/shipment/excel-download?week=2025-46-01&custKey='+custKey,{headers:{Authorization:'Bearer '+token}});assert.equal(res.status,200,'Shipment workbook failed');
  const actual=XLSX.read(Buffer.from(await res.arrayBuffer()),{type:'buffer'});
  assert.deepEqual(actual.SheetNames,expectedBook.SheetNames);
  for(const sheet of actual.SheetNames)assert.deepEqual(XLSX.utils.sheet_to_json(actual.Sheets[sheet],{header:1}),XLSX.utils.sheet_to_json(expectedBook.Sheets[sheet],{header:1}),'Shipment cells differ from saved dates');
  shipmentSheets+=actual.SheetNames.length;shipmentLines+=shipmentExportLines(source,scope).filter(r=>names.has(r.ProdName)).length;
 }
 assert.deepEqual(actualDetail,keys,'Native detail identities missing');assert.equal(ecount.length,25);assert.equal(shipmentLines,25);
 const ecountBook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(ecountBook,buildEcountUploadSheet(allEcount),'이카운트업로드');
 const allExported=XLSX.utils.sheet_to_json(roundtrip(ecountBook).Sheets['이카운트업로드']);assert.equal(allExported.length,allEcount.length);
 allExported.forEach((row,i)=>assert.deepEqual(row,mapExcelDetailRowToEcount(allEcount[i]),'ECOUNT serialized cells mismatch'));
 const exported=allExported.filter(r=>codes.has(r['품목코드']));assert.equal(exported.length,25);
 for(const [field,expected] of [['수량',totals.quantity],['공급가액',totals.amount],['부가세',totals.vat]])assert(Math.abs(exported.reduce((s,r)=>s+Number(r[field]),0)-expected)<.000001,'ECOUNT '+field+' mismatch');
 for(const field of ['quantity','amount','vat'])assert(Math.abs(printed.reduce((s,r)=>s+Number(r[field]),0)-totals[field])<.000001,'Quote '+field+' mismatch');
 console.log(JSON.stringify({base,sourceDetails:29,positiveExportRows:25,zeroRowsPreserved:4,customers,nativeDetailMatches:actualDetail.size,quoteRows:printed.length,ecountRows:exported.length,shipmentLines,shipmentSheets,...totals,gross:totals.amount+totals.vat,workbooksRoundtripped:true,erpWrites:0,ecountUploads:0}));
}
main().then(()=>process.exit(0)).catch(error=>{console.error('Read-only export verification failed; no credentials or operational row payloads logged.');console.error(String(error.stack).split('\n').find(line=>line.includes('at main '))||'Read request or assertion failed');process.exit(1)});
