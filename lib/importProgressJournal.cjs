const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const hash = value => createHash('sha256').update(String(value)).digest('hex');
const count = value => Math.max(0, Number(value) || 0);
function processStamp(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
  } catch { return null; }
}
function workerAlive(record) {
  if (!Number.isSafeInteger(record.pid) || record.pid <= 0) return true;
  try { process.kill(record.pid, 0); } catch (e) { return e.code !== 'ESRCH'; }
  const stamp = processStamp(record.pid);
  return !(stamp && record.processStamp && stamp !== record.processStamp);
}
function summary(result) {
  if (!result) return null;
  const out = { success: result.success === true, recovered: true, appliedRows: [],
    logs: ['보관된 처리 결과를 복구했습니다. 행별 상세는 업로드 이력에서 확인하세요.'] };
  for (const key of ['inputRowCount', 'targetRowCount', 'appliedCount', 'skippedNoChangeCount', 'skippedFixedCount',
    'shipmentChangedCount', 'orderChangedCount', 'orderCreatedCount', 'orderUpdatedCount', 'orderDeletedCount',
    'shipmentCreatedCount', 'shipmentUpdatedCount', 'shipmentDeletedCount', 'auditBatchKey']) {
    if (result[key] != null) out[key] = count(result[key]);
  }
  if (/^\d{2}-\d{2}$/.test(result.week)) out.week = result.week;
  if (result.verification) {
    out.verification = Object.fromEntries(['checked', 'matched', 'mismatchCount'].map(k => [k, count(result.verification[k])]));
    if (result.verification.error) out.verification.error = '사후 검증을 완료하지 못했습니다. 업로드 이력을 확인하세요.';
  }
  if (!out.success) out.error = '저장 후 검증에서 확인할 사항이 있습니다. 업로드 이력을 확인하세요.';
  return out;
}

// Private, same-host journal. Never persist source files, auth tokens, names or row values.
function createImportProgressJournal({ directory, pid = process.pid, alive = workerAlive } = {}) {
  const fileFor = id => path.join(directory, `${hash(id)}.json`);
  const error = () => Object.assign(new Error('작업 결과 보관소를 사용할 수 없습니다. 새 적용을 시작하지 않았습니다.'), {
    code: 'IMPORT_PROGRESS_STORAGE', statusCode: 503,
  });
  function read(id) {
    try {
      const file = fileFor(id);
      if (fs.statSync(file).size > 65536) throw error();
      const row = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (row.version !== 1 || row.jobHash !== hash(id)) throw error();
      return row;
    } catch (e) { if (e.code === 'ENOENT') return null; throw error(); }
  }
  function record(id, owner, p) {
    return { version: 1, jobHash: hash(id), ownerHash: hash(owner), pid, processStamp: processStamp(pid),
      progress: { total: count(p.total), done: count(p.done), stage: String(p.stage || '').slice(0, 80),
        current: '', logs: [], finished: !!p.finished, failed: !!p.failed,
        startedAt: p.startedAt, updatedAt: p.updatedAt,
        auditKey: Number.isSafeInteger(p.auditKey) ? p.auditKey : null,
        year: /^\d{4}$/.test(p.year) ? p.year : null, week: /^\d{2}-\d{2}$/.test(p.week) ? p.week : null,
        result: summary(p.result),
        ...(p.error ? { error: { code: /^[A-Z0-9_]{1,80}$/.test(p.error.code) ? p.error.code : 'IMPORT_APPLY_FAILED',
          message: '적용 작업이 정상 완료되지 않았습니다. 업로드 이력에서 오류를 확인하세요.' } } : {}),
      } };
  }
  return {
    create(id, owner, p) {
      let prepared = false;
      try {
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
        prepared = true;
        fs.writeFileSync(fileFor(id), JSON.stringify(record(id, owner, p)), { flag: 'wx', mode: 0o600 });
        return true;
      } catch (e) { if (prepared && e.code === 'EEXIST') return false; throw error(); }
    },
    save(id, owner, p) {
      const before = read(id);
      if (!before || before.ownerHash !== hash(owner) || before.pid !== pid) throw error();
      if (before.progress.finished) return;
      const tmp = `${fileFor(id)}.${randomUUID()}.tmp`;
      try {
        fs.writeFileSync(tmp, JSON.stringify(record(id, owner, p)), { flag: 'wx', mode: 0o600 });
        fs.renameSync(tmp, fileFor(id));
      } catch { throw error(); }
      finally { try { fs.unlinkSync(tmp); } catch {} }
    },
    get(id, owner) {
      const row = read(id);
      if (!row || row.ownerHash !== hash(owner)) return null;
      return { ...row.progress, workerAlive: row.progress.finished ? false : alive(row) };
    },
    has(id) { return !!read(id); },
  };
}
module.exports = { createImportProgressJournal, workerAlive };
