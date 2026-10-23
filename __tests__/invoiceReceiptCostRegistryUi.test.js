const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '../components/import-tools/InvoiceReceiptCostReview.js'), 'utf8');
const descriptor = (formulaId, country, transportMode, lineInputFields) => ({ formulaId, country, transportMode, lineInputFields, formulaSourceHash: 'a'.repeat(64), formulaVersion: '1' });
const registry = {
  US: descriptor('US', 'US', 'AIR', ['tariffRate', 'bunchesPerBox']),
  VN: descriptor('VN', 'VN', 'AIR', ['tariffRate', 'stemsPerBunch']),
  NL_AMOUNT_V1: descriptor('NL_AMOUNT_V1', 'NL', 'AIR'),
  CN_AIR_WEIGHT_CBM_V1: descriptor('CN_AIR_WEIGHT_CBM_V1', 'CN', 'AIR'),
};
const helpers = source.slice(source.indexOf('const EMPTY_FORM'), source.indexOf('function Field('));
const ui = new Function('INVOICE_COST_FORMULAS', `${helpers}; return { applicableFormulas, applicableFormulaId, formulaLineFields, initialForm, payloadOf, editedForm, switchedFormulaForm, formulaPriceBasis, formulaGroupIds, formulaGroupFields, editedGroupForm, groupLabel, visibleLineFields };`)(registry);
const doc = country => ({ reviewedMetadata: { country, transportMode: 'AIR' } });
test('Thai packing basis survives payload and invalidates confirmation on edit',()=>{
 registry.TH_PACK={...descriptor('TH_PACK','TH','AIR',['groupId','stemsPerBunch']),groupIds:['OTHERS']};
 const form=ui.initialForm(doc('TH'),[]);
 const selected=ui.editedForm(form,'groupBoxBasis','PACKING_GROUP');
 const counted=ui.editedForm(selected,'packingBoxTotal','27');
 assert.equal(ui.payloadOf(counted).packingBoxTotal,27);
 assert.equal(ui.payloadOf(counted).groupBoxBasis,'PACKING_GROUP');
 assert.equal(counted.formulaApplicabilityConfirmed,false);
 assert.equal(ui.switchedFormulaForm(counted,'US').groupBoxBasis,'RECEIPT_LINES');
 delete registry.TH_PACK;
});

test('manual percentage editor preserves zero and missing values and roundtrips saved fractions', () => {
  const manual = new Function(`${helpers}; return { tariffPercent, tariffFraction, manualFieldsNeeded };`)();
  for (const fraction of [0, 0.08, 0.25, 1]) {
    assert.equal(manual.tariffFraction(String(manual.tariffPercent(fraction))), fraction);
  }
  assert.equal(manual.tariffPercent(null), '');
  assert.equal(manual.tariffFraction(''), '');
  assert.deepEqual(manual.manualFieldsNeeded({ outQuantity: 10, outUnit: '송이' }, { tariffRate: 0 }, ['tariffRate', 'stemsPerBunch']), []);
  assert.deepEqual(manual.manualFieldsNeeded({ outQuantity: 10, outUnit: '단' }, { tariffRate: '', stemsPerBunch: 0 }, ['tariffRate', 'stemsPerBunch']), ['tariffRate', 'stemsPerBunch']);
  for (const tariffRate of [-0.01, 1.01, 'invalid']) assert.deepEqual(manual.manualFieldsNeeded({ outQuantity: 10 }, { tariffRate }, ['tariffRate']), ['tariffRate']);
  assert.match(source, /manualLineFilter\?\.identity === identity/);
  assert.match(source, /ids: manualLineIds/);
  assert.match(source, /저장 전 편집값은 아직 서버에 반영되지 않습니다/);
});

