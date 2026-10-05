# 주광 미분배 사전입력·입력만 보관 · 2026-10-05

사용자 요청: 미분배 상태에서 먼저 입력하고 나중에 분배 적용하거나, 이미 분배된 품목에도 입력만 해둘 수 있어야 한다. 일반·윌슨 입력은 browser 초안이고 명시 입력만 저장으로 사용자별 localStorage에 보관한다. 실제 분배 적용은 기존 ERP 변경 확인·사유·UUID/snapshot 경로로만 수행한다. 보관은 이 브라우저 범위이며 사용자별 격리, 새로고침 복구를 제공한다.

| 동작 | UI/브라우저 | 웹 분류 파일 | ERP/견적/재고 |
|---|---|---|---|
| 일반·Wilson 입력 | 계획 T=N+W 한 건, W 분류초안 | 보존 | 모두 보존 |
| 입력만 저장·복구 | 사용자별 검증된 초안 보관/복구 | 보존 | 모두 보존 |
| 미분배 보기 | 실제 SELECT 품목·NO_SHIPMENT 보여주기 | 보존 | 모두 보존 |
| 분류 버튼 명시 | 기존 저장분류 정책 | 해당 W만 저장 | 모두 보존 |
| 분배 적용 | 최신 조회/snapshot/사유·UUID 확인 | ERP 성공 뒤 해당 W만 | 명시 ALLOCATION 최종 수량 적용; 새 분배는 미확정 등록 |

knownEmpty는 동일업무키 SELECT행의 state NO_SHIPMENT, detailRows0,shipmentOutQuantity null,shipmentDates[] 확인 때만 사용한다. 일반 null/오류/복수단위/교차연도/중복초안을 0으로 가정하지 않는다. 보관자료는 적용용snapshot이 아니며 적용시 최신 비교를 재조회한다. OrderYear+actualOrderWeek+CustKey+ProdKey+date+unit 보존. 저장실패/손상은 성공으로 표시하지 않고 입력과 기존복구기록을 보존한다. 업로드가 다른scope초안을 없애지 않아야 한다.

실제 FormShipmentDistribution dnSpy CLI 재실행 2026-10-05: btnSave_Click/ClassShipmentDate 저장순서 확인. 동일session SELECT probe Cust533:2026/41-01 주문42품목 모두미분배,41-02 5모두미분배;40-01 주문93미분배10/출고83확정77,40-02 주문33미분배3/출고30확정27.2025동일40~42도별도로 조회해 연도구분 확인. 운영쓰기 없음. Estimate,ShipmentDetail.Amount/Vat/isFix,ShipmentDate,StockHistory,WebProfitReport는 초안·보관에서 모두보존한다.

## 최신 사용자 합의와 적용 기준

사용자는 이 페이지에서 새 분배까지 등록하며, 미리 입력한 값을 나중에 실제 분배값으로 수정하려는 목적이라고 명시했다. 입력은 추가량이 아닌 날짜별 최종량이다. 현재100에서 목표120이면20만 증가하고 같은120을 다시 적용하면 증가하지 않는다. 다른 날짜의 기존 값은 보존한다.

명시 `mode=ALLOCATION`에서만 신규/미확정 분배 저장을 허용한다. mode 생략 기존 확정수정 정책과 기존 UUID hash는 보존한다. 새 상세/새 Master는 미확정0, 기존 isFix는 보존하고 자동 확정하지 않는다. 신규 단가는 실제 EXE 조회의 `ISNULL(vs.Cost,ISNULL(CustomerProdCost.Cost,0))`를 따른다. 기존 날짜/상세 단가는 보존한다. 단가 복수행은 임의 TOP1로 선택하지 않는다. native ClassShipmentMaster.Insert와 FormShipmentDistribution.GetShipmentMaster는 연도+정확 세부차수+업체로 연결한다.

