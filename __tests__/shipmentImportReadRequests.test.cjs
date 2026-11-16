const test = require('node:test');
const assert = require('node:assert/strict');

test('independent staff reads proceed; replacing a file cancels only that screen reads', async () => {
  const { createImportReadRequests } = await import('../lib/importReadRequests.js');
  for (const count of [2, 5, 10, 20]) {
    const screens = Array.from({ length: count }, () => createImportReadRequests());
    const reads = screens.map(screen => [screen.start('preview'), screen.start('export')]);
    assert(reads.flat().every(read => !read.signal.aborted));
    screens[0].abortAll();
    assert(reads[0].every(read => read.signal.aborted && !read.isCurrent()));
    assert(reads.slice(1).flat().every(read => !read.signal.aborted && read.isCurrent()));
    const fresh = screens[0].start('export');
    reads[0][1].finish();
    assert(fresh.isCurrent(), 'late finally of old request cannot clear newer request');
    screens.forEach(screen => screen.abortAll());
  }
});

test('unresponsive reads time out and remain distinguishable from superseded reads', async () => {
  const { createImportReadRequests } = await import('../lib/importReadRequests.js');
  const timers = new Map(); let next = 0;
  const screen = createImportReadRequests({ schedule: fn => { timers.set(++next, fn); return next; }, cancel: id => timers.delete(id) });
  const first = screen.start('preview');
  const second = screen.start('preview');
  assert(first.signal.aborted && !first.timedOut && !first.isCurrent());
  assert.equal(timers.size, 1);
  [...timers.values()][0]();
  assert(second.signal.aborted && second.timedOut && second.isCurrent());
  second.finish();
  assert.equal(timers.size, 0);
});
