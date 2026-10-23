# 네덜란드 명시 조회 / 칼라 입력창

- 최신 사용자 기준: 초기 진입·연도/차수 선택은 목록/기본값만 준비. 물량 조회는 불러오기 버튼으로만 실행. 업로드/저장본 복원과 분배 writer는 보존.
- 칼라는 prompt/confirm 대신 페이지 dialog에서 입력, 전체 비고 변경 전후 표시 후 저장. 취소/Escape 무쓰기, 저장 중 중복·닫기 차단, 실패 입력 보존. 기존 CAS POST 재사용.
- 부작용: 선택/조회/창 열기/취소는 모든 ERP 원장 보존. 칼라 저장만 기존 product-color 계약의 Product.Descr/audit 변경. Order/Shipment/Stock/Estimate/WebProfitReport 보존.
- 실제 dnSpy ClassProduct Descr 재확인. 동일 SELECT-only schema/trigger probe 재실행. SQL/API 변경 없음, 기존 교차연도 저장 fixture 유지.
- 기준선: 키보드/초점복귀 적용, shell/스크롤 보존, 새 메뉴 해당 없음. 운영 시험 쓰기 없음.
