// Read-only production regression probe. No source text or credentials are emitted.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {buildDefectAutoSourceSql} from '../lib/salesDefectAutoSource.js';
const require=createRequire('C:/Users/USER/nenova-erp-ui/package.json');const sql=require('mssql');
process.loadEnvFile('C:/Users/USER/nenova-erp-ui/.env.local');
const pool=await new sql.ConnectionPool({server:process.env.DB_SERVER,port:Number(process.env.DB_PORT||1433),database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD,options:{encrypt:false,trustServerCertificate:true}}).connect();
try {
 const row=(await pool.request().query('SELECT * FROM WebSalesDefectDeduction WHERE DeductionKey=1066')).recordset[0];
 const evidence={orderYear:row.OrderYear,orderWeek:row.OrderWeek,custKey:row.CustKey,prodKey:row.ProdKey,quantity:row.Quantity,sourceUnit:row.SourceUnit,reviewedSourceFileName:row.SourceFileName,note:''};
 const projection=buildDefectAutoSourceSql('d').projection.replaceAll('d.Note',"N''");
 for(const [name,historyKey,patch,expected]of [['no-review',0,{},true],['older-review',1,{},true],['new-review',2147483640,{},false],['wrong-year',2147483640,{orderYear:2025},true],['wrong-quantity',2147483640,{quantity:99},true]]){
  const q=`WITH WebSalesDefectDeductionHistory AS (SELECT HistoryKey,DeductionKey,ActionType,BeforeJson,AfterJson FROM dbo.WebSalesDefectDeductionHistory UNION ALL SELECT @hk,1066,N'SOURCE_REVIEW_RELEASE',N'{}',@after WHERE @hk>0) SELECT ${projection} FROM dbo.WebSalesDefectDeduction d WHERE d.DeductionKey=1066`;
  const r=(await pool.request().input('hk',sql.Int,historyKey).input('after',sql.NVarChar(sql.MAX),JSON.stringify({...evidence,...patch})).query(q)).recordset[0];assert.equal(Boolean(r.SourceFactReview),expected,name);console.log(name+' passed');
 }
 const manual=(await pool.request().query(`SELECT ${projection} FROM dbo.WebSalesDefectDeduction d WHERE d.DeductionKey IN(1019,1054)`)).recordset;
 assert.equal(manual.length,2);for(const r of manual){assert.equal(r.ManualSourceConfirmed,true);assert.equal(r.SourceFactReview,false);}
 console.log('note overwritten; newer exact review only; manual preserved; SQL writes=0');
} finally {await pool.close();}
