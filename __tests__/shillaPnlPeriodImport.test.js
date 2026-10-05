const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');

function addSheet(book, name) {
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    [`신라호텔${name}(10.2)`],
    ['품명', '칼라', '입고수량', '매입단가', '매입액', '매출단가', '매출액', '이익', '', '네노바이익 (80%)', '미우이익 (20%)'],
    ['장미', '화이트', 2, 100, 200, 150, 300, 100, '', 80, 20],
    ['합계', null, 2, null, 200, null, 300, 100, null, 80, 20],
  ]), name);
}

async function main() {
  const { parseShillaPnlWorkbookGroups } = await import('../lib/shillaPnlParse.js');
  const { selectShillaImportBatches } = await import('../lib/shillaPnlImportPolicy.js');
  const book = XLSX.utils.book_new();
  for (const name of ['39차', '39차-2', '40차', '39차-10', '39차-02', '39차-', '39차-2.5', '39차-2.0', '39-2차.5', '39차–2', '39차−2', '39차‐2', '39차.2', '39차~40차', '39차 검토리포트']) addSheet(book, name);
  const parsed = parseShillaPnlWorkbookGroups(XLSX, book, { orderYear: 2026 });
  assert.deepEqual(parsed.batches.map(batch => batch.major), ['39', '39-2', '40']);
  assert(parsed.warnings.some(warning => warning.includes('39차-10')));
  assert(parsed.warnings.some(warning => warning.includes('39차-02')));
  for (const malformed of ['39차-2.5', '39차-2.0', '39-2차.5', '39차–2', '39차−2', '39차‐2', '39차.2']) {
    assert(parsed.sourceSheets.some(sheet => sheet.sheetName === malformed && !sheet.included));
  }
  assert.deepEqual(selectShillaImportBatches(parsed.batches, ['39-2']).map(batch => batch.major), ['39-2']);
  assert.throws(() => selectShillaImportBatches(parsed.batches, ['39-02']), /잘못/);
  assert.throws(() => selectShillaImportBatches(parsed.batches, ['39-2', '39-2']), /중복/);
  const duplicate = XLSX.utils.book_new();
  addSheet(duplicate, '39차-2'); addSheet(duplicate, '39-2차'); addSheet(duplicate, '39차');
  const duplicated = parseShillaPnlWorkbookGroups(XLSX, duplicate, { orderYear: 2026 });
  assert.equal(duplicated.batches.find(batch => batch.major === '39').verification.every(check => check.ok), true);
  assert.equal(duplicated.batches.find(batch => batch.major === '39-2').verification.some(check => !check.ok), true);
  assert.throws(() => selectShillaImportBatches(duplicated.batches, ['39-2']), /원본 확인/);

  // The transaction selects its parent by all three identity fields and only
  // replaces children under the selected PnlKey. No ERP ledger SQL is allowed.
  const core = fs.readFileSync(path.join(__dirname, '../lib/raumPnl.js'), 'utf8');
  assert.match(core, /WHERE OrderYear=@yr AND MajorWeek=@mj AND PartnerCode=@pc AND isDeleted=0/);
  assert.match(core, /DELETE FROM WebRaumPnlItem WHERE PnlKey=@key/);
  assert.match(core, /normalizePnlPeriod\(batch\.major, \{ allowSubPeriod: partner\.code === 'shilla' \}\)/);
  await checkTransactionalScope(core);
  console.log('Shilla subperiod parser and import scope tests passed');
}

