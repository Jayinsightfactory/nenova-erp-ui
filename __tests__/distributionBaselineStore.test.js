const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const XLSX = require('xlsx');
const { MAX_FILE_BYTES, BaselineStoreError, createDistributionBaselineStore } = require('../lib/distributionBaselineStore');

const user = { userId: 'baseline-user' };
const requestId = '550e8400-e29b-41d4-a716-446655440000';

function workbookBuffer({ title = '2026 차수(3701) 품종(장미)', quantity = 2 } = {}) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    [title], [], ['품종', '수연선출고', '주문', '입고', '잔량'], ['RED', quantity, 3, 4, 5], ['합계', quantity],
  ]), '01');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['type', 'name', 'label', 'key']]), '_keymap');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

function payload(overrides = {}) {
  const buffer = overrides.buffer || workbookBuffer(overrides);
  return {
    year: '2026', week: '37-01', requestId, fileName: '3701_장미.xlsx',
    fileBase64: buffer.toString('base64'), coverage: 'single', ...overrides,
  };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, error => error instanceof BaselineStoreError && error.code === code);
}

async function main() {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'distribution-baseline-store-'));
  try {
    const store = createDistributionBaselineStore({ directory, now: () => new Date('2026-09-10T01:02:03.000Z') });
    const input = payload();
    const concurrent = await Promise.all(Array.from({ length: 8 }, () => store.createBaseline(input, user)));
    assert.equal(new Set(concurrent.map(item => item.id)).size, 1, 'concurrent duplicate saves return one immutable ID');
    assert.equal((await fs.promises.readdir(directory)).filter(name => name.endsWith('.json')).length, 1, 'concurrent saves never clobber or create duplicates');
    const saved = concurrent[0];
    assert.equal(saved.status, 'STORED');
    assert.equal(saved.createdBy, user.userId);
    assert.equal(saved.erpSnapshot, null);
    assert.equal(saved.reconciliationStatus, 'NOT_CAPTURED');
    assert.ok(saved.parsed.sheets.length === 1);
    assert.deepEqual(Object.keys(saved.source).sort(), ['bytes', 'fileName', 'format', 'sha256']);
    assert.equal('fileBase64' in saved, false, 'API-safe baseline never returns source bytes');
    const stored = JSON.parse(await fs.promises.readFile(path.join(directory, `${saved.id}.json`), 'utf8'));
    assert.ok(stored.parsed.sheets.length === 1, 'stored record keeps server parsing output');
    assert.equal('payload' in stored, false, 'stored record has explicit metadata, never a client payload wrapper');
    assert.equal(stored.fileBase64, input.fileBase64, 'stored record retains the original source bytes only');

    const restarted = createDistributionBaselineStore({ directory });
    const retry = await restarted.createBaseline(input, user);
    assert.deepEqual(retry, saved, 'same payload remains idempotent after a process restart');
    assert.deepEqual(await restarted.getBaseline({ year: '2026', week: '37-01', id: saved.id }), saved);
    const items = await restarted.listBaselines({ year: '2026', week: '37-01' });
    assert.equal(items.length, 1);
    assert.equal('parsed' in items[0], false, 'list response remains metadata-only');

    await expectCode(restarted.createBaseline(payload({ quantity: 9 }), user), 'BASELINE_ID_CONFLICT');
    await expectCode(restarted.createBaseline(payload({ fileName: '../escape.xlsx' }), user), 'INVALID_FILE_NAME');
    await expectCode(restarted.createBaseline(payload({ title: '2025 차수(3701) 품종(장미)' }), user), 'INVALID_XLSX');
    await expectCode(restarted.createBaseline(payload({ fileBase64: Buffer.from('not an xlsx').toString('base64') }), user), 'INVALID_XLSX_MAGIC');
    await expectCode(restarted.createBaseline({ ...payload(), fileBase64: Buffer.alloc(MAX_FILE_BYTES + 1, 1).toString('base64') }, user), 'FILE_TOO_LARGE');
    await expectCode(restarted.getBaseline({ year: '2025', week: '37-01', id: saved.id }), 'BASELINE_NOT_FOUND');
    await expectCode(restarted.getBaseline({ year: '2026', week: '37-01', id: '0'.repeat(64) }), 'BASELINE_NOT_FOUND');
    console.log('distribution baseline store tests passed');
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
