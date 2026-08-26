import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  collectEstimateBatchReadFailures,
  estimateBatchReadFailureMessage,
} from '../lib/estimateBatchOutputGuard.js';

const outcomes = [
  { custName: '0행 정상업체', rows: [] },
  { custName: '조회 실패 업체', error: new Error('500') },
  { custName: '조회 실패 업체', error: new Error('retry failed') },
  { custName: '정상 업체', rows: [{ ProdKey: 1 }] },
];
const failures = collectEstimateBatchReadFailures(outcomes);
assert.deepEqual(failures, ['조회 실패 업체'], '0행 정상 업체는 실패 업체로 분류하지 않는다.');
assert.equal(
  estimateBatchReadFailureMessage(failures),
  '출력 자료 조회에 실패한 업체가 있습니다: 조회 실패 업체. 재조회 후 다시 시도하세요.',
);
assert.deepEqual(collectEstimateBatchReadFailures([{ custName: '0행 정상업체', rows: [] }]), [],
  '조회 성공 결과가 빈 행이어도 문서 생성 중단 사유가 아니다.');

const page = fs.readFileSync('pages/estimate.js', 'utf8');
assert.match(page, /사전검증 확인 실패:/, '확정 사전검증 실패는 차수명을 포함해 POST 전에 중단한다.');
assert.match(page, /if \(!r\.ok \|\| !d\.success\) throw new Error/, 'GET 응답 실패도 사전검증 실패로 취급한다.');
assert.match(page, /collectEstimateBatchReadFailures\(batchOutcomes\)/, '인쇄/Excel 다중 조회 실패 업체를 수집한다.');
assert.match(page, /estimateBatchReadFailureMessage\(failedCustomers\)/, '부분 문서 대신 재조회 안내를 표시한다.');
assert.match(page, /거래명세표 출력자료 조회 실패/, '다중 거래명세표 조회의 비성공 응답을 빈 행으로 숨기지 않는다.');

console.log('estimate batch output guard tests passed');
