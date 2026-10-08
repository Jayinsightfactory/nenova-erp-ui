# 인보이스 단일 업로드 · 입고 등록 · 도착원가 통합 PRD

작성일 2026-10-07 · 상태: 구현 착수 / 운영 입고 쓰기 검증 전

## 1. 목적과 완료 정의

수입부가 인보이스를 변환한 뒤 엑셀을 내려받아 입고관리에 다시 올리는 작업을 없앤다.
패킹리스트 탭에서 한 번 업로드하고 품목·수량·금액·중량을 확인하면 같은 문서에서
입고 등록, 주문 대비 과부족 저장, 도착원가 산출과 영업·관리 조회까지 연결한다.
파일 다운로드 기능은 보조 기능으로 유지하지만 필수 중간 단계가 아니다.

완료는 분석 성공이 아니라 **실제 WarehouseKey/상세키, native 재고 처리, 원가 버전과
사후 조회 일치**로 판정한다. 현재 배포된 품목 매칭·엑셀 생성만으로 완료라고 표시하지 않는다.

## 2. 사용자와 권한

| 사용자 | 가능한 작업 | 제한 |
|---|---|---|
| 수입부·관리자 | 업로드, 매칭, 수량/가격/중량 수정, 초안, 등록, 수정 이력 | 서버 권한·차수 eligibility 재검증 |
| 영업·관리 조회자 | 입고·주문 과부족·원가 피벗 조회, 허용 범위 출력 | 원장 수정 권한 자동 부여 금지 |
| 원가 기준 관리자 | 공식 버전·배분 기준 검토/승인 | 기존 확정 결과 자동 덮어쓰기 금지 |

수정자는 서버 로그인 계정으로 기록한다. 요청 body의 이름·권한을 신뢰하지 않는다.
기존 import/warehouse 접근 정책과 사용자 부서 조회 정책을 공통화하되 권한을 넓히지 않는다.

## 3. 단일 작업 흐름

1. 연도·세부차수·국가·농장 선택, 인보이스 XLSX/PDF 업로드.
2. 원문·원본 좌표를 보존한 분석. XLSX 지원 양식은 로컬 코드 우선, PDF 외부 AI는 명시 선택.
3. 활성 DB 품목으로 매칭. 미매칭 클릭 → 검색/선택 → 팀 공용 매칭 저장.
4. 수량·단위·단가·통화·총액 검토. GW/CW·운송비는 원본 하이라이트와 확인창으로 검증.
5. 같은 연도·세부차수 주문과 기존 입고를 읽어 과부족을 계산. 담당자가 사유 확인.
6. 입고/원가 미리보기. 초안 저장과 **입고 등록**을 별도 버튼으로 구분.
7. 입고 등록: 서버 재검증 → native 호환 원자적 저장/재고 처리 → 저장값 재조회.
8. 원가 입력이 완전하면 승인된 공식으로 원가 버전 생성. 미완성이면 `입고완료·원가확인필요`.
9. 입고관리·도착원가·피벗이 동일 연결키와 단위의 결과를 읽는다.
10. 저장 이후 수정은 원문 보존, 차액 미리보기, 사유, 버전 검증, 이력 후 처리한다.

실제 저장 버튼은 모든 서버 안전 조건을 통과해야 활성화한다. 파일 분석 직후 무조건 DB 저장하지 않는다.
원가가 불완전한 상태의 입고 단독 등록은 사용자가 명시 확인해야 한다.

## 4. 화면 명세

기준 1920×1080 CSS px / 100%. 작은 화면에서도 조작 가능. 중첩 세로 스크롤 대신 페이지 스크롤.

### 상단

`연도 | 세부차수 | 국가 | 농장 | 인보이스번호 | AWB | 입고일 | 상태`

`파일 업로드 / 저장 내역 / 초안 저장 / 검증 / 입고 등록 / 엑셀 다운로드`

업로드 범위·선택 차수·확정 상태·미해결 건수를 첫 화면에서 식별한다.
파일명 차수를 제안할 수 있지만 명시 선택/원본 연도가 충돌하면 자동으로 현재연도를 적용하지 않는다.

