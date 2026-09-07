const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { transformSync } = require('next/dist/build/swc');

const root = path.resolve(__dirname, '..');

function compileModule(filename, mocks = {}) {
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = transformSync(source, {
    filename,
    jsc: { parser: { syntax: 'ecmascript' }, target: 'es2022' },
    module: { type: 'commonjs' },
  }).code;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = loaded.require.bind(loaded);
  loaded.require = request => (Object.prototype.hasOwnProperty.call(mocks, request) ? mocks[request] : originalRequire(request));
  loaded._compile(compiled, filename);
  return loaded.exports;
}

async function main() {
  const search = compileModule(path.join(root, 'lib/shillaPnlSearch.js'));
  const displayName = compileModule(path.join(root, 'lib/displayName.js'));
  const matching = compileModule(path.join(root, 'lib/naturalLanguageProductMatching.js'), { './displayName.js': displayName });
  const products = [
    { ProdKey: 181, ProdName: 'Anthurium Graciosa 15cm', DisplayName: '', FlowerName: '안시리움', CounName: '네덜란드', OutUnit: '송이' },
    { ProdKey: 182, ProdName: 'Anthurium White 15cm', DisplayName: '', FlowerName: '안시리움', CounName: '네덜란드', OutUnit: '단' },
  ];

  assert.equal(matching.scoreNaturalLanguageProducts('그라시오사', products, { limit: 50 }).candidates[0].prodKey, 181, 'Korean canonical alias finds Graciosa #181');
  assert.equal(matching.scoreNaturalLanguageProducts('graciosa', products, { limit: 50 }).candidates[0].prodKey, 181, 'English search still finds Graciosa #181');
  assert.equal(search.shillaPnlProductSearchUrl(' 그라시오사 '), '/api/products/search?q=%EA%B7%B8%EB%9D%BC%EC%8B%9C%EC%98%A4%EC%82%AC');

  let fetches = 0;
  let prevented = 0;
  const composing = { key: 'Enter', isComposing: true, nativeEvent: { isComposing: true, keyCode: 229 }, currentTarget: { value: '그라시오사' }, preventDefault() { prevented += 1; } };
  assert.equal(search.runShillaPnlSearchEnter(composing, () => { fetches += 1; }), false);
  assert.equal(fetches, 0, 'IME composition Enter must not fetch');
  assert.equal(prevented, 0, 'IME composition Enter remains available to confirm composition');
  const confirmed = { key: 'Enter', isComposing: false, nativeEvent: { isComposing: false }, currentTarget: { value: '그라시오사' }, preventDefault() { prevented += 1; } };
  assert.equal(search.runShillaPnlSearchEnter(confirmed, value => { fetches += 1; assert.equal(value, '그라시오사'); }), true);
  assert.equal(fetches, 1, 'confirmed Enter performs exactly one search');
  assert.equal(prevented, 1, 'confirmed Enter prevents form submission');
  assert.equal(search.runShillaPnlSearchEnter({ key: 'Enter', keyCode: 229, currentTarget: { value: 'x' } }, () => { fetches += 1; }), false, 'keyCode 229 guard covers browsers that only expose legacy IME state');

  assert.equal(search.isCurrentShillaPnlSearchRequest(3, 4), false, 'late response cannot replace later query results');
  assert.equal(search.isCurrentShillaPnlSearchRequest(4, 4), true);
  const manyProducts = Array.from({ length: 52 }, (_, index) => ({ ProdKey: index + 1 }));
  const limited = await search.readShillaPnlProductSearchResponse({ ok: true, status: 200, text: async () => JSON.stringify({ success: true, products: manyProducts }) });
  assert.equal(limited.length, 50, 'Shilla modal displays at most the top 50 ranked products');
  assert.equal(search.shillaPnlSearchEmptyMessage({ hasSearched: false, products: [], error: '' }), '');
  assert.equal(search.shillaPnlSearchEmptyMessage({ hasSearched: true, products: [], error: '' }), '검색 결과 없음');
  assert.equal(search.shillaPnlSearchEmptyMessage({ hasSearched: true, products: [], error: 'network' }), '');
  await assert.rejects(
    search.readShillaPnlProductSearchResponse({ ok: false, status: 502, text: async () => '<html>bad gateway</html>' }),
    /HTTP 502.*오류 화면/,
    'HTML proxy failures are distinguishable from an empty search',
  );
  await assert.rejects(search.readShillaPnlProductSearchResponse({ ok: true, status: 200, text: async () => JSON.stringify({ success: true }) }), /품목 목록을 받지 못했습니다/);
  assert.equal(search.isShillaPnlCompositionEnter({ keyCode: 13, nativeEvent: { keyCode: 229 } }), true);
  await assert.rejects(
    search.readShillaPnlProductSearchResponse({ ok: true, status: 200, text: async () => JSON.stringify({ success: false, error: '검색 권한이 없습니다.' }) }),
    /검색 권한이 없습니다/,
    'a failed search is distinct from zero results',
  );

  const modal = fs.readFileSync(path.join(root, 'components/raum/ShillaProductMatchModal.js'), 'utf8');
  assert.match(modal, /fetch\(shillaPnlProductSearchUrl\(activeQuery\)\)/, 'search remains a GET fetch');
  assert.match(modal, /fetchRaumPnlJson\('\/api\/raum\/shilla-item-mapping'/, 'the row-scoped Shilla POST remains unchanged');
  assert.doesNotMatch(modal, /fetch\(['"]\/api\/raum\/item-mapping/, 'global Raum item-mapping GET/POST is not used by Shilla search');
  console.log('Shilla P&L Korean product-search tests passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
