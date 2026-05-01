// scripts/backfill-product-master.mjs
// Product 마스터 자동 백필 — Flower 마스터의 BoxWeight/BoxCBM/StemsPerBox 를
// Product 마스터의 NULL/0 ProdKey 에 일괄 적용.
//
// 룰:
//   1. Flower 마스터에 BoxWeight 값 있는 카테고리만 대상 (장미/카네이션/알스트로/루스커스)
//   2. Product.BoxWeight 가 NULL 또는 0 인 ProdKey 만 업데이트
//   3. 이미 값 있는 ProdKey 는 보존 (덮어쓰기 금지)
//   4. SteamOf1Bunch 도 동일 룰 (Flower 마스터에 값 있으면 백필 — 단, Flower 에는 StemsPerBox 만 있고 SteamOf1Bunch 는 별도)
//
// 안전:
//   - DRY-RUN 기본. --apply 옵션으로만 실제 UPDATE 실행
//   - 백업 SQL 출력 (UPDATE 전 원래값 → 롤백 가능)
//   - 트랜잭션으로 묶음 (전체 성공 or 전체 롤백)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sqlImport from 'mssql';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split(/\r?\n/).forEach(line => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
  });
}
const sql = sqlImport;

const APPLY = process.argv.includes('--apply');

(async () => {
  const pool = await sql.connect({
    server: process.env.DB_SERVER, port: parseInt(process.env.DB_PORT||'1433'),
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    options: { encrypt:false, trustServerCertificate:true, enableArithAbort:true, connectTimeout:30000, requestTimeout:60000 },
  });

  console.log(`# Product 마스터 자동 백필 ${APPLY ? '(APPLY 모드)' : '(DRY-RUN)'}\n`);

  // 1. Flower 마스터 로드 — 백필 소스
  const fRes = await pool.request().query(`
    SELECT FlowerName, BoxWeight, BoxCBM, StemsPerBox
    FROM Flower WHERE isDeleted=0 AND BoxWeight > 0
  `);
  const flowerMap = new Map(fRes.recordset.map(f => [f.FlowerName, f]));
  console.log(`Flower 마스터 BoxWeight 값 있는 카테고리: ${flowerMap.size}건`);
  for (const [fn, f] of flowerMap) {
    console.log(`  ${fn}: BW=${f.BoxWeight} CBM=${f.BoxCBM ?? '-'} SPB=${f.StemsPerBox ?? '-'}`);
  }

  // 2. Product 누락 ProdKey 조회 — 최근 90일 사용 + BoxWeight NULL/0 + Flower 매칭
  const flowerNames = [...flowerMap.keys()].map(n => `N'${n.replace(/'/g, "''")}'`).join(',');
  const pRes = await pool.request().query(`
    SELECT
      p.ProdKey, p.ProdName, p.FlowerName, p.CounName,
      p.BoxWeight, p.BoxCBM, p.SteamOf1Bunch, p.BunchOf1Box,
      ISNULL(usage.UseCount, 0) AS UseCount
    FROM Product p
    LEFT JOIN (
      SELECT wd.ProdKey, COUNT(*) AS UseCount
      FROM WarehouseDetail wd
      INNER JOIN WarehouseMaster wm ON wd.WarehouseKey = wm.WarehouseKey
      WHERE wm.isDeleted=0 AND wm.InputDate >= DATEADD(DAY, -90, GETDATE())
        AND wd.ProdKey IS NOT NULL
      GROUP BY wd.ProdKey
    ) usage ON p.ProdKey = usage.ProdKey
    WHERE p.isDeleted=0
      AND p.FlowerName IN (${flowerNames})
      AND (p.BoxWeight IS NULL OR p.BoxWeight = 0 OR p.BoxCBM IS NULL OR p.BoxCBM = 0)
      AND usage.UseCount > 0
    ORDER BY p.FlowerName, usage.UseCount DESC
  `);

  const targets = pRes.recordset;
  console.log(`\n# 백필 대상: ${targets.length}건 (BoxWeight 또는 BoxCBM 누락)\n`);

  // 3. 카테고리별 백필 계획
  const updates = [];
  const byFlower = new Map();
  for (const p of targets) {
    const f = flowerMap.get(p.FlowerName.trim());
    if (!f) continue;
    const update = { ProdKey: p.ProdKey, ProdName: p.ProdName, FlowerName: p.FlowerName, useCount: p.UseCount, changes: [] };
    if ((!p.BoxWeight || p.BoxWeight <= 0) && f.BoxWeight > 0) {
      update.changes.push({ field: 'BoxWeight', from: p.BoxWeight, to: f.BoxWeight });
    }
    if ((!p.BoxCBM || p.BoxCBM <= 0) && f.BoxCBM && f.BoxCBM > 0) {
      update.changes.push({ field: 'BoxCBM', from: p.BoxCBM, to: f.BoxCBM });
    }
    if (update.changes.length > 0) {
      updates.push(update);
      const fn = p.FlowerName.trim();
      byFlower.set(fn, (byFlower.get(fn) || 0) + update.changes.length);
    }
  }

  console.log(`총 변경 ProdKey: ${updates.length}건`);
  console.log(`총 변경 필드 수: ${[...byFlower.values()].reduce((a,b)=>a+b, 0)}건\n`);
  for (const [fn, count] of [...byFlower.entries()].sort((a,b)=>b[1]-a[1])) {
    console.log(`  ${fn}: ${count} 필드 업데이트`);
  }

  // 4. 샘플 출력
  console.log(`\n## 샘플 변경 (Top 20):\n`);
  for (const u of updates.slice(0, 20)) {
    console.log(`  ProdKey ${u.ProdKey} (${u.FlowerName}) ${(u.ProdName||'').substring(0,40)} [사용 ${u.useCount}회]`);
    for (const c of u.changes) {
      console.log(`    ${c.field}: ${c.from ?? 'NULL'} → ${c.to}`);
    }
  }
  if (updates.length > 20) console.log(`  ... +${updates.length - 20}`);

  // 5. 백업 SQL 생성 (롤백용)
  const backupSql = updates.flatMap(u => {
    const sets = u.changes.map(c => `${c.field}=${c.from ?? 'NULL'}`).join(', ');
    return [`UPDATE Product SET ${sets} WHERE ProdKey=${u.ProdKey};`];
  }).join('\n');
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupFile = path.join(__dirname, '..', 'data', `product-master-rollback-${ts}.sql`);
  fs.writeFileSync(backupFile, backupSql);
  console.log(`\n📄 롤백 SQL 저장: ${path.relative(path.join(__dirname, '..'), backupFile)} (${updates.length} statements)`);

  if (!APPLY) {
    console.log(`\n[DRY-RUN] DB 변경 없음. --apply 옵션 추가 시 실제 UPDATE.`);
    console.log(`예: node scripts/backfill-product-master.mjs --apply`);
    await pool.close();
    return;
  }

  // 6. APPLY — 트랜잭션으로 일괄 UPDATE
  console.log(`\n## ⚠️ APPLY 모드 — 실제 DB 업데이트 시작\n`);
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();
    let success = 0;
    for (const u of updates) {
      const sets = u.changes.map(c => `${c.field}=@${c.field.toLowerCase()}`).join(', ');
      const req = new sql.Request(tx);
      for (const c of u.changes) {
        req.input(c.field.toLowerCase(), sql.Float, c.to);
      }
      req.input('pk', sql.Int, u.ProdKey);
      await req.query(`UPDATE Product SET ${sets} WHERE ProdKey=@pk`);
      success++;
    }
    await tx.commit();
    console.log(`✅ 트랜잭션 커밋 — ${success}/${updates.length} ProdKey UPDATE 성공`);
  } catch (e) {
    await tx.rollback();
    console.error(`❌ 트랜잭션 롤백 — ${e.message}`);
    process.exit(1);
  }

  console.log(`\n검증:`);
  console.log(`  node scripts/diagnose-product-master.mjs  # 누락 재계산`);
  console.log(`  node scripts/audit-all-bills.mjs           # BILL 점수 재계산`);
  console.log(`\n롤백 (필요 시):`);
  console.log(`  data/product-master-rollback-${ts}.sql 의 SQL 을 SSMS 에서 실행`);

  await pool.close();
})().catch(e => { console.error('ERROR:', e.message); console.error(e.stack); process.exit(1); });
