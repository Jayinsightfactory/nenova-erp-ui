# 작업 완료 보고 — 주차별 매출이익보고서 필수 입력 UX 개선

## 메타

| 항목 | 내용 |
|------|------|
| 일시 | 2026-08-24 |
| 사용자 요청 | `pages/sales/profit-report.js`의 필수 입력 영역과 재고 매입단가 모달을 실무에서 빠르게 이해·입력할 수 있게 UI만 재배치. 계산식·API·저장 payload·ERP side effect는 변경 금지 |
| 브랜치 | `codex/profit-report-required-input-ui` |
| 커밋 | 없음 (미커밋 — 사용자 요청에 따름) |
| 배포 | 미배포 |

---

## 변경 내용

### 1. "입력·확인 필요" 요약을 본표 위로 이동

카테고리별 화면에서 본표(`<table>` rows.map)보다 **먼저** 렌더되는 `st.requiredWrap` 블록을
신설해 4개 진입점을 모았다:

- 🏷 재고 매입단가 입력 → 기존 `openPriceModal()` 그대로 재사용
- 📦 그외통관비 입력 → 기존 `showCustoms`/`setShowCustoms` 상태 그대로 재사용
- 🚢 항공료 연결 확인 → 기존 `showForwarding`/`setShowForwarding` 상태 그대로 재사용
- ⚠ 과세환율 입력 필요 안내 → 기존 `validationRateRows`(`needsRateInput` 필터) 개수 그대로 재사용

버튼 표시 조건(`stockPriceInputNeeded`/`customsInputNeeded`/`forwardingSourceReviewNeeded`)과
비활성화 조건(`data?.confirmed`)도 세션 시작 시점 diff에 남아있던 이전 로직을 그대로 옮겼다 —
새 조건식을 추가하지 않았다.

열려 있는 `<CustomsClearancePanel week={weekInput.value} year={reportYear} onSaved={load} />`와
`<ForwardingClearancePanel .../>`도 이 요약 블록 안, 즉 본표보다 위에서 렌더링하도록 옮겼다
(이전에는 본표 아래 "검증·입력" 그룹 안에서 렌더링했다). props는 변경하지 않았다.

### 2. 본표 아래 그룹 이름 변경 — "검증·입력" → "상세 확인 내역"

- 접기 토글 제목을 "검증·입력" → "상세 확인 내역"으로, 배지 문구를 "⚠ 검증·입력 N건"/
  "검증·입력 (문제 없음)" → "상세 확인 N건"/"상세 확인 (문제 없음)"으로 바꿨다.
- 툴팁을 "검증 안내와 그외통관비/포워딩 입력 패널을 모아서 보여줍니다"에서 "감사 오류·재고
  확인 필요 등 계산에 사용된 자동값의 상세 진단 내역입니다 — 계산 전 필수 입력이 아닙니다"로
  바꿔, 계산 전 필수 입력처럼 보이지 않게 했다.
- 이 그룹 안에 있던 `CustomsClearancePanel`/`ForwardingClearancePanel` 렌더 블록은 제거했다
  (위 1번 블록으로 이동 완료). 감사 오류 배너·실사 시작재고 확인 배너·기타(미분류) 배너는
  그대로 남겼다 — 이 셋은 "직접 입력"이 아니라 "진단"이므로 요구사항 범위에 포함되지 않는다.
- `hasValidationIssues`/`validationCount`/`showValidation` 등 기본 펼침·배지 집계 로직은
  전혀 바꾸지 않았다.

### 3. 내부 열 문자 표기 제거

- `ISSUE_COLUMN_LABELS` 매핑을 실제로 사용하도록
  `issue.columns.join('/')` 원문 렌더링을 `(issue.columns || []).map(col =>
  ISSUE_COLUMN_LABELS[col] || col).join(' · ')`로 교체했다. `issue.code`/`issue.message` 등
  서버 audit 객체 자체는 손대지 않았다 — 열 이름과 문장은 `humanizeAuditMessage()`를 거쳐
  렌더링 시점에서만 한글 업무 용어로 변환한다.
- "과세환율(R) 입력 필요" → "과세환율 입력 필요", "해당 행의 R 입력칸" → "해당 행의 환율
  입력칸".
- 기타(미분류) 배너와 합계행 툴팁의 "본표 합계(C/D/I/J/K)"·"(C·D·I·J·K)" → "본표
  합계(매출액·매출비율·매출원가·매출이익·이익률)"로 변환(2곳 + 배너 1곳, 총 3곳).
