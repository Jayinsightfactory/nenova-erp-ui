const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const JSZip = require('jszip');

const { parseSettlementPage } = require('../lib/customsSettlementParser.cjs');
const { inspectSettlementPdf } = require('../lib/customsSettlementZip.cjs');
const jobs = require('../lib/customsSettlementJobs.cjs');

function makeSunyulPage({ date = '2026-11-01', docId = '43892-26-152861M', awb = '18091601930', currency = 'EUR', foreignAmount = '12,356.00', gw = '1,104.00 KG', rateTokens = [{ str: '1,484.0000', x: .770 }], includeRateLabel = true } = {}) {
  const items = [];
  const add = (str, x, y) => items.push({ str: String(str), x: x * 1000, y: y * 1000, width: 10, height: 8 });
  const headerY = 0.720;
  const step = 0.020;
  add(date, .210, headerY);
  add(docId, .420, headerY);
  add(awb, .420, headerY - step);
  if (includeRateLabel) add('적용환율', .661, headerY - step * 2);
  for (const tok of rateTokens) add(tok.str, tok.x, headerY - step * 2);
  if (currency) add(currency, .861, headerY - step * 3);
  if (foreignAmount) add(foreignAmount, .770, headerY - step * 4);
  if (gw) add(gw, .210, headerY - step * 4);

  ['관세', '부가세', '통관수수료', '검역대행수수료', '비용합계(a)'].forEach((s, i) => add(s, .090, .560 - i * step));
  const amounts = [[0, 0, 239980], [0, 0, 2352410], [27000, 2700, 29700], [216000, 21600, 237600]];
  amounts.forEach((row, i) => row.forEach((value, j) => add(value, [.300, .420, .530][j], .560 - i * step)));
  add(2859690, .530, .480);
  return { page: 1, width: 1000, height: 1000, items };
}

test('extracts Row-2 적용환율 for EUR, split-token CNY, and split-token USD (44th Sunyul fixtures)', () => {
  const hash = 'b'.repeat(64);
  const eur = parseSettlementPage(makeSunyulPage({
    currency: 'EUR',
    rateTokens: [{ str: '1,484.0000', x: .770 }],
  }), hash);
  assert.equal(eur.exchangeRate, 1484);
  assert.equal(eur.currency, 'EUR');
  assert.equal(eur.total, 2859690);

  const cny = parseSettlementPage(makeSunyulPage({
    date: '2026-11-02',
    docId: '43892-26-600187M',
    awb: '99997130180',
    currency: 'CNY',
    foreignAmount: '600.00',
    rateTokens: [{ str: '199', x: .783 }, { str: '.2000', x: .808 }],
  }), hash);
  assert.equal(cny.exchangeRate, 199.2);
  assert.equal(cny.currency, 'CNY');

  const usd = parseSettlementPage(makeSunyulPage({
    date: '2026-10-27',
    docId: '43892-26-600188M',
    awb: '86514699591',
    currency: 'USD',
    foreignAmount: '54,858.82',
    rateTokens: [
      { str: '1', x: .772 },
      { str: ',', x: .781 },
      { str: '330', x: .786 },
      { str: '.5200', x: .813 },
    ],
  }), hash);
  assert.equal(usd.exchangeRate, 1330.52);
  assert.equal(usd.currency, 'USD');
});

test('missing or out-of-range 적용환율 yields null without breaking duty/handling parsing', () => {
  const hash = 'c'.repeat(64);
  const missing = parseSettlementPage(makeSunyulPage({ includeRateLabel: false, rateTokens: [] }), hash);
  assert.equal(missing.exchangeRate, null);
  assert.equal(missing.total, 2859690);

  const bogus = parseSettlementPage(makeSunyulPage({
    currency: 'CNY',
    rateTokens: [{ str: '9,999.0000', x: .770 }],
  }), hash);
  assert.equal(bogus.exchangeRate, null);
  assert.equal(bogus.total, 2859690);
});

