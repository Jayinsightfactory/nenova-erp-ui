import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync('pages/estimate.js', 'utf8');
const api = fs.readFileSync('pages/api/estimate/index.js', 'utf8');
assert.ok(page.includes("openEstimateEntry('defect')"), '불량차감 진입점이 있어야 한다.');
assert.ok(page.includes("openEstimateEntry('legacy')"), '기존 불량/검역등록 진입점이 있어야 한다.');
assert.ok(page.includes('＋ 불량/검역등록'), '기존 불량/검역등록 버튼 문구를 유지해야 한다.');
assert.ok(page.includes('options={estimateTypeOptions}'), '기존 모달은 EstimateType 선택을 유지해야 한다.');
assert.ok(page.includes('＋ 추가 품목등록'), '추가 품목등록 진입점을 보존해야 한다.');
assert.ok(page.includes("entryMode:    defectForm.entryMode"), '선택한 등록 상태를 API까지 전달해야 한다.');
assert.ok(api.includes('normalizeEstimateTypeInput(estimateType, unit).typeText'), '기존 API는 선택 EstimateType을 그대로 정규화해야 한다.');
assert.ok(api.includes("entryMode: isLegacyEntry ? 'legacy'"), '응답도 기존 등록 상태를 보존해야 한다.');
assert.ok(api.includes('ESTIMATE_SCOPE_MISMATCH'), '연도·차수·거래처 불일치는 저장 전에 차단해야 한다.');
assert.ok(api.includes('OUTPUT INSERTED.EstimateKey INTO @EstimateInserted(EstimateKey)'), 'Estimate 트리거 호환 INSERT를 유지해야 한다.');
assert.ok(api.includes("affectedTable: 'Estimate'"), 'Estimate 쓰기는 SystemActionLog에 기록돼야 한다.');
assert.ok(api.includes('const qty = (isNegative ? -1 : 1) * inputQuantity'), '불량/검역은 음수 수량 공식을 공유해야 한다.');
assert.ok(api.includes('const amount = Math.round(qty * effectiveCost / 1.1)'), 'EXE 공급가 공식을 유지해야 한다.');
assert.ok(api.includes('const estUnit = prod.recordset[0]?.EstUnit'), 'Estimate.Unit은 Product.EstUnit을 우선해야 한다.');
assert.equal(api.includes("action: 'unfix'"), false, 'Estimate 차감 등록은 출고 확정해제 사이클을 실행하면 안 된다.');
assert.ok(page.includes("mode: 'PIVOT_DISTRIBUTION'"), '추가 품목등록은 별도 분배 상태/API를 유지해야 한다.');

console.log('estimate defect/quarantine restore contract tests passed');
