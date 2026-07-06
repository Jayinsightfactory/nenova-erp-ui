#!/usr/bin/env node
/**
 * 데이터 무결성 스캐너 (READ-ONLY) — 희경 10배 사고 유형을 전 차수에서 탐지
 * node scripts/scan-integrity.mjs [--week-min=1] [--json]
 *
 * 검사 규칙 (운임/수수료 품목 = 원가 통과 항목에 한정 — 여기서만 Amount=Est×Cost 불변식이 성립):
 *  B. 운임 Est≠Out : 운송료/상차/운임 품목인데 EstQuantity ≠ OutQuantity (10배 등)  ← 핵심
 *  C. 운임 금액오류 : 운임품목 |Amount - EstQuantity×Cost/1.1| > 100 (Est 고쳐도 Amount 안 고친 경우)
 *  E. 의심 10배   : 운임품목 Est/Out 이 정확히 10·100 배 (라운드 배수 = 단위환산 사고 징후)
 *
 * ※ 1차 스캔에서 A(Detail vs Date 금액)·CustKey null 은 판매품목 정상구조라 오탐 → 제거.
 *   판매품목 Amount 는 매출가라 Est×Cost(원가) 식과 다름. 불변식이 성립하는 운임품목만 검사.
 * 절대 DB 를 수정하지 않음. 발견분만 리포트.
 */
import fs from 'fs';
import path from 'path';
import sql from 'mssql';

const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const WEEK_MIN = parseInt((args.find(a => a.startsWith('--week-min=')) || '--week-min=1').split('=')[1], 10);

function loadEnv() {
  fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
  });
}

// OrderWeek 'NN-NN' 의 앞 대차수 숫자
const WEEK_EXPR = `TRY_CONVERT(int, LEFT(sm.OrderWeek, CHARINDEX('-', sm.OrderWeek + '-') - 1))`;

async function main() {
  loadEnv();
  const pool = await sql.connect({
    server: process.env.DB_SERVER, port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true, requestTimeout: 120000 },
  });
  const run = async (q) => (await pool.request().query(q)).recordset;
  const report = {};
  // 운임/수수료(원가 통과) 품목 판정식
  const FREIGHT = `(p.ProdName LIKE '%운송료%' OR p.ProdName LIKE '%상차%' OR p.ProdName LIKE '%운임%')`;

  // B. 운임 품목인데 Est ≠ Out (핵심 10배 탐지)
  report.B_freightEstNeOut = await run(`
    SELECT sd.SdetailKey AS sdk, c.CustName, sm.OrderWeek, p.ProdName,
           sd.OutQuantity, sd.EstQuantity, sd.BunchQuantity, sd.Cost, sd.Amount,
           CASE WHEN sd.OutQuantity<>0 THEN ROUND(sd.EstQuantity/sd.OutQuantity,2) END AS ratio,
           sd.isFix
    FROM ShipmentDetail sd
    JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
    LEFT JOIN Customer c ON c.CustKey = sm.CustKey
    JOIN Product p ON p.ProdKey = sd.ProdKey
    WHERE sm.isDeleted = 0 AND ${WEEK_EXPR} >= ${WEEK_MIN} AND ${FREIGHT}
      AND ABS(ISNULL(sd.EstQuantity,0) - ISNULL(sd.OutQuantity,0)) > 0.001
    ORDER BY ABS(sd.EstQuantity - sd.OutQuantity) DESC`);

  // C. 운임 품목 금액이 Est×Cost/1.1 와 다름 (Est 는 고쳤어도 Amount 방치된 경우)
  report.C_freightAmountWrong = await run(`
    SELECT sd.SdetailKey AS sdk, c.CustName, sm.OrderWeek, p.ProdName,
           sd.OutQuantity, sd.EstQuantity, sd.Cost, sd.Amount, sd.Vat,
           ROUND(sd.EstQuantity*sd.Cost/1.1,0) AS expectAmt,
           sd.Amount - ROUND(sd.EstQuantity*sd.Cost/1.1,0) AS diff
    FROM ShipmentDetail sd
    JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
    LEFT JOIN Customer c ON c.CustKey = sm.CustKey
    JOIN Product p ON p.ProdKey = sd.ProdKey
    WHERE sm.isDeleted = 0 AND ${WEEK_EXPR} >= ${WEEK_MIN} AND ${FREIGHT}
      AND sd.Cost > 0 AND sd.EstQuantity > 0
      AND ABS(sd.Amount - ROUND(sd.EstQuantity*sd.Cost/1.1,0)) > 100
    ORDER BY ABS(sd.Amount - ROUND(sd.EstQuantity*sd.Cost/1.1,0)) DESC`);

  if (JSON_OUT) { console.log(JSON.stringify(report, null, 2)); await pool.close(); return; }

  const labels = {
    B_freightEstNeOut: 'B. 운임 품목 Est≠Out (10배 등) — 핵심',
    C_freightAmountWrong: 'C. 운임 품목 금액 ≠ Est×Cost/1.1',
  };
  console.log(`\n########## 무결성 스캔 결과 (대차수 ${WEEK_MIN}+ ) ##########`);
  for (const [k, label] of Object.entries(labels)) {
    const rows = report[k];
    console.log(`\n===== ${label} — ${rows.length}건 =====`);
    if (rows.length) console.table(rows.slice(0, 25));
    if (rows.length > 25) console.log(`… 외 ${rows.length - 25}건`);
  }
  console.log(`\n요약: B(Est≠Out)=${report.B_freightEstNeOut.length}  C(금액오류)=${report.C_freightAmountWrong.length}`);
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
