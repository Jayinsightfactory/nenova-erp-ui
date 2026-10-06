const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const babel = require('next/dist/compiled/babel/core');
const XLSX = require('xlsx-js-style');

const modulesReady = Promise.all([
  import('../lib/importPackingState.js'), import('../lib/importPacking.js'),
  import('../lib/importPackingResponse.js'),
  import('../lib/importAwbFields.js'),
]);
const source = fs.readFileSync(require('node:path').join(__dirname, '../components/import-tools/PackingListTool.js'), 'utf8');
const code = babel.transformSync(source.replace("import('xlsx-js-style')", "Promise.resolve(require('xlsx-js-style'))"), {
  filename: 'PackingListTool.js', presets: [require('next/dist/compiled/babel/preset-react')],
  plugins: [require('next/dist/compiled/babel/plugin-transform-modules-commonjs')], configFile: false, babelrc: false,
}).code;
const tick = () => new Promise(setImmediate);
const sameDeps = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const flatten = node => !node || typeof node !== 'object' ? [] : Array.isArray(node)
  ? node.flatMap(flatten) : [node, ...flatten(node.props?.children)];
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node)
  : Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : '';
const item = (country, code, name, other = {}) => ({ country, code, name, ...other });
const initial = { items: [item('CO', 'A', 'CARNATION Doncel'), item('NL', 'A', 'TULIP Dynasty')] };
function catalogFile(rows, name = 'catalog.xlsx') {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['No', 'Code', 'Name', 'Flower', 'Country'], ...rows,
  ]), 'catalog');
  const bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx' });
  return { name, arrayBuffer: async () => bytes };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Actual component handlers with controlled local hooks. No network, DB or browser.
async function harness({ catalog = initial, awb = false, readAwbPdf } = {}) {
  const [state, packing, response, awbFields] = await modulesReady;
  const slots = [], effects = [], readers = [], writes = [], requests = [], extractionCalls = [];
  let cursor = 0, currentCatalog = catalog, failure = null;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value;
      return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef(value) { const i = cursor++; return slots[i] ||= { current: value }; },
    useMemo(fn, deps) { const i = cursor++; if (!sameDeps(slots[i]?.deps, deps)) slots[i] = { deps, value: fn() }; return slots[i].value; },
    useEffect(fn, deps) { const i = cursor++; if (!sameDeps(slots[i]?.deps, deps)) {
      const old = slots[i]; slots[i] = { fn, deps, cleanup: old?.cleanup }; effects.push(i);
    } },
  };
  const storage = {
    get: async key => key === state.PACKING_STORAGE_KEYS.catalog && currentCatalog
      ? { value: JSON.stringify(currentCatalog) } : null,
    set: async (key, value) => { writes.push({ key, value: JSON.parse(value) }); if (failure) throw failure; currentCatalog = JSON.parse(value); return { success: true }; },
    delete: async key => { writes.push({ key, value: null }); if (failure) throw failure; currentCatalog = null; return { success: true }; },
  };
  class Reader {
    constructor() { readers.push(this); }
    readAsDataURL(file) { this.file = file; }
    async complete(base64 = 'JVBERi0x') { this.result = 'data:application/pdf;base64,' + base64; await this.onload(); }
  }
  const fetchStub = (url, options) => {
    const request = { url, options, ...deferred() }; requests.push(request); return request.promise;
  };
  const extractionMock = { async extractPackingDocument({ country, pdfBase64, allowAI }) {
    extractionCalls.push({ country, pdfBase64, allowAI });
    if (allowAI !== true) return { needsAI: true, reason: 'UNSUPPORTED_LAYOUT' };
    const data = await state.readPackingPdfResponse(await fetchStub('/api/import/tools/parse-pdf', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ country, pdfBase64 }),
    }));
    return { data, source: data.source === 'cache' ? 'cache' : 'ai', cacheSaved: data.cacheSaved };
  } };
  const modules = { react, 'xlsx-js-style': XLSX, '../../lib/importPacking.js': packing,
    '../../lib/importPackingState.js': state, '../../lib/importPackingResponse.js': response,
    '../../lib/importAwbFields.js': awbFields, '../../lib/importPackingExtractClient.js': extractionMock };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'fetch', 'FileReader', code + '\nmodule.exports.AWBPanel = AWBPanel;')(
    key => modules[key], module, module.exports, fetchStub, Reader);
  const h = {
    writes, readers, requests, extractionCalls, tree: null,
    render() { cursor = 0; this.tree = awb ? module.exports.AWBPanel({ xlsxLib: XLSX, lang: 'es', readAwbPdf, onBack() {} })
      : module.exports.default({ storage }); return this.tree; },
    effects() { for (const i of effects.splice(0)) { slots[i].cleanup?.(); slots[i].cleanup = slots[i].fn(); } },
    async refresh() { this.render(); this.effects(); await tick(); return this.render(); },
    nodes(type) { return flatten(this.tree).filter(n => n.type === type); },
    button(label) { const button = this.nodes('button').find(n => text(n) === label); assert.ok(button, 'Missing button: ' + label); return button; },
    async click(label) { await this.button(label).props.onClick(); await this.refresh(); },
    async upload(file) { this.nodes('input').find(n => n.props.accept === '.xlsx').props.onChange({ target: { files: [file], value: 'file' } }); await this.refresh(); },
    inputPdf(file) { this.nodes('input').find(n => n.props.accept === '.pdf').props.onChange({ target: { files: [file], value: 'file' } }); this.render(); },
    radio(index) { this.nodes('input').filter(n => n.props.type === 'radio')[index].props.onChange(); this.render(); },
    fail(error) { failure = error; },
    setCatalog(next) { currentCatalog = next; },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
  await h.refresh(); return h;
}

