// Executable category-scoped estimate fix-cycle regression tests.
// Run: node __tests__/estimateCategoryCycle.test.js

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

import {
  normalizeEstimateEditProdKeys,
  resolveEstimateEditCategories,
  runScopedEstimateFixCycle,
} from '../lib/estimateCategoryCycle.js';
import { evaluatePartialCategoryFixBlock } from '../lib/shipmentFixGuards.js';

function loadFixApi({ query = async () => ({ recordset: [] }), withTransaction, advance = async () => {}, assertGuard = async () => {},
  lockGate = async () => ({ protocolVersion: 2 }), clearGate = async () => ({ cleared: true }) } = {}) {
  let source = fs.readFileSync(new URL('../pages/api/shipment/fix.js', import.meta.url), 'utf8');
  source = source
    .replace(/^import[\s\S]*?;\r?\n/gm, '')
    .replace('export default withAuth', 'withAuth');

  const tx = withTransaction || (async (work) => work(query));
  const sql = { NVarChar: 'NVarChar', Int: 'Int', Bit: 'Bit', Float: 'Float' };
  const context = {
    console,
    setTimeout,
    query,
    withTransaction: tx,
    sql,
    withAuth: (handler) => handler,
    reconcileWeekAfterScopedOperation: async () => ({ recalculatedCount: 0, stockErrors: [], parity: {} }),
    evaluatePartialCategoryFixBlock,
    labelsFromCategoryTargets: (rows) => rows.map((row) => row.label || row.countryFlower),
    evaluateCheckFixCancel: () => ({}),
    evaluateUnfixStockCalcResult: () => ({}),
    retryWithDelays: async (work) => work(0),
    calculateStockShortage: () => 0,
    roundStockQuantity: Number,
    requireOrderYear: () => ({}),
    assertErpEditGuard: assertGuard,
    advanceErpEditGuard: advance,
    editErrorResponse: (error) => ({ statusCode: error.statusCode || 500, body: { error: error.message } }),
    normalizeEstimateEditProdKeys,
    resolveEstimateEditCategories,
    // Ownership semantics are executed separately against real SQL by
    // stockGateOwnership.test.js; these seams isolate category transaction scope.
    lockStockGateOperation: lockGate,
    clearStockGateOperation: clearGate,
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nglobalThis.__fixApi = { loadEstimateEditGroups, resolveFixCategoryScope, runFixTargetProcedure, shipmentProcedureSql, runStockCalculationForProducts };`, context, {
    filename: 'pages/api/shipment/fix.js',
  });
  return { ...context.__fixApi, sql };
}

async function rejects(work, matcher) {
  let error;
  try {
    await work();
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, 'expected the operation to reject');
  if (matcher instanceof RegExp) assert.match(error.message, matcher);
  else if (typeof matcher === 'function') assert.equal(matcher(error), true);
}

async function main() {
  let pass = 0;
  const test = async (label, work) => {
    try {
      await work();
      pass += 1;
      console.log(`  ✓ ${label}`);
    } catch (error) {
      console.error(`  ✗ ${label}\n    ${error.stack || error.message}`);
      process.exitCode = 1;
    }
  };

  console.log('=== estimate category scope ===');
  await test('Hydro only resolves to its exact product keys', () => {
    assert.deepEqual(
      resolveEstimateEditCategories([101, 102], [
        { ProdKey: 101, CountryFlower: 'Hydro' },
        { ProdKey: 102, CountryFlower: 'Rose' },
      ], ['Hydro']),
      [{ countryFlower: 'Hydro', prodKeys: [101] }],
    );
  });
  await test('other categories remain outside the requested scope', () => {
    const groups = resolveEstimateEditCategories([101, 102], [
      { ProdKey: 101, CountryFlower: 'Hydro' },
      { ProdKey: 102, CountryFlower: 'Rose' },
    ]);
    assert.deepEqual(groups, [
      { countryFlower: 'Hydro', prodKeys: [101] },
      { countryFlower: 'Rose', prodKeys: [102] },
    ]);
  });
  await test('empty, invalid, missing, deleted, and unclassified product keys reject', async () => {
    for (const keys of [[], [''], ['1', 'x'], [0], [-2], [true], [{}], [null], ['1e2'], ['1.5']]) {
      await rejects(() => Promise.resolve(normalizeEstimateEditProdKeys(keys)), /품목번호/);
    }
    for (const products of [[], [{ ProdKey: 101, isDeleted: 1, CountryFlower: 'Hydro' }], [{ ProdKey: 101, CountryFlower: '' }]]) {
      await rejects(() => Promise.resolve(resolveEstimateEditCategories([101], products)), /전산 품종/);
    }
  });
  await test('requested client category mismatch rejects instead of widening', async () => {
    await rejects(
      () => Promise.resolve(resolveEstimateEditCategories([101], [{ ProdKey: 101, CountryFlower: 'Hydro' }], ['Rose'])),
      /일치하지 않습니다/,
    );
  });

  console.log('=== server scope helpers extracted through node:vm ===');
  await test('server resolves CountryFlower from Product, not client labels', async () => {
    const { resolveFixCategoryScope } = loadFixApi({
      query: async () => ({ recordset: [{ ProdKey: 101, CountryFlower: 'Hydro', isDeleted: 0 }] }),
    });
    const req = { body: { editProdKeys: [101], countryFlowers: ['client label'], editGuard: { baseline: 1 }, custKey: 4 } };
    await rejects(() => resolveFixCategoryScope(req, req.body.countryFlowers), /ESTIMATE_CATEGORY_SCOPE_INVALID|일치하지 않습니다/);
    const matched = { body: { editProdKeys: [101], countryFlowers: ['Hydro'], editGuard: { baseline: 1 }, custKey: 4 } };
    assert.deepEqual([...await resolveFixCategoryScope(matched, matched.body.countryFlowers)], ['Hydro']);
    assert.deepEqual(matched.estimateEditGroups, [{ countryFlower: 'Hydro', prodKeys: [101] }]);
    for (const countryFlowers of [undefined, [], ['Hydro', 'Rose']]) {
      await rejects(() => resolveFixCategoryScope({ body: { editProdKeys: [101], editGuard: { baseline: 1 }, custKey: 4 } }, countryFlowers), /품종 한 개씩/);
    }
  });
  await test('server scope rejects missing/deleted/no-CountryFlower Product rows', async () => {
    for (const recordset of [[], [{ ProdKey: 101, CountryFlower: 'Hydro', isDeleted: 1 }], [{ ProdKey: 101, CountryFlower: '  ', isDeleted: 0 }]]) {
      const { loadEstimateEditGroups } = loadFixApi({ query: async () => ({ recordset }) });
      await rejects(() => loadEstimateEditGroups([101]), /전산 품종/);
    }
  });
  await test('legacy manual filter remains blocked while validated scoped edit can target one category', async () => {
    const targets = [{ countryFlower: 'Hydro', label: 'Hydro' }, { countryFlower: 'Rose', label: 'Rose' }];
    const { resolveFixCategoryScope } = loadFixApi({
      query: async () => ({ recordset: [{ ProdKey: 101, CountryFlower: 'Hydro', isDeleted: 0 }] }),
    });
    const legacy = await resolveFixCategoryScope({ body: { countryFlowers: ['Hydro'] } }, ['Hydro']);
    assert.equal(evaluatePartialCategoryFixBlock(targets, legacy).code, 'PARTIAL_CATEGORY_FIX_BLOCKED');
    const scopedReq = { body: { editProdKeys: [101], countryFlowers: ['Hydro'], editGuard: { baseline: 1 }, custKey: 4 } };
    await resolveFixCategoryScope(scopedReq, ['Hydro']);
    assert.deepEqual(scopedReq.estimateEditGroups, [{ countryFlower: 'Hydro', prodKeys: [101] }]);
  });
  await test('scoped server rejects unsupported SP rather than calling ALL', async () => {
    let transactionCalls = 0;
    const { runFixTargetProcedure } = loadFixApi({
      withTransaction: async () => { transactionCalls += 1; },
    });
    const req = { body: { editProdKeys: [101], custKey: 4 }, estimateEditGroups: [{ countryFlower: 'Hydro', prodKeys: [101] }], user: {} };
    await rejects(() => runFixTargetProcedure('usp_ShipmentFix', { hasCountryFlower: false }, '2026', '34-02', 'admin', 'Hydro', req, true), /전체 품종/);
    assert.equal(transactionCalls, 0);
  });
  await test('each scoped category transaction rolls back on SP result or lease advance failure', async () => {
    for (const failure of ['sp', 'advance']) {
      const events = [];
      const transaction = async (work) => {
        events.push('begin');
        try { const value = await work(async (statement) => {
          if (statement.includes('FROM Product')) return { recordset: [{ ProdKey: 101, CountryFlower: 'Hydro', isDeleted: 0 }] };
          if (/EXEC\s+(?:@ret\s*=\s*)?dbo\.usp_ShipmentFix/.test(statement)) return { recordset: [{ result: failure === 'sp' ? 9 : 0, returnCode: failure === 'sp' ? -1 : 0, message: 'failed SP' }] };
          return { recordset: [] };
        }); events.push('commit'); return value; }
        catch (error) { events.push('rollback'); throw error; }
      };
      const { runFixTargetProcedure } = loadFixApi({
        withTransaction: transaction,
        advance: async () => { if (failure === 'advance') throw new Error('lease advance failed'); },
      });
      const req = { body: { editProdKeys: [101], custKey: 4, editGuard: { token: 'fixture' } }, estimateEditGroups: [{ countryFlower: 'Hydro', prodKeys: [101] }], user: {} };
      await rejects(() => runFixTargetProcedure('usp_ShipmentFix', { hasCountryFlower: true, hasOutput: true }, '2026', '34-02', 'admin', 'Hydro', req, false), /failed SP|lease advance failed/);
      assert.deepEqual(events, ['begin', 'rollback']);
    }
  });
  await test('skip calculation clears only its matching WAIT_CALC gate', async () => {
    const gateUpdates = [];
    let ownedScope;
    const { runFixTargetProcedure } = loadFixApi({
      lockGate: async (tQ, types, scope) => { ownedScope = { ...scope }; return ownedScope; },
      clearGate: async (tQ, types, operation, native) => { gateUpdates.push({ operation, native }); return { cleared: true }; },
      withTransaction: async (work) => work(async (statement, params) => {
        if (statement.includes('FROM Product')) return { recordset: [{ ProdKey: 101, CountryFlower: 'Hydro', isDeleted: 0 }] };
        if (/EXEC\s+(?:@ret\s*=\s*)?dbo\.usp_ShipmentFixCancel/.test(statement)) return { recordset: [{ result: 0, returnCode: 0, message: 'ok' }] };
        return { recordset: [] };
      }),
    });
    const req = { body: { editProdKeys: [101], custKey: 4 }, estimateEditGroups: [{ countryFlower: 'Hydro', prodKeys: [101] }], user: {} };
    await runFixTargetProcedure('usp_ShipmentFixCancel', { hasCountryFlower: true, hasOutput: true }, '2026', '34-02', 'admin', 'Hydro', req, true);
    assert.equal(gateUpdates.length, 1);
    assert.equal(gateUpdates[0].operation, ownedScope);
    assert.equal(ownedScope.orderYear, '2026');
    assert.equal(ownedScope.orderWeek, '34-02');
    assert.equal(ownedScope.action, 'CANCEL');
    assert.equal(gateUpdates[0].native.nativeResult, 0);
    assert.equal(gateUpdates[0].native.nativeReturnCode, 0);
  });

  await test('legacy CALC requires explicit zero return and output in both full and product branches', async () => {
    for (const full of [false, true]) {
      for (const output of [{ result: 0, returnCode: 0 }, { result: null, returnCode: 0 },
        { result: 0, returnCode: null }, { result: 0, returnCode: -1 }, { result: -1, returnCode: 0 }, {}]) {
        const calls = [];
        const api = loadFixApi({ query: async (statement, params) => {
          if (statement.includes('FROM dbo.NenovaStockWeekGate')) return { recordset: [full
            ? { Mode: 'WAIT_CALC', OrderYear: '2026', OrderWeek: '34-02' }
            : { Mode: null }] };
          if (statement.includes('usp_StockCalculation')) { calls.push({ statement, params }); return { recordset: [output] }; }
          return { recordset: [] };
        } });
        const result = await api.runStockCalculationForProducts('2026', '34-02', 'fixture', [101]);
        assert.equal(calls.length, 1);
        assert.match(calls[0].statement, /EXEC @ret=dbo\.usp_StockCalculation/);
        assert.doesNotMatch(calls[0].statement, /ISNULL\(@r/);
        assert.equal(calls[0].params.pk?.value, full ? undefined : 101);
        const success = output.result === 0 && output.returnCode === 0;
        assert.equal(result.results.length, success ? 1 : 0);
        assert.equal(result.errors.length, success ? 0 : 1);
      }
    }
  });

  console.log('=== executable client cycle ===');
  await test('new-add cycle skips unfix calculation but calculates each refix before later weeks', async () => {
    const actions = [];
    await runScopedEstimateFixCycle({
      weeks: ['34-01', '34-02'], orderYear: '2026', prodKeys: [101], lightStock: true,
      resolveScope: async () => [{ countryFlower: 'Hydro', prodKeys: [101] }],
      runAction: async (call) => { actions.push(call); return { results: [{ ok: true, countryFlower: 'Hydro' }] }; },
      apply: async () => 'saved',
    });
    const fixes = actions.filter((call) => call.action === 'fix');
    assert.equal(fixes.length, 2);
    assert.equal(fixes[0].skipStockCalc, undefined);
    assert.equal(fixes[1].skipStockCalc, undefined);
    assert.equal(fixes[0].week, '34-01');
    assert.equal(fixes[1].week, '34-02');
    assert(actions.filter(call => call.action === 'unfix').every(call => call.skipStockCalc === true));

    const recovery = [];
    await rejects(() => runScopedEstimateFixCycle({
      weeks: ['34-02'], orderYear: '2026', prodKeys: [101], lightStock: true,
      resolveScope: async () => [{ countryFlower: 'Hydro', prodKeys: [101] }],
      runAction: async (call) => { recovery.push(call); return call.action === 'unfix' ? { results: [{ ok: true, countryFlower: 'Hydro' }] } : { results: [] }; },
      apply: async () => { throw new Error('save failed'); },
    }), /save failed/);
    const recoveryFixes = recovery.filter((call) => call.action === 'fix');
    assert.equal(recoveryFixes.length, 1);
    assert.equal(recoveryFixes[0].skipStockCalc, undefined);
  });
  await test('failed partial unfix recovers only explicit successful categories and never applies', async () => {
    const calls = [];
    let applied = false;
    const original = new Error('Rose unfix failed');
    original.data = { results: [{ ok: true, countryFlower: 'Rose' }, { ok: true, countryFlower: 'unrelated' }] };
    await rejects(() => runScopedEstimateFixCycle({
      weeks: ['34-01', '34-02'], orderYear: '2026', prodKeys: [101, 102],
      resolveScope: async () => [{ countryFlower: 'Hydro', prodKeys: [101] }, { countryFlower: 'Rose', prodKeys: [102] }],
      runAction: async (call) => {
        calls.push(call);
        if (call.action === 'unfix' && call.countryFlowers[0] === 'Hydro') return { results: [{ ok: true, countryFlower: 'Hydro' }] };
        if (call.action === 'unfix') throw original;
        return { results: [] };
      },
      apply: async () => { applied = true; },
    }), /Rose unfix failed/);
    assert.equal(applied, false);
    assert.deepEqual(calls.filter((call) => call.action === 'fix').map((call) => call.countryFlowers[0]).sort(), ['Hydro', 'Rose']);
    assert(calls.every((call) => call.countryFlowers.length === 1 && call.countryFlowers[0] !== 'unrelated'));
  });
  await test('recovery errors augment but never mask the original failure', async () => {
    await rejects(() => runScopedEstimateFixCycle({
      weeks: ['34-02'], orderYear: '2026', prodKeys: [101],
      resolveScope: async () => [{ countryFlower: 'Hydro', prodKeys: [101] }],
      runAction: async (call) => {
        if (call.action === 'unfix') {
          const error = new Error('original unfix failure');
          error.data = { results: [{ ok: true, countryFlower: 'Hydro' }] };
          throw error;
        }
        throw new Error('recovery fix failure');
      },
      apply: async () => { throw new Error('must not apply'); },
    }), (error) => /original unfix failure/.test(error.message) && /복구 미완료/.test(error.message) && error.recoveryFailures.length === 1);
  });
  await test('ambiguous or originally-unfixed responses never trigger broad retry or refix', async () => {
    const ambiguous = [];
    await rejects(() => runScopedEstimateFixCycle({
      weeks: ['34-02'], orderYear: '2026', prodKeys: [101],
      resolveScope: async () => [{ countryFlower: 'Hydro', prodKeys: [101] }],
      runAction: async (call) => { ambiguous.push(call); const error = new Error('network lost'); error.data = { _ambiguousResponse: true }; throw error; },
      apply: async () => { throw new Error('must not apply'); },
    }), /저장을 반복하지 말고/);
    assert.deepEqual(ambiguous.map((call) => call.action), ['unfix']);

    const unfixed = [];
    await runScopedEstimateFixCycle({
      weeks: ['34-02'], orderYear: '2026', prodKeys: [101],
      resolveScope: async () => [{ countryFlower: 'Hydro', prodKeys: [101] }],
      runAction: async (call) => { unfixed.push(call); return { results: [] }; },
      apply: async () => 'saved',
    });
    assert.deepEqual(unfixed.map((call) => call.action), ['unfix']);
  });

  console.log(`\n${pass} passed`);
  if (process.exitCode) process.exit(process.exitCode);
}

main();
