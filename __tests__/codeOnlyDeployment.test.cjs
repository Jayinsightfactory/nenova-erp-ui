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
const os = require('node:os');
const preserve = source.slice(source.indexOf('# BEGIN PRESERVE_BUILD_OUTPUTS'), source.indexOf('# END PRESERVE_BUILD_OUTPUTS'));

test('checkout diagnosis is explicit, read-only and mutually exclusive with deployment', () => {
  assert.match(source, /diagnose_checkout_only:[\s\S]*?default: false/);
  const diagnosis = source.slice(source.indexOf('  diagnose-checkout:'), source.indexOf('  deploy:'));
  assert.match(diagnosis, /inputs.diagnose_checkout_only == true/);
  assert.match(source, /  deploy:\s+if: github.event_name != 'workflow_dispatch' \|\| inputs.diagnose_checkout_only != true/);
  assert.match(diagnosis, /GIT_OPTIONAL_LOCKS=0/);
  assert.match(diagnosis, /git status --short --untracked-files=no/);
  assert.doesNotMatch(diagnosis, /git (?:fetch|pull|merge|restore|reset)|npm |pm2 |\.env|DB_SERVER|git diff --binary/);
});

for (const mode of ['known', 'unknown', 'staged']) {
  test(`deployment preserves files and only restores backed-up build outputs: ${mode}`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nenova-deploy-preserve-'));
    const git = (...args) => {
      const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true });
      assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
    };
    try {
      git('init'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'Fixture');
      fs.writeFileSync(path.join(dir, 'package-lock.json'), 'original');
      fs.writeFileSync(path.join(dir, 'server.js'), 'original code');
      git('add', '.'); git('-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'fixture');
      fs.writeFileSync(path.join(dir, 'package-lock.json'), 'server-generated');
      fs.writeFileSync(path.join(dir, 'runtime.json'), 'must survive');
      if (mode === 'unknown') fs.writeFileSync(path.join(dir, 'server.js'), 'manual change');
      if (mode === 'staged') git('add', 'package-lock.json');
      const r = spawnSync(bash, ['--noprofile', '--norc', '-c', preserve], {
        cwd: dir, encoding: 'utf8', windowsHide: true,
        env: { ...process.env, DEPLOY_SHA:'origin/master', NENOVA_DEPLOY_BACKUP_ROOT: path.join(dir, 'backups').replaceAll('\\', '/') },
      });
      assert.equal(r.status, mode === 'known' ? 0 : 1, r.stderr);
      if (mode === 'unknown') assert.match(r.stdout, /DEPLOY_CHECKOUT_DIRTY:.*server.js/);
      assert.equal(fs.readFileSync(path.join(dir, 'runtime.json'), 'utf8'), 'must survive');
      assert.equal(fs.readFileSync(path.join(dir, 'package-lock.json'), 'utf8'), mode === 'known' ? 'original' : 'server-generated');
      if (mode === 'known') {
        const backup = path.join(dir, 'backups', fs.readdirSync(path.join(dir, 'backups'))[0]);
        assert.equal(fs.readFileSync(path.join(backup, 'package-lock.json'), 'utf8'), 'server-generated');
        assert(fs.readFileSync(path.join(backup, 'tracked-build-output.patch'), 'utf8').includes('server-generated'));
      } else assert(!fs.existsSync(path.join(dir, 'backups')));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

test('push and default dispatch never opt into database migrations', () => {
  assert.doesNotMatch(source, /git reset --hard|git push --force|--no-verify/);
  assert.match(source, /git merge --ff-only "\$DEPLOY_SHA" \|\| exit 1/);
  assert.match(source, /apply_db_migrations:[\s\S]*?type: boolean[\s\S]*?default: false/);
  assert.match(source, /APPLY_DB_MIGRATIONS: \$\{\{ github.event_name == 'workflow_dispatch' && inputs.apply_db_migrations == true && 'true' \|\| 'false' \}\}/);
  assert.match(source, /envs: DEPLOY_SHA,RELEASE_BUNDLE,APPLY_DB_MIGRATIONS,/);
  assert.match(source, /node scripts\/ci-build-release.cjs stage/);
  assert.doesNotMatch(source.slice(source.indexOf('      - name: SSH Deploy to Cafe24')), /npm run build/);
  assert(start > 0 && end > start);
  const outside = source.slice(0, start) + source.slice(end);
  assert.doesNotMatch(outside, /node scripts\/apply-[^\n]+--apply/);
});

for (const mode of ['learned', 'upstream-conflict', 'invalid-json', 'concurrent-save']) {
  test(`learned import units survive a real fast-forward or fail closed: ${mode}`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nenova-deploy-units-'));
    const git = (...args) => {
      const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true });
      assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
    };
    try {
      git('init'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'Fixture');
      fs.mkdirSync(path.join(dir, 'data'));
      const unitPath = path.join(dir, 'data/order-import-units.json');
      fs.writeFileSync(unitPath, '{"seed":{"unit":"송이"}}');
      fs.writeFileSync(path.join(dir, 'server.js'), 'old code');
      git('add', '.'); git('-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'base');
      const base = git('rev-parse', 'HEAD');
      fs.writeFileSync(path.join(dir, 'server.js'), 'new code');
      if (mode === 'upstream-conflict') fs.writeFileSync(unitPath, '{"changedSeed":{}}');
      git('add', '.'); git('-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'release');
      git('update-ref', 'refs/remotes/origin/master', 'HEAD');
      git('switch', '--detach', base);
      const learned = mode === 'invalid-json' ? '{bad' : '{"user-choice":{"unit":"단"}}';
      fs.writeFileSync(unitPath, learned);
      const r = spawnSync(bash, ['--noprofile', '--norc', '-c', preserve], {
        cwd: dir, encoding: 'utf8', windowsHide: true,
        env: { ...process.env, DEPLOY_SHA:'origin/master', NENOVA_DEPLOY_BACKUP_ROOT: path.join(dir, 'backups').replaceAll('\\', '/') },
      });
      const blocked = mode === 'upstream-conflict' || mode === 'invalid-json';
      assert.equal(r.status, blocked ? 1 : 0, r.stderr);
      assert.equal(fs.readFileSync(unitPath, 'utf8'), learned);
      if (blocked) {
        assert.equal(git('rev-parse', 'HEAD'), base);
        assert(!fs.existsSync(path.join(dir, 'backups')));
      } else {
        const backup = path.join(dir, 'backups', fs.readdirSync(path.join(dir, 'backups'))[0]);
        assert.equal(fs.readFileSync(path.join(backup, 'data/order-import-units.json'), 'utf8'), learned);
        const latest = mode === 'concurrent-save' ? '{"newer-choice":{"unit":"박스"}}' : learned;
        if (mode === 'concurrent-save') fs.writeFileSync(unitPath, latest);
        git('merge', '--ff-only', 'origin/master');
        assert.equal(fs.readFileSync(unitPath, 'utf8'), latest);
        assert.equal(fs.readFileSync(path.join(dir, 'server.js'), 'utf8'), 'new code');
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

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
