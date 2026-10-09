const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const XLSX = require('xlsx-js-style');
const babel = require('next/dist/compiled/babel/core');

async function main() {
  const packing = await import('../lib/importPacking.js');
  const state = await import('../lib/importPackingState.js');
  const response = await import('../lib/importPackingResponse.js');
  const prompt = await import('../lib/importPackingPrompt.js');
  const review = await import('../lib/importPackingReview.js');
  const awbFields = await import('../lib/importAwbFields.js');
  const erpMatchHelpers = await import('../lib/importPackingErpMatches.js');
  const receiptAdapter = await import('../lib/importPackingReceiptAdapter.js');
  const root = path.resolve(__dirname, '..');
  const sourcePath = path.join(root, 'output/import-tool-sources/Packing List Nenova.html');
  // Prepared HTML is ignored by Git. Golden fixtures/hashes run without it in CI.
  const source = fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n') : null;
  let passed = 0;
  const check = async (name, run) => { await run(); passed++; console.log('PASS ' + name); };
  const row = { description: 'CARNATION Doncel', pcs: 2, bunch_st: 20, steam_box: 300,
    total_stems: 600, total_bunch: 30, u_price: 0.2, t_price: 120 };
  const invoice = { invoice: 'INV-1', supplier: 'Teucali', awb: '992-1234-5678',
    date: '2026/10/06', raw_date: '2026/10/06', date_kind: 'invoice', date_order: 'YMD',
    currency: 'USD', freight_total: 0, invoice_total: 120, products: [row] };
  const ai = result => ({ content: [{ type: 'text', text: JSON.stringify(result) }], stop_reason: 'end_turn' });
  const catalog = state.indexPackingCatalog({ items: [{ name: 'CARNATION Doncel', country: 'CO' }] });
  const bufferOf = rows => {
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'data');
    return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  };
  await check('original prompts preserved except the verified CO goods-plus-charges correction', () => {
    const correctedCoCheck = '- Sum the t_price values of all products, then add freight_total. Does goods + extras equal invoice_total? If not, you missed a row, duplicated one, or selected the wrong charge/total — re-read the invoice top to bottom. Do NOT compare goods alone to a grand total that includes extras.';
    const originalCoCheck = '- Sum the t_price values of all your products. Does it equal invoice_total? If not, you missed a row or duplicated one — re-read the invoice top to bottom.';
    assert.ok(prompt.buildPrompt('CO').includes(correctedCoCheck));
    const originalPart = country => {
      const part = prompt.buildPrompt(country).split('\n\nMANDATORY HUMAN REVIEW EVIDENCE')[0];
      return country === 'CO' ? part.replace(correctedCoCheck, originalCoCheck) : part;
    };
    const hashes = {
      CO: 'a0c7454452f7fe85d46b6fd5799b8292fe468d03938a8bc6a2b206a4187309a0',
      NL: 'b10cfcaa7bc66b44924bffa6ccee6ee0049e96dc64d25dcf2fb22d1a9647cf75',
      CN: '45e8e196bd04ccd8563ff404c3c6e8f222eb7ccf8a881b30719c6ab01faf198e',
      EC: '9ea4cce8f2461a8e6c21d732029f29c26da9d4e6884a5634959d74dcb91965fa',
      TH: '07e6964383ae6dcefb0cd331f6c79f5d7e214cd3324a8d68c51440fd2d5d313d',
      AU: '259502f79eaa9c362360755a3ef0fc3ede810162d404c032021d96088db79d8d',
      US: '59954e0c51bf5f9ac3e4732842297ead452e4d3aaa5c31fb961de4f53c90be70',
      VN: '2010b95a63ee0da81dd1fd60829956283551a0d4e600fd6af202075d5e14ac29',
    };
    for (const country of prompt.PACKING_COUNTRIES) {
      assert.equal(crypto.createHash('sha256').update(originalPart(country)).digest('hex'), hashes[country]);
      assert.match(prompt.buildPrompt(country), /review_evidence/);
      assert.match(prompt.buildPrompt(country), /Missing\/ambiguous fields MUST use value:null/);
      assert.match(prompt.buildPrompt(country), /not net weight/);
      assert.match(prompt.buildPrompt(country), /Never invent a location/);
    }
    if (source) {
      const a = source.indexOf('function buildPrompt('), b = source.indexOf('function parseWeekFromFilename(', a);
      const original = vm.runInNewContext(source.slice(a, b) + '\nbuildPrompt');
      for (const country of prompt.PACKING_COUNTRIES) assert.equal(originalPart(country), original(country));
    }
    assert.equal(prompt.PACKING_COUNTRIES.length, 8); assert.throws(() => prompt.buildPrompt('XX'), /Unsupported/);
  });
  await check('strict and fenced mock AI responses decode', () => {
    assert.equal(response.parsePackingResponse(ai({ invoices: [invoice] }), 'CO').result.invoices[0].invoice, 'INV-1');
    const fence = String.fromCharCode(96).repeat(3);
    const fenced = { content: [{ type: 'text', text: fence + 'json\n' + JSON.stringify({ invoices: [invoice] }) + '\n' + fence }] };
    assert.equal(response.parsePackingResponse(fenced, 'CO').wasTruncated, false);
  });
  await check('recovery retains complete invoice only and marks actual truncation', () => {
    const partial = { content: [{ type: 'text', text: '{"invoices":[' + JSON.stringify(invoice) + ',{"invoice":"unfinished' }] };
    const decoded = response.parsePackingResponse(partial, 'CO');
    assert.equal(decoded.result.invoices.length, 1); assert.equal(decoded.wasTruncated, true);
    assert.equal(state.isPackingDownloadBlocked({ products: [] }, { truncated: true }), true);
    assert.equal(response.parsePackingResponse({ ...ai({ invoices: [invoice] }), stop_reason: 'max_tokens' }, 'CO').wasTruncated, true);
  });
  await check('malformed rows and invalid quantities fail closed', () => {
    assert.throws(() => response.parsePackingResponse({ content: [] }, 'CO'), /No JSON/);
    for (const bad of [{ invoices: [] }, { invoices: [{ products: 'bad' }] },
      { invoices: [{ products: [{ description: 'X', pcs: -1 }] }] },
      { invoices: [{ products: [{ description: 'X', u_price: 'NaN' }] }] }]) {
      assert.throws(() => response.parsePackingResponse(ai(bad), 'CO'));
    }
  });
  await check('matching rejects wrong family, wrong size and ambiguous ties', () => {
    const item = (name, family) => ({ name, family });
    assert.equal(packing.scoreMatch('ROSE Mondial 50cm', item('ROSE Mondial 60cm', 'ROSE'), 'ROSE'), 0);
    assert.equal(packing.scoreMatch('ROSE Mondial 50cm', item('CARNATION Mondial 50cm', 'CARNATION'), 'ROSE'), 0);
    assert.equal(packing.isConfidentMatch(packing.findBestMatch('ROSE Mondial 50cm',
      [item('ROSE Mondial 50cm', 'ROSE'), item('ROSE Mondial 50cm', 'ROSE')])), false);
  });
  await check('stale aliases require confirmation and repeated rows are deduplicated', () => {
    const context = { farm: 'Teucali', invoice: 'I', pending: [], noMatches: [] };
    const resolve = packing.makeProductResolver('CO', catalog, { 'CARNATION DONCEL': 'Removed product' }, context);
    assert.equal(resolve(row, 0).unmatched, true); assert.equal(resolve(row, 1).unmatched, true);
    assert.equal(context.pending.length + context.noMatches.length, 1);
  });
  await check('missing catalogs cannot produce downloadable CO or NL results', () => {
    const co = packing.genColombia(XLSX, invoice, '40', '01');
    assert.equal(state.isPackingDownloadBlocked(co), true); assert.equal(co.noMatches.length, 1);
    const nl = packing.genNL(XLSX, { invoice: 'NL1', lines: [{ cl: 'CL2', description: 'TULIPA DYNASTY', stems: 10, price: 1 }] }, '40', '01');
    assert.equal(state.isPackingDownloadBlocked(nl), true);
  });
  await check('country packing corrections and invoice mismatch validation preserved', () => {
    assert.equal(packing.stemsPerBunchCO('CARNATION Doncel', 1), 20);
    assert.equal(packing.stemsPerBoxCO('TEU', 'CARNATION Doncel', 100), 300);
    assert.equal(packing.stemsPerBoxCO('OTHER', 'ALSTROMERIA Dubai', 100), 160);
    assert.equal(packing.genColombia(XLSX, invoice, '40', '01', { catalog }).totalMismatch, null);
    const bad = packing.genColombia(XLSX, { ...invoice, invoice_total: 900 }, '40', '01', { catalog });
    assert.equal(bad.totalMismatch.expected, 900); assert.equal(state.isPackingDownloadBlocked(bad), true);
  });
  await check('blank invoice mismatch cannot bypass block; overrides are exact', () => {
    const excel = { name: 'anything.xlsx', products: [], totalMismatch: { country: 'CO', invoice: '', expected: 90, computed: 10 } };
    assert.equal(state.isPackingDownloadBlocked(excel), true);
    assert.equal(state.isPackingDownloadBlocked(excel, { overrides: new Set(['CO|other']) }), true);
    assert.equal(state.isPackingDownloadBlocked(excel, { overrides: new Set(['CO|']) }), false);
    assert.equal(state.isPackingDownloadBlocked({ ...excel, products: [{ unmatched: true }] }, { overrides: new Set(['CO|']) }), true);
  });
  await check('Excel parsing preserves Korean and CJK normalization', () => {
    const parsed = packing.parseCatalog(XLSX, bufferOf([['No','Code','Name','Flower','Country'], [1,'A','ROSE Mondial 50cm','장미','콜롬비아']]));
    assert.equal(parsed.items[0].country, 'CO'); assert.equal(parsed.items[0].flowerKr, '장미');
    assert.equal(packing.aliasKey('Luo shen (洛神)'), 'LUO SHEN');
    assert.deepEqual(packing.parseAliasesXlsx(XLSX, bufferOf([['Invoice','Catalog'], ['Luo shen (洛神)', '장미'], ['','ignored']])), { 'LUO SHEN': '장미' });
  });
  await check('conflicting duplicate aliases rejected, same-value duplicates tolerated', () => {
    assert.throws(() => packing.parseAliasesXlsx(XLSX, bufferOf([['Invoice','Catalog'], ['X','A'], [' x ','B']])), /Conflicting/);
    assert.deepEqual(packing.parseAliasesXlsx(XLSX, bufferOf([['Invoice','Catalog'], ['X','A'], [' x ','A']])), { X: 'A' });
  });
  await check('filename parsing preserves original separators', () => {
    for (const sep of ['-','_','.',' ']) assert.deepEqual(packing.parseWeekFromFilename('19' + sep + '2 Hortensias.pdf'), { week: '19', num: '02' });
    assert.equal(packing.parseWeekFromFilename('invoice.pdf'), null);
  });
  await check('all eight generator formulas and Excel styles match original', () => {
    let original = null;
    if (source) {
      const a = source.indexOf('const KR_COUNTRY_TO_CODE'), b = source.indexOf('// =============================================================================\n// PROMPT BUILDER', a);
      original = vm.runInNewContext(source.slice(a, b) + '\n({genColombia,genNL,genChina,genEcuador,genThailand,genAustralia,genUS,genVN})');
    }
    const fixtures = {
      genColombia: ['CO', invoice], genNL: ['NL', { invoice: 'N', supplier: 'Holex', total_value: 10, lines: [{ cl: 'CL2', description: 'TULIPA DYNASTY', stems: 10, price: 1 }] }],
      genChina: ['CN', { ...invoice, supplier: 'Yunnan Melody', total_value: 6, freight: -2, products: [{ ...row, total_bunch: 40, t_price: 8 }] }],
      genEcuador: ['EC', invoice], genThailand: ['TH', invoice], genAustralia: ['AU', invoice], genUS: ['US', invoice], genVN: ['VN', invoice],
    };
    const canonical = value => JSON.parse(JSON.stringify(value));
    for (const [name, [country, inv]] of Object.entries(fixtures)) {
      const cat = { byCountry: { [country]: [{ name: country === 'NL' ? 'Tulip / Single Dynasty L/Pink' : row.description, family: 'CARNATION' }] } };
      const opts = { catalog: cat, aliases: { [packing.aliasKey(row.description)]: row.description } };
      const captures = [];
      const mock = { ...XLSX, write: wb => { captures.push(canonical(wb)); return new Uint8Array([1]); } };
      packing[name](mock, inv, '40', '01', opts);
      if (original) {
        original[name](mock, inv, '40', '01', opts);
        assert.deepEqual(captures[0], captures[1], name);
      }
      const ws = captures[0].Sheets[captures[0].SheetNames[0]];
      assert.equal(ws['!ref'], 'A1:L58'); assert.equal(ws.B6.s.font.name, 'Calibri');
      assert.equal(ws.L58.f, 'SUM(L6:L57)'); assert.ok(ws['!merges'].length >= 60);
      const formulas = { CO: 'K6*J6', NL: 'K6*J6', CN: 'K6*I6', EC: 'K6*J6',
        TH: 'K6*J6', AU: 'K6*I6', US: 'K6*F6', VN: 'K6*J6' };
      assert.equal(ws.L6.f, formulas[country]);
      assert.equal(ws.A2.s.font.name, 'Bookman Old Style');
      assert.equal(ws.A2.s.border.top.style, 'medium');
      assert.equal(ws.L6.s.numFmt, ['US','VN'].includes(country) ? '#,##0.00;[Red]-#,##0.00' : '#,##0.000;[Red]-#,##0.000');
    }
  });
  await check('long packing sheets retain all rows', () => {
    const captured = [];
    const mock = { ...XLSX, write: wb => { captured.push(wb); return []; } };
    packing.genVN(mock, { ...invoice, products: Array.from({ length: 60 }, () => row) }, '40', '01', { catalog: { byCountry: { VN: [{ name: row.description }] } } });
    const ws = captured[0].Sheets['VN-RB']; assert.equal(ws['!ref'], 'A1:L66'); assert.equal(ws.B65.v, row.description);
  });
  await check('actual xlsx output contains styles and formulas, not only mock metadata', async () => {
    const result = packing.genColombia(XLSX, invoice, '40', '01', { catalog });
    const zip = await require('jszip').loadAsync(result.buf);
    const styles = await zip.file('xl/styles.xml').async('string');
    const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
    assert.match(styles, /Bookman Old Style/); assert.match(styles, /Calibri/);
    assert.match(styles, /style="medium"/); assert.match(styles, /#,##0\.000/);
    assert.match(sheet, /<f>K6\*J6<\/f>/); assert.match(sheet, /<f>SUM\(L6:L57\)<\/f>/);
  });
  await check('async storage reads null initial revision and original JSON strings', async () => {
    const empty = { get: async () => null, set: async () => {}, delete: async () => {} };
    assert.equal((await state.readPackingRecords(empty)).catalog, null);
    const records = await state.readPackingRecords({ ...empty, get: async key => ({ value: JSON.stringify(key === 'nenova_catalog' ? { items: catalog.items } : { CUSTOM: '품목' }) }) });
    assert.equal(records.aliases.CUSTOM, '품목'); assert.equal(records.catalog.byCountry.CO.length, 1);
    await assert.rejects(state.readPackingRecords({ ...empty, get: async () => ({ value: 'broken' }) }));
  });
  await check('shared save/delete errors propagate instead of silent success', async () => {
    const storage = { get: async () => null, set: async () => { throw Error('409 revision conflict'); }, delete: async () => { throw Error('delete failed'); } };
    await assert.rejects(state.savePackingAliases(storage, { X: '품목' }), /409/);
    await assert.rejects(state.writePackingRecord(storage, 'nenova_catalog', null), /delete failed/);
    await assert.rejects(state.writePackingRecord({ ...storage, set: async () => ({ success: false, error: { message: 'denied' } }) }, 'nenova_catalog', {}), /denied/);
    await assert.rejects(state.readPackingRecords(null), /not configured/);
  });
  await check('saved payload omits built-in seed copies', async () => {
    let saved;
    await state.savePackingAliases({ get: async () => null, delete: async () => {}, set: async (key, value) => { saved = { key, value }; } }, { ...packing.ALL_SEED_ALIASES, CUSTOM: '품목' });
    assert.equal(saved.key, 'nenova_aliases'); assert.equal(typeof saved.value, 'string'); assert.deepEqual(JSON.parse(saved.value), { CUSTOM: '품목' });
  });
  const componentSource = fs.readFileSync(path.join(root, 'components/import-tools/PackingListTool.js'), 'utf8');
  await check('native component syntax and server-only credential boundary', () => {
    babel.transformSync(componentSource, { filename: 'PackingListTool.js', presets: [require('next/dist/compiled/babel/preset-react')], configFile: false, babelrc: false });
    assert.doesNotMatch(componentSource, /dangerouslySetInnerHTML|ReactDOM|window\.|localStorage|apiKey|saveApiKey|buildPrompt|cdn\.jsdelivr|api\.anthropic|claude-sonnet/);
    assert.match(componentSource, /extractPackingDocument\(\{country,pdfBase64,readPdf:readAwbPdf,allowAI:allowAI===true\}\)/);
    assert.match(componentSource, /onClick=\{\(\) => process\(false\)\}/);
    assert.match(componentSource, /onClick=\{\(\)=>process\(true\)\}/);
    assert.match(componentSource, /f\.size > PACKING_PDF_MAX_BYTES/);
    assert.equal(state.PACKING_PDF_MAX_BYTES, 20 * 1024 * 1024);
    const extractionSource = fs.readFileSync(path.join(root, 'lib/importPackingExtractClient.js'), 'utf8');
    assert.match(extractionSource, /fetchImpl\('\/api\/import\/tools\/parse-pdf'/);
    assert.match(extractionSource, /JSON\.stringify\(\{country,pdfBase64\}\)/);
    for (const notice of ['AI service', 'servicio de IA', 'AI 서비스']) assert.ok(componentSource.includes(notice));
  });
  // Real handler tests with local hooks; no browser, network, or mounted app.
  await check('UI local-first progress, explicit AI request, 20MiB limit, and confirmed save conflict', async () => {
    const values = [], effects = [], refs = [], memos = [];
    let cursor = 0, effectCursor = 0, refCursor = 0, memoCursor = 0;
    const react = {
      createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
      useState: initial => { const index = cursor++; if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial;
        return [values[index], value => { values[index] = typeof value === 'function' ? value(values[index]) : value; }]; },
      useRef: initial => { const index = refCursor++; return refs[index] ||= { current: initial }; },
      useMemo: (fn, deps) => { const index = memoCursor++; const old = memos[index];
        if (!old || deps.some((d, i) => !Object.is(d, old.deps[i]))) memos[index] = { deps, value: fn() };
        return memos[index].value; },
      useEffect: (fn, deps) => { const index = effectCursor++; const old = effects[index];
        if (!old || deps.some((d,i) => d !== old.deps[i])) effects[index] = { fn, deps, pending: true }; },
    };
    let resolveFetch; const fetchCalls = [], erpReads = [], extractionCalls = [], sharedWrites = [];
    const erpProducts = erpMatchHelpers.packingErpProducts(catalog.items.map((product, index) => ({
      ProdKey: index + 1, ProdCode: product.code ?? `FIXTURE-${index + 1}`, ProdName: product.name,
      CounName: erpMatchHelpers.PACKING_COUNTRIES[product.country], FlowerName: product.flowerKr ?? '',
    })));
    const fetchStub = (url, options) => {
      if (url === '/api/import/tools/product-matches' && !options?.method) {
        erpReads.push({ url, options });
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, products: erpProducts, value: null, revision: 0 }) });
      }
      fetchCalls.push({ url, options }); return new Promise(resolve => { resolveFetch = resolve; });
    };
    const extractionMock = { async extractPackingDocument({ country, pdfBase64, allowAI }) {
      extractionCalls.push({ country, pdfBase64, allowAI });
      if (allowAI !== true) return { needsAI: true, reason: 'UNSUPPORTED_LAYOUT' };
      const data = await state.readPackingPdfResponse(await fetchStub('/api/import/tools/parse-pdf', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ country, pdfBase64 }),
      }));
      return { data, source: data.source === 'cache' ? 'cache' : 'ai', cacheSaved: data.cacheSaved };
    } };
    const storage = { get: async key => key === 'nenova_catalog' ? { value: JSON.stringify({ items: catalog.items }) } : null,
      set: async (key, value) => { sharedWrites.push({ key, value }); throw Error('409 revision conflict'); }, delete: async () => { throw Error('delete failed'); } };
    const modules = { '../../styles/ImportPacking.module.css': new Proxy({}, { get: (_, key) => key === '__esModule' ? false : String(key) }), react, '../../lib/importPacking.js': packing, '../../lib/importPackingState.js': state,
      '../../lib/importPackingResponse.js': response, '../../lib/importAwbFields.js': awbFields,
      '../../lib/importPackingExtractClient.js': extractionMock, '../../lib/importPackingReview.js': review,
      '../../lib/importPackingErpMatches.js': erpMatchHelpers,
      '../../lib/importPackingReceiptAdapter.js': receiptAdapter,
      './PackingResults.js': { default: 'PackingResults', __esModule: true },
      './PackingEvidenceReview.js': { default: 'EvidenceReview', __esModule: true },
      './ChinaLegacyReview.js': { default: 'ChinaLegacyReview', __esModule: true },
      './PackingProductMatchDialog.js': { default: 'PackingProductMatchDialog', __esModule: true },
      'xlsx-js-style': XLSX };
    const code = babel.transformSync(componentSource.replace("import('xlsx-js-style')", "Promise.resolve(require('xlsx-js-style'))"), {
      filename: 'PackingListTool.js', presets: [require('next/dist/compiled/babel/preset-react')],
      plugins: [require('next/dist/compiled/babel/plugin-transform-modules-commonjs')], configFile: false, babelrc: false,
    }).code;
    const module = { exports: {} };
    class Reader { readAsDataURL() { this.result = 'data:application/pdf;base64,JVBERi0x'; this.onload(); } }
    new Function('require','module','exports','fetch','FileReader', code + '\nmodule.exports.NoticeText = NoticeText;')(
      key => modules[key], module, module.exports,
      fetchStub, Reader);
    const render = () => { cursor = 0; effectCursor = 0; refCursor = 0; memoCursor = 0; return module.exports.default({ storage }); };
    const flatten = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(flatten) : [node, ...flatten(node.props?.children)];
    const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : '';
    const hostileNotice = module.exports.NoticeText({ text: 'Safe <strong>bold</strong><img src=x onerror=alert(1)>' });
    assert.equal(flatten(hostileNotice).filter(node => node.type === 'strong').length, 1);
    assert.equal(flatten(hostileNotice).some(node => node.type === 'img'), false);
    assert.ok(text(hostileNotice).includes('<img src=x onerror=alert(1)>'));
    render(); for (const effect of effects) { if (effect.pending) { effect.pending = false; effect.fn(); } }
    await new Promise(setImmediate);
    let tree = render(); assert.equal(fetchCalls.length, 0); assert.equal(erpReads.length, 1);
    assert.ok(text(tree).includes('패킹 리스트 생성기'), 'Korean is the default');
    flatten(tree).find(node => node.type === 'button' && text(node) === 'ES').props.onClick();
    tree = render();
    flatten(tree).find(node => node.type === 'button' && node.props['aria-label'] === 'Colombia').props.onClick();
    tree = render();
    const pdfInput = flatten(tree).find(node => node.type === 'input' && node.props.accept === '.pdf');
    pdfInput.props.onChange({ target: { files: [{ name: '40-1.pdf', size: state.PACKING_PDF_MAX_BYTES + 1, type: 'application/pdf' }] } });
    tree = render(); assert.ok(text(tree).includes('20MiB')); assert.equal(fetchCalls.length, 0);
    pdfInput.props.onChange({ target: { files: [{ name: '40-1.pdf', size: state.PACKING_PDF_MAX_BYTES, type: 'application/pdf' }] } });
    tree = render();
    const localProcess = flatten(tree).find(node => node.type === 'button' && text(node) === 'Generar packing list').props.onClick();
    tree = render(); assert.ok(text(tree).includes('Procesando'));
    assert.equal(fetchCalls.length, 0);
    await localProcess; tree = render();
    assert.equal(fetchCalls.length, 0, 'default Generate must not call AI');
    assert.equal(extractionCalls[0].allowAI, false);
    const pendingProcess = flatten(tree).find(node => node.type === 'button' && text(node) === 'Analizar con IA (posible coste)').props.onClick();
    tree = render(); assert.ok(text(tree).includes('Procesando'));
    assert.equal(extractionCalls[1].allowAI, true);
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, '/api/import/tools/parse-pdf');
    assert.deepEqual(Object.keys(JSON.parse(fetchCalls[0].options.body)).sort(), ['country','pdfBase64']);
    resolveFetch({ ok: true, status: 200, json: async () => ({ ...ai({ invoices: [invoice] }), source: 'ai', cacheSaved: true }) }); await pendingProcess;
    tree = render(); assert.ok(text(tree).includes('Todo correcto'));
    assert.ok(text(tree).includes('Análisis IA completado'));
    const upload = flatten(tree).find(node => node.type === 'input' && node.props.accept === '.xlsx');
    upload.props.onChange({ target: { files: [{ name: 'catalog.xlsx', arrayBuffer: async () => bufferOf([['No','Code','Name','Flower','Country'], [1,'X','NEW NAME','장미','콜롬비아']]) }] } });
    await new Promise(setImmediate); tree = render();
    assert.ok(text(tree).includes('Vista previa')); assert.equal(sharedWrites.length, 0);
    assert.equal(values.find(v => v?.byCountry)?.items[0].name, 'CARNATION Doncel');
    await flatten(tree).find(node => node.type === 'button' && text(node) === 'Confirmar y guardar').props.onClick();
    tree = render(); assert.ok(text(tree).includes('409 revision conflict'));
    assert.equal(sharedWrites.length, 1); assert.ok(text(tree).includes('Vista previa'));
    assert.equal(flatten(tree).find(node => node.type === 'fieldset').props.disabled, true);
    assert.equal(values.find(v => v?.byCountry)?.items[0].name, 'CARNATION Doncel');
  });
  console.log('RESULT: ' + passed + ' packing tests passed (fixtures/mock AI only; no real PDF).');
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
