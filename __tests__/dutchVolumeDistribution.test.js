import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./fixtures/dutchVolumeLoaderHook.mjs', import.meta.url);

const {
  normalizeDutchEntries, normalizeDutchPrice, resolveDutchPairPolicy,
  dutchEstUnitConversionIssue, dutchInputUnitIssue, assessDutchPriceReadback,
} = await import('../lib/dutchVolumeDistribution.js');
const {
  assertUniqueDutchLedger, findDutchFarmQtyBlockers, findDutchDateIntegrityBlockers,
} = await import('../lib/dutchVolumeDistributionSnapshot.js');
const { normalizeUploadQtyForProduct } = await import('../lib/shipmentImportQty.js');
const { buildImportPreview, matchDutchProductByColor } = await import('../lib/shipmentImport.js');
const { dutchPreviewComparisonKey, previewDutchVolume } = await import('../pages/api/shipment/dutch-volume-preview.js');
const { applyDutchVolume } = await import('../pages/api/shipment/dutch-volume-apply.js');
const { finishApplyProgress, getApplyProgress, initApplyProgress, progressStep } = await import('../lib/importApplyProgress.js');

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

const dutchProducts = [
  { ProdKey: 2231, ProdName: 'Campanula / Campana Pearl Pink', FlowerName: '깜바눌라' },
  { ProdKey: 932, ProdName: 'Hydrangea / Classic Pimpurnel Aubergine', FlowerName: '수국' },
  { ProdKey: 2844, ProdName: 'Nerine Bowdenii Biancaperla', FlowerName: '네리네' },
  { ProdKey: 2150, ProdName: 'Anthurium Graciosa 13cm', FlowerName: '안스리움' },
  { ProdKey: 1983, ProdName: 'Tulip / Single Crown Dynasty L/Pink', FlowerName: '튤립' },
  { ProdKey: 3001, ProdName: 'Lily la Nubia', FlowerName: '백합' },
  { ProdKey: 3002, ProdName: 'Hydrangea / Royal Palace Old Pink/Green 60cm-18cm', FlowerName: '수국' },
  { ProdKey: 3003, ProdName: 'ROSE / Lily White 60cm', FlowerName: '장미' },
].map(product => ({ ...product, CounName: '네덜란드', CountryFlower: '네덜란드', OutUnit: '송이', EstUnit: '송이' }));
for (const [species, color, prodKey] of [
  ['깜바눌라', 'Campanula / Campana Pearl Pink', 2231],
  ['수국', 'ClassicPimpurnelAubergine', 932],
  ['네리네', 'Nerine Bowdenii Biancaperla', 2844],
  ['안스리움', 'Anthurium Graciosa13cm', 2150],
  ['튤립', 'Single Crown Dynasty L/Pink', 1983],
  ['백합', 'la Nubia', 3001],
  ['수국', 'RoyalPalaceOldPinkGreen 60cm-18cm', 3002],
  ['장미', 'White 60', 3003],
]) {
  assert.equal(matchDutchProductByColor(dutchProducts, { productLabel: species, productColor: color })?.ProdKey, prodKey,
    'Dutch color exact name or slash-suffix must resolve within the stated flower');
}
assert.equal(matchDutchProductByColor(dutchProducts, { productLabel: '수국', productColor: 'Campanula / Campana Pearl Pink' }), null,
  'unique exact color from another flower is not a valid match');
assert.equal(matchDutchProductByColor(dutchProducts, { productLabel: '수국', productColor: 'ClassicPimpurnelAubergine typo' }), null,
  'unknown color must not fall back to a unique species');
assert.equal(matchDutchProductByColor([...dutchProducts, { ...dutchProducts[1], ProdKey: 9999 }],
  { productLabel: '수국', productColor: 'ClassicPimpurnelAubergine' }), null,
  'duplicate exact names within a species require manual matching');

// Actual Product snapshot: the Netherlands-only terminal country marker may
// be omitted by the uploaded Pivot, but only within the same FlowerName.
const aranNl = { ProdKey: 3441, ProdName: 'ARAN Azima (NL)', FlowerName: '아란', CounName: '네덜란드' };
assert.equal(matchDutchProductByColor([aranNl], { productLabel: '아란', productColor: 'ARAN Azima' })?.ProdKey, 3441,
  'a terminal (NL) may be omitted for an otherwise exact same-species Netherlands item');
assert.equal(matchDutchProductByColor([{ ...aranNl, CounName: '벨기에' }], { productLabel: '아란', productColor: 'ARAN Azima' }), null,
  'terminal (NL) may not be omitted for a product outside the Netherlands');
assert.equal(matchDutchProductByColor([
  aranNl,
  { ProdKey: 3443, ProdName: 'ARAN Azima', FlowerName: '아란', CounName: '네덜란드' },
], { productLabel: '아란', productColor: 'ARAN Azima' }), null,
  'with-marker and without-marker aliases that collide within a flower must remain ambiguous');
