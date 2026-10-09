# 영업방 새 카톡만 자동 추가 (2026-10-09)

사용자 정정: 저장된 조회를 유지하면서 새로운 내용만 갱신한다. 10/08의 기본 자동 확인 끔 지시 중 원문 수신 부분을 대체한다.

- 저장된 사용자·연도·전체 차수의 원문·선택·전산 근거·확인 표시는 복원한다.
- 별도 수신 스캔은 KST 최근 7일을 30초마다 읽고 source/chat/message 식별값이 없는 행만 추가한다. 기존 행의 변경된 원문도 덮어쓰지 않는다.
- 3페이지 제한 뒤 다음 cursor부터 이어 읽고 실패 시 cursor를 보존한다. 완료 후 다음 주기에 현재 KST 날짜로 새 스캔을 시작한다.
- 기존 수동 조회 기간과 페이지 위치는 보존한다. 선택 또는 검토 중 수신분은 대기 목록에 저장한다.
- 새 수신 자체로 기존 SQL 이력·확인 상태를 다시 조회하지 않는다. 새 원문은 기존 확인 상태를 상속하지 않는다. 전산 이력 주기 확인은 별도 선택이다.
- 저장된 조회 기간 밖 원문의 전산 대조는 해당 기간을 명시적으로 선택하여 불러오기/대조해야 한다. 화면은 실제 저장된 대조 건수만 표시한다.

## 부작용·기준

자동 수신: GET /api/kakao/sales-feed와 브라우저 IndexedDB만 사용한다. Order*, Shipment*, ShipmentDate, ShipmentFarm, Stock*, Estimate, WebProfitReport 모두 보존한다. ERP SQL·정책·저장 API 변경이 없어 새로운 EXE 저장 순서/DB probe 대상이 없다. 기존 distribution-sales-inbox의 dnSpy 근거와 교차연도 snapshot 분리 계약을 유지한다.

검증: distributionSalesInboxRefresh(재시도·이어 읽기·자정/연도·중복/원문 보존), distributionInboxSnapshot(계정/연도/차수 분리), distributionSalesInbox 검사 통과. 전체 계약·빌드·브라우저·배포 결과는 PR에 기록한다.