async function checkTransactionalScope(core) {
  const { normalizePnlPeriod, formatPnlPeriod } = await import('../lib/raumPnlPeriod.js');
  const start = core.indexOf('export async function saveRaumPnlImportBatch(');
  const end = core.indexOf('\nexport async function loadRaumPnlList(', start);
  assert(start >= 0 && end > start);
  const implementation = core.slice(start, end).replace(/^export /, '');
  const state = {
    masters: [
      { PnlKey: 60, OrderYear: '2026', MajorWeek: '39', PartnerCode: 'shilla', version: 'old', isDeleted: 0 },
      { PnlKey: 51, OrderYear: '2025', MajorWeek: '39-2', PartnerCode: 'shilla', version: 'old', isDeleted: 0 },
      { PnlKey: 52, OrderYear: '2025', MajorWeek: '39', PartnerCode: 'shilla', version: 'old', isDeleted: 0 },
      { PnlKey: 70, OrderYear: '2026', MajorWeek: '39-2', PartnerCode: 'raum', version: 'old', isDeleted: 0 },
    ],
    items: [
      ...Array.from({ length: 10 }, (_, index) => ({ PnlKey: 60, ItemKey: index + 1, CostPrice: 777, ProdKey: 88 })),
      { PnlKey: 51, ItemKey: 51, CostPrice: 555, ProdKey: 51 },
      { PnlKey: 52, ItemKey: 52, CostPrice: 552, ProdKey: 52 },
      { PnlKey: 70, ItemKey: 70, CostPrice: 700, ProdKey: 70 },
    ],
    nextKey: 71,
  };
  let failInsert = false;
  const withTransaction = async callback => {
    const draft = structuredClone(state);
    const tQuery = async (statement, params = {}) => {
      if (statement.includes('SELECT * FROM WebRaumPnl WITH')) return { recordset: draft.masters.filter(row => row.OrderYear === params.yr.value && row.MajorWeek === params.mj.value && row.PartnerCode === params.pc.value && row.isDeleted === 0) };
      if (statement.includes('SELECT * FROM WebRaumPnlItem WITH')) return { recordset: draft.items.filter(row => row.PnlKey === params.key.value) };
      if (statement.includes('UPDATE WebRaumPnl SET')) return { recordset: [] };
      if (statement.includes('DELETE FROM WebRaumPnlItem')) { draft.items = draft.items.filter(row => row.PnlKey !== params.key.value); return { recordset: [] }; }
      if (statement.includes('INSERT INTO WebRaumPnl (')) {
        const PnlKey = draft.nextKey++;
        draft.masters.push({ PnlKey, OrderYear: params.yr.value, MajorWeek: params.mj.value, PartnerCode: params.pc.value, version: 'new-row', isDeleted: 0 });
        return { recordset: [{ PnlKey }] };
      }
      if (statement.includes('INSERT INTO WebRaumPnlItem')) {
        if (failInsert) throw new Error('simulated insert failure');
        draft.items.push({ PnlKey: params.key.value, ItemKey: draft.items.length + 1, CostPrice: params.cp.value, ProdKey: params.pk.value });
        return { recordset: [] };
      }
      throw new Error(`Unexpected SQL: ${statement}`);
    };
    const result = await callback(tQuery);
    Object.assign(state, draft);
    return result;
  };
  const bindings = {
    assertImportBatches: async () => {}, ensureRaumPnlTables: async () => {}, withTransaction,
    requireImportBatchPartners: async batches => batches.map(batch => ({ code: batch.partnerCode })),
    lockShillaImportAutoMatchCandidates: async () => new Map(), customHotelImportMatches: async () => new Map(),
    normalizePnlPeriod, formatPnlPeriod,
    importBatchKey: (year, major, partner) => `${partner}:${year}-${major}`,
    pnlVersion: row => row?.version || 'new',
    mergePnlImportedItems: imported => ({ items: imported, preservation: {} }),
    applyShillaHotelAutoMatches: items => ({ items, autoMatchedCount: 0 }),
    canonicalItemFingerprint: items => JSON.stringify(items),
    defaultPnlTitle: () => '신라호텔 결산', requireExplicitShillaNenovaPct: value => value,
    DEFAULT_NENOVA_PCT: 80, sql: { NVarChar: 'NVARCHAR', Int: 'INT', Float: 'FLOAT', Bit: 'BIT', Date: 'DATE' },
  };
  const save = Function(...Object.keys(bindings), `${implementation}\nreturn saveRaumPnlImportBatch;`)(...Object.values(bindings));
  const batch = {
    orderYear: '2026', major: '39-2', partnerCode: 'shilla', quoteDate: '2026-10-02', nenovaPct: 80,
    verification: [{ ok: true }], items: [{ seq: 1, name: '장미', unit: '단', qty: 2, price: 100, supply: 200, costPrice: 50, prodKey: null }],
  };
  const unchanged = structuredClone(state);
  const first = await save({ batches: [batch], sourceFile: 'shilla.xlsx', actor: 'test', expectedSnapshots: { 'shilla:2026-39-2': { version: 'new' } } });
  assert.equal(first[0].major, '39-2');
  const newKey = first[0].pnlKey;
  assert.equal(state.masters.find(row => row.PnlKey === newKey).MajorWeek, '39-2');
  assert.deepEqual(state.items.filter(row => row.PnlKey === 60), unchanged.items.filter(row => row.PnlKey === 60));
  assert.deepEqual(state.items.filter(row => row.PnlKey === 51), unchanged.items.filter(row => row.PnlKey === 51));
  assert.deepEqual(state.items.filter(row => row.PnlKey === 52), unchanged.items.filter(row => row.PnlKey === 52));
  assert.deepEqual(state.items.filter(row => row.PnlKey === 70), unchanged.items.filter(row => row.PnlKey === 70));
  const second = await save({ batches: [batch], sourceFile: 'shilla.xlsx', actor: 'test', expectedSnapshots: { 'shilla:2026-39-2': { version: 'new-row' } } });
  assert.equal(second[0].pnlKey, newKey, 'reupload must reuse only the exact parent');
  assert.equal(state.items.filter(row => row.PnlKey === newKey).length, 1);
  const beforeFailure = structuredClone(state);
  failInsert = true;
  await assert.rejects(save({ batches: [batch], sourceFile: 'shilla.xlsx', actor: 'test', expectedSnapshots: { 'shilla:2026-39-2': { version: 'new-row' } } }), /simulated insert failure/);
  assert.deepEqual(state, beforeFailure, 'failed child insert rolls back parent and child changes');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
