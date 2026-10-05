import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import path from 'node:path';

registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); }
  catch (error) {
    if ((error.code === 'ERR_MODULE_NOT_FOUND' || error.code === 'ERR_UNSUPPORTED_DIR_IMPORT') && /^\.\.?\//.test(specifier) && !path.extname(specifier)) {
      return nextResolve(`${specifier}.js`, context);
    }
    throw error;
  }
} });

const {
  normalizeDutchEntries, normalizeDutchPrice, resolveDutchPairPolicy,
  dutchEstUnitConversionIssue, assessDutchPriceReadback,
} = await import('../lib/dutchVolumeDistribution.js');
const {
  assertUniqueDutchLedger, findDutchFarmQtyBlockers, findDutchDateIntegrityBlockers,
} = await import('../lib/dutchVolumeDistributionSnapshot.js');
const { normalizeUploadQtyForProduct } = await import('../lib/shipmentImportQty.js');
const { previewDutchVolume } = await import('../pages/api/shipment/dutch-volume-preview.js');
const { applyDutchVolume } = await import('../pages/api/shipment/dutch-volume-apply.js');
const { getApplyProgress, initApplyProgress } = await import('../lib/importApplyProgress.js');

const user = { userId: 'dutch-test-user', userName: '테스트' };
const input = (entries = [{ id: 'cell-1', product: '청화', color: 'Blue', customer: '주광', quantity: 12, unit: '', custKey: 533, prodKey: 2231 }]) => ({
  year: '2026', week: '40-01', entries, sourceFileName: 'dutch-test.xlsx',
});

assert.equal(normalizeDutchPrice(''), null, 'blank price preserves existing price');
assert.equal(normalizeDutchPrice('0'), 0, 'explicit zero is distinct from blank');
for (const bad of ['NaN', '-1', 'Infinity']) assert.throws(() => normalizeDutchPrice(bad), /원화 단가/);
assert.throws(() => normalizeDutchEntries({ ...input(), year: '' }), /연도|year/i);
assert.throws(() => normalizeDutchEntries(input([{ id: 'a', quantity: -1 }])), /수량/);
assert.throws(() => normalizeDutchEntries(input([{ id: 'a', quantity: 1, custKey: -5 }])), /키/);

const alstro = { OutUnit: '박스', EstUnit: '송이', BunchOf1Box: 16, SteamOf1Bunch: 10, SteamOf1Box: 160 };
for (const [unit, expected] of [['', 3], ['박스', 3], ['단', 0.1875], ['송이', 0.01875]]) {
  assert.equal(normalizeUploadQtyForProduct({ sourceType: 'dutch-volume', productLabel: 'Alstroemeria', excelQty: 3, excelUnit: unit }, alstro), expected,
    `Dutch ${unit || 'default'} must not use legacy Alstro x16`);
}
assert.match(dutchEstUnitConversionIssue({ OutUnit: '단', EstUnit: '송이', BunchOf1Box: 10, SteamOf1Bunch: 0, SteamOf1Box: 0 }, 10), /환산계수/);
assert.equal(dutchEstUnitConversionIssue({ ...alstro, OutUnit: '박스' }, 3), '');

const pairRow = { entryIds: ['a', 'b'], custKey: 1, prodKey: 2, custName: 'A', prodName: 'P', outUnit: '박스', uploadQty: 2 };
assert.equal(resolveDutchPairPolicy([pairRow], [
  { id: 'a', unit: '', unitPrice: 0 }, { id: 'b', unit: '', unitPrice: 0 },
])[0].unitPrice, 0);
assert.throws(() => resolveDutchPairPolicy([pairRow], [
  { id: 'a', unit: '', unitPrice: null }, { id: 'b', unit: '', unitPrice: 0 },
]), /충돌/);

const ledger = {
  products: [{ ProdKey: 2231, OutUnit: '박스', EstUnit: '박스', CountryFlower: '네덜란드장미' }],
  customers: [{ CustKey: 533, BaseOutDay: 1 }],
  orderMasters: [{ CustKey: 533, OrderYear: '2026', OrderWeek: '40-01', OrderMasterKey: 1 }],
  shipmentMasters: [{ CustKey: 533, OrderYear: '2026', OrderWeek: '40-01', ShipmentKey: 1 }],
  orders: [{ CustKey: 533, ProdKey: 2231, OutQuantity: 10 }],
  shipments: [{ MasterCustKey: 533, ProdKey: 2231, SdetailKey: 55, OutQuantity: 10, Cost: 2100, ShipmentDtm: new Date('2026-10-04T00:00:00Z') }],
  dates: [
    { SdetailKey: 55, SdateKey: 1, ShipmentDtm: new Date('2026-10-04T00:00:00Z'), ShipmentQuantity: 4, EstQuantity: 4 },
    { SdetailKey: 55, SdateKey: 2, ShipmentDtm: new Date('2026-10-05T00:00:00Z'), ShipmentQuantity: 6, EstQuantity: 6 },
  ],
  farms: [{ SdetailKey: 55, FarmKey: 88, ShipmentQuantity: 10 }],
};
assertUniqueDutchLedger(ledger);
assert.equal(findDutchFarmQtyBlockers(ledger, [{ custKey: 533, prodKey: 2231, uploadQty: 10 }]).length, 0);
assert.equal(findDutchFarmQtyBlockers(ledger, [{ custKey: 533, prodKey: 2231, uploadQty: 12 }]).length, 1,
  'native mssql row shape must detect farm assignment');
