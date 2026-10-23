import test from 'node:test';
import assert from 'node:assert/strict';
import { GROUPED_INVOICE_COST_FORMULAS as formulas, groupedInvoiceCostPreview as calculate } from '../lib/invoiceReceiptGroupedCost.js';

export function createGroupedCostFixture(country = 'CO') {
  const formula = formulas[country === 'CO' ? 'CO_GROUP_WEIGHT_VOLUME_V1' : 'TH_GROUP_BOX_SHARE_V1'];
  const groupIds = country === 'CO' ? ['ROSE', 'CARNATION'] : ['OTHERS', 'LOOSE_BLOOMS'];
  return { document: { reviewedMetadata: { country, transportMode: 'AIR', gw: 100, cw: 200 } },
    rows: [100, 200, 300].map((q, i) => ({ lineId: `line-${i}`, prodKey: i + 1, actualQuantity: q,
      unit: 'STEM', unitPrice: 2, lineAmount: q * 2, currency: 'EUR', boxQuantity: i === 2 ? 3 : q / 300 })),
    input: { formulaId: formula.formulaId, customsTotalKRW: 1000, lossTreatmentConfirmed: true,
      costGroups: [{ groupId: groupIds[0], boxQuantity: 1, quantity: 300, grossWeightKg: 80, volumeWeightKg: 50 },
        { groupId: groupIds[1], boxQuantity: 3, quantity: 300, grossWeightKg: 20, volumeWeightKg: 150 }],
      lineInputs: [0, 1, 2].map(i => ({ lineId: `line-${i}`, groupId: groupIds[i === 2 ? 1 : 0], tariffRate: country === 'CO' ? 0 : .05 })) },
    common: { formula, nativeCurrency: 'EUR', freightCurrency: 'EUR', exchangeRate: 1000,
      effectiveFreightAmount: 120, share: 1 } };
}
export const createColombiaCostFixture = () => createGroupedCostFixture('CO');
export const createThailandCostFixture = () => createGroupedCostFixture('TH');
const fixture = createGroupedCostFixture;
const run = f => { const issues = []; return { ...calculate(f.document, f.rows, f.input, f.common, issues), issues }; };
const blocks = (f, code) => { const r = run(f); assert.deepEqual(r.lines, []); assert.ok(r.issues.some(i => i.code === code), JSON.stringify(r.issues)); };
const near = (a, b) => assert.ok(Math.abs(a - b) < .000002, `${a} != ${b}`);
test('TH explicitly reviewed packing groups do not require invented native line boxes', () => {
 const f=fixture('TH'), expected=run(f); f.rows.forEach((r,i)=>r.boxQuantity=i===0?null:0);
 Object.assign(f.input,{groupBoxBasis:'PACKING_GROUP',packingBoxTotal:4});
 const before=JSON.stringify(f), actual=run(f);
 assert.deepEqual(actual.issues,[]);assert.deepEqual(actual.lines,expected.lines);assert.equal(JSON.stringify(f),before);
 for(const value of [undefined,null,0,false,'',3,Infinity]) {const bad=structuredClone(f);bad.input.packingBoxTotal=value;blocks(bad,'PACKING_BOX_TOTAL_MISMATCH');}
 for(const value of [false,0,'UNKNOWN']) {const bad=structuredClone(f);bad.input.groupBoxBasis=value;blocks(bad,'GROUP_BOX_BASIS_INVALID');}
 const mismatch=structuredClone(f);mismatch.input.costGroups[0].quantity++;blocks(mismatch,'GROUP_QUANTITY_MISMATCH');
 const co=fixture('CO');Object.assign(co.input,{groupBoxBasis:'PACKING_GROUP',packingBoxTotal:4});blocks(co,'GROUP_BOX_BASIS_INVALID');
 delete f.input.groupBoxBasis;blocks(f,'RECEIPT_BOX_QUANTITY_REQUIRED');
});

