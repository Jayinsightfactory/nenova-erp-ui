// __tests__/profitReportAutoRefresh.test.cjs
// 미확정 주차별 매출이익 스냅샷 자동 새로고침(Push + Stale-on-Read) 및 확정 차수 불변 가드 회귀 테스트
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('isSnapshotStaleComparedToSources: detects stale sources vs fresh snapshot accurately', async () => {
  const A = await import('../lib/profitReportAutoRefresh.js');
  const snapAt = '2026-11-13T04:30:56.747Z';

  // Fresh: all sources older or equal
  const fresh = A.isSnapshotStaleComparedToSources({
    snapshotSavedAt: snapAt,
    sources: [
      { source: 'WebCustomsWeekly', scope: '2026:45', updatedAt: '2026-11-12T10:00:00.000Z' },
      { source: 'customsSettlementStore', scope: '2026:45', updatedAt: snapAt },
    ],
  });
  assert.equal(fresh.isStale, false);
  assert.equal(fresh.staleSources.length, 0);

  // Stale: WebCustomsWeekly and customsSettlementStore newer than snapshot
  const stale = A.isSnapshotStaleComparedToSources({
    snapshotSavedAt: snapAt,
    sources: [
      { source: 'WebCustomsWeekly', scope: '2026:44', updatedAt: '2026-11-19T03:10:36.723Z' },
      { source: 'customsSettlementStore', scope: '2026:45', updatedAt: '2026-11-23T03:15:10.000Z' },
      { source: 'WebProfitReport', scope: '2026:45', updatedAt: '2026-11-10T01:00:00.000Z' },
    ],
  });
  assert.equal(stale.isStale, true);
  assert.equal(stale.staleSources.length, 2);
  assert.equal(stale.latestSource.source, 'customsSettlementStore');

  // Missing snapshotSavedAt -> conservative false (never false-positive on legacy fixtures)
  const missing = A.isSnapshotStaleComparedToSources({
    snapshotSavedAt: null,
    sources: [{ source: 'WebCustomsWeekly', updatedAt: '2026-11-23T00:00:00.000Z' }],
  });
  assert.equal(missing.isStale, false);
});

test('normalizeAutoRefreshScope: enforces strict 4-digit year and 01..53 major week', async () => {
  const A = await import('../lib/profitReportAutoRefresh.js');
  assert.deepEqual(A.normalizeAutoRefreshScope('2026', '5'), { orderYear: '2026', major: '05' });
  assert.deepEqual(A.normalizeAutoRefreshScope(2026, '45-01'), { orderYear: '2026', major: '45' });
  for (const [y, m] of [['', '45'], ['26', '45'], ['abcd', '45'], ['2026', '00'], ['2026', '54'], ['2026', '']]) {
    assert.throws(() => A.normalizeAutoRefreshScope(y, m), (e) => e.code === 'INVALID_REPORT_PERIOD' && e.statusCode === 400);
  }
});

test('detectStaleProfitSnapshot: strict cross-year isolation on SQL params and settlement ledger', async () => {
  const A = await import('../lib/profitReportAutoRefresh.js');
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'profit-autorefresh-iso-'));
  try {
    // Write a 2025-45 ledger only — must NOT make 2026-45 stale!
    const store = require('../lib/customsSettlementStore.cjs');
    const plan = require('../lib/customsSettlementPlan.cjs');
    const ledger2025 = {
      version: 1,
      year: '2025',
      major: '45',
      revision: 1,
      documents: [],
      values: {},
      history: [{ id: 'h1', at: '2026-11-23T04:00:00.000Z', actorHash: 'a', planDigest: 'p', approveConflicts: false, documentCount: 1 }],
    };
    ledger2025.contentDigest = plan.hash(ledger2025);
    await fsp.writeFile(path.join(tmpRoot, '2025-45.json'), JSON.stringify(ledger2025));

    const seenQueries = [];
    const queryFn = async (statement, params) => {
      seenQueries.push({ statement, params });
      assert.equal(params.y.value, '2026');
      assert.equal(params.m.value, '45');
      assert.equal(params.mPrefix.value, '45-%');
      return { recordsets: [[{ SourceName: 'WebCustomsWeekly', UpdatedAtUtc: '2026-11-12T00:00:00.000Z' }]] };
    };

    const res2026 = await A.detectStaleProfitSnapshot({
      orderYear: '2026',
      major: '45',
      snapshotSavedAt: '2026-11-13T04:30:56.000Z',
      queryFn,
      root: tmpRoot,
    });
    assert.equal(seenQueries.length, 1);
    assert.equal(res2026.isStale, false, '2025-45 settlement file must never mark 2026-45 stale');

    // Now write a newer 2026-45 settlement ledger -> 2026-45 MUST become stale!
    const ledger2026 = {
      version: 1,
      year: '2026',
      major: '45',
      revision: 1,
      documents: [],
      values: {},
      history: [{ id: 'h2', at: '2026-11-23T03:15:00.000Z', actorHash: 'a', planDigest: 'p', approveConflicts: false, documentCount: 14 }],
    };
    ledger2026.contentDigest = plan.hash(ledger2026);
    await fsp.writeFile(path.join(tmpRoot, '2026-45.json'), JSON.stringify(ledger2026));

    const res2026After = await A.detectStaleProfitSnapshot({
      orderYear: '2026',
      major: '45',
      snapshotSavedAt: '2026-11-13T04:30:56.000Z',
      queryFn,
      root: tmpRoot,
    });
    assert.equal(res2026After.isStale, true);
    assert.equal(res2026After.staleSources[0].source, 'customsSettlementStore');
    assert.equal(res2026After.staleSources[0].scope, '2026:45');
  } finally {
    await fsp.rm(tmpRoot, { recursive: true, force: true });
  }
});

