// Linux flock locks belong to the open file description. The parent retains fd
// after the short flock child exits; closing it (also on process death) releases
// the lease. No customer, filename or quantity is written to this empty file.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const LOCK_PATH = '/var/lib/nenova/import-apply.lock';

function acquireImportApplyLease({ lockPath = LOCK_PATH, enabled = process.env.NODE_ENV === 'production' } = {}) {
  if (!enabled) return () => {};
  let fd;
  let gate;
  try {
    if (process.platform !== 'linux') throw new Error('Linux flock required');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    const lock = descriptor => {
      const result = spawnSync('flock', ['--shared', '--nonblock', '3'], {
        stdio: ['ignore', 'ignore', 'ignore', descriptor], timeout: 5000,
      });
      if (result.error || result.status !== 0) throw new Error('Lease unavailable');
    };
    gate = fs.openSync(`${lockPath}.gate`, 'a', 0o600);
    lock(gate);
    fd = fs.openSync(lockPath, 'a', 0o600);
    lock(fd);
  } catch {
    if (fd !== undefined) fs.closeSync(fd);
    throw Object.assign(new Error('서버 배포 준비 중이어서 분배 적용을 시작하지 않았습니다. 잠시 후 다시 검증하고 적용하세요.'), {
      code: 'IMPORT_DEPLOY_BUSY', statusCode: 503,
    });
  } finally {
    if (gate !== undefined) fs.closeSync(gate);
  }
  let released = false;
  return () => { if (!released) { released = true; fs.closeSync(fd); } };
}

async function withImportApplyLease(work, options) {
  const release = acquireImportApplyLease(options);
  try { return await work(); } finally { release(); }
}

module.exports = { acquireImportApplyLease, withImportApplyLease, LOCK_PATH };
