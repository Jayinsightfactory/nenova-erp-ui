const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const source = fs.readFileSync(path.join(__dirname, '../.github/workflows/deploy.yml'), 'utf8');
const deploy = source.slice(source.indexOf('\n  deploy:'));
const host = deploy.slice(deploy.indexOf('      - name: SSH Deploy to Cafe24'));
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';

test('production server script never contacts GitHub, so the repository can become private', () => {
  assert.doesNotMatch(host, /git fetch origin|git pull|git remote set-url|github\.com\/[A-Za-z0-9_-]+\/nenova-erp-ui/);
  assert.match(host, /git fetch --no-tags "\$source_bundle" "\+refs\/heads\/deploy-bundle:refs\/remotes\/origin\/master"/);
  assert.match(host, /git bundle verify "\$source_bundle"/);
  assert.match(host, /git rev-parse origin\/master\)" = "\$DEPLOY_SHA"/);
  assert.match(host, /m\.commitSha!==e\.DEPLOY_SHA/);
  assert.doesNotMatch(source, /GITHUB_TOKEN|GH_TOKEN|PERSONAL_ACCESS_TOKEN/i, 'no GitHub credential is sent to the server');
});

test('runner proves newest master with its own checkout credentials and ships bundle plus metadata', () => {
  const beforeTransfer = deploy.slice(0, deploy.indexOf('      - name: Transfer build to isolated release directory'));
  assert.match(beforeTransfer, /git fetch --no-tags --quiet origin master\s+\[ "\$\(git rev-parse FETCH_HEAD\)" = "\$GITHUB_SHA" \]/);
  assert.match(beforeTransfer, /git bundle create nenova-source\.bundle deploy-bundle "\^\$\{SERVER_HEAD\}"/);
  assert.match(beforeTransfer, /merge-base --is-ancestor "\$SERVER_HEAD" "\$GITHUB_SHA"/);
  assert.match(deploy, /source: nenova-build\.tar\.gz,nenova-source\.bundle,deploy-meta\.json/);
  assert.match(deploy, /envs: [^\n]*SOURCE_BUNDLE_SHA256/);
  assert.doesNotMatch(beforeTransfer, /secrets\.(?!SSH_PASSWORD)/);
});

for (const mode of ['incremental', 'same-commit', 'tampered']) {
  test(`bundle transfer reproduces the exact release commit offline: ${mode}`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nenova-bundle-'));
    const run = (cwd, cmd, expectFail = false) => {
      const r = spawnSync(bash, ['--noprofile', '--norc', '-c', cmd], { cwd, encoding: 'utf8', windowsHide: true });
      if (!expectFail) assert.equal(r.status, 0, `${cmd}\n${r.stdout}${r.stderr}`);
      return r;
    };
    try {
      const runner = path.join(root, 'runner').replaceAll('\\', '/');
      const server = path.join(root, 'server').replaceAll('\\', '/');
      fs.mkdirSync(runner); fs.mkdirSync(server);
      const identity = 'git config user.email t@example.invalid && git config user.name Fixture && git config commit.gpgsign false';
      run(runner, `git init -q -b master && ${identity} && echo one > a.txt && git add . && git commit -qm one`);
      run(root, `git clone -q "${runner}" "${server}" && cd "${server}" && ${identity}`);
      const serverHead = run(server, 'git rev-parse HEAD').stdout.trim();
      run(runner, 'echo two > a.txt && echo extra > b.txt && git add . && git commit -qm two && echo three >> a.txt && git commit -qam three');
      const sha = run(runner, 'git rev-parse HEAD').stdout.trim();
      // Server is cut off from the runner repository: no remote at all.
      run(server, 'git remote remove origin');
      const base = mode === 'same-commit' ? sha : serverHead;
      if (mode === 'same-commit') run(server, `git fetch -q "${runner}" master && git merge -q --ff-only FETCH_HEAD`);
      run(runner, `[ "${base}" = "${sha}" ] && : > nenova-source.bundle || { git branch -f deploy-bundle ${sha} && git bundle create nenova-source.bundle deploy-bundle "^${base}"; }`);
      if (mode === 'tampered') { const f = path.join(runner, 'nenova-source.bundle'); const b = fs.readFileSync(f); b[b.length - 30] ^= 0xff; fs.writeFileSync(f, b); }
      const bundle = `${runner}/nenova-source.bundle`;
      const script = `
        DEPLOY_SHA=${sha}
        if [ "$(git rev-parse HEAD)" = "$DEPLOY_SHA" ]; then
          git update-ref refs/remotes/origin/master "$DEPLOY_SHA" || exit 1
        else
          git bundle verify "${bundle}" || exit 7
          git fetch --no-tags "${bundle}" "+refs/heads/deploy-bundle:refs/remotes/origin/master" || exit 1
        fi
        [ "$(git rev-parse origin/master)" = "$DEPLOY_SHA" ] || exit 8
        git merge --ff-only origin/master || exit 1
        [ "$(git rev-parse HEAD)" = "$DEPLOY_SHA" ]`;
      const r = run(server, script, mode === 'tampered');
      if (mode === 'tampered') {
        // A real deployment also checks SOURCE_BUNDLE_SHA256 first; git itself must reject it too.
        assert.notEqual(r.status, 0);
        assert.notEqual(run(server, 'git rev-parse HEAD').stdout.trim(), sha);
      } else {
        assert.equal(r.status, 0);
        assert.equal(fs.readFileSync(path.join(server, 'a.txt'), 'utf8').replace(/\r/g, ''), 'two\nthree\n');
        assert.equal(run(server, 'git rev-parse HEAD').stdout.trim(), sha);
      }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
}
