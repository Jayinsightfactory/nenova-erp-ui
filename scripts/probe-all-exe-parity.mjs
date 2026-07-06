#!/usr/bin/env node
/** exe parity — 구조 테스트 + 스캔 + (DB 있으면) probe 스크립트 일괄 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

console.log('=== 1/3 exeParitySql structure tests ===');
run('node', ['__tests__/exeParitySql.test.js']);

console.log('\n=== 2/3 scan-exe-forms ===');
run('node', ['scripts/scan-exe-forms.mjs']);

const hasEnv = fs.existsSync(path.join(root, '.env.local'));
if (hasEnv) {
  console.log('\n=== 3/3 DB probes (optional) ===');
  for (const script of [
    'probe-manager-exe-parity.mjs',
    'probe-orders-add-exe-parity.mjs',
    'probe-distribute-exe-parity.mjs',
  ]) {
    console.log(`\n--- ${script} ---`);
    const r = spawnSync('node', [path.join('scripts', script)], { cwd: root, stdio: 'inherit', shell: true });
    if (r.status !== 0) {
      console.warn(`[warn] ${script} failed (non-fatal)`);
    }
  }
} else {
  console.log('\n(skip DB probes — .env.local 없음)');
}

console.log('\n=== probe-all-exe-parity done ===');
