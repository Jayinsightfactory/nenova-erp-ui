#!/usr/bin/env node
/**
 * 검증 NG 차수만 reconcile + recalc-gap (빠른 일괄 복구)
 * Usage: node scripts/fix-ng-weeks-remain.js --apply
 */
const { execSync } = require('child_process');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const CURRENT = process.argv.find((a) => a.startsWith('--current='))?.split('=')[1] || '26-01';
const root = path.join(__dirname, '..');

const NG_WEEKS = [
  '02-01', '04-01', '04-02', '05-01', '05-02', '10-01', '18-02', '19-02',
  '20-01', '20-02', '21-01', '21-02', '21-03', '22-01', '23-01', '23-02',
  '24-01', '26-02', '27-01', '27-02', '28-01', '28-02', '29-01', '30-01', '50-01',
];

function run(cmd) {
  console.log(`\n>>> ${cmd}`);
  if (APPLY) execSync(cmd, { cwd: root, stdio: 'inherit', timeout: 0 });
}

(async () => {
  console.log(`=== NG 차수 복구 | ${APPLY ? 'APPLY' : 'DRY-RUN'} | weeks=${NG_WEEKS.length} ===`);
  if (!APPLY) { console.log('Add --apply'); return; }

  for (const wk of NG_WEEKS) {
    console.log(`\n========== ${wk} ==========`);
    run(`node scripts/reconcile-week-remain.js ${wk} --apply`);
    run(`node scripts/recalc-gap-products.js ${wk} --apply`);
  }

  console.log(`\n========== 운영차수 ${CURRENT} ==========`);
  run(`node scripts/fix-week-remain-pipeline.js ${CURRENT} --apply`);
  run(`node scripts/fix-guard-negatives.js ${CURRENT} --apply --skip-sync-delete`);
  run(`node scripts/verify-all-weeks-stock.js --current=${CURRENT} --min=1`);
})().catch((e) => { console.error(e); process.exit(1); });