test('merge upserts stable code within country, preserves other countries and retained fields', async () => {
  const [state] = await modulesReady;
  const old = { items: [item('CO', 'A', 'Old name', { note: 'keep' }), item('NL', 'A', 'Other country')] };
  const incoming = { savedAt: 'new', items: [item('CO', 'A', 'Renamed'), item('CO', 'B', 'Added')] };
  const before = JSON.stringify({ old, incoming });
  const preview = state.previewPackingCatalog(old, incoming);
  assert.equal(preview.merge.items.length, 3);
  assert.equal(preview.merge.byCountry.CO[0].name, 'Renamed');
  assert.equal(preview.merge.byCountry.CO[0].note, 'keep');
  assert.equal(preview.merge.byCountry.NL[0].name, 'Other country');
  assert.deepEqual(preview.countries, [
    { country: 'CO', existing: 1, incoming: 2, added: 1, updated: 1, mergeResult: 2, replaceResult: 2 },
    { country: 'NL', existing: 1, incoming: 0, added: 0, updated: 0, mergeResult: 1, replaceResult: 0 },
  ]);
  assert.equal(JSON.stringify({ old, incoming }), before);
});

test('code is stable and fallback names normalize whitespace/case but preserve Korean identity', async () => {
  const [state] = await modulesReady;
  assert.equal(state.packingCatalogKey(item('CO', 0, 'old')), state.packingCatalogKey(item('CO', '0', 'new')));
  assert.notEqual(state.packingCatalogKey(item('NL', 'X', 'Rose')), state.packingCatalogKey(item('CO', 'X', 'Rose')));
  assert.equal(state.packingCatalogKey(item('CO', '', ' rose   mondial ')), state.packingCatalogKey(item('CO', null, 'ROSE MONDIAL')));
  assert.notEqual(state.packingCatalogKey(item('KR', '', '장미')), state.packingCatalogKey(item('KR', '', '백합')));
  const preview = state.previewPackingCatalog({ items: [item('CO', '', 'Rose Mondial')] }, { items: [item('CO', '', 'ROSE MONDIAL')] });
  assert.equal(preview.merge.items.length, 1);
  assert.equal(preview.countries[0].updated, 1);
});

