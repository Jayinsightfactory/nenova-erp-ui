const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (file) => fs.readFileSync(file, 'utf8');
const endpoint = read('pages/api/moyi/report-push.js');
const reportApi = read('pages/api/sales/profit-report.js');
const reportUi = read('pages/sales/profit-report.js');

assert.match(endpoint, /WebMoyiReportPush/, 'MOYI 전송 감사 테이블이 있어야 합니다.');
assert.match(endpoint, /\/integrations\/nenovaweb\/inbound/, '실제 MOYI 인바운드 계약으로 전송해야 합니다.');
assert.match(endpoint, /file_id:\s*pushId/, '재시도 멱등키를 MOYI 파일 ID로 전달해야 합니다.');
assert.match(endpoint, /content_base64:/, '보고서 파일을 Base64로 전달해야 합니다.');
assert.match(endpoint, /Sha256|sha256/, '전송 파일 해시를 이력에 남겨야 합니다.');
assert.match(endpoint, /retryPending|retryPushId/, '실패 전송 재시도 경로가 있어야 합니다.');
assert.match(endpoint, /State=@state/, '전송 상태를 성공·실패로 갱신해야 합니다.');
assert.match(reportApi, /export function parseMajor/, '보고서 차수 파서를 전송 API가 재사용할 수 있어야 합니다.');
assert.match(reportApi, /export async function loadReportData/, '전송 API가 화면과 같은 보고서 원천을 사용해야 합니다.');
assert.match(reportUi, /\/api\/moyi\/report-push/, '주차별 매출이익 보고서 화면에 전송 호출이 있어야 합니다.');
assert.match(reportUi, /MOYI 전송/, '사용자 전송 버튼이 있어야 합니다.');

console.log('MOYI report push contract tests passed');
