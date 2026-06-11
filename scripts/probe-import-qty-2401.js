// 읽기 전용 진단: 주광 × 24-01 × 장미(rose) 품목의 DB 출고/주문 수량을
// 같은 거래처·품목의 다른 차수 중앙값과 비교해 BunchOf1Box(박스당 단수)배 ≈ 10배 의심 행을 출력.
//
// 배경: 엑셀 재업로드 시 DB 주문·분배·엑셀이 모두 10배로 동일하면 인-파일 baseline(주문/분배/엑셀주문)이
//       전부 50 으로 일치해 경고가 안 잡힌다(주광 단독주문이면 prodKey peer 도 없음).
//       이런 케이스는 "다른 차수 대비 10배" 라는 DB 히스토리로만 진단 가능 → 본 스크립트가 그 역할.
//
// 실행: node scripts/probe-import-qty-2401.js [차수=24-01] [업체명=주광]
//   DB 자격증명은 .env.local 또는 환경변수(DB_SERVER/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD)에서 읽음.
//   ⚠️ SELECT 전용. UPDATE/DELETE/INSERT 없음(운영 DB 무수정).

const fs = require('fs');
const path = require('path');

const envFile = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  });
}

const WEEK = (process.argv[2] || '24-01').trim();
const CUST = (process.argv[3] || '주광').trim();

