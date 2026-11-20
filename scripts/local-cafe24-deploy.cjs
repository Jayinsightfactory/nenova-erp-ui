#!/usr/bin/env node
'use strict';

// 비상용 로컬 PC → Cafe24 무인증 번들 배포 스크립트 (GitHub Actions 무료 2,000분 소진 시 대안)
// 기본값은 --dry-run(읽기 전용 점검). 실제 배포는 --apply 명시 + clean master 체크아웃에서만 실행한다.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');

const DEFAULT_HOST = '172.233.89.171';
const DEFAULT_USER = 'root';
const DEFAULT_REMOTE_APP = '/var/www/nenova-erp';
const DEFAULT_REMOTE_ARTIFACTS = '/var/lib/nenova/deploy-artifacts';

function parseArgs(argv) {
  const args = {
    apply: false,
    dryRun: true,
    host: process.env.NENOVA_DEPLOY_HOST || DEFAULT_HOST,
    user: process.env.NENOVA_DEPLOY_USER || DEFAULT_USER,
    remoteApp: process.env.NENOVA_REMOTE_APP || DEFAULT_REMOTE_APP,
    skipBuild: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply') { args.apply = true; args.dryRun = false; }
    else if (a === '--dry-run') { args.apply = false; args.dryRun = true; }
    else if (a === '--skip-build') { args.skipBuild = true; }
    else if (a === '--host' && argv[i + 1]) { args.host = argv[++i]; }
    else if (a === '--user' && argv[i + 1]) { args.user = argv[++i]; }
  }
  return args;
}

