// 2026-08-24 매출이익 보고서 "입력·확인 필요" 요약 재배치 회귀 검증
// pages/sales/profit-report.js 에서 다음 순서를 정적(source-order)으로 고정한다:
//   1) "입력·확인 필요" 요약 블록(재고 매입단가/그외통관비/항공료/과세환율 입력 진입점) +
//      열린 CustomsClearancePanel/ForwardingClearancePanel — 본표보다 먼저 렌더
//   2) 카테고리별 본표 <table>(rows.map(row => ...) — 품명/합계 행)
//   3) "상세 확인 내역" 접기 그룹(감사 오류 배너 · 기타(미분류) 배너 등 진단 전용, 입력 패널 없음)
//   4) "이익률 분석"(ANALYSIS_PANEL_ID) 접기 그룹
// 이 순서가 다시 뒤바뀌면(예: 필수 입력 진입점이 본표보다 뒤로 밀리거나, 통관/포워딩 패널이
// 본표 뒤의 상세 진단 그룹 안으로 되돌아가면) 이 테스트가 실패해야 한다.
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
  check("<div style={st.requiredWrap}> 는 1번만 등장(입력·확인 필요 요약 블록)",
    countOccurrences(source, '<div style={st.requiredWrap}>') === 1);
  check("viewMode !== 'months' && data && ( 는 1번만 등장(상세 확인 내역 그룹 게이트)",
    countOccurrences(source, "viewMode !== 'months' && data && (") === 1);
  check('<CustomsClearancePanel 는 1번만 등장', countOccurrences(source, '<CustomsClearancePanel') === 1);
  check('<ForwardingClearancePanel 는 1번만 등장', countOccurrences(source, '<ForwardingClearancePanel') === 1);
  check('aria-controls={ANALYSIS_PANEL_ID} 는 1번만 등장(이익률 분석 그룹 마커)',
    countOccurrences(source, 'aria-controls={ANALYSIS_PANEL_ID}') === 1);

  // ── 1) "입력·확인 필요" 요약 블록 위치 ──────────────────────────────────
  const requiredWrapIdx = source.indexOf('<div style={st.requiredWrap}>');
  check('입력·확인 필요 요약 블록 앵커 파싱', requiredWrapIdx !== -1);
  const requiredGateIdx = source.lastIndexOf("{viewMode === 'category' && data && (", requiredWrapIdx);
  check('입력·확인 필요 요약 블록은 viewMode===category && data 로 게이트됨',
    requiredGateIdx !== -1 && requiredGateIdx < requiredWrapIdx,
    `gate=${requiredGateIdx} wrap=${requiredWrapIdx}`);

  // ── 2) 본표 <table> 위치 ──────────────────────────────────────────────
  // 유일 앵커(rows.map(row => {)를 기준으로, 그 앞의 가장 가까운 <table 과
  // 그 뒤의 가장 가까운 </table> 을 본표의 시작/끝으로 삼는다.
  const mainTableRowsMapIdx = source.indexOf('rows.map(row => {');
  check('본표 rows.map 앵커 파싱', mainTableRowsMapIdx !== -1);
  const mainTableOpenIdx = source.lastIndexOf('<table', mainTableRowsMapIdx);
  const mainTableCloseIdx = source.indexOf('</table>', mainTableRowsMapIdx);
  check('본표 <table> 여는 태그를 찾음', mainTableOpenIdx !== -1 && mainTableOpenIdx < mainTableRowsMapIdx);
  check('본표 </table> 닫는 태그를 찾음', mainTableCloseIdx !== -1 && mainTableCloseIdx > mainTableRowsMapIdx);

  // 본표를 감싸는 조건부 렌더 블록이 viewMode/data 게이트를 유지하는지.
  const mainTableGateIdx = source.lastIndexOf("{viewMode === 'category' && data && (", mainTableOpenIdx);
  check('본표는 여전히 viewMode===category && data 로 게이트됨',
    mainTableGateIdx !== -1 && mainTableGateIdx < mainTableOpenIdx,
    `gate=${mainTableGateIdx} open=${mainTableOpenIdx}`);

  check('입력·확인 필요 요약 블록이 본표 <table> 여는 태그보다 앞에 있음',
    requiredWrapIdx !== -1 && requiredWrapIdx < mainTableOpenIdx,
    `requiredWrapIdx=${requiredWrapIdx} mainTableOpenIdx=${mainTableOpenIdx}`);

  // ── CustomsClearancePanel/ForwardingClearancePanel 이 요약 블록 안, 본표보다 앞 ──
  const customsPanelIdx = source.indexOf('<CustomsClearancePanel');
  const forwardingPanelIdx = source.indexOf('<ForwardingClearancePanel');
  check('<CustomsClearancePanel 사용부가 입력·확인 필요 요약 블록 뒤에 있음', customsPanelIdx > requiredWrapIdx);
  check('<ForwardingClearancePanel 사용부가 입력·확인 필요 요약 블록 뒤에 있음', forwardingPanelIdx > requiredWrapIdx);
  check('<CustomsClearancePanel 이 본표 <table> 여는 태그보다 앞에 있음(본표 위 렌더)', customsPanelIdx < mainTableOpenIdx);
  check('<ForwardingClearancePanel 이 본표 <table> 여는 태그보다 앞에 있음(본표 위 렌더)', forwardingPanelIdx < mainTableOpenIdx);

  // ── 회귀 가드: 예전(재배치 이전) 배치 — 통관/포워딩 패널이 본표보다 뒤(상세 확인 내역 그룹 안)로 되돌아가지 않았는지 ──
  console.log('\n=== 회귀 가드: 구(舊) 배치(통관/포워딩 패널이 본표보다 뒤)가 아님을 명시 확인 ===');
  check('구 배치 회귀 아님: <CustomsClearancePanel 이 본표 </table> 뒤에 있지 않음',
    !(customsPanelIdx > mainTableCloseIdx),
    `customsPanelIdx=${customsPanelIdx} mainTableCloseIdx=${mainTableCloseIdx}`);
  check('구 배치 회귀 아님: <ForwardingClearancePanel 이 본표 </table> 뒤에 있지 않음',
    !(forwardingPanelIdx > mainTableCloseIdx),
    `forwardingPanelIdx=${forwardingPanelIdx} mainTableCloseIdx=${mainTableCloseIdx}`);

  // ── 3) "상세 확인 내역" 접기 그룹 위치 ────────────────────────────────────
  const validationGroupGateIdx = source.indexOf("viewMode !== 'months' && data && (", mainTableCloseIdx);
  check('상세 확인 내역 그룹은 본표 </table> 뒤에서 시작함', validationGroupGateIdx > mainTableCloseIdx);

  const detailTitleIdx = source.indexOf('상세 확인 내역', validationGroupGateIdx);
  check('"상세 확인 내역" 제목 마커를 그룹 안에서 찾음', detailTitleIdx > validationGroupGateIdx);

  // 그룹 안의 실제 배너들 — 감사 오류 배너(data?.audit?.issues?.length > 0)와 기타(미분류) 배너.
  const auditBannerIdx = source.indexOf('data?.audit?.issues?.length > 0', validationGroupGateIdx);
  check('감사 오류 배너(audit.issues) 마커를 상세 확인 내역 그룹 안에서 찾음', auditBannerIdx > validationGroupGateIdx);

  const unclassifiedBannerIdx = source.indexOf("기타(미분류) 검증 영역", validationGroupGateIdx);
  check('기타(미분류) 배너 마커를 상세 확인 내역 그룹 안에서 찾음', unclassifiedBannerIdx > validationGroupGateIdx);

  // 상세 확인 내역 그룹 안에는 더 이상 입력 패널(Customs/Forwarding)이 없어야 한다 — 이미 본표 위로 이동함.
  const validationCollapseWrapIdx = source.indexOf('st.collapseWrap', validationGroupGateIdx);
  check('상세 확인 내역 그룹의 collapseWrap 컨테이너를 찾음', validationCollapseWrapIdx > validationGroupGateIdx);
  const analysisCollapseWrapIdx = source.indexOf('st.collapseWrap', validationCollapseWrapIdx + 1);
  check('이익률 분석 그룹의 collapseWrap 컨테이너를 찾음(상세 확인 내역과 다른 두번째 등장)',
    analysisCollapseWrapIdx > validationCollapseWrapIdx);
  check('상세 확인 내역 그룹 범위 안에 CustomsClearancePanel/ForwardingClearancePanel 이 없음(본표 위로 이동 완료)',
    !(customsPanelIdx > validationGroupGateIdx && customsPanelIdx < analysisCollapseWrapIdx)
    && !(forwardingPanelIdx > validationGroupGateIdx && forwardingPanelIdx < analysisCollapseWrapIdx));

  // 상세 확인 내역 그룹을 감싸는 접기 패널(st.collapseWrap) div가 data 로 게이트되는지.
  check('상세 확인 내역 그룹 게이트가 data 참에도 의존함(빈 데이터에서 렌더 금지)',
    /viewMode !== 'months' && data && \(/.test(source.slice(validationGroupGateIdx, validationGroupGateIdx + 60)));

  // ── 4) "이익률 분석" 그룹 위치 ────────────────────────────────────────
  const analysisGateIdx = source.lastIndexOf("{viewMode === 'category' && data && (", analysisCollapseWrapIdx);
  check('이익률 분석 그룹 앞의 게이트 조건을 찾음', analysisGateIdx !== -1 && analysisGateIdx < analysisCollapseWrapIdx);
  check('이익률 분석 그룹은 상세 확인 내역 그룹보다 뒤에서 시작함', analysisGateIdx > validationGroupGateIdx);
  check('이익률 분석 그룹도 viewMode===category && data 로 게이트됨(빈 데이터에서 렌더 금지)',
    /viewMode === 'category' && data && \(/.test(source.slice(analysisGateIdx, analysisGateIdx + 60)));

  const analysisPanelIdMarkerIdx = source.indexOf('aria-controls={ANALYSIS_PANEL_ID}');
  check('ANALYSIS_PANEL_ID 마커가 이익률 분석 게이트 뒤에 위치함', analysisPanelIdMarkerIdx > analysisGateIdx);
  check('ANALYSIS_PANEL_ID 마커가 상세 확인 내역 그룹보다 뒤에 위치함', analysisPanelIdMarkerIdx > validationGroupGateIdx);

  console.log(`\n총 ${failed ? '실패' : '성공'} — 실패 ${failed}건`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
