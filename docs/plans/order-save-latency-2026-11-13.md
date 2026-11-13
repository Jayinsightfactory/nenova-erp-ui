# 다품목 신규 주문 저장 지연

11월 13일 운영에서 POST /api/orders 최장 65.306초(201)를 기록했다. AppLog의 54품목 FINAL_SNAPSHOT 등록 구간은 65.167초, 첫 신규 행과 마지막 신규 행 기록 사이는 58.620초였다. 3시간 이내의 긴 등록 8건 모두 신규 상세 행을 반복해서 만들었다. 고객·직원이나 원문은 수집하지 않았다.

|동작|조건과 보존 기준|
|---|---|
|다품목 신규 주문|저장 정책 검증을 통과한 my-customer/sales-paste/order-import-final의 정규화된 고유 양수 품목과 현재수량 0에 한한다. 기존 키·삭제된 상세·동일 연도/차수 다른 활성 마스터 행은 잠금 조회 후 기존 저장으로 처리한다.|
|수량과 이력|기존 OutUnit/EstUnit 계산, 기존 admin CreateID, 실제 변경 담당자와 한 행당 OrderHistory를 유지한다. 전체가 동일 주문 트랜잭션에서 한 번에 커밋된다. 출고 헤더는 기존 분기에서만 생성한다.|
|변경 범위|OrderDetail/OrderHistory/KeyNumbering/AppLog가 기존 신규등록의 대상이다. 조회와 저장의 연도·차수·거래처·품목키는 보존한다. ShipmentDetail, ShipmentFarm, ShipmentDate, Estimate, 재고 및 확정 매출에는 쓰지 않는다.|
|저장 직후 전산 대조|OrderMaster/Detail 원본과 ViewOrder의 건수·수량을 모든 결과 행에 대해 검사한다. 하나라도 다르면 전체 롤백한다.|

실제 FormOrderAdd dnSpy CLI에서 btnSave_Click, UnitQuantity 및 OrderHistory를 확인했다. 운영 읽기 검증은 익명 동일 업무키의 원본/전산 주문 각 1행, 전산 출고 1행과 DB 호환 수준 130을 확인했다. OrderDetail, OrderHistory, KeyNumbering, AppLog 활성 트리거는 0개였다. 성능 검증은 격리 SQL에 한한다.


54개 품목을 운영 코드로 격리 SQL Server에 등록했을 때 DB 요청은 510회에서 28회, 인위적 대기 없는 두 번의 측정에서 2.19~2.86초에서 0.12~0.72초로 감소했다. 동일 주문 재실행, 동일/상이 업체 동시 저장, 타연도 보존, 단위별 수량·이력·키·전산 조회와 전체 롤백을 검사했다. 운영의 네트워크와 잠금 경합은 이 숫자에 포함되지 않는다. `scripts/verify-order-batch-sql.cjs`에서 재현할 수 있다.

이전에는 트랜잭션이 연결을 점유한 동안 AppLog에 쓰기 위해 두 번째 풀 연결을 기다렸다. 이제 작업 중 기록한 이벤트를 커밋 또는 롤백 직후 한 번에 저장하며 LogDtm에는 작업 당시의 상대 시각을 반영한다. 거래 이력은 주문과 함께 커밋한다. 느린 요청 로그의 txBegin, txQuery, txCommit은 연결 확보와 트랜잭션 시작, 트랜잭션 내 SQL, 커밋의 누적 시간을 각각 밀리초로 남긴다.