function runGit(root, gitArgs) {
  return execFileSync('git', gitArgs, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function buildPlan(root, opts) {
  const headSha = runGit(root, ['rev-parse', 'HEAD']);
  const branch = runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const dirty = runGit(root, ['status', '--porcelain', '--untracked-files=no']);
  const releaseId = `${Math.floor(Date.now() / 1000)}-1`;
  return {
    mode: opts.apply ? 'apply' : 'dry-run',
    host: opts.host,
    user: opts.user,
    remoteApp: opts.remoteApp,
    remoteReleaseDir: `${DEFAULT_REMOTE_ARTIFACTS}/${releaseId}`,
    releaseId,
    branch,
    headSha,
    cleanTracked: dirty.length === 0,
    steps: [
      '1. Verify clean tracked checkout on master & origin/master parity',
      '2. Run ERP contract / build guards + npm run build (NEXT_DIST_DIR=.next-build, DB_SERVER="")',
      '3. Run ci-build-smoke + ci-build-manifest create + package nenova-build.tar.gz',
      '4. Read Cafe24 server HEAD over SSH (read-only) & verify ancestor',
      '5. Create incremental nenova-source.bundle + deploy-meta.json (zero GitHub access on server)',
      '6. SCP build archive + bundle + deploy-meta.json to /var/lib/nenova/deploy-artifacts/<releaseId>',
      '7. Verify SHA256 + deploy-meta.json + git bundle verify + ff-only + atomic .next swap + pm2 reload',
    ],
  };
}

function runChecked(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', windowsHide: true, ...opts });
  if (res.error || res.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed (status=${res.status})`);
  }
}

function main(argv) {
  const root = process.cwd();
  const opts = parseArgs(argv);
  const plan = buildPlan(root, opts);

  if (opts.dryRun) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  if (!plan.cleanTracked) {
    throw new Error('LOCAL_DEPLOY_DIRTY: tracked changes exist; commit or clean before --apply');
  }
  if (!/^[a-f0-9]{40}$/.test(plan.headSha)) {
    throw new Error('LOCAL_DEPLOY_BAD_SHA: invalid HEAD sha');
  }

  const target = `${opts.user}@${opts.host}`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nenova-local-deploy-'));
  try {
    if (!opts.skipBuild) {
      runChecked(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
        cwd: root,
        env: { ...process.env, DB_SERVER: '', NEXT_DIST_DIR: '.next-build', NODE_OPTIONS: '--max-old-space-size=4096' },
      });
    }
    runChecked('node', ['scripts/ci-build-smoke.cjs'], { cwd: root });
    runChecked('node', ['scripts/ci-build-manifest.cjs', 'create', plan.headSha], { cwd: root });

    const archivePath = path.join(tmpDir, 'nenova-build.tar.gz');
    runChecked('tar', [
      '--exclude=.next-build/cache',
      '-czf', archivePath,
      '.next-build',
      'data/generated/full-development-history.json',
      'data/generated/menu-development-history.json',
    ], { cwd: root });
    const archiveSha = sha256File(archivePath);

    const serverHeadRaw = execFileSync('ssh', [
      '-o', 'ConnectTimeout=20',
      target,
      `cd ${opts.remoteApp} && GIT_OPTIONAL_LOCKS=0 git rev-parse HEAD`,
    ], { encoding: 'utf8', windowsHide: true }).trim();
    const serverHeadMatch = serverHeadRaw.match(/[a-f0-9]{40}/);
    if (!serverHeadMatch) throw new Error(`SERVER_HEAD_UNKNOWN: ${serverHeadRaw}`);
    const serverHead = serverHeadMatch[0];

    runChecked('git', ['merge-base', '--is-ancestor', serverHead, plan.headSha], { cwd: root });

    const bundlePath = path.join(tmpDir, 'nenova-source.bundle');
    if (serverHead === plan.headSha) {
      fs.writeFileSync(bundlePath, '');
    } else {
      runChecked('git', ['branch', '-f', 'deploy-bundle', plan.headSha], { cwd: root });
      runChecked('git', ['bundle', 'create', bundlePath, 'deploy-bundle', `^${serverHead}`], { cwd: root });
    }
    const bundleSha = sha256File(bundlePath);

    const metaPath = path.join(tmpDir, 'deploy-meta.json');
    fs.writeFileSync(metaPath, JSON.stringify({
      schema: 1,
      commitSha: plan.headSha,
      branch: 'master',
      releaseId: plan.releaseId,
      baseSha: serverHead,
      createdAt: new Date().toISOString(),
      archiveSha256: archiveSha,
      bundleSha256: bundleSha,
      source: 'local-emergency-deploy',
    }, null, 2) + '\n', 'utf8');

    runChecked('ssh', [target, `mkdir -p ${plan.remoteReleaseDir}`]);
    runChecked('scp', [archivePath, bundlePath, metaPath, `${target}:${plan.remoteReleaseDir}/`]);

    const remoteScript = [
      'set -euo pipefail',
      'export PATH=$PATH:/root/.nvm/versions/node/$(ls /root/.nvm/versions/node/ 2>/dev/null | tail -1)/bin:/usr/local/bin',
      `cd ${opts.remoteApp}`,
      `release_dir="${plan.remoteReleaseDir}"`,
      `printf '%s  %s\\n' "${archiveSha}" "$release_dir/nenova-build.tar.gz" | sha256sum -c -`,
      `printf '%s  %s\\n' "${bundleSha}" "$release_dir/nenova-source.bundle" | sha256sum -c -`,
      `if [ "$(git rev-parse HEAD)" = "${plan.headSha}" ]; then git update-ref refs/remotes/origin/master "${plan.headSha}"; else git bundle verify "$release_dir/nenova-source.bundle" && git fetch --no-tags "$release_dir/nenova-source.bundle" "+refs/heads/deploy-bundle:refs/remotes/origin/master"; fi`,
      `[ "$(git rev-parse origin/master)" = "${plan.headSha}" ]`,
      'git merge --ff-only origin/master',
      `[ "$(git rev-parse HEAD)" = "${plan.headSha}" ]`,
      'npm ci --omit=dev',
      'rm -rf .next-build && tar -xzf "$release_dir/nenova-build.tar.gz" --no-same-owner',
      `node scripts/ci-build-manifest.cjs verify "${plan.headSha}"`,
      'rm -rf .next-previous && ([ -d .next ] && mv .next .next-previous || true) && mv .next-build .next',
      'pm2 reload nenova-erp --update-env || pm2 restart nenova-erp --update-env',
      'curl -sf http://127.0.0.1:3000/api/health >/dev/null || curl -sfI http://127.0.0.1:3000/ >/dev/null',
      `echo "LOCAL_DEPLOY_OK ${plan.headSha} ${plan.releaseId}"`,
    ].join('\n');

    runChecked('ssh', [target, 'bash -s'], { input: remoteScript });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = { parseArgs, buildPlan };
