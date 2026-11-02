# 주차별 매출이익 상태·버튼 표시 개선

## 범위와 금지선

- 기준: origin/master a6360410e, 전용 작업트리 nw-profit-status-toolbar.
- 통합 검증 기준: 이후 다른 세션 PR #1384의 a0dfb652d를 fast-forward로 반영했다. 해당 세션 문서/기능과 본 작업 변경을 모두 보존하며 전체 검증을 다시 수행한다.
- PR #1387 생성 후 다른 세션 PR #1385의 a428b88be를 merge로 통합 중이다. 네덜란드 원가 관련 upstream 앱 파일은 그대로 보존하고 WORK_MEMORY 양쪽 기록을 합쳤다. 통합 이후 CI/배포 확인은 별도다.
- 사용자 요청: 수익률 상태의 의미와 버튼 표현을 쉽게 구분한다. 계산식·수치·검증 서버 판정·권한·DB는 변경하지 않는다.
- 원천 미대조는 오류 확정이 아니다. 저장/확정 완료도 원가 정확성 인증이 아니다.
- backend held를 UI에서 verified로 승격하지 않는다. 원인별 설명을 추가하는 표시 전용 변경이다.
- 기존 본표·월별·엑셀·인쇄 수치와 관세 추정 표시, 수기 입력 우선순위, 확정 revision을 보존한다.

## 동결한 표시 기준

| 근거 | 주 표시 | 보조 설명·제약 |
|---|---|---|
| 계산 필수 금액이 null/nonfinite | 계산 불가 | 누락된 원가·환율·재고 항목을 표시, 0으로 대체하지 않음 |
| 동일 연도·차수·화면지문, dirty/stale/취소 보호를 통과한 실제 검증행 verified | 사용 가능 | 관측 시점 한정; 이후 원천 변경까지 보증하지 않음 |
| 명시적 추정 근거 | 추정 포함 | 미대조/전역 검증 제약을 별도로 병기; 정상·확정 인증 금지 |
| 유한 금액과 직접 오류 또는 미분류 경고 | 확인 필요 | 원문 이유 보존; 금액 존재만으로 정상화하지 않음 |
| 아직 검증 실행 안 함 | 원천 대조 전 | 오류라는 뜻 아님; 기존 저장 참고값 |
| 검증 시도 후 COVERAGE/STALE 등 | 대조 미완료 또는 재확인 필요 | 서버 held 유지, 전역 원인 상단 한 번 + 행에 제약 설명 |
| 근거가 확인된 매출·원가·재고 0 및 분모 없음 | 수익률 해당없음 | 무료 입출고 존재까지 부정하지 않음. K null 허용; 재고만 존재하거나 재고평가 미확정인 행은 제외 |

추정 속성은 검증 상태와 독립적이다. 추정이면서 필수 금액 누락/직접 오류가 있는 행도 해당 차단 근거를 숨기지 않는다. 알 수 없는 코드는 임의 정보 수준으로 내리지 않는다. 합계는 일부 행 누락을 정상 합계처럼 표시하지 않는다.

영향액은 별도 산식·단위가 확인된 값만 표시한다. 단수 차이(detail.delta)를 원화 손익 차이로 바꾸지 않는다. 외화 원문 차이도 원화로 단정하지 않는다. 근거가 없으면 `영향액 미확정`이며 임의 0원·예상 손실을 만들지 않는다.

### 사용자 추가 요구: 비어 있는 숫자와 원인을 해당 칸에서 확인

