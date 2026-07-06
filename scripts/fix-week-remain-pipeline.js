#!/usr/bin/env node
/** 차수 잔량 정합 파이프라인 (reconcile → sync → align) */
const { execSync } = require('child_process');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const WEEK = process.argv.find((a) => /^\d{2}-\d{2}$/.test(a));
const countryArg = process.argv.find((a) => a.startsWith('--country='));
const COUNTRY = countryArg ? countryArg.slice('--country='.length) : '';
const root = path.join(__dirname, '..');

if (!WEEK) {
  console.error('Usage: node scripts/fix-week-remain-pipeline.js 25-01 [--country=네덜란드] [--apply]');
  process.exit(1);
}

function run(script, extra = '') {
  const country = COUNTRY ? ` --country=${COUNTRY}` : '';
  const cmd = `node scripts/${script} ${WEEK}${country}${extra}${APPLY ? ' --apply' : ''}`;
  console.log(`\n>>> ${cmd}`);
  if (APPLY) {
    execSync(cmd, { cwd: root, stdio: 'inherit', timeout: 600000 });
  } else {
    try { execSync(cmd, { cwd: root, stdio: 'inherit', timeout: 120000 }); } catch { /* dry-run may exit non-zero */ }
  }
}

const label = COUNTRY || '전체';
console.log(`=== ${WEEK} ${label} | ${APPLY ? 'APPLY' : 'DRY-RUN'} ===`);

run('reconcile-week-remain.js');
if (APPLY) {
  run('sync-week-stock-to-live.js', ' --min=5 --include-manual');
  run('align-live-to-ps.js');
  run('fix-all-negative-stock.js');
  run('reconcile-week-remain.js');
  run('align-live-to-ps.js');
}

console.log(`\n=== ${WEEK} ${label} pipeline ${APPLY ? 'done' : 'dry-run done'} ===`);
