// Explicit read-only diagnostic. Never prints returned business rows or credentials.
const fs = require('node:fs');
const vm = require('node:vm');
const sql = require('mssql');
if (!process.env.AUDIT_PROBE_ENV) throw Error('AUDIT_PROBE_ENV_REQUIRED');
process.loadEnvFile(process.env.AUDIT_PROBE_ENV);
(async()=>{
  const pool = await sql.connect({server:process.env.DB_SERVER,port:Number(process.env.DB_PORT||1433),database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD,options:{encrypt:false,trustServerCertificate:true},pool:{max:1,min:0}});
  try {
    console.log('ShipmentHistory columns:', (await pool.request().query("SELECT name FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.ShipmentHistory') ORDER BY column_id")).recordset.map(r=>r.name).join(','));
    const source = fs.readFileSync(require.resolve('../pages/api/admin/activity.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default withAuth(','module.exports = withAuth(');
    const sandbox = {module:{exports:{}},withAuth:x=>x,sql,query:async (statement,params)=>{
      if (!/^\s*SELECT\b/i.test(statement) || /\b(INSERT|UPDATE|DELETE|MERGE|EXEC|ALTER|DROP)\b/i.test(statement)) throw Error('READ_ONLY_REQUIRED');
      const request=pool.request(); for(const [key,p] of Object.entries(params)) request.input(key,p.type,p.value);
      return request.query(statement);
    }};
    vm.runInNewContext(source,sandbox);
    for(const category of ['stock','order','shipment']){
      const res={status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
      await sandbox.module.exports({method:'GET',query:{startDate:'2026-11-04',endDate:'2026-11-04',category}},res);
      console.log(JSON.stringify({category,status:res.code,success:res.body?.success,count:res.body?.activities?.length}));
      if(res.code!==200) { console.log(String(res.body?.error).match(/(?:Invalid|Ambiguous) column name '[A-Za-z0-9_]+'/)?.[0] || 'HISTORY_READ_FAILED'); throw Error('HISTORY_READ_FAILED'); }
    }
  }finally{await pool.close();}
})().catch(()=>{console.error('READ_ONLY_PROBE_FAILED');process.exitCode=1;});
