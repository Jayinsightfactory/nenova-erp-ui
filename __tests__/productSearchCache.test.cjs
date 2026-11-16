const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

test('concurrent cold searches share the catalog, retry failures and invalidate results on edits', async () => {
  let queries = 0, rankings = 0, revision = 1;
  const pending = [];
  const query = () => {
    queries++;
    return new Promise((resolve, reject) => pending.push({resolve, reject}));
  };
  const { cachedRows } = await import('../lib/searchCatalogCache.js');
  const context = { cachedRows,
    global: {}, withAuth: handler => handler, query, sql: {}, MAPPING_STORE_KEYS: {products:'product'},
    readMappingSnapshot: async (_, previous) => previous?.revision === revision ? previous : { revision, document: {} },
    buildProductMappingStats: () => new Map([[1, {count:revision, aliases:[]}]]),
    scoreNaturalLanguageProducts: (q, rows) => {
      rankings++;
      return { candidates: rows.map(source => ({source, conflicts:{}})), alternateCountry: [], query:q };
    },
  };
  const source = fs.readFileSync('pages/api/products/search.js','utf8').replace(/^import [^\n]*$/gm,'')
    .replace('export default withAuth', 'global.handler = withAuth');
  vm.runInNewContext(source, context);
  const search = async (q='장미') => {
    const response = { status(code){this.code=code;return this;}, json(body){this.body=body;} };
    await context.global.handler({query:{q}},response);
    return response;
  };
  const release = (name) => pending.shift().resolve({recordset:[{ProdKey:1,ProdName:name}]});
  const first = search(), second = search();
  assert.equal(queries, 1);
  release('연습1');
  for(const response of await Promise.all([first, second])) assert.equal(response.code,200);
  const warm = await search();
  const warmRankings = rankings;
  assert.strictEqual((await search()).body, warm.body);
  assert.equal(rankings, warmRankings);
  revision++;
  assert.equal((await search()).body.products[0].MappingCount, 2);
  context.global._prodCache.data = null;
  const oldLoad = search();
  context.global._prodCache.data = null;
  const refreshed = search();
  release('변경 전'); release('변경 후');
  await Promise.all([oldLoad, refreshed]);
  assert.equal((await search()).body.products[0].ProdName,'변경 후');
  context.global._prodCache.data = null;
  const failure = search();
  pending.shift().reject(Error('조회 실패'));
  assert.equal((await failure).code,500);
  const retry = search();
  release('재시도');
  assert.equal((await retry).body.products[0].ProdName,'재시도');
});