test('autoRefreshUnconfirmedProfitSnapshot: confirmed week is strictly immutable (0 compute, 0 writes)', async () => {
  const A = await import('../lib/profitReportAutoRefresh.js');
  let saveCalls = 0;
  let dutyClears = 0;

  const skipped = await A.autoRefreshUnconfirmedProfitSnapshot({
    orderYear: '2026',
    major: '44',
    actor: 'tester',
    trigger: 'customs:saveCountries',
    checkConfirm: async (y, m) => {
      assert.equal(y, '2026');
      assert.equal(m, '44');
      return { initialized: true, confirm: { confirmKey: 7, revisionNo: 1 } };
    },
    saveCache: async () => {
      saveCalls += 1;
      throw new Error('confirmed week must NEVER invoke saveCache');
    },
    clearDutyCache: () => { dutyClears += 1; },
  });

  assert.equal(skipped.action, 'skipped');
  assert.equal(skipped.refreshed, false);
  assert.equal(skipped.reason, 'confirmed');
  assert.equal(saveCalls, 0);
  assert.equal(dutyClears, 0);
});

test('autoRefreshUnconfirmedProfitSnapshot: unconfirmed week refreshes via canonical saveCache and coalesces concurrent calls', async () => {
  const A = await import('../lib/profitReportAutoRefresh.js');
  let saveCalls = 0;
  let dutyClears = 0;
  const savedArgs = [];

  const opts = {
    orderYear: '2026',
    major: '45',
    actor: 'worker:job1',
    trigger: 'settlement-register',
    checkConfirm: async () => ({ initialized: true, confirm: null }),
    saveCache: async (arg) => {
      saveCalls += 1;
      savedArgs.push(arg);
      await new Promise((r) => setTimeout(r, 25));
      return {
        action: 'saved',
        payload: { orderYear: '2026', major: '45', snapshot: { versionNo: 3, savedAt: '2026-11-23T04:30:00.000Z' } },
        snapshot: { versionNo: 3, snapKey: 999 },
      };
    },
    clearDutyCache: () => { dutyClears += 1; },
  };

  const [r1, r2] = await Promise.all([
    A.autoRefreshUnconfirmedProfitSnapshot(opts),
    A.autoRefreshUnconfirmedProfitSnapshot(opts),
  ]);
  assert.equal(saveCalls, 1, 'concurrent refreshes for same scope must share single-flight execution');
  assert.equal(dutyClears, 1);
  assert.equal(r1.refreshed, true);
  assert.equal(r2.refreshed, true);
  assert.equal(savedArgs[0].reason, 'REFRESH');
  assert.equal(savedArgs[0].orderYear, '2026');
  assert.equal(savedArgs[0].major, '45');
  assert.match(savedArgs[0].actor, /^auto-refresh:settlement-register:/);
});

