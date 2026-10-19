const test = require('node:test');
const assert = require('node:assert/strict');
const { packingWeekScope, packingCalendarDate, needsPackingWeekDate, applyPackingWeekDate, hasPackingWeekDate } = require('../lib/packingWeekDate.js');
const { normalizePackingMetadata } = require('../lib/importPackingMetadata.js');
const { assertPackingSourceValues } = require('../lib/importPackingSourceReview.js');
const { packingReviewWriter, makePackingReviewRows, applyPackingReview } = require('../lib/importPackingReview.js');
const apiSource = require('node:fs').readFileSync(require('node:path').join(__dirname, '../pages/api/import/packing-week-date.js'), 'utf8');
const createPackingWeekDateHandler = new Function('packingWeekScope', 'packingCalendarDate',
  apiSource.replace(/^import .*;\r?\n/gm, '').replace('export function', 'function')
    .replace('export default withAuth(createPackingWeekDateHandler());', '') + '\nreturn createPackingWeekDateHandler;')(packingWeekScope, packingCalendarDate);
const XLSX = require('xlsx');
const invoice = () => ({ date: null, raw_date: null, date_kind: 'invoice', currency: 'CNY', invoice_total: 320,
  freight: 0, pdfSourceHash: 'a'.repeat(64), pdfReviewRequired: true,
  products: [{ description: 'Fairy Kiss', total_bunch: 10, u_price: 32, t_price: 320 }],
  extractionIssues: [{ code: 'DATE_SOURCE_UNAVAILABLE', field: 'raw_date' }] });
const rows = [2025, 2026].flatMap(year => [
  { OrderYearWeek: `${year}42`, WeekDay: 4, BaseYmd: `${year}-10-${year === 2025 ? '15' : '14'}` },
  { OrderYearWeek: `${year}42`, WeekDay: 7, BaseYmd: `${year}-10-${year === 2025 ? '18' : '17'}` },
]);
test('missing date uses exact year/subweek calendar; raw source and other errors preserved', () => {
  for (const year of [2025, 2026]) for (const sub of [1, 2]) {
    const scope = packingWeekScope(year, `42-${sub}`), calendar = packingCalendarDate(rows, scope);
    const source = invoice(), applied = applyPackingWeekDate(source, calendar, scope);
    assert.equal(source.date, null); assert.equal(applied.raw_date, null); assert.equal(hasPackingWeekDate(applied), true);
    assert.equal(applied.orderWeekDate.orderYear, String(year));
    assert.equal(normalizePackingMetadata(applied, 'CN').extractionIssues.length, 0);
    assert.equal(assertPackingSourceValues(applied, 'CN'), true);
    const bad = applyPackingWeekDate({ ...source, extractionIssues: [...source.extractionIssues, { code: 'INVOICE_TOTAL_MISMATCH' }] }, calendar, scope);
    assert.deepEqual(bad.extractionIssues, [{ code: 'INVOICE_TOTAL_MISMATCH' }]);
    assert.throws(() => assertPackingSourceValues(bad, 'CN'));
    assert.throws(() => applyPackingWeekDate(source, { ...calendar, orderYear: '2024' }, scope));
    assert.throws(() => packingCalendarDate([...rows, ...rows], scope));
    assert.throws(() => packingCalendarDate([], scope));
  }
});
test('printed/manual/malformed dates are not replaced, explicit zero/false are not missing', () => {
  const scope = packingWeekScope('2026', '42-02'), calendar = packingCalendarDate(rows, scope);
  for (const value of ['2025/10/18', '17/10/26', 0, false]) {
    const source = { ...invoice(), date: value };
    assert.equal(needsPackingWeekDate(source), false);
    assert.equal(applyPackingWeekDate(source, calendar, scope), source);
  }
  assert.equal(needsPackingWeekDate({ ...invoice(), raw_date: '10/17' }), false);
  for (const year of ['', 0, false, '26']) assert.throws(() => packingWeekScope(year, '42-02'));
  for (const week of ['', '42-00', '42-03', '54-02']) assert.throws(() => packingWeekScope('2026', week));
  assert.equal(hasPackingWeekDate({ ...invoice(), orderWeekDate: calendar, date: '2026/10/18' }), false);
});
test('auto date audit exports and manual edits retain provenance without fake source confirmation', () => {
  const scope = packingWeekScope('2026', '42-02');
  const applied = applyPackingWeekDate(invoice(), packingCalendarDate(rows, scope), scope);
  const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['packing']]), 'packing');
  const writer = packingReviewWriter(XLSX, applied, '42-2B CLOUD CI.pdf');
  const bytes = writer.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const reloaded = XLSX.read(bytes, { type: 'buffer' });
  assert.ok(reloaded.SheetNames.includes('날짜 적용 근거'));
  assert.equal(reloaded.Sheets['날짜 적용 근거'].B4.v, '2026-10-17');
  const drafts = makePackingReviewRows([applied], 'CN'); drafts[0].applyValues = true;
  drafts[0].metadata.values.date = '2026-10-18'; drafts[0].metadata.reasons.date = '실제 적용일 수정';
  const edited = applyPackingReview([applied], drafts, 'CN', undefined, { requireConfirmation: false })[0];
  assert.equal(edited.date, '2026/10/18'); assert.equal(edited.raw_date, null);
  assert.equal(edited.orderWeekDate.date, '2026-10-17');
});
test('GET handler is read only, parameterized and fail closed', async () => {
  let calls = 0;
  const handler = createPackingWeekDateHandler({ types: { NVarChar: n => n, Int: 'int' }, queryFn: async (sql, params) => {
    calls++; assert.match(sql, /WHERE OrderYearWeek=@yearWeek AND WeekDay=@weekDay/);
    assert.equal(params.yearWeek.value, '202642'); return { recordset: rows };
  } });
  const res = { setHeader() {}, status(n) { this.code = n; return this; }, json(body) { this.body = body; }, end() {} };
  await handler({ method: 'GET', query: { orderYear: '2026', orderWeek: '42-02' } }, res);
  assert.equal(res.code, 200); assert.equal(res.body.calendar.date, '2026-10-17');
  await handler({ method: 'POST', query: {} }, res); assert.equal(res.code, 405); assert.equal(calls, 1);
  await handler({ method: 'GET', query: { orderWeek: '42-02' } }, res); assert.equal(res.code, 400); assert.equal(calls, 1);
});
