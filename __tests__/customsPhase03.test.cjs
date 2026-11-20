const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const p = require('../lib/customsPhase03.cjs'), store = require('../lib/customsSettlementStore.cjs'), plan = require('../lib/customsSettlementPlan.cjs');
const empty = () => ({ version: 1, year: '2026', major: '44', revision: 0, documents: [], values: {}, history: [] });
const entry = (costs = { duty: 1000, serviceNet: 100, serviceVat: 10, importVat: 400 }) => ({ year: '2026', orderWeek: '44-03', awb: '12312345678', category: '중국', costs });
const doc = () => { const r = { issuer: 'SUNYUL', documentId: 'TEST-0301', sourceHash: 'a'.repeat(64), date: '2026-11-01', awb: '12312345678', matchedOrderWeek: '44-03', targetKey: 'country|중국|03', charges: [{ code: 'DUTY', net: 0, vat: 0, total: 1000 }, { code: 'HANDLING', net: 100, vat: 10, total: 110 }, { code: 'IMPORT_VAT', net: 0, vat: 0, total: 400 }], total: 1510 }; return { ...r, fingerprint: plan.receiptFingerprint(r) }; };
const ledger = () => ({ ...empty(), revision: 1, documents: [doc()], values: { 'country|중국|03': { Customs3_1: 1000, SunYul3_1: 110 } } });

