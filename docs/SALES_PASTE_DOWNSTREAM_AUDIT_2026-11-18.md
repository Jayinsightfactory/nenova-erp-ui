# 영업부 붙여서 주문등록 — EXE / downstream 읽기 전용 감사

- 점검일: 2026-11-18
- 점검 코드: origin/master `4cbc02924`, 격리 작업트리 `nw-cdx-sales-paste-audit`
- 운영 DB 쓰기 / 시험 주문 / 보정 / 배포: 없음.
- 결론: 식별 가능한 기존 주문에서 주문 연결 및 양수 확정출고의 견적·판매 후보 누락은 발견하지 않았다. 미래 신규 업체의 EXE 분배까지 무조건 안전하다는 판정은 불가하다.

## 실제 EXE 근거

실행 파일: `C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe`

SHA256: `FEDEA619A6E54D6CDD58802E0707DD51D06F5D46E883F53F00134E801AC62F79`

로컬 dnSpy.Console.exe의 `--no-color -t`로 FormOrderAdd, FormShipmentDistribution, FormEstimateView, FormSalesDefectView를 새로 역컴파일했다.

- FormOrderAdd.btnSave_Click: 같은 OrderYear + OrderWeek + CustKey의 ShipmentMaster가 없으면 빈 출고 헤더 생성. OrderYearWeek는 연도+부모차수.
- FormShipmentDistribution.GetShipmentMaster: 같은 연도·차수·업체 헤더를 조회하며 생성하지 않는다. isDeleted 필터/명시적 정렬도 없다.
- FormEstimateView: ViewShipment와 ViewOrder의 OrderYearWeek2 + CustKey + ProdKey 연결, ShipmentDate/PeriodDay 연결, DetailFix=1 및 양수 EstQuantity 조건.
- FormSalesDefectView: ViewShipment와 ViewOrder의 동일 업무키 연결 및 DetailFix=1 조건.
- 웹 판매등록 captureCurrentRows: 활성 ShipmentMaster와 연결된 0이 아닌 ShipmentDetail.OutQuantity를 수집하고, Estimate 차감행을 별도 UNION한다.

## 운영 SELECT-only 결과

식별 기준은 OrderHistory.Descr=N'영업부 붙여넣기 주문등록'이며 현재 활성 OrderMaster/OrderDetail만 포함했다. 이력이 없는 주문이나 과거 삭제된 주문까지 전수 증명한 것은 아니다. 관측치는 점검 시점의 상태이며 후속 작업에 따라 바뀔 수 있다.

| 항목 | 결과 |
|---|---:|
| 식별된 활성 주문 상세 | 276 |
| ViewOrder에 나타나지 않는 상세 | 0 |
| UserInfo에 연결되지 않는 주문 담당자 | 0 |
| 현재 출고 헤더가 전혀 없는 상세 | 0 |
| 현재 활성 출고 헤더가 없는 상세 | 0 |
| 출고 View 미존재 상세 | 64 |
| 확정 출고 상세 | 212 |
| 확정 출고의 ViewOrder 업무키 연결 누락 | 0 |
| 확정 출고의 ShipmentDate 미존재 | 0 |
| 양수 견적 날짜 조건 미충족 | 10 |
| 위 10행 중 실제 출고·견적 수량 모두 0 | 10 |
| 양수 확정 출고 | 202 |
| 양수 확정 출고의 견적 날짜 조건 누락 | 0 |
| 양수 확정 출고의 판매 수집 기본 조건 누락 | 0 |

주문만 있고 분배되지 않은 64행은 미분배 상태로 분류했다. 이 자체는 견적/매출 누락의 증거가 아니며 자동으로 출고를 만들면 안 된다. 견적 제외 10행은 39-02차 8행, 40-01차 1행, 43-01차 1행으로 모두 수량 0이었다. 견적 화면의 선택 요일/담당자, 판매 고정 스냅샷 생성 시점, 개별 불량 신고의 원장 연결까지 검증한 것은 아니다.

## 남은 위험과 계약 충돌

1. 신규 업체·차수 EXE 분배 진입 위험: pages/api/orders/index.js의 sales-paste는 my-customer 주문전용 정책으로 ShipmentMaster를 생성하지 않는다. 기존 등록 자료는 현재 헤더가 있지만, 처음 주문하는 업무키에는 EXE가 기대하는 헤더가 없을 수 있다. 기존 sales-paste-order 계약 및 UI/API 테스트가 헤더 생성을 명시적으로 금지하므로, 이 차이를 무시한 일괄 생성은 수행하지 않았다. 향후 수정은 주문전용 정책에서 '빈 헤더만 허용'할지 계약을 먼저 조정하고, 중복/삭제 헤더와 교차연도 회귀를 포함해야 한다.
2. 2026년 43-01차 식별 업체 한 곳에 활성 ShipmentMaster 2개가 존재한다. EXE 헤더 조회에 정렬이 없어 이후 저장 대상이 모호하다. 현 주문 상세 40행이 해당 범위이나, 이것만으로 40행 누락 또는 붙여넣기가 중복 원인이라고 판정하지 않는다. 헤더별 출고·날짜·견적·판매 연결과 생성 이력을 조사한 후에만 정리 가능하다.
3. 계약 문서의 stock 설명은 native recalculation 유지라고 되어 있으나 실제 API는 my-customer/sales-paste에서 재고 재계산을 생략한다. 문서와 코드가 불일치한다. 어느 쪽이 올바른지 업무 정책과 SP 부작용을 대조하기 전 재계산을 복원하지 않는다.

## 검증과 한계

통과: salesPasteOrder.test.js, salesPasteOrderUi.test.js, myCustomerOrderWritePolicy.test.js, shipmentDownstreamImpactContract.test.js (4개 테스트 파일), check-nenova-dnspy-evidence.mjs.

운영 조회는 SELECT만 실행했다. 기존 테스트 통과는 위 헤더 정책의 EXE 동등성을 증명하지 않는다. 실제 EXE GUI 저장→분배→확정→견적→판매등록 흐름, 개별 불량 등록, 고정 판매 스냅샷과 실장부 금액 대사, 재고 SP 효과, 전체 빌드는 미검증이다. 코드 변경이 없는 감사이므로 배포하지 않았다.

검색어: 영업부 붙여서 주문등록 sales-paste downstream 276 202 ShipmentMaster 43-01 빈헤더 dnSpy

후속 2026-11-18: 사용자 명시 승인으로 manual-order 및 sales-paste 빈 헤더만 준비하도록 계약을 갱신했다. 위 감사 당시의 금지 계약/코드 위험 설명은 변경 전 상태이며, 재고 재계산은 복원하지 않았다. 운영 과거 헤더 보정은 수행하지 않는다.
