# 인보이스 다음 단계 초안 재개

- 원인: 원본 SHA256+송장 index로 문서 ID는 고정되지만 Workbench source effect가 revision=null 초안으로 records를 교체한다. 재업로드도 저장 문서 GET 없이 POST한다. 서버의 신규 전용 POST 409는 올바른 중복 보호다.
- 실제 SELECT-only: 이전 화면 문서966a9e13…는 2026/44-01 DRAFT revision1로 이미 존재. 이번 사용자 오류의 정확한 문서 ID는 별도 미제공.
- 기준: 최초 준비 시 같은 ID/hash/연도/차수의 기존 문서 GET 후 저장 버전/검토값/작업이력 재사용. 조회404만 신규. 다른 scope/권한/네트워크 오류는 신규로 취급하지 않음.
- 같은 화면의 재변환은 source baseline과 비교해 변경된 값만 병합. 사용자가 Workbench에서 수정한 값/저장 revision/rowVersion/완료 operation 보존. 충돌 시 Workbench의 명시 수정 우선. 기존 문서 재개 때는 서버 저장값 우선.
- POST는 신규, PATCH는 양수 revision+rowVersion으로 기존 낙관적 잠금 유지. concurrent409는 이해가능한 재조회 안내, 자동 덮어쓰기 금지.
- 부작용: source resume GET/화면 병합은 모든 DB 보존. 사용자 초안 저장만 기존 WebInvoice 문서/행/이력 경로. Order/Shipment/Warehouse/Stock/Estimate/WebProfitReport 모두 보존. 실제 입고 승인/writer 변경 없음.
- 실제 dnSpy ExcelLoadingPackingList InsertMaster의 CreateWarehouse→StockCalculation 순서 재확인. 이번 웹 전용 초안 재개는 해당 경로 호출 안 함.
- 검증: 신규/기존/반복변환/매칭변경/수정후PATCH/연속next/이미완료/404외조회실패/다른source·교차연도 및 버전충돌. 격리 화면과 SQL fixture 사용, 운영 쓰기 금지.
