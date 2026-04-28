// 입고관리 원본 vs 운송원가탭 엑셀 출력값 단위 차이 비교
// 17-2 MEL (WK=5580) 실제 데이터로 검증
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach(line => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');

const WK = 5580;

(async () => {
  const pool = await sql.connect({
    server: process.env.DB_SERVER, port: parseInt(process.env.DB_PORT||'1433'),
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    options: { encrypt:false, trustServerCertificate:true, enableArithAbort:true, connectTimeout:30000, requestTimeout:60000 },
  });

  const r = await pool.request().query(`
    SELECT wd.WdetailKey, wd.ProdKey, wd.BoxQuantity, wd.BunchQuantity, wd.SteamQuantity, wd.OutQuantity,
           wd.UPrice, wd.TPrice,
           p.ProdName, p.FlowerName, p.OutUnit, p.SteamOf1Bunch, p.BunchOf1Box
    FROM WarehouseDetail wd LEFT JOIN Product p ON wd.ProdKey=p.ProdKey
    WHERE wd.WarehouseKey=${WK}
    ORDER BY wd.WdetailKey
  `);

  console.log(`# WK=${WK} (17-2 MEL Yunnan Melody) — 입고 원본 vs 엑셀 출력 비교\n`);
  console.log('| 품목 | OutUnit | DB Box | DB Bunch | DB Steam | DB UPrice | DB TPrice | 엑셀 E(수량) | 엑셀 F(FOB) | E×F | TPrice 일치? |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|');

  let mismatchCount = 0;
  for (const row of r.recordset) {
    if (!row.ProdName) continue;
    if (/Gross|Chargeable|운송료/i.test(row.ProdName)) continue;  // 특수행 제외

    const dbBox = Number(row.BoxQuantity)||0;
    const dbBunch = Number(row.BunchQuantity)||0;
    const dbSteam = Number(row.SteamQuantity)||0;
    const dbUPrice = Number(row.UPrice)||0;
    const dbTPrice = Number(row.TPrice)||0;
    const spb = Number(row.SteamOf1Bunch)||0;

    // 운송원가탭 엑셀 출력 (현재 코드 동작 시뮬)
    // resolveSteamQty: Steam>0이면 사용, 아니면 Bunch*SteamOf1Bunch
    let excelE = dbSteam;
    if (excelE <= 0 && dbBunch > 0 && spb > 0) excelE = dbBunch * spb;
    const excelF = dbUPrice;  // UPrice 그대로
    const excelI = excelE * excelF;
    const tPriceOK = Math.abs(excelI - dbTPrice) < 0.01;

    const name = (row.ProdName || '').substring(0, 30);
    const mark = tPriceOK ? '✅' : '❌';
    if (!tPriceOK) mismatchCount++;

    console.log(`| ${name} | ${row.OutUnit||'-'} | ${dbBox} | ${dbBunch} | ${dbSteam} | ${dbUPrice} | ${dbTPrice} | ${excelE} | ${excelF} | ${excelI} | ${mark} |`);
  }

  console.log(`\n## 요약: ${mismatchCount}건 단위 불일치 (E*F ≠ DB TPrice)\n`);
  console.log('## 진단:');
  console.log('- DB UPrice 단위 = OutUnit 기준 (단/송이/박스)');
  console.log('- DB TPrice = UPrice × OutQuantity (OutUnit 일관)');
  console.log('- 엑셀 E(수량) = SteamOf1Bunch 로 환산된 송이수 → 단 단위 품목에서 부풀려짐');
  console.log('- 엑셀 F(FOB) = DB UPrice 그대로 (단위 라벨링만 변경)');
  console.log('- 결과: E*F 가 DB TPrice 와 SteamOf1Bunch 배만큼 차이');

  await pool.close();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