test('03 typed costs preserve zero/null, separate VAT and reject wrong-year or incomplete pairs', () => {
  assert.equal(p.validateEntry(entry(), 2026, 44).costs.serviceNet, 100);
  assert.throws(() => p.validateEntry(entry(), 2025, 44));
  assert.throws(() => p.validateEntry(entry(), 2026, 43));
  assert.throws(() => p.validateEntry(entry({ serviceNet: 100 }), 2026, 44));
  assert.throws(() => p.validateEntry(entry({ duty: -1 }), 2026, 44));
  assert.throws(() => p.validateEntry(entry({ WorldFreight3: 1 }), 2026, 44));
  assert.equal(p.validateEntry(entry({ duty: 0 }), 2026, 44).costs.duty, 0);
  const noCosts = p.phase03Rows({ ...empty(), manualPhase03: [entry({ duty: null, importVat: 400 })] });
  assert.equal(noCosts[0].total, null, 'Missing cost is not evidence of a zero amount');
  assert.equal(p.phase03Rows({ ...empty(), manualPhase03: [entry({ duty: 0 })] })[0].total, 0);
});
test('validated ZIP phase03 includes duty/net once, never import VAT or fee VAT', () => {
  const l = ledger(); store.validateLedger(l, 2026, 44);
  assert.equal(p.phase03Totals(p.phase03Rows(l)).total, 1100);
  l.documents[0].matchedOrderWeek = '44-02'; assert.throws(() => store.validateLedger(l, 2026, 44));
});
test('same-AWB manual zero is preserved over ZIP, missing manual field uses ZIP once', () => {
  const l = { ...ledger(), manualPhase03: [entry({ duty: 0 })] }, before = JSON.stringify(l);
  store.validateLedger(l, 2026, 44);
  const rows = p.phase03Rows(l); assert.equal(rows[0].total, 100); assert.deepEqual(rows[0].conflicts, ['duty']);
  assert.equal(JSON.stringify(l), before);
});
test('legacy China identities do not leak across year/AWB and require original phase01 amount', () => {
  for (const [major, awb] of [['40', '78469386914'], ['41', '99992374236'], ['43', '11290068602']]) {
    const r = { ...entry(), orderWeek: `${major}-03`, awb };
    assert.equal(p.legacyPhase(r), '01'); assert.equal(p.legacyPhase({ ...r, year: '2025' }), null);
    assert.throws(() => p.validateManual([r], 2026, major));
    const rows = [{ ...r, legacyPhase: '01', documents: [{}], costs: { duty: 1000, serviceNet: 100, serviceVat: 10 } }];
    p.assertLegacyCovered(rows, { Customs1: 1000, SunYul1: 110 });
    assert.throws(() => p.assertLegacyCovered(rows, { Customs1: 0, SunYul1: 110 }));
    assert.equal(p.phase03Totals(rows).total, 0);
  }
});
test('shared report formula and preview include third phase without mutating first/second', async () => {
  const { settlementCountryRow } = await import('../lib/customsSettlementEvidence.js');
  const { computeCountryCustomsTotal } = await import('../lib/customsForwardingCalc.js');
  const saved = Object.freeze({ Customs1: 5, SunYul1: 110, Customs2: 7, SunYul2: 220 });
  const row = settlementCountryRow(saved, ledger(), '중국');
  assert.equal(computeCountryCustomsTotal(row, { BakSangRate: 460 }, '중국'), 1412);
  assert.equal(computeCountryCustomsTotal(saved, {}, '중국'), 312);
  assert.equal(saved.Phase03Total, undefined);
});
test('phase03 context supports actual third subweek, not unrelated year', async () => {
  const { settlementContextFromRows } = await import('../lib/customsSettlementContext.js');
  const row = { WarehouseKey: 1, WdetailKey: 2, OrderYear: '2026', OrderWeek: '44-03', OrderNo: '12312345678', CounName: '중국', FlowerName: '장미', ProdName: 'test', TPrice: 1 };
  const c = settlementContextFromRows({ year: 2026, major: 44, warehouse: [row, { ...row, OrderYear: '2025' }], countries: [], colombia: [], confirmed: false });
  assert.equal(c.candidates.length, 1); assert.equal(c.candidates[0].targetKey, 'country|중국|03');
  const result = plan.buildSettlementPlan({ ...c, receipts: [doc()] });
  assert.equal(result.issues.length, 0); assert.equal(result.patches.length, 2);
});
test('file-only manual save checks latest digest, readback and candidate; ZIP writer preserves manual data', async () => {
  const { savePhase03, phase03View } = await import('../lib/customsPhase03Service.js');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'customs-phase03-'));
  const c = { year: '2026', major: '44', candidates: [{ year: '2026', orderWeek: '44-03', awb: '12312345678', targetKey: 'country|중국|03', matchId: '2026|44-03|12312345678' }], saved: {}, mapping: {}, confirmed: false };
  const options = { year: 2026, major: 44, input: entry(), root, loadContext: async () => c, confirmed: true, actor: 'fixture' };
  const digest = phase03View(c, empty()).digest;
  const result = await savePhase03({ ...options, expectedDigest: digest });
  assert.equal(result.erpWrites, 0); assert.equal(result.reportWrites, 0); assert.equal(result.phase03.rows[0].total, 1100);
  await assert.rejects(savePhase03({ ...options, expectedDigest: digest }), /바뀌었습니다/);
  const l = await store.readLedger(root, 2026, 44);
  assert.equal(l.manualPhase03.length, 1); assert.equal(l.documents.length, 0); assert.equal(l.history[0].after.costs.duty, 1000);
  await assert.rejects(savePhase03({ ...options, input: { ...entry(), awb: '99999999999' }, expectedDigest: phase03View(c, l).digest }), /유일한/);
  const makePlan = async current => plan.buildSettlementPlan({ ...c, receipts: [doc()], applied: current.documents, mapping: { country: { DUTY: { field: 'Customs3_1', basis: 'total' }, HANDLING: { field: 'SunYul3_1', basis: 'total' } } } });
  const preview = await makePlan(l);
  await store.applySettlementPlan({ root, year: 2026, major: 44, expectedDigest: preview.planDigest, confirmed: true, actor: 'fixture', makePlan });
  const combined = await store.readLedger(root, 2026, 44);
  assert.deepEqual(combined.manualPhase03, l.manualPhase03); assert.equal(combined.documents.length, 1);
  assert.equal(p.phase03Totals(p.phase03Rows(combined)).total, 1100);
});
test('03 policy participates in calculation fingerprint', () => {
  assert(require('../lib/profitReportCalcHash.cjs').listFiles(process.cwd()).includes('lib/customsPhase03.cjs'));
});
test('Vietnam legacy net ZIP values remain canonical while costs use evidenced gross exactly once', async () => {
  const { settlementCountryRow } = await import('../lib/customsSettlementEvidence.js');
  const { computeCountryCustomsTotal } = await import('../lib/customsForwardingCalc.js');
  const l = ledger(); l.documents[0].targetKey = 'country|베트남|01'; l.documents[0].matchedOrderWeek = '44-01';
  l.values = { 'country|베트남|01': { Customs1_1: 1000, SunYul1_1: 100 } };
  store.validateLedger(l, 2026, 44); const before = JSON.stringify(l);
  for (const saved of [null, { SunYul1: 100 }, { SunYul1: 110 }, { SunYul1_1: 40, SunYul1_2: 60 }]) {
    const row = settlementCountryRow(saved, l, '베트남'); assert.equal(row.SunYul1, 110);
    assert.equal(computeCountryCustomsTotal(row, {}, '베트남'), 1110);
    assert.equal(settlementCountryRow(row, l, '베트남').SunYul1, 110);
  }
  for (const n of [0, 120]) assert.equal(settlementCountryRow({ SunYul1: n }, l, '베트남').SunYul1, n);
  assert.equal(JSON.stringify(l), before);
});
test('Vietnam verified PDF projection requires exact scope/AWB and an existing matching amount', async () => {
  const { settlementCountryRow } = await import('../lib/customsSettlementEvidence.js');
  const saved = { SunYul1_1: 27000, SunYul1_2: 36000 };
  const scope = { year: '2026', major: '35', awbSources: [{ year: '2026', orderWeek: '35-01', awb: '73806000993' }] };
  assert.equal(settlementCountryRow(saved, empty(), '베트남', scope).SunYul1, 69300);
  for (const bad of [{ ...scope, year: '2025' }, { ...scope, major: '34' }, { ...scope, awbSources: [] }, { ...scope, awbSources: [...scope.awbSources, { ...scope.awbSources[0], awb: '99999999999' }] }]) assert.equal(settlementCountryRow(saved, empty(), '베트남', bad), saved);
  assert.equal(settlementCountryRow(null, empty(), '베트남', scope), null);
});
test('third-phase Vietnam includes only service VAT, never import VAT', () => {
  const l = { ...empty(), manualPhase03: [{ ...entry(), category: '베트남' }] };
  assert.equal(p.phase03Totals(p.phase03Rows(l)).total, 1110);
});
test('China duty replacement consumes exact AWB03 actual duty only once and preserves legacy scope guard', async () => {
  const { calculateTemplateDuty } = await import('../lib/profitTemplateDuty.mjs');
  const sources = p.phase03Rows(ledger());
  const row = { category: '중국', currency: 'CNY', customsComponents: { Customs1: 0, Customs2: 200, Phase03: sources }, calc: { H: 1310 }, manual: {}, source: {} };
  const input = { year: '2026', major: '44', category: '중국', row, customsRow: { Customs1: 0, Customs2: 200 }, policy: { products: [] }, lines: [{ orderYear: '2026', orderWeek: '44-03', category: '중국', awb: '123-12345678' }] };
  const result = calculateTemplateDuty(input); assert.equal(result.H, 1310); assert.equal(result.deltaH, 0); assert.equal(result.total, 1200);
  assert.equal(calculateTemplateDuty({ ...input, lines: [{ ...input.lines[0], awb: '99999999999' }] }).H, null);
});
test('Thai third-phase actual fee/duty replace that phase estimate, not double counted in folded GW1', async () => {
  const { resolveApprovedThaiCustoms } = await import('../lib/profitReportActualCosts.mjs');
  const row = { Phase03: [{ costs: { duty: 1000, serviceNet: 100 } }], Phase03Total: 1100 };
  const p = { orderYear: '2026', major: 44, row, gw: { GW1: 240, GW2: 0 }, phase03GW: 240, inboundWeeks: ['44-03'] };
  const result = resolveApprovedThaiCustoms({ policyInput: p }, { orderYear: '2026', major: 44 });
  assert.equal(result.components.phase03, 1100); assert.equal(result.components.customs, 0); assert.equal(result.components.sunYul, 0);
  assert.equal(result.components.warehouse, 110400); assert.equal(result.total, 201500);
  const missing = resolveApprovedThaiCustoms({ policyInput: { ...p, phase03GW: null } }, { orderYear: '2026', major: 44 });
  assert.equal(missing.total, null); assert.deepEqual(missing.missing, ['phase03_weight_scope']);
});
