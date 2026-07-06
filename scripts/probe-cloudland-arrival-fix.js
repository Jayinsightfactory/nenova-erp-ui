/** Cloudland GW/CW OutQuantity fix + 도착원가 live 계산 스모크 테스트 */
const fs = require('fs');
const path = require('path');
const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
env.split(/\r?\n/).forEach(l => {
  const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});

(async () => {
  const fc = await import('../lib/freightCalc.js');
  const row = { ProdName: 'Chargeable weight', BoxQuantity: 0, BunchQuantity: 1, SteamQuantity: 0, OutQuantity: 475 };
  const w = fc.freightWeightOfRow(row);
  console.log('freightWeightOfRow(Cloudland CW):', w, w === 475 ? 'OK' : 'FAIL');

  const sql = require('mssql');
  const pool = await sql.connect({
    server: process.env.DB_SERVER, port: 1433, database: process.env.DB_NAME,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true },
  });

  const awb = '99993212291';
  const dRes = await pool.request().input('a', sql.NVarChar, awb).query(`
    SELECT wd.*, wm.FarmName, p.ProdName, p.FlowerName, p.CounName, p.SteamOf1Bunch, p.Cost, p.OutUnit,
           p.BoxWeight AS P_BoxWeight, p.BoxCBM AS P_BoxCBM, p.TariffRate AS P_TariffRate
    FROM WarehouseDetail wd
    JOIN WarehouseMaster wm ON wd.WarehouseKey=wm.WarehouseKey
    LEFT JOIN Product p ON wd.ProdKey=p.ProdKey
    WHERE REPLACE(REPLACE(wm.OrderNo,'-',''),' ','')=@a
  `);

  const allRows = dRes.recordset;
  const freightRows = allRows.filter(r => fc.isFreightRow(r));
  const rows = allRows.filter(r => !fc.isFreightRow(r));
  const gwRows = freightRows.filter(r => fc.isGrossWeightItem(r.ProdName));
  const cwRows = freightRows.filter(r => fc.isChargeableWeightItem(r.ProdName));
  const gw = gwRows.reduce((a, r) => a + fc.freightWeightOfRow(r), 0);
  const cw = cwRows.reduce((a, r) => a + fc.freightWeightOfRow(r), 0);
  console.log(`Cloudland AWB GW=${gw} CW=${cw}`);

  const freightMain = freightRows.find(r => Number(r.UPrice) > 0);
  const actualFreight = freightRows.reduce((a, r) => a + (Number(r.TPrice) || Number(r.UPrice) || 0), 0);
  const curRes = await pool.request().query(`SELECT CurrencyCode, ExchangeRate FROM CurrencyMaster WHERE IsActive=1`);
  const currencyRates = { KRW: 1 };
  for (const c of curRes.recordset) currencyRates[c.CurrencyCode] = Number(c.ExchangeRate) || 0;
  const invoiceCurrency = fc.detectInvoiceCurrency(rows.map(r => ({ counName: r.CounName })));

  const fRes = await pool.request().query(`SELECT FlowerName, BoxWeight, BoxCBM, StemsPerBox, DefaultTariff FROM Flower WHERE isDeleted=0`);
  const flowerMeta = {};
  for (const f of fRes.recordset) {
    flowerMeta[fc.normalizeFlower(f.FlowerName)] = {
      boxWeight: f.BoxWeight != null ? Number(f.BoxWeight) : null,
      boxCBM: f.BoxCBM != null ? Number(f.BoxCBM) : null,
      stemsPerBox: f.StemsPerBox != null ? Number(f.StemsPerBox) : null,
      defaultTariff: f.DefaultTariff != null ? Number(f.DefaultTariff) : null,
    };
  }

  const itemCount = [...new Set(rows.map(r => (r.FlowerName || '').trim()))].filter(Boolean).length;
  const details = rows.filter(r => Number(r.OutQuantity) > 0).slice(0, 3).map(r => ({
    prodKey: r.ProdKey,
    prodName: r.ProdName,
    flowerName: (r.FlowerName || '').trim(),
    counName: r.CounName,
    boxQty: Number(r.BoxQuantity) || 0,
    rawBoxQty: Number(r.BoxQuantity) || 0,
    bunchQty: Number(r.BunchQuantity) || 0,
    steamQty: Number(r.SteamQuantity) || Number(r.BunchQuantity) || Number(r.OutQuantity) || 0,
    fobUSD: Number(r.UPrice) || 0,
    stemsPerBunch: Number(r.SteamOf1Bunch) || 0,
  }));

  const calc = fc.computeFreightCost({
    master: {
      gw, cw,
      rateUSD: freightMain ? Number(freightMain.UPrice) : 0,
      docFeeUSD: 0,
      exchangeRate: currencyRates[invoiceCurrency] || currencyRates.CNY || 0,
      invoiceUSD: rows.reduce((a, r) => a + (Number(r.TPrice) || 0), 0),
      itemCount,
      actualFreightUSD: actualFreight > 0 ? actualFreight : null,
    },
    customs: { bakSangRate: 460, handlingFee: 33000, quarantinePerItem: 10000, domesticFreight: 99000, deductFee: 40000, extraFee: 0 },
    details,
    flowerMeta,
  });

  console.log('\nCloudland sample arrival (live):');
  calc.rows.forEach(r => console.log(`  ${r.prodName}: ${Math.round(r.displayArrivalKRW)}원/${r.displayUnit}`));
  console.log('warnings:', calc.warnings?.filter(w => w.level === 'error').map(w => w.msg).join('; ') || 'none');

  await pool.close();
  process.exit(gw > 0 && cw > 0 && calc.rows.some(r => r.displayArrivalKRW > 0) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
