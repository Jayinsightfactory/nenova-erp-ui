import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const hookPath = fileURLToPath(new URL('../lib/useRankedProductSearch.js', import.meta.url));
let source = fs.readFileSync(hookPath, 'utf8')
  .replace("import { useEffect, useRef, useState } from 'react';", 'const { useEffect, useRef, useState } = globalThis.mockReact;')
  .replace('export default function useRankedProductSearch', 'function useRankedProductSearch')
  .replace('import.meta.url', JSON.stringify(new URL('../lib/useRankedProductSearch.js', import.meta.url).href));
source += '\nglobalThis.useRankedProductSearch = useRankedProductSearch;';

function createHookHarness({ throwOnCreate = false } = {}) {
  let cursor = 0;
  let hookState = [];
  let hookRefs = [];
  let effects = [];
  let pendingEffects = [];
  let nextTimerId = 1;
  const timers = new Map();
  const workers = [];

  class FakeWorker {
    constructor(url) {
      if (throwOnCreate) throw new Error('worker disabled in test');
      this.url = String(url);
      this.messages = [];
      this.terminated = false;
      workers.push(this);
    }
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; }
    emit(data) { this.onmessage?.({ data }); }
  }

  const mockReact = {
    useState(initial) {
      const index = cursor++;
      if (!(index in hookState)) hookState[index] = initial;
      return [hookState[index], value => { hookState[index] = typeof value === 'function' ? value(hookState[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in hookRefs)) hookRefs[index] = { current: initial };
      return hookRefs[index];
    },
    useEffect(effect, deps) {
      const index = cursor++;
      const previous = effects[index];
      const changed = !previous || deps.some((value, i) => !Object.is(value, previous.deps[i]));
      if (changed) pendingEffects.push({ index, effect, deps });
    },
  };
  const context = vm.createContext({
    console,
    URL,
    Worker: FakeWorker,
    mockReact,
    setTimeout(callback, delay) {
      const id = nextTimerId++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext(source, context, { filename: hookPath });

  function render(...args) {
    cursor = 0;
    pendingEffects = [];
    const result = context.useRankedProductSearch(...args);
    for (const pending of pendingEffects) {
      effects[pending.index]?.cleanup?.();
      const cleanup = pending.effect();
      effects[pending.index] = { deps: pending.deps, cleanup };
    }
    return result;
  }
  function runTimers() {
    const current = [...timers.entries()];
    timers.clear();
    for (const [, timer] of current) timer.callback();
    return current.map(([, timer]) => timer.delay);
  }
  function unmount() {
    for (const effect of effects) effect?.cleanup?.();
    effects = [];
  }
  return { render, runTimers, unmount, timers, workers };
}

const products = [
  { ProdKey: 1, ProdName: 'MOON LIGHT', DisplayName: 'Moon Light' },
  { ProdKey: 2, ProdName: 'PINK MONDIAL', DisplayName: 'Pink Mondial' },
];

// The hook waits for the debounce, exposes no stale candidates on a new query,
// and maps worker indices back onto the current catalog objects.
{
  const harness = createHookHarness();
  const options = { enabled: true, limit: 20, fallback: true };
  let result = harness.render('', products, options);
  assert.equal(result.results.length, 0);
  assert.equal(result.loading, false);
  assert.equal(result.error, '');
  const [worker] = harness.workers;
  assert.match(worker.url, /productSearchWorker\.js$/);
  assert.equal(worker.messages[0].type, 'products');
  assert.equal(worker.messages[0].products.length, products.length);

  result = harness.render('Moon Light', products, options);
  assert.equal(result.loading, true);
  assert.equal(result.results.length, 0);
  assert.deepEqual(harness.runTimers(), [180]);
  const oldRequest = worker.messages.at(-1);
  assert.equal(oldRequest.query, 'Moon Light');

  result = harness.render('Pink Mondial', products, options);
  assert.equal(result.loading, true);
  assert.equal(result.results.length, 0, 'old query results are hidden immediately');
  harness.runTimers();
  const currentRequest = worker.messages.at(-1);
  assert.notEqual(currentRequest.id, oldRequest.id);
  worker.emit({ id: oldRequest.id, indices: [0] });
  result = harness.render('Pink Mondial', products, options);
  assert.equal(result.loading, true, 'stale worker reply does not settle current query');
  worker.emit({ id: currentRequest.id, indices: [1] });
  result = harness.render('Pink Mondial', products, options);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0], products[1]);
  assert.equal(result.loading, false);
  assert.equal(result.error, '');

  result = harness.render('', products, options);
  assert.equal(result.results.length, 0);
  assert.equal(result.loading, false);
  assert.equal(result.error, '');
  harness.unmount();
  assert.equal(worker.terminated, true, 'unmount terminates worker');
}

// Catalog replacement terminates the old worker and sends the new catalog;
// disabling search also tears the worker down and clears active results.
{
  const harness = createHookHarness();
  const options = { enabled: true, fallback: false };
  harness.render('Moon', products, options);
  const firstWorker = harness.workers[0];
  const nextProducts = [...products, { ProdKey: 3, ProdName: 'BLUE HYDRANGEA', DisplayName: 'Blue Hydrangea' }];
  let result = harness.render('Blue', nextProducts, options);
  const secondWorker = harness.workers[1];
  assert.equal(firstWorker.terminated, true);
  assert.equal(secondWorker.messages[0].type, 'products');
  assert.equal(secondWorker.messages[0].products.length, 3);
  assert.equal(result.loading, true);

  result = harness.render('Blue', nextProducts, { ...options, enabled: false });
  assert.equal(result.results.length, 0);
  assert.equal(result.loading, false);
  assert.equal(result.error, '');
  assert.equal(secondWorker.terminated, true);
  harness.unmount();
}

// A startup error that fires while the query is blank is remembered and surfaced
// when search becomes active; it must not get lost before a request exists.
{
  const harness = createHookHarness();
  harness.render('', products, { enabled: true });
  const worker = harness.workers[0];
  worker.onerror();
  harness.render('Moon', products, { enabled: true });
  const result = harness.render('Moon', products, { enabled: true });
  assert.equal(result.loading, false);
  assert.match(result.error, /불러오지 못했습니다/);
  assert.equal(worker.messages.length, 1, 'failed worker receives no query request');
}
{
  const harness = createHookHarness();
  harness.render('Moon', products, { enabled: true });
  const worker = harness.workers[0];
  worker.onerror();
  const result = harness.render('Moon', products, { enabled: true });
  assert.match(result.error, /품목 검색 모듈 오류/);
  harness.unmount();
}

// A worker response deadline reports a clear error and clears loading state.
{
  const harness = createHookHarness();
  harness.render('Moon', products, { enabled: true });
  const worker = harness.workers[0];
  harness.runTimers(); // 180ms debounce posts the query and arms its deadline.
  assert.equal(worker.messages.at(-1).query, 'Moon');
  assert.deepEqual(harness.runTimers(), [15000]);
  const result = harness.render('Moon', products, { enabled: true });
  assert.equal(result.loading, false);
  assert.match(result.error, /응답이 지연/);
  harness.unmount();
}

console.log('ranked product search hook: debounce, stale queries, lifecycle, and errors passed');
