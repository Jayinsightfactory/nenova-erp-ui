const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const { createFieldUploadRenderer, loadFieldUploadDirectory } = require('../lib/shipmentFieldUploadAsync.cjs');
const ExcelJS = require('exceljs');
const root = process.cwd();
require('node:module').register(pathToFileURL(path.join(root, 'scripts/work-drive-esm-loader.mjs')));

test('real isolated children preserve workbook contents for 2/5/10/20 normal files and leave parent responsive', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nenova-field-render-'));
  const renderer = createFieldUploadRenderer({ projectRoot: root });
  let beats = 0; const timer = setInterval(() => beats++, 5);
  try {
    const source = new ExcelJS.Workbook(), sheet = source.addWorksheet('카네이션');
    sheet.addRow(['카네이션', '양재']); sheet.addRow(['', '금']);
    sheet.addRow(['', '연습업체', '주문', '입고', '재고', '잔량']);
    sheet.addRow(['돈셀', 3, 3, 8, 0, 5]);
    const buffer = Buffer.from(await source.xlsx.writeBuffer());
    const filepath = path.join(dir, 'fixture.xlsx'); fs.writeFileSync(filepath, buffer);
    const [{ default: XLSX }, { parseAllocationWorkbook }, { createUploadedFieldWorkbook }] = await Promise.all([
      import('xlsx'), import('../lib/shipmentImport.js'), import('../lib/shipmentFieldUpload.js'),
    ]);
    const input = { filepath, filename: '47-01-연습.xlsx', week: '2026-47-01', farmText: '-연습업체\n돈셀 3(연습농장)', customerDirectory: [{ CustName: '연습업체', OrderCode: 'FAKE', customerAlias: '연습업체' }] };
    const expected = new ExcelJS.Workbook();
    await expected.xlsx.load(await createUploadedFieldWorkbook(buffer, parseAllocationWorkbook(XLSX, XLSX.read(buffer, { type: 'buffer' })).rows, { ...input }));
    const normalize = book => book.worksheets.map(ws => ({ name: ws.name, values: ws.getSheetValues() }));
    const cancel = new AbortController();
    const abandoned = renderer.run(input, { signal: cancel.signal });
    cancel.abort();
    await assert.rejects(abandoned, { code: 'FIELD_UPLOAD_CANCELLED' });
    for (const count of [2, 5, 10, 20]) {
      const outputs = await Promise.all(Array.from({ length: count }, () => renderer.run(input)));
      for (const output of outputs) {
        const book = new ExcelJS.Workbook(); await book.xlsx.load(output);
        assert.deepEqual(normalize(book), normalize(expected));
      }
    }
    assert(beats >= 10, 'parent heartbeat continues while children parse/render');
    assert(fs.readFileSync(filepath).equals(buffer), 'original file preserved');
  } finally { clearInterval(timer); await renderer.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

function fakeChild() {
  const child = new EventEmitter(); child.sent = [];
  Object.assign(child, { ref() {}, unref() {}, postMessage(message) { child.sent.push(message); }, async terminate() {} });
  return child;
}

test('bounded queue, queued cancellation, active cancellation and late replies do not leak slots', async () => {
  const children = [], renderer = createFieldUploadRenderer({ concurrency: 1, maxQueued: 1, start: () => { const child = fakeChild(); children.push(child); return child; } });
  const hold = setInterval(() => {}, 1000);
  try {
    const firstAbort = new AbortController(), secondAbort = new AbortController();
    const first = renderer.run({ filepath: 'one', token: 'never-send', customerDirectory: [{ CustName: 'test', private: 'never-send' }] }, { signal: firstAbort.signal });
    const second = renderer.run({ filepath: 'two' }, { signal: secondAbort.signal });
    await assert.rejects(renderer.run({ filepath: 'three' }), { code: 'FIELD_UPLOAD_BUSY' });
    secondAbort.abort(); await assert.rejects(second, { code: 'FIELD_UPLOAD_CANCELLED' });
    assert.equal(children[0].sent.length, 1);
    assert.deepEqual(Object.keys(children[0].sent[0].input).sort(), ['customerDirectory', 'farmText', 'filename', 'filepath', 'week', 'year']);
    assert(!JSON.stringify(children[0].sent[0]).includes('never-send'));
    firstAbort.abort(); await assert.rejects(first, { code: 'FIELD_UPLOAD_CANCELLED' });
    const third = renderer.run({ filepath: 'three' });
    children[0].emit('message', { id: 1, ok: true, output: Buffer.from('stale') });
    children[1].emit('message', { id: children[1].sent[0].id, ok: true, output: Buffer.from('fresh') });
    assert.equal((await third).toString(), 'fresh');
  } finally { await renderer.close(); clearInterval(hold); }
});

test('absolute deadline includes queue; failed worker exits before input cleanup and next admission', async () => {
  const children = [], renderer = createFieldUploadRenderer({ concurrency: 1, timeoutMs: 20, start: () => { const child = fakeChild(); children.push(child); return child; } });
  const hold = setInterval(() => {}, 1000);
  try {
    const outcomes = await Promise.allSettled([renderer.run({ filepath: 'one' }), renderer.run({ filepath: 'two' })]);
    assert(outcomes.every(outcome => outcome.status === 'rejected' && outcome.reason.code === 'FIELD_UPLOAD_BUSY'));
  } finally { await renderer.close(); clearInterval(hold); }
});

test('cancelled CPU child retains its slot until exit, so replacement cannot accumulate children', async () => {
  let releaseExit; const children = [];
  const renderer = createFieldUploadRenderer({ concurrency: 1, start: () => {
    const child = fakeChild(); children.push(child);
    if (children.length === 1) child.terminate = () => new Promise(resolve => { releaseExit = resolve; });
    return child;
  } });
  const cancel = new AbortController();
  try {
    const first = renderer.run({ filepath: 'one' }, { signal: cancel.signal });
    cancel.abort();
    const next = renderer.run({ filepath: 'next' });
    assert.equal(children.length, 1);
    releaseExit(); await assert.rejects(first, { code: 'FIELD_UPLOAD_CANCELLED' });
    assert.equal(children.length, 2);
    children[1].emit('message', { id: children[1].sent[0].id, ok: true, output: Buffer.from('next') });
    assert.equal((await next).toString(), 'next');
  } finally { await renderer.close(); }
});

test('20 simultaneous directory loads share one query, failures recover and next batch is fresh', async () => {
  let queries = 0, finish;
  const loader = () => { queries++; return new Promise(resolve => { finish = resolve; }); };
  const reads = Array.from({ length: 20 }, () => loadFieldUploadDirectory(loader));
  await Promise.resolve(); assert.equal(queries, 1); finish([{ CustName: '연습업체' }]);
  const results = await Promise.all(reads); assert(results.every(result => result === results[0]));
  await assert.rejects(loadFieldUploadDirectory(async () => { queries++; throw new Error('fixture failure'); }), /fixture failure/);
  assert.deepEqual(await loadFieldUploadDirectory(async () => { queries++; return []; }), []);
  assert.equal(queries, 3);
});
