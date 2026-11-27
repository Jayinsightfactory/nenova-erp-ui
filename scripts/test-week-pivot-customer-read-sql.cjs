// Uses only the approved unmounted loopback fixture and drops its own temporary database.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const sql = require('mssql');
const fixture = require('./test-weekday-distribution-sql.cjs');

function customerQuery(productKey) {
  const source = fs.readFileSync(path.join(__dirname, '../pages/api/shipment/stock-status.js'), 'utf8');
  const block = source.split("if (view === 'customers')")[1].split('const shipmentOnly')[0];
  return block.match(/const result = await query\(\s*`([\s\S]+?)`,/)[1]
    .replace('${pkFilter}', productKey ? 'AND od.ProdKey = @pk' : '')
    .replaceAll('${shipmentProductFilter}', productKey ? 'AND sd.ProdKey=@pk' : '');
}

async function main() {
  for (const name of ['DB_SERVER', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']) assert(!process.env[name]);
  const { password } = fixture.inspectFixture();
  const suffix = crypto.randomBytes(4).toString('hex');
  const name = `NenovaEstimateFixture_${new Date().toISOString().slice(0,10).replace(/-/g,'')}_${suffix}`;
  fixture.assertDbName(name);
  const config = { server:'127.0.0.1', port:14339, user:'sa', password, options:{ encrypt:false, trustServerCertificate:true } };
  let master, pool;
  try {
    master = await new sql.ConnectionPool({ ...config, database:'master' }).connect();
    await fixture.query(master, `CREATE DATABASE ${fixture.bracket(name)}`);
    pool = await new sql.ConnectionPool({ ...config, database:name }).connect();
    await fixture.installSchema(pool);
    await fixture.seed(pool);
    await fixture.query(pool, `
      ALTER TABLE Customer ADD CustArea nvarchar(100), Descr nvarchar(1000);
      ALTER TABLE Product ADD DisplayName nvarchar(100);
      INSERT OrderMaster(OrderMasterKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,Manager)
        VALUES(3703,N'2025',N'37-01',N'202537',533,N'fixture-user');
      INSERT OrderDetail(OrderDetailKey,OrderMasterKey,CustKey,ProdKey,BoxQuantity,OutQuantity)
        VALUES(3703,3703,533,866,99,99);
      INSERT ShipmentMaster(ShipmentKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,isFix,isDeleted,CreateID)
        VALUES(6268,N'2025',N'37-01',N'202537',533,0,0,N'fixture-user'),
              (6269,N'2026',N'37-01',N'202637',533,0,0,N'fixture-user'),
              (6270,N'2026',N'37-01',N'202637',533,0,1,N'fixture-user');
      INSERT ShipmentDetail(SdetailKey,ShipmentKey,CustKey,ProdKey,ShipmentDtm,OutQuantity,EstQuantity,
          BoxQuantity,BunchQuantity,SteamQuantity,Cost,Amount,Vat,Descr,isFix)
        VALUES(89893,6268,533,866,'2025-09-11',99,99,99,0,0,2000,0,0,N'prior-year detail',0),
              (89894,6269,533,866,'2026-09-11',7,7,7,0,0,3000,0,0,N'extra detail',0),
              (89895,6270,533,866,'2026-09-12',9,9,9,0,0,9900,0,0,N'deleted master detail',0);
    `);
    const read = async (year, product) => (await fixture.query(pool, customerQuery(product), {
      orderYear:{ type:sql.NVarChar, value:year }, weekFrom:{ type:sql.NVarChar, value:'37-01' },
      weekTo:{ type:sql.NVarChar, value:'37-02' }, ...(product ? { pk:{ type:sql.Int, value:product } } : {}),
    })).recordset;
    const current = await read('2026');
    assert.equal(current.length, 2);
    const [first, second] = current;
    assert.equal(first.OrderWeek, '37-01');
    assert.equal(first.custOrderQty, 25);
    assert.equal(first.outQty, 32);
    assert.equal(first.totalOutQty, 32);
    assert.equal(first.UnitCost, 3000);
    assert.equal(first.SdetailKey, 89892);
    assert.equal(first.isFix, 1);
    assert.equal(first.outCreateDtm, '2026-09-11 00:00');
    assert.deepEqual(first.outDescr.split('\n').sort(), ['extra detail','fixture detail']);
    assert.equal(second.OrderWeek, '37-02');
    assert.equal(second.outQty, 0);
    assert.equal(second.outDescr, '');
    assert.deepEqual(await read('2026', 866), current);
    const prior = await read('2025');
    assert.equal(prior.length, 1);
    assert.equal(prior[0].outQty, 99);
    assert.equal(prior[0].totalOutQty, 99);
    assert.equal(prior[0].outDescr, 'prior-year detail');
    console.log('Week pivot customer SQL passed for current/prior year, product scope, inactive masters and multiple notes.');
  } finally {
    await pool?.close();
    if (master) {
      fixture.assertDbName(name);
      await fixture.query(master, `IF DB_ID(N'${name}') IS NOT NULL BEGIN
        ALTER DATABASE ${fixture.bracket(name)} SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
        DROP DATABASE ${fixture.bracket(name)}; END`);
      await master.close();
    }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