- 본표 상단의 자동값 설명 문단은 내부 열 문자를 제거하고, 자동으로 불러오는 자료와 사용자가
  입력해야 하는 자료를 세 문장으로 줄였다. 상세 계산 근거는 기존 `ProfitReportSourceGuide`에서
  접어 보도록 유지했다.

### 4. 재고 매입단가 모달 재배치

- 카드 크기: `min(1000px, 96vw)`/`86vh` → `min(1320px, 98vw)`/`92vh`(`maxHeight`도 동일 조정).
- 전용 표 스타일 신설: `st.priceModalTable`(`tableLayout: 'fixed'`)·`st.priceModalTh`(sticky
  top)·`st.priceModalTd`. 공용 `st.table`(`minWidth: 1800`)을 모달에서 더 이상 쓰지 않아 모달
  폭 안에서 가로 스크롤이 생기지 않는다.
- 열 구성: 재고 기준 / 국가·품종 / 품목명(가장 넓은 `<col>`, `whiteSpace: 'normal'`로 줄바꿈
  허용) / 재고수량 / 환산수량 / 매입단가(원). 매 행 반복되던 고정 문구 열 "입력 사유"는
  제거했다(모달 상단 요약 문구로 대체 — 내용 손실 없음, 모든 행이 같은 문구였다).
  입력칸은 `minWidth: 140`·우측정렬·`fmtInput` 천 단위 콤마를 그대로 유지했다.
- 상단 바에 `입력 필요 {priceInputRows.length}건`/`입력한 값 {Object.keys(priceEdits).length}건`
  배지와 `매입단가 근거 저장` 버튼을 추가했다(하단 저장 버튼은 유지 — 둘 다 동일한
  `savePrices()` 핸들러, 새 로직 없음).
- 긴 설명 문단을 2줄 요약 + 접힌 `<details><summary>계산 기준 보기</summary>...`로 분리했다.
  텍스트 내용 자체(콜롬비아 5품종·베트남 카테고리 평균원가 공식, 샘플 품목 평균 규칙)는
  그대로 보존했다.

### 5. 회귀 테스트

- `__tests__/profitReportPanelOrderContract.test.js` 갱신 — 기존에는 "통관/포워딩 패널이
  본표보다 아래"를 고정하는 계약이었는데, 이번 요청과 정면으로 배치가 바뀌므로(본표 **위**로
  이동) 순서 계약을 다시 썼다: `<div style={st.requiredWrap}>` 요약 블록과
  `CustomsClearancePanel`/`ForwardingClearancePanel`이 본표 `<table>` 여는 태그보다 앞에
  있는지, "상세 확인 내역" 그룹(옛 "검증·입력")은 본표 뒤에서 시작하고 그 범위 안에는 더 이상
  Customs/Forwarding 패널이 없는지, 이익률 분석 그룹은 그 뒤에 오는지를 정적 소스 검사로
  고정했다. 구 배치(패널이 본표 뒤)로 되돌아가면 실패하는 회귀 가드도 유지했다.
- `__tests__/profitReportRequiredInputUiContract.test.js` 신설 — (1) 요약 진입점 4개가 기존
  상태/핸들러(`openPriceModal`/`showCustoms`/`showForwarding`/`validationRateRows`)를 그대로
  쓰는지, `CustomsClearancePanel`/`ForwardingClearancePanel`의 props가 그대로인지, (2) 렌더
  코드(주석 제외, 줄 단위 `// ` 필터링으로 취약한 전체-grep 금지)에 "검증·입력"/"과세환율(R)"/
  "VERIFIED"/"C/D/I/J/K"/"C·D·I·J·K"가 없는지, (3) `issue.columns`가 `ISSUE_COLUMN_LABELS`로
  변환되는지, (4) 모달이 `priceModalTable` 전용 스타일을 쓰고 모달 블록 안에서 공용 `st.table`을
  쓰지 않는지, 카드 크기·입력칸 최소폭·상단 배지·계산 기준 보기·열 순서를 모두 검사한다.
- `__tests__/profitReportWorkbookParity.test.js` 1곳 갱신 — 기존 체크가 문자열
  `과세환율(R) 입력 필요`를 리터럴로 찾고 있어서(위 3번 변경과 충돌), 같은 기능(환율 원천 없을
  때 R 입력칸 자동 노출)을 검증하는 문자열을 `과세환율 입력 필요`로 갱신했다. 이 테스트가
  검증하는 실제 동작(`needsRateInput`, `cd.editable`)은 바꾸지 않았다.