test('settlementTaxableRates & resolveTaxableRate preserve manual/saved/snapshot/historical and fill missing R with exact scope', async () => {
  const { settlementTaxableRates, pickSettlementTaxableRate } = await import('../lib/customsSettlementEvidence.js');
  const { resolveTaxableRate, RATE_SOURCE } = await import('../lib/taxableExchangeRate.js');

  const ledger2026 = {
    version: 1,
    year: '2026',
    major: '44',
    documents: [
      { targetKey: 'country|네덜란드|02', documentId: '43892-26-152861M', awb: '18091601930', currency: 'EUR', foreignAmount: 12356, exchangeRate: 1484 },
      { targetKey: 'country|중국|02', documentId: '43892-26-600187M', awb: '99997130180', currency: 'CNY', foreignAmount: 600, exchangeRate: 199.2 },
      { targetKey: 'colombia|44-01', documentId: '43892-26-600188M', awb: '86514699591', currency: 'USD', foreignAmount: 54858.82, exchangeRate: 1330.52 },
    ],
  };
  const rates = settlementTaxableRates(ledger2026);
  const nl = pickSettlementTaxableRate(rates, '네덜란드', 'EUR');
  assert.equal(nl.rate, 1484);
  assert.equal(nl.sourceNote, '선율 정산서 자동반영');
  assert.deepEqual(nl.documentIds, ['43892-26-152861M']);

  const cn = pickSettlementTaxableRate(rates, '중국', 'CNY');
  assert.equal(cn.rate, 199.2);

  // Colombia pool maps to all Colombia report categories
  const coRose = pickSettlementTaxableRate(rates, '콜롬비아 장미', 'USD');
  assert.equal(coRose.rate, 1330.52);

  // Wrong currency is rejected (EUR doc must never fill USD category if no USD matches)
  const onlyEur = settlementTaxableRates({ year: '2026', major: '44', documents: [ledger2026.documents[0]] });
  assert.equal(pickSettlementTaxableRate(onlyEur, '네덜란드', 'USD'), null);

  // Missing week gets sunyul_settlement automatically (ahead of KCS estimate)
  const autoResolved = resolveTaxableRate({
    snapshotRate: null,
    savedByCategory: null,
    savedByCurrency: null,
    historicalRate: null,
    currency: 'EUR',
    settlementRate: nl.rate,
    settlementDetail: nl,
    kcsRate: 1480.0,
  });
  assert.equal(autoResolved.rate, 1484);
  assert.equal(autoResolved.source, RATE_SOURCE.SUNYUL_SETTLEMENT);

  // Existing FreightCost snapshot / saved WebTaxableExchangeRate / historical ALWAYS win over settlement
  const snapshotWins = resolveTaxableRate({ snapshotRate: 1490, settlementRate: 1484, settlementDetail: nl });
  assert.equal(snapshotWins.rate, 1490);
  assert.equal(snapshotWins.source, RATE_SOURCE.FREIGHT_COST_SNAPSHOT);

  const savedCatWins = resolveTaxableRate({
    savedByCategory: { rate: 1488.5, source: RATE_SOURCE.MANUAL_INPUT },
    settlementRate: 1484,
    settlementDetail: nl,
  });
  assert.equal(savedCatWins.rate, 1488.5);
  assert.equal(savedCatWins.source, RATE_SOURCE.MANUAL_INPUT);

  const histWins = resolveTaxableRate({ historicalRate: 1477, settlementRate: 1484, settlementDetail: nl });
  assert.equal(histWins.rate, 1477);
  assert.equal(histWins.source, RATE_SOURCE.EXCEL_HISTORICAL);

  // Cross-year isolation: empty 2025 ledger produces no settlement rate
  const rates2025 = settlementTaxableRates({ year: '2025', major: '44', documents: [] });
  assert.equal(pickSettlementTaxableRate(rates2025, '네덜란드', 'EUR'), null);
});

test('single PDF and ZIP Gmail ingest are idempotent by attachmentSha256 and reject hash mismatch', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'customs-gmail-ingest-'));
  const pdfBytes = Buffer.from('%PDF-1.4 synthetic-sunyul-44');
  const pdfSha = crypto.createHash('sha256').update(pdfBytes).digest('hex');

  const inspected = inspectSettlementPdf(pdfBytes, '44-2차 HOLEX 18091601930 분할1 정산서.pdf');
  assert.equal(inspected.sourceHash, pdfSha);
  assert.equal(inspected.files[0].hint.awb, '18091601930');
  assert.equal(inspected.files[0].hint.part, '1');

  // Hash mismatch -> 409
  await assert.rejects(
    jobs.createSettlementJob('gmail-auto', {
      year: 2026,
      major: 44,
      pdfBase64: pdfBytes.toString('base64'),
      filename: '44-2차 HOLEX 18091601930 정산서.pdf',
      ingestMeta: { source: 'gmail-auto', messageId: 'msg-1', attachmentSha256: '0'.repeat(64), subject: '[관세법인 선율] 네노바 44차 정산서' },
    }, { root }),
    (err) => err.statusCode === 409,
  );

  // First ingest creates QUEUED job
  const first = await jobs.createSettlementJob('gmail-auto', {
    year: 2026,
    major: 44,
    pdfBase64: pdfBytes.toString('base64'),
    filename: '44-2차 HOLEX 18091601930 분할1 정산서.pdf',
    ingestMeta: { source: 'gmail-auto', messageId: 'msg-1', attachmentSha256: pdfSha, subject: '[관세법인 선율] 네노바 44차 정산서' },
  }, { root });
  assert.equal(first.status, 'QUEUED');
  assert.equal(first.erpWrites, 0);
  assert.ok(!first.duplicate);

  // Second ingest with identical attachmentSha256 is permanently deduplicated
  const second = await jobs.createSettlementJob('gmail-auto', {
    year: 2026,
    major: 44,
    pdfBase64: pdfBytes.toString('base64'),
    filename: '44-2차 HOLEX 18091601930 분할1 정산서.pdf',
    ingestMeta: { source: 'gmail-auto', messageId: 'msg-2-fw', attachmentSha256: pdfSha, subject: 'FW: [관세법인 선율] 네노바 44차 정산서' },
  }, { root });
  assert.equal(second.duplicate, true);
  assert.equal(second.skipped, true);
  assert.equal(second.jobId, first.jobId);

  // ZIP ingest works too and updates gmailIngestStatus
  const zip = new JSZip();
  zip.file('44-1차 콜카장 86514699591 정산서.pdf', '%PDF-1.4 col-44');
  const zipBytes = await zip.generateAsync({ type: 'nodebuffer' });
  const zipSha = crypto.createHash('sha256').update(zipBytes).digest('hex');
  const third = await jobs.createSettlementJob('gmail-auto', {
    year: 2026,
    major: 44,
    zipBase64: zipBytes.toString('base64'),
    ingestMeta: { source: 'gmail-auto', messageId: 'msg-3', attachmentSha256: zipSha, subject: '0_RE_ [관세법인 선율] 네노바 44차 정산서' },
  }, { root });
  assert.equal(third.status, 'QUEUED');
  assert.ok(!third.duplicate);

  const status = await jobs.gmailIngestStatus({ root });
  assert.equal(status.totalIngested, 2);
  assert.equal(status.lastYear, '2026');
  assert.equal(status.lastMajor, '44');
});
