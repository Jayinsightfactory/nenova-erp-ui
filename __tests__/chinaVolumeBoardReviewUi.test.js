const assert = require('assert');
const fs = require('fs');

const page = fs.readFileSync('pages/stats/china-volume-board-review.js', 'utf8');
assert.match(page, /누락|초과|수량대조/, '별도 대조 검토 화면은 누락·초과 상태를 명시해야 합니다.');
assert.match(page, /BoardKey|boardKey|query\.key|작업본/, '검토 화면은 선택 작업본 키를 유지해야 합니다.');
assert.match(page, /keep|apply|unresolved|미해결|적용|유지|보류|셀 수정|품목 매칭/, '검토 화면은 불일치 처리 선택지를 제공해야 합니다.');
assert.match(page, /전산 주문수량.*인보이스 수량|인보이스 수량.*전산 주문수량/s, '업로드 직후에는 전산 주문과 인보이스를 쉬운 용어로 비교해야 합니다.');
assert.match(page, /인보이스.*부족|부족.*인보이스/s, '인보이스 부족 판정을 명확히 표시해야 합니다.');
assert.match(page, /인보이스.*초과|초과.*인보이스/s, '인보이스 초과 판정을 명확히 표시해야 합니다.');
assert.match(page, /packingPhase === 'REVIEW'/, '업로드 검토와 적용 결과 검사를 서로 다른 단계로 표시해야 합니다.');
assert.match(page, /인보이스 박스 분배/, '업로드 검토 화면에서 박스 분배 현황을 함께 표시해야 합니다.');
assert.match(page, /박스 직접 분배/, '수량 차이 확인 중 바로 분배 편집으로 이동할 수 있어야 합니다.');
assert.match(page, /OPEN_DISTRIBUTION/, '별도 검토창의 분배 작업을 원래 물량표에 안전하게 전달해야 합니다.');
assert.match(page, /editMatching\(row\.sourceRow\)/, '미매칭과 기존 매칭 행 모두 정확한 원본 행을 편집하도록 전달해야 합니다.');
assert.match(page, /업체·품목 매칭 수정/, '미매칭 원인이 업체 또는 품목이어도 같은 편집창으로 안내해야 합니다.');
assert.match(page, /매칭 수정/, '이미 매칭된 인보이스도 검토창에서 다시 매칭할 수 있어야 합니다.');
assert.match(page, /window|popup|새창|noopener/i, '검토 화면은 별도 창/검토 흐름으로 열 수 있어야 합니다.');
console.log('china volume board review UI contract passed');
