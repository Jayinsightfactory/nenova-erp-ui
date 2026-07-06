#!/usr/bin/env node
/**
 * ShipmentDetail ↔ ShipmentDate Amount/Vat 불일치 복구 (레거시 수동용)
 * node scripts/repair-sdetail-date-amount.mjs [SdetailKey] [--dry-run]
 *
 * ⚠️ Detail.Amount 가 이미 틀린 경우(희경 740×Cost 유형) Date 를 Detail 로 맞추면 악화됨.
 *    먼저 Detail EstQuantity/Amount 가 exe 규칙(OutQuantity×EstUnit)과 맞는지 확인할 것.
 */
import fs from 'fs';
import path from 'path';
import sql from 'mssql';
import { withTransaction } from '../lib/db.js';
import { syncShipmentDateEstBySdetailKey, reconcileShipmentDateAmountsFromDetail } from '../lib/syncShipmentDateEst.js';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const SDKEY = parseInt(args.find(a => /^\d+$/.test(a)) || '79257', 10);

function loadEnv() {
  fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
  });
}

async function snapshot(pool, sdetailKey) {
  const sd = await pool.request().input('sk', sql.Int, sdetailKey).query(`
    SELECT sd.SdetailKey, c.CustName, sm.OrderWeek, p.ProdName,
      sd.Amount AS detailAmt, sd.Vat AS detailVat, sd.Cost, sd.OutQuantity,
      (SELECT SUM(ISNULL(sdd.Amount,0)) FROM ShipmentDate sdd WHERE sdd.SdetailKey=sd.SdetailKey) AS dateAmt,
      (SELECT SUM(ISNULL(sdd.Vat,0)) FROM ShipmentDate sdd WHERE sdd.SdetailKey=sd.SdetailKey) AS dateVat
    FROM ShipmentDetail sd
    JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
    JOIN Customer c ON c.CustKey = sm.CustKey
    LEFT JOIN Product p ON p.ProdKey = sd.ProdKey
    WHERE sd.SdetailKey = @sk`);
  return sd.recordset[0];
}

async function week26Gap(pool) {
  const r = await pool.request().input('pw', sql.NVarChar, '26').query(`
    SELECT
      SUM(sd.Amount) AS detailTotal,
      SUM(ISNULL(da.dateAmt,0)) AS dateTotal,
      SUM(sd.Amount - ISNULL(da.dateAmt,0)) AS gap
    FROM ShipmentDetail sd
    JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
    OUTER APPLY (SELECT SUM(sdd.Amount) dateAmt FROM ShipmentDate sdd WHERE sdd.SdetailKey=sd.SdetailKey) da
    WHERE sm.isDeleted = 0 AND sm.isFix = 1
      AND LEFT(sm.OrderWeek, CHARINDEX('-', sm.OrderWeek + '-') - 1) = @pw`);
  return r.recordset[0];
}

async function main() {
  loadEnv();
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, requestTimeout: 120000 },
  });

  const before = await snapshot(pool, SDKEY);
  if (!before) {
    console.error('SdetailKey not found:', SDKEY);
    process.exit(1);
  }

  const gapBefore = Number(before.detailAmt || 0) - Number(before.dateAmt || 0);
  console.log('=== BEFORE ===');
  console.log(before);
  console.log('row gap:', gapBefore);
  console.log('week26 gap:', await week26Gap(pool));

  if (Math.abs(gapBefore) < 1) {
    console.log('Already synced — nothing to do.');
    await pool.close();
    return;
  }

  if (DRY) {
    console.log('DRY RUN — no changes written');
    await pool.close();
    return;
  }

  const tx = new sql.Transaction(pool);
  await tx.begin();
  const tQ = async (text, params = {}) => {
    const req = new sql.Request(tx);
    for (const [name, { type, value }] of Object.entries(params)) {
      req.input(name, type, value);
    }
    return req.query(text);
  };

  try {
    let sync = await syncShipmentDateEstBySdetailKey(tQ, SDKEY, sql);
    console.log('sync result:', sync);

    const reconcile = await reconcileShipmentDateAmountsFromDetail(tQ, SDKEY, sql);
    console.log('reconcile result:', reconcile);
    if (reconcile.reconciled) {
      sync = { ...sync, mode: reconcile.mode, reconciled: reconcile };
    }

    await tQ(
      `UPDATE ShipmentDetail
          SET Descr = LEFT(ISNULL(Descr, N'') + @note, 4000)
        WHERE SdetailKey = @sk`,
      {
        sk: { type: sql.Int, value: SDKEY },
        note: {
          type: sql.NVarChar,
          value: `\r\n[repair] ShipmentDate Amt sync ${before.dateAmt}→${before.detailAmt}`,
        },
      },
    );

    const histDescr = `출고일금액 동기화 ${before.dateAmt}→${before.detailAmt}`;
    await tQ(
      `INSERT INTO ShipmentHistory (SdetailKey, ShipmentDtm, ChangeType, BeforeValue, AfterValue, Descr, ChangeID, ChangeDtm)
       SELECT @sk, sd.ShipmentDtm, N'수정', @before, @after, @descr, N'repair-script', GETDATE()
       FROM ShipmentDetail sd WHERE sd.SdetailKey = @sk`,
      {
        sk: { type: sql.Int, value: SDKEY },
        before: { type: sql.NVarChar, value: String(before.dateAmt || 0) },
        after: { type: sql.NVarChar, value: String(before.detailAmt) },
        descr: { type: sql.NVarChar, value: histDescr },
      },
    );

    await tx.commit();
    console.log('COMMIT OK');
  } catch (e) {
    await tx.rollback();
    throw e;
  }

  const after = await snapshot(pool, SDKEY);
  console.log('=== AFTER ===');
  console.log(after);
  console.log('row gap:', Number(after.detailAmt || 0) - Number(after.dateAmt || 0));
  console.log('week26 gap:', await week26Gap(pool));

  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
