# 중국 물량표 단계 안내 기준

- 범위: 중국 페이지 UI 안내만. 네덜란드 방식의 인라인 말풍선, 대상 outline, 위치 이동, 브라우저별 끄기 저장. 기존 API/SQL/writer/ERP 적용 조건 변경 없음.
- 기준: 차수 확인→명시 조회→수량/박스 편집(패킹 REVIEW는 미매칭/분할/매칭적용 우선)→작업 저장→등록·분배 검토→확인창의 명시 저장. 클릭만으로 저장/완료 판정하지 않는다.
- saved=실제 BoardKey 존재 및 dirty=false. 완료=실제 apply 성공과 현재 연도/차수/작업본/내용 지문 동일. 변경·실패·다른 연도는 완료 아님. preview는 서버 planToken/경고 확인을 존중하며 가이드가 승인하지 않는다.
- 기본값: 미저장/알수없는 설정은 켜짐, 명시 false는 꺼짐. 중국 전용 저장키로 네덜란드와 독립. 가이드 상태는 ERP 요청에 포함하지 않는다.
- 부작용: 안내/끄기/위치 이동은 localStorage 및 DOM만 변경. Order*, Shipment*/Date/Farm/Amount/Vat/isFix, Warehouse*, Stock*, Estimate, WebProfitReport 모두 보존. 기존 명시 저장 경로는 그대로.
- 사전 근거: 설치 Nenova.exe 실제 dnSpy FormQuantityPivot ViewOrder/ViewWarehouse/ExportToXlsx 재실행. SELECT-only 2026/43-02/533/1487 Out200/확정true/금액381818/VAT38182/날짜join1/Farm0, 범위확정124행 금액13316274/VAT1331626. SQL/표시수량 산식 변경 없음.
- 메뉴 기본값: shell/페이지스크롤/표준키보드/반응형 적용, 신규메뉴/DB스키마 해당없음. 가이드가 업무를 자동실행하거나 명시 검증을 대체하지 않음.
- 검증: 순수 단계 positive/near-miss/0/false/실패/교차연도, ERP gates/build, 격리 실브라우저, 배포 후 운영 읽기 확인 예정.
- 추가 확인 답변: 작업 초기화는 미저장 변경만 버리고 마지막 작업 저장본 복구. 중국은 선택 BoardKey GET 및 연도/차수 검증, 네덜란드는 마지막 명시 저장/불러온 id를 기존 GET restore로 복구. 저장본 없음/조회실패는 입력 유지. 저장 이력/공용 매칭/품목 비고/ERP 원장 롤백 없음. 확인창 취소 시 그대로 유지.