test('safeAutoRefreshUnconfirmedProfitSnapshot: never throws on lock contention or transient error', async () => {
  const A = await import('../lib/profitReportAutoRefresh.js');
  const res = await A.safeAutoRefreshUnconfirmedProfitSnapshot({
    orderYear: '2026',
    major: '45',
    checkConfirm: async () => ({ initialized: true, confirm: null }),
    saveCache: async () => { throw Object.assign(new Error('busy'), { code: 'PROFIT_CACHE_BUSY' }); },
  });
  assert.equal(res.action, 'error');
  assert.equal(res.refreshed, false);
  assert.equal(res.errorCode, 'PROFIT_CACHE_BUSY');
});

test('Push wiring: registerSettlementJob auto-refreshes newly registered scopes while keeping erpWrites=0', async () => {
  const reg = await import('../lib/customsSettlementRegistration.js');
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'settlement-autorefresh-'));
  try {
    const receipt = {
      issuer: 'SUNYUL',
      documentId: 'SUNYUL-45-01',
      sourceHash: crypto.createHash('sha256').update('SUNYUL-45-01').digest('hex'),
      awb: '18012345678',
      date: '2026-11-20',
      charges: [{ code: 'HANDLING', net: 30000, vat: 3000, total: 33000 }],
      total: 33000,
      currency: 'USD',
      foreignAmount: 1000,
      grossWeight: 50,
      exchangeRate: 1340.42,
    };
    const candidate = {
      year: '2026',
      orderWeek: '45-01',
      awb: '18012345678',
      matchId: '2026|45-01|18012345678',
      targetKey: 'country|미국|01',
      currency: 'USD',
      foreignAmount: 1000,
      grossWeight: 50,
    };
    const job = {
      jobId: '00000000-0000-4000-8000-000000000045',
      year: '2026',
      major: '45',
      status: 'REVIEW_READY',
      files: [{ sourceHash: receipt.sourceHash, status: 'READY', receipt }],
    };
    const refreshedScopes = [];
    const result = await reg.registerSettlementJob(job, {
      root: tmpRoot,
      automatic: true,
      actor: 'worker:test',
      loadCandidates: async () => [candidate],
      loadContext: async (year, major) => ({
        year,
        major,
        candidates: [candidate],
        saved: {},
        mapping: { country: { HANDLING: { field: 'SunYul1_1', basis: 'total' } } },
      }),
      refreshSnapshots: async (scopes, opts) => {
        refreshedScopes.push({ scopes, opts });
        return scopes.map((s) => ({ ...s, action: 'saved', refreshed: true }));
      },
    });
    assert.equal(result.registeredDocuments, 1);
    assert.equal(result.erpWrites, 0);
    assert.equal(refreshedScopes.length, 1);
    assert.deepEqual(refreshedScopes[0].scopes, [{ orderYear: '2026', major: '45' }]);
    assert.equal(refreshedScopes[0].opts.trigger, 'settlement-register');
    assert.equal(result.snapshotRefreshes[0].refreshed, true);
  } finally {
    await fsp.rm(tmpRoot, { recursive: true, force: true });
  }
});

