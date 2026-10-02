// Explicit operating SELECT-only probe. No apply, leases, DDL or ERP writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import sql from 'mssql';
import { readWeekdayCalendar } from '../lib/weekdayDistributionApply.js';

const envFile = process.env.NENOVA_PROBE_ENV_FILE;
assert.ok(envFile, 'Set NENOVA_PROBE_ENV_FILE explicitly; credentials are never printed.');
const env = {};
for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
}
const pool = await sql.connect({
  server: env.DB_SERVER, port: Number(env.DB_PORT || 1433), database: env.DB_NAME,
  user: env.DB_USER, password: env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true }, requestTimeout: 30000,
});
try {
  const select = async (statement, params = {}) => {
    assert.match(statement.trim(), /^SELECT\b/i);
    assert.doesNotMatch(statement, /\b(INSERT|UPDATE|DELETE|MERGE|EXEC|CREATE|ALTER|DROP|TRUNCATE)\b/i);
    const request = pool.request();
    for (const [key, spec] of Object.entries(params)) request.input(key, spec.type, spec.value);
    return request.query(statement);
  };
  const schema = await select(`SELECT TABLE_NAME,COLUMN_NAME,DATA_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE (TABLE_NAME='PeriodDay' AND COLUMN_NAME='BaseYmd')
       OR (TABLE_NAME='ShipmentDate' AND COLUMN_NAME='ShipmentDtm')`);
  const identity = { year: '2026', orderWeek: '40-01', custKey: 533, prodKey: 866 };
  const params = { yr: { type: sql.NVarChar, value: identity.year },
    wk: { type: sql.NVarChar, value: identity.orderWeek },
    ck: { type: sql.Int, value: identity.custKey }, pk: { type: sql.Int, value: identity.prodKey } };
  const actual = await select(`SELECT sd.SdetailKey,sd.OutQuantity,sd.Amount,sd.Vat,sd.isFix,
    d.SdateKey,d.ShipmentQuantity,CONVERT(nvarchar(10),d.ShipmentDtm,120) [Date],
    CONVERT(nvarchar(23),d.ShipmentDtm,121) [Timestamp],pd.WeekDay
    FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
    JOIN ShipmentDate d ON d.SdetailKey=sd.SdetailKey
    LEFT JOIN PeriodDay pd ON pd.BaseYmd=d.ShipmentDtm
    WHERE sm.OrderYear=@yr AND sm.OrderWeek=@wk AND sm.CustKey=@ck AND sd.ProdKey=@pk
      AND ISNULL(sm.isDeleted,0)=0`, params);
  assert.ok(actual.recordset.length, 'Target shipment missing; stop instead of inferring.');
  const change = { ...identity, dates: [{ date: '2026-10-04', quantity: 15 }, { date: '2026-10-01', quantity: 5 }] };
  const calendar = await readWeekdayCalendar(select, sql, change, {
    shipmentDates: actual.recordset.map(row => ({ date: row.Date, timestamp: row.Timestamp })),
  });
  for (const row of actual.recordset) {
    assert.equal(calendar.get(row.Date).timestamp, row.Timestamp);
    assert.ok(row.WeekDay, 'Existing EXE exact JOIN must match.');
  }
  const views = await select(`SELECT
    (SELECT COUNT(*) FROM ViewOrder WHERE OrderYear=@yr AND OrderWeek=@wk AND CustKey=@ck AND ProdKey=@pk) ViewOrderRows,
    (SELECT COUNT(*) FROM ViewShipment WHERE OrderYear=@yr AND OrderWeek=@wk AND CustKey=@ck AND ProdKey=@pk) ViewShipmentRows,
    (SELECT COUNT(*) FROM ShipmentFarm sf JOIN ShipmentDetail sd ON sd.SdetailKey=sf.SdetailKey
       JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey
       WHERE sm.OrderYear=@yr AND sm.OrderWeek=@wk AND sm.CustKey=@ck AND sd.ProdKey=@pk
         AND ISNULL(sm.isDeleted,0)=0) FarmRows,
    (SELECT COUNT(*) FROM ViewShipment vs JOIN ViewOrder vo ON vo.OrderYear=vs.OrderYear
       AND vo.OrderWeek=vs.OrderWeek AND vo.CustKey=vs.CustKey AND vo.ProdKey=vs.ProdKey
       JOIN ShipmentDate d ON d.SdetailKey=vs.SdetailKey JOIN PeriodDay pd ON pd.BaseYmd=d.ShipmentDtm
       WHERE vs.OrderYear=@yr AND vs.OrderWeek=@wk AND vs.CustKey=@ck AND vs.ProdKey=@pk
         AND vs.DetailFix=1) EstimateVisibleRows`, params);
  console.log(JSON.stringify({ readOnly: true, sharedCalendarPassed: true, schema: schema.recordset,
    scope: identity, actual: actual.recordset, calendar: [...calendar.values()], downstream: views.recordset }));
} finally {
  await pool.close();
}