assert.equal(findDutchFarmQtyBlockers(ledger, [{ custKey: 533, prodKey: 2231, uploadQty: 0 }]).length, 0);
assert.equal(findDutchDateIntegrityBlockers(ledger, [{ custKey: 533, prodKey: 2231, uploadQty: 10 }]).length, 0,
  'valid multi-date distribution does not require one representative date for all rows');
assert.equal(findDutchDateIntegrityBlockers({ ...ledger, dates: ledger.dates.slice(0, 1) }, [{ custKey: 533, prodKey: 2231, uploadQty: 10 }]).length, 1);
assert.throws(() => assertUniqueDutchLedger({ ...ledger, orderMasters: [...ledger.orderMasters, { ...ledger.orderMasters[0], OrderMasterKey: 2 }] }), /Master가 중복/);
assert.throws(() => assertUniqueDutchLedger({ ...ledger, orderMasters: [{ ...ledger.orderMasters[0], OrderYear: null }] }), /연도 없는/);

assert.deepEqual(assessDutchPriceReadback({
  shipmentDetailRow: { Cost: 0, EstQuantity: 2, Amount: 0, Vat: 0 },
  shipmentDateRows: [{ SdateKey: 1, Cost: 0, EstQuantity: 0.4, Amount: 0, Vat: 0 }],
}, 0), []);
assert.match(assessDutchPriceReadback({
  shipmentDetailRow: { Cost: 0, EstQuantity: 2, Amount: 0, Vat: 0 },
  shipmentDateRows: [{ SdateKey: 1, Cost: 2, EstQuantity: 0.4, Amount: 0, Vat: 0 }],
}, 0).join(','), /ShipmentDate 1 Cost/);

const fakePreview = ({ parsedRows }) => ({
  success: true, orderYear: '2026', week: '40-01', replacementCategories: ['네덜란드장미'],
  rows: [{ key: '533|2231', entryIds: [String(parsedRows[0].entryId)], custKey: 533, prodKey: 2231,
    custName: '주광', prodName: '청화', outUnit: '박스', orderQty: 7, currentOutQty: 10,
    uploadQty: 12, excelQty: 12, needsShipmentApply: true, fixBlocked: false }],
  unmatched: [], fixBlockedRows: [], customerOptions: [], productOptions: [], logs: [],
});
const fixtureLedger = { ...ledger, farms: [] };
const deps = {
  buildPreview: fakePreview,
  withTransaction: fn => fn(async () => ({ recordset: [] })),
  readSnapshot: async () => ({ snapshot: fixtureLedger, digest: 'fixture-digest' }),
};
const preview = await previewDutchVolume(input(), user, deps);
assert.ok(preview.planToken, 'matched positive category replacement issues a plan');
assert.equal(preview.rows[0].orderAfterQty, 7, 'existing order is preserved');
assert.equal(preview.entryMatches[0].estUnit, '박스');
const actorArgs = [];
const result = await applyDutchVolume({ planToken: preview.planToken, jobId: 'dutch-test-job-001', ackQtyWarnings: true }, user, {
  applyImportRows: async args => { actorArgs.push(args); return { success: true, appliedCount: 1 }; },
});
assert.equal(result.success, true);
assert.equal(actorArgs[0].fullCategoryReplacement, true);
assert.equal(actorArgs[0].rows.length, preview.rows.length, 'all category scope rows go to core, not changed subset');
assert.equal(getApplyProgress('dutch-test-job-001', user.userId)?.finished, true);
assert.equal(getApplyProgress('dutch-test-job-001', 'other-user'), null);
assert.equal(initApplyProgress('dutch-test-job-001', 1), false, 'legacy progress may not overwrite owned Dutch job');
await assert.rejects(() => applyDutchVolume({ planToken: preview.planToken, jobId: 'dutch-test-job-002' }, user, { applyImportRows: async () => ({ success: true }) }), /이미 적용/);
const warningPreview = await previewDutchVolume(input(), user, deps);
await assert.rejects(() => applyDutchVolume({ planToken: warningPreview.planToken, jobId: 'dutch-warning-job-001' }, user, {
  applyImportRows: async () => { const error = new Error('수량 경고'); error.code = 'QTY_WARNING'; throw error; },
}), /수량 경고/);
await assert.rejects(() => applyDutchVolume({ planToken: warningPreview.planToken, jobId: 'dutch-warning-job-002', ackQtyWarnings: true }, user, {
  applyImportRows: async () => ({ success: true }),
}), /이미 적용/, 'warning ack requires a fresh preview and plan');

console.log('dutchVolumeDistribution executable policy, preview/plan/apply adapter tests passed');
process.exit(0);
