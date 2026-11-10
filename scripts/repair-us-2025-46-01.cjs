// Default dry-run. Explicit --apply requires the exact preview plan SHA.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const args=process.argv.slice(2),apply=args.includes('--apply');
const value=k=>args.find(a=>a.startsWith(k+'='))?.slice(k.length+1);
const envFile=value('--env-file')||path.resolve('.env.local');
for(const line of fs.readFileSync(envFile,'utf8').split('\n')){const m=line.match(/^([^#=]+)=(.*)$/);if(m)process.env[m[1].trim()]=m[2].trim().replace(/^['"]|['"]$/g,'');}
const scope="sm.OrderYear=N'2025' AND sm.OrderWeek=N'46-01' AND sm.isDeleted=0 AND p.CounName=N'미국'";
const sourceSql=lock=>`SELECT sm.OrderYear,sm.OrderWeek,sm.ShipmentKey,sm.CustKey,sm.OrderYearWeek,sm.isFix MasterFix,
 sd.SdetailKey,sd.ProdKey,sd.OutQuantity,sd.EstQuantity DetailEst,sd.Cost DetailCost,sd.Amount DetailAmount,sd.Vat DetailVat,sd.isFix DetailFix,sd.ShipmentDtm DetailDtm,
 dt.SdateKey,dt.ShipmentDtm,dt.ShipmentQuantity,dt.EstQuantity DateEst,dt.Cost DateCost,dt.Amount DateAmount,dt.Vat DateVat,
 p.CounName,p.OutUnit,p.EstUnit,p.BunchOf1Box,p.SteamOf1Box,p.SteamOf1Bunch
 FROM ShipmentMaster sm ${lock?'WITH(UPDLOCK,HOLDLOCK)':''} JOIN ShipmentDetail sd ${lock?'WITH(UPDLOCK,HOLDLOCK)':''} ON sd.ShipmentKey=sm.ShipmentKey
 JOIN Product p ON p.ProdKey=sd.ProdKey JOIN ShipmentDate dt ${lock?'WITH(UPDLOCK,HOLDLOCK)':''} ON dt.SdetailKey=sd.SdetailKey WHERE ${scope} ORDER BY sd.SdetailKey,dt.SdateKey`;
async function preserved(q){
 const yr="sm.OrderYear IN(N'2025',N'2026') AND sm.OrderWeek=N'46-01'",pk='(670,1718,2677)';
 const statements={
 details:`SELECT sd.* FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey WHERE ${yr} AND sd.ProdKey IN ${pk} ORDER BY sd.SdetailKey`,
 masters:`SELECT sm.* FROM ShipmentMaster sm WHERE ${yr} AND EXISTS(SELECT 1 FROM ShipmentDetail sd WHERE sd.ShipmentKey=sm.ShipmentKey AND sd.ProdKey IN ${pk}) ORDER BY sm.ShipmentKey`,
 orders:`SELECT om.*,od.* FROM OrderMaster om JOIN OrderDetail od ON om.OrderMasterKey=od.OrderMasterKey WHERE om.OrderYear IN(N'2025',N'2026') AND om.OrderWeek=N'46-01' AND od.ProdKey IN ${pk} ORDER BY od.OrderDetailKey`,
 farms:`SELECT sf.* FROM ShipmentFarm sf JOIN ShipmentDetail sd ON sf.SdetailKey=sd.SdetailKey JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey WHERE ${yr} AND sd.ProdKey IN ${pk} ORDER BY sd.SdetailKey`,
 estimates:`SELECT e.* FROM Estimate e JOIN ShipmentMaster sm ON sm.ShipmentKey=e.ShipmentKey WHERE ${yr} AND e.ProdKey IN ${pk} ORDER BY e.EstimateKey`,
 stock:`SELECT ps.* FROM ProductStock ps WHERE ps.ProdKey IN ${pk} ORDER BY ps.StockKey,ps.ProdKey`,
 stockHistory:`SELECT * FROM StockHistory WHERE ProdKey IN ${pk} ORDER BY StockHistoryKey`,
 products:`SELECT * FROM Product WHERE ProdKey IN ${pk} ORDER BY ProdKey`,
 profit:`SELECT * FROM WebProfitReport WHERE OrderYear IN(N'2025',N'2026') AND MajorWeek=46`,
 dateIdentity:`SELECT dt.SdateKey,dt.SdetailKey,dt.ShipmentDtm,dt.ShipmentQuantity,CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),ISNULL(dt.Descr,N''))),2) descrSha FROM ShipmentDate dt JOIN ShipmentDetail sd ON sd.SdetailKey=dt.SdetailKey JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey WHERE ${yr} AND sd.ProdKey IN ${pk} ORDER BY dt.SdateKey`,
 otherDates:`SELECT dt.* FROM ShipmentDate dt JOIN ShipmentDetail sd ON sd.SdetailKey=dt.SdetailKey JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey WHERE ${yr} AND sd.ProdKey IN ${pk} AND sm.OrderYear<>N'2025' ORDER BY dt.SdateKey`
 };const out={};for(const [key,statement] of Object.entries(statements)){const rows=(await q(statement)).recordset;out[key]={count:rows.length,sha256:hash(rows)};}return out;
}
async function main(){
 const {getPool,sql}=await import('../lib/db.js');
 const {planUsLegacyDateRepair,applyUsLegacyDateRepair}=await import('../lib/shipmentLegacyDateRepair.js');
 const {sqlEstimateGetData,sqlEstimateGetDetail,sqlEstimateGetExcelDetail}=await import('../lib/exeEstimateViewSql.js');
 const {mapExcelDetailRowToEcount,buildEcountUploadSheet}=await import('../lib/estimateEcountExcel.js');
 const pool=await getPool(),tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
 const q=async(s,p={})=>{const r=new sql.Request(tx);for(const[k,v]of Object.entries(p))r.input(k,v.type,v.value);return r.query(s);};
 try{
  assert.equal((await q("SELECT COUNT(*) n FROM sys.triggers WHERE parent_id IN(OBJECT_ID(N'ShipmentDate'),OBJECT_ID(N'SystemActionLog')) AND is_disabled=0")).recordset[0].n,0,'Unexpected repair/audit trigger');
  const rows=(await q(sourceSql(apply))).recordset;
  const bad=rows.filter(r=>Number(r.ShipmentQuantity)!==Number(r.OutQuantity)||new Date(r.ShipmentDtm).getTime()!==new Date(r.DetailDtm).getTime());if(bad.length) console.log('SCOPE_MISMATCH',JSON.stringify(bad.map(r=>({key:r.SdetailKey,out:r.OutQuantity,dateQty:r.ShipmentQuantity,date:r.ShipmentDtm,detailDate:r.DetailDtm}))));
  const plan=planUsLegacyDateRepair(rows);
  const planSha=hash({rows,plan}),before=await preserved(q);
  const eligible=(await q(`SELECT COUNT(DISTINCT dt.SdateKey) n FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey JOIN Product p ON p.ProdKey=sd.ProdKey JOIN ShipmentDate dt ON dt.SdetailKey=sd.SdetailKey JOIN PeriodDay pd ON pd.BaseYmd=dt.ShipmentDtm WHERE ${scope} AND EXISTS(SELECT 1 FROM ViewOrder vo WHERE vo.OrderYear=sm.OrderYear AND vo.OrderWeek=sm.OrderWeek AND vo.CustKey=sm.CustKey AND vo.ProdKey=sd.ProdKey)`)).recordset[0].n;assert.equal(eligible,29,'Native order/calendar join changed');
  assert.equal(plan.length,25,'Positive target count changed');
  const totals={sourceRows:rows.length,rows:plan.length,zeroRowsPreserved:rows.length-plan.length,out:rows.reduce((s,r)=>s+Number(r.OutQuantity),0),est:plan.reduce((s,r)=>s+r.EstQuantity,0),amount:plan.reduce((s,r)=>s+r.Amount,0),vat:plan.reduce((s,r)=>s+r.Vat,0)};
  const backup={scope:{year:'2025',week:'46-01',country:'미국'},planSha,rows,plan,preserved:before,totals};
  const out=path.resolve('outputs/us-2025-46-01-'+(apply?'apply':'preview')+'.json');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(backup,null,2));
  if(!apply){await tx.rollback();console.log(JSON.stringify({mode:'preview',planSha,...totals,preserved:before}));return;}
  assert.equal(value('--expected-plan-sha'),planSha,'Preview changed; no writes');
  await applyUsLegacyDateRepair(q,sql,plan);
  const after=await preserved(q);assert.deepEqual(after,before,'Protected ledgers changed');
  const current=(await q(sourceSql(false))).recordset;
  for(let i=0;i<rows.length;i++){const a={...current[i]},b={...rows[i]};for(const k of ['DateEst','DateCost','DateAmount','DateVat']){delete a[k];delete b[k];}assert.deepEqual(a,b,'Non-target date/detail fields changed');const expected=plan.find(p=>p.SdateKey===Number(current[i].SdateKey));if(expected){assert.equal(Number(current[i].DateEst),expected.EstQuantity);assert.equal(Number(current[i].DateAmount),expected.Amount);assert.equal(Number(current[i].DateVat),expected.Vat);}else assert.deepEqual(current[i],rows[i],'Zero shipment must remain unchanged');}
  const codes=new Set((await q('SELECT ProdCode FROM Product WHERE ProdKey IN(670,1718,2677)')).recordset.map(x=>x.ProdCode));
  let excel=[],detailKeys=new Set(),visibleCustomers=0;
  for(const custKey of new Set(plan.map(r=>r.CustKey))){const params={orderYearWeek:{type:sql.NVarChar,value:'202546'},custKey:{type:sql.Int,value:custKey}};
   const list=(await q(sqlEstimateGetData({weekDayIn:'1,2,3,4,5,6,7',custKey}),params)).recordset;assert.ok(list.length,'Estimate list missing customer');visibleCustomers++;
   const detail=(await q(sqlEstimateGetDetail({weekDayIn:'1,2,3,4,5,6,7'}),params)).recordset;for(const r of detail)if(plan.some(p=>p.SdateKey===Number(r.DetailKey)))detailKeys.add(Number(r.DetailKey));
   excel.push(...(await q(sqlEstimateGetExcelDetail({weekDayIn:'1,2,3,4,5,6,7'}),params)).recordset.filter(r=>codes.has(r.ProdCode)));
  }
  assert.equal(detailKeys.size,25);assert.equal(excel.length,25);for(const r of excel){const m=mapExcelDetailRowToEcount(r);assert.equal(m.수량,Number(r.EstQuantity));assert.equal(m.공급가액,Number(r.Amount));assert.equal(m.부가세,Number(r.Vat));}
  for(const [field,target] of [['EstQuantity',totals.est],['Amount',totals.amount],['Vat',totals.vat]])assert.ok(Math.abs(excel.reduce((s,r)=>s+Number(r[field]),0)-target)<0.001,field+' export mismatch');
  const sheet=buildEcountUploadSheet(excel);assert.ok(sheet['!ref'].endsWith('26'));
  const XLSX=require('xlsx'),book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'이카운트업로드');
  const parsed=XLSX.read(XLSX.write(book,{type:'buffer',bookType:'xlsx'}),{type:'buffer'});
  const exported=XLSX.utils.sheet_to_json(parsed.Sheets['이카운트업로드']);assert.equal(exported.length,25);
  assert.ok(Math.abs(exported.reduce((sum,r)=>sum+Number(r['공급가액']),0)-totals.amount)<0.001);
  assert.ok(Math.abs(exported.reduce((sum,r)=>sum+Number(r['부가세']),0)-totals.vat)<0.001);
  await q(`INSERT SystemActionLog(Actor,ActionType,Method,Endpoint,AffectedTable,AffectedCount,Payload,Result,ResultDesc,RiskLevel) VALUES(N'approved-legacy-repair',N'REPAIR',N'CLI',N'scripts/repair-us-2025-46-01.cjs',N'ShipmentDate',25,@payload,N'SUCCESS',N'User approved 2025/46-01 US legacy quote fields; quantity/sales preserved',N'HIGH')`,{payload:{type:sql.NVarChar,value:JSON.stringify({planSha,keys:plan.map(r=>r.SdateKey),totals,preserved:before})}});
  assert.deepEqual(await preserved(q),before,'Audit side effects changed protected ledgers');
  await tx.commit();fs.writeFileSync(out,JSON.stringify({...backup,committed:true,verification:{visibleCustomers,detailRows:detailKeys.size,excelRows:excel.length},after},null,2));console.log(JSON.stringify({mode:'committed',planSha,...totals,visibleCustomers,detailRows:detailKeys.size,excelRows:excel.length,protectedLedgers:'unchanged'}));
 }catch(e){await tx.rollback().catch(()=>{});throw e;}finally{await pool.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
