// SELECT-only evidence. Credentials are read into memory and never printed.
const fs = require('node:fs');
const sql = require('mssql');
for (const line of fs.readFileSync('C:/Users/USER/nenova-erp-ui/.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '');
}
(async () => {
  const pool = await sql.connect({ server:process.env.DB_SERVER, port:Number(process.env.DB_PORT || 1433), database:process.env.DB_NAME,
    user:process.env.DB_USER,password:process.env.DB_PASSWORD,options:{encrypt:false,trustServerCertificate:true},requestTimeout:60000 });
  try {
    const result = await pool.request().query(`SELECT OrderYear,COUNT(*) AS Rows,MAX(OrderWeek) AS LastWeek FROM dbo.WebArrivalCostLine WHERE IsCurrent=1 GROUP BY OrderYear;
      SELECT r.Basis,r.Status,COUNT(*) AS Rows FROM dbo.WebInvoiceCostRevision r GROUP BY r.Basis,r.Status;
      SELECT TOP(5) d.OrderYear,d.OrderWeek,JSON_VALUE(r.InputSnapshotJson,'$.input.nativeCurrency') AS Currency,
      JSON_VALUE(r.InputSnapshotJson,'$.input.expenseBasis') AS ExpenseBasis,JSON_VALUE(r.InputSnapshotJson,'$.input.exchangeRateKRW') AS Fx
      FROM dbo.WebInvoiceCostRevision r JOIN dbo.WebInvoiceDocument d ON d.DocumentId=r.DocumentId WHERE r.Status=N'APPROVED' ORDER BY r.ApprovedAt DESC;`);
    console.log(JSON.stringify(result.recordsets));
    const {loadHotelArrivalHistory}=await import('../lib/raumPnlArrivalReference.js');
    const source=await pool.request().query(`SELECT TOP(30) ROW_NUMBER() OVER(ORDER BY ProdKey) AS itemKey,ProdKey AS prodKey,Unit AS unit FROM dbo.WebInvoiceCostLine GROUP BY ProdKey,Unit`);
    const units={BUNCH:'단',STEM:'송이',BOX:'박스'};
    const items=source.recordset.map(row=>({...row,unit:units[row.unit]||row.unit}));
    const refs=await loadHotelArrivalHistory({orderYear:'2026',major:42,items},async(text,params={})=>{
      if (!/^\s*(SELECT|WITH|\/\*)/i.test(text)) throw Error('READ_ONLY');
      const req=pool.request();for(const [key,v]of Object.entries(params))req.input(key,v.type,v.value);
      return req.query(text);
    });
    const rows=Object.values(refs).flat();
    console.log(JSON.stringify({historyRows:rows.length,invoiceRows:rows.filter(r=>r.sourceKind==='INVOICE').length,
      fxReady:rows.filter(r=>r.sourceKind==='INVOICE'&&r.fixedPerUnitKRW!=null).length,years:[...new Set(rows.map(r=>r.orderYear))]}));
  } finally { await pool.close(); }
})().catch(error => { console.error(error.code || 'PROBE_FAILED'); process.exitCode=1; });