추가 읽기 전용 운영 probe: 2026/41-01 및41-02 Cust533 Master 각1개 미확정0, 2025 동일차수 각1개 확정1. 2026/41-01 품목53/59/66/69/77의 CustomerProdCost 각각1개700,359/365/389 각각1개10500. ShipmentMaster.OrderYearWeek는 writable, WebCreated 존재; OrderMaster.OrderYearWeek는 없는 환경이므로 컬럼 capability를 확인한다. 대상 ViewShipment113개 중110확정, Amount74,145,000/Vat7,414,500. 실제 저장 직전 다시 재검증한다.

| ERP 동작 | OrderDetail | Shipment* | 재고/견적 downstream |
|---|---|---|---|
| 양수 delta + 해당연도 활성 주문 있음 | 전필드 보존 | 최종 날짜/분배량으로 변경 | 미확정 확정재고효과 없음; 확정 상세 기존 stock/native cascade 유지 |
| 양수 delta + 활성 주문 없음 | 실제 양수 주문 신규;0 가짜주문 금지 | 새 Master/상세 필요시 미확정 등록 | 기존 availability 검사; Estimate/WebProfitReport 직접쓰기 없음 |
| 음수 delta | 전필드 보존 | 최종량 감소;0 상세 native purge | 확정 상태에 따른 기존 재고 반영; farm 보존(0 purge 제외) |
| 같은 목표 재적용 | 보존 | no-op | 중복 증가 없음; UUID 재생은 committed 결과만 |

Master 부재는 서버가 정확0개임을 확인한 전체 snapshot digest로 표현하고 transaction 잠금 하에 재확인한 뒤 생성한다. 중복 Master/상세/달력, 업무주 밖 날짜, 환산불명, 고객연결 오류, stale 값은 계속 차단한다. 인쇄는 기존 저장 확정본만 읽으며 신규 분배를 저장했다고 확정 견적서 완성으로 표시하지 않는다.

신규 주문 EstQuantity는 추가 CLI 근거 FormOrderAdd.UnitQuantity(false,row)/ClassOrderDetail.Insert에 따라 Product.EstUnit 기준 환산한다. 실제 양수 delta로 생성하며 기존 주문의 모든 값은 보존한다. 기존 adjust/overflow의 OutQuantity 복사는 native 근거와 다르므로 새 경로에서는 사용하지 않는다.

일반80+Wilson20처럼 기존 ERP 합계100이 그대로인 경우에는 명시 적용 확인 뒤 웹 분류만 저장한다. 다른 ERP 수량 변경과 섞인 구분값도 제출내역에 포함한다. 분류 일부 실패는 성공으로 표시하거나 초안을 지우지 않으며 같은 분류 결과만 확인한다. 사용자 변경 시 입력 저장·ERP 적용·분류/복구 쓰기 전에 auth owner 검사를 통해 기존 사용자 초안을 보존하고 쓰기를 막는다.

격리 MSSQL 실제 검사: 신규/기존 Master, 단가700/없음0, 미확정 재고 보존, 활성 주문 보존, 주문 없는 delta20 생성, CANCEL 주문 부재 보존, untouched 날짜, UUID 재생, 중복 단가 차단, 동일 목표 재적용의 금액/대표일 보존과 2025 동일차수 sentinel 보존을 실행했다. 기존 확정 재고 방향/native future 음수 rollback, exact 달력·인쇄 downstream 및 실제 lease/이력 채번 회귀도 통과했다. 운영 시험 저장은 실행하지 않는다.

필수fixture: 미분배·기분배 일반/Wilson입력, 보관/새로고침, 사용자·업체·교차연도격리, localStorage실패·손상, 업로드보존,0/미확인구분, 적용전원장무변경, 실패초안보존, pendingUUID복구우선. 기준UI1920×1080/100%,1280×800, sticky/스크롤/모달/버튼상태 검증. 필수 contract/dnSpy/manifest/write guard/build→PR/master/Cafe24/실브라우저.