### 검토 시트

`번호 | 원문품목/길이 | ERP 매칭품목·이슈 | 박스 | 단 | 송이 | 단가기준 | 단가 | 통화 | 금액 | 주문 | 기존입고 | 이번입고 | 차이`

- 기본 한 줄, 본문 14~16px, 짙은 글자, 최소 여백. 긴 품명은 펼침/원문 팝업으로 전체 확인.
- 수량 중앙/금액 정렬 일관화, 행 hover·선택 강조, 고정 품목열, 가로 스크롤.
- 우측 이슈는 선택 행과 연결하고 같은 품명을 긴 카드로 반복하지 않는다.
- `확인 필요만` 필터, 클릭 시 해당 행 이동. 숫자 수정 후 차이 즉시 재계산.
- 특이사항 복사 창: 품목·부족/초과 수량·단위·사유만 카톡에 붙여넣기 가능.
- 원본 미인식은 빈칸/확인필요. 명시 0과 구분한다.
- Tab/Shift+Tab, Enter, Escape, 후보 방향키, 모달 초점 유지/복귀를 지원한다.

### 중량·가격 검증

GW, CW, 운송비, 문서비, 통화, 환율 종류/기준일, 통관·국내운송·기타비용을 분리한다.
인식값과 수정값을 동시에 보며 수정 사유를 기록한다. 근거 클릭은 PDF 페이지/좌표 또는 엑셀 셀로 이동.
OCR 좌표 추정은 점선·추정 표시. 실제 일치 구간만 확정 하이라이트한다.
CW>GW는 정상 가능하며 오류로 뒤집지 않는다. GW>CW는 검토 대상이지 자동 보정 대상이 아니다.

### 입고관리 및 피벗

입고 행에 원가 상태·송이/단/박스당 원가·통화·환율·공식 버전·수정시각을 표시한다.
기본 원가 단위는 명시하며 다른 단위의 가격을 같은 열에서 섞지 않는다.
피벗: 연도/세부차수/국가/품종/품목/농장/AWB/인보이스로 묶고 수량·매입액·배분비용·원가를 조회.
같은 단위 원가는 가중평균(원가총액÷해당수량), 단순합/단순평균 금지. 미완성 원가는 별도 건수 표시.
필터·화면·내보내기는 같은 데이터 계약을 사용한다. 조회자가 수량을 수정하는 기능은 추가하지 않는다.

## 5. 데이터 계약과 식별

### 문서

`documentId, revision, sourceHash, originalFileName, parserVersion, sourceLocation,
orderYear, orderWeek, country, farmKey/farmName, invoiceNo, awb, inputDate,
rawMetadata, reviewedMetadata, receiptStatus, costStatus, warehouseKey,
operationId, baselineDigest, createdBy/At, updatedBy/At`.

원본 파일은 서버 비공개 저장·권한 있는 다운로드만 허용. 원문 해시는 중복 후보 탐지이고
단독 중복 판정키가 아니다. 같은 파일의 여러 인보이스는 문서별로 구분한다.

### 문서 행

`lineId, sourceSheet/page/row/bbox, originalName, length, matchedProdKey,
matchMethod, matchConfirmedBy, boxQty, bunchQty, stemQty, outUnit, estUnit,
priceUnit, unitPrice, currency, lineAmount, sourceEvidence, note, validationIssues`.

품목은 ProdKey. 품명/국가/길이로 연결을 검증하되 표시 문자열을 PK로 쓰지 않는다.
OutQuantity/EstQuantity/Box/Bunch/Steam을 구분하며 환산근거가 없으면 저장 차단한다.
장미 길이는 품목 식별에 포함. 운송비·GW·CW 가상행은 꽃 수량 합계에서 제외한다.

### 원가 버전

