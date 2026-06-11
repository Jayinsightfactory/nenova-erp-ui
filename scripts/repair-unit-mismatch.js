// 단→박스 10배(STORED_BUNCH_AS_BOX) ShipmentDetail 보정 도구
// ─────────────────────────────────────────────────────────────────────────
// OutUnit=박스 + BunchOf1Box>1 품목에서 OutQuantity 가 단(묶음)수로 잘못 저장돼
// 주문(OrderDetail) 대비 BunchOf1Box 배 과대인 행을, canonical distributeUnits 로
// 되돌린다(OutQuantity = OutQuantity / BunchOf1Box, 나머지 환산필드 재계산).
//
// ⚠️ 안전장치:
//   - 기본은 DRY-RUN. SELECT + before/after 출력만, DB 무수정.
//   - 실제 UPDATE 는 반드시 --apply 플래그가 있을 때만, 트랜잭션 안에서 수행.
//   - 보정 대상 판정은 lib/unitMismatchAudit.computeBunchAsBoxRepair (주문 baseline 필요)로만.
//     → 주문(OrderDetail)도 함께 10배인 경우(주광 단독 재업로드)는 baseline 이 1배라 잡히지 않으므로
//       자동 보정하지 않는다(scripts/probe-import-qty-2401.js 로 수동 확인 필요).
//
// 사용:
//   node scripts/repair-unit-mismatch.js --week=24-01 [--cust=주광] [--limit=50]        # dry-run
//   node scripts/repair-unit-mismatch.js --week=24-01 --cust=주광 --limit=50 --apply     # 실제 보정
//
//   DB 자격증명: .env.local 또는 DB_SERVER/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD
// ─────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

const envFile = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  });
}

function parseArgs(argv) {
  const out = { week: '24-01', cust: '', limit: 0, apply: false };
  for (const a of argv) {
    let m;
    if ((m = a.match(/^--week=(.+)$/))) out.week = m[1].trim();
    else if ((m = a.match(/^--cust=(.+)$/))) out.cust = m[1].trim();
    else if ((m = a.match(/^--limit=(\d+)$/))) out.limit = parseInt(m[1], 10);
    else if (a === '--apply') out.apply = true;
  }
  return out;
}

const ARGS = parseArgs(process.argv.slice(2));

