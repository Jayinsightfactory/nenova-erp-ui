const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function check(root, sha) {
  if (!/^[a-f0-9]{40}$/.test(sha || '')) throw Error('INVALID_DEPLOY_SHA');
  for (const file of ['.next-build/BUILD_ID', '.next-build/server/pages-manifest.json', 'package-lock.json']) {
    if (!fs.existsSync(path.join(root, file))) throw Error(`MISSING_BUILD_FILE:${file}`);
  }
}
function create(root, sha) {
  check(root, sha);
  const manifest = {version: 1, sha, lockSha256: hash(path.join(root, 'package-lock.json')),
    buildId: fs.readFileSync(path.join(root, '.next-build/BUILD_ID'), 'utf8').trim()};
  fs.writeFileSync(path.join(root, '.next-build/ci-manifest.json'), JSON.stringify(manifest));
  return manifest;
}
function verify(root, sha) {
  check(root, sha);
  const m = JSON.parse(fs.readFileSync(path.join(root, '.next-build/ci-manifest.json'), 'utf8'));
  if (m.version !== 1 || m.sha !== sha || m.lockSha256 !== hash(path.join(root, 'package-lock.json')) ||
      m.buildId !== fs.readFileSync(path.join(root, '.next-build/BUILD_ID'), 'utf8').trim()) throw Error('BUILD_MANIFEST_MISMATCH');
  return true;
}
module.exports = {create, verify};
if (require.main === module) {
  const [mode, sha] = process.argv.slice(2);
  if (!['create', 'verify'].includes(mode)) throw Error('INVALID_MODE');
  module.exports[mode](process.cwd(), sha);
  console.log(`CI_BUILD_${mode.toUpperCase()}_OK:${sha}`);
}