`costRevisionId, documentId, warehouseKey, wdetailKey, prodKey, formulaId,
formulaVersion, formulaSourceHash/sheet/cell, inputSnapshot, exchangeRate/type/date,
currency, allocationGroupId, allocationBasis, allocationShare, componentAmounts,
costPerStem/Bunch/Box, status, approvedBy/At, supersedesRevisionId`.

`Year+Week+ProdKey`만으로 원가를 입고 한 건에 연결하지 않는다. 같은 차수·품목에 농장/인보이스가
여러 개이므로 WarehouseKey+WdetailKey가 필요하다. 재계산으로 다른 인보이스 현재본을 내리지 않는다.

### 영구 이력/DDL

문서·행·작업 상태·변경 이력을 영구 저장하고 ERP commit과 작업 성공 기록을 같은 SQL transaction에 둔다.
제안: `WebInvoiceDocument`, `WebInvoiceLine`, `WebInvoiceOperation`, `WebInvoiceHistory`,
`WebInvoiceCostRevision/Line`. 기존 웹 원가/운임 테이블 재사용 가능성은 스키마 확인 후 확정한다.
기존 두 요일분배 이력 테이블 승인은 이 신규 DDL 승인과 다르다.
2026-10-08 사용자가 웹 전용 테이블 추가 제안에 `진행.`으로 승인했다.
승인 범위는 `invoice-web-storage-v1.md`의 여섯 웹 전용 빈 테이블이며 기존 EXE/공유 SP/ERP 자료 변경은 아니다.
검토 및 격리 SQL 테스트 통과 후에만 메인이 운영에 적용한다.
파일 저장만으로 ERP commit의 원자성/영구 이력을 충족했다고 주장하지 않는다.

## 6. 주문 대비 입고 대조

업무키 = OrderYear + 세부 OrderWeek + ProdKey + 비교 단위.
활성 주문등록 수량을 사용하며 분배수량/재고수량으로 대체하지 않는다.

- 신규 반영후 = 기존 입고 + 이번 초안.
- 수정 반영후 = 기존 입고 − 수정 대상 입고 + 수정 후 초안.
- 차이 = 반영후 − 주문. 부족/초과/일치 표시. 주문 외 입고도 보존.
- 주문만 있고 파일에 없는 품목도 표시한다. 여러 행 같은 품목은 검증된 같은 단위에서 합산한다.
- 박스·단·송이 혼합 합계 금지. 대조 단위를 명시한다.
- 분할 입고 부족은 현황이며 저장 실패의 자동 근거가 아니다.
- 국가/품종 scope는 양쪽 동일. 농장별 발주 근거 없으면 차수 전체 주문 비교라고 표시.
- API 실패/누락/환산 불명은 비교불가이지 0이 아니다.
- 당시 대조 snapshot과 현재 재조회 결과를 별도 표시한다.

## 7. 원가 계산 및 기존 결과와의 관계

인보이스는 매입가격/수량의 원천이지만 환율·관세·통관비·국내운송비 모두를 항상 포함하지 않는다.
없는 비용을 AI가 생성하거나 국가명만으로 USD/공식 하나를 강제하지 않는다.
국가×품종×운송방식×유효기간별 승인 공식 버전을 적용하고 입력 부족 시 미완성 상태로 남긴다.

검증할 기존 경로:
- `lib/freightCalc.js`: 운송기준원가 계산, 국가 통화/중량·부피/관세 등.
- `lib/arrivalCostExcel.js`: 업무드라이브 결과/수식 파싱과 원가 재배분.
- `FreightCost/Detail`: 입고키 연결 스냅샷.
- `WebArrivalCostImport/Line/History`: 엑셀 기반 차수 원가 revision.

기존 원가 업로드의 연도·차수·국가 전체 SUPERSEDE는 **단일 인보이스 갱신에 그대로 호출하지 않는다**.
기존 수기값/확정 원가·손익 보고서를 보존하고 차이만 표시한다. 새 인보이스 원가의 우선순위는
명시적인 연결·승인 버전에만 부여하며 과거값 자동 대체는 하지 않는다.

