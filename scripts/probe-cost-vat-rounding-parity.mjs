#!/usr/bin/env node
/**
 * 읽기 전용 probe — 단가/부가세 EXE parity 판단 근거 수집
 *
 * 목적 2가지
 *  1) usp_ShipmentFix / usp_ShipmentFixCancel 가 Cost/Amount/Vat 를 건드리는지 정의로 확인.
 *     (확정차수 단가 직접수정이 "재확정 시 값이 되돌아간다"는 신고의 실제 메커니즘 확정용)
 *  2) 소수 EstQuantity 가 실제로 존재하는지, EXE 수식과 웹 수식의 금액 차이 행이 몇 건인지 집계.
 *
 * EXE 수식 (dnSpy 근거: docs/exe-golden/CostQuantityStockImpact.md)
 *   Amount = ROUND(Cost * ROUND(EstQuantity,0) / 1.1, 0)
 *   Vat    = Cost * ROUND(EstQuantity,0) - Amount
 * 웹 수식 (pages/api/estimate/*.js)
 *   Amount = round(EstQuantity * Cost / 1.1)
 *   Vat    = round(EstQuantity * Cost / 11)
 *
 * SELECT 전용. UPDATE/INSERT/DELETE/EXEC 없음.
 *
 * 사용:
 *   node scripts/probe-cost-vat-rounding-parity.mjs [fromOrderYear]
 *   ENV_FILE=C:\Users\USER\nenova-erp-ui\.env.local node scripts/probe-cost-vat-rounding-parity.mjs 2025
 */
import fs from 'node:fs';
import path from 'node:path';
import sql from 'mssql';

const ENV_FILE = process.env.ENV_FILE || path.join(process.cwd(), '.env.local');
if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} else {
  console.error(`env 파일을 찾지 못했습니다: ${ENV_FILE}`);
  console.error('ENV_FILE=<경로> 로 지정하세요.');
  process.exit(2);
}

const FROM_YEAR = String(process.argv[2] || '2025');

function show(title, rows) {
  console.log(`\n=== ${title} ===`);
  if (!rows || rows.length === 0) { console.log('(행 없음)'); return; }
  console.table(rows);
}

