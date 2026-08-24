import assert from 'node:assert/strict';
import { formatFarmCostSummary, groupArrivalCostRows, arrivalCostGroupKey, normalizeWeekOrder } from '../lib/arrivalCostView.js';

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

console.log('arrival cost view grouping tests passed');
