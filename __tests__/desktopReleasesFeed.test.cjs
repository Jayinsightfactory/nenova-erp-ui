'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

const {
  isAllowedReleaseFile,
  parseLatestYml,
  verifyReleaseStage,
  resolveReleaseFilePath,
} = require('../lib/desktopReleases.cjs');
const { parseArgs, buildPlan } = require('../scripts/local-cafe24-deploy.cjs');

const ROOT = path.join(__dirname, '..');

function makeFixtureRelease(dir, version = '1.3.74', payload = Buffer.from('FAKE-NSIS-INSTALLER-PAYLOAD-0123456789')) {
  const exeName = `Nenova-Desktop-Setup-${version}-x64.exe`;
  const sha512 = crypto.createHash('sha512').update(payload).digest('base64');
  fs.writeFileSync(path.join(dir, exeName), payload);
  fs.writeFileSync(path.join(dir, `${exeName}.blockmap`), Buffer.from('BLOCKMAP'));
  fs.writeFileSync(path.join(dir, 'SHA256.txt'), 'Hash: 0000\n');
  const yml = [
    `version: ${version}`,
    'files:',
    `  - url: ${exeName}`,
    `    sha512: ${sha512}`,
    `    size: ${payload.length}`,
    `path: ${exeName}`,
    `sha512: ${sha512}`,
    `releaseDate: '2026-11-20T03:36:08.655Z'`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'latest.yml'), yml, 'utf8');
  return { exeName, sha512, payload, yml };
}

function makeRes() {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.headers = {};
  res.chunks = [];
  res.headersSent = false;
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.write = (chunk) => {
    res.headersSent = true;
    res.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return true;
  };
  res.end = (chunk) => {
    res.headersSent = true;
    if (chunk !== undefined) res.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    res.body = Buffer.concat(res.chunks);
    res.emit('finish');
    return res;
  };
  res.destroy = () => { res.emit('close'); };
  return res;
}

function invokeHandler(handler, req) {
  return new Promise((resolve) => {
    const res = makeRes();
    res.on('finish', () => resolve(res));
    handler(req, res);
  });
}

