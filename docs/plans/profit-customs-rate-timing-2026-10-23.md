# 주차별 매출 과세환율 적용기간 (DB 불변)

## 구현 전 기준표

|기준|권위 근거|정책 / 소비자|
|---|---|---|
|입력일자 의미|실제 dnSpy FormWarehouseView.GetData, InputDate Caption=입력일자 (메인 에이전트 실행 확인)|입력일을 실제 수입신고일로 인증하지 않는다. 2026년28차 이후 등록 국가 일정이 입력일보다 우선|
|역사 원본|사용자 첨부26~31차 본표 R 양수59셀과 관세청 고시값 대조|기존26/27 보존,28~31 양수값만 역사 근거 추가. 공란을0/추정역사값으로 채우지 않음|
|승인 일정|26~31차 반복 패턴 및 사용자 중국 포함 자동처리 승인|콜롬비아5품종/베트남/호주 ISO 대차수주간. 네덜란드/태국/에콰도르 다음 ISO주간. 중국29차만 당주,28/30/31 및32차이후 다음주|
|범위|OrderYear+MajorWeek+Category+Currency|2026년28차부터 및 이후연도 유효1차부터. 연도/차수 누락,0,음수,소수,잘못된 ISO53주 불가. 다음주 날짜는 연도 경계 허용|
|매입 존재|WarehouseMaster/Detail의 기존 재고화 상품/양수TPrice SQL|상품 매입 가중치가 없는 카테고리는 일정만으로 현재차수 원가를 만들지 않음|
|우선순위|기존 resolveTaxableRate 및 본표 수기/확정 계약|기존 FreightCost/카테고리저장/역사/통화저장/수기/확정 우선순위 보존. 승인일정 KCS는 마지막 자동후보|
|출처|관세청 공식 환율 + 승인된 기간 추정|approved_customs_timing_estimate, estimated=true. 실제 신고일 확인으로 표시하지 않음. 동일 매입기간 FIFO/이월 허용, 추정표식 유지|
|실패|공식조회 실패/통화불일치/누락|현재환율/다른주/0원으로 대체하지 않음|

## 부작용 표

|동작|WarehouseMaster/Detail,Product|Order/Shipment/ShipmentDate/Farm/Estimate|Stock/ProductStock/StockHistory|WebProfitReport,확정revision,저장환율|
|---|---|---|---|---|
|보고서 및 근거 조회|SELECT|보존|SELECT/보존|SELECT/보존|
|KCS 날짜 선택 및 환율 계산|메모리만|보존|보존|보존, 자동저장 없음|
|배포|보존|보존|보존|code-only, migration/SQL 보정 금지|

## 사전 증거와 검증 상태

- 기준 d58da555, codex/profit-customs-rate-timing. 다른 작업트리 변경 보존.
- 메인 에이전트가 실제 `dnSpy.Console.exe --no-color -t FormWarehouseView` 실행 후 GetData OrderYear/OrderWeek/InputDate, GetDetail WarehouseDetail JOIN Product/TPrice를 확인했다. 삭제 경로 ClassWarehouseDetail.Delete→StockHistory→uspStockCalculation은 호출/변경 금지.
- 동일 기준 코드의 fresh-evidence.json은 2,975 SELECT 읽기 전용 대사. rate-timing-audit.json은 날짜점과 공식API44응답. 자료는 기존 작업트리 .verify이며 민감 원장값은 커밋하지 않는다.
- 이번 구현의 전체검사/새1~41 SQL전후/배포/브라우저 검증은 아직 미실행. 메인 에이전트 결과를 별도 기록한다.
- 메뉴/레이아웃 변경은 이 코어 담당 범위에 해당 없음. 기존 메뉴 UI 출처 설명 전파는 통합 담당.

## 통합 보호 범위

- 본표/재고단가 목록/FIFO/최근4차수 밖 이월은 같은 매입기간 환율 정책을 사용한다.
- 승인 추정은 `APPROVED_ESTIMATE` 및 sourceRefs로 유지하고 샘플 검증단가 평균에 섞지 않는다.
- 신규 개별 FreightCost 저장환율 보존 옵션은 정책 적용기간의 태국 외 국가에 한정한다.
  태국은 이전 승인된 34차 실제 매입·운임과 보고서 구매기간 환율 재구성 경로를 유지한다.
  모든 FIFO 경로가 개별 FreightCost 환율을 무조건 우선한다고 일반화하지 않는다.
- 실제 저장 도착원가 및 신규 정책의 snapshot-only 원가는 FIFO 하한 재평가로 덮지 않는다.
- 실제 신고일 미확정이라는 설명을 화면·검증 경고·환율 근거에 제공한다. 새로운 메뉴/저장 버튼 없음.
- DB 원장, 재고, 저장 환율, 확정 revision을 수정하는 경로는 추가하지 않았다.

## 검증 진행 기록

- 실제 EXE CLI 선확인 및 SELECT-only 수정 전 1~41차 기준자료 수집 완료, 관측 원천 지문 동일.
- 원본59 R/ISO연도 경계/실패·0·NaN/수기 우선/개별 저장환율/이월 추정표식 회귀 통과.
- 첫 전체 검사에서 새 계약 requiredCommands의 필수 명령 누락을 발견해 수정했다.
  수정 후 manifest150개 통과. 최종 전체 gate/build 및 수정 후1~41차 대조는 진행 중.