가격 환산은 원문 단가기준(박스/단/송이)을 보존하고 ERP UPrice/TPrice 계약과 대조한다.
중국 TOTAL OF FLOWER가 단수인 양식을 송이수로 저장하지 않는다. CNY를 USD 필드에 그대로 넣지 않는다.
필요한 환산은 통화/환율종류/시점/근거와 함께 확인한다. 매입환율과 관세 과세환율은 별개다.
한 비용을 헤더와 가상 품목행에 중복 배분하지 않는다. 배분 합계는 원비용과 반올림 허용오차 내 일치.
마지막 행 차액 보정은 결정적인 행순서/정밀도로 기록한다. formula eval에 임의 코드 실행을 허용하지 않는다.

공식 승인 수용조건: 업무드라이브 국가·품종별 실제 결과에서 입력→셀수식→출력 추적,
현재 공식/신규 엔진 결과 대조, 누락·0·다른 통화·혼합 AWB·길이·소수량 fixture 통과.
현재 문서는 모든 국가 공식 검증 완료를 뜻하지 않는다.

## 8. 실제 입고 저장·수정 경계

EXE 확인 순서: TempWarehouseDetail → WarehouseMaster → usp_CreateWarehouse → usp_StockCalculation(year,week,0).
현행 SP/트리거와 transaction·공용 staging 소유권을 확보하기 전 새 writer를 연결하지 않는다.
웹 전용 applock은 EXE가 사용한다는 증거가 없어 동시실행 보장으로 간주하지 않는다.

서버는 한 operationId의 요청 hash를 고정하고 같은 요청 재시도는 저장 결과를 반환한다.
같은 ID 다른 내용은409, 오래된 revision/baseline은409. timeout은 `결과 확인 중` 후 상태조회만 수행한다.
새 operationId로 자동 재전송하지 않는다. 실패 시 초안 보존. 중간 실패는 전체 rollback.
다른 세션의 stock gate RUN/WAIT를 해제·인수하지 않는다.
현재/이전/다음 차수 native CheckFixSave를 공통 eligibility로 재현한다. 자동 확정해제/재확정 금지.
새 저장/수정 모두 잠금 안에서 재검사하며 PK, 범위, 매칭, 합계, 원장 readback을 검증한다.
입고 수정은 신규를 하나 더 넣는 동작이 아니다. 정확한 대상 WarehouseKey와 기존 revision을 요구한다.
원가만 수정하면 재고 재계산을 실행하지 않는다. 수량 수정 후 기존 원가는 stale 처리하고 재검토한다.

## 9. 동작별 부작용

| 동작 | 문서/감사 | Warehouse | 재고 | 원가 | Order/Shipment/Estimate/손익 |
|---|---|---|---|---|---|
| 분석·매칭·검토 | 웹 초안/매칭 이력 | 읽기 | 보존 | 미리보기 | 보존 |
| 대조·초안 저장 | 버전/대조 snapshot | 읽기 | 보존 | 초안 | 읽기/보존 |
| 신규 입고 | SQL 성공키와 원자적 기록 | native 생성 | native 검증 재계산 | 연결 버전 | 직접 쓰기 금지 |
| 입고 수량 수정 | 전후·사유·담당자 | 대상만 | 검증된 차액/재계산 | stale/새 버전 | 직접 쓰기 금지 |
| 원가 입력 수정 | 전후·공식/입력 버전 | 보존 | 보존 | 대상 새 버전 | 확정본/수기 보존 |
| 조회·피벗·출력 | 필요 시 조회 로그 | 읽기 | 보존 | 읽기 | 보존 |

입고 변경에 따른 가용재고/원가 조회 변화와 기존 견적·출고 금액 원장 변경은 구분한다.

## 10. API 제안 (아직 배포된 계약 아님)

