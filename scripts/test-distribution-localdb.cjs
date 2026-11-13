// Explicit local-only adapter for the existing real-MSSQL downstream fixture.
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
for(const key of ['DB_SERVER','DB_PORT','DB_NAME','DB_USER','DB_PASSWORD'])assert.ok(!process.env[key],'Operational environment forbidden');
const cli='C:/Program Files/Microsoft SQL Server/160/Tools/Binn/SqlLocalDB.exe';
const info=spawnSync(cli,['info','NenovaErpFixture'],{encoding:'utf8',windowsHide:true});
assert.equal(info.status,0,'Dedicated LocalDB instance must already exist');
const base=require('mssql');
const native=require('mssql/msnodesqlv8');
const Pool=native.ConnectionPool;
native.ConnectionPool=class extends Pool{
  constructor(config){
    assert.equal(config.server,'127.0.0.1');assert.equal(config.port,14339);
    assert.ok(config.database==='master'||/^NenovaEstimateFixture_\d{8}_[a-f0-9]{8}$/.test(config.database),'Fixture database only');
    super({connectionString:`Driver={ODBC Driver 18 for SQL Server};Server=(localdb)\\NenovaErpFixture;Database=${config.database};Trusted_Connection=Yes;TrustServerCertificate=Yes;`,options:{trustedConnection:true}});
  }
};
require.cache[require.resolve('mssql')].exports=native;
const fixture=require('./test-weekday-distribution-sql.cjs');
fixture.inspectFixture=()=>({password:'local-windows-auth-no-password',image:'LocalDB-16-dedicated-fixture'});
console.log('Dedicated LocalDB fixture: Windows authentication, no operational endpoint, temporary guarded DB');
require(process.argv.includes('--fix-cycle')?'./test-distribution-refix-sql.cjs':'./test-distribution-catalog-downstream-sql.cjs');