test('duplicate upload keys have deterministic last-row wins and consistent preview totals', async () => {
  const [state] = await modulesReady;
  const preview = state.previewPackingCatalog(null, { items: [item('CO', 'X', 'First'), item('CO', 'X', 'Last'), item('NL', 'X', 'Other')] });
  assert.equal(preview.duplicateRows, 1);
  assert.equal(preview.merge.items.length, 2);
  assert.equal(preview.replace.byCountry.CO[0].name, 'Last');
  assert.equal(preview.countries[0].added, 1);
  assert.throws(() => state.previewPackingCatalog(null, { items: [] }), /Empty/);
  assert.throws(() => state.previewPackingCatalog(null, { items: [null] }), /Invalid/);
});

test('unrelated-country upload preserves all existing duplicate rows, order, metadata and preview counts', async () => {
  const [state] = await modulesReady;
  const old = state.indexPackingCatalog({ items: [
    item('NL', 'DUP', 'First variety', { note: 'first', custom: { batch: 1 } }),
    item('CO', 'A', 'Old CO name'),
    item('NL', 'DUP', 'Second variety', { note: 'second', custom: { batch: 2 } }),
    item('NL', '', 'Fallback name'), item('NL', '', ' fallback   NAME '),
  ] });
  const incoming = { items: [item('CO', 'A', 'Updated CO name'), item('CO', 'DUP', 'New CO product')] };
  const before = JSON.stringify({ old, incoming });
  const preview = state.previewPackingCatalog(old, incoming);
  assert.deepEqual(preview.merge.byCountry.NL, old.byCountry.NL);
  assert.equal(preview.merge.items.length, old.items.length + 1);
  assert.deepEqual(preview.merge.items.slice(0, 5).map(it => it.name),
    ['First variety', 'Updated CO name', 'Second variety', 'Fallback name', ' fallback   NAME ']);
  assert.deepEqual(preview.countries.find(row => row.country === 'NL'),
    { country: 'NL', existing: 4, incoming: 0, added: 0, updated: 0, mergeResult: 4, replaceResult: 0 });
  assert.equal(JSON.stringify({ old, incoming }), before);
});

test('same-country upload of an unrelated key leaves duplicate code and fallback-name rows intact', async () => {
  const [state] = await modulesReady;
  const old = state.indexPackingCatalog({ items: [
    item('CO', 'DUP', 'First'), item('CO', 'DUP', 'Second'),
    item('CO', '', 'Rose Mondial'), item('CO', '', 'ROSE   MONDIAL'),
  ] });
  const preview = state.previewPackingCatalog(old, { items: [item('CO', 'NEW', 'New product')] });
  assert.deepEqual(preview.merge.items.slice(0, old.items.length), old.items);
  assert.equal(preview.countries[0].existing, 4);
  assert.equal(preview.countries[0].mergeResult, 5);
  assert.equal(preview.countries[0].added, 1);
  assert.equal(preview.countries[0].updated, 0);
});

test('incoming key touching existing duplicates rejects clearly instead of choosing an arbitrary row', async () => {
  const [state] = await modulesReady;
  for (const [duplicates, uploaded, keyMessage] of [
    [[item('CO', 'DUP', 'First'), item('CO', 'DUP', 'Second')], item('CO', 'DUP', 'Rename'), 'code DUP'],
    [[item('CO', '', 'Rose Mondial'), item('CO', '', 'ROSE   MONDIAL')], item('CO', '', 'rose mondial'), 'name rose mondial'],
    [[item('CO', 'DUP', 'Identical'), item('CO', 'DUP', 'Identical')], item('CO', 'DUP', 'Rename'), 'code DUP'],
  ]) {
    const old = { items: duplicates };
    const incoming = { items: [item('TH', 'SAFE', 'Unrelated'), uploaded] };
    const before = JSON.stringify({ old, incoming });
    assert.throws(() => state.previewPackingCatalog(old, incoming), error => {
      assert.match(error.message, /Catalog upload blocked: 2 existing products/);
      assert.ok(error.message.includes('country CO'));
      assert.ok(error.message.includes(keyMessage));
      assert.match(error.message, /Resolve the existing duplicates.*no rows were changed/);
      return true;
    });
    assert.equal(JSON.stringify({ old, incoming }), before);
  }
});