test('Stale-on-Read wiring: loadWeeklyReportPayload auto-refreshes stale unconfirmed week and never touches confirmed week', async () => {
  const C = await import('../lib/profitReportStoredCalculation.js');
  const S = await import('../lib/profitReportSnapshot.js');
  const policy = await import('../lib/profitReportReadPolicy.js');
  const A = await import('../lib/profitReportAutoRefresh.js');

  const api = read('pages/api/sales/profit-report.js');
  const loaderBody = api
    .slice(api.indexOf('export async function currentProfitPeriod'), api.indexOf('export async function loadAnnualMonthlyReportData'))
    .replaceAll('export ', '');

  const rawOld = { orderYear: '2026', major: '45', note: 'old', rows: [{ category: '중국', variant: 'normal', auto: { N: 1000, L: 0, O: 0, Q: 10, S: 0, H: 0, R: 199.2 }, manual: {}, stock: {} }] };
  const rawNew = { orderYear: '2026', major: '45', note: 'fresh', rows: [{ category: '중국', variant: 'normal', auto: { N: 1000, L: 0, O: 0, Q: 10, S: 0, H: 250000, R: 201.26 }, manual: {}, stock: {} }] };
  const storedOld = { orderYear: '2026', major: '45', versionNo: 2, createdAt: '2026-11-13T04:30:56.000Z', payload: C.materializeProfitPayload(rawOld) };
  const storedNew = { orderYear: '2026', major: '45', versionNo: 3, createdAt: '2026-11-23T04:30:00.000Z', payload: C.materializeProfitPayload(rawNew) };

  let confirmState = null;
  let saveCount = 0;
  let staleChecks = 0;
  let isStaleFlag = true;

  const deps = {
    ...(await import('../lib/profitMixedFreightView.js')),
    ...policy,
    materializeProfitPayload: C.materializeProfitPayload,
    estimateCalendarEvidenceByCategory: async (m, y) => ({ orderYear: y, major: m, byCategory: {} }),
    applyProfitEstimateCalendarView: (p) => p,
    loadProfitReportCalendar: async () => [],
    resolveCurrentProfitWeek: () => ({ orderYear: '2026', major: '47' }),
    resolvePreviousProfitWeek: () => ({ orderYear: '2026', major: '46' }),
    getActiveConfirm: async () => confirmState,
    buildConfirmedPayload: async () => ({ confirmed: { revisionNo: 1 }, rows: storedOld.payload.rows, confirmedTotals: storedOld.payload.totals }),
    readStoredProfitPayload: async (y, m) => S.storedProfitPayload(storedOld, { orderYear: y, major: m }),
    storedProfitPayload: S.storedProfitPayload,
    loadReportData: async () => rawNew,
    loadSourceFingerprints: async () => ({ map: new Map() }),
    currentErpReadContext: () => true,
    latestProfitInvoiceFence: async () => 'inv',
    settlementScopeFence: async () => 'settle',
    applyTemplateDutyToReport: async (p) => p,
    clearTemplateDutyCache: () => {},
    finalizeProfitCachePayload: async (p) => p,
    saveProfitCache: async (options) => {
      saveCount += 1;
      assert.equal(options.orderYear, '2026');
      assert.equal(options.major, '45');
      assert.equal(options.reason, 'REFRESH');
      return {
        action: 'saved',
        payload: { ...storedNew.payload, snapshot: S.snapshotMeta(storedNew, { state: 'stored', servedFrom: 'snapshot' }) },
        snapshot: storedNew,
      };
    },
    manualInputManifest: {},
    unclassifiedDetailsByCategory: async () => [],
    detectStaleProfitSnapshot: async ({ orderYear, major, snapshotSavedAt }) => {
      staleChecks += 1;
      assert.equal(orderYear, '2026');
      assert.equal(major, '45');
      assert.equal(snapshotSavedAt, '2026-11-13T04:30:56.000Z');
      return isStaleFlag
        ? { isStale: true, staleSources: [{ source: 'customsSettlementStore', scope: '2026:45', updatedAt: '2026-11-23T03:15:00.000Z' }] }
        : { isStale: false, staleSources: [] };
    },
    safeAutoRefreshUnconfirmedProfitSnapshot: A.safeAutoRefreshUnconfirmedProfitSnapshot,
  };

  const L = new Function(...Object.keys(deps), `${loaderBody};return {loadWeeklyReportPayload};`)(...Object.values(deps));

  // 1) Unconfirmed stale week -> auto-refreshes and returns new v3 snapshot!
  const refreshed = await L.loadWeeklyReportPayload('45', '2026');
  assert.equal(staleChecks, 1);
  assert.equal(saveCount, 1);
  assert.equal(refreshed.readMode, 'stored');
  assert.equal(refreshed.snapshot.versionNo, 3);
  assert.equal(refreshed.snapshot.autoRefreshed, true);
  assert.equal(refreshed.rows[0].auto.H, 250000);
  assert.equal(refreshed.rows[0].auto.R, 201.26);

  // 2) Unconfirmed fresh week -> 0 writes!
  isStaleFlag = false;
  const fresh = await L.loadWeeklyReportPayload('45', '2026');
  assert.equal(staleChecks, 2);
  assert.equal(saveCount, 1);
  assert.equal(fresh.snapshot.versionNo, 2);

  // 3) Confirmed week -> NEVER checks staleness, NEVER writes, returns immutable confirmed payload!
  isStaleFlag = true;
  confirmState = { initialized: true, confirm: { revisionNo: 1 } };
  const confirmed = await L.loadWeeklyReportPayload('45', '2026');
  assert.equal(confirmed.readMode, 'confirmed');
  assert.equal(staleChecks, 2, 'confirmed week must not run stale detection');
  assert.equal(saveCount, 1, 'confirmed week must never invoke saveProfitCache');
});