- `POST /api/import/receipts/drafts`: 구조화 초안 저장. 서버 actor/version.
- `GET/PATCH /api/import/receipts/:id`: 조회/초안 편집, expectedRevision 필수.
- `POST /api/import/receipts/:id/preview`: SELECT 기반 대조/원가 preview, DB 쓰기 없음.
- `POST /api/import/receipts/:id/commit`: operationId, revision, digest, 확인사유. 원자적 저장.
- `GET /api/import/receipts/operations/:id`: timeout 후 상태조회.
- `POST /api/import/receipts/:id/cost-revisions`: 원가만 재검토/등록, 기존 버전 보존.

서버 검증 오류는 code/field/lineId/원문좌표/해결방법을 포함한다. 중요 code:
PRODUCT_REQUIRED, UNIT_CONVERSION_REQUIRED, CURRENCY_REQUIRED, SOURCE_YEAR_CONFLICT,
FORMULA_UNVERIFIED, COST_INPUT_REQUIRED, STALE_REVISION, DUPLICATE_INVOICE,
NATIVE_ELIGIBILITY_BLOCKED, STOCK_GATE_BUSY, ERP_WRITE_UNVERIFIED, COMMIT_RESULT_UNKNOWN.

## 11. 출시 수용 테스트

| 범위 | 필수 성공·실패 fixture |
|---|---|
| 대조 | 분할입고, 주문만 존재, 주문외품목, 수정 대상 제외, 같은 41-01의2025/2026, 단위 불일치 |
| 인식 | 중국 Excel/PDF, 장미 길이, TOTAL OF FLOWER 단수, GW/CW0/빈값, 원문 좌표 |
| 매칭 | 미매칭 수동 선택/영속, 삭제품목, 중복 정확명, 국가충돌, 재업로드 |
| 원가 | 국가·품종 실제 원가표, 다른 통화/환율, 중복운송비, 배분합계, 입력누락, 확정본 보존 |
| 저장 | native 실제 SP 격리 DB 신규/증감/rollback, EXE 동시작업, gate소유권, timeout재시도 |
| 상태 | 분석완료≠입고완료, 입고완료·원가대기, 저장실패 초안보존, stale·이력 |
| UI | 1920×1080/900/480, 겹침/잘림/스크롤/모달, 키보드, 오류·실패 알림 |

필수 전체 계약/dnSpy/manifest/write guard/build 통과 후 PR→병합→배포→실브라우저 읽기 확인.
운영 임의 입고 테스트는 하지 않는다. 정확한 대상·수량 승인 또는 격리 SQL fixture에서 검증한다.

## 12. 현재 근거와 작업 순서

2026-10-07 본 작업에서 실제 dnSpy CLI ExcelLoadingPackingList 재실행: exact name staging,
CheckFixSave, uspCreateWarehouse, 명시 SelectOrderYear/SelectOrderWeek stock계산 호출 확인.
운영 인증 GET 입고조회 2026-10-01~07:82건, 예시7593/7592 모두2026/41-02.
업무드라이브 목록에서 CHINA 해상, 40-2 NL, PREMIUM GREENS, 에콰도르, 태국, DSV 원가파일 존재 확인.
추가 원문 확인: 중국 해상/NL 파일을 인증 다운로드해 메모리에서 수식 읽기 완료.
중국 `41-1 해상 (95% 기준)`에는 95% 적재 예상단수(P7=O7×N7), 예상 운송료/단(Q7=C11/P7),
실제 입고량 기반 운송료(AK8=C11×AJ8/AH8)가 병존한다. 둘을 같은 실제 원가로 섞으면 안 된다.
사용자 확정(2026-10-07): **실제 입고량 원가가 기본값, 95% 적재 예상원가는 비교용**이다.
실제원가와 예상원가의 계산기준·입력 snapshot·차액을 분리 저장한다. 피벗/입고관리의
기본 합계·가중평균에는 실제원가만 사용하고 예상원가를 빈 실제원가의 fallback으로 쓰지 않는다.
NL `40-2`: FOB비율 G15=(F15×E15)/D6, CNF H15=F15+C11×G15/E15,
원화 J15=H15×C7, 통관비 L15=Q10×G15/E15, 원가 M15=J15+K15+L15,
단원가 O15=M15×N15, VAT포함 P15=O15×1.1. 저장된 M15=7232.03658118951.
이는 두 원본의 표본 수식 확인이며 모든 국가 공식 승인/재계산 검증은 아니다.
원본 해시: 중국 `5e9241ac85d3152b976419422d2cce6498c02346563e2dc1a637e7eace9187a7`,
NL `fc9448ed983d18f0c180b4b8e1f27c1a7ef935b2e657c429eb42f2251b836d42`.
2026-10-08 갱신: 로컬 연결설정 대신 사용자가 로그인한 SSMS에서 SELECT로 현행
SP/트리거/컬럼/인덱스와 연도별 입고 건수를 확보했다. 상세는 §15 및
`docs/diagnostics/2026-10-08-invoice-receipt-live-evidence.json` 참조.
격리 SQL에서 실제 저장·롤백·EXE 동시작업 검증은 아직 하지 않았다.

