import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import sql from 'mssql';
import { warehouseFarmChoicesSql } from '../lib/warehouseFarmChoices.js';
test('real MSSQL candidates: master/receipt-only, archive/stale/unknown, prior-year same-week',{
 skip:process.env.WAREHOUSE_FARM_SQL!=='1'?'WAREHOUSE_FARM_SQL=1 on loopback fixture':false,timeout:60000
},async()=>{
 const container='nenova-estimate-sql-test-20260826';
 const info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8',windowsHide:true}))[0];
 assert.equal(info.Name,'/'+container);assert.equal(info.State.Running,true);assert.equal(info.Mounts.length,0);
 assert.match(info.Config.Image,/^mcr\.microsoft\.com\/mssql\/server:2022/);
 assert.deepEqual(info.HostConfig.PortBindings,{'1433/tcp':[{HostIp:'127.0.0.1',HostPort:'14339'}]});
 const password=info.Config.Env.find(x=>x.startsWith('MSSQL_SA_PASSWORD=')).slice('MSSQL_SA_PASSWORD='.length);
 const pool=await new sql.ConnectionPool({server:'127.0.0.1',port:14339,user:'sa',password,database:'master',options:{encrypt:false,trustServerCertificate:true},pool:{min:0,max:1}}).connect();
 const tx=new sql.Transaction(pool);let active=false;
 try{await tx.begin();active=true;
 await new sql.Request(tx).batch(`CREATE TABLE #Farm(FarmKey int,FarmName nvarchar(100),isDeleted bit);CREATE TABLE #Receipts(WarehouseKey int,OrderYear nvarchar(4),OrderWeek nvarchar(5),FarmName nvarchar(100),isDeleted bit);
 INSERT #Farm VALUES(1,N'Farm A',0),(2,N'Deleted master',1),(3,N'Duplicate master',0),(4,N'Duplicate master',0);
 INSERT #Receipts VALUES(1,'2025','44-01',N'Faguaflowers Intl LLC',0),(2,'2026','44-01',N'Faguaflowers Intl LLC',0),(3,'2026','44-01',N'Deleted receipt',1),(4,'2026','44-01',N'Deleted master',0),(5,'2025','44-01',N'Old-year farm',0),(6,'2026','44-01',N'',0);`);
 const run=async(opts,farm)=>{const req=new sql.Request(tx);if(opts?.selected)req.input('farm',sql.NVarChar,farm);return (await req.query(warehouseFarmChoicesSql(opts).replaceAll('dbo.Farm','#Farm').replaceAll('dbo.WarehouseMaster','#Receipts'))).recordset;};
 const list=await run();assert.deepEqual(list.map(x=>x.FarmName),['Faguaflowers Intl LLC','Farm A','Old-year farm']);
 assert.equal(list[0].FarmKey,null);assert.equal(list[1].FarmKey,1);
 for(const locked of [false,true]){assert.equal((await run({selected:true,locked},'Faguaflowers Intl LLC')).length,1);for(const name of ['Deleted master','Deleted receipt','Duplicate master','unknown','faguaflowers Intl LLC',"x'; DROP TABLE #Farm;--"])assert.deepEqual(await run({selected:true,locked},name),[]);}
 await new sql.Request(tx).query("UPDATE #Receipts SET isDeleted=1 WHERE FarmName=N'Faguaflowers Intl LLC';");
 assert.deepEqual(await run({locked:true,selected:true},'Faguaflowers Intl LLC'),[],'final write must revalidate stale candidate');
 await tx.rollback();active=false;
 }finally{if(active)await tx.rollback().catch(()=>{});await pool.close();}
});