- 계산 불가 배지만 표시해서는 부족하다. 실제 null 칸에 `기초재고액 미확정`, `그외통관비 근거 부족`처럼 필드명과 이유를 읽을 수 있게 표시한다. tooltip만으로 설명하지 않는다.
- 파생 매출원가·매출이익·수익률(I/J/K)이 비면 단순히 그 값이 없다는 설명을 반복하지 않고 실제 누락 원천(E/F/H/환율 등)을 연결해 보여준다. 서버 근거로 확인되지 않은 원인을 만들어내지 않는다.
- 합계 누락은 해당 국가·품종과 원천 필드명을 명시한다. 모든 행이 실패했다거나 확인된 부분 합계가 전체 합계인 것처럼 표시하지 않는다.
- 기존 입력칸·원값·수식·엑셀 출력·핸들러는 그대로 둔다. 분모 0의 `수익률 해당없음`은 원가 근거 누락과 별도로 표현한다.
- 회귀에는 셀 자체 가시 설명, I/J/K 원인 연결, 합계의 국가·품종 설명, 키보드/비-hover 사용자 접근을 포함한다.

## 서버·클라이언트 근거

- lib/profitReportValidationGate.mjs는 전역 SCOPE/STALE/FORMULA/SQL/STOCK/COVERAGE/TOTAL_DIFF를 관련 모든 행의 held 근거로 사용한다. 이를 개별 품종 금액 오류로 반복 단정하면 안 된다.
- acceptsProfitValidationResponse의 runKey/currentKey/displayKey, 연도·차수, dirty/aborted 보호를 그대로 유지한다.
- profit-report-validation API는 명시 GET만, rawLive 원문 검산과 승인 관세 파생 live/saved 대사를 구분한다. 이번 작업은 이를 바꾸지 않는다.
- 동일 관세 정책의 승인 추정만 nonBlocking이 될 수 있는 기존 정책을 유지하며, 그 결과도 estimated이지 verified가 아니다.

## 실제 사전 읽기 검증

2026-11-02 실제 로컬 dnSpy.Console.exe --no-color -t FormStockView 로 설치된 nenova.exe를 읽었다. GetData는 StockMaster와 ProductStock을 결합하고 선택 OrderYearWeek 및 GetBeforeOrderYearWeek로 현재/이전 재고를 조회한다. 변경 프로시저를 실행하지 않았다.

2026-11-02T00:19:05Z, .verify/status-snapshot-probe.mjs로 운영 저장본만 한 번 SELECT했다. query는 SELECT만 허용, execute/batch/transaction 차단, 45초 취소 제한. 쓰기 0. 자격증명·개인정보·원시 금액을 출력/저장하지 않았다.

| 연도/차수 | 저장 버전 | 행 수 | warning | error | 대표 내용 |
|---|---:|---:|---:|---:|---|
| 2026/38 | 6 | 17 | 31 | 2 | 환율시점 추정, 음수재고, 미분류 |
| 2026/39 | 14 | 16 | 35 | 3 | 환율/사진중량 근거, 통관·포워딩 미완료 |
| 2026/43 | 1 | 17 | 34 | 2 | 환율시점 추정 33건·승인비용추정 1건, 미분류·이전 포워딩 미완료 |

세 저장본 모두 테이블/페이로드 연도·차수 일치. 원 저장본에는 templateDuty가 없다. 현재 웹의 파생 관세 overlay와 원 저장본 상태는 서로 다른 단계이므로 위 집계를 운영 화면의 최종 상태 개수로 단정하지 않는다. 이 probe는 원장 전수 대사나 수익률 정확성 인증이 아니다. 금액 null 행 개수에는 무거래의 K null도 포함될 수 있어 오류 개수로 쓰지 않는다.

추가 canonical 조회: 2026-11-02T00:21:45Z, loadWeeklyReportPayload('43','2026')를 SELECT-only 차단기로 실행했다. 최종 15 SELECT/1.881초/차단 0/쓰기 0, scope 2026/43 및 17행, templateDuty.version=2026-10-29-v1. 초기 숫자형 major 호출은 EPARAM으로 중단(쓰기 없음); 문자열 scope 재시도 및 metadata 경로 점검을 수행했다.

