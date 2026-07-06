#!/usr/bin/env node
/**
 * 운임품목 EstQuantity 10배 오류 교정 (희경 24/26, 월드천사 25 유형)
 * node scripts/fix-freight-est-10x.mjs            # DRY-RUN (기본, 변경 없음)
 * node scripts/fix-freight-est-10x.mjs --apply    # 실제 적용
 *
 * 안전수칙:
 *  1) 대상은 실행 시점에 스캐너 규칙(운임품목 & Est≠Out & Est/Out=정수배)으로 재검증 — 오검출 자동 제외
 *  2) 적용 전 before-state 를 scratchpad 백업 JSON 으로 저장
 *  3) '운임=원가통과' 규칙으로 정답을 계산(Est=Out, Bunch=0, Amount=Out×Cost/1.1) — Detail을 정답이라 가정하지 않음
 *  4) ShipmentDetail + (오염된 경우에만) ShipmentDate 동시 교정, ShipmentHistory 기록, 트랜잭션
 */
import fs from 'fs';
import path from 'path';
import sql from 'mssql';

const APPLY = process.argv.includes('--apply');
const BACKUP = path.join(process.env.TEMP || '.', `freight-fix-backup-${Date.now()}.json`);

function loadEnv() {
  fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if (m) process.env[m[1]] = m[2];
  });
}
const r2 = (n) => Math.round(n); // Date 는 반올림 정수, Detail 은 float 유지(정상행 패턴)

async function main() {
  loadEnv();
  const pool = await sql.connect({
    server: process.env.DB_SERVER, port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true, requestTimeout: 120000 },
  });

  // 대상 재검증 — 운임품목 & Est≠Out (전 차수)
  const targets = (await pool.request().query(`
    SELECT sd.SdetailKey AS sdk, c.CustName, sm.OrderWeek, p.ProdName,
           sd.OutQuantity AS outQ, sd.EstQuantity AS estQ, sd.BunchQuantity AS bunchQ,
           sd.Cost AS cost, sd.Amount AS amt, sd.Vat AS vat
    FROM ShipmentDetail sd
    JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
    LEFT JOIN Customer c ON c.CustKey = sm.CustKey
    JOIN Product p ON p.ProdKey = sd.ProdKey
    WHERE sm.isDeleted = 0
      AND (p.ProdName LIKE '%운송료%' OR p.ProdName LIKE '%상차%' OR p.ProdName LIKE '%운임%')
      AND ABS(ISNULL(sd.EstQuantity,0) - ISNULL(sd.OutQuantity,0)) > 0.001
    ORDER BY sd.SdetailKey`)).recordset;

  if (!targets.length) { console.log('교정 대상 없음 — 이미 정상.'); await pool.close(); return; }

  const plan = [];
  for (const t of targets) {
    const total = t.outQ * t.cost;                 // 정답 총액 = Out × Cost
    const correct = { est: t.outQ, bunch: 0, amount: total / 1.1, vat: total / 11 };
    // 오염된 ShipmentDate (Est ≠ ShipmentQuantity) 확인
    const dates = (await pool.request().input('sk', sql.Int, t.sdk).query(
      `SELECT SdateKey, ShipmentQuantity AS shipQ, EstQuantity AS estQ, Cost, Amount, Vat
       FROM ShipmentDate WHERE SdetailKey=@sk`)).recordset;
    const badDates = dates.filter(d => Math.abs((d.estQ || 0) - (d.shipQ || 0)) > 0.001);
    plan.push({ t, correct, badDates, dates });
  }

  console.log(`\n########## 운임 10배 교정 ${APPLY ? '[APPLY]' : '[DRY-RUN]'} — ${plan.length}건 ##########`);
  for (const { t, correct, badDates } of plan) {
    console.log(`\n[SdetailKey ${t.sdk}] ${t.CustName} ${t.OrderWeek} ${t.ProdName}`);
    console.log(`  Detail: Est ${t.estQ}→${correct.est}, Bunch ${t.bunchQ}→0, Amount ${Math.round(t.amt)}→${Math.round(correct.amount)}, Vat ${Math.round(t.vat)}→${Math.round(correct.vat)}`);
    console.log(`  Date:   ${badDates.length ? `${badDates.length}행 오염 → 교정 (Est→ShipmentQuantity, 금액 재계산)` : '정상 → 건드리지 않음'}`);
  }

  if (!APPLY) {
    console.log('\nDRY-RUN — 변경 없음. 적용하려면 --apply 붙여 재실행.');
    await pool.close(); return;
  }

  // 백업
  fs.writeFileSync(BACKUP, JSON.stringify(plan.map(p => ({ before: p.t, dates: p.dates })), null, 2));
  console.log(`\n백업 저장: ${BACKUP}`);

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    for (const { t, correct, badDates } of plan) {
      const req = () => new sql.Request(tx);
      await req()
        .input('sk', sql.Int, t.sdk).input('est', sql.Float, correct.est)
        .input('amt', sql.Float, correct.amount).input('vat', sql.Float, correct.vat)
        .query(`UPDATE ShipmentDetail SET EstQuantity=@est, BunchQuantity=0, Amount=@amt, Vat=@vat WHERE SdetailKey=@sk`);
      // ShipmentHistory 기록 (Amount 기준)
      await req()
        .input('sk', sql.Int, t.sdk)
        .input('bv', sql.NVarChar, String(Math.round(t.amt)))
        .input('av', sql.NVarChar, String(Math.round(correct.amount)))
        .input('descr', sql.NVarChar, `운임 Est 10배 교정 Est ${t.estQ}→${correct.est}`)
        .query(`INSERT INTO ShipmentHistory (SdetailKey, ShipmentDtm, ChangeType, BeforeValue, AfterValue, Descr, ChangeID, ChangeDtm)
                SELECT @sk, sd.ShipmentDtm, N'수정', @bv, @av, @descr, N'fix-freight-10x', GETDATE()
                FROM ShipmentDetail sd WHERE sd.SdetailKey=@sk`);
      for (const d of badDates) {
        const total = (d.shipQ || 0) * (d.Cost || t.cost);
        await req()
          .input('dk', sql.Int, d.SdateKey).input('est', sql.Float, d.shipQ)
          .input('amt', sql.Float, total / 1.1).input('vat', sql.Float, total / 11)
          .query(`UPDATE ShipmentDate SET EstQuantity=@est, Amount=@amt, Vat=@vat WHERE SdateKey=@dk`);
      }
    }
    await tx.commit();
    console.log('COMMIT OK — 교정 완료.');
  } catch (e) { await tx.rollback(); console.error('ROLLBACK:', e.message); throw e; }

  // 사후 검증
  const after = (await pool.request().query(`
    SELECT sd.SdetailKey AS sdk, sd.OutQuantity, sd.EstQuantity, sd.Amount
    FROM ShipmentDetail sd JOIN Product p ON p.ProdKey=sd.ProdKey
    WHERE sd.SdetailKey IN (${plan.map(p=>p.t.sdk).join(',')})`)).recordset;
  console.log('\n=== 사후 상태 ==='); console.table(after);
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