function fmt(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '-';
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

(async () => {
  if (!process.env.DB_SERVER || !process.env.DB_USER) {
    console.error('DB 자격증명 없음 (.env.local 또는 DB_SERVER/DB_USER 환경변수 필요).');
    console.error('읽기 전용 대체 진단: node scripts/probe-unit-mismatch.js ' + ARGS.week);
    process.exit(2);
  }

  const { computeBunchAsBoxRepair } = await import('../lib/unitMismatchAudit.js');
  const { amountVatFromCostEst } = await import('../lib/distributeUnits.js');

  const sql = require('mssql');
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: Number(process.env.DB_PORT || 1433),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true, connectTimeout: 30000, requestTimeout: 60000 },
  });

  const mode = ARGS.apply ? 'APPLY (실제 UPDATE)' : 'DRY-RUN (DB 무수정)';
  console.log(`# 단→박스 10배 보정 — ${ARGS.week}${ARGS.cust ? ' / ' + ARGS.cust : ''} — ${mode}\n`);

  // 보정 후보: OutUnit=박스 + B1B>1 + BunchQuantity≈OutQty×B1B + 주문 baseline 존재.
  // 실제 보정 판정은 computeBunchAsBoxRepair 가 주문 대비 비율(≈B1B)로 최종 확정.
  const custFilter = ARGS.cust ? 'AND c.CustName LIKE @cust' : '';
  const reqSel = pool.request().input('week', sql.NVarChar, ARGS.week);
  if (ARGS.cust) reqSel.input('cust', sql.NVarChar, `%${ARGS.cust}%`);

  const r = await reqSel.query(`
    SELECT sd.SdetailKey, c.CustName, p.ProdName, p.OutUnit, p.EstUnit,
           ISNULL(p.BunchOf1Box,0) AS BunchOf1Box, ISNULL(p.SteamOf1Box,0) AS SteamOf1Box,
           ISNULL(p.SteamOf1Bunch,0) AS SteamOf1Bunch,
           sd.OutQuantity, sd.EstQuantity, sd.BoxQuantity, sd.BunchQuantity, sd.SteamQuantity,
           ISNULL(sd.Cost,0) AS Cost,
           ISNULL(od.BoxQuantity, od.OutQuantity) AS orderBox
      FROM ShipmentDetail sd
      JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey AND ISNULL(sm.isDeleted,0) = 0
      JOIN Customer c ON sm.CustKey = c.CustKey
      JOIN Product p ON sd.ProdKey = p.ProdKey
      LEFT JOIN OrderMaster om ON om.CustKey = sm.CustKey AND om.OrderWeek = sm.OrderWeek AND ISNULL(om.isDeleted,0) = 0
      LEFT JOIN OrderDetail od ON od.OrderMasterKey = om.OrderMasterKey AND od.ProdKey = sd.ProdKey AND ISNULL(od.isDeleted,0) = 0
     WHERE sm.OrderWeek = @week AND sd.OutQuantity > 0
       AND p.OutUnit = N'박스' AND ISNULL(p.BunchOf1Box,0) > 1
       AND ABS(sd.BunchQuantity - sd.OutQuantity * p.BunchOf1Box) < 0.01
       ${custFilter}
     ORDER BY c.CustName, p.ProdName`);

  const targets = [];
  for (const row of r.recordset) {
    const product = {
      OutUnit: row.OutUnit, EstUnit: row.EstUnit,
      BunchOf1Box: row.BunchOf1Box, SteamOf1Box: row.SteamOf1Box, SteamOf1Bunch: row.SteamOf1Bunch,
    };
    const fix = computeBunchAsBoxRepair(
      {
        OutQuantity: row.OutQuantity, BoxQuantity: row.BoxQuantity,
        BunchQuantity: row.BunchQuantity, SteamQuantity: row.SteamQuantity,
        EstQuantity: row.EstQuantity, orderQty: row.orderBox,
      },
      product
    );
    if (!fix) continue;
    const { amount, vat } = amountVatFromCostEst(row.Cost, fix.to.estQty);
    targets.push({ row, fix, amount, vat });
    if (ARGS.limit && targets.length >= ARGS.limit) break;
  }

  if (!targets.length) {
    console.log(`보정 대상 0건 (주문 대비 ≈BunchOf1Box 배 과대 + 환산 일관 행 없음).`);
    await pool.close();
    return;
  }

  console.log(`보정 대상 ${targets.length}건${ARGS.limit ? ` (--limit ${ARGS.limit})` : ''}\n`);
  console.log('| Sdk | 거래처 | 품목 | 주문 | B1B | Out(전→후) | Box(전→후) | Bunch(전→후) | Steam(전→후) | Est(전→후) |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const t of targets) {
    const { row, fix } = t;
    console.log(
      `| ${row.SdetailKey} | ${(row.CustName || '').slice(0, 10)} | ${(row.ProdName || '').slice(0, 22)} | ` +
      `${fmt(row.orderBox)} | ${fix.b1b} | ${fmt(fix.from.outQty)}→${fmt(fix.to.outQty)} | ` +
      `${fmt(fix.from.boxQty)}→${fmt(fix.to.boxQty)} | ${fmt(fix.from.bunchQty)}→${fmt(fix.to.bunchQty)} | ` +
      `${fmt(fix.from.steamQty)}→${fmt(fix.to.steamQty)} | ${fmt(fix.from.estQty)}→${fmt(fix.to.estQty)} |`
    );
  }

  if (!ARGS.apply) {
    console.log(`\n[DRY-RUN] DB 무수정. 실제 보정하려면 동일 명령에 --apply 추가.`);
    console.log(`  node scripts/repair-unit-mismatch.js --week=${ARGS.week}${ARGS.cust ? ' --cust=' + ARGS.cust : ''}${ARGS.limit ? ' --limit=' + ARGS.limit : ''} --apply`);
    await pool.close();
    return;
  }

  // ── 실제 보정: 트랜잭션 안에서 SdetailKey 정확 타겟 UPDATE ──
  console.log(`\n[APPLY] ${targets.length}건 UPDATE 시작 (트랜잭션)...`);
  const tx = new sql.Transaction(pool);
  let updated = 0;
  try {
    await tx.begin();
    for (const t of targets) {
      const { row, fix, amount, vat } = t;
      const reqU = new sql.Request(tx);
      const res = await reqU
        .input('dk', sql.Int, row.SdetailKey)
        .input('outQty', sql.Float, fix.to.outQty)
        .input('estQty', sql.Float, fix.to.estQty)
        .input('bq', sql.Float, fix.to.boxQty)
        .input('bnq', sql.Float, fix.to.bunchQty)
        .input('sq', sql.Float, fix.to.steamQty)
        .input('amount', sql.Float, amount)
        .input('vat', sql.Float, vat)
        .query(`
          UPDATE ShipmentDetail
             SET OutQuantity=@outQty, EstQuantity=@estQty,
                 BoxQuantity=@bq, BunchQuantity=@bnq, SteamQuantity=@sq,
                 Amount=@amount, Vat=@vat
           WHERE SdetailKey=@dk
             AND ISNULL(isFix,0)=0
             AND OutQuantity=${Number(fix.from.outQty)}`); // 동시수정 가드: 읽은 값과 같을 때만
      updated += res.rowsAffected[0] || 0;
    }
    await tx.commit();
    console.log(`커밋 완료: ${updated}/${targets.length}건 UPDATE.`);
    if (updated < targets.length) {
      console.log('일부 행이 보정되지 않음(확정됨 isFix=1 또는 OutQuantity 가 그새 변경). 재실행 후 dry-run 으로 확인하세요.');
    }
  } catch (e) {
    await tx.rollback();
    console.error('롤백됨 — UPDATE 실패:', e.message);
    await pool.close();
    process.exit(1);
  }

  await pool.close();
})().catch((e) => {
  console.error('ERR:', e.message);
  process.exit(1);
});