test('confirmed unrelated-country merge persists every existing duplicate row', async () => {
  const duplicateCatalog = { items: [
    item('NL', 'DUP', 'First', { note: 'keep first' }),
    item('NL', 'DUP', 'Second', { note: 'keep second' }),
  ] };
  const h = await harness({ catalog: duplicateCatalog });
  await h.upload(catalogFile([[1, 'NEW', 'CO addition', '', '콜롬비아']]));
  assert.equal(h.writes.length, 0);
  await h.click('Confirmar y guardar');
  assert.equal(h.writes.length, 1);
  assert.deepEqual(h.writes[0].value.items.filter(it => it.country === 'NL')
    .map(({ code, name, note }) => ({ code, name, note })),
  duplicateCatalog.items.map(({ code, name, note }) => ({ code, name, note })));
});

test('UI rejects upload touching existing duplicate keys without render crash or shared save', async () => {
  const h = await harness({ catalog: { items: [
    item('CO', 'DUP', 'First'), item('CO', 'DUP', 'Second'),
  ] } });
  await h.upload(catalogFile([[1, 'DUP', 'Uploaded rename', '', '콜롬비아']]));
  assert.doesNotThrow(() => h.render());
  assert.ok(h.nodes('div').some(node => node.props.role === 'alert' && text(node).includes('Catalog upload blocked')));
  assert.ok(text(h.tree).includes('country CO, code DUP'));
  assert.equal(h.nodes('button').filter(node => text(node) === 'Confirmar y guardar').length, 0);
  assert.equal(h.nodes('fieldset')[0].props.disabled, false, 'validation failure does not lock the whole tool');
  assert.equal(h.writes.length, 0);
  await h.upload(catalogFile([[1, 'SAFE', 'Unrelated key', '', '콜롬비아']]));
  assert.ok(!text(h.tree).includes('Catalog upload blocked'));
  assert.equal(h.button('Confirmar y guardar').props.disabled, false);
  assert.equal(h.writes.length, 0);
});

test('reload with newly duplicated keys retains draft, exposes error and blocks save without crashing', async () => {
  const h = await harness();
  await h.upload(catalogFile([[1, 'A', 'Uploaded rename', '', '콜롬비아']], 'retained-draft.xlsx'));
  h.radio(1);
  h.nodes('input').find(node => node.props.type === 'checkbox').props.onChange({ target: { checked: true } });
  h.render(); assert.equal(h.button('Confirmar y guardar').props.disabled, false);
  h.setCatalog({ items: [...initial.items, item('CO', 'A', 'Another team row')] });
  await h.click('Recargar datos compartidos');
  assert.doesNotThrow(() => h.render());
  assert.ok(text(h.tree).includes('retained-draft.xlsx'));
  assert.ok(h.nodes('section').some(node => node.props.role === 'alert' && text(node).includes('Catalog upload blocked')));
  assert.equal(h.button('Confirmar y guardar').props.disabled, true);
  await h.click('Confirmar y guardar');
  assert.equal(h.writes.length, 0, 'even direct invocation of disabled confirm cannot save');
  h.setCatalog(initial);
  await h.click('Recargar datos compartidos');
  assert.ok(!text(h.tree).includes('Catalog upload blocked'));
  assert.ok(text(h.tree).includes('retained-draft.xlsx'));
  assert.equal(h.button('Confirmar y guardar').props.disabled, true, 'replacement consent must be renewed after reload');
  h.radio(0);
  await h.click('Confirmar y guardar');
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].value.items.find(it => it.country === 'CO' && it.code === 'A').name, 'Uploaded rename');
});

