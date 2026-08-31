import assert from 'node:assert/strict';
import fs from 'node:fs';
import { allowedProfitClassificationTargets, masterPatchForProfitCategory } from '../lib/profitReportClassificationInput.js';
import { buildProfitOverrideCaseSqlFromMap } from '../lib/profitReportCategoryOverrides.js';

assert.deepEqual(masterPatchForProfitCategory('콜롬비아 장미', '기존'), { counName: '콜롬비아', flowerName: '장미' });
assert.deepEqual(masterPatchForProfitCategory('네덜란드', '튤립'), { counName: '네덜란드', flowerName: '튤립' });
assert.deepEqual(masterPatchForProfitCategory('국내', ''), { counName: '국내', flowerName: '왁스' });
assert.ok(!allowedProfitClassificationTargets('35').includes('기타(미분류)'));
assert.ok(!allowedProfitClassificationTargets('35').includes('공제'));
assert.ok(allowedProfitClassificationTargets('35').includes('네덜란드'));
assert.throws(() => masterPatchForProfitCategory('임의 분류', ''), /적용할 수 없습니다/);

const source = fs.readFileSync(new URL('../lib/profitReport.js', import.meta.url), 'utf8');
const apiSource = fs.readFileSync(new URL('../pages/api/sales/profit-report.js', import.meta.url), 'utf8');
const action = source.slice(source.indexOf('export async function classifyUnclassifiedProfitProduct'), source.indexOf('/** N 순수매출액'));
assert.match(action, /unclassifiedDetailsByCategory\(major, orderYear\)/, '저장 직전에 같은 연도·차수의 미분류 원천을 다시 확인해야 함');
assert.match(action, /saveProfitCategoryOverride/, '웹 전용 보고서 분류 저장소를 사용해야 함');
assert.doesNotMatch(action, /UPDATE\s+Product/i, 'Product 국가·화종 직접 변경 금지');
for (const forbidden of ['OrderDetail', 'ShipmentDetail', 'WarehouseDetail', 'Estimate', 'WebProfitReport']) {
  assert.doesNotMatch(action, new RegExp(`(?:UPDATE|INSERT\\s+INTO|DELETE\\s+FROM)\\s+${forbidden}`, 'i'), `${forbidden} 쓰기 금지`);
}
const overridden = buildProfitOverrideCaseSqlFromMap("CASE WHEN p.CounName=N'중국' THEN N'중국' ELSE N'기타(미분류)' END", 'p', ['중국', '네덜란드'], {
  101: { category: '네덜란드' },
  102: { category: "임의'분류" },
});
assert.match(overridden, /WHEN p\.ProdKey=101 THEN N'네덜란드'/, '허용된 품목 오버라이드를 SQL 분류보다 우선해야 함');
assert.doesNotMatch(overridden, /ProdKey=102/, '허용 목록 밖 분류는 SQL에 넣지 않아야 함');
const confirmedBuilder = apiSource.slice(apiSource.indexOf('async function buildConfirmedPayload'), apiSource.indexOf('export default'));
assert.match(confirmedBuilder, /unclassifiedDetailsByCategory\(major, orderYear\)/, '확정본도 처리 대상 품목을 읽기 전용으로 제공해야 함');
assert.match(confirmedBuilder, /unclassifiedDetailsSource: 'live_read_only'/, '확정값과 현재 처리대상을 구분해야 함');
console.log('profit report classification input tests passed');
