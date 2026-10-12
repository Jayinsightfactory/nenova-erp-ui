// MAIN ONLY. User confirmed all EXE/web writers stopped; local Nenova process absent.
// Default: read-only preflight/rollback. --apply: CAS recover exact interrupted CALC,
// then seven native product CALCs in one outer transaction. No FIX/CANCEL, no DDL.
const sql=require('mssql'), assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const apply=process.argv.includes('--apply');
const ids=[2565,2829,3353,3354,3355,3356,3357], list=ids.join(',');
const round2=n=>Math.sign(n)*Math.round((Math.abs(n)+1e-9)*100)/100;
const expectedIn={2565:60,2829:100,3353:50,3354:90,3355:40,3356:150,3357:80};
function expectedRows(masters,rows,flows){
 const valid=masters.filter(r=>r.OrderYearWeek!==null&&r.OrderYearWeek!==undefined);
 const prior=valid.filter(r=>String(r.OrderYearWeek)<'20263701').sort((a,b)=>String(b.OrderYearWeek).localeCompare(String(a.OrderYearWeek)))[0];
 assert(prior,'Previous snapshot missing');
 const sorted=valid.filter(r=>String(r.OrderYearWeek)>=String(prior.OrderYearWeek)).sort((a,b)=>String(a.OrderYearWeek).localeCompare(String(b.OrderYearWeek)));
 assert.equal(new Set(sorted.map(r=>r.OrderYearWeek)).size,sorted.length,'Duplicate snapshot week needs review');
 const values=new Map(rows.map(r=>[`${r.StockKey}/${r.ProdKey}`,r.Stock]));
 const result=[];
 for(let i=0;i<sorted.length;i++){
  const sm=sorted[i];if(String(sm.OrderYearWeek)<'20263701')continue;
  assert.equal(sm.OrderYear,'2026','Later year needs separate review');
  for(const pk of ids){
   const f=flows.find(f=>f.StockKey===sm.StockKey&&f.ProdKey===pk);assert(f);
   const prev=i?values.get(`${sorted[i-1].StockKey}/${pk}`)||0:0;
   const stock=round2(prev+f.InQty-f.OutQty+f.AdjQty);
   assert(Number.isFinite(stock));
   values.set(`${sm.StockKey}/${pk}`,stock);
   result.push({StockKey:sm.StockKey,ProdKey:pk,Stock:stock});
  }
 }
 return result.sort((a,b)=>a.StockKey-b.StockKey||a.ProdKey-b.ProdKey);
}
if(process.argv.includes('--self-test')){
 const m=[{StockKey:1,OrderYear:'2025',OrderYearWeek:'20253701'},{StockKey:2,OrderYear:'2026',OrderYearWeek:'20263602'},{StockKey:3,OrderYear:'2026',OrderYearWeek:'20263701'},{StockKey:4,OrderYear:'2026',OrderYearWeek:'20263702'},{StockKey:5,OrderYear:'2026',OrderYearWeek:null}];
 const rows=ids.flatMap(pk=>[{StockKey:1,ProdKey:pk,Stock:999},{StockKey:2,ProdKey:pk,Stock:2}]);
 const f=ids.flatMap(pk=>[{StockKey:3,ProdKey:pk,InQty:10,OutQty:3,AdjQty:1},{StockKey:4,ProdKey:pk,InQty:0,OutQty:2,AdjQty:0}]);
 const e=expectedRows(m,rows,f);assert.equal(e.length,14);assert(e.every(r=>r.Stock===(r.StockKey===3?10:8)));
 assert.throws(()=>expectedRows([...m,{StockKey:6,OrderYear:'2026',OrderYearWeek:'20263701'}],rows,f),/Duplicate/);
 assert.throws(()=>expectedRows([...m,{StockKey:6,OrderYear:'2027',OrderYearWeek:'20273701'}],rows,f),/Later year/);
 assert.equal(round2(-1.235),-1.24);assert.equal(round2(0.00000000003),0);
 console.log('PASS: carry-forward, cross-year preservation, null historical metadata, duplicate/future-year stop, rounding');process.exit(0);
}
async function snapshot(q){
 const r=await q(`
 SELECT * FROM StockMaster ORDER BY StockKey;
 SELECT * FROM ProductStock WHERE ProdKey IN (${list}) ORDER BY StockKey,ProdKey;
 SELECT CONVERT(varchar(64),HASHBYTES('SHA2_256',(SELECT * FROM ProductStock WHERE ProdKey NOT IN (${list}) ORDER BY StockKey,ProdKey FOR JSON PATH,INCLUDE_NULL_VALUES)),2) hash,COUNT_BIG(*) n FROM ProductStock WHERE ProdKey NOT IN (${list});
 SELECT ProdKey,Stock FROM Product ORDER BY ProdKey;
 SELECT * FROM ViewWarehouse WHERE WarehouseKey=7213 ORDER BY WdetailKey;
 SELECT * FROM StockHistory WHERE StockHistoryKey BETWEEN 462164 AND 462173 ORDER BY StockHistoryKey;
 SELECT * FROM ViewOrder WHERE ProdKey IN (${list}) ORDER BY OrderYear,OrderWeek,ProdKey;
 SELECT * FROM ViewShipment WHERE ProdKey IN (${list}) ORDER BY ShipmentKey,SdetailKey;
 SELECT * FROM ShipmentDate WHERE SdetailKey IN(SELECT SdetailKey FROM ShipmentDetail WHERE ProdKey IN (${list})) ORDER BY SdetailKey;
 SELECT * FROM ShipmentFarm WHERE SdetailKey IN(SELECT SdetailKey FROM ShipmentDetail WHERE ProdKey IN (${list})) ORDER BY SdetailKey;
 `);
 // Deterministic ordering also for views with duplicate business keys.
 return r.recordsets.map(rs=>rs.slice().sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
}
(async()=>{
 const p=await sql.connect({server:process.env.DB_SERVER,port:Number(process.env.DB_PORT||1433),database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD,options:{encrypt:false,trustServerCertificate:true},requestTimeout:120000,connectionTimeout:10000});
 const tx=new sql.Transaction(p);let open=false;
 try{
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);open=true;tx.on('rollback',()=>{open=false});
  const q=s=>new sql.Request(tx).query(s);
  const locked=await q(`SET LOCK_TIMEOUT 1500;SET XACT_ABORT ON;
  SELECT * FROM NenovaStockWeekGate WITH(UPDLOCK,HOLDLOCK,NOWAIT);
  SELECT COUNT_BIG(*) n FROM StockMaster WITH(TABLOCKX,HOLDLOCK,NOWAIT);
  SELECT COUNT_BIG(*) n FROM ProductStock WITH(TABLOCKX,HOLDLOCK,NOWAIT);
  SELECT COUNT(*) n FROM StockMaster WHERE OrderYear='2026' AND OrderWeek='07-09';
  SELECT COUNT(*) n FROM sys.triggers WHERE parent_id IN(OBJECT_ID('StockMaster'),OBJECT_ID('ProductStock'),OBJECT_ID('NenovaStockWeekGate')) AND is_disabled=0;
  SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.usp_StockCalculation')) body;
  `);
  const gates=locked.recordsets[0];assert.equal(gates.length,1);const g=gates[0];
  assert(g.Mode==='RUN'&&g.Action==='CALC'&&g.OrderYear==='2026'&&g.OrderWeek==='07-09'&&g.OwnerSessionID===953&&g.CalcProdKey===0&&!g.PendingCalc&&g.ProtocolVersion===2&&g.OwnerToken,'Gate identity changed');
  assert.equal(new Date(g.LockedAt).toISOString(),'2026-09-08T14:47:57.073Z');
  assert.equal(locked.recordsets[3][0].n,0,'Old source snapshot exists');assert.equal(locked.recordsets[4][0].n,0,'Triggers require review');
  const body=locked.recordsets[5][0].body;
  assert(body&&body.includes('NENOVA_STOCK_GATE_OWNER_V2')&&body.includes('ROUND((pl.Stock + ISNULL(wl.OutQuantity,0) - ISNULL(sl.OutQuantity,0) + ISNULL(shl.OutQuantity,0)),2)'),'Native formula changed');
  const before=await snapshot(q), masters=before[0], original=before[1];
  assert.equal(before[4].length,11);assert(before[4].every(r=>r.OrderYear==='2026'&&r.OrderWeek==='37-01'&&r.FarmName==='EZ Flower'&&r.InvoiceNo==='2614580'));
  assert.equal(before[5].length,10);assert(before[5].every(r=>r.OrderYear==='2026'&&r.OrderWeek==='37-01'));
  for(const pk of ids)assert.equal(before[4].filter(r=>r.ProdKey===pk).reduce((sum,r)=>sum+r.OutQuantity,0),expectedIn[pk]);
  const flows=(await q(`SELECT sm.StockKey,p.ProdKey,
   ISNULL((SELECT ROUND(SUM(v.OutQuantity),2) FROM ViewWarehouse v WHERE v.OrderYear=sm.OrderYear AND v.OrderWeek=sm.OrderWeek AND v.ProdKey=p.ProdKey),0) InQty,
   ISNULL((SELECT ROUND(SUM(v.OutQuantity),2) FROM ViewShipment v WHERE v.OrderYear=sm.OrderYear AND v.OrderWeek=sm.OrderWeek AND v.ProdKey=p.ProdKey AND v.DetailFix=1),0) OutQty,
   ISNULL((SELECT ROUND(SUM(h.AfterValue-h.BeforeValue),2) FROM StockHistory h JOIN CodeInfo c ON c.Category='StockType' AND h.ChangeType=c.Descr WHERE h.OrderYear=sm.OrderYear AND h.OrderWeek=sm.OrderWeek AND h.ProdKey=p.ProdKey),0) AdjQty
   FROM StockMaster sm CROSS JOIN Product p WHERE sm.OrderYearWeek>='20263701' AND p.ProdKey IN (${list}) AND p.isDeleted=0 ORDER BY sm.OrderYearWeek,p.ProdKey;`)).recordset;
  const expected=expectedRows(masters,original,flows);
  const approvedWeeks=['20263701','20263702','20263801','20263802','20263901','20263902','20265001'];
  const plannedWeeks=masters.filter(m=>m.OrderYearWeek!=null&&String(m.OrderYearWeek)>='20263701').map(m=>String(m.OrderYearWeek)).sort();
  assert.deepEqual(plannedWeeks,approvedWeeks,'Recovery scope changed');assert.equal(expected.length,49);
  const target=masters.find(r=>r.OrderYear==='2026'&&r.OrderWeek==='37-01');assert(target);
  const first=expected.filter(r=>r.StockKey===target.StockKey);
  assert.equal(first.length,7);for(const r of first)assert.equal(r.Stock,expectedIn[r.ProdKey],'37-01 unexpected source balance');
  const backup=path.resolve(`scripts/ez-gate-recovery-${Date.now()}-before.json`);
  if(!apply){await tx.rollback();open=false;console.log(JSON.stringify({dryRun:true,first,expectedRows:expected.length,protectedOtherRows:before[2][0].n}));return;}
  fs.writeFileSync(backup,JSON.stringify({gate:g,before,body,flows,expected},null,2),{flag:'wx'});
  // All checks and all native work are inside this physical transaction.
  const req=new sql.Request(tx);req.input('owner',sql.UniqueIdentifier,g.OwnerToken);req.input('at',sql.DateTime,g.LockedAt);
  const changed=await req.query(`UPDATE NenovaStockWeekGate SET Mode=NULL,Action=NULL,OrderYear=NULL,OrderWeek=NULL,LockedAt=NULL,OwnerSessionID=NULL,OwnerToken=NULL,PendingCalc=0,CalcProdKey=NULL WHERE GateKey='1' AND ProtocolVersion=2 AND Mode='RUN' AND Action='CALC' AND OrderYear='2026' AND OrderWeek='07-09' AND OwnerSessionID=953 AND OwnerToken=@owner AND LockedAt=@at AND PendingCalc=0 AND CalcProdKey=0;`);
  assert.deepEqual(changed.rowsAffected,[1]);
  // Native cursor's source SELECT has no ORDER BY. Reinvoke its authoritative
  // formula from each existing week in order, so every previous balance is ready.
  // The write allowlist remains the SAME 49 product/week rows.
  const calculationWeeks=masters.filter(m=>m.OrderYearWeek!=null&&String(m.OrderYearWeek)>='20263701').sort((a,b)=>String(a.OrderYearWeek).localeCompare(String(b.OrderYearWeek)));
  for(const week of calculationWeeks){
   assert(week.OrderYear==='2026'&&/^\d{2}-\d{2}$/.test(week.OrderWeek));
   for(const pk of ids){
   const calc=new sql.Request(tx);calc.input('week',sql.NVarChar(20),week.OrderWeek);calc.input('pk',sql.Int,pk);
   const result=await calc.query(`DECLARE @r int,@m nvarchar(max),@ret int;
    EXEC @ret=dbo.usp_StockCalculation @OrderYear='2026',@OrderWeek=@week,@ProdKey=@pk,@iUserID=N'nenovaSS3',@oResult=@r OUTPUT,@oMessage=@m OUTPUT;
    SELECT @r result,@ret returnCode,@m message,XACT_STATE() state,@@TRANCOUNT txCount;`);
   const last=result.recordsets.at(-1)[0];assert(last.result===0&&last.returnCode===0&&last.state===1&&last.txCount===1,JSON.stringify(last));
   }
   console.log(JSON.stringify({calculatedWeek:week.OrderWeek,products:ids.length}));
  }
  const after=await snapshot(q);
  for(let i=0;i<before.length;i++)if(i!==1)assert.deepEqual(after[i],before[i],`Protected data changed section ${i}`);
  const future=new Set(expected.map(r=>`${r.StockKey}/${r.ProdKey}`));
  assert.deepEqual(after[1].filter(r=>!future.has(`${r.StockKey}/${r.ProdKey}`)),before[1].filter(r=>!future.has(`${r.StockKey}/${r.ProdKey}`)),'Prior-year/week snapshot changed');
  const actual=after[1].filter(r=>future.has(`${r.StockKey}/${r.ProdKey}`));assert.equal(actual.length,expected.length);
  for(const e of expected){const a=actual.find(r=>r.StockKey===e.StockKey&&r.ProdKey===e.ProdKey);assert(a&&Math.abs(a.Stock-e.Stock)<1e-7,`Oracle mismatch ${JSON.stringify({e,a})}`);}
  const end=(await q('SELECT Mode,Action,PendingCalc,OwnerToken,OwnerSessionID FROM NenovaStockWeekGate;')).recordset[0];
  assert(end.Mode===null&&end.Action===null&&!end.PendingCalc&&end.OwnerToken===null&&end.OwnerSessionID===null,'Gate not idle');
  const audit=new sql.Request(tx);audit.input('payload',sql.NVarChar(sql.MAX),JSON.stringify({from:'2026/07-09',warehouseKey:7213,to:'2026/37-01',products:ids,expectedRows:expected.length,backup:path.basename(backup),userDrainConfirmed:true,exclusiveLocks:true,preserveUserReupload:true}));
  await audit.query(`INSERT INTO SystemActionLog(ActionDtm,Actor,ActionType,Method,Endpoint,AffectedTable,AffectedCount,Payload,Result,ResultDesc,RiskLevel) VALUES(GETDATE(),N'Codex:user-request',N'STOCK_GATE_RECOVERY','SQL',N'one-off/ez-stock-gate-20260908',N'NenovaStockWeekGate,ProductStock',${expected.length},@payload,'SUCCESS',N'Interrupted 07-09 CALC recovered after user drain; 7 products native CALC from 37-01; protected data unchanged','HIGH')`);
  await tx.commit();open=false;
  console.log(JSON.stringify({committed:true,gateIdle:true,first,verifiedRows:expected.length,protectedDataUnchanged:true,backup}));
 }finally{if(open)await tx.rollback().catch(()=>{});await p.close()}
})().catch(e=>{console.error(e.code||e.name,e.message);process.exitCode=1});
