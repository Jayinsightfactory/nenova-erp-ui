import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../pages/estimate.js', import.meta.url), 'utf8');

assert.match(source, /서버 업데이트 중 — 입력값을 보존했습니다\. 연결 복구 후 자동으로 다시 처리합니다\./);
assert.match(source, /안전 대조 후 자동 재처리합니다/);
assert.match(source, /runEstimateWriteWithRecovery/);
assert.match(source, /classifyEstimateSaveSnapshot/);
assert.match(source, /sessionStorage/);
assert.match(source, /data-estimate-edit-column="quantity"/);
assert.match(source, /data-estimate-edit-column="cost"/);
assert.match(source, /onKeyDown=\{handleEstimateEditCellKeyDown\}/);

console.log('estimateSaveRecoveryUi tests passed');
