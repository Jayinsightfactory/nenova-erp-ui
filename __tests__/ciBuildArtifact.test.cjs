const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {create, verify} = require('../scripts/ci-build-manifest.cjs');
const sha = 'a'.repeat(40);
for (const mode of ['valid', 'wrong-sha', 'wrong-lock', 'missing-build', 'wrong-id', 'corrupt-manifest']) {
  test(`CI artifact identity: ${mode}`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nenova-ci-artifact-'));
    try {
      fs.mkdirSync(path.join(root, '.next-build/server'), {recursive:true});
      fs.writeFileSync(path.join(root, '.next-build/BUILD_ID'), 'fixture-id');
      fs.writeFileSync(path.join(root, '.next-build/server/pages-manifest.json'), '{}');
      fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
      create(root, sha);
      if (mode === 'wrong-lock') fs.writeFileSync(path.join(root, 'package-lock.json'), '{"different":true}');
      if (mode === 'missing-build') fs.unlinkSync(path.join(root, '.next-build/BUILD_ID'));
      if (mode === 'wrong-id') fs.writeFileSync(path.join(root, '.next-build/BUILD_ID'), 'other');
      if (mode === 'corrupt-manifest') fs.writeFileSync(path.join(root, '.next-build/ci-manifest.json'), '{broken');
      if (mode === 'valid') assert.equal(verify(root, sha), true);
      else assert.throws(() => verify(root, mode === 'wrong-sha' ? 'b'.repeat(40) : sha));
    } finally { fs.rmSync(root, {recursive:true, force:true}); }
  });
}
test('CI-only build, checksum before mutation, pinned identity and no runtime files in transfer', () => {
  const s = fs.readFileSync('.github/workflows/deploy.yml', 'utf8');
  const host = s.slice(s.indexOf('      - name: SSH Deploy to Cafe24'));
  assert.doesNotMatch(host, /npm run build|next build/);
  assert(host.indexOf('sha256sum -c -') < host.indexOf('git fetch'));
  assert.match(host, /git rev-parse origin\/master\)" = "\$DEPLOY_SHA"/);
  assert.match(host, /ci-build-manifest\.cjs verify "\$DEPLOY_SHA"/);
  assert(host.indexOf('ci-build-manifest.cjs verify') < host.indexOf('echo "=== atomic build swap'));
  const packing = s.split('\n').find(line => line.includes('tar --exclude=')).trim();
  assert.match(packing, /nenova-build.tar.gz .next-build data\/generated\/full-development-history.json data\/generated\/menu-development-history.json$/);
  assert.doesNotMatch(packing, /\.env|runtime|uploads|node_modules/);
  assert.match(host, /\.next-previous/);
});
