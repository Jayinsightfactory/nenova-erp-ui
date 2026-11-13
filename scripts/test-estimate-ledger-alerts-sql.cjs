// LocalDB only; no .env, no production constructor, exact disposable DB cleanup.
const assert=require('node:assert/strict'),{readFileSync}=require('node:fs'),{randomBytes}=require('node:crypto');
for(const key of ['DB_SERVER','DB_NAME','DB_USER','DB_PASSWORD'])assert(!process.env[key],'Operating credentials forbidden');
const sql=require('mssql/msnodesqlv8');
const database='NenovaAlertFixture_'+randomBytes(8).toString('hex');
const config=db=>({connectionString:`Driver={ODBC Driver 18 for SQL Server};Server=(localdb)\\NenovaErpFixture;Database=${db};Trusted_Connection=Yes;TrustServerCertificate=Yes;`,pool:{min:0,max:1}});
const read=new Function(readFileSync('lib/estimateLedgerAlerts.js','utf8').replace(/export /g,'')+';return readEstimateLedgerAlerts;')();
(async()=>{
 const master=await new sql.ConnectionPool(config('master')).connect();let pool,created=false;
 try{
  await master.request().query(`CREATE DATABASE [${database}];ALTER DATABASE [${database}] SET COMPATIBILITY_LEVEL=130;`);created=true;
  pool=await new sql.ConnectionPool(config(database)).connect();
  await pool.request().batch(`
   CREATE TABLE Product(ProdKey int,ProdName nvarchar(100),isDeleted bit,OutUnit nvarchar(20));
   CREATE TABLE Customer(CustKey int,CustName nvarchar(100));
   CREATE TABLE ShipmentMaster(ShipmentKey int,OrderYear nvarchar(4),OrderWeek nvarchar(10),CustKey int,isDeleted bit);
   CREATE TABLE ShipmentDetail(SdetailKey int,ShipmentKey int,ProdKey int,OutQuantity float,EstQuantity float,Amount float,Vat float);
   CREATE TABLE ShipmentDate(SdetailKey int,ShipmentQuantity float,EstQuantity float,Amount float,Vat float);
   CREATE TABLE Estimate(EstimateKey int,ShipmentKey int,ProdKey int,Quantity float,Unit nvarchar(20),Amount float,Vat float);
   CREATE TABLE WebSalesDefectDeduction(DeductionKey int,OrderYear int,OrderWeek nvarchar(10),AppliedOrderYear int,AppliedOrderWeek nvarchar(10),CustKey int,CustName nvarchar(100),ProdKey int,ProdName nvarchar(100),Quantity float,SourceUnit nvarchar(20),EstimateKey int,IsDeleted bit);
   INSERT Product VALUES(1,N'deleted',1,N'단'),(2,N'active',0,N'단');
   INSERT Customer VALUES(31,N'fixture');
   INSERT ShipmentMaster VALUES(1,N'2025',N'42-01',31,0),(2,N'2026',N'42-02',31,0),(3,N'2026',N'41-01',31,0),(4,N'2026',N'42-03',31,1);
   INSERT ShipmentDetail VALUES(1,1,1,20,20,200,20),(2,2,1,10,10,100,10),(3,2,2,10,10,100,10),(4,3,1,10,10,100,10),(5,4,1,10,10,100,10),(6,2,1,0,0,0,0),(7,2,999,1,1,1,0);
   INSERT ShipmentDate VALUES(6,2,2,0,0);
   INSERT Estimate VALUES(1,1,1,-20,N'단',-200,-20),(2,2,1,-10,N'단',-100,-10),(3,2,2,-10,N'단',-100,-10);
   INSERT WebSalesDefectDeduction VALUES(1,2026,N'42',NULL,NULL,31,N'fixture',2,N'active',10,N'단',10594,0),(2,2025,N'42',NULL,NULL,31,N'fixture',2,N'active',10,N'단',10593,0),(3,2026,N'42',NULL,NULL,31,N'fixture',2,N'active',10,N'단',2,0),(4,2026,N'42',NULL,NULL,31,N'fixture',2,N'active',10,N'단',10592,1),(5,2025,N'41',2026,N'42-01',31,N'fixture',2,N'active',10,N'단',10591,0);
  `);
  const baseline=JSON.stringify((await pool.request().query('SELECT * FROM Product;SELECT * FROM ShipmentDetail;SELECT * FROM Estimate;SELECT * FROM WebSalesDefectDeduction;')).recordsets);
  const q=(text,params)=>{const r=pool.request();for(const [k,v]of Object.entries(params))r.input(k,v.type,v.value);return r.query(text);};
  const a=await read(q,sql,{year:'2026',week:42});
  assert.equal(a.total,6);assert.equal(a.linkedDeductionCheck,'checked');
  assert.deepEqual(a.rows.filter(r=>r.Kind==='deleted-product-shipment').map(r=>r.ReferenceKey),[2,6,7]);
  assert.deepEqual(a.rows.filter(r=>r.Kind==='missing-linked-deduction').map(r=>r.ReferenceKey),[10594,10591]);
  const b=await read(q,sql,{year:'2025',week:42});assert.equal(b.total,3);
  const c=await read(q,sql,{year:'2026',week:40});assert.equal(c.total,0);
  assert.equal(JSON.stringify((await pool.request().query('SELECT * FROM Product;SELECT * FROM ShipmentDetail;SELECT * FROM Estimate;SELECT * FROM WebSalesDefectDeduction;')).recordsets),baseline);
  console.log('PASS LocalDB SQL2016: both years, subweeks, date-only remnants, active product/master exclusions, missing product, exact link keys, applied-year carry, zero scope, all rows unchanged');
 }finally{
  if(pool)await pool.close();
  if(created){assert.match(database,/^NenovaAlertFixture_[a-f0-9]{16}$/);await master.request().query(`ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;DROP DATABASE [${database}]`);}
  await master.close();
 }
})().catch(e=>{console.error(e.code||e.name,e.message);process.exitCode=1;});