test('registry country/transport selects supported formulas and normalizes US/VN aliases without invented defaults', () => {
  for (const country of ['US', 'USA', '미국']) assert.equal(ui.applicableFormulaId(doc(country)), 'US');
  for (const country of ['VN', 'VIETNAM', '베트남']) assert.equal(ui.applicableFormulaId(doc(country)), 'VN');
  for (const document of [doc('TH'), doc(''), { reviewedMetadata: { country: 'US', transportMode: 'SEA' } }, { reviewedMetadata: { country: 'US' } }]) assert.equal(ui.applicableFormulaId(document), '');
  registry.US2 = descriptor('US2', 'US', 'AIR', []);
  assert.equal(ui.applicableFormulas(doc('US')).length, 2);
  assert.equal(ui.applicableFormulaId(doc('US')), '', 'multiple verified choices require explicit selection');
  delete registry.US2;
});

test('group editor preserves string membership and explicit zero; empty fixed groups are not submitted', () => {
  registry.TH = { ...descriptor('TH', 'TH', 'AIR', ['groupId', 'tariffRate']), costGroupIds: ['ANTHURIUM', 'OTHERS'], costGroupFields: ['quantity', 'boxQuantity', 'grossWeightKg', 'volumeWeightKg'] };
  const document = doc('태국');
  document.reviewedMetadata.costInput = { formulaId: 'TH', lossTreatmentConfirmed: true,
    costGroups: [{ groupId: 'ANTHURIUM', quantity: '10', boxQuantity: '1', grossWeightKg: 0 }], lineInputs: [{ lineId: 'line', groupId: 'ANTHURIUM' }] };
  const form = ui.initialForm(document, [{ lineId: 'line', currency: 'USD' }]);
  assert.equal(form.lossTreatmentConfirmed, false);
  assert.equal(form.costGroups.length, 2);
  const payload = ui.payloadOf(form);
  assert.equal(payload.lineInputs[0].groupId, 'ANTHURIUM');
  for (const key of ['grossWeightKg', 'volumeWeightKg', 'allocationShare']) assert.equal(payload.lineInputs[0][key], null);
  assert.deepEqual(ui.visibleLineFields({ ...registry.TH, lineInputFields: ['groupId', 'tariffRate', 'grossWeightKg', 'volumeWeightKg', 'allocationShare'] }), ['tariffRate']);
  assert.ok(ui.visibleLineFields(registry.CN_AIR_WEIGHT_CBM_V1).includes('grossWeightKg'));
  for (const [id, label] of Object.entries({ ROSE: '장미', CARNATION: '카네이션', ALSTROMERIA: '알스트로', RUSCUS: '루스커스', ANTHURIUM: '안스리움', OTHERS: '기타', LOOSE_BLOOMS: '루스블룸' })) assert.equal(ui.groupLabel(id), label);
  assert.match(source, /GW와 CW가 정확히 같을 때/);
  assert.match(source, /원본 첫 행의 단 환산 셀 P15는 손상/);
  assert.equal(payload.costGroups.length, 1);
  assert.equal(payload.costGroups[0].grossWeightKg, 0);
  assert.equal(payload.costGroups[0].volumeWeightKg, null);
  const confirmed = { ...form, formulaApplicabilityConfirmed: true, lossTreatmentConfirmed: true };
  const changed = ui.editedGroupForm(confirmed, 'ANTHURIUM', 'quantity', '11');
  assert.equal(changed.costGroups[0].quantity, '11');
  assert.equal(changed.lossTreatmentConfirmed, false); assert.equal(changed.formulaApplicabilityConfirmed, false);
  assert.equal(ui.editedForm(confirmed, 'customsTotalKRW', '0').lossTreatmentConfirmed, false);
  assert.equal(ui.editedForm(form, 'lossTreatmentConfirmed', true).lossTreatmentConfirmed, true);
  assert.equal(ui.editedForm(confirmed, 'formulaApplicabilityConfirmed', true).lossTreatmentConfirmed, true);
  assert.equal(ui.switchedFormulaForm(confirmed, 'US').lineInputs[0].groupId, '');
  assert.deepEqual(ui.switchedFormulaForm(confirmed, 'US').costGroups, []);
  assert.equal(ui.applicableFormulaId(document), 'TH', 'registered grouped formula is selectable');
  assert.deepEqual(ui.formulaGroupIds({ groupIds: ['ROSE'] }), ['ROSE']);
  assert.match(source, /검역 손실·소독비를 확인하고 현재 통관비 합계에 포함했습니다 \(없으면 0 확인\)/);
  assert.match(source, /<select aria-label=\{`\$\{index \+ 1\}행 포장 그룹`\}/);
  assert.match(source, /그룹 실중량 합계는 문서 GW/);
  delete registry.TH;
});

