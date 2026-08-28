const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (file) => fs.readFileSync(file, 'utf8');
const endpoint = read('pages/api/moyi/drive-report-sync.js');
const excelLib = read('lib/profitReportExcel.js');
const reportUi = read('pages/sales/profit-report.js');

// MOYI 회사 드라이브(drive-bridge) 계약 — 색인 후 내용을 능동 업로드한다.
assert.match(endpoint, /\/drive-bridge\/index/, 'MOYI drive-bridge 색인 계약으로 전송해야 합니다.');
assert.match(endpoint, /\/drive-bridge\/content/, '색인 뒤 파일 내용을 업로드해야 합니다.');
assert.match(endpoint, /full:\s*false/, '전체 색인(full)은 금지 — 다른 브리지 에이전트 항목을 삭제하면 안 됩니다.');
assert.match(endpoint, /경영지원\/보고/, '보고서 파일은 경영지원/보고 폴더로 들어가야 합니다.');
assert.match(endpoint, /monthly/, '차수별 파일에 월별 요약 시트 데이터를 전달해야 합니다.');
assert.match(endpoint, /loadWeeklyReportPayload/, '확정 스냅샷이 있으면 확정값을 그대로 쓰는 공용 진입점을 사용해야 합니다.');
assert.match(endpoint, /buildMonthlyProfitSummary/, '월별 시트는 화면 월별 보기와 같은 집계 빌더를 사용해야 합니다.');
assert.match(endpoint, /periodDayRangesByMajor/, '차수 목록은 월별 보기와 같은 기간 원천을 사용해야 합니다.');
assert.match(endpoint, /202/, '연 단위 계산은 프록시 타임아웃을 피해 202(백그라운드 작업)로 응답해야 합니다.');
assert.match(endpoint, /WebMoyiReportPush/, '전송 감사 이력은 웹 전용 테이블에 남겨야 합니다.');
assert.match(endpoint, /weekly-profit-drive/, '드라이브 동기화 이력은 report-push와 구분되는 ReportType이어야 합니다.');

// 엑셀 2번째 시트 = 월별 (E/F 미합산 정책 유지)
assert.match(excelLib, /buildMonthlySheet/, '월별 시트 빌더가 있어야 합니다.');
assert.match(excelLib, /'월별'/, '시트 이름은 월별이어야 합니다.');
assert.match(excelLib, /월별로 합산하지 않는다/, 'E/F 월별 미합산 정책이 시트에 명시되어야 합니다.');

// 화면 버튼
assert.match(reportUi, /\/api\/moyi\/drive-report-sync/, '보고서 화면에 드라이브 동기화 호출이 있어야 합니다.');
assert.match(reportUi, /MOYI 드라이브 동기화/, '사용자 동기화 버튼이 있어야 합니다.');

console.log('MOYI drive report sync contract tests passed');
