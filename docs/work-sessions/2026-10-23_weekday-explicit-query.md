# 주광 메뉴 최초 조회 버튼 (2026-10-23)

요청: 메뉴에 들어갈 때마다 오래 걸리므로 연도·차수 선택 후 조회 버튼으로 시작.

- 첫 진입은 로컬 선택 폼만 렌더링. 차수 공란, 연도 현재 연도. 입력만으로 조회하지 않음.
- 조회/Enter로 유효한 연도2000~2200, 차수1~53을 확인한 후 기존 workspace를 동적 로드·마운트. 기본 다음 차수(defaultNext) 요청은 생략하여 명시 차수 보존.
- 조회 이후 자동 최신 갱신·보관 초안 복구·기존 차수 이동/적용/견적/출력 정책 유지.
- native/DB/저장 SQL 변경 없음. 기존 FormEstimateView/FormPrintEstimate CLI 근거는 WeekdayPrintNotes.md. 변경 전 같은 2025/2026·43차 SELECT probe 재실행, 연도 분리 및 데이터 불변 확인.
- 모든 ERP 원장(OrderDetail/ShipmentDetail/ShipmentDate/ShipmentFarm/Estimate/StockHistory/ProductStock/WebProfitReport) 보존. 최초 진입은 주광 업무 요청 없음; 조회 후 기존 읽기 경로.
- 기준선 적용: 기존 _app shell, 페이지 스크롤, Tab/Enter/표준 폼, 명시 연도·차수. 쓰기 사전확인 변경은 해당 없음. 예외 없음.
- 단위 테스트: 실제 Entry SSR 렌더링에서 workspace mount/fetch 0회; 빈칸/zero/false/범위 밖 차단, 2025/43·2026/43 및 연말 경계 분리.
- Chrome 격리 실제 Entry: 43 입력 후 첫 화면 유지, Enter 후 2026/43 전달 확인. 운영 배포 검증은 후속 결과 참조.

추가 질문: 적요가 견적서관리에도 표시되는가? → 현재 구현은 주광 출력용 별도 저장이며 견적서관리/EXE 원장 적요는 변경되지 않는다고 답변. 원장 적요 연동 변경 요청은 아직 없음.

검색어: weekday-explicit-query 최초진입 조회버튼 동적로딩 적요 웹전용