test('42-1 hydrangea uses explicit weight groups and leaves legacy four-group formula unchanged', () => {
  const f=fixture();
  f.common.formula=formulas.CO_GROUP_42_1_V1;f.input.formulaId=f.common.formula.formulaId;
  f.input.costGroups[0].groupId='HYDRANGEA';
  f.input.lineInputs[0].groupId=f.input.lineInputs[1].groupId='HYDRANGEA';
  const result=run(f);assert.deepEqual(result.issues,[]);
  near(result.lines[0].componentAmounts.freightNative,10);
  near(result.lines[0].componentAmounts.customsKRW,800/3);
  assert.equal(formulas.CO_GROUP_WEIGHT_VOLUME_V1.groupIds.includes('HYDRANGEA'),false);
  assert.equal(f.common.formula.formulaSourceSheet,'42-1');
});
test('42-1 source hydrangea freight/customs arithmetic agrees at both exchange rates', () => {
  const ids=['ROSE','CARNATION','ALSTROMERIA','RUSCUS','HYDRANGEA'];
  const boxes=[223,632,82,78.4,556], quantities=[22300,189600,13120,49000,16730];
  const gross=[8,11,9.7,8,5.5].map((v,i)=>v*boxes[i]);
  const volume=[10,9,7,9.6,6.7].map((v,i)=>v*boxes[i]);
  const totalG=gross.reduce((a,b)=>a+b),totalV=volume.reduce((a,b)=>a+b);
  const freight=12633*2.76+104.97,customs=12633*460+33000+50000+99000+40000;
  for(const fx of [1350,1400]){
    const f={document:{reviewedMetadata:{country:'CO',transportMode:'AIR',gw:12633,cw:12633}},
      rows:ids.map((id,i)=>({lineId:id,prodKey:i+1,actualQuantity:quantities[i],unit:'STEM',unitPrice:.61,lineAmount:quantities[i]*.61,currency:'USD',boxQuantity:boxes[i]})),
      input:{formulaId:'CO_GROUP_42_1_V1',customsTotalKRW:customs,costGroups:ids.map((groupId,i)=>({groupId,quantity:quantities[i],boxQuantity:boxes[i],grossWeightKg:gross[i]/totalG*12633,volumeWeightKg:volume[i]/totalV*12633})),lineInputs:ids.map(id=>({lineId:id,groupId:id,tariffRate:0}))},
      common:{formula:formulas.CO_GROUP_42_1_V1,nativeCurrency:'USD',freightCurrency:'USD',exchangeRate:fx,effectiveFreightAmount:freight,share:1}};
    const r=run(f);assert.deepEqual(r.issues,[]);
    const expected=(.61+freight*gross[4]/totalG/quantities[4])*fx+customs*gross[4]/totalG/quantities[4];
    near(r.lines[4].costPerUnitKRW,expected);
  }
});

