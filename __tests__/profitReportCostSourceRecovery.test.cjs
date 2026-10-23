const assert = require('node:assert/strict');
const fs = require('node:fs');

async function main() {
  const { buildInvoiceRateEvidence } = await import('../lib/profitReportInvoiceRateEvidence.mjs');
  const { buildProfitReportAudit } = await import('../lib/profitReportAudit.js');
  const rows = [
    { Category: '태국', TotalWeight: 100, CoveredWeight: 100, rate: 1500 },
    { Category: '콜롬비아 카네이션', TotalWeight: 200, CoveredWeight: 50, rate: 1550 },
    { Category: '네덜란드', TotalWeight: 100, CoveredWeight: 0, rate: null },
    { Category: '호주', TotalWeight: 0, CoveredWeight: 0, rate: null },
  ];
  const result = buildInvoiceRateEvidence(rows, { orderYear: '2026', major: '18' });
  assert.deepEqual(result.rates, { 태국: 1500 });
  assert.equal(result.evidence.byCategory['콜롬비아 카네이션'].status, 'partial');
  assert.equal(result.evidence.byCategory['콜롬비아 카네이션'].coveredRate, 1550);
  assert.equal(result.evidence.byCategory['콜롬비아 카네이션'].applied, false);
  assert.equal(result.evidence.byCategory['네덜란드'].status, 'absent');
  for (const malformed of [{ TotalWeight: 100, CoveredWeight: 101, rate: 1500 },
    { TotalWeight: 100, CoveredWeight: 100, rate: 0 }, { TotalWeight: 100, CoveredWeight: -1, rate: 1500 }]) {
    const rejected = buildInvoiceRateEvidence([{ Category: '태국', ...malformed }], { orderYear: '2026', major: 18 });
    assert.equal(rejected.evidence.byCategory['태국'].status, 'rejected');
    assert.deepEqual(rejected.rates, {});
  }
  const failed = buildInvoiceRateEvidence([], { orderYear: '2026', major: '18', queryFailed: true });
  assert.equal(failed.evidence.status, 'query_failed');
  assert.deepEqual(failed.rates, {});
  assert.equal(buildInvoiceRateEvidence([], { orderYear: '2025', major: '18' }).evidence.orderYear, '2025');

  // Execute the real loader with only SELECT I/O substituted. Its old return
  // shape, complete-coverage gate and period-bound SQL must remain unchanged.
  const source = fs.readFileSync('lib/profitReport.js', 'utf8');
  const start = source.indexOf('export async function invoiceRatesByCategory(');
  const end = source.indexOf('\n/**', start);
  const body = source.slice(start, end).replace('export async function', 'async function');
  const calls = [];
  let shouldFail = false;
  const query = async (text, params) => {
    assert.match(text, /ISNULL\(wm\.OrderYear,''\)=@yr/);
    assert.match(text, /wm\.OrderWeek LIKE @pfx/);
    assert.match(text, /fcx\.WarehouseKey=wm\.WarehouseKey/);
    assert.doesNotMatch(text, /\b(?:UPDATE|INSERT|DELETE|MERGE|EXEC)\b/i);
    calls.push(params);
    if (shouldFail) throw Error('sensitive SQL connection details must never be returned');
    return { recordset: rows };
  };
  const loader = new Function('query', 'sql', 'CASE_CATEGORY', 'stockablePurchaseItemSql', 'buildInvoiceRateEvidence',
    `${body}; return invoiceRatesByCategory;`)(query, { NVarChar: 'nvarchar' }, "N'category'", () => '1=1', buildInvoiceRateEvidence);
  assert.deepEqual(await loader('18', '2026'), { 태국: 1500 });
  assert.equal((await loader('18', '2026', { withEvidence: true })).evidence.byCategory['네덜란드'].status, 'absent');
  assert.equal(calls[0].yr.value, '2026');
  assert.equal(calls[0].pfx.value, '18-%');
  shouldFail = true;
  assert.deepEqual(await loader('18', '2026'), {});
  const failedRead = await loader('18', '2026', { withEvidence: true });
  assert.equal(failedRead.evidence.status, 'query_failed');
  assert.ok(!JSON.stringify(failedRead).includes('sensitive'));

  const reportRow = { category: '네덜란드', currency: 'EUR', auto: { Q: 100, R: 1500, H: 100, S: 5 },
    source: { R: 'saved_official_week', H: 'saved', S: 'auto' }, manual: {},
    rateSourceEvidence: { current: { status: 'query_failed' } } };
  assert.ok(buildProfitReportAudit([reportRow], { orderYear: '2026', major: 18 }).issues.some(i => i.code === 'INVOICE_RATE_QUERY_FAILED'));
  reportRow.rateSourceEvidence.current = { status: 'partial', totalPurchaseForeign: 200, coveredPurchaseForeign: 50 };
  assert.ok(buildProfitReportAudit([reportRow], { orderYear: '2026', major: 18 }).issues.some(i => i.code === 'INVOICE_RATE_PARTIAL'));
  reportRow.manual.R = 1500;
  assert.ok(!buildProfitReportAudit([reportRow], { orderYear: '2026', major: 18 }).issues.some(i => /INVOICE_RATE_/.test(i.code)));
  for (const invalidManual of [0, '']) {
    reportRow.manual.R = invalidManual;
    assert.ok(buildProfitReportAudit([reportRow], { orderYear: '2026', major: 18 }).issues.some(i => i.code === 'INVOICE_RATE_PARTIAL'));
  }
  reportRow.auto.E = 100;
  reportRow.rateSourceEvidence.previous = { status: 'query_failed' };
  assert.ok(buildProfitReportAudit([reportRow], { orderYear: '2026', major: 18 }).issues.some(i => i.code === 'PREVIOUS_INVOICE_RATE_QUERY_FAILED'));
  reportRow.rateSourceEvidence.previousManualTakesPriority = true;
  assert.ok(!buildProfitReportAudit([reportRow], { orderYear: '2026', major: 18 }).issues.some(i => i.code === 'PREVIOUS_INVOICE_RATE_QUERY_FAILED'));
  console.log('PASS cost source recovery: complete/partial/absent/query-failed, manual priority, SELECT/year/week and unchanged map contract');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
