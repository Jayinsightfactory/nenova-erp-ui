'use strict';
const path = require('node:path');
const { launch } = require('./workDriveChild.cjs');
const unavailable = () => Object.assign(new Error('물량표 생성 요청이 많거나 응답이 지연됩니다. 잠시 후 물량표 바로 생성을 다시 눌러 주세요. 전산 적용은 실행하지 않았습니다.'), { statusCode: 503, code: 'FIELD_UPLOAD_BUSY' });
const cancelled = () => Object.assign(new Error('물량표 생성 조회를 취소했습니다.'), { statusCode: 499, code: 'FIELD_UPLOAD_CANCELLED' });

// Two CPU children, bounded FIFO and an absolute deadline including queue time.
// A cancelled active slot is retained until its child has actually exited.
function createFieldUploadRenderer({ projectRoot = process.cwd(), start = launch, concurrency = 2, maxQueued = 20, timeoutMs = 55000, idleMs = 20000 } = {}) {
  const slots = Array.from({ length: Math.max(1, Math.min(2, concurrency)) }, () => ({ worker: null, job: null, stopping: false, idle: null }));
  const pending = []; let seq = 0, closed = false;
  function settle(job, error, output) {
    if (job.settled) return;
    job.settled = true; clearTimeout(job.timer); job.signal?.removeEventListener('abort', job.onAbort);
    if (error) job.reject(error); else job.resolve(output);
  }
  async function stop(slot, error = unavailable()) {
    if (slot.stopping) return slot.stopping;
    clearTimeout(slot.idle);
    const worker = slot.worker; slot.worker = null;
    const job = slot.job; slot.job = null;
    // Resolve/reject only after termination, so callers may safely delete temp input.
    slot.stopping = (async () => {
      try { if (worker) await worker.terminate(); } catch { /* exit supervision still releases this slot */ } finally {
        if (job) settle(job, error);
        slot.stopping = false; pump();
      }
    })();
    return slot.stopping;
  }
  function pump() {
    if (closed) return;
    for (const slot of slots) {
      if (!pending.length || slot.job || slot.stopping) continue;
      clearTimeout(slot.idle);
      if (!slot.worker) {
        let worker;
        try { worker = slot.worker = start(path.join(projectRoot, 'lib/shipmentFieldUploadWorker.cjs'), { projectRoot }); }
        catch { settle(pending.shift(), unavailable()); continue; }
        worker.on('error', () => { if (slot.worker === worker) void stop(slot); });
        worker.on('exit', () => { if (slot.worker === worker) void stop(slot); });
        worker.on('message', message => {
          const job = slot.job;
          if (slot.worker !== worker || !job || job.id !== message.id) return;
          slot.job = null; worker.unref();
          settle(job, message.ok ? null : Object.assign(new Error(message.error || '물량표 생성 실패'), { statusCode: Number(message.statusCode) || 400 }), message.ok ? Buffer.from(message.output) : null);
          if (!pending.length) { slot.idle = setTimeout(() => { void stop(slot); }, idleMs); slot.idle.unref?.(); }
          pump();
        });
      }
      const job = slot.job = pending.shift();
      try { slot.worker.ref(); slot.worker.postMessage({ id: job.id, input: job.input }); }
      catch { void stop(slot); }
    }
  }
  function run(input, { signal } = {}) {
    if (closed || signal?.aborted) return Promise.reject(cancelled());
    if (pending.length >= maxQueued && slots.every(slot => slot.job || slot.stopping)) return Promise.reject(unavailable());
    // Explicit allowlist: never forward request, actor, tokens, buffer or DB credentials.
    const data = { filepath: input.filepath, filename: input.filename, farmText: input.farmText, week: input.week, year: input.year,
      customerDirectory: (input.customerDirectory || []).map(row => ({ CustName: row.CustName, OrderCode: row.OrderCode, customerAlias: row.customerAlias })) };
    return new Promise((resolve, reject) => {
      const job = { id: ++seq, input: data, resolve, reject, signal };
      function discard(error) {
        if (job.settled) return;
        const index = pending.indexOf(job);
        if (index >= 0) { pending.splice(index, 1); settle(job, error); return; }
        const slot = slots.find(candidate => candidate.job === job);
        if (slot) void stop(slot, error);
      }
      job.onAbort = () => discard(cancelled());
      job.timer = setTimeout(() => discard(unavailable()), timeoutMs); job.timer.unref?.();
      signal?.addEventListener('abort', job.onAbort, { once: true });
      pending.push(job); pump();
    });
  }
  return { run, async close() {
    closed = true;
    for (const job of pending.splice(0)) settle(job, cancelled());
    await Promise.all(slots.map(slot => stop(slot, cancelled())));
  } };
}
const key = Symbol.for('nenova.shipment-field-upload-renderer.v1');
const directoryKey = Symbol.for('nenova.shipment-field-upload-directory.v1');
function loadFieldUploadDirectory(loader) {
  if (!globalThis[directoryKey]) {
    const loading = Promise.resolve().then(loader);
    const shared = loading.finally(() => { if (globalThis[directoryKey] === shared) delete globalThis[directoryKey]; });
    globalThis[directoryKey] = shared;
  }
  return globalThis[directoryKey];
}
module.exports = { createFieldUploadRenderer, loadFieldUploadDirectory, renderUploadedFieldWorkbook: (input, options) => (globalThis[key] ||= createFieldUploadRenderer()).run(input, options) };