1. 본 PRD/실행 계약 + 대조 순수 엔진 및 경계 테스트부터 구현.
2. 국가별 원가 원본 수식과 현행 코드의 차이를 목록화하고 공식 fixture 확보.
3. 운영 읽기 SQL 진단 결과/격리 DB 확보, 신규 영구 저장 DDL 별도 승인.
4. 문서 저장·편집 UI/preview와 실제 writer를 분리 구현, 안전 gate 후 연결.
5. 입고관리 원가 연결·피벗·출력 → 전체 회귀/배포.

각 단계 상태를 작업 MD에 갱신한다. 1단계 완료를 통합 기능 배포 완료라고 보고하지 않는다.

## 13. 구현 기준 ledger

| 기준 | 권위 원천 | 모든 사용처 | 미확인 시 |
|---|---|---|---|
| 연도·차수 | 명시 선택+원본 연도+DB | 대조/preview/write/readback | 추정하지 않고 차단 |
| 품목·단위 | Product 및 원본 검증 | 매칭/대조/환산/원가 | 비교불가 |
| 주문량 | 활성 주문등록, 동일 scope | 대조·이슈복사 | 조회실패≠0 |
| 입고량 | WarehouseMaster/Detail | 대조/수정 제외분/등록후확인 | 읽기 실패 차단 |
| 신규/수정 | document 연결 WarehouseKey | preview와 commit 동일 정책 | 대상 불명 수정금지 |
| 단가·통화 | 원본 가격단위/통화+native SP | preview/write/cost | USD/송이당 임의 fallback금지 |
| 공식 | 원본 수식+승인 버전 | preview/저장/pivot | 미검증 원가 |
| GW/CW | 검토된 원문+수정 이력 | 헤더/원가/입고조회 | null 유지 |
| 확정 eligibility | 실제 CheckFixSave/SP | 상태/preflight/transaction | 저장 불가 |
| actor/revision | 서버 인증/영구 DB버전 | 초안/매칭/commit/감사 |403/409 |
| 결과 상태 | DB operation/readback | 버튼/timeout복구/알림 | 결과 확인 중 |

1차 순수 대조 구현의 입력은 전체 선택 문서의 최종 행 집합이다. 수정 문서에서 행을 빼면 해당
입고분은 대조상 제거된 것으로 계산한다. 향후 PATCH의 누락 필드를 삭제로 해석하지 않는다.
같은 품목의 혼합 단위는 자동 환산하지 않고 각 단위 행/합계를 유지하며 단위 충돌을 표시한다.

## 14. 독립 검토 보완 (2026-10-07)

- 중복 업무키: 공급 농장키+원본 인보이스번호+인보이스 발행연도. 번호는 trim/NFC만 적용하고
  구두점을 제거해 다른 번호를 합치지 않는다. 번호 누락은 초안만 저장하며 등록 전에 공급자
  기준 식별자를 확정한다. 차수 변경으로 중복을 우회하지 않는다. 분할입고는 같은 문서의
  receiptPartId, 수정은 기존 WarehouseKey를 지정. DB 유일 제약과 transaction 재검사를 적용한다.