- `docs/exe-golden/FormProfitReport.md`에 "2026-08-24 필수 입력 UX 개선" 절을 추가하고,
  `docs/contracts/weekly-profit-report.json`에 read-only UI 액션
  `REPORT_REQUIRED_INPUT_SUMMARY_VIEW`(side-effect: 배치만 바뀌고 조회/저장은 기존 액션이
  그대로 수행)와 새 테스트 파일을 `requiredTestFiles`에 추가했다.
- `package.json`의 `test:erp-contract` 체인에 새 테스트를 `profitReportPanelOrderContract`
  바로 뒤에 연결했다(기존 profit-report 테스트들과 같은 위치 규칙).

---

## 손대지 않은 것 (요청 범위 밖)

- `lib/profitReportCalc.js`, `lib/profitReport.js`, `lib/customsForwarding.js`,
  `pages/api/sales/profit-report.js` 등 계산·API·payload 코드는 전혀 수정하지 않았다.
- `savePrices()`/`save()`/`confirmReport()` 등 모든 저장 핸들러의 로직·요청 body·엔드포인트는
  그대로다 — 버튼 위치만 옮겼다.
- `CustomsClearancePanel`/`ForwardingClearancePanel` 컴포넌트 내부 코드는 건드리지 않았다.
- `EditCell`의 내부 계산 키는 코드와 계약에서만 유지하고, 화면 제목과 감사 안내에는 한글 업무
  용어를 사용한다.

---

## 검증 결과 (실제 명령 출력)

```
$ node __tests__/profitReportPanelOrderContract.test.js
... (전체 33개 체크)
총 성공 — 실패 0건

$ node __tests__/profitReportRequiredInputUiContract.test.js
... (전체 26개 체크)
총 성공 — 실패 0건

$ npm run test:ui-layout
UI layout audit: 98 page files checked
UI layout/menu contract passed
nenovaSS3 admin access tests passed

$ node __tests__/profitReportWorkbookParity.test.js
... (전체 항목)
총 성공 — 실패 0건

$ node __tests__/erpContractManifest.test.js
ERP contract manifest tests passed
```

추가로 실행해 전부 통과를 확인한 관련 회귀(모두 `node __tests__/<파일>.test.js` 개별 실행,
실패 0건): `profitReportSourceGuide`, `profitReportRateAnalysis`, `profitReportDriverExplanation`,
`profitReportStockPriceSuggestion`, `profitReportConfirmAuditTrail`, `profitReportMonthly`,
`profitReportWorkbookFullParity`, `profitReportAnalysisGetReadOnlyDdl`,
`profitReportGetReadOnlyDdl`, `profitReportInventorySourceCompletion`,
`profitReportInventoryWorkbookCatalog`, `profitReportCountryClassificationParity`,
`profitReportClassification`, `profitReportStockCostExclusionContract`,
`profitReportAustraliaUnitFallback`, `profitReportConfirmSnapshotImmutability`,
`profitReportRecentCostCutoff`, `profitReportYearAndRateScopeContract`,
`profitReportPriceMixCandidates`, `profitReportHistoricalCustoms`,
`profitReportFormulaSourceContract`, `profitReportStockLinkContract`,
`customsForwardingAuto`, `profitReportAcceptanceHarness`.

`node -e "JSON.parse(...)"`로 `docs/contracts/weekly-profit-report.json`의 JSON 유효성도
확인했다(`valid json` 출력).

**미검증**: 브라우저 실렌더링(hydration, 실제 클릭 동작, 반응형 레이아웃 시각 확인)은 이
세션에서 수행하지 않았다 — 정적 소스 계약 테스트로만 검증했다. dev 서버 기동·브라우저 확인은
사용자 환경에서 별도로 확인 필요.

---

## 변경 파일

| 파일 | 변경 |
|------|------|
| `pages/sales/profit-report.js` | 요약 블록 신설·이동, "상세 확인 내역" 리네이밍, issue.columns 한글 변환, 모달 재설계 |
| `__tests__/profitReportPanelOrderContract.test.js` | 새 배치(요약 블록+패널이 본표 위)로 순서 계약 재작성 |
| `__tests__/profitReportRequiredInputUiContract.test.js` | 신규 — 진입점 재사용/표기 제거/모달 스타일 계약 |
| `__tests__/profitReportWorkbookParity.test.js` | 문자열 리터럴 1곳 갱신(과세환율(R) → 과세환율) |
| `docs/exe-golden/FormProfitReport.md` | 2026-08-24 절 추가 |
| `docs/contracts/weekly-profit-report.json` | `REPORT_REQUIRED_INPUT_SUMMARY_VIEW` 액션 추가, `requiredTestFiles`에 신규 테스트 추가 |
| `package.json` | `test:erp-contract` 체인에 신규 테스트 연결 |
