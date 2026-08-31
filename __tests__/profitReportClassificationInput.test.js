import assert from 'node:assert/strict';
import fs from 'node:fs';
import { allowedProfitClassificationTargets, masterPatchForProfitCategory } from '../lib/profitReportClassificationInput.js';

assert.deepEqual(masterPatchForProfitCategory('콜롬비아 장미', '기존'), { counName: '콜롬비아', flowerName: '장미' });
assert.deepEqual(masterPatchForProfitCategory('네덜란드', '튤립'), { counName: '네덜란드', flowerName: '튤립' });
assert.deepEqual(masterPatchForProfitCategory('국내', ''), { counName: '국내', flowerName: '왁스' });
assert.ok(!allowedProfitClassificationTargets('35').includes('기타(미분류)'));
assert.ok(!allowedProfitClassificationTargets('35').includes('공제'));
assert.ok(allowedProfitClassificationTargets('35').includes('네덜란드'));
assert.throws(() => masterPatchForProfitCategory('임의 분류', ''), /적용할 수 없습니다/);

const source = fs.readFileSync(new URL('../lib/profitReport.js', import.meta.url), 'utf8');
const action = source.slice(source.indexOf('export async function classifyUnclassifiedProfitProduct'), source.indexOf('/** N 순수매출액'));
assert.match(action, /unclassifiedDetailsByCategory\(major, orderYear\)/, '저장 직전에 같은 연도·차수의 미분류 원천을 다시 확인해야 함');
assert.match(action, /WITH \(UPDLOCK,HOLDLOCK\)/, '동시 품목마스터 변경을 잠가야 함');
assert.match(action, /UPDATE Product SET CounName=@country, FlowerName=@flower WHERE ProdKey=@pk/, '국가·화종 외 Product 필드는 변경 금지');
for (const forbidden of ['OrderDetail', 'ShipmentDetail', 'WarehouseDetail', 'Estimate', 'WebProfitReport']) {
  assert.doesNotMatch(action, new RegExp(`(?:UPDATE|INSERT\\s+INTO|DELETE\\s+FROM)\\s+${forbidden}`, 'i'), `${forbidden} 쓰기 금지`);
}
console.log('profit report classification input tests passed');
