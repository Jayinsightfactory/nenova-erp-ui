#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import sql from 'mssql';

const PW = process.argv[2] || '26';

function loadEnv() {
  const p = path.join(process.cwd(), '.env.local');
  fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
  });
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

  const parentFilter = `LEFT(sm.OrderWeek, CHARINDEX('-', sm.OrderWeek + '-') - 1) = @pw`;

  const weeks = await pool.request().input('pw', sql.NVarChar, PW).query(`
    SELECT DISTINCT OrderWeek FROM ShipmentMaster sm
    WHERE sm.isDeleted = 0 AND ${parentFilter.replace(/sm\./g, 'sm.')}
    ORDER BY OrderWeek`);

  const estimateExeStyle = await pool.request().input('pw', sql.NVarChar, PW).query(`
    SELECT
      SUM(ship) AS shipDateAmtVat,
      SUM(est) AS estimateAmtVat,
      SUM(ship + est) AS total
    FROM (
      SELECT sm.ShipmentKey,
        ISNULL((SELECT SUM(ISNULL(sdd.Amount,0)+ISNULL(sdd.Vat,0))
          FROM ShipmentDetail sd JOIN ShipmentDate sdd ON sdd.SdetailKey = sd.SdetailKey
          WHERE sd.ShipmentKey = sm.ShipmentKey), 0) AS ship,
        ISNULL((SELECT SUM(ISNULL(e.Amount,0)+ISNULL(e.Vat,0))
          FROM Estimate e WHERE e.ShipmentKey = sm.ShipmentKey), 0) AS est
      FROM ShipmentMaster sm
      WHERE sm.isDeleted = 0 AND sm.isFix = 1 AND ${parentFilter}
    ) x`);

  const salesDefectShip = await pool.request().input('pw', sql.NVarChar, PW).query(`
    SELECT SUM(sd.Amount) AS shipmentDetailAmount
    FROM ShipmentDetail sd
    JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
    WHERE sm.isDeleted = 0 AND ${parentFilter}`);

  const salesDefectEst = await pool.request().input('pw', sql.NVarChar, PW).query(`
    SELECT SUM(e.Amount) AS estimateAmountOnly
    FROM Estimate e
    JOIN ShipmentMaster sm ON e.ShipmentKey = sm.ShipmentKey
    WHERE sm.isDeleted = 0 AND ${parentFilter}`);

  const webListCostQty = await pool.request().input('pw', sql.NVarChar, PW).query(`
    SELECT SUM(ISNULL(p.Cost,0) * CASE WHEN sd.BunchQuantity > 0 THEN sd.BunchQuantity
      WHEN sd.SteamQuantity > 0 THEN sd.SteamQuantity ELSE sd.BoxQuantity END) AS productCostTimesQty
    FROM ShipmentDetail sd
    JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
    LEFT JOIN Product p ON p.ProdKey = sd.ProdKey
    WHERE sm.isDeleted = 0 AND sm.isFix = 1 AND ${parentFilter}`);

  const sdAmtVat = await pool.request().input('pw', sql.NVarChar, PW).query(`
    SELECT SUM(ISNULL(sd.Amount,0)+ISNULL(sd.Vat,0)) AS sdAmountVat
    FROM ShipmentDetail sd
    JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
    WHERE sm.isDeleted = 0 AND sm.isFix = 1 AND ${parentFilter}`);

  // per sub-week like sales API exact match
  for (const wk of weeks.recordset.map(r => r.OrderWeek)) {
    const r = await pool.request().input('wk', sql.NVarChar, wk).query(`
      SELECT @wk AS week, SUM(sd.Amount) AS sdAmount
      FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
      WHERE sm.isDeleted = 0 AND sm.OrderWeek = @wk`);
    console.log('sub-week sales-analysis:', r.recordset[0]);
  }

  console.log('parent week:', PW);
  console.log('sub weeks:', weeks.recordset.map(r => r.OrderWeek));
  console.log('estimate exe style (ShipmentDate Amt+Vat + Estimate Amt+Vat, isFix=1):', estimateExeStyle.recordset[0]);
  console.log('sales/defect ship (ShipmentDetail.Amount only, all weeks):', salesDefectShip.recordset[0]);
  console.log('sales/defect estimate (Estimate.Amount only):', salesDefectEst.recordset[0]);
  console.log('sales/defect grand (ship+est Amount only):',
    Number(salesDefectShip.recordset[0]?.shipmentDetailAmount || 0)
    + Number(salesDefectEst.recordset[0]?.estimateAmountOnly || 0));
  console.log('web estimate list (Product.Cost*qty):', webListCostQty.recordset[0]);
  console.log('ShipmentDetail Amount+Vat isFix=1:', sdAmtVat.recordset[0]);

  const sdFixAmtOnly = await pool.request().input('pw', sql.NVarChar, PW).query(`
    SELECT SUM(sd.Amount) AS amt, SUM(sd.Vat) AS vat
    FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
    WHERE sm.isDeleted = 0 AND sm.isFix = 1 AND ${parentFilter}`);
  console.log('ShipmentDetail Amount/Vat isFix=1:', sdFixAmtOnly.recordset[0]);

  const shipDateAmtOnly = await pool.request().input('pw', sql.NVarChar, PW).query(`
    SELECT SUM(ISNULL(sdd.Amount,0)) AS shipDateAmountOnly,
           SUM(ISNULL(sdd.Amount,0)+ISNULL(sdd.Vat,0)) AS shipDateAmtVat
    FROM ShipmentDetail sd
    JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
    JOIN ShipmentDate sdd ON sdd.SdetailKey = sd.SdetailKey
    WHERE sm.isDeleted = 0 AND sm.isFix = 1 AND ${parentFilter}`);
  console.log('ShipmentDate Amount only (isFix=1):', shipDateAmtOnly.recordset[0]);
  console.log('gap ShipmentDate.Amount - ShipmentDetail.Amount:',
    Number(shipDateAmtOnly.recordset[0]?.shipDateAmountOnly || 0)
    - Number(sdFixAmtOnly.recordset[0]?.amt || 0));

  const exeViewShip = await pool.request().input('pw', sql.NVarChar, PW).query(`
    SELECT SUM(ISNULL(sdd.Amount,0)) AS amt
    FROM ViewShipment vs
    JOIN ShipmentMaster sm ON vs.ShipmentKey = sm.ShipmentKey
    JOIN ShipmentDate sdd ON sdd.SdetailKey = vs.SdetailKey
    JOIN PeriodDay pd ON sdd.ShipmentDtm = pd.BaseYmd
    WHERE sm.isDeleted = 0 AND sm.isFix = 1 AND ${parentFilter}
      AND ISNULL(vs.OutQuantity,0) > 0`);
  console.log('exe ViewShipment+PeriodDay ShipmentDate.Amount:', exeViewShip.recordset[0]);
  console.log('gap exe view - ShipmentDetail.Amount:',
    Number(exeViewShip.recordset[0]?.amt || 0) - Number(sdFixAmtOnly.recordset[0]?.amt || 0));

  const unfixedAmt = await pool.request().input('pw', sql.NVarChar, PW).query(`
    SELECT SUM(sd.Amount) AS amt FROM ShipmentDetail sd
    JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
    WHERE sm.isDeleted = 0 AND ISNULL(sm.isFix,0)=0 AND ${parentFilter}`);
  console.log('unfixed ShipmentDetail.Amount:', unfixedAmt.recordset[0]);

  const detailVsDateMismatch = await pool.request().input('pw', sql.NVarChar, PW).query(`
    SELECT TOP 15 c.CustName, sd.SdetailKey,
      sd.Amount AS detailAmt,
      (SELECT SUM(ISNULL(sdd.Amount,0)) FROM ShipmentDate sdd WHERE sdd.SdetailKey=sd.SdetailKey) AS dateAmt,
      sd.Amount - ISNULL((SELECT SUM(ISNULL(sdd.Amount,0)) FROM ShipmentDate sdd WHERE sdd.SdetailKey=sd.SdetailKey),0) AS diff
    FROM ShipmentDetail sd
    JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
    JOIN Customer c ON c.CustKey = sm.CustKey
    WHERE sm.isDeleted = 0 AND sm.isFix = 1 AND ${parentFilter}
      AND ABS(sd.Amount - ISNULL((SELECT SUM(ISNULL(sdd.Amount,0)) FROM ShipmentDate sdd WHERE sdd.SdetailKey=sd.SdetailKey),0)) > 0
    ORDER BY ABS(sd.Amount - ISNULL((SELECT SUM(ISNULL(sdd.Amount,0)) FROM ShipmentDate sdd WHERE sdd.SdetailKey=sd.SdetailKey),0)) DESC`);
  console.log('top detail vs date Amount mismatches:', detailVsDateMismatch.recordset);

  const gapBreakdown = await pool.request().input('pw', sql.NVarChar, PW).query(`
    SELECT
      SUM(sd.Amount) AS detailTotal,
      SUM(ISNULL(da.dateAmt, 0)) AS dateTotal,
      SUM(sd.Amount - ISNULL(da.dateAmt, 0)) AS gap,
      SUM(CASE WHEN da.dateCnt = 0 THEN sd.Amount ELSE 0 END) AS noShipmentDateAmt,
      COUNT(CASE WHEN da.dateCnt = 0 THEN 1 END) AS noShipmentDateRows
    FROM ShipmentDetail sd
    JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
    OUTER APPLY (
      SELECT SUM(ISNULL(sdd.Amount, 0)) AS dateAmt, COUNT(*) AS dateCnt
      FROM ShipmentDate sdd WHERE sdd.SdetailKey = sd.SdetailKey
    ) da
    WHERE sm.isDeleted = 0 AND sm.isFix = 1 AND ${parentFilter}`);
  console.log('gap breakdown detail vs ShipmentDate:', gapBreakdown.recordset[0]);

  const gapSign = await pool.request().input('pw', sql.NVarChar, PW).query(`
    SELECT
      SUM(CASE WHEN sd.Amount > ISNULL(da.dateAmt,0) THEN sd.Amount - ISNULL(da.dateAmt,0) ELSE 0 END) AS detailHigher,
      SUM(CASE WHEN ISNULL(da.dateAmt,0) > sd.Amount THEN ISNULL(da.dateAmt,0) - sd.Amount ELSE 0 END) AS dateHigher,
      COUNT(CASE WHEN ABS(sd.Amount - ISNULL(da.dateAmt,0)) > 1 THEN 1 END) AS mismatchRows
    FROM ShipmentDetail sd
    JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
    OUTER APPLY (SELECT SUM(ISNULL(sdd.Amount,0)) dateAmt FROM ShipmentDate sdd WHERE sdd.SdetailKey=sd.SdetailKey) da
    WHERE sm.isDeleted = 0 AND sm.isFix = 1 AND ${parentFilter}`);
  console.log('gap direction:', gapSign.recordset[0]);

  const bigMismatch = await pool.request().input('pw', sql.NVarChar, PW).query(`
    SELECT c.CustName, sm.OrderWeek, sd.SdetailKey, p.ProdName,
      sd.Amount AS detailAmt, sd.Vat AS detailVat,
      sd.BoxQuantity, sd.BunchQuantity, sd.SteamQuantity, sd.OutQuantity,
      (SELECT SUM(sdd.Amount) FROM ShipmentDate sdd WHERE sdd.SdetailKey=sd.SdetailKey) AS dateAmt,
      sd.Amount - ISNULL((SELECT SUM(sdd.Amount) FROM ShipmentDate sdd WHERE sdd.SdetailKey=sd.SdetailKey),0) AS diff
    FROM ShipmentDetail sd
    JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
    JOIN Customer c ON c.CustKey = sm.CustKey
    LEFT JOIN Product p ON p.ProdKey = sd.ProdKey
    WHERE sm.isDeleted = 0 AND sm.isFix = 1 AND ${parentFilter}
      AND ABS(sd.Amount - ISNULL((SELECT SUM(sdd.Amount) FROM ShipmentDate sdd WHERE sdd.SdetailKey=sd.SdetailKey),0)) > 1
    ORDER BY ABS(sd.Amount - ISNULL((SELECT SUM(sdd.Amount) FROM ShipmentDate sdd WHERE sdd.SdetailKey=sd.SdetailKey),0)) DESC`);
  console.log('big mismatch rows:', bigMismatch.recordset);

  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
