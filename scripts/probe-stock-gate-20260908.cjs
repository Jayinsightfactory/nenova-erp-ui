const sql=require('mssql');
(async()=>{const p=await sql.connect({server:process.env.DB_SERVER,port:Number(process.env.DB_PORT||1433),database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD,options:{encrypt:false,trustServerCertificate:true},requestTimeout:15000});try{
const r=await p.request().query(`SET LOCK_TIMEOUT 5000;
SELECT GETDATE() serverNow,GateKey,Mode,LockedAt,Action,OrderYear,OrderWeek,OwnerSessionID,PendingCalc,CalcProdKey,ProtocolVersion FROM dbo.NenovaStockWeekGate;
SELECT s.session_id,s.status,s.last_request_start_time,s.last_request_end_time,r.status requestStatus,r.command,r.wait_type,r.blocking_session_id FROM sys.dm_exec_sessions s LEFT JOIN sys.dm_exec_requests r ON r.session_id=s.session_id WHERE s.session_id IN (SELECT OwnerSessionID FROM dbo.NenovaStockWeekGate);
SELECT HAS_PERMS_BY_NAME(NULL,NULL,'VIEW SERVER STATE') viewServerState;
SELECT name FROM sys.procedures WHERE name LIKE '%Gate%' OR name LIKE '%Session%' OR name LIKE '%Recover%';
SELECT HAS_PERMS_BY_NAME(NULL,NULL,'ALTER ANY CONNECTION') alterConnection,IS_SRVROLEMEMBER('sysadmin') isSysadmin,IS_SRVROLEMEMBER('processadmin') isProcessadmin;
SELECT COUNT(*) sourceStockMaster FROM StockMaster WHERE OrderYear='2026' AND OrderWeek='07-09';
`);console.log(JSON.stringify(r.recordsets));}finally{await p.close()}})().catch(e=>{console.error(e.code,e.message);process.exitCode=1});
