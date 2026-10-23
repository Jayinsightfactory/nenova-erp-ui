# 중국 물량표 입력 즉시 연관 후보

- 요청: 품목 선택/품목 추가/업체 추가에서 입력하면 연관 DB 항목이 바로 보여야 한다.
- 원인: 검색은 native select option만 필터링했고 목록은 닫혀 있어 결과가 바로 보이지 않았다.
- 변경: ChinaSearchSelect 공통 visible listbox, 이름/코드/단위/지역의 공백·대소문자·NFKC 정규화 및 복수 토큰 검색. 40건 표시와 전체건수 안내. 후보 클릭/방향키/Enter, Escape, IME 조합 Enter 보호. 입력 시 과거 선택 해제. 자동 추측 등록 없음.
- 적용: 품목 변경/추가, 업체 추가, 인보이스 품목 수량 분할. dialog 최초 입력창 초점.
- 부작용: 검색은 조회해 둔 active DB catalog의 로컬 필터링이다. payload/SQL writer/주문/출고날짜/견적/손익/재고 변경 없음. 직전 actual dnSpy 및 격리 SQL 감사 근거와 china-volume-distribution 계약 보존. 초기화 다중저장본 P2는 별도 미해결.
- 검증: 검색 helper 단위 및 기존 중국 편집/교차연도 분배 회귀, 필수 ERP 게이트/빌드/배포 후 UI 결과 후속 기록.
