import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { rankProductSearchOptions } from '../lib/productSearchRanking.js';
import { filterProducts } from '../lib/displayName.js';

const products = [
  { ProdKey: 1, ProdName: 'MOON LIGHT', DisplayName: 'Moon Light', FlowerName: '장미', CounName: '콜롬비아', UsageCount: 30 },
  { ProdKey: 2, ProdName: 'PINK MONDIAL', DisplayName: 'Pink Mondial', FlowerName: '장미', CounName: '콜롬비아', UsageCount: 5 },
  { ProdKey: 3, ProdName: 'MOONLIGHT', DisplayName: 'Moonlight Rose', FlowerName: '장미', CounName: '에콰도르', UsageCount: 80 },
  { ProdKey: 4, ProdName: 'HYDRANGEA BLUE', DisplayName: 'Blue Hydrangea', FlowerName: '수국', CounName: '네덜란드', UsageCount: 12 },
];
const workerUrl = new URL('../lib/productSearchWorker.js', import.meta.url).href;
const bridge = `
  import { parentPort } from 'node:worker_threads';
  globalThis.self = { postMessage: data => parentPort.postMessage(data) };
  await import(${JSON.stringify(workerUrl)});
  parentPort.on('message', data => self.onmessage({ data }));
  parentPort.postMessage({ type: 'ready' });
`;
const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(bridge)}`));

function nextResponse(id) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      worker.off('message', onMessage);
      reject(new Error(`worker response timed out: ${id}`));
    }, 10000);
    function onMessage(message) {
      if (message.id !== id) return;
      clearTimeout(timeout);
      worker.off('message', onMessage);
      resolve(message);
    }
    worker.on('message', onMessage);
  });
}

async function search(id, query, { limit = 20, fallback = false } = {}) {
  const response = nextResponse(id);
  worker.postMessage({ id, query, limit, fallback });
  return response;
}

try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('worker startup timed out')), 10000);
    worker.once('error', reject);
    worker.once('message', message => {
      if (message.type !== 'ready') return reject(new Error('unexpected worker startup message'));
      clearTimeout(timeout);
      resolve();
    });
  });
  worker.postMessage({ type: 'products', products });

  // Exact and ranked queries must return the same object order as the main-thread
  // pure function when both receive the same structured-cloned catalog.
  for (const [id, query, limit] of [[1, 'moon light', 20], [2, 'pink mondial', 2], [3, 'hydrangea blue', 1]]) {
    const response = await search(id, query, { limit });
    assert.equal(response.error, undefined);
    const expected = rankProductSearchOptions(query, products, { limit });
    assert.deepEqual(response.indices.map(index => products[index]), expected, `ranking parity for ${query}`);
  }

  // Chosung matching is supplied by filterProducts as the worker fallback.
  const fallbackProducts = [
    { ProdKey: 50, ProdName: 'ROSE', DisplayName: '장미', FlowerName: '장미', CounName: '콜롬비아' },
  ];
  assert.deepEqual(rankProductSearchOptions('ㅈㅁ', fallbackProducts), []);
  worker.postMessage({ type: 'products', products: fallbackProducts });
  const fallback = await search(4, 'ㅈㅁ', { fallback: true, limit: 3 });
  assert.deepEqual(fallback.indices.map(index => fallbackProducts[index]), filterProducts(fallbackProducts, 'ㅈㅁ').slice(0, 3));
  const noFallback = await search(5, 'ㅈㅁ', { fallback: false });
  assert.deepEqual(noFallback.indices, []);

  // Malformed catalog state throws inside the worker and is surfaced as an error
  // response instead of crashing the worker thread.
  worker.postMessage({ type: 'products', products: null });
  const errorResponse = await search(6, 'moon light');
  assert.equal(errorResponse.id, 6);
  assert.equal(typeof errorResponse.error, 'string');
  assert.ok(errorResponse.error.length > 0);
} finally {
  await worker.terminate();
}

console.log('product search worker: ranking parity, fallback, and error response passed');