test('blocked reload draft can be canceled with no write and no lingering render error', async () => {
  const h = await harness();
  await h.upload(catalogFile([[1, 'A', 'Uploaded rename', '', '콜롬비아']]));
  h.setCatalog({ items: [...initial.items, item('CO', 'A', 'Duplicate')] });
  await h.click('Recargar datos compartidos');
  await h.click('Cancelar');
  assert.doesNotThrow(() => h.render());
  assert.ok(!text(h.tree).includes('Catalog upload blocked'));
  assert.equal(h.writes.length, 0);
});

test('upload only previews; cancel makes zero shared writes and leaves original catalog', async () => {
  const h = await harness();
  await h.upload(catalogFile([[1, 'A', 'Renamed', '', '콜롬비아']]));
  assert.equal(h.writes.length, 0);
  assert.ok(text(h.tree).includes('Vista previa'));
  assert.equal(h.nodes('input').filter(n => n.props.type === 'radio')[0].props.checked, true);
  await h.click('Cancelar');
  assert.equal(h.writes.length, 0);
  assert.ok(text(h.tree).includes('CO:1 · NL:1'));
  assert.ok(!text(h.tree).includes('Vista previa'));
});

test('default merge commits only after confirm, retaining another country', async () => {
  const h = await harness();
  await h.upload(catalogFile([[1, 'A', 'Renamed', '', '콜롬비아'], [2, 'B', 'Added', '', '콜롬비아']]));
  await h.click('Confirmar y guardar');
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].value.items.length, 3);
  assert.equal(h.writes[0].value.items.find(it => it.country === 'NL').name, 'TULIP Dynasty');
  assert.equal(h.writes[0].value.items.find(it => it.country === 'CO' && it.code === 'A').name, 'Renamed');
  assert.ok(!text(h.tree).includes('Vista previa'));
});

test('replace-all requires an extra confirmation, and confirmed replacement removes absent countries', async () => {
  const h = await harness();
  await h.upload(catalogFile([[1, 'Z', 'New', '', '콜롬비아']])); h.radio(1);
  assert.equal(h.button('Confirmar y guardar').props.disabled, true);
  await h.click('Confirmar y guardar'); assert.equal(h.writes.length, 0);
  h.nodes('input').find(n => n.props.type === 'checkbox').props.onChange({ target: { checked: true } }); h.render();
  assert.equal(h.button('Confirmar y guardar').props.disabled, false);
  await h.click('Confirmar y guardar');
  assert.deepEqual(h.writes[0].value.items.map(it => it.country), ['CO']);
});

test('catalog clear requires explicit confirmation and cancellation preserves shared data', async () => {
  const h = await harness();
  await h.click('Borrar'); assert.equal(h.writes.length, 0);
  assert.ok(text(h.tree).includes('¿Borrar TODO'));
  await h.click('Cancelar'); assert.equal(h.writes.length, 0);
  await h.click('Borrar');
  const confirmation = h.nodes('section').find(n => n.props.role === 'alert');
  await flatten(confirmation).find(n => n.type === 'button' && text(n) === 'Borrar').props.onClick(); await h.refresh();
  assert.deepEqual(h.writes, [{ key: 'nenova_catalog', value: null }]);
});