- 명시 rateEstimated 및 inventoryValuation.begin/end.estimated 11행. 이 속성은 row.auto가 아니라 row에 있다.
- 태국·중국: E/F/H/I/J/K 누락, 에콰도르: H/I/J/K 누락. 세 행 모두 templateDuty.status=input_required, TEMPLATE_DUTY_BASIS_MISSING. 추정 flag가 있어도 계산불가 근거가 우선한다.
- 이스라엘·뉴질랜드·일본·국내는 K만 null. 이것만으로 원가누락 또는 거래부재를 단정하지 않으며, 명시 영(0)·재고 근거 충족 시에만 수익률 해당없음 후보가 된다.
- canonical 경고는 환율시점 추정 33건, UNCLASSIFIED_DATA/PREVIOUS_FORWARDING_INCOMPLETE 각 1건, TEMPLATE_DUTY_BASIS_MISSING 3건이다. 기존 APPROVED_CUSTOMS_ESTIMATE 한 건이 원저장본과 달리 제거되어, 원저장본과 파생 표시의 서로 다른 정책 단계를 확인했다.
- 원시 금액·개인정보 출력 없이 상태/누락 열만 확인했다. 이 호출은 명시 독립 원천 검증 API 실행이나 모든 원가 확정이 아니다.

### 추가 원인 대조: 어떤 DB가 없는가 (43차, 읽기 전용)

2026-11-02T00:31:51Z 최종 원인 분기 probe는 canonical context의 15 SELECT, 2.604초, 차단/쓰기 0이다. 원시 금액을 출력하지 않고 실제 실패 조건만 검사했다. 아래는 43차 관측 근거이지 UI의 국가·차수 하드코딩 규칙이 아니다.

| 국가 | H 보류 실제 조건 | 재고 평가 영향 |
|---|---|---|
| 태국 | 38입고행 중 승인 정책에 ProdKey 없는 행 14개. 이름/국가 불일치 0. 매입·운임·통화·환율 근거는 존재 | E/F는 category_average, 연도·차수·수량·평균비용·기존 H·원 평가액 산식이 모두 일치한다. 실패는 새 H null뿐. 재고 DB 또는 평균식이 없다는 설명은 틀림 |
| 중국 | 98행 중 01/02 범위 96행: 정책 ProdKey 없음 39행, 승인된 양수규칙 15행은 AWB 운임배분 conserved=false로 freightForeign null. 매입/환율/통화 누락은 아님. 2행은 지원 반차수 밖 | E는 product_cost/average_unavailable로 현재 관세 재평가가 지원하는 category_average가 아니며 이전 H도 null. F는 평균식 조건 모두 통과하지만 새 H null. 원 수량·평가액 부재와 구별 |
| 에콰도르 | 15행 중 정책 ProdKey 없음 1행. 이름/국가·매입/운임/통화/환율 문제 없음 | E/F는 no_stock, quantity=0 예외로 유지. H→I/J/K만 보류 |

세 국가 모두 현재43 WebCustomsWeekly 행은 조회 context에서 없고, 입고행 실제 관세 스냅샷도 없다. 그러나 승인 규칙 보완 경로가 있으므로 이것만이 보류 원인이라고 단정하지 않는다. FreightCost.ExchangeRate 스냅샷이 없는 행도 보고서의 승인 시점 환율이 유효하므로 환율 누락이라고 표시하지 않는다.

별도 raw presence 확인(2026-11-02T00:35:34Z): WebCustomsWeekly에서 공백 정리한 2026년의 MajorWeek/Category별 행 수만 SELECT하고, 숫자 43 및 문자열 43 포함 near-match를 검사한 결과 0행이다. 따라서 이 시점의 2026/43은 Category 표기 차이로 context가 놓친 것이 아니라 실제 해당 차수 저장행 부재로 확인했다. 테이블 자체가 없다는 뜻은 아니다. 첫 진단 SELECT 2회는 EREQUEST로 실패했고, 별칭 정정 후 성공했다. 모두 쓰기 0. FreightCostDetail은 전체 테이블 부재가 아니라 현재 선택 입고에서 사용할 실제 관세 스냅샷 근거를 읽지 못했다는 제한된 표현을 사용한다.