test('CO volume freight and GW customs use explicit group actual stems, not names', () => {
  const f = fixture(); f.rows[0].productName = 'CARNATION misleading label';
  const before = JSON.stringify(f), r = run(f); assert.deepEqual(r.issues, []);
  assert.equal(JSON.stringify(f), before); assert.equal(r.expected95, null);
  assert.equal(r.lines[0].freightAllocationBasis, 'VOLUME_WEIGHT_KG');
  near(r.lines[0].componentAmounts.freightNative, 10);
  near(r.lines[0].componentAmounts.customsKRW, 800 / 3);
  near(r.lines[2].componentAmounts.freightNative, 90);
  near(r.lines[2].componentAmounts.customsKRW, 200);
  assert.equal(r.lines[2].totalCostKRW, 690200);
  near(r.lines.reduce((s, l) => s + l.componentAmounts.freightNative, 0), 120);
  near(r.lines.reduce((s, l) => s + l.componentAmounts.customsKRW, 0), 1000);
});
test('CO exact GW=CW switches freight to gross; near-but-not-equal stays volume', () => {
  const f = fixture(); f.document.reviewedMetadata.cw = 100;
  f.input.costGroups[0].volumeWeightKg = 25; f.input.costGroups[1].volumeWeightKg = 75;
  let r = run(f); assert.deepEqual(r.issues, []); assert.equal(r.lines[0].freightAllocationBasis, 'GROSS_WEIGHT_KG');
  near(r.lines[0].componentAmounts.freightNative, 32);
  f.document.reviewedMetadata.cw = 100.001;
  f.input.costGroups[1].volumeWeightKg = 75.001;
  r = run(f); assert.deepEqual(r.issues, []); assert.equal(r.lines[0].freightAllocationBasis, 'VOLUME_WEIGHT_KG');
});
test('TH boxes times intra-group stems shares sum to one for both costs', () => {
  const f = fixture('TH'), r = run(f); assert.deepEqual(r.issues, []);
  near(r.lines[0].allocationShare, 1 / 12); near(r.lines[1].allocationShare, 1 / 6);
  near(r.lines[2].allocationShare, .75);
  assert.equal(r.lines[0].componentAmounts.freightNative, 10);
  near(r.lines[0].componentAmounts.customsKRW, 1000 / 12);
  near(r.lines[0].componentAmounts.tariffKRW, 10500);
  near(r.lines[0].totalCostKRW, 220583.333333);
  assert.equal(r.lines[2].freightAllocationBasis, 'GROUP_BOX_SHARE');
});
test('BUNCH/BOX manual STEM conversions preserve totals and source price basis', () => {
  for (const country of ['CO', 'TH']) {
    const f = fixture(country), baseline = run(f);
    Object.assign(f.rows[0], { actualQuantity: 10, unit: 'BUNCH', stemQuantity: 100 });
    f.input.lineInputs[0].stemsPerBunch = 10;
    Object.assign(f.rows[1], { actualQuantity: 2 / 3, unit: 'BOX', stemQuantity: 200 });
    Object.assign(f.input.lineInputs[1], { stemsPerBunch: 10, bunchesPerBox: 30 });
    const r = run(f); assert.deepEqual(r.issues, []);
    r.lines.forEach((l, i) => assert.equal(l.totalCostKRW, baseline.lines[i].totalCostKRW));
    near(r.lines[0].costPerUnitKRW, baseline.lines[0].totalCostKRW / 10);
    assert.equal(r.lines[1].priceBasisQuantity, 200);
  }
});
test('submitted per-line allocations are independently checked against group membership', () => {
  const f = fixture(); Object.assign(f.input.lineInputs[0], { grossWeightKg: 80 / 3, volumeWeightKg: 50 / 3 });
  assert.deepEqual(run(f).issues, []); f.input.lineInputs[0].grossWeightKg = 30; blocks(f, 'LINE_ALLOCATION_MISMATCH');
  const t = fixture('TH'); t.input.lineInputs[0].allocationShare = 1 / 12;
  assert.deepEqual(run(t).issues, []); t.input.lineInputs[0].allocationShare = .2; blocks(t, 'LINE_ALLOCATION_MISMATCH');
});
for (const country of ['CO', 'TH']) {
  for (const [name, mutate, code] of [
    ['country', f => { f.document.reviewedMetadata.country = 'CN'; }, 'FORMULA_COUNTRY_MISMATCH'],
    ['transport', f => { f.document.reviewedMetadata.transportMode = 'SEA'; }, 'FORMULA_TRANSPORT_MISMATCH'],
    ['currency', f => { f.common.freightCurrency = 'USD'; }, 'FORMULA_CURRENCY_MISMATCH'],
    ['line currency', f => { f.rows[0].currency = 'USD'; }, 'LINE_CURRENCY_MISMATCH'],
    ['FX boolean', f => { f.common.exchangeRate = true; }, 'EXCHANGE_RATE_REQUIRED'],
    ['missing fee', f => { delete f.input.customsTotalKRW; }, 'CUSTOMS_TOTAL_REQUIRED'],
    ['invalid freight', f => { f.common.effectiveFreightAmount = Infinity; }, 'FREIGHT_AMOUNT_REQUIRED'],
    ['shared scope', f => { f.common.share = .5; }, 'GROUPED_ALLOCATION_SCOPE_REQUIRED'],
    ['no groups', f => { f.input.costGroups = []; }, 'COST_GROUPS_REQUIRED'],
    ['group duplicate', f => { f.input.costGroups[1].groupId = f.input.costGroups[0].groupId; }, 'COST_GROUP_DUPLICATE'],
    ['unknown group', f => { f.input.costGroups[0].groupId = 'GUESSED'; }, 'COST_GROUP_INVALID'],
    ['group zero', f => { f.input.costGroups[0].quantity = 0; }, 'COST_GROUP_QUANTITY_REQUIRED'],
    ['boxes missing', f => { delete f.input.costGroups[0].boxQuantity; }, 'COST_GROUP_QUANTITY_REQUIRED'],
    ['group mismatch', f => { f.input.costGroups[0].quantity += 1; }, 'GROUP_QUANTITY_MISMATCH'],
    ['no inferred group', f => { delete f.input.lineInputs[0].groupId; f.rows[0].productName = 'ROSE OTHERS'; }, 'LINE_GROUP_REQUIRED'],
    ['conversion missing', f => { f.rows[0].unit = 'BUNCH'; }, 'UNIT_CONVERSION_REQUIRED'],
    ['conversion inconsistent', f => { f.rows[0].stemQuantity = 99; }, 'QUANTITY_CONVERSION_MISMATCH'],
    ['amount inconsistent', f => { f.rows[0].lineAmount += 1; }, 'NATIVE_AMOUNT_MISMATCH'],
    ['tariff missing', f => { delete f.input.lineInputs[0].tariffRate; }, 'TARIFF_RATE_REQUIRED'],
    ['extra cost', f => { f.input.lineInputs[0].otherCostPerUnitKRW = 1; }, 'ADDITIONAL_COST_UNSUPPORTED'],
    ['duplicate row', f => { f.rows[1].lineId = f.rows[0].lineId; }, 'LINE_ID_DUPLICATE'],
    ['duplicate input', f => { f.input.lineInputs.push({ ...f.input.lineInputs[0] }); }, 'LINE_INPUT_DUPLICATE'],
    ['foreign input', f => { f.input.lineInputs.push({ lineId: 'foreign' }); }, 'LINE_INPUT_OUT_OF_SCOPE'],
  ]) test(`${country} blocks ${name}`, () => { const f = fixture(country); mutate(f); blocks(f, code); });
}
test('CO validates both normalized group weight totals, GW order and zero tariff', () => {
  for (const [mutate, code] of [
    [f => { f.input.costGroups[0].grossWeightKg++; }, 'GROSS_WEIGHT_SUM_MISMATCH'],
    [f => { f.input.costGroups[0].volumeWeightKg++; }, 'VOLUME_WEIGHT_SUM_MISMATCH'],
    [f => { delete f.input.costGroups[0].volumeWeightKg; }, 'COST_GROUP_WEIGHT_REQUIRED'],
    [f => { f.document.reviewedMetadata.gw = 201; }, 'WEIGHT_ORDER_INVALID'],
    [f => { delete f.document.reviewedMetadata.gw; }, 'HEADER_WEIGHT_REQUIRED'],
    [f => { f.input.lineInputs[0].tariffRate = .05; }, 'CO_TARIFF_UNVERIFIED'],
  ]) { const f = fixture(); mutate(f); blocks(f, code); }
});
test('TH loss confirmation is strict boolean true, never guesses loss amounts', () => {
  for (const value of [undefined, false, 'true', 1]) { const f = fixture('TH'); f.input.lossTreatmentConfirmed = value; blocks(f, 'LOSS_TREATMENT_CONFIRMATION_REQUIRED'); }
});
test('cancelled row has no allocation, conversion, tariff or group requirement', () => {
  for (const country of ['CO', 'TH']) {
    const f = fixture(country); f.rows.push({ ...f.rows[0], lineId: 'zero', actualQuantity: 0, lineAmount: 0, boxQuantity: 0 });
    const r = run(f); assert.deepEqual(r.issues, []);
    assert.equal(r.lines[3].totalCostKRW, 0); assert.equal(r.lines[3].costPerUnitKRW, null);
    assert.equal(r.lines[3].componentAmounts.cancellation, true);
    f.input.lineInputs.push({ lineId: 'zero', grossWeightKg: 1 }); blocks(f, 'CANCELLED_LINE_WEIGHT_INVALID');
  }
});
test('zero fees are explicit and stable residual allocation is permutation invariant', () => {
  for (const country of ['CO', 'TH']) {
    const f = fixture(country); f.input.customsTotalKRW = 0; f.common.effectiveFreightAmount = 0;
    assert.deepEqual(run(f).issues, []);
    assert.equal(run(f).lines[0].componentAmounts.customsKRW, 0);
    f.input.customsTotalKRW = .000001; f.common.effectiveFreightAmount = .000001;
    const a = run(f); f.rows.reverse(); const b = run(f);
    assert.deepEqual([...a.lines].sort((x, y) => x.lineId.localeCompare(y.lineId)), [...b.lines].sort((x, y) => x.lineId.localeCompare(y.lineId)));
    near(a.lines.reduce((s, l) => s + l.componentAmounts.freightNative, 0), .000001);
  }
});
test('unsupported, existing errors, non-array rows and numeric overflow fail closed', () => {
  const f = fixture(); f.common.formula = { formulaId: 'UNKNOWN' }; blocks(f, 'GROUPED_FORMULA_UNSUPPORTED');
  const g = fixture(); g.rows = []; blocks(g, 'RECEIPT_LINES_REQUIRED');
  const h = fixture(); h.common.exchangeRate = 1e308; blocks(h, 'COST_OVERFLOW');
  const i = fixture(); const issues = [{ severity: 'error', code: 'CORE_BLOCKED' }];
  assert.deepEqual(calculate(i.document, i.rows, i.input, i.common, issues).lines, []);
});
test('descriptor evidence and group editor metadata are source-bound', () => {
  for (const descriptor of Object.values(formulas)) {
    assert.match(descriptor.formulaSourceHash, /^[a-f0-9]{64}$/);
    assert.equal(descriptor.priceBasis, 'STEM'); assert.equal(descriptor.freightIncluded, false);
    assert.ok(descriptor.requiredTopLevelInputs.includes('costGroups'));
    assert.ok(Object.isFrozen(descriptor));
  }
  assert.deepEqual(formulas.CO_GROUP_WEIGHT_VOLUME_V1.costGroupFields,
    ['quantity', 'boxQuantity', 'grossWeightKg', 'volumeWeightKg']);
  assert.deepEqual(formulas.TH_GROUP_BOX_SHARE_V1.costGroupFields, ['quantity', 'boxQuantity']);
  assert.ok(Object.values(formulas).every(descriptor => Object.isFrozen(descriptor.costGroupFields)));
});

