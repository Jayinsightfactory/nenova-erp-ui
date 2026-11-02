const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const store = require('../lib/userActivityStore.cjs');

test('activity worker resolves from deployed lib when API bundle directory differs', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nenova-activity-worker-'));
  const bundled = path.join(directory, 'bundled-api');
  const originalDir = process.env.NENOVA_ACTIVITY_DIR;
  try {
    fs.mkdirSync(bundled);
    const copied = path.join(bundled, 'userActivityAsync.cjs');
    fs.copyFileSync(path.join(__dirname, '../lib/userActivityAsync.cjs'), copied);
    process.env.NENOVA_ACTIVITY_DIR = path.join(directory, 'records');
    const asyncStore = require(copied);
    const id = randomUUID();
    const result = await asyncStore.appendEvents(
      { userId: 'worker-resolution-test', userName: 'test' },
      [{ id, kind: 'click', path: '/test' }], 'web'
    );
    assert.equal(result.written, 1);
    assert.equal((await store.listEvents({ userId: 'worker-resolution-test' })).items[0].id, id);
  } finally {
    if (originalDir === undefined) delete process.env.NENOVA_ACTIVITY_DIR;
    else process.env.NENOVA_ACTIVITY_DIR = originalDir;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