- transportMode(AIR/SEA/OTHER), invoiceDate, formulaEffectiveDate/원천을 문서에 추가.
  공식 기본 유효일은 확인한 실제 입고일. 국가/품종/운송/날짜에 맞는 승인 공식이 하나여야 한다.
  원가 승인 시 버전을 고정하며 새 공식으로 과거 확정 결과를 자동 재계산하지 않는다.
- 운임 비용키는 공급자+비용전표번호+항목+통화. 같은 AWB/컨테이너 공동비용은 allocationGroupId에
  한 번 등록. 구성원과 분모 snapshot을 고정한다. 중간 배분8자리 이상, 최종 통화 minor unit으로
  원비용 합계를 대조하고 반올림 잔여는 stable lineId순 마지막 적격 행에 기록한다.
  구성원 변경은 그룹 원가 전체 stale, 명시 재승인 전 확정값 보존.
- 피벗 가중평균의 분자/분모는 승인된 동일 단위·통화·VAT기준 행만 포함한다.
  미완성/stale 원가의 금액과 대응수량은 모두 제외하고 미산정 수량을 별도 표시한다.
- lineId↔WdetailKey는 저장 readback으로 연결한다. native 동일품목 병합 여부를 확인하고
  병합 시 원문행 기여수량/금액 연결을 보존한다. ProdKey만으로 TOP1 연결 금지.
  품목·수량·가격·통화·환산근거·배분그룹 변경은 모두 관련 원가를 stale로 만든다.
- 추가 fixture: 다른 operationId 동시 중복, 한 AWB 두 인보이스 운임, 미산정 원가 피벗,
  동일 ProdKey 복수가격행, 수정 후 상세키 연결.

## 15. 운영 SQL 읽기 검증과 구현 차단 조건 (2026-10-08)

사용자 로그인 SSMS에서 SELECT만 실행했다. VIEW DEFINITION=1. 입고 등록, 채번 SP 실행,
stock 계산, 확정 변경, 임시행 삭제, 잠금 해제, DDL은 수행하지 않았다.
UI가 원문의 줄바꿈을 정규화하므로 진단 JSON의 SQL은 재배포용 스크립트가 아니다.

| 확인한 사실 | 구현 영향 |
|---|---|
| WarehouseMaster.WarehouseKey는 NOT NULL, 비 identity, 기본값 없음. Master 트리거도 조회되지 않음 | 현재 웹 POST가 키를 생략하는 INSERT는 실제 스키마와 불일치. EXE의 GetNextKey 경로를 명시 구현해야 함 |
| EXE MakeTempTable은 GetNextKey("WarehouseKey")를 Master/Temp에 함께 기록. 실제 usp_GetNextKey는 KeyNumbering을 트랜잭션으로 증가 | MAX+1 또는 웹 임의 identity 가정 금지. 반환값/실패/중첩 롤백 검사 필요. 진단 중 채번 실행 금지 |
| usp_CreateWarehouse는 TempWarehouseDetail 전체에서 상세 INSERT, StockHistory 생성, Product.Stock 증가 | 연도·WarehouseKey·사용자 필터가 없는 공용 경로. 새 통합 writer에 바로 연결하면 안 됨 |
| 실제 staging 4행, WarehouseKey 1종이 존재 | 잔재/고아라고 단정하지 않고 보존. 전체 DELETE 및 자동 청소 금지 |
| 웹 POST는 web applock 뒤 전체 staging DELETE를 수행 | EXE는 같은 applock 참여 근거가 없음. 웹끼리만 직렬화해도 EXE 동시입고 안전성이 보장되지 않음 |
| StockCalculation은 OwnerToken V2 gate 및 해당 이후 StockMaster 연쇄 재계산 | scope/소유권/실패 롤백 검증 필수. 현재 빈 gate를 향후 저장 안전성 증거로 사용 금지 |
| 조회 당시 gate Mode=NULL, PendingCalc=0, ProtocolVersion=2 | 현재 조회 시점의 idle만 확인. 과거 busy 원인이나 재발 없음으로 해석하지 않음 |
| 입고 관련 다섯 테이블 트리거 조회에서 Product tiny-stock 정규화 트리거 1개만 반환 | 별도 트리거가 staging 소유권이나 Master 번호를 보장한다고 추정 금지 |
| FreightCostDetail.WarehouseDetailKey 존재, 34행 모두 비NULL. WebArrivalCostLine에는 WarehouseKey/WdetailKey 없음 | 기존 원가 스키마를 동일한 연결 방식으로 취급 금지. 비NULL은 참조 유효성/원가 정확성 검증이 아님 |
| WarehouseMaster 중량은 nullable decimal, 상세 수량/가격은 float | null을 0으로 바꾸지 않음. 반올림/단위/통화 fixture 필요 |