test('409 leaves catalog draft intact; reload rebases preview before confirmed retry', async () => {
  const h = await harness();
  const file = catalogFile([[1, 'A', 'Renamed', '', '콜롬비아']], '<img src=x onerror=alert(1)>.xlsx');
  await h.upload(file); h.fail(Error('409 revision conflict'));
  await h.click('Confirmar y guardar');
  assert.ok(text(h.tree).includes('409 revision conflict'));
  assert.ok(text(h.tree).includes(file.name)); assert.equal(h.nodes('img').length, 0);
  assert.equal(h.nodes('fieldset')[0].props.disabled, true);
  h.fail(null); h.setCatalog({ items: [...initial.items, item('TH', 'T', 'Other team addition')] });
  await h.click('Recargar datos compartidos');
  assert.ok(text(h.tree).includes('Vista previa'));
  await h.click('Confirmar y guardar');
  assert.ok(h.writes[1].value.items.some(it => it.country === 'TH'));
});

test('newer catalog selection wins over late read, including late failures', async () => {
  const h = await harness(); const old = deferred();
  const input = h.nodes('input').find(n => n.props.accept === '.xlsx');
  input.props.onChange({ target: { files: [{ name: 'old.xlsx', arrayBuffer: () => old.promise }], value: '' } });
  // Use the same handler before a render, as with rapid native input events.
  const newest = catalogFile([[1, 'N', 'Newest', '', '태국']], 'newest.xlsx');
  input.props.onChange({ target: { files: [newest], value: '' } });
  await h.refresh(); old.reject(Error('stale parse error')); await h.refresh();
  assert.ok(text(h.tree).includes('newest.xlsx'));
  assert.ok(!text(h.tree).includes('stale parse error'));
  assert.equal(h.writes.length, 0);
});

test('23 unmatched output rows count as 22 source varieties using the confirmation key', async () => {
  const [state, packing] = await modulesReady;
  const descriptions = Array.from({ length: 22 }, (_, i) => 'UNKNOWN VARIETY ' + i);
  const products = [...descriptions, 'unknown variety 0'].map(description => ({ description, pcs: 1, bunch_st: 20, steam_box: 20, total_stems: 20, total_bunch: 1, u_price: 1, t_price: 20 }));
  const generated = packing.genColombia(XLSX, { invoice: 'I', products }, '40', '01', { aliases: {} });
  assert.deepEqual(state.packingUnmatchedCounts(generated), { rows: 23, varieties: 22 });
  assert.equal(state.distinctPackingVarieties(generated.noMatches).length, 22);
  assert.equal(state.isPackingDownloadBlocked(generated), true);
  assert.equal(state.isPackingDownloadBlocked(generated, { overrides: new Set(['CO|I']) }), true);
});

test('source descriptions override transformed output names; decision categories remain blocking', async () => {
  const [state] = await modulesReady;
  const excel = { products: [{ name: 'Mapped name 1', unmatched: true }, { name: 'Mapped name 2', unmatched: true }],
    pending: [{ description: ' same   source ' }], noMatches: [{ description: 'SAME SOURCE' }] };
  assert.deepEqual(state.packingUnmatchedCounts(excel), { varieties: 1, rows: 2 });
  assert.equal(state.distinctPackingVarieties([...excel.pending, ...excel.noMatches]).length, 1);
  for (const facts of [{ pending: excel.pending }, { noMatches: excel.noMatches }, { truncated: true }]) {
    assert.equal(state.isPackingDownloadBlocked({ products: [] }, facts), true);
  }
  const mismatch = { products: [], totalMismatch: { country: 'CO', invoice: '', expected: 90, computed: 10 } };
  assert.equal(state.isPackingDownloadBlocked(mismatch), true);
  assert.equal(state.isPackingDownloadBlocked(mismatch, { overrides: new Set(['CO|']) }), false);
});