test('CO 14-2 source group allocations reproduce ROSE per-STEM freight and customs', () => {
  const f = fixture(); Object.assign(f.document.reviewedMetadata, { gw: 340, cw: 340 });
  f.common.effectiveFreightAmount = 1056.2; f.common.exchangeRate = 1550; f.input.customsTotalKRW = 337800;
  const source = [['ROSE', 19, 100, 8, 10], ['CARNATION', 2, 300, 11, 9], ['ALSTROMERIA', 11, 160, 9.7, 7], ['RUSCUS', 4, 625, 8, 9.6]];
  const sumGross = source.reduce((s, [, boxes, , kg]) => s + boxes * kg, 0);
  const sumVolume = source.reduce((s, [, boxes, , , volume]) => s + boxes * volume, 0);
  f.input.costGroups = source.map(([groupId, boxes, perBox, kg, volume]) => ({ groupId, boxQuantity: boxes,
    quantity: boxes * perBox, grossWeightKg: boxes * kg / sumGross * 340, volumeWeightKg: boxes * volume / sumVolume * 340 }));
  f.rows = f.input.costGroups.map((g, i) => ({ lineId: `source-${i}`, prodKey: i + 1, unit: 'STEM',
    actualQuantity: g.quantity, boxQuantity: g.boxQuantity, unitPrice: .38, lineAmount: g.quantity * .38, currency: 'EUR' }));
  f.input.lineInputs = f.rows.map((row, i) => ({ lineId: row.lineId, groupId: source[i][0], tariffRate: 0 }));
  const r = run(f); assert.deepEqual(r.issues, []);
  near(r.lines[0].componentAmounts.freightNative / 1900, .270214262871762);
  near(r.lines[0].componentAmounts.customsKRW / 1900, 86.4214902462426);
});