for (const nearMiss of ['ARAN Azima 60cm', 'ARAN Azima Pink']) {
  assert.equal(matchDutchProductByColor([aranNl], { productLabel: '아란', productColor: nearMiss }), null,
    `terminal country normalization must not erase size or color differences: ${nearMiss}`);
}
const leucothoeCandidates = [
  { ProdKey: 1011, ProdName: 'Leucothoe Tinted Red', FlowerName: '레우코취', CounName: '네덜란드' },
  { ProdKey: 1012, ProdName: 'Leucothoe Rainbow', FlowerName: '레우코취', CounName: '네덜란드' },
  { ProdKey: 1013, ProdName: 'Leucothoe Walteri Red', FlowerName: '레우코취', CounName: '네덜란드' },
  { ProdKey: 1014, ProdName: 'Leucothoe Absorbed red', FlowerName: '레우코취', CounName: '네덜란드' },
];
assert.equal(matchDutchProductByColor(leucothoeCandidates, { productLabel: '레우코취', productColor: 'RED' }), null,
  'multiple Leucothoe red candidates must not be auto-selected from a color fragment');

const compareRow = ({ key = '533|2231', orderQty = 7, currentOutQty = 10, uploadQty = 12, fixBlocked = false, shipmentDateIssueCount = 0 } = {}) => ({
  key, orderQty, currentOutQty, uploadQty, fixBlocked, shipmentDateIssueCount,
});
const comparisonBase = {
  replacementCategories: ['네덜란드장미', '네덜란드수국'],
  rows: [compareRow(), compareRow({ key: '534|2232', uploadQty: 0 }), compareRow()],
  unmatched: [{ entryId: 'missing-a', reason: '품목 미확인' }, { entryId: 'missing-b', reason: '업체 미확인' }],
};
const comparisonPermuted = {
  replacementCategories: ['네덜란드수국', '네덜란드장미'],
  rows: [comparisonBase.rows[2], comparisonBase.rows[1], comparisonBase.rows[0]],
  unmatched: [...comparisonBase.unmatched].reverse(),
};
assert.equal(dutchPreviewComparisonKey(comparisonBase), dutchPreviewComparisonKey(comparisonPermuted),
  'row/category/unmatched presentation order does not make the comparison different');
for (const changedRow of [
  compareRow({ orderQty: 8 }),
  compareRow({ currentOutQty: 11 }),
  compareRow({ uploadQty: 13 }),
  compareRow({ fixBlocked: true }),
  compareRow({ shipmentDateIssueCount: 1 }),
]) {
  assert.notEqual(dutchPreviewComparisonKey(comparisonBase), dutchPreviewComparisonKey({ ...comparisonBase, rows: [changedRow, ...comparisonBase.rows.slice(1)] }),
    'each quantity/fix/date predicate participates in the canonical comparison');
}
assert.notEqual(dutchPreviewComparisonKey(comparisonBase), dutchPreviewComparisonKey({
  ...comparisonBase, rows: comparisonBase.rows.slice(1),
}), 'row membership changes must change the comparison');
assert.notEqual(dutchPreviewComparisonKey(comparisonBase), dutchPreviewComparisonKey({
  ...comparisonBase, replacementCategories: ['네덜란드장미'],
}), 'replacement category membership changes must change the comparison');
assert.notEqual(dutchPreviewComparisonKey(comparisonBase), dutchPreviewComparisonKey({
  ...comparisonBase, unmatched: [{ ...comparisonBase.unmatched[0], reason: '다른 미매칭 사유' }, comparisonBase.unmatched[1]],
}), 'unmatched reason changes must change the comparison');
assert.notEqual(dutchPreviewComparisonKey({ ...comparisonBase, rows: [comparisonBase.rows[0]] }),
  dutchPreviewComparisonKey({ ...comparisonBase, rows: [comparisonBase.rows[0], comparisonBase.rows[0]] }),
  'sorting canonical tuples must preserve duplicate multiplicity');

const alstroInputProduct = { ProdName: 'ALSTROMERIA Lavender', FlowerName: '알스트로', OutUnit: '단', EstUnit: '송이',
  BunchOf1Box: 16, SteamOf1Bunch: 10, SteamOf1Box: 160 };
assert.match(dutchInputUnitIssue(alstroInputProduct, { quantity: 10, unit: '' }), /입력 단위/);
assert.equal(dutchInputUnitIssue(alstroInputProduct, { quantity: 10, unit: '단' }), '');
assert.equal(dutchInputUnitIssue(alstroInputProduct, { quantity: 0, unit: '' }), '');
assert.equal(dutchInputUnitIssue(dutchProducts[0], { quantity: 10, unit: '' }), '');

const matchQuery = async statement => ({ recordset: /FROM Product\s+WHERE/i.test(statement) ? dutchProducts
  : /FROM Customer\s+WHERE/i.test(statement) ? [{ CustKey: 533, CustName: '주광', OrderCode: '주광', BaseOutDay: 1 }]
  : [] });