test('invoice PDF accepts exact 20MiB, rejects 20MiB + 1 and only sends on explicit AI', async () => {
  const [state] = await modulesReady; const h = await harness();
  h.nodes('div').find(n => n.props.onClick && text(n).includes('Colombia')).props.onClick(); h.render();
  h.inputPdf({ name: '40-1.pdf', type: 'application/pdf', size: state.PACKING_PDF_MAX_BYTES + 1 });
  assert.equal(h.readers.length, 0); assert.ok(text(h.tree).includes('20MiB'));
  h.inputPdf({ name: '40-1.pdf', type: 'application/pdf', size: state.PACKING_PDF_MAX_BYTES });
  assert.equal(h.readers.length, 1); await h.readers[0].complete(); h.render();
  assert.equal(h.requests.length, 0);
  const localProcess = h.button('Generar packing list').props.onClick();
  h.button('Generar packing list').props.onClick();
  assert.equal(h.extractionCalls.length, 1, 'same-tick duplicate local Generate is blocked');
  assert.equal(h.requests.length, 0);
  await localProcess; h.render();
  assert.equal(h.requests.length, 0, 'default Generate must not call AI');
  assert.equal(h.extractionCalls[0].allowAI, false);
  const aiButton = h.button('Analizar con IA (posible coste)');
  const process = aiButton.props.onClick(); aiButton.props.onClick();
  assert.equal(h.extractionCalls[1].allowAI, true);
  assert.equal(h.requests.length, 1, 'same-tick duplicate AI request is blocked');
  h.requests[0].resolve({ ok: false, status: 413, json: async () => { throw Error('Unexpected token <'); } });
  await process; h.render();
  assert.ok(text(h.tree).includes('HTTP 413')); assert.ok(!text(h.tree).includes('Unexpected token'));
});

test('invoice PDF race guard ignores a removed file and older FileReader completion', async () => {
  const h = await harness();
  h.nodes('div').find(n => n.props.onClick && text(n).includes('Colombia')).props.onClick(); h.render();
  h.inputPdf({ name: '40-1.pdf', type: 'application/pdf', size: 10 });
  await h.click('Quitar'); await h.readers[0].complete(); h.render();
  assert.equal(h.button('Generar packing list').props.disabled, true);
  assert.equal(h.requests.length, 0);
});

test('AWB uses the same 20MiB bound and ignores late local parser completion', async () => {
  const [state] = await modulesReady; const parses = [];
  const h = await harness({ awb: true, readAwbPdf: () => { const parse = deferred(); parses.push(parse); return parse.promise; } });
  h.inputPdf({ name: '40-1.pdf', type: 'application/pdf', size: state.PACKING_PDF_MAX_BYTES + 1 });
  assert.equal(h.readers.length, 0);
  h.inputPdf({ name: '40-1.pdf', type: 'application/pdf', size: state.PACKING_PDF_MAX_BYTES });
  const old = h.readers[0].complete();
  h.inputPdf({ name: '41-1.pdf', type: 'application/pdf', size: 10 });
  const latest = h.readers[1].complete();
  parses[1].resolve({ text: 'EXCEL air waybill 999-12345678 more text for the fixture' }); await latest; h.render();
  parses[0].resolve({ text: 'EXCEL air waybill 111-87654321 more text for the fixture' }); await old; h.render();
  assert.ok(h.nodes('input').some(n => n.props.value === '999-12345678'));
  assert.ok(!h.nodes('input').some(n => n.props.value === '111-87654321'));
});

test('PDF response errors handle JSON/HTML 413, gateway failures and structured API errors', async () => {
  const [state] = await modulesReady;
  for (const json of [async () => ({}), async () => { throw Error('<html>'); }]) {
    await assert.rejects(state.readPackingPdfResponse({ ok: false, status: 413, json }), /HTTP 413.*20MiB/);
  }
  await assert.rejects(state.readPackingPdfResponse({ ok: false, status: 502, json: async () => { throw Error('<html>secret</html>'); } }), /HTTP 502.*non-JSON/);
  await assert.rejects(state.readPackingPdfResponse({ ok: false, status: 429, json: async () => ({ error: { message: 'Hourly quota reached' } }) }), /HTTP 429: Hourly quota/);
  const cached = { source: 'cache', cacheSaved: true, content: [] };
  assert.equal(await state.readPackingPdfResponse({ ok: true, status: 200, json: async () => cached }), cached);
});