추가 확인: 실제 usp_CreateWarehouse는 UPrice/TPrice를 재계산하지 않고 복사하며,
OutUnit/EstUnit에 따라 Box/Bunch/Steam을 각각 선택한다. 중복 품명·삭제품목·NBSP와
trim 정규화는 preview/commit/실제 SP 결과를 같은 기준으로 검증한다.
ViewWarehouse는 `wm.isDeleted=0`이며 Product 삭제 조건이 없다. NULL 삭제 플래그를
활성으로 확장하는 읽기 조건을 native parity라고 주장하지 않는다.

구현 방향은 기존 EXE/공용 SP/공용 임시테이블을 변경하지 않는 웹 전용 문서·작업·이력
저장 구조를 우선 검토한다. 신규 writer는 공용 staging에 접근하지 않는 격리 경로를
설계하되, native 입고·재고 효과를 실제 격리 DB에서 대조한 뒤에만 연결한다.
직접 WarehouseDetail INSERT만으로 native 호환이 완료됐다고 간주하지 않는다.
웹 전용 저장 구조의 DDL은 §5의 별도 승인 경계를 유지한다.

출시 전 남은 필수 조건:

1. 웹 전용 신규 영구 저장 구조의 구체 DDL 검토·승인 및 적용 — 2026-10-08 완료(§16). 실제 저장 writer 연결은 아래 조건 적용.
2. native 번호 발급, eligibility, 입고/이력/재고 원자성 및 EXE 동시작업 격리 검증.
3. 신규·수정·실패·중복·timeout·같은 품목 복수가격 행 매핑 검증.
4. 국가별 실제량 원가 공식 fixture와 인보이스별 버전/원장 연결 구현.
5. UI 연결·전체 회귀·빌드·배포·1920×1080 실브라우저 검증.

이 SELECT 조사로 SQL 접근 차단은 해소됐지만, 통합 저장 기능 구현/배포가 완료된 것은 아니다.

## 16. 웹 저장 V1 운영 준비 완료 (2026-10-08)

§15는 앞선 읽기 조사 시점의 기록이다. 후속 사용자 승인에 따라 11:09:59 KST에
WebInvoiceDocument/Line/Operation/History/CostRevision/CostLine 6개 빈 테이블을
운영 nenova1_nenova에 추가했다. 동일 세션 readback은 모두0행, TranCount0,
FK7개 활성/신뢰/NO_ACTION, CHECK38개 fingerprint 일치다.
기존 공유 SP5개 지문 및 임시입고4행/checksum은 적용 전과 동일하다.
EXE·공유 SP·기존 ERP 원장 변경이나 운영 시험 INSERT는 하지 않았다.

설계·DDL·격리 SQL fixture·최종 검토 및 운영 근거는
`docs/work-sessions/2026-10-08_invoice-web-storage.md`에 기록했다.
SQL2022 compatibility130 실제 fixture 2회, ERP 회귀, 변경 쓰기 guard, 빌드가 통과했다.
이 반영은 저장 기반만 준비한 것으로 통합 입고 API/도착원가 UI가 활성화되거나
웹 애플리케이션 배포가 완료된 것은 아니다. §15의 2~5 조건은 계속 남아 있다.
