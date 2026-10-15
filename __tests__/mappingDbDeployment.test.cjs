const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { assertMappingWritersStopped, assertNoOtherMappingProcesses } = require('../scripts/assert-mapping-writers-stopped.cjs');
const source = fs.readFileSync('.github/workflows/deploy.yml', 'utf8');
const block = source.slice(source.indexOf('# BEGIN ORDER_MAPPING_CUTOVER'), source.indexOf('# END ORDER_MAPPING_CUTOVER'));
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
function run({ flag = 'false', ready = 1, apply = 0, unmigrated = 1, stopped = 0, preflight = 0 } = {}) {
  const script = `
node() {
  printf 'CALL:%s\\n' "$*"
  case "$*" in
    *--check-ready*) return ${ready};;
    *--check-unmigrated*) if [ "\${PRECHECK_DONE:-0}" = "0" ]; then PRECHECK_DONE=1; return ${preflight}; else return ${unmigrated}; fi;;
    *--apply*) return ${apply};;
    *assert-mapping-writers-stopped*) return ${stopped};;
    *) return 99;;
  esac
}
pm2() { printf 'PM2:%s\\n' "$*"; }
mkdir() { :; }
chmod() { :; }
${block}`;
  return spawnSync(bash, ['--noprofile', '--norc', '-c', script], {
    env: { ...process.env, MIGRATE_ORDER_MAPPINGS: flag }, encoding: 'utf8', windowsHide: true,
  });
}
test('ordinary deployment fails before stop and migration when DB is not ready', () => {
  for (const flag of ['', 'false', '0', 'TRUE']) {
    const result = run({ flag });
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stdout, /PM2:|CALL:.*--apply/);
  }
});
test('ready deployment never reimports files even if explicitly requested', () => {
  const result = run({ flag: 'true', ready: 0 });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /PM2:|CALL:.*--apply/);
});
test('explicit cutover stops and verifies all writers before migration', () => {
  const result = run({ flag: 'true' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PM2:stop nenova-erp[\s\S]*assert-mapping-writers-stopped[\s\S]*--apply --writers-stopped/);
  assert.doesNotMatch(result.stdout, /PM2:restart/);
});
test('writer verification failure prevents migration', () => {
  const result = run({ flag: 'true', stopped: 1 });
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout, /CALL:.*--apply/);
});
test('DB connectivity or partial migration failure keeps the old app running', () => {
  const result = run({ flag: 'true', preflight: 1 });
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout, /PM2:|CALL:.*--apply/);
});
test('failed migration restarts legacy only after confirmed empty DB state', () => {
  assert.match(run({ flag: 'true', apply: 1, unmigrated: 0 }).stdout, /PM2:restart nenova-erp/);
  const unknown = run({ flag: 'true', apply: 1, unmigrated: 1 });
  assert.equal(unknown.status, 1);
  assert.doesNotMatch(unknown.stdout, /PM2:restart/);
});
test('DB committed cutover cannot rollback to a file-only build', () => {
  assert.match(source, /migrate_order_mappings:[\s\S]*?default: false/);
  assert.match(source, /if \[ ! -f .next-previous\/\.mapping-db-capable \]; then[\s\S]*?exit 1[\s\S]*?rm -rf .next/);
});
test('PM2 inventory rejects unknown, active, missing and partly stopped writers', () => {
  const stopped = { name: 'nenova-erp', pid: 0, pm2_env: { status: 'stopped', pm_cwd: process.cwd() } };
  assert.equal(assertMappingWritersStopped([stopped]), true);
  assert.throws(() => assertMappingWritersStopped([]));
  assert.throws(() => assertMappingWritersStopped([stopped, { ...stopped, pid: 123 }]));
  assert.throws(() => assertMappingWritersStopped([stopped, { name: 'other-writer', pid: 234, pm2_env: { status: 'online', pm_cwd: process.cwd() } }]));
  assert.throws(() => assertMappingWritersStopped([{ ...stopped, pm2_env: { status: 'online' } }]));
});
test('non-PM2 writers are blocked while migration and deployment ancestors are allowed', () => {
  const root = process.cwd();
  const chain = [{ pid: 30, parentPid: 20, cwd: root }, { pid: 20, parentPid: 10, cwd: root }, { pid: 10, parentPid: 1, cwd: root }];
  assert.equal(assertNoOtherMappingProcesses(chain, [], root, 30), true);
  assert.throws(() => assertNoOtherMappingProcesses([...chain, { pid: 40, parentPid: 1, cwd: root }], [], root, 30), /PID 40/);
  assert.throws(() => assertNoOtherMappingProcesses([...chain, { pid: 50, parentPid: 1, cwd: '/elsewhere', args: [root + require('node:path').sep + 'scripts/train.js'] }], [], root, 30), /PID 50/);
});