- 운영 배포·브라우저 스모크는 이 기록 시점에 미검증이며 완료 후 아래에 결과를 추가한다.

## 코어 회귀검사 완료 (2026-10-23)

- `__tests__/fixtures/profit-customs-rates-26-31.json`: 첨부 6원본의 파일명/SHA256/시트/R셀주소/국가품종/환율만 기록. 양수 59셀 모두 역사 환율과 일치. 고객·원장 개인정보 미포함.
- `node __tests__/profitReportCustomsRateTiming.test.cjs`: PASS. 승인 일정, 중국29차 예외, ISO53 연도 경계, 미래0차 차단, 기존 우선순위, 양수매입 없는 경우, 59원본R셀 대조.
- `node __tests__/kcsRateDateWeights.test.js`, `node __tests__/kcsRatesByCategoryWeighting.test.js`, `node __tests__/taxableExchangeRateKcs.test.js`: PASS. 공식조회는 테스트 대역이며 실네트워크/DB 실행 없음. 0/NaN/Infinity 거부, 동일 고시일 입력행 중복 표시 방지, 실패 일부평균 차단.
- `node __tests__/profitReportHistoricalCustoms.test.js`, `node __tests__/profitReportTimingIntegration.test.cjs`: PASS. 기존 22~27 통관비 원본 회귀 및 통합 provenance 검사.
- `git diff --check`: PASS. 전체 ERP gate/build/운영 비교/배포 완료를 의미하지 않으며 그 결과는 메인 기록을 따른다.

### 통합 리뷰 후 실제 입고환율 보존 보강

- 신규 국가별 자동 기간을 확대하면서 개별 AWB 실제 저장환율이 대차수 평균/추정으로 대체될 수 있는 경로를 발견했다. 신규 보고서 opt-in `preserveStoredExchangeRate`에서만 입고별 유효 `FreightCost.ExchangeRate`를 먼저 사용한다. 기존 태국 계산과 일반 피벗 호출은 그대로 유지한다.
- 공식 API 환율이 없더라도 같은 국가·통화의 정확한 AWB 저장환율은 복구 가능하며, 둘 다 없거나 범위가 다르면 빈 결과로 차단한다. 현재환율 대체 없음.
- 사용 행별 `reportRateApplied`/`reportRateEvidence`를 MAX 및 가중평균 결과에 보존해 실제 저장환율만 쓴 품목을 추정으로 표시하지 않는다. 다른 단위로 제외한 행은 근거에 섞지 않는다.
- `node __tests__/profitReportStoredRatePriority.test.cjs`: PASS. 실제 프로덕션 환율 선택 블록과 실제 집계 함수를 실행하는 DB/네트워크 없는 회귀 검사. 새 집계 파일도 계산해시 범위에 포함.

## 최종 SQL 읽기 전용 대조

- 기준코드 d58da555 및 최종 작업코드 각각1~41차 재계산 완료. 수정 전14,674 SELECT, 수정 후21,863 SELECT. 런너에서 transaction/execute/batch와 SQL 쓰기문은 차단했다.
- 독립 계산식15,058항목 불일치0, 비교가능한 전차수F→다음E 불연속0. 원장 매출/매입 입력 N/L/O/Q/S·수기값·기초/기말수량 변경0. 관측 원천지문 실행 전후/코드 전후 동일.
- 26~31첨부 원본 양수R59셀 불일치0. 결과변경은28차부터134국가품종행이며1~27차는 결과변경 없음.
- 중국 R:28차225.571799→224.22,29차223.077694→224.22,30차219.209509→218.37,31차218.365434→215.48.32차211.49,41차200.90 등32~41은 승인기간추정 표식 포함.
- 승인기간추정 환율109행의 API표식/검증경고 확인. 실제 통관 신고일 인증이나 모든 원가누락 해소를 의미하지 않는다. 태국39차GW/40차국제운임 부족에 따른 이익 보류는 그대로 유지.
- 기존 정적 계약의 InputDate우선 기대값과 함수범위를 넘어 잡힌 JavaScript메모리delete 오인을 갱신했다. 전체 gate/build/배포/운영브라우저는 이 기록시점 진행중.

### 병합 전 검증
- 최종 `verify:erp-change`의 전체 ERP계약·manifest·쓰기범위 검사가 모두 통과해 build 단계 진입. 별도로 실행한 `npm run build`도 exit0(프로덕션 webpack/130정적페이지 생성) 확인.
- `npm run test:profit-report-22-28` 및 posttest 전체 통과. 원본 계산898셀 회귀 포함. 마지막 전체 gate의 중복build와 PR CI/배포 결과는 후속 기록.
- 빌드가 생성한 data/generated 두 파일은 구현 변경과 분리해 커밋하지 않는다.
- 최종 `npm run verify:erp-change` exit0 확인. PR1258 생성 후 다른 기능PR1256이 먼저 병합되어 최신master f6c5c8d2와 병합했다. 계산코드 충돌 없음; WORK_MEMORY 양쪽 기록을 모두 보존. 병합된 HEAD는 CI와 build로 재확인한다.
