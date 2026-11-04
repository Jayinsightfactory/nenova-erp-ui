# 불량 목록 업체 검색 및 입력 출처

- 사용자 요구: 영업 입력과 영업지원 목록 모두 업체 검색 → 업체 버튼 선택 → 해당 업체만 보기. 담당자에게 입력 출처 표시.
- 기준: 현재 조회된 권한/연도/차수 범위 안에서만 필터. CustKey 우선, 미매칭은 정규 업체명. 동명이업체 키를 합치지 않는다. 빈 검색은 전체 업체 버튼, 선택 해제는 전체 보기. 입력 편집은 원본 sourceIndex 유지.
- 입력 출처: 기존 autoSourceStateFromRow와 manualSourceConfirmed 판정 우선. 자동수집, 파일 업로드, 직접입력을 구분하며 담당자명은 실제 최초 입력자로 추정하지 않는다.
- 부작용: 검색/선택/표시 모두 WebSalesDefectDeduction/History, Order*, Shipment*, ShipmentDate, Estimate, Stock*, WebProfitReport 보존. API/SQL/권한/등록자격 변경 없음.
- 업체 변경 시 체크 해제. 전체선택/정리선택/문제해결창은 표시 업체 범위. 모든 초안 저장은 기존 전체 입력 저장 동작 유지, 화면에 안내. 신규 빈행 추가는 필터 해제해 입력을 숨기지 않는다.
- dnSpy CLI 실제 ClassEstimate 재확인: ProdKey/ShipmentKey 연결 독립 Estimate 저장 유지. 기존 FormEstimateView golden 보존.
- SELECT probe: 2026/43 활성118행29업체 현재자동표식50; 2026/44 활성121행33업체 현재자동표식22. 같은2025차수 결과0. 개인정보/원문 미출력. 과거 감사표식도 기존 판정 사용.
- 메뉴 기준: 기존 shell 유지, 검색 버튼 줄바꿈/페이지 스크롤, Tab/방향키/Enter/Escape 제공. 기존 표 내부 스크롤은 이번 범위 밖. 새 서버쓰기 없음.