async function main() {
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, requestTimeout: 300000 },
  });

  console.log(`DB=${process.env.DB_NAME} / OrderYear >= ${FROM_YEAR} / 읽기 전용`);

  // ── 1. 확정 SP 정의: Cost/Amount/Vat 를 쓰는지
  const spNames = ['usp_ShipmentFix', 'usp_ShipmentFixCancel', 'usp_StockCalculation'];
  for (const name of spNames) {
    const r = await pool.request()
      .input('n', sql.NVarChar, `dbo.${name}`)
      .query('SELECT OBJECT_DEFINITION(OBJECT_ID(@n)) AS def');
    const def = r.recordset[0]?.def;
    if (!def) { console.log(`\n### ${name}: 정의 조회 불가(권한 또는 미존재)`); continue; }
    const touches = ['Cost', 'Amount', 'Vat'].filter((col) =>
      new RegExp(`(SET|,)\\s*${col}\\s*=`, 'i').test(def) ||
      new RegExp(`\\b${col}\\s*=\\s*`, 'i').test(def) && /UPDATE/i.test(def));
    console.log(`\n### ${name} — 길이 ${def.length}자 / 금액컬럼 대입 흔적: ${touches.length ? touches.join(', ') : '없음'}`);
    const outDir = path.join(process.cwd(), '.agent_tmp', 'sp-defs');
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `${name}.sql`);
    fs.writeFileSync(outFile, def, 'utf8');
    console.log(`   전체 정의 저장: ${path.relative(process.cwd(), outFile)}`);
    for (const line of def.split(/\r?\n/)) {
      if (/UPDATE\s+ShipmentDetail|UPDATE\s+ShipmentDate|\bAmount\b|\bVat\b|\bCost\b/i.test(line)) {
        console.log(`   | ${line.trim().slice(0, 160)}`);
      }
    }
  }

  // ── 2. 소수 EstQuantity 실재 여부
  const frac = await pool.request().input('y', sql.VarChar, FROM_YEAR).query(`
    SELECT 'ShipmentDetail' AS tbl,
           SUM(CASE WHEN sd.EstQuantity <> ROUND(sd.EstQuantity, 0) THEN 1 ELSE 0 END) AS fracRows,
           SUM(CASE WHEN sd.EstQuantity <> ROUND(sd.EstQuantity, 0) AND ISNULL(sd.isFix,0)=1 THEN 1 ELSE 0 END) AS fracFixedRows,
           COUNT(*) AS totalRows
      FROM ShipmentDetail sd
      JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
     WHERE sm.OrderYear >= @y AND ISNULL(sm.isDeleted,0)=0
       AND ISNULL(sd.EstQuantity,0) <> 0
    UNION ALL
    SELECT 'ShipmentDate',
           SUM(CASE WHEN sdt.EstQuantity <> ROUND(sdt.EstQuantity, 0) THEN 1 ELSE 0 END),
           NULL,
           COUNT(*)
      FROM ShipmentDate sdt
      JOIN ShipmentDetail sd ON sd.SdetailKey = sdt.SdetailKey
      JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
     WHERE sm.OrderYear >= @y AND ISNULL(sm.isDeleted,0)=0
       AND ISNULL(sdt.EstQuantity,0) <> 0`);
  show('소수 EstQuantity 실재 여부', frac.recordset);

  // ── 3. 반올림 규약 차이만 분리
  //
  // 주의: sd.EstQuantity 는 금액 산정 기준 수량과 다를 수 있다. 카네이션·수국처럼 박스 출고인데
  // 단/송이 단가를 쓰는 품목은 EstQuantity=1(박스)인데 금액은 15단 기준으로 잡힌다.
  // 따라서 "Cost x EstQuantity" 와 저장 금액을 비교하면 단위기준 차이가 반올림 차이로 오인된다.
  // 반올림 규약만 보려면 수량을 개입시키지 않는 EXE 항등식으로 검사한다.
  //   total = Amount + Vat,  Amount = ROUND(total / 1.1, 0),  Vat = total - Amount
  const gap = await pool.request().input('y', sql.VarChar, FROM_YEAR).query(`
    WITH calc AS (
      SELECT ISNULL(sd.isFix,0) AS isFix,
             ISNULL(sd.Amount,0) + ISNULL(sd.Vat,0) AS total,
             ISNULL(sd.Amount,0) AS amt,
             sd.Cost, sd.EstQuantity
        FROM ShipmentDetail sd
        JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
       WHERE sm.OrderYear >= @y AND ISNULL(sm.isDeleted,0)=0
         AND ISNULL(sd.EstQuantity,0) <> 0 AND ISNULL(sd.Cost,0) <> 0
    )
    SELECT isFix,
           COUNT(*) AS totalRows,
           SUM(CASE WHEN ABS(amt - ROUND(total / 1.1, 0)) > 0.5 THEN 1 ELSE 0 END) AS roundingDiffRows,
           CAST(SUM(ABS(amt - ROUND(total / 1.1, 0))) AS decimal(18,0)) AS roundingAbsGapSum,
           SUM(CASE WHEN ABS(total - Cost * ROUND(EstQuantity,0)) > 0.5 THEN 1 ELSE 0 END) AS unitBasisDiffRows
      FROM calc
     GROUP BY isFix`);
  show('반올림 규약 차이 vs 단위기준 차이 (isFix별)', gap.recordset);

  // ── 4. 순수 반올림 차이 표본
  const sample = await pool.request().input('y', sql.VarChar, FROM_YEAR).query(`
    SELECT TOP 20 sm.OrderYear, sm.OrderWeek, c.CustName, p.ProdName,
           sd.Cost, sd.EstQuantity, sd.Amount, sd.Vat,
           ISNULL(sd.Amount,0) + ISNULL(sd.Vat,0) AS total,
           ROUND((ISNULL(sd.Amount,0) + ISNULL(sd.Vat,0)) / 1.1, 0) AS amtExe,
           ISNULL(sd.isFix,0) AS isFix
      FROM ShipmentDetail sd
      JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
      JOIN Customer c ON c.CustKey = sm.CustKey
      JOIN Product p ON p.ProdKey = sd.ProdKey
     WHERE sm.OrderYear >= @y AND ISNULL(sm.isDeleted,0)=0
       AND ISNULL(sd.EstQuantity,0) <> 0 AND ISNULL(sd.Cost,0) <> 0
       AND ABS(ISNULL(sd.Amount,0)
               - ROUND((ISNULL(sd.Amount,0) + ISNULL(sd.Vat,0)) / 1.1, 0)) > 0.5
     ORDER BY sm.OrderYear DESC, sm.OrderWeek DESC`);
  show('순수 반올림 차이 표본 20건', sample.recordset);

  await pool.close();
  console.log('\n완료 — 쓰기 작업 없음');
}

main().catch((e) => { console.error(e); process.exit(1); });
