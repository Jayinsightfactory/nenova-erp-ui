// SELECT-only probe; no ERP writes.
const sql = require('node:module').createRequire('/var/www/nenova-erp/package.json')('mssql');
(async()=>{
 const p=await sql.connect({server:process.env.DB_SERVER,port:Number(process.env.DB_PORT||1433),database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD,options:{encrypt:false,trustServerCertificate:true},requestTimeout:60000});
 try {
 const r=await p.request().query(`SELECT TOP 30 om.OrderYear,om.OrderWeek,om.CustKey,om.OrderMasterKey,od.OrderDetailKey,od.ProdKey,p.OutUnit,p.EstUnit,od.OutQuantity,od.EstQuantity,od.BoxQuantity,od.BunchQuantity,od.SteamQuantity,
 CASE WHEN p.OutUnit IN (N'박스','BOX','Box') THEN ISNULL(od.BoxQuantity,0) WHEN p.OutUnit IN (N'단','BUNCH','Bunch') THEN ISNULL(od.BunchQuantity,0) ELSE ISNULL(od.SteamQuantity,0) END AS LegacyCurrentQty
 FROM OrderMaster om JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey JOIN Product p ON p.ProdKey=od.ProdKey
 WHERE om.OrderYear=N'2026' AND om.OrderWeek BETWEEN N'34-01' AND N'36-02' AND ISNULL(om.isDeleted,0)=0 AND ISNULL(od.isDeleted,0)=0 AND ISNULL(p.isDeleted,0)=0
 ORDER BY ABS(ISNULL(od.OutQuantity,0)-(CASE WHEN p.OutUnit IN (N'박스','BOX','Box') THEN ISNULL(od.BoxQuantity,0) WHEN p.OutUnit IN (N'단','BUNCH','Bunch') THEN ISNULL(od.BunchQuantity,0) ELSE ISNULL(od.SteamQuantity,0) END)) DESC,om.OrderMasterKey,od.ProdKey;
 SELECT TOP 10 om.OrderYear,om.OrderWeek,om.CustKey,od.ProdKey,COUNT(*) AS ActiveRows,SUM(od.OutQuantity) AS OutQty FROM OrderMaster om JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey WHERE om.OrderYear=N'2026' AND om.OrderWeek BETWEEN N'34-01' AND N'36-02' AND ISNULL(om.isDeleted,0)=0 AND ISNULL(od.isDeleted,0)=0 GROUP BY om.OrderYear,om.OrderWeek,om.CustKey,od.ProdKey HAVING COUNT(*)>1;
 SELECT TOP 3 om.OrderYear,om.OrderWeek,om.CustKey,od.ProdKey,od.OutQuantity FROM OrderMaster om JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey WHERE om.OrderYear=N'2025' AND om.OrderWeek=N'34-01' AND ISNULL(om.isDeleted,0)=0 AND ISNULL(od.isDeleted,0)=0 ORDER BY om.OrderMasterKey;`);
 console.log(JSON.stringify({readOnly:true,recordsets:r.recordsets},null,2));
 }finally{await p.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