test('Zero ERP ledger writes & UTC timezone normalization static contract', () => {
  const autoSrc = read('lib/profitReportAutoRefresh.js');
  const forbiddenErpTables = [
    'OrderMaster', 'OrderDetail', 'ShipmentMaster', 'ShipmentDetail',
    'ShipmentDate', 'ShipmentFarm', 'Estimate', 'WarehouseMaster',
    'WarehouseDetail', 'StockMaster', 'ProductStock', 'StockHistory', 'Product', 'FreightCost',
  ];
  for (const tbl of forbiddenErpTables) {
    assert.doesNotMatch(
      autoSrc,
      new RegExp(`\\b(?:INSERT\\s+INTO|UPDATE|DELETE\\s+FROM|MERGE\\s+INTO)\\s+(?:dbo\\.)?${tbl}\\b`, 'i'),
      `lib/profitReportAutoRefresh.js must NEVER write to ERP table ${tbl}`,
    );
  }
  assert.match(autoSrc, /DATEPART\(TZOFFSET,\s*SYSDATETIMEOFFSET\(\)\)/, 'MSSQL UpdatedAt must normalize KST->UTC via SQL TZOFFSET');
  assert.match(read('pages/api/sales/customs-clearance.js'), /safeAutoRefreshUnconfirmedProfitSnapshot/);
  assert.match(read('pages/api/sales/forwarding-clearance.js'), /safeAutoRefreshUnconfirmedProfitSnapshot/);
  assert.match(read('pages/api/sales/profit-report.js'), /detectStaleProfitSnapshot/);
  assert.match(read('lib/customsSettlementRegistration.js'), /triggerProfitSnapshotAutoRefreshForScopes/);
});

