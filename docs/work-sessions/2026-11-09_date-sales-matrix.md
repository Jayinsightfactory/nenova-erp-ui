# 2026-11-09 출고일 매출 주차 행렬·자동완성

사용자: 카드/긴행 대신 품목×요일·날짜 표, 달력 범위를 주차별로 나누고 일별/주차별 총매출 표시. 업체 입력 즉시 후보 자동완성. 원차수 구성 90 = 30(44-1) / 60(44-2) 유지.

구현 기준표: 기본 직접범위(직전 월요일~현재 주 일요일, 14일), 범위 포함 끝날짜, 범위 첫날부터 7일 단위 분할·마지막 부분주 포함. 업체 검색은 기존 customerMatchesSearch, 선택 전 CustKey 해제, Arrow/Enter/Escape/Tab, stale 결과 덮어쓰기 없음. 달력 두달 표시/시작·끝 선택, native date 입력도 지원. 즐겨찾기 기존 계정 API·요일 기준 유지.

표: 품목 행, 주차 그룹 안 날짜/요일 열, 주차별 수량·원차수 구성/매출 열. 일별 금액과 주차별 금액 footer, 전체범위 합계. 단/박스/송이는 서로 수량합산 금지. 원문 일별 수량·금액을 재배열할 뿐 계산 수식·저장/확정 조건·SQL 변경 없음.

부작용: 검색/기간선택/조회/행렬 표시 모두 OrderMaster/Detail, ShipmentMaster/Detail.Amount/Vat/isFix, ShipmentDate/Farm, Estimate, 재고, WebProfitReport 보존. 즐겨찾기는 기존 UserFavorite API 범위만.

사전근거: 실제 dnSpy Console FormEstimateView 86774bytes 재실행. SELECT-only 기존 shipmentDateSalesSql 업체489, 2026-11-01~10: 12행/721000원, 날짜 11-02/03/10, 중복PK0. 기존 evidence EstimateShipmentDateSales.md 조건 유지. 개인정보·자격증명 출력/저장0.

검증계획: 실제 일별 fixture 월경계/연말·같은 원차수 다른연도·부분주·빈날·단위·차감·저장금액0·전후 입력불변, 브라우저 autocomplete 키보드/달력 클릭/촘촘한2주 표/가로스크롤/합계/가이드 재녹화, 필수 ERP gate/build/CI/배포/운영 SELECT-only.

검증: 공식 ERP 전체 exit0, manifest origin/master exit0, dnSpy/writeguard/가이드 PASS. 정식 build exit0. 빌드된 실제 Chrome에서도 matrix/자동완성/달력/키보드/팝업/모바일·영상재생·목차·한국어자막·다운로드 PASS. 초기 local next start는 build trace 완료 전에 시작해 prerender-manifest ENOENT로 중단했고, build exit0 확인 후 정상 재시작·재검증했다. 원장 영향0. CI/배포 미검증(후속).
