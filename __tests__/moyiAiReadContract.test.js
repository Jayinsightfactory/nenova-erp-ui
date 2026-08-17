const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('pages/api/automation/ai/[scope].js', 'utf8');

assert.match(source, /function orderYear\(raw\)/, 'AI ERP 조회는 명시적 연도를 검증해야 합니다.');
assert.match(source, /vo\.OrderYear=@year AND/, '주문 조회는 OrderYear+OrderWeek로 격리해야 합니다.');
assert.match(source, /vs\.OrderYear=@year AND/, '출고·견적 조회는 OrderYear+OrderWeek로 격리해야 합니다.');
assert.match(source, /year: \{ type: sql\.NVarChar, value: year \}/, '검증한 연도를 SQL 파라미터로 전달해야 합니다.');
assert.match(source, /scope === 'stock' \? null : orderYear\(req\.query\.year\)/, '차수형 조회는 year 누락을 거부해야 합니다.');
assert.match(source, /checkMoyiAutomationAuth/, '수집기 전용 토큰과 MOYI 조회 토큰을 분리해야 합니다.');
assert.doesNotMatch(source, /json\.slice\(0, 4096\)/, '응답 크기 제한이 JSON을 중간에서 잘라서는 안 됩니다.');
assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE|DROP|ALTER)\b/i,
  'MOYI AI 조회 엔드포인트는 ERP 원장을 변경하면 안 됩니다.');

console.log('MOYI AI read-only year/week contract passed');