test('extractKcsRatesFromSnapshotPayload & mergeKcsRatesWithSnapshotFallback: restores official KCS rates on outage, preserves Sunyul priority, and keeps totals I/K/P intact', async () => {
  const A = await import('../lib/profitReportAutoRefresh.js');
  const { resolveTaxableRate, RATE_SOURCE } = await import('../lib/taxableExchangeRate.js');
  const { computeProfitRow, computeProfitTotals } = await import('../lib/profitReportCalc.js');

  const v3Degraded = {
    orderYear: '2026',
    major: '45',
    rows: [
      { category: '호주', currency: 'AUD', source: { R: 'missing' }, auto: { R: null }, calc: { R: null } },
      { category: '네덜란드', currency: 'EUR', source: { R: 'sunyul_settlement' }, auto: { R: 1501.03 }, calc: { R: 1501.03 } },
    ],
  };
  const v2Official = {
    orderYear: '2026',
    major: '45',
    rows: [
      {
        category: '호주',
        currency: 'AUD',
        source: { R: 'approved_customs_timing_estimate' },
        auto: { R: 933.66 },
        calc: { R: 933.66 },
        rateDetail: { source: 'approved_customs_timing_estimate', estimated: true, currency: 'AUD', officialSourceRange: { start: '2026-11-08', end: '2026-11-14' } },
      },
      {
        category: '네덜란드',
        currency: 'EUR',
        source: { R: 'approved_customs_timing_estimate' },
        auto: { R: 1499.0 },
        calc: { R: 1499.0 },
        rateDetail: { source: 'approved_customs_timing_estimate', estimated: true, currency: 'EUR' },
      },
      {
        category: '미국',
        currency: 'USD',
        source: { R: 'kcs_api' },
        auto: { R: 1328.56 },
        calc: { R: 1328.56 },
      },
      // Non-KCS sources must NEVER be extracted as KCS fallback
      { category: '일본', currency: 'JPY', source: { R: 'carried_taxable_rate' }, auto: { R: 9.5 }, calc: { R: 9.5 } },
      { category: '중국', currency: 'CNY', source: { R: 'manual_invoice' }, auto: { R: 205 }, calc: { R: 205 } },
    ],
  };

  // Cross-year / cross-week payload strictly rejected
  assert.deepEqual(A.extractKcsRatesFromSnapshotPayload({ ...v2Official, orderYear: '2025' }, { orderYear: '2026', major: '45', versionNo: 2 }), {});
  assert.deepEqual(A.extractKcsRatesFromSnapshotPayload({ ...v2Official, major: '44' }, { orderYear: '2026', major: '45', versionNo: 2 }), {});

  // Valid extraction ignores carried/manual and keeps kcs_api / approved_customs_timing_estimate only
  const extracted = A.extractKcsRatesFromSnapshotPayload(v2Official, { orderYear: '2026', major: '45', versionNo: 2 });
  assert.equal(extracted['호주'].rate, 933.66);
  assert.equal(extracted['호주'].detail.restoredFromSnapshotVersion, 2);
  assert.equal(extracted['미국'].rate, 1328.56);
  assert.equal(extracted['일본'], undefined);
  assert.equal(extracted['중국'], undefined);

  // loadPriorSnapshotKcsRates skips degraded v3 and restores from v2 with exact OrderYear+MajorWeek SQL scope
  // AND executes strictly SELECT-only queries compatible with withErpReadContext!
  const { withErpReadContext } = await import('../lib/erpReadContext.js');
  const mockQuery = async (sqlText, params) => {
    const trimmed = sqlText.trim();
    assert.match(trimmed, /^SELECT\b/i, 'every SQL inside erpReadContext must start with SELECT');
    if (trimmed.includes('OBJECT_ID')) return { recordset: [{ id: 1234 }] };
    assert.match(trimmed, /WHERE OrderYear = @y AND MajorWeek = @m/);
    assert.equal(params.y.value, '2026');
    assert.equal(params.m.value, '45');
    return {
      recordset: [
        { VersionNo: 3, PayloadJson: JSON.stringify(v3Degraded) },
        { VersionNo: 2, PayloadJson: JSON.stringify(v2Official) },
      ],
    };
  };

  // Outage fallback merges missing KCS categories only — verified inside real withErpReadContext!
  const liveKcsOutage = {
    byCategory: {},
    failuresByCategory: {
      호주: [{ date: '2026-11-09', reason: 'parse_error', message: 'HTML system error' }],
      네덜란드: [{ date: '2026-11-09', reason: 'http_error', message: 'HTTP 500' }],
      미국: [{ date: null, reason: 'missing_declaration_date', message: 'no date' }],
    },
  };
  const merged = await withErpReadContext(
    { queryFn: mockQuery, allowExternalEvidenceReads: true, serializeReads: false },
    () => A.mergeKcsRatesWithSnapshotFallback('2026', '45', liveKcsOutage),
  );
  assert.equal(merged.byCategory['호주'].rate, 933.66);
  assert.equal(merged.byCategory['네덜란드'].rate, 1499.0);
  // missing_declaration_date is NOT a KCS outage -> must NOT restore 미국
  assert.equal(merged.byCategory['미국'], undefined);
  assert.ok(merged.failuresByCategory['미국']);

  // Priority check: Sunyul settlement ALWAYS overrides restored KCS fallback for 네덜란드,
  // while 호주 (no Sunyul settlement) uses restored KCS 933.66 -> totals I, K, P, J all non-null!
  const nlResolved = resolveTaxableRate({
    settlementRate: 1501.03,
    settlementDetail: { source: 'sunyul_settlement' },
    kcsRate: merged.byCategory['네덜란드'].rate,
    kcsDetail: merged.byCategory['네덜란드'].detail,
  });
  assert.equal(nlResolved.source, RATE_SOURCE.SUNYUL_SETTLEMENT);
  assert.equal(nlResolved.rate, 1501.03);

  const auResolved = resolveTaxableRate({
    settlementRate: null,
    kcsRate: merged.byCategory['호주'].rate,
    kcsDetail: merged.byCategory['호주'].detail,
  });
  assert.equal(auResolved.source, RATE_SOURCE.APPROVED_TIMING_ESTIMATE);
  assert.equal(auResolved.rate, 933.66);

  const nlRow = computeProfitRow({ category: '네덜란드', variant: 'normal', auto: { N: 32000000, L: 0, O: 0, Q: 15000, S: 2000, H: 1143190, E: 100000, F: 200000, R: nlResolved.rate }, manual: {} });
  const auRow = computeProfitRow({ category: '호주', variant: 'normal', auto: { N: 9800000, L: 0, O: 0, Q: 7000, S: 0, H: 344712, E: 50000, F: 80000, R: auResolved.rate }, manual: {} });
  const totals = computeProfitTotals([
    { category: '네덜란드', variant: 'normal', calc: nlRow },
    { category: '호주', variant: 'normal', calc: auRow },
  ]);
  assert.ok(Number.isFinite(totals.P) && totals.P > 0, 'totals.P must be computed');
  assert.ok(Number.isFinite(totals.I) && totals.I > 0, 'totals.I must be computed');
  assert.ok(Number.isFinite(totals.J), 'totals.J must be computed');
  assert.ok(Number.isFinite(totals.K), 'totals.K must be computed');
});

