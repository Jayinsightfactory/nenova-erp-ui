// SELECT-only audit by default. --apply archives ONLY the five user-reviewed rows.
// Uses the existing version-checked archive API; never deletes or updates Estimate.
import { createRequire } from 'node:module';
import { buildDefectAutoSourceSql } from '../lib/salesDefectAutoSource.js';
const require = createRequire('C:/Users/USER/nenova-erp-ui/package.json');
const sql = require('mssql');
process.loadEnvFile('C:/Users/USER/nenova-erp-ui/.env.local');
const expected = new Map([[722,[640,502,15]],[740,[288,502,2]],[859,[533,889,90]],[868,[533,889,10]],[877,[533,889,1]]]);
const pool = await new sql.ConnectionPool({server:process.env.DB_SERVER,port:Number(process.env.DB_PORT||1433),database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD,options:{encrypt:false,trustServerCertificate:true},connectionTimeout:15000,requestTimeout:60000}).connect();
try {
  const projection=buildDefectAutoSourceSql('d').projection;
  const rows=(await pool.request().query(`SELECT d.DeductionKey,d.OrderYear,d.OrderWeek,d.CustKey,d.ProdKey,d.Quantity,d.IsDeleted,d.EstimateKey,d.RowVersionNo,${projection} FROM WebSalesDefectDeduction d`)).recordset;
  const rejected=rows.filter(r=>!r.IsDeleted&&r.RejectedAutoSource);
  const missing=rows.filter(r=>!r.IsDeleted&&r.MissingLinkedEstimate);
  console.log(JSON.stringify({activeRejectedSources:rejected.length,rejectedCustomers:new Set(rejected.map(r=>r.CustKey)).size,missingLinkedEstimates:missing.length,missingCustomers:new Set(missing.map(r=>r.CustKey)).size,reviewedRows:rows.filter(r=>expected.has(r.DeductionKey)).map(r=>({key:r.DeductionKey,sourceYear:r.OrderYear,sourceWeek:r.OrderWeek,custKey:r.CustKey,prodKey:r.ProdKey,quantity:r.Quantity,archived:!!r.IsDeleted,rejected:!!r.RejectedAutoSource,missing:!!r.MissingLinkedEstimate}))}));
  if(process.argv.includes('--apply')) {
    const snapshotSql=`SELECT 'Estimate' AS Source,COUNT_BIG(*) AS N,CHECKSUM_AGG(BINARY_CHECKSUM(e.EstimateKey,e.ProdKey,e.Quantity,e.Unit,e.Cost,e.Amount,e.Vat,e.ShipmentKey)) AS Fingerprint FROM Estimate e JOIN ShipmentMaster sm ON sm.ShipmentKey=e.ShipmentKey WHERE sm.OrderYear=2026 AND sm.CustKey IN (533,640,288)
      UNION ALL SELECT 'ShipmentDetail',COUNT_BIG(*),CHECKSUM_AGG(BINARY_CHECKSUM(sd.SdetailKey,sd.ProdKey,sd.OutQuantity,sd.Amount,sd.Vat,sd.isFix)) FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey WHERE sm.OrderYear=2026 AND sm.CustKey IN (533,640,288)
      UNION ALL SELECT 'ShipmentDate',COUNT_BIG(*),CHECKSUM_AGG(BINARY_CHECKSUM(dt.SdateKey,dt.EstQuantity,dt.Amount,dt.Vat,dt.ShipmentDtm)) FROM ShipmentDate dt JOIN ShipmentDetail sd ON sd.SdetailKey=dt.SdetailKey JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey WHERE sm.OrderYear=2026 AND sm.CustKey IN (533,640,288)`;
    const before=(await pool.request().query(snapshotSql)).recordset;
    const selected=[];
    for(const [key,[cust,prod,qty]] of expected){
      const row=rows.find(r=>r.DeductionKey===key);
      if(!row||Number(row.OrderYear)!==2026||Number(row.CustKey)!==cust||Number(row.ProdKey)!==prod||Number(row.Quantity)!==qty) throw new Error('Reviewed scope changed; no automatic repair');
      if(row.IsDeleted) continue;
      if(!row.RejectedAutoSource&&!row.MissingLinkedEstimate) throw new Error('Reviewed evidence changed; no automatic repair');
      selected.push({deductionKey:key,sourceYear:Number(row.OrderYear),sourceWeek:String(row.OrderWeek),expectedRowVersionNo:Number(row.RowVersionNo)});
    }
    if(selected.length){
      const body={action:'manage-archive',year:2026,week:43,rows:selected,reason:'사용자 확인: 희경 Yukari Cherry15단·레바논2단 과거자동자료 및 주광 수국화이트 삭제견적 연결원장 정리. 실제 견적/출고/재고 보존.'};
      const call=async(preview)=>{
        const response=await fetch(new URL('/api/sales/defect-deductions',process.env.NENOVAWEB_URL),{method:'POST',headers:{Authorization:`Bearer ${process.env.NENOVAWEB_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({...body,preview}),signal:AbortSignal.timeout(60000)});
        if(!response.ok) throw new Error(`Archive HTTP ${response.status}`);
        const result=await response.json();if(!result.success) throw new Error('Archive failed');return result;
      };
      const preview=await call(true);
      if(preview.rows.length!==selected.length||preview.rows.some(r=>r.action!=='ARCHIVE_PRESERVE_ESTIMATE')) throw new Error('Archive preview mismatch');
      const applied=await call(false);
      console.log(JSON.stringify({archived:applied.archived,keys:applied.rows.map(r=>r.deductionKey)}));
    }
    const after=(await pool.request().query(snapshotSql)).recordset;
    if(JSON.stringify(before)!==JSON.stringify(after)) throw new Error('Concurrent ERP ledger change detected; review fingerprints');
    console.log(JSON.stringify({erpFingerprintsPreserved:true,before,after}));
  }
} finally {await pool.close();}
