#!/usr/bin/env node
/**
 * 전체 차수 재고 정합 일괄 복구
 * 1) 각 차수: 배치이력 삭제 + 재계산 + psGap 재계산
 * 2) 운영차수(26-01): sync + live=ps + 음수정리
 *
 * Usage:
 *   node scripts/fix-all-weeks-remain.js
 *   node scripts/fix-all-weeks-remain.js --apply
 *   node scripts/fix-all-weeks-remain.js --apply --current=26-01
 */
const { execSync } = require('child_process');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const CURRENT = process.argv.find((a) => a.startsWith('--current='))?.split('=')[1] || '26-01';
const root = path.join(__dirname, '..');

function run(cmd) {
  console.log(`\n>>> ${cmd}`);
  if (APPLY) execSync(cmd, { cwd: root, stdio: 'inherit', timeout: 0 });
}

async function loadWeeks() {
  const fs = require('fs');
  const sql = require('mssql');
  fs.readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
  });
  const pool = await sql.connect({
    server: process.env.DB_SERVER, port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true },
  });
  const r = await pool.request().input('yr', '2026').query(`
    SELECT DISTINCT OrderWeek wk FROM ShipmentMaster WHERE isDeleted=0 AND OrderYear='2026' ORDER BY OrderWeek`);
  await pool.close();
  return r.recordset.map((x) => x.wk);
}

(async () => {
  const weeks = await loadWeeks();
  console.log(`=== 전체 차수 복구 | ${APPLY ? 'APPLY' : 'DRY-RUN'} | weeks=${weeks.length} | 운영=${CURRENT} ===`);

  if (!APPLY) {
    console.log('Add --apply to execute');
    return;
  }

  for (const wk of weeks) {
    console.log(`\n========== ${wk} ==========`);
    run(`node scripts/reconcile-week-remain.js ${wk} --apply`);
    run(`node scripts/recalc-gap-products.js ${wk} --apply`);
  }

  console.log(`\n========== 운영차수 ${CURRENT} 추가 ==========`);
  run(`node scripts/fix-week-remain-pipeline.js ${CURRENT} --apply`);
  run(`node scripts/recalc-gap-products.js ${CURRENT} --apply`);
  run(`node scripts/fix-all-negative-stock.js ${CURRENT} --apply`);
  run(`node scripts/align-live-to-ps.js ${CURRENT} --apply`);

  run(`node scripts/verify-all-weeks-stock.js --current=${CURRENT} --min=1`);
})().catch((e) => { console.error(e); process.exit(1); });