test('TH 40 normal STEM cost follows box shares without copying damaged P15', () => {
  const f = fixture('TH'); f.common.effectiveFreightAmount = 640.75; f.common.exchangeRate = 1400;
  f.input.customsTotalKRW = 330178.886804237;
  f.input.costGroups = [{ groupId: 'OTHERS', boxQuantity: 34, quantity: 3905 }, { groupId: 'LOOSE_BLOOMS', boxQuantity: 3, quantity: 5100 }];
  f.rows = [600, 3305, 5100].map((q, i) => ({ lineId: `th-${i}`, prodKey: i + 1, unit: 'STEM', actualQuantity: q,
    boxQuantity: i === 2 ? 3 : 34 * q / 3905,
    unitPrice: i === 2 ? .045 : .35, lineAmount: q * (i === 2 ? .045 : .35), currency: 'EUR' }));
  f.input.lineInputs = f.rows.map((r, i) => ({ lineId: r.lineId, groupId: i === 2 ? 'LOOSE_BLOOMS' : 'OTHERS', tariffRate: .05 }));
  const r = run(f); assert.deepEqual(r.issues, []); near(r.lines[0].costPerUnitKRW, 813.844341290404);
});

test('tiny rounded allocations never make a negative residual', () => {
  const f = fixture('TH'); f.common.effectiveFreightAmount = .000002; f.input.customsTotalKRW = .000002;
  f.input.costGroups = [{ groupId: 'OTHERS', quantity: 4, boxQuantity: 1 }];
  f.rows = [0, 1, 2, 3].map(i => ({ ...f.rows[0], lineId: `tiny-${i}`, actualQuantity: 1, lineAmount: 2, boxQuantity: .25 }));
  f.input.lineInputs = f.rows.map(r => ({ lineId: r.lineId, groupId: 'OTHERS', tariffRate: 0 }));
  const r = run(f); assert.deepEqual(r.issues, []);
  for (const line of r.lines) assert.ok(line.componentAmounts.freightNative >= 0 && line.componentAmounts.customsKRW >= 0);
});

