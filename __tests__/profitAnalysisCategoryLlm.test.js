// 원인분석 탭(카테고리별 이익률 원인 + AI 소견) 계약 테스트.
// 실행: node __tests__/profitAnalysisCategoryLlm.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (file) => fs.readFileSync(file, 'utf8');
const lib = read('lib/profitReportCategoryAnalysis.js');
const analysisApi = read('pages/api/sales/profit-analysis.js');
const opinionApi = read('pages/api/sales/profit-analysis-opinion.js');
const tab = read('components/ProfitAnalysisTab.js');
const reportUi = read('pages/sales/profit-report.js');

// 근거 수집 lib — 분류/필터는 본표와 같은 원천을 재사용한다.
assert.match(lib, /buildProfitReportCategorySql/, '카테고리 분류 CASE는 본표 빌더를 재사용해야 합니다(복제 금지).');
assert.match(lib, /ISNULL\(ps\.Stock, 0\) < 0/, '재고 시차는 전산 기말 잔량(ProductStock.Stock) 음수로 판정해야 합니다(수식 재발명 금지).');
assert.match(lib, /ISNULL\(wm\.isDeleted,0\) = 0/, '다음 차수 입고 확인은 WarehouseMaster isDeleted 필터를 지켜야 합니다.');
assert.match(lib, /explainDrivers/, '카테고리 변동요인은 총계와 같은 손익영향 계산기를 재사용해야 합니다.');

// GET detail=category — 읽기 전용 유지(쓰기 검사는 profitReportAnalysisGetReadOnlyDdl.test.js가 수행).
assert.match(analysisApi, /detail.*===\s*'category'|'category'.*detail/s, 'GET detail=category 분기가 있어야 합니다.');
assert.match(analysisApi, /export async function loadCategoryEvidence/, '근거팩 빌더는 GET과 AI 소견이 공유해야 합니다.');
assert.match(analysisApi, /loadWeeklyReportPayload/, '주차 원장은 확정 스냅샷 우선 공용 진입점으로 읽어야 합니다.');
assert.match(analysisApi, /withCategory:\s*true/, '거래처×품목 매출은 카테고리 포함 로더를 써야 합니다.');

// AI 소견 — POST 전용 별도 엔드포인트 + 캐시 + 근거팩 서술 전용.
assert.match(opinionApi, /req\.method\s*!==\s*'POST'/, 'AI 소견은 POST 전용이어야 합니다(GET 읽기 전용 계약 보호).');
assert.match(opinionApi, /WebProfitAnalysisOpinion/, '소견은 웹 전용 캐시 테이블에 저장해야 합니다(ERP 원장 무기록).');
assert.match(opinionApi, /EvidenceHash/, '근거팩 해시로 캐시해 데이터가 같으면 LLM을 재호출하지 않아야 합니다.');
assert.match(opinionApi, /claude-haiku-4-5/, '소견 모델은 haiku 등급이어야 합니다(비용 통제).');
assert.match(opinionApi, /purpose:\s*'profit-analysis'/, 'LLM 비용은 costTracker purpose로 추적해야 합니다.');
assert.match(opinionApi, /근거팩에 있는 숫자만|새 수치를 계산하거나 추정해 만들지 마라/, '프롬프트가 근거팩 숫자만 인용하도록 강제해야 합니다.');
assert.match(opinionApi, /ruleFallbackOpinion/, 'API 키가 없어도 규칙 기반 요약으로 동작해야 합니다.');
assert.match(opinionApi, /loadCategoryEvidence/, '소견도 화면 카드와 같은 근거팩을 써야 합니다.');
assert.match(opinionApi, /export default withAuth\(/, '인증 없이 호출할 수 없어야 합니다.');

// 화면 — 보고서 내 별도 탭 + AI는 버튼으로만.
assert.match(reportUi, />원인분석<\/button>/, '보고서 화면 뷰 토글에 원인분석 탭이 있어야 합니다.');
assert.match(reportUi, /ProfitAnalysisTab/, '원인분석 탭 컴포넌트가 연결되어야 합니다.');
assert.match(tab, /detail=category/, '탭은 카테고리 근거팩 API를 사용해야 합니다.');
assert.match(tab, /profit-analysis-opinion/, '탭에서 AI 소견 API를 호출해야 합니다.');
assert.match(tab, /onClick=\{\(\) => runOpinion/, 'AI 소견은 버튼을 눌렀을 때만 실행되어야 합니다(자동 호출 금지).');
assert.ok(!/useEffect\([^)]*runOpinion/s.test(tab), 'useEffect에서 AI 소견을 자동 호출하면 안 됩니다.');
assert.match(tab, /재고 시차/, '재고 시차 섹션이 있어야 합니다.');
assert.match(lib, /loadYearNegativeStock/, '연간 재고시차 전수 스캐너가 있어야 합니다.');
assert.match(lib, /ROW_NUMBER\(\) OVER/, '전수 스캔은 세부차수별 대표 스냅샷(행수·StockKey 기준)만 봐야 합니다 — 낡은 중복 스냅샷 오탐 금지.');
assert.match(analysisApi, /stockLagYear/, 'GET detail=stockLagYear 분기가 있어야 합니다.');
assert.match(tab, /stockLagYear/, '탭에서 연간 재고시차 전수를 조회할 수 있어야 합니다.');
assert.match(lib, /loadYearStockFlow/, '흐름 재구성 전수(조정 가림 검출) 스캐너가 있어야 합니다.');
assert.match(analysisApi, /stockLagFlow/, 'GET detail=stockLagFlow 분기가 있어야 합니다.');
assert.match(tab, /stockLagFlow/, '탭에서 흐름 재구성 전수를 조회할 수 있어야 합니다.');

console.log('profit analysis category/LLM contract tests passed');
