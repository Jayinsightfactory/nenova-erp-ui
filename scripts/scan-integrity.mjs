#!/usr/bin/env node
/**
 * 데이터 무결성 스캐너 (READ-ONLY)
 * node scripts/scan-integrity.mjs [--week-min=1] [--year=2026] [--json]
 *
 * 검사 규칙
 *  [운임/수수료 품목 — 원가 통과 항목에 한정, 여기서만 Amount=Est×Cost 불변식이 성립]
 *  B. 운임 Est≠Out : 운송료/상차/운임 품목인데 EstQuantity ≠ OutQuantity (10배 등)  ← 희경 10배 사고 유형
 *  C. 운임 금액오류 : 운임품목 |Amount - EstQuantity×Cost/1.1| > 100
 *
 *  [출고→견적서/매출 누락 4경로 — 2026-10-15 이카운트↔exe 매출 차이 전수조사 결과, lib/shipmentEstimateGuard.js 공용 SQL]
 *  G1. 주문 없는 확정 출고        : ViewOrder(OrderYearWeek2+CustKey+ProdKey) 에 없는 확정 라인 → 견적서·매출·이카운트 어디에도 안 나감
 *  G2. Detail 금액 ≠ Date 합      : ShipmentDetail.Amount/Vat ≠ ShipmentDate 합(±1원 초과) → 견적서(Date) vs exe 매출/불량(Detail) 숫자 다름
 *  G2b. 출고일 금액 전부 NULL      : 확정 라인인데 ShipmentDate.Amount 가 모두 NULL → 견적서 GetData(sdd.EstQuantity>0) 에서 탈락, 이카운트 미업로드
 *  G3. 삭제 거래처·품목 확정 출고  : Customer/Product.isDeleted=1 → ViewShipment 조건에 걸려 매출 누락
 *  G4a. OrderYearWeek ≠ 연도+대차수 : 연말→연초 연도 계산 버그(2026년 1·2차가 202501/202502) / 세부차수 포함 저장
 *  G4b. 출고일이 차수 범위 ±7일 밖  : PeriodDay 기준
 *
 * ※ 1차 스캔에서 A(Detail vs Date 금액)·CustKey null 은 판매품목 정상구조라 오탐 → 제거했으나,
 *   G2 는 "확정 라인 + Amount/Vat" 한정이라 오탐이 아님(2026년 161줄 = 조사 보고서 160줄과 일치). EstQuantity 는 비교하지 않음
 *   (ShipmentDetail.EstQuantity 는 박스/단 단위가 섞여 있어 Date 합과 원래부터 다름 — 12,203줄).
 * 절대 DB 를 수정하지 않음. 발견분만 리포트.
 */
import fs from 'fs';
import path from 'path';
import sql from 'mssql';
import {
  sqlOrderlessFixedShipments,
  sqlDetailDateMoneyMismatch,
  sqlDetailWithUnpricedDates,
  sqlDeletedMasterFixedShipments,
  sqlWeekKeyMismatchMasters,
  sqlShipmentDateOutOfWeek,
} from '../lib/shipmentEstimateGuard.js';

const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const WEEK_MIN = parseInt((args.find(a => a.startsWith('--week-min=')) || '--week-min=1').split('=')[1], 10);
const YEAR_ARG = (args.find(a => a.startsWith('--year=')) || '').split('=')[1] || null; // 없으면 전 연도

function loadEnv() {
  const p = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(p)) return;
  fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach((line) => {
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
    options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true, requestTimeout: 180000 },
  });
  const run = async (q, params = {}) => {
    const req = pool.request();
    for (const [k, v] of Object.entries(params)) req.input(k, v.type, v.value);
    return (await req.query(q)).recordset;
  };
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

  // G1~G4. 출고→견적서/매출 누락 4경로 (lib/shipmentEstimateGuard.js 와 동일 SQL — 관리자 API estimate-guard-diagnose 와 숫자 일치)
  const gOpts = { orderYear: YEAR_ARG, weekMin: WEEK_MIN };
  const gParams = YEAR_ARG ? { orderYear: { type: sql.NVarChar, value: YEAR_ARG } } : {};
  report.G1_orderlessFixed = await run(sqlOrderlessFixedShipments(gOpts), gParams);
  report.G2_detailDateMoneyMismatch = await run(sqlDetailDateMoneyMismatch(gOpts), gParams);
  report.G2b_detailWithUnpricedDates = await run(sqlDetailWithUnpricedDates(gOpts), gParams);
  report.G3_deletedMasterFixed = await run(sqlDeletedMasterFixedShipments(gOpts), gParams);
  report.G4a_weekKeyMismatch = await run(sqlWeekKeyMismatchMasters({ orderYear: YEAR_ARG }), gParams);
  report.G4b_shipmentDateOutOfWeek = await run(sqlShipmentDateOutOfWeek(gOpts), gParams);

  if (JSON_OUT) { console.log(JSON.stringify(report, null, 2)); await pool.close(); return; }

  const labels = {
    B_freightEstNeOut: 'B. 운임 품목 Est≠Out (10배 등) — 핵심',
    C_freightAmountWrong: 'C. 운임 품목 금액 ≠ Est×Cost/1.1',
    G1_orderlessFixed: 'G1. 주문 없는 확정 출고 (견적서·매출·이카운트 누락)',
    G2_detailDateMoneyMismatch: 'G2. 확정 라인 ShipmentDetail 금액 ≠ ShipmentDate 합 (±1원 초과, 금액 기재된 출고일만)',
    G2b_detailWithUnpricedDates: 'G2b. 확정 라인인데 출고일 금액 전부 NULL (exe 견적 미작성 → 견적서·이카운트 누락)',
    G3_deletedMasterFixed: 'G3. 삭제 거래처·품목의 확정 출고 (ViewShipment 누락)',
    G4a_weekKeyMismatch: 'G4a. ShipmentMaster.OrderYearWeek ≠ OrderYear+대차수',
    G4b_shipmentDateOutOfWeek: 'G4b. 출고일이 차수(PeriodDay) 범위 ±7일 밖',
  };
  const sumAmt = (rows) => Math.round(rows.reduce((s, r) => s + Number(r.Amount || 0), 0)).toLocaleString('ko-KR');
  console.log(`\n########## 무결성 스캔 결과 (대차수 ${WEEK_MIN}+${YEAR_ARG ? `, ${YEAR_ARG}년` : ', 전 연도'}) ##########`);
  for (const [k, label] of Object.entries(labels)) {
    const rows = report[k];
    console.log(`\n===== ${label} — ${rows.length}건${k.startsWith('G') && k !== 'G4a_weekKeyMismatch' ? ` (Amount 합 ${sumAmt(rows)}원)` : ''} =====`);
    if (rows.length) console.table(rows.slice(0, 25));
    if (rows.length > 25) console.log(`… 외 ${rows.length - 25}건`);
  }
  console.log(`\n요약: B(Est≠Out)=${report.B_freightEstNeOut.length}  C(금액오류)=${report.C_freightAmountWrong.length}`);
  console.log(`      G1(주문없는 확정출고)=${report.G1_orderlessFixed.length}  G2(Detail≠Date 금액)=${report.G2_detailDateMoneyMismatch.length} / G2b(출고일 금액 NULL)=${report.G2b_detailWithUnpricedDates.length}  G3(삭제 거래처·품목 확정출고)=${report.G3_deletedMasterFixed.length}  G4(차수키 불일치)=${report.G4a_weekKeyMismatch.length} / 출고일 범위 밖=${report.G4b_shipmentDateOutOfWeek.length}`);
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
