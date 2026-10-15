'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { fork } = require('node:child_process');

function createJournal(directory) {
  function save(name, value) {
    fs.mkdirSync(directory, { recursive: true });
    const target = path.join(directory, name), temp = target + '.' + randomUUID() + '.tmp';
    const fd = fs.openSync(temp, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, target);
    if (process.platform !== 'win32') { const dir = fs.openSync(directory, 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); } }
  }
  function append(value) {
    fs.mkdirSync(directory, { recursive: true });
    const fd = fs.openSync(path.join(directory, 'attempts.jsonl'), 'a', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify({ at: new Date().toISOString(), ...value }) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
  function read(name = 'retry.json') {
    try { return JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  }
  return { save, append, read };
}

function startRecoveryWorker({ directory, forkFn = fork, intervalMs = 15000, deadlineMs = 120000, journal = createJournal(directory), now = Date.now } = {}) {
  let child = null, stopped = false, timer, deadline, attempt, result, candidate, retryFile, attemptStarted;
  function log(value) { try { journal.append(value); } catch { console.error('[stock-recovery] JOURNAL_WRITE_FAILED'); } }
  function schedule() { if (!stopped) { timer = setTimeout(tick, intervalMs); timer.unref?.(); } }
  function tick() {
    if (stopped || child) return;
    attempt = randomUUID(); result = null; candidate = null; retryFile = null; attemptStarted = false;
    try {
      child = forkFn(path.join(__dirname, '..', 'scripts', 'pending-stock-recovery-child.cjs'), [], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: process.env });
    } catch { log({ attempt, phase: 'failed', code: 'CHILD_START_FAILED' }); schedule(); return; }
    const running = child;
    deadline = setTimeout(() => { result = { status: 'unknown', code: 'CHILD_DEADLINE_DISCONNECT' }; log({ attempt, phase: 'timeout', ...result }); running.kill('SIGKILL'); }, deadlineMs);
    deadline.unref?.();
    running.on('message', message => {
      if (running !== child || !message || typeof message !== 'object') return;
      if (message.type === 'candidate') {
        try {
          const scope = message.scope;
          if (!scope || !/^\d{4}$/.test(scope.orderYear) || !/^\d{2}-\d{2}$/.test(scope.orderWeek) || typeof scope.ownerToken !== 'string' || typeof scope.lockedAt !== 'string') throw Error('Invalid candidate');
          candidate = scope;
          const fingerprint = createHash('sha256').update(JSON.stringify(scope)).digest('hex');
          retryFile = `retry-${fingerprint}.json`;
          const saved = journal.read(retryFile), prior = saved.fingerprint === fingerprint ? saved : { attempts: 0, nextAt: 0 };
          if (prior.attempts >= 5 || prior.nextAt > now()) {
            running.send({ type: 'decision', allow: false }); return;
          }
          const count = prior.attempts + 1;
          journal.append({ attempt, phase: 'started', scope, count });
          journal.save(retryFile, { fingerprint, attempts: count, nextAt: now() + Math.min(300000, 30000 * 2 ** (count - 1)) });
          journal.save('status.json', { at: new Date().toISOString(), attempt, status: 'running', scope, count });
          attemptStarted = true;
          running.send({ type: 'decision', allow: true });
        } catch { log({ attempt, phase: 'failed', code: 'RECOVERY_JOURNAL_UNAVAILABLE' }); running.send({ type: 'decision', allow: false }); }
      } else if (message.type === 'result') {
        result = message.result;
      }
    });
    running.on('error', () => { result = { status: 'unknown', code: 'CHILD_PROCESS_ERROR' }; });
    // No new child until actual process exit closes every SQL socket.
    running.on('close', (code, signal) => {
      if (running !== child) return;
      clearTimeout(deadline); child = null;
      const final = result || { status: 'unknown', code: 'CHILD_EXIT_WITHOUT_RESULT' };
      if (code !== 0 && final.status === 'recovered') { final.status = 'unknown'; final.code = 'CHILD_EXIT_AFTER_COMMIT'; }
      try { journal.save('heartbeat.json', { at: new Date().toISOString(), pid: process.pid, workerRevision: 1, status: final.status, code: final.code }); } catch { console.error('[stock-recovery] HEARTBEAT_WRITE_FAILED'); }
      if (attemptStarted || final.status !== 'skipped') {
        log({ attempt, phase: 'finished', scope: candidate, result: final, exitCode: code, signal });
        try {
          if (final.status === 'recovered' && retryFile) journal.save(retryFile, {});
          const retry = retryFile ? journal.read(retryFile) : {};
          journal.save('status.json', { at: new Date().toISOString(), attempt, scope: candidate, ...final, paused: retry.attempts >= 5, attempts: retry.attempts || 0 });
          if (retry.attempts >= 5) console.error('[stock-recovery] RETRIES_EXHAUSTED; inspect persistent status.json');
        } catch { console.error('[stock-recovery] STATUS_WRITE_FAILED; commit outcome must be checked'); }
      }
      schedule();
    });
  }
  schedule();
  return { tick, async stop() {
    stopped = true; clearTimeout(timer); clearTimeout(deadline);
    if (child) { const running = child; await new Promise(resolve => { running.once('close', resolve); running.kill('SIGKILL'); }); }
  }, active: () => !!child };
}
module.exports = { createJournal, startRecoveryWorker };