정확한 원천 안내:

- 품목별 승인 관세 매칭: `data/profit-template-duty-2026.json`의 products(ProdKey·국가·품명). DB Product.TariffRate가 비었다는 의미가 아니며 자동 설정 수정 금지.
- 실제 관세 확인: 그외통관비 메뉴의 WebCustomsWeekly.Customs1/Customs2(각 _1~_3 분할합계), 도착원가 스냅샷 FreightCostDetail.TariffKRW/SteamQty. 실제 납부값을 임의 추정해서 입력하지 않는다.
- 상품 매입·운임 원문: 입고관리 WarehouseDetail.TPrice, WarehouseMaster.OrderNo(AWB), GrossWeight/ChargeableWeight/FreightRateUSD/DocFeeUSD. 중국15행은 원문 부재가 아니라 `allocateDutyFreightByAwb`의 수량·합계 보존 검사 미통과이며, 상세 불일치 금액 원인까지 이번 조사에서 확정하지 않았다.
- 재고 수량: StockMaster의 연도·차수에 연결된 ProductStock.Stock. 재고 평가 방식/평균식은 WebProfitReportSnapshot.PayloadJson의 inventoryValuation 메타이며 SQL 재고 수량과 별개다.
- 화면에서 기존 payload만으로 더 구체적인 분기를 입증할 수 없으면 확인할 원천 위치와 `누락/대사/매칭 중 정확 원인 추가 확인 필요`를 표시한다. 관측한43차 결과를 모든 차수에 복제하지 않는다.
- E/F가 관세 보류의 후속 결과이면 `관세 매칭/통관비 미확정 → 재고 재평가 보류`를 연결한다. `재평가 근거 미확인`만으로 재고 DB가 없다고 오해하게 하지 않는다.

## 사용자 동작·부작용 및 downstream

### 승인된 좁은 범위 확대: 계산 모듈의 진단 메타데이터만 추가

기존 payload의 일반 문구만으로는 입고 원문 누락과 운임 배분 대사 실패를 구별할 수 없다. 따라서 lib/profitTemplateDuty.mjs에 한해 기존 missing.push 및 revalue 실패 분기에서 표시용 진단 메타데이터를 덧붙이는 것을 허용한다. 기존 조건·산식·분기 순서·판정·금액·기존 reason 문구는 그대로 보존한다. API 호출, SQL, 원천 조회, 재계산 경로, DB 저장 변경은 금지한다.

- 관세 규칙: 정책 ProdKey 부재 / 같은 키의 국가·품명 불일치 구분.
- CNF 입력: 상품매입·운임·통화·환율 중 실제 실패 조건 표시. 운임배분 evidence.conserved=false는 원문 미입력과 구별한다.
- 재평가: method 지원 여부, 연도/차수, 수량/매입수량, 평균 customsCost/totalCost, 기존값/newH/oldH 존재, 기존 H 및 평가 산식 일치 여부 중 실제 실패 조건만 기록한다. no_stock 예외와 affected=false 경로 보존.
- 진단에 원시 비밀·개인정보를 담지 않는다. DB 필드가 직접 없음을 입증하지 못하면 부재라고 단정하지 않는다.
- 필수 financial parity 회귀: 동일 입력에서 수정 전/후 H/E/F/I/J/K, 합계, null, 상태, 기존 missing reason, 확정·수기0·무입고·관세0·혼합규칙·연도경계의 판정이 정확히 같아야 한다. 새 진단 필드만 제외한 출력과 원본 입력 불변을 비교한다. 실패 시 배포 차단.