test('autoRefreshUnconfirmedProfitSnapshot: avoids duplicate actor suffix when trigger === actor', async () => {
  const A = await import('../lib/profitReportAutoRefresh.js');
  let capturedActor = null;
  await A.autoRefreshUnconfirmedProfitSnapshot({
    orderYear: '2026',
    major: '43',
    actor: 'stale-read',
    trigger: 'stale-read',
    checkConfirm: async () => ({ initialized: true, confirm: null }),
    saveCache: async (arg) => {
      capturedActor = arg.actor;
      return { action: 'saved', payload: {}, snapshot: {} };
    },
    clearDutyCache: () => {},
  });
  assert.equal(capturedActor, 'auto-refresh:stale-read');
});

test('loadCoherentLatestReport fence ignores strictly future week edits (> major) while rejecting same/prior week mutations', async () => {
  const C = await import('../lib/profitReportStoredCalculation.js');
  const policy = await import('../lib/profitReportReadPolicy.js');
  const api = read('pages/api/sales/profit-report.js');
  const loaderBody = api
    .slice(api.indexOf('export async function currentProfitPeriod'), api.indexOf('export async function loadAnnualMonthlyReportData'))
    .replaceAll('export ', '');

  const raw = { orderYear: '2026', major: '43', rows: [{ category: '중국', variant: 'normal', auto: { N: 100, L: 0, O: 0, Q: 1, S: 0, H: 0, R: 200 }, manual: {}, stock: {} }] };
  let futureVersion = 1;
  let sameWeekVersion = 1;
  let mutateFuture = true;
  let mutateSame = false;

  const deps = {
    ...(await import('../lib/profitMixedFreightView.js')),
    ...policy,
    materializeProfitPayload: C.materializeProfitPayload,
    estimateCalendarEvidenceByCategory: async (m, y) => ({ orderYear: y, major: m, byCategory: {} }),
    applyProfitEstimateCalendarView: (p) => p,
    loadProfitReportCalendar: async () => [],
    resolveCurrentProfitWeek: () => ({ orderYear: '2026', major: '47' }),
    resolvePreviousProfitWeek: () => ({ orderYear: '2026', major: '46' }),
    getActiveConfirm: async () => null,
    buildConfirmedPayload: async () => ({}),
    readStoredProfitPayload: async () => { throw new Error('unused'); },
    storedProfitPayload: (x) => x,
    loadReportData: async () => {
      if (mutateFuture) futureVersion += 1;
      if (mutateSame) sameWeekVersion += 1;
      return raw;
    },
    loadSourceFingerprints: async () => ({
      map: new Map([
        ['SHIP:2026:43', `10|1|${sameWeekVersion}`],
        ['SHIP:2026:47', `99|9|${futureVersion}`],
      ]),
    }),
    currentErpReadContext: () => true,
    latestProfitInvoiceFence: async () => 'inv',
    settlementScopeFence: async () => 'settle',
    applyTemplateDutyToReport: async (p) => p,
    clearTemplateDutyCache: () => {},
    finalizeProfitCachePayload: async (p) => p,
    saveProfitCache: async (_o, compute) => compute('43', '2026'),
    manualInputManifest: {},
    unclassifiedDetailsByCategory: async () => [],
  };

  const L = new Function(...Object.keys(deps), `${loaderBody};return {saveProfitReportCache};`)(...Object.values(deps));

  // Future week (2026:47) changing mid-compute MUST NOT abort 2026:43!
  const ok = await L.saveProfitReportCache({ orderYear: '2026', major: '43' });
  assert.equal(ok.major, '43');

  // Same week (2026:43) changing mid-compute MUST still abort with 409 PROFIT_SOURCES_CHANGED!
  mutateFuture = false;
  mutateSame = true;
  await assert.rejects(
    L.saveProfitReportCache({ orderYear: '2026', major: '43' }),
    (e) => e.code === 'PROFIT_SOURCES_CHANGED' && e.statusCode === 409,
  );
});
