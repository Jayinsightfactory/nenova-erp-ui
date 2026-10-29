const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('pages/shipment/distribute-import.js', 'utf8');
const recovery = source.slice(source.indexOf('const recoverApplyResult = async () => {'), source.indexOf('const pollTimer = setInterval'));
function run(responses) {
  let calls = 0, now = 0;
  const context = {
    Date: { now: () => now }, AbortSignal, encodeURIComponent,
    setTimeout: fn => { now += 1200; fn(); },
    setApplyResult: () => {}, initialApplyResult: { running: true, logs: [] },
    fileRevision: 1, sheetLoadRef: { current: 1 }, jobId: 'one_post_only',
    fetch: async (url, options) => {
      assert(url.includes('apply-progress?jobId=one_post_only'));
      assert.equal(options.method, undefined, 'recovery never repeats POST');
      const response = responses[Math.min(calls++, responses.length - 1)];
      return { ok: true, status: 200, json: async () => response };
    },
  };
  const promise = vm.runInNewContext(`${recovery}\nrecoverApplyResult()`, context);
  return { promise, calls: () => calls };
}
test('restart missing progress terminates with unknown outcome instead of 12 minute spinner', async () => {
  const r = run([{ progress: null }]);
  await assert.rejects(r.promise, { code: 'IMPORT_PROGRESS_LOST' });
  assert.equal(r.calls(), 10);
});
test('temporarily missing progress can recover the original committed result', async () => {
  const result = { success: true, appliedCount: 381 };
  const r = run([{ progress: null }, { progress: { finished: false } }, { progress: { finished: true, result } }]);
  assert.equal(await r.promise, result);
  assert.equal(r.calls(), 3);
});
test('server failure is surfaced without automatic resubmission', async () => {
  const r = run([{ progress: { finished: true, failed: true, error: { code: 'PREFLIGHT_BLOCKED', message: '확정됨' } } }]);
  assert.equal((await r.promise).code, 'PREFLIGHT_BLOCKED');
});
test('POST and progress fetches have bounded network waits; explicit deploy refusal skips recovery', () => {
  assert(source.includes('signal: AbortSignal.timeout(60000)'));
  assert.equal((source.match(/signal: AbortSignal.timeout\(10000\)/g) || []).length, 2);
  assert(source.includes("if (unavailable?.code === 'IMPORT_DEPLOY_BUSY') data = unavailable;"));
});