test('descriptor fields and legacy fallbacks preserve manual zero, missing null, and explicit reconfirmation', () => {
  assert.deepEqual(ui.formulaLineFields(registry.US), ['tariffRate', 'bunchesPerBox']);
  assert.deepEqual(ui.formulaLineFields(registry.VN), ['tariffRate', 'stemsPerBunch']);
  assert.deepEqual(ui.formulaLineFields(registry.NL_AMOUNT_V1), ['tariffRate', 'stemsPerBunch']);
  assert.ok(ui.formulaLineFields(registry.CN_AIR_WEIGHT_CBM_V1).includes('volumeWeightKg'));
  assert.deepEqual(ui.formulaLineFields({ formulaId: 'UNKNOWN' }), []);
  const document = doc('US');
  document.reviewedMetadata.costInput = { formulaId: 'US', formulaApplicabilityConfirmed: true, lineInputs: [{ lineId: 'line', bunchesPerBox: 0, stemsPerBunch: '10' }] };
  const form = ui.initialForm(document, [{ lineId: 'line', currency: 'USD' }]);
  assert.equal(form.formulaApplicabilityConfirmed, false);
  assert.equal(form.lineInputs[0].bunchesPerBox, 0);
  const payload = ui.payloadOf(form);
  assert.equal(payload.lineInputs[0].bunchesPerBox, 0); assert.equal(payload.lineInputs[0].stemsPerBunch, 10);
  assert.equal(payload.lineInputs[0].grossWeightKg, null);
  for (const key of ['freightAmount', 'exchangeRateKRW', 'formulaEffectiveDate', 'customsTotalKRW', 'costSourceId']) assert.equal(ui.editedForm({ ...form, formulaApplicabilityConfirmed: true }, key, '1').formulaApplicabilityConfirmed, false);
  assert.equal(ui.editedForm(form, 'formulaApplicabilityConfirmed', true).formulaApplicabilityConfirmed, true);
});

