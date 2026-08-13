// 2026-08-12 매출이익 보고서 섹션 재배치 회귀 검증
// pages/sales/profit-report.js 에서 다음 순서를 정적(source-order)으로 고정한다:
//   1) 카테고리별 본표 <table>(rows.map(row => ...) — 품명/합계 행)
//   2) "검증·입력" 접기 그룹(감사 오류 배너 · 기타(미분류) 배너 · CustomsClearancePanel/ForwardingClearancePanel)
//   3) "이익률 분석"(ANALYSIS_PANEL_ID) 접기 그룹
// 그리고 CustomsClearancePanel/ForwardingClearancePanel 이 본표 </table> 보다 뒤에 온다.
// 이 순서가 다시 뒤바뀌면(예: 통관/포워딩 입력 패널이 본표보다 먼저 렌더) 이 테스트가 실패해야 한다.
//
// 실행: node __tests__/profitReportPanelOrderContract.test.js
const fs = require('fs');
const path = require('path');

let failed = 0;
const check = (label, condition, detail = '') => {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failed += 1;
  }
};

function countOccurrences(source, needle) {
  let count = 0;
  let idx = source.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    idx = source.indexOf(needle, idx + 1);
  }
  return count;
}

async function main() {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'pages', 'sales', 'profit-report.js'),
    'utf8'
  );

  console.log('=== 앵커 유일성 확인 (앵커가 여러 번 나오면 오프셋 비교가 무의미해짐) ===');
  check('rows.map(row => { 는 파일에 1번만 등장(본표 tbody)', countOccurrences(source, 'rows.map(row => {') === 1);
  check("viewMode !== 'months' && data && ( 는 1번만 등장(검증·입력 그룹 게이트)",
    countOccurrences(source, "viewMode !== 'months' && data && (") === 1);
  check('<CustomsClearancePanel 는 1번만 등장', countOccurrences(source, '<CustomsClearancePanel') === 1);
  check('<ForwardingClearancePanel 는 1번만 등장', countOccurrences(source, '<ForwardingClearancePanel') === 1);
  check('aria-controls={ANALYSIS_PANEL_ID} 는 1번만 등장(이익률 분석 그룹 마커)',
    countOccurrences(source, 'aria-controls={ANALYSIS_PANEL_ID}') === 1);

  // ── 1) 본표 <table> 위치 ──────────────────────────────────────────────
  // 유일 앵커(rows.map(row => {)를 기준으로, 그 앞의 가장 가까운 <table 과
  // 그 뒤의 가장 가까운 </table> 을 본표의 시작/끝으로 삼는다.
  const mainTableRowsMapIdx = source.indexOf('rows.map(row => {');
  check('본표 rows.map 앵커 파싱', mainTableRowsMapIdx !== -1);
  const mainTableOpenIdx = source.lastIndexOf('<table', mainTableRowsMapIdx);
  const mainTableCloseIdx = source.indexOf('</table>', mainTableRowsMapIdx);
  check('본표 <table> 여는 태그를 찾음', mainTableOpenIdx !== -1 && mainTableOpenIdx < mainTableRowsMapIdx);
  check('본표 </table> 닫는 태그를 찾음', mainTableCloseIdx !== -1 && mainTableCloseIdx > mainTableRowsMapIdx);

  // 본표를 감싸는 조건부 렌더 블록이 viewMode/data 게이트를 유지하는지 — <table 바로 앞의
  // JSX 조건식(`{viewMode === 'category' && data && (`)을 확인한다.
  const mainTableGateIdx = source.lastIndexOf("{viewMode === 'category' && data && (", mainTableOpenIdx);
  check('본표는 여전히 viewMode===category && data 로 게이트됨',
    mainTableGateIdx !== -1 && mainTableGateIdx < mainTableOpenIdx,
    `gate=${mainTableGateIdx} open=${mainTableOpenIdx}`);

  // ── 2) "검증·입력" 접기 그룹 위치 ────────────────────────────────────
  const validationGroupGateIdx = source.indexOf("viewMode !== 'months' && data && (", mainTableCloseIdx);
  check('검증·입력 그룹은 본표 </table> 뒤에서 시작함', validationGroupGateIdx > mainTableCloseIdx);

  // 그룹 안의 실제 배너들 — 감사 오류 배너(data?.audit?.issues?.length > 0)와
  // 기타(미분류) 배너, 그리고 CustomsClearancePanel/ForwardingClearancePanel 사용부.
  const auditBannerIdx = source.indexOf('data?.audit?.issues?.length > 0', validationGroupGateIdx);
  check('감사 오류 배너(audit.issues) 마커를 검증·입력 그룹 안에서 찾음', auditBannerIdx > validationGroupGateIdx);

  const unclassifiedBannerIdx = source.indexOf("기타(미분류) 검증 영역", validationGroupGateIdx);
  check('기타(미분류) 배너 마커를 검증·입력 그룹 안에서 찾음', unclassifiedBannerIdx > validationGroupGateIdx);

  const customsPanelIdx = source.indexOf('<CustomsClearancePanel');
  const forwardingPanelIdx = source.indexOf('<ForwardingClearancePanel');
  check('<CustomsClearancePanel 사용부가 검증·입력 그룹 안에 있음', customsPanelIdx > validationGroupGateIdx);
  check('<ForwardingClearancePanel 사용부가 검증·입력 그룹 안에 있음', forwardingPanelIdx > validationGroupGateIdx);

  // 검증·입력 그룹을 감싸는 접기 패널(st.collapseWrap) div가 data 로 게이트되는지 —
  // 게이트 문자열 자체에 `data &&` 가 포함되어 있음을 재확인(정규식으로 명시 검증).
  check('검증·입력 그룹 게이트가 data 참에도 의존함(빈 데이터에서 렌더 금지)',
    /viewMode !== 'months' && data && \(/.test(source.slice(validationGroupGateIdx, validationGroupGateIdx + 60)));

  // ── 3) "이익률 분석" 그룹 위치 ────────────────────────────────────────
  // 검증·입력 그룹을 감싸는 st.collapseWrap div 다음에 오는 두 번째 st.collapseWrap 이
  // 이익률 분석 그룹의 컨테이너다.
  const validationCollapseWrapIdx = source.indexOf('st.collapseWrap', validationGroupGateIdx);
  check('검증·입력 그룹의 collapseWrap 컨테이너를 찾음', validationCollapseWrapIdx > validationGroupGateIdx);
  const analysisCollapseWrapIdx = source.indexOf('st.collapseWrap', validationCollapseWrapIdx + 1);
  check('이익률 분석 그룹의 collapseWrap 컨테이너를 찾음(검증·입력과 다른 두번째 등장)',
    analysisCollapseWrapIdx > validationCollapseWrapIdx);

  const analysisGateIdx = source.lastIndexOf("{viewMode === 'category' && data && (", analysisCollapseWrapIdx);
  check('이익률 분석 그룹 앞의 게이트 조건을 찾음', analysisGateIdx !== -1 && analysisGateIdx < analysisCollapseWrapIdx);
  check('이익률 분석 그룹은 검증·입력 그룹보다 뒤에서 시작함', analysisGateIdx > validationGroupGateIdx);
  check('이익률 분석 그룹도 viewMode===category && data 로 게이트됨(빈 데이터에서 렌더 금지)',
    /viewMode === 'category' && data && \(/.test(source.slice(analysisGateIdx, analysisGateIdx + 60)));

  const analysisPanelIdMarkerIdx = source.indexOf('aria-controls={ANALYSIS_PANEL_ID}');
  check('ANALYSIS_PANEL_ID 마커가 이익률 분석 게이트 뒤에 위치함', analysisPanelIdMarkerIdx > analysisGateIdx);
  check('ANALYSIS_PANEL_ID 마커가 검증·입력 그룹보다 뒤에 위치함', analysisPanelIdMarkerIdx > validationGroupGateIdx);

  // ── 4) CustomsClearancePanel/ForwardingClearancePanel 이 본표 </table> 뒤에 위치 ──
  check('<CustomsClearancePanel 이 본표 </table> 뒤에 위치함', customsPanelIdx > mainTableCloseIdx);
  check('<ForwardingClearancePanel 이 본표 </table> 뒤에 위치함', forwardingPanelIdx > mainTableCloseIdx);

  // ── 회귀 가드: 예전(재배치 이전) 배치 — 통관 패널이 본표보다 먼저 오는 상태가 아님을 명시적으로 확인 ──
  console.log('\n=== 회귀 가드: 구(舊) 배치(통관 패널이 본표보다 먼저)가 아님을 명시 확인 ===');
  check('구 배치 회귀 아님: <CustomsClearancePanel 이 본표 rows.map 앵커보다 앞에 있지 않음',
    !(customsPanelIdx < mainTableRowsMapIdx),
    `customsPanelIdx=${customsPanelIdx} mainTableRowsMapIdx=${mainTableRowsMapIdx}`);
  check('구 배치 회귀 아님: <ForwardingClearancePanel 이 본표 rows.map 앵커보다 앞에 있지 않음',
    !(forwardingPanelIdx < mainTableRowsMapIdx),
    `forwardingPanelIdx=${forwardingPanelIdx} mainTableRowsMapIdx=${mainTableRowsMapIdx}`);

  console.log(`\n총 ${failed ? '실패' : '성공'} — 실패 ${failed}건`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
