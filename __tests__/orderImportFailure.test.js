import assert from 'node:assert/strict';
import fs from 'node:fs';
import { presentOrderImportFailure, orderImportWarningMessage } from '../lib/orderImportFailure.js';

for (const error of [new TypeError('Failed to fetch'), Object.assign(new Error('upstream timeout'), { status: 502 }),
  Object.assign(new Error('unavailable'), { status: 503 }), Object.assign(new Error('gateway timeout'), { status: 504 }),
  Object.assign(new Error('internal server error'), { status: 500 })]) {
  const result = presentOrderImportFailure(error);
  assert.equal(result.kind, 'ambiguous');
  assert.match(result.message, /저장 여부 확인 필요/);
  assert.match(result.message, /자동 재전송하지 않았습니다/);
  assert.match(result.message, /초안은 유지했습니다/);
  assert.match(result.message, /주문관리에서 업체·연도·차수의 현재 주문을 먼저 조회/);
  assert.match(result.message, /다시 등록하지 마세요/);
}

for (const status of [400, 409, 422]) {
  const result = presentOrderImportFailure(Object.assign(new Error('출고가 있는 품목은 삭제할 수 없습니다.'), { status }));
  assert.equal(result.kind, 'rejected');
  assert.match(result.message, new RegExp(`HTTP ${status}`));
  assert.match(result.message, /출고가 있는 품목은 삭제할 수 없습니다/);
  assert.match(result.message, /초안은 유지했습니다/);
  assert.match(result.message, /자동 재전송하지 않았습니다/);
  assert.doesNotMatch(result.message, /저장 여부 확인 필요/);
}

assert.equal(orderImportWarningMessage('재고 재계산 경고: gate busy'), '재고 재계산 경고: gate busy');
assert.equal(orderImportWarningMessage({ code: 'STOCK_CALC_FAILED', message: '계산 batch rollback' }), '계산 batch rollback');
assert.equal(orderImportWarningMessage({ code: 'STOCK_CALC_FAILED' }), 'STOCK_CALC_FAILED');

const page = fs.readFileSync(new URL('../pages/orders/import.js', import.meta.url), 'utf8');
assert.match(page, /presentOrderImportFailure\(e\)/, 'the register catch uses the pure failure presenter');
assert.equal((page.match(/apiPost\('\/api\/orders'/g) || []).length, 1, 'the page keeps exactly one explicit order POST callsite');
assert.match(page, /orderMode: 'FINAL_SNAPSHOT',[\s\S]*source: 'order-import-final'/, 'the existing final-snapshot write contract is unchanged');
const registerCatch = page.slice(page.indexOf('} catch (e) {', page.indexOf('const handleRegister')), page.indexOf('} finally {', page.indexOf('const handleRegister')));
assert.doesNotMatch(registerCatch, /apiPost\('\/api\/orders'/, 'an error path never sends an automatic retry');
assert.doesNotMatch(registerCatch, /clearImportDraft\(/, 'an error path preserves the uploaded draft');
assert.match(page, /주문은 저장됐지만 추가 확인이 필요합니다/, 'a generic warning does not claim a specific stock-calculation failure');
assert.doesNotMatch(page, /주문은 저장됐지만 재고 재계산에 실패했습니다/, 'a generic warning must not claim a stock-specific cause');

console.log('order import failure presentation and no-retry/draft source guards passed');