const matchingPreview = async (product, color, sourceType = 'dutch-volume') => buildImportPreview({
  parsedRows: [{ entryId: 'matched-cell', rowNo: 1, colNo: 1, customerLabel: '주광', productLabel: product,
    productColor: color, uploadQty: 1, outUnit: '송이', sourceType, hasFinalDistributionDirective: true }],
  rawYear: '2026', rawWeek: '40-01', strictMatching: true, countryFilter: '네덜란드', queryFn: matchQuery,
});
assert.equal((await matchingPreview('수국', 'ClassicPimpurnelAubergine')).rows.find(row => row.entryIds?.includes('matched-cell'))?.prodKey, 932,
  'actual Dutch preview uses the color matcher');
assert.equal((await matchingPreview('수국', 'Campanula / Campana Pearl Pink')).unmatched.length, 1,
  'actual Dutch preview rejects a color belonging to another flower');
assert.equal((await matchingPreview('수국', 'unknown')).unmatched.length, 1,
  'actual Dutch preview never falls back to a species-only match');
assert.equal((await matchingPreview('Nerine Bowdenii Biancaperla', '', 'excel')).rows.find(row => row.entryIds?.includes('matched-cell'))?.prodKey, 2844,
  'normal strict import retains product-label matching');

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

const buildReorderedPreview = (mutateOnConfirmation = false) => {
  let calls = 0;
  return {
    get calls() { return calls; },
    buildPreview: ({ parsedRows }) => {
      calls += 1;
      const result = fakePreview({ parsedRows });
      const missing = { ...result.rows[0], key: '534|2231', entryIds: [], custKey: 534,
        orderQty: 0, currentOutQty: 0, uploadQty: 0, missingFromExcel: true };
      result.replacementCategories = ['네덜란드장미', '네덜란드수국'];
      result.rows = calls === 1 ? [result.rows[0], missing] : [missing, result.rows[0]];
      if (mutateOnConfirmation && calls === 2) result.rows.find(row => row.key === '533|2231').uploadQty += 1;
      return result;
    },
  };
};
const reorderedBuild = buildReorderedPreview();
const reorderedPreview = await previewDutchVolume(input(), user, { ...deps, buildPreview: reorderedBuild.buildPreview });
assert.equal(reorderedBuild.calls, 2, 'preview is recomputed after locked snapshot capture');
assert.ok(reorderedPreview.planToken, 'a semantically identical preview with permuted SQL rows remains applicable');
const changedBuild = buildReorderedPreview(true);
const planCountBeforeChangedPreview = global._dutchVolumePlans.size;
await assert.rejects(() => previewDutchVolume(input(), user, { ...deps, buildPreview: changedBuild.buildPreview }), /미리보기|변경|다시|계획/,
  'a real preview predicate change between the two reads must still be rejected');
assert.equal(changedBuild.calls, 2, 'changed preview reaches the confirmation read');
assert.equal(global._dutchVolumePlans.size, planCountBeforeChangedPreview, 'a changed preview must not leave an issued plan behind');

const alstroDeps = { ...deps, readSnapshot: async () => ({ snapshot: {
  ...fixtureLedger, products: [{ ...alstroInputProduct, ProdKey: 2231, CountryFlower: '네덜란드' }],
}, digest: 'alstro-digest' }) };
const alstroBlank = await previewDutchVolume(input(), user, alstroDeps);
assert.equal(alstroBlank.planToken, null, 'positive Alstro quantity with blank input unit cannot be applied');
assert.match(alstroBlank.blockers.join(' '), /입력 단위/);
const alstroExplicit = await previewDutchVolume(input([{ ...input().entries[0], unit: '박스' }]), user, alstroDeps);
assert.ok(alstroExplicit.planToken, 'explicit Alstro input unit can proceed when no other blocker exists');
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
const fullLogJob = 'dutch-full-log-test-5000';
assert.equal(initApplyProgress(fullLogJob, 5000, user.userId), true);
for (let index = 1; index <= 5000; index += 1) progressStep(fullLogJob, { done: index, log: `[${index}/5000] 업체 ${index} / 품목 ${index}: 적용` });
finishApplyProgress(fullLogJob, { log: '적용 및 DB 검증 완료' });
const fullLog = getApplyProgress(fullLogJob, user.userId)?.logs;
assert.equal(fullLog.length, 5001, '최대 5,000행의 각 진행 로그와 완료 로그를 모두 보존해야 합니다.');
assert.match(fullLog[0], /^\[1\/5000\]/);
assert.match(fullLog[4999], /^\[5000\/5000\]/);
assert.equal(fullLog[5000], '적용 및 DB 검증 완료');
assert.equal(getApplyProgress(fullLogJob, 'other-user'), null, '진행 로그는 다른 사용자가 조회할 수 없습니다.');
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
