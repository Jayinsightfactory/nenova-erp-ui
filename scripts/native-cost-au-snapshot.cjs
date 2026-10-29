// Read-only 2026/44-01 AU invoice 41002 fixture capture. Never writes SQL.
const fs = require('node:fs');
const sql = require('mssql');
process.loadEnvFile('C:/Users/USER/nenova-erp-ui/.env.local');
(async () => {
  const { readNativeCostSource } = await import('../lib/nativeReceiptCost.js');
  const pool = await sql.connect({ server: process.env.DB_SERVER, port: Number(process.env.DB_PORT || 1433), database: process.env.DB_NAME,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, options: { encrypt: false, trustServerCertificate: true }, requestTimeout: 15000 });
  try {
    const candidates = await pool.request().input('year', sql.NVarChar(4), '2026').input('week', sql.NVarChar(5), '44-01').input('invoice', sql.NVarChar(100), '41002')
      .query('SELECT WarehouseKey,FarmName FROM dbo.WarehouseMaster WHERE OrderYear=@year AND OrderWeek=@week AND InvoiceNo=@invoice AND ISNULL(isDeleted,0)=0');
    if (candidates.recordset.length !== 1) throw Error('Expected exactly one invoice candidate');
    let raw;
    const queryFn = async (text, params) => {
      if (!/^\/\* native-cost:readonly-source \*\/ SELECT/.test(text) || /\b(INSERT|UPDATE|DELETE|EXEC|MERGE)\b/i.test(text)) throw Error('Read-only violation');
      const request = pool.request();
      for (const [name, value] of Object.entries(params)) request.input(name, value.type, value.value);
      const result = await request.query(text); raw = result.recordset; return result;
    };
    const source = await readNativeCostSource({ queryFn, types: sql, input: { orderYear: '2026', orderWeek: '44-01', warehouseKey: candidates.recordset[0].WarehouseKey } });
    if (source.country !== 'AU') throw Error('Not AU');
    fs.mkdirSync('outputs', { recursive: true });
    fs.writeFileSync('outputs/au-44-01-native-snapshot.json', JSON.stringify(raw, null, 2));
    console.log(JSON.stringify({ warehouseKey: source.warehouseKey, rows: source.lines.length, gw: source.gw, cw: source.cw, hash: source.sourceHash }));
  } finally { await pool.close(); }
})().catch(e => { console.error(e.code || e.message); process.exitCode = 1; });