function median(values) {
  const nums = values.filter((v) => Number(v) > 0).map(Number).sort((a, b) => a - b);
  if (!nums.length) return 0;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

(async () => {
  if (!process.env.DB_SERVER || !process.env.DB_USER) {
    console.error('DB 자격증명 없음 (.env.local 또는 DB_SERVER/DB_USER 환경변수 필요). 운영 GET API 로 대체 진단하세요:');
    console.error('  https://nenovaweb.com/api/shipment/distribute-diagnose?week=' + encodeURIComponent(WEEK));
    process.exit(2);
  }

  const sql = require('mssql');
  const pool = await sql.connect({
    server: process.env.DB_SERVER, port: parseInt(process.env.DB_PORT || '1433'),
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true, connectTimeout: 30000, requestTimeout: 60000 },
  });

  const ROSE = `(p.FlowerName LIKE '%rose%' OR p.ProdName LIKE '%rose%' OR p.FlowerName LIKE N'%장미%' OR p.ProdName LIKE N'%장미%')`;

  // 1) 대상 거래처
  const custRes = await pool.request()
    .input('cust', sql.NVarChar, `%${CUST}%`)
    .query(`SELECT CustKey, CustName FROM Customer WHERE ISNULL(isDeleted,0)=0 AND CustName LIKE @cust ORDER BY CustKey`);
  if (!custRes.recordset.length) { console.error(`거래처 '${CUST}' 없음`); await pool.close(); process.exit(1); }
  const custKeys = custRes.recordset.map((c) => c.CustKey);
  console.log(`# ${CUST} × ${WEEK} × 장미 — 10배(BunchOf1Box) 의심 진단 (읽기 전용)\n`);
  console.log(`대상 거래처: ${custRes.recordset.map((c) => `${c.CustName}(${c.CustKey})`).join(', ')}\n`);

  const ckList = custKeys.join(',');

  // 2) 24-01 출고분배 + 주문 수량 (박스 기준)
  const curRes = await pool.request().input('week', sql.NVarChar, WEEK).query(`
    SELECT sd.ProdKey, p.ProdName, p.OutUnit, ISNULL(p.BunchOf1Box,0) AS BunchOf1Box,
           SUM(ISNULL(sd.BoxQuantity, ISNULL(sd.OutQuantity,0))) AS shipBox,
           SUM(ISNULL(sd.OutQuantity,0)) AS outQty
      FROM ShipmentMaster sm
      JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
      JOIN Product p ON p.ProdKey = sd.ProdKey
     WHERE sm.CustKey IN (${ckList}) AND sm.OrderWeek=@week AND ISNULL(sm.isDeleted,0)=0 AND ${ROSE}
     GROUP BY sd.ProdKey, p.ProdName, p.OutUnit, p.BunchOf1Box`);

  const ordRes = await pool.request().input('week', sql.NVarChar, WEEK).query(`
    SELECT od.ProdKey, SUM(ISNULL(od.BoxQuantity, ISNULL(od.OutQuantity,0))) AS orderBox
      FROM OrderMaster om
      JOIN OrderDetail od ON od.OrderMasterKey = om.OrderMasterKey AND ISNULL(od.isDeleted,0)=0
      JOIN Product p ON p.ProdKey = od.ProdKey
     WHERE om.CustKey IN (${ckList}) AND om.OrderWeek=@week AND ISNULL(om.isDeleted,0)=0 AND ${ROSE}
     GROUP BY od.ProdKey`);
  const orderByProd = new Map(ordRes.recordset.map((r) => [Number(r.ProdKey), Number(r.orderBox) || 0]));

  if (!curRes.recordset.length) { console.log(`(${WEEK} 장미 출고분배 없음)`); await pool.close(); return; }

  // 3) 다른 차수 같은 거래처·품목 박스수 → 차수별 합계 후 중앙값
  const prodKeys = curRes.recordset.map((r) => Number(r.ProdKey));
  const histRes = await pool.request().input('week', sql.NVarChar, WEEK).query(`
    SELECT sm.OrderWeek, sd.ProdKey, SUM(ISNULL(sd.BoxQuantity, ISNULL(sd.OutQuantity,0))) AS shipBox
      FROM ShipmentMaster sm
      JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
     WHERE sm.CustKey IN (${ckList}) AND sm.OrderWeek<>@week AND ISNULL(sm.isDeleted,0)=0
       AND sd.ProdKey IN (${prodKeys.join(',')})
     GROUP BY sm.OrderWeek, sd.ProdKey`);
  const histByProd = new Map();
  for (const r of histRes.recordset) {
    const pk = Number(r.ProdKey);
    if (!histByProd.has(pk)) histByProd.set(pk, []);
    histByProd.get(pk).push(Number(r.shipBox) || 0);
  }

  // 같은 차수 내 다른 장미 박스 중앙값(주광 단독주문 품목용 동료 비교)
  const sameWeekBox = curRes.recordset.map((r) => Number(r.shipBox) || 0);

  console.log('| 품목 | OutUnit | B1B | 24-01 출고박스 | DB주문박스 | 타차수중앙값 | 타차수배율 | 동주차다른장미배율 | 의심 |');
  console.log('|---|---|---|---|---|---|---|---|---|');

  let suspect = 0;
  for (const r of curRes.recordset) {
    const pk = Number(r.ProdKey);
    const b1b = Number(r.BunchOf1Box) || 0;
    const shipBox = Number(r.shipBox) || 0;
    const orderBox = orderByProd.get(pk) || 0;
    const histMed = median(histByProd.get(pk) || []);
    const peerMed = median(sameWeekBox.filter((q) => q !== shipBox));
    const histRatio = histMed > 0 ? shipBox / histMed : 0;
    const peerRatio = peerMed > 0 ? shipBox / peerMed : 0;
    const near10 = (x) => b1b > 1 && x > 0 && Math.abs(x - b1b) / b1b < 0.2;
    const flag = near10(histRatio) || near10(peerRatio);
    if (flag) suspect += 1;
    console.log(
      `| ${(r.ProdName || '').substring(0, 28)} | ${r.OutUnit || '-'} | ${b1b} | ${shipBox} | ${orderBox} | ` +
      `${histMed || '-'} | ${histRatio ? histRatio.toFixed(1) : '-'} | ${peerRatio ? peerRatio.toFixed(1) : '-'} | ${flag ? '⚠️10배?' : ''} |`
    );
  }

  console.log(`\n## 요약: 장미 ${curRes.recordset.length}건 중 10배 의심 ${suspect}건`);
  console.log('- 타차수배율 ≈ B1B(10) → 같은 품목이 다른 주에는 1/10 수준 → 24-01 만 10배로 들어갔을 가능성');
  console.log('- 동주차다른장미배율 ≈ B1B(10) → 주광 단독주문이라 차수 peer 가 없을 때의 보조 신호');
  console.log('- 의심 행은 단(묶음)을 박스로 잘못 읽었는지 단위 확인 필요(운영 DB 는 본 스크립트로 수정하지 않음)');

  await pool.close();
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
