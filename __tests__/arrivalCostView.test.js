import assert from 'node:assert/strict';
import { formatFarmCostSummary, groupArrivalCostRows, arrivalCostGroupKey, normalizeWeekOrder, filterArrivalRowsByWeight, arrivalWeightMode, arrivalWeightHint, arrivalVarietyWeightActive, sectionArrivalCostGroupsByWeek } from '../lib/arrivalCostView.js';

assert.equal(normalizeWeekOrder('asc'), 'asc');
assert.equal(normalizeWeekOrder('ASC'), 'asc');
assert.equal(normalizeWeekOrder(''), 'desc');

const rows = [
  {
    orderWeek: '34-2', countryName: '콜롬비아', countryFlower: '콜롬비아수국',
    prodKey: 22, productNameRaw: 'Hydrangea White', displayName: '수국 화이트',
    farmNameRaw: '농장1', farmName: '농장1', selectedArrivalCostKRW: 8800, uploadStatus: 'UPLOADED',
  },
  {
    orderWeek: '34-2', countryName: '콜롬비아', countryFlower: '콜롬비아수국',
    prodKey: 22, productNameRaw: 'Hydrangea White', displayName: '수국 화이트',
    farmNameRaw: '농장2', farmName: '농장2', selectedArrivalCostKRW: 8000, uploadStatus: 'UPLOADED',
  },
  {
    orderWeek: '34-2', countryName: '콜롬비아', countryFlower: '콜롬비아수국',
    prodKey: 22, productNameRaw: 'Hydrangea White', displayName: '수국 화이트',
    farmNameRaw: '농장3', farmName: '농장3', selectedArrivalCostKRW: 8600, uploadStatus: 'UPLOADED',
  },
  {
    orderWeek: '33-1', countryName: '콜롬비아', countryFlower: '콜롬비아카네이션',
    prodKey: 11, productNameRaw: 'Moon Light', displayName: '문라이트',
    farmNameRaw: '농장A', farmName: '농장A', selectedArrivalCostKRW: 4200, uploadStatus: 'UPLOADED',
  },
];

assert.equal(arrivalCostGroupKey(rows[0]), arrivalCostGroupKey(rows[1]));
const groups = groupArrivalCostRows(rows);
assert.equal(groups.length, 2);
assert.equal(groups[0].rows.length, 3);
assert.match(formatFarmCostSummary(groups[0].rows), /농장1 8,800원 \/ 농장2 8,000원 \/ 농장3 8,600원/);

assert.equal(arrivalWeightMode(100, 180), 'VOLUME');
assert.equal(arrivalWeightMode(120, 120), 'WEIGHT');
assert.equal(arrivalWeightMode(null, 10), 'UNKNOWN');
assert.equal(arrivalWeightHint({ countryName: '콜롬비아', orderWeek: '33-1', grossWeight: 100, chargeableWeight: 180 }), '33-1 콜롬비아장미 면 활성화');
assert.equal(arrivalWeightHint({ countryName: '콜롬비아', orderWeek: '33-2', grossWeight: 120, chargeableWeight: 100 }), '33-2 콜롬비아카네이션·알스트로 면 활성화');
assert.equal(arrivalWeightHint({ countryName: '에콰도르', orderWeek: '33-1', grossWeight: 100, chargeableWeight: 180 }), '');
assert.equal(arrivalVarietyWeightActive('콜롬비아장미', [{ countryName: '콜롬비아', grossWeight: 100, chargeableWeight: 180 }]), true);
assert.equal(arrivalVarietyWeightActive('콜롬비아카네이션', [{ countryName: '콜롬비아', grossWeight: 100, chargeableWeight: 180 }]), false);
assert.equal(arrivalVarietyWeightActive('콜롬비아카네이션', [{ countryName: '콜롬비아', grossWeight: 120, chargeableWeight: 100 }]), true);
assert.equal(arrivalVarietyWeightActive('콜롬비아알스트로', [{ countryName: '콜롬비아', grossWeight: 120, chargeableWeight: 120 }]), true);
assert.equal(arrivalVarietyWeightActive('콜롬비아수국', [{ countryName: '콜롬비아', grossWeight: 120, chargeableWeight: 100 }]), false);

const mixed = [
  { countryName: '콜롬비아', productNameRaw: 'ROSE Freedom', flowerNameRaw: '장미', grossWeight: 100, chargeableWeight: 180 },
  { countryName: '콜롬비아', productNameRaw: 'CARNATION Moon Light', flowerNameRaw: '카네이션', grossWeight: 100, chargeableWeight: 180 },
  { countryName: '콜롬비아', productNameRaw: 'ALSTROEMERIA Pink', flowerNameRaw: '알스트로', grossWeight: 100, chargeableWeight: 100 },
  { countryName: '콜롬비아', productNameRaw: 'ROSE Mondial', flowerNameRaw: '장미', grossWeight: 100, chargeableWeight: 100 },
  { countryName: '에콰도르', productNameRaw: 'ROSE Explorer', flowerNameRaw: '장미', grossWeight: 100, chargeableWeight: 180 },
  { countryName: '에콰도르', productNameRaw: 'CARNATION White', flowerNameRaw: '카네이션', grossWeight: 100, chargeableWeight: 180 },
];
assert.deepEqual(
  filterArrivalRowsByWeight(mixed.filter((row) => row.chargeableWeight > row.grossWeight)).map((row) => row.productNameRaw),
  ['ROSE Freedom', 'ROSE Explorer', 'CARNATION White'],
);
assert.deepEqual(
  filterArrivalRowsByWeight(mixed.filter((row) => row.chargeableWeight <= row.grossWeight)).map((row) => `${row.countryName}:${row.flowerNameRaw}`),
  ['콜롬비아:알스트로'],
);

const spam = [
  { farmNameRaw: '', selectedArrivalCostKRW: 9520 },
  { farmNameRaw: '', selectedArrivalCostKRW: 9520 },
  { farmNameRaw: 'Fillco', farmName: 'Fillco', selectedArrivalCostKRW: 8898 },
];
assert.equal(formatFarmCostSummary(spam), '농장미지정 9,520원 / Fillco 8,898원');

const weekSections = sectionArrivalCostGroupsByWeek(groups);
assert.equal(weekSections.length, 2);
assert.equal(weekSections[0].orderWeek, '34-2');
assert.equal(weekSections[0].groups.length, 1);
assert.equal(weekSections[1].groups[0].productNameRaw, 'Moon Light');

console.log('arrival cost view grouping tests passed');