for (const country of ['CO', 'TH']) {
  test(`${country} rejects forged 99/1 group boxes despite matching STEM quantities`, () => {
    const f = fixture(country);
    f.rows[0].boxQuantity = .5; f.rows[1].boxQuantity = .5; f.rows[2].boxQuantity = 1;
    f.input.costGroups[1].boxQuantity = 1;
    assert.deepEqual(run(f).issues, []);
    f.input.costGroups[0].boxQuantity = 99;
    blocks(f, 'GROUP_BOX_QUANTITY_MISMATCH');
  });
  test(`${country} missing/invalid actual box counts cannot be treated as zero`, () => {
    for (const value of [undefined, null, '', ' ', false, NaN, -1]) {
      const f = fixture(country); f.rows[0].boxQuantity = value;
      blocks(f, 'RECEIPT_BOX_QUANTITY_REQUIRED');
    }
    const f = fixture(country); f.rows[0].boxQuantity = 0;
    blocks(f, 'GROUP_BOX_QUANTITY_MISMATCH');
  });
  test(`${country} compares group boxes independently, not only invoice total`, () => {
    const f = fixture(country); f.input.costGroups[0].boxQuantity = 2; f.input.costGroups[1].boxQuantity = 2;
    blocks(f, 'GROUP_BOX_QUANTITY_MISMATCH');
  });
}

test('BOX quantity consistency and cancelled box counts fail closed', () => {
  const f = fixture('TH'); f.rows[0].unit = 'BOX';
  Object.assign(f.input.lineInputs[0], { stemsPerBunch: 1, bunchesPerBox: 1 });
  blocks(f, 'RECEIPT_BOX_QUANTITY_MISMATCH');
  const g = fixture(); g.rows.push({ ...g.rows[0], lineId: 'zero', actualQuantity: 0, lineAmount: 0 });
  blocks(g, 'CANCELLED_LINE_BOX_QUANTITY_INVALID');
  delete g.rows[3].boxQuantity; assert.deepEqual(run(g).issues, []);
});