test('formula and line edit handlers invalidate approval and preserve existing save/readback stages', () => {
  for (const [start, end, args] of [
    ['  function chooseFormula(', '  function updateLine(', ['US']],
    ['  function updateLine(', '  function invalidateApprovalStages(', ['line', 'bunchesPerBox', '12']],
  ]) {
    let form = { formulaApplicabilityConfirmed: true, lossTreatmentConfirmed: true, lineInputs: [{ lineId: 'line', bunchesPerBox: '' }] }, invalidations = 0;
    const body = source.slice(source.indexOf(start), source.indexOf(end));
    const name = /function (\w+)/.exec(body)[1];
    const run = new Function('INVOICE_COST_FORMULAS', 'pristineRef', 'setInputEdited', 'invalidateApprovalStages', 'setForm', 'setPreview', 'switchedFormulaForm', `${body}; return ${name};`)(registry, { current: true }, () => {}, () => invalidations++, update => { form = update(form); }, () => {}, ui.switchedFormulaForm);
    run(...args); assert.equal(form.formulaApplicabilityConfirmed, false); assert.equal(form.lossTreatmentConfirmed, false); assert.equal(invalidations, 1);
  }
  require('next/dist/compiled/babel/core').transformSync(source, { filename: 'InvoiceReceiptCostReview.js', presets: [require('next/dist/compiled/babel/preset-react')], configFile: false, babelrc: false });
  assert.match(source, /lineFields\.map\(key => <th/);
  assert.match(source, /aria-label=\{`\$\{index \+ 1\}행 \$\{LINE_FIELD_LABELS\[key\]/);
  assert.match(source, /validateInvoiceCostReadback/); assert.match(source, /runInvoiceCostSaveWorkflow/);
  assert.match(source, /update\('formulaApplicabilityConfirmed', false\)/);
});

test('CNF notice requires explicit separate freight zero; formula switching clears only irrelevant line inputs', () => {
  registry.US.freightIncluded = true; registry.US.priceBasis = 'BOX';
  const current = { formulaId: 'VN', freightAmount: 100, formulaApplicabilityConfirmed: true,
    lineInputs: [{ lineId: 'line', tariffRate: 0, stemsPerBunch: 10, bunchesPerBox: 12, otherCostPerUnitKRW: 5, grossWeightKg: 20 }] };
  const next = ui.switchedFormulaForm(current, 'US');
  assert.equal(next.freightAmount, 100, 'CNF must not silently rewrite manual freight to zero');
  assert.equal(next.formulaApplicabilityConfirmed, false);
  assert.equal(next.lineInputs[0].tariffRate, 0); assert.equal(next.lineInputs[0].bunchesPerBox, 12);
  assert.equal(next.lineInputs[0].stemsPerBunch, ''); assert.equal(next.lineInputs[0].otherCostPerUnitKRW, '');
  assert.equal(next.lineInputs[0].grossWeightKg, ''); assert.equal(current.lineInputs[0].grossWeightKg, 20);
  assert.equal(ui.formulaPriceBasis(registry.US), '박스'); assert.equal(ui.formulaPriceBasis({ priceBasis: 'STEM' }), '송이');
  assert.match(source, /selectedFormula\?\.freightIncluded === true && <p role="alert"/);
  assert.match(source, /별도 운임 원금에 0을 직접 입력/);
  for (const country of ['AU', 'NZ', 'EC', 'CO', 'TH']) registry[country] = descriptor(country, country, 'AIR', ['tariffRate']);
  for (const country of ['AU', 'NZ', 'EC']) assert.equal(ui.applicableFormulaId(doc(country)), country);
  for (const country of ['CO', 'TH']) assert.equal(ui.applicableFormulaId(doc(country)), country, 'registered grouped formulas are enabled');
  for (const country of ['AU', 'NZ', 'EC', 'CO', 'TH']) delete registry[country];
});

test('actual registered CO/TH descriptors are eligible in UI only within verified country/transport scope', async () => {
  const { INVOICE_COST_FORMULAS } = await import('../lib/invoiceReceiptCost.js');
  const actual = new Function('INVOICE_COST_FORMULAS', `${helpers}; return { applicableFormulas, applicableFormulaId };`)(INVOICE_COST_FORMULAS);
  for (const [country, aliases, id] of [
    ['CO', ['CO', 'COLOMBIA', '콜롬비아'], 'CO_GROUP_WEIGHT_VOLUME_V1'],
    ['TH', ['TH', 'THAILAND', '태국'], 'TH_GROUP_BOX_SHARE_V1'],
  ]) {
    assert.ok(INVOICE_COST_FORMULAS[id]);
    for (const alias of aliases) {
      assert.equal(actual.applicableFormulaId(doc(alias)), id);
      assert.ok(actual.applicableFormulas(doc(alias)).some(formula => formula.formulaId === id));
    }
    assert.equal(actual.applicableFormulaId({ reviewedMetadata: { country, transportMode: 'SEA' } }), '');
    assert.equal(actual.applicableFormulaId({ reviewedMetadata: { country } }), '');
  }
});
