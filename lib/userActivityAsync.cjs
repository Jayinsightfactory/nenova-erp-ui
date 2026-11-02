const { Worker } = require('node:worker_threads');
const path = require('node:path');

const MAX_PENDING = 2000;
let worker = null;
let nextId = 0;
const pending = new Map();
const health = () => globalThis[Symbol.for('nenova.userActivity.health')] ||= { lastFailure: null, lastSuccessAt: null };

function failPending(error) {
  for (const { reject } of pending.values()) reject(error);
  pending.clear();
}

function getWorker() {
  if (worker) return worker;
  const current = new Worker(path.join(__dirname, 'userActivityWorker.cjs'));
  current.on('message', ({ id, result, error }) => {
    const item = pending.get(id);
    if (!item) return;
    pending.delete(id);
    if (error) {
      health().lastFailure = { at: new Date().toISOString(), code: error.code || 'STORE_ERROR' };
      item.reject(Object.assign(new Error(error.message), { code: error.code }));
    } else {
      health().lastSuccessAt = new Date().toISOString();
      item.resolve(result);
    }
    if (!pending.size) current.unref();
  });
  current.on('error', error => {
    if (worker === current) worker = null;
    failPending(error);
  });
  current.on('exit', code => {
    if (worker === current) worker = null;
    if (pending.size) failPending(new Error(`Activity worker exited (${code})`));
  });
  current.unref();
  worker = current;
  return current;
}

function appendEvents(user, events, source, options = {}) {
  if (pending.size >= MAX_PENDING) return Promise.reject(Object.assign(new Error('Activity queue full'), { code: 'ACTIVITY_QUEUE_FULL' }));
  const current = getWorker();
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    current.ref();
    try { current.postMessage({ id, user, events, source, options, activityDir: process.env.NENOVA_ACTIVITY_DIR || '' }); }
    catch (error) {
      pending.delete(id);
      reject(error);
      if (!pending.size) current.unref();
    }
  });
}

module.exports = { appendEvents };
