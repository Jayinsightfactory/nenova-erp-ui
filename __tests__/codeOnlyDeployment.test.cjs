const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const source = fs.readFileSync(path.join(__dirname, '../.github/workflows/deploy.yml'), 'utf8');
const start = source.indexOf('# BEGIN EXPLICIT_DB_MIGRATIONS');
const end = source.indexOf('# END EXPLICIT_DB_MIGRATIONS');
const block = source.slice(start, end);
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';

test('push and default dispatch never opt into database migrations', () => {
  assert.match(source, /apply_db_migrations:[\s\S]*?type: boolean[\s\S]*?default: false/);
  assert.match(source, /APPLY_DB_MIGRATIONS: \$\{\{ github.event_name == 'workflow_dispatch' && inputs.apply_db_migrations == true && 'true' \|\| 'false' \}\}/);
  assert.match(source, /envs: APPLY_DB_MIGRATIONS,/);
  assert.match(source, /if ! DB_SERVER='' NEXT_DIST_DIR=\.next-build npm run build/);
  assert(start > 0 && end > start);
  const outside = source.slice(0, start) + source.slice(end);
  assert.doesNotMatch(outside, /node scripts\/apply-[^\n]+--apply/);
});

for (const value of [undefined, '', 'false', '0', 'TRUE', 'true']) {
  test(`migration block only executes with exact explicit true: ${String(value)}`, () => {
    const env = { ...process.env };
    delete env.APPLY_DB_MIGRATIONS;
    if (value !== undefined) env.APPLY_DB_MIGRATIONS = value;
    // Execute the real shell condition, but replace node with a marker function.
    // No script or DB connection is executed by this test.
    const script = 'node() { printf "MIGRATION_MARKER:%s\\n" "$*"; }\n' + block;
    const result = spawnSync(bash, ['--noprofile', '--norc', '-c', script], { env, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    const markers = result.stdout.match(/MIGRATION_MARKER:/g) || [];
    assert.equal(markers.length, value === 'true' ? 13 : 0);
    if (value !== 'true') assert.match(result.stdout, /CODE_ONLY_DEPLOY/);
  });
}