test('desktop release allowlist and YAML verification enforce strict filenames and SHA-512', () => {
  assert.equal(isAllowedReleaseFile('latest.yml'), true);
  assert.equal(isAllowedReleaseFile('SHA256.txt'), true);
  assert.equal(isAllowedReleaseFile('Nenova-Desktop-Setup-1.3.74-x64.exe'), true);
  assert.equal(isAllowedReleaseFile('Nenova-Desktop-Setup-1.3.74-x64.exe.blockmap'), true);
  for (const bad of ['../.env', 'foo/latest.yml', 'Nenova-Desktop-Setup-1.3.74-ia32.exe', 'index.html', 'latest.yml\0.txt']) {
    assert.equal(isAllowedReleaseFile(bad), false, bad);
    assert.equal(resolveReleaseFilePath('/tmp/releases', bad), null, bad);
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nenova-desktop-stage-'));
  try {
    const { exeName, yml } = makeFixtureRelease(dir);
    const parsed = parseLatestYml(yml);
    assert.equal(parsed.version, '1.3.74');
    assert.equal(parsed.url, exeName);
    const verified = verifyReleaseStage(dir);
    assert.equal(verified.version, '1.3.74');

    // Tampered installer bytes must fail SHA-512 verification
    const exePath = path.join(dir, exeName);
    const tampered = fs.readFileSync(exePath);
    tampered[0] ^= 0xff;
    fs.writeFileSync(exePath, tampered);
    assert.throws(() => verifyReleaseStage(dir), /sha512 mismatch/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('/api/public/desktop-releases streams latest.yml, .exe, Range 206, HEAD, latest 302 and blocks traversal', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nenova-desktop-route-'));
  const prevEnv = process.env.NENOVA_DESKTOP_RELEASES_DIR;
  process.env.NENOVA_DESKTOP_RELEASES_DIR = dir;
  try {
    const { exeName, payload, yml } = makeFixtureRelease(dir);
    const mod = await import('../pages/api/public/desktop-releases/[...path].js');
    const handler = mod.default;

    // 1. GET latest.yml
    const rYml = await invokeHandler(handler, { method: 'GET', query: { path: ['latest.yml'] }, headers: {} });
    assert.equal(rYml.statusCode, 200);
    assert.match(rYml.headers['content-type'], /text\/yaml/);
    assert.match(rYml.headers['cache-control'], /no-cache/);
    assert.equal(rYml.body.toString('utf8'), yml);

    // 2. HEAD installer
    const rHead = await invokeHandler(handler, { method: 'HEAD', query: { path: [exeName] }, headers: {} });
    assert.equal(rHead.statusCode, 200);
    assert.equal(rHead.headers['content-length'], payload.length);
    assert.equal(rHead.body.length, 0);

    // 3. Range 206 partial content
    const rRange = await invokeHandler(handler, { method: 'GET', query: { path: [exeName] }, headers: { range: 'bytes=0-9' } });
    assert.equal(rRange.statusCode, 206);
    assert.equal(rRange.headers['content-range'], `bytes 0-9/${payload.length}`);
    assert.equal(rRange.body.toString('utf8'), payload.subarray(0, 10).toString('utf8'));

    // 4. Invalid Range -> 416
    const rBadRange = await invokeHandler(handler, { method: 'GET', query: { path: [exeName] }, headers: { range: 'bytes=999999-1000000' } });
    assert.equal(rBadRange.statusCode, 416);

    // 5. /desktop-releases/latest -> 302 redirect to verified exe
    const rLatest = await invokeHandler(handler, { method: 'GET', query: { path: ['latest'] }, headers: {} });
    assert.equal(rLatest.statusCode, 302);
    assert.equal(rLatest.headers.location, `/desktop-releases/${exeName}`);

    // 6. Traversal & disallowed files rejected
    const rTrav = await invokeHandler(handler, { method: 'GET', query: { path: ['..', '.env'] }, headers: {} });
    assert.equal(rTrav.statusCode, 400);
    const rMethod = await invokeHandler(handler, { method: 'POST', query: { path: ['latest.yml'] }, headers: {} });
    assert.equal(rMethod.statusCode, 405);
  } finally {
    if (prevEnv === undefined) delete process.env.NENOVA_DESKTOP_RELEASES_DIR;
    else process.env.NENOVA_DESKTOP_RELEASES_DIR = prevEnv;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('next.config rewrite, DesktopDownloadButton, and CI Actions minute-diet contracts hold', () => {
  const nextCfg = fs.readFileSync(path.join(ROOT, 'next.config.js'), 'utf8');
  assert.match(nextCfg, /source:\s*'\/desktop-releases\/:path\*'.*destination:\s*'\/api\/public\/desktop-releases\/:path\*'/);

  const btn = fs.readFileSync(path.join(ROOT, 'components/DesktopDownloadButton.js'), 'utf8');
  assert.match(btn, /DESKTOP_DOWNLOAD_URL\s*=\s*'\/desktop-releases\/latest'/);
  assert.doesNotMatch(btn, /github\.com\/Jayinsightfactory/);

  // erp-contract.yml keeps required check name "verify", adds PR concurrency cancel, avoids redundant master push
  const erpWf = fs.readFileSync(path.join(ROOT, '.github/workflows/erp-contract.yml'), 'utf8');
  assert.match(erpWf, /^  verify:/m);
  assert.match(erpWf, /concurrency:[\s\S]*cancel-in-progress:\s*\$\{\{\s*github\.event_name == 'pull_request'\s*\}\}/);
  assert.doesNotMatch(erpWf, /on:[\s\S]*?push:\s*\n\s*branches:\s*\[master\]/);

  // desktop-windows.yml adds PR concurrency cancel, fast-pass on non-desktop PRs, and Cafe24 publish + seed
  const deskWf = fs.readFileSync(path.join(ROOT, '.github/workflows/desktop-windows.yml'), 'utf8');
  assert.match(deskWf, /concurrency:[\s\S]*cancel-in-progress:\s*\$\{\{\s*github\.event_name == 'pull_request'\s*\}\}/);
  assert.match(deskWf, /seed_from_release_tag:/);
  assert.match(deskWf, /DESKTOP_FAST_PASS/);
  assert.match(deskWf, /publish-cafe24:/);
  assert.match(deskWf, /verify-desktop-release-stage\.cjs/);
  assert.match(deskWf, /\/var\/lib\/nenova\/desktop-releases/);

  // deploy.yml preserves cancel-in-progress: false and adds early freshness guard before npm ci/build
  const deployWf = fs.readFileSync(path.join(ROOT, '.github/workflows/deploy.yml'), 'utf8');
  assert.match(deployWf, /cancel-in-progress:\s*false/);
  assert.match(deployWf, /STALE_RELEASE_EARLY/);
  assert(deployWf.indexOf('id: freshness') < deployWf.indexOf('npm run build'));

  // local emergency deploy script defaults to safe dry-run
  assert.equal(parseArgs([]).dryRun, true);
  assert.equal(parseArgs(['--apply']).apply, true);
  const plan = buildPlan(ROOT, parseArgs([]));
  assert.equal(plan.mode, 'dry-run');
  assert.match(plan.headSha, /^[a-f0-9]{40}$/);
});
