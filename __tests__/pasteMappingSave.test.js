import assert from 'node:assert/strict';
import { createPasteMappingSaver, uniquePasteMappingItems } from '../lib/pasteMappingSave.js';

const product = (ProdKey = 42) => ({
  ProdKey,
  ProdName: `Product ${ProdKey}`,
  DisplayName: `Display ${ProdKey}`,
  FlowerName: 'Rose',
  CounName: 'Colombia',
});

const item = (inputName = 'Moonlight Pink') => ({ inputName, qty: 12, unit: 'bunch', year: 2025 });

// A mapping becomes locally visible only after the server confirms it, and the
// confirmed server key is retained as the canonical cache key.
{
  const calls = [];
  const saved = [];
  const states = [];
  let resolvePost;
  const saver = createPasteMappingSaver({
    post: payload => { calls.push(payload); return new Promise(resolve => { resolvePost = resolve; }); },
    onSaved: value => saved.push(value),
    onState: value => states.push(value),
  });
  const pending = saver.save(item(), product());
  await Promise.resolve();
  assert.equal(calls.length, 1);
  assert.deepEqual(saved, []);
  assert.equal(states.at(-1).pending, 1);
  resolvePost({ success: true, key: 'canonical/server/key' });
  const result = await pending;
  assert.deepEqual(result, {
    key: 'canonical/server/key',
    value: { prodKey: 42, prodName: 'Product 42', displayName: 'Display 42', flowerName: 'Rose', counName: 'Colombia', manual: true },
  });
  assert.deepEqual(saved, [result]);
  assert.equal(states.at(-1).pending, 0);
  assert.equal(calls[0].force, true);
}

// An HTTP response with success:false is a failure, not a local commit.
{
  const saved = [];
  const states = [];
  const saver = createPasteMappingSaver({
    post: async () => ({ success: false, error: 'rejected' }),
    onSaved: value => saved.push(value),
    onState: value => states.push(value),
  });
  assert.equal(await saver.save(item('Rejected Rose'), product()), null);
  assert.deepEqual(saved, []);
  assert.equal(states.at(-1).failures[0].error, 'rejected');
}

// Network exceptions are retained for an explicit retry; retry is not automatic.
{
  let count = 0;
  const saved = [];
  const saver = createPasteMappingSaver({
    post: async () => { count++; throw new Error('offline'); },
    onSaved: value => saved.push(value),
  });
  assert.equal(await saver.save(item('Offline Rose'), product()), null);
  assert.equal(count, 1);
  assert.deepEqual(saved, []);
  assert.equal((await saver.retry())[0], null);
  assert.equal(count, 2);
  assert.deepEqual(saved, []);
}

// Writes are serialized, and an explicit retry can replace the failed mapping.
{
  let active = 0;
  let maxActive = 0;
  let attempts = 0;
  const saved = [];
  const states = [];
  const saver = createPasteMappingSaver({
    post: async () => {
      attempts++;
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
      return attempts === 1 ? { success: false, error: 'temporary' } : { success: true, key: 'server/rose' };
    },
    onSaved: value => saved.push(value),
    onState: value => states.push(value),
  });
  const first = saver.save(item('Rose'), product(42));
  const second = saver.save(item('Lily'), product(43));
  await Promise.all([first, second]);
  assert.equal(maxActive, 1);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].key, 'server/rose');
  assert.deepEqual(states.at(-1).failures.map(failure => failure.key), ['rose']);
}

// A later success for the same alias clears its earlier failure entry.
{
  let attempts = 0;
  const states = [];
  const saved = [];
  const saver = createPasteMappingSaver({
    post: async () => ++attempts === 1
      ? { success: false, error: 'try again' }
      : { success: true, key: 'server/orchid' },
    onState: value => states.push(value),
    onSaved: value => saved.push(value),
  });
  assert.equal(await saver.save(item('Orchid'), product(71)), null);
  assert.equal(states.at(-1).failures.length, 1);
  const [retried] = await saver.retry();
  assert.equal(retried.key, 'server/orchid');
  assert.deepEqual(states.at(-1).failures, []);
  assert.equal(saved.length, 1);
}

// Invalid aliases and invalid product keys are ignored without posting.
{
  let requests = 0;
  const saver = createPasteMappingSaver({ post: async () => { requests++; return { success: true, key: 'x' }; } });
  assert.equal(await saver.save(item('  '), product()), null);
  assert.equal(await saver.save(item('Rose'), product(0)), null);
  assert.equal(await saver.save(item('Rose'), product('not-a-key')), null);
  assert.equal(requests, 0);
}

// Conflicting products for a normalized alias quarantine all rows for that alias;
// identical-product duplicates dedupe to their first source row. Inputs stay intact.
{
  const conflictA = { ...item('Rose Box 12'), prodKey: 42 };
  const conflictB = { ...item('rose 24 bunch'), prodKey: 99 };
  const duplicateA = { ...item('Lily 8'), qty: 8, prodKey: 7 };
  const duplicateB = { ...item('lily 10'), qty: 10, prodKey: 7 };
  const laterYear = { ...item('Orchid Box 12'), year: 2026, qty: 3, prodKey: 42 };
  const originals = [conflictA, conflictB, duplicateA, duplicateB, laterYear];
  const snapshots = originals.map(value => ({ ...value }));
  const result = uniquePasteMappingItems(originals);
  assert.deepEqual(result.conflicts, ['rose']);
  assert.deepEqual(result.items, [duplicateB, laterYear]);
  assert.deepEqual(originals, snapshots);
  assert.equal(result.items[0].qty, 10);
  assert.equal(result.items[0].unit, 'bunch');
  assert.equal(result.items[1].qty, 3);
  assert.equal(result.items[1].unit, 'bunch');
  assert.equal(result.items[1].year, 2026);
}

// Skipped and unusable alias rows never become save candidates.
{
  const result = uniquePasteMappingItems([
    { ...item('Rose 12'), prodKey: 42, skip: true },
    { ...item('   '), prodKey: 42 },
    { ...item('No product'), prodKey: 0 },
  ]);
  assert.deepEqual(result, { items: [], conflicts: [] });
}

// A new modal correction invalidates old failed retry intentions.
{
  let calls = 0;
  const saver = createPasteMappingSaver({ post: async () => { calls++; throw new Error('offline'); } });
  await saver.save(item(), product());
  saver.discardFailures(['Moonlight Pink']);
  await saver.retry();
  assert.equal(calls, 1);
}
{
  let calls = 0;
  const saver = createPasteMappingSaver({ post: async () => { calls++; throw new Error('offline'); } });
  await saver.save(item(), product());
  saver.discardFailures([]);
  saver.discardFailures(['another product']);
  await saver.retry();
  assert.equal(calls, 2, 'unrelated modal edits must retain failed mappings');
}
console.log('pasteMappingSave: all tests passed');