| 동작 | 조회/표시 | 쓰기와 보존 |
|---|---|---|
| 상태 요약·행 배지·근거 펼침 | 기존 payload를 순수 표시 | DB/API 추가 호출 없음 |
| 원천 검증 버튼 | 기존 명시 GET | 저장본 refresh·원장/웹 테이블 쓰기 없음 |
| 조회/엑셀/인쇄/확정 관련 버튼 | 기존 핸들러·권한·disabled 유지 | 새 자동 저장·확정·업로드 없음 |
| 연도/차수 변경·편집·취소 | 기존 응답 무효화 | 이전 scope 결과 재사용 금지 |

OrderMaster/Detail, ShipmentMaster/Detail.OutQuantity/Amount/Vat/isFix, ShipmentDate/Farm, WarehouseMaster/Detail, Estimate, StockMaster/ProductStock/StockHistory, WebProfitReport 및 확정·계산 저장본 모두 이 작업의 쓰기 대상이 아니다. 관련 View와 EXE 노출도 변경하지 않는다.

## 메뉴·버튼 기준선과 회귀

- 기존 /sales/profit-report 메뉴/페이지를 유지한다. 새 메뉴·중첩 Layout·권한 경로를 만들지 않는다.
- 기능 그룹과 버튼 높이/간격/상태를 일관되게 하되 기존 역할·핸들러·확정 보호·loading/disabled를 보존한다.
- 브라우저 기본 세로 흐름과 표 가로 스크롤을 유지한다. 작은 고정 높이 중첩 스크롤을 추가하지 않는다.
- 실제 button, 명확한 접근성 이름, 키보드 Tab/Shift+Tab/Enter/Space, 접힘 상태 표현을 검사한다.
- 회귀: 미대조/추정/직접오류/unknown/전역COVERAGE/STALE/숫자누락/무거래/재고만 존재/합계 누락, 교차연도 같은 차수, dirty와 늦은 응답 취소.
- 배포 차단: 판정 완화, 수치·수식·API 변화, 기본 조회의 검증 자동실행, 오류 은폐, 권한/확정/disabled 회귀, 필수 계약·빌드 실패.

필수 npm run verify:erp-change, 계약/manifest/쓰기 가드/dnSpy evidence/build 및 실제 브라우저 38·39·43 상태·버튼 스모크는 부모 세션에서 수행한다. 현재 이 문서는 사전 검토 결과이며 전체 검증·배포 완료를 주장하지 않는다.

## 운영 QA 후속: 셀 원인 설명 압축

- 기준본 d61bc68c, 후속 브랜치 codex/profit-cell-cause-compact. 실제 원천 대조 후 태국 한 행이 1,000px를 넘었다. relevant FX 경고의 긴 원문이 파생 null 셀마다 반복된 표시 밀도 문제이며 계산 수정 사유가 아니다.
- 기본 셀에는 실제 최초 원인 요약과 확인할 DB 테이블/컬럼·메뉴 또는 정책 위치를 눈에 보이게 남긴다. SQL 입력 부재와 웹 규칙 미매칭·배분 실패·지원하지 않는 평가 방식을 혼동하지 않는다.
- 전체 원문과 관련 FX 경고는 키보드로 열 수 있는 세부 펼침에 보존한다. 서로 다른 차단 원인은 숨기지 않되 동일 설명을 모든 파생 셀에 장문으로 복제하지 않는다.
- 같은 운영 데스크톱 viewport·선택 컬럼에서 TH/CN/EC 각각 접힌 행 높이 180px 이하를 목표로 확인한다. 펼친 상세는 예외이며 고정 높이 잘림·작은 중첩 스크롤로 통과시키지 않는다. 원천 대조 전/후 모두 확인한다.
- 빈 값/0 구분, 수치·수식·서버 판정, 기존 버튼·권한·출력 데이터 변경0. 상태/금융 parity/버튼 회귀와 운영 스모크를 재검증한다.
- 운영 캡처 두 파일은 금융 원시값이 있어 .verify 로컬 증거로만 보관하고 Git에 포함하지 않는다. 후속 PR·검증·배포 전 완료로 판정하지 않는다.
