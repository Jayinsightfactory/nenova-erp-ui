# 신라 판매요청 추가분 대조

요청: 안시리움 1송이가 판매요청으로 추가되었는지 확인하고 근거가 있으면 정상 추가분으로 표시.

사전 근거: 실제 설치 EXE를 dnSpy CLI `-t ClassEstimate`로 실행. Insert/Update는 Estimate의 유형·일자·품목·단위·수량·Cost·Amount·Vat·ShipmentKey를 저장하며 ShipmentDetail 수량을 변경하지 않는다.
운영 SELECT: Estimate10040, 신라호텔446, 2026/40-01, 품목181, 판매요청(FEE03-KR0770), 2026-10-12, 1송이, Cost9130, 공급가8300, 상위확정. 분배40-02의520/4316000 + 요청1/8300 = Excel40/SRM10월7일521/4324300.

기준 ledger:
- API가 선택연도·활성 신라호텔 Customer→ShipmentMaster로 Estimate를 새로 읽는다. 클라이언트 요청을 근거로 신뢰하지 않는다.
- CodeInfo Category=EstimateType의 정확한 판매요청 유형만. 단위는 기존 EA/스팀/송이 동등 규칙만.
- 분배후보와 같은 연도·상위거래처·대차수·품목·단위의 판매요청 전체를 표시한다. 수치에 맞는 일부 행만 선택하지 않는다.
- 정상 추가분: 유일 분배/입고 후보, 모든 관련 요청 양수·유효일자(원본±14일)·확정상위, 분배상위/상세확정, 분배+전체요청의 수량·공급금액·단가별수량이 Excel/SRM과 일치해야 한다. 다른 연도/차수/업체/품목/단위, 음수, 일자 누락, 단가차이, 복수후보, 같은 요청의 중복소비는 정상 아님.
- 판매요청과 입고일이 달라도 실제 저장일 모두 표시. 정상은 판매요청으로 차이가 설명된다는 의미이며 공통 신라전표 연결을 새로 입증한 것은 아님.
- 분배 원본차이와 판매요청 포함 잔여차이를 별도로 표시. 월 귀속은 SRM 실제입고월 그대로.

부작용 표: prepare/compare는 Estimate/CodeInfo 및 기존 분배/손익 SELECT만. Order*, ShipmentDetail/Date/Farm, Estimate, Stock*, WebProfitReport 모두 보존. 견적 발행/재고계산/확정 변경 없음.
메뉴 기준: 기존 shell/페이지스크롤/검색/표/키보드 details 적용. 원장쓰기 승인·신규모달·메뉴등록은 해당 없음.

추가 근거: 실제 FormEstimateView CLI 실행, GetDetail의 Estimate→ShipmentMaster/CodeInfo 및 raw OrderYearWeek 대차수 합산 확인. 운영10040의 raw202640, PeriodDay 일자조인1건. 40-02/181 ViewOrder1행/ViewShipment1행520/4316000, ShipmentDate1행520/4316000, ShipmentFarm0행, DetailFix1/Vat431600 확인. 원장읽기만 수행.
실제 새 loader+정책 probe에서 salesExplained=true, 합계521/4324300, 원본차이-1/-8300 확인. 20개 테스트 통과(판매요청 정상·연도/업체/품목/단위/차수/확정/일자/가격/누락/음수/중복 반례 포함).
