# 출고내역서 — 2026-11-10 실제 EXE 및 read-only 근거

## 2026-11-10 버튼 선택·담당자 개인 업체 즐겨찾기
실제 설치 EXE FormShipmentDistribution dnSpy CLI 재추출(.verify/buttons-dnspy.txt), 동일 생산 reader SELECT-only 재실행: 2025/2026 업체64/66, 표본품목28/29, 원본 세부차수·달력 정상. ERP SQL/writer/SP 변경0.
기준: 선택 메인차수±2를 같은 연도1..53에서 표시, 버튼 클릭→명시 해당 연도/차수 GET1회. 담당자는 기존 Customer.Manager 정확 일치, 업체는 그 차수 실제 분배 목록 안에서만 표시. 담당자/연도/차수 변경 시 미저장 보호. 이전 담당자가 새 차수에 없으면 이유와 전체 담당자 전환을 표시.
즐겨찾기는 기존 /api/favorites의 인증 UserID + PageName='shipment-statement-customers', JSON custKey만 사용한다. 이름/이전연도·차수 수량으로 후보를 보충하지 않으며 저장된 이름 대신 현재 업체명을 표시한다. 화면은 담당자별 후보 내 즐겨찾기 우선; 로그인 계정마다 개인 설정. 표시/정렬은 shipmentStatementSelection.cjs, GET 후 확인된 즐겨찾기만 표시, 변경응답불명은 GET재확인만 제공. 범용 API 또는 공유 Customer.Manager는 수정하지 않는다.
부작용: 버튼/검색은 브라우저 선택 및 기존ERP SELECT만. 별표 변경은 UserFavorite 본인 페이지 레코드만. OrderDetail/ShipmentDetail/ShipmentDate/ShipmentFarm/Estimate/WebProfitReport/재고 보존. 사용가이드는 버튼 UI로 재촬영한다.

설치본 C:/Program Files (x86)/Wooribnc/Nenova/Nenova.exe에 dnSpy.Console.exe --no-color -t FormShipmentDistribution 재실행. 비공개 추출 .verify/shipment-statement-dnspy.txt.
GetCustomerList: ViewOrder/ ViewShipment는 OrderYear+OrderWeek+CustKey+ProdKey, 날짜는 ShipmentDate와 PeriodDay exact 연결. GetShipmentMaster는 선택 연도·차수·업체 Master, btnSave_Click은 상세→농장→날짜 Delete/Insert 순서. 이 native writer를 호출하지 않는 웹 전용 예정 출고내역서를 추가한다.

실제 SELECT-only scripts/probe-shipment-statement.cjs: 2025/45-01,02 양수 활성 상세1087/272; 2026/45-01,02,03 871/391/66. 2026 native 상세CustKey NULL 265/113/1을 제외하면 안 된다. Master.CustKey로 소유 업체를 결정한다. 202645 PeriodDay는 2026-11-04~10, WeekDay4/5/6/7/1/2/3. 202545는 2025-11-05~11. ViewOrder2025/2026 1619/1480, ViewShipment1498/1365. 농장키0, 출고날짜 distinct6/7. 이 probe의 날짜JOIN 집계는 날짜행 수에 따라 금액이 중복될 수 있으므로 매출 인증값으로 사용하지 않는다. 후속 downstream 상세 독립집계로 대조한다. 운영 쓰기0.

## 기준 및 부작용
연도/메인차수는 명시 필수. 메인차수 prefix 전체 실제 세부차수, Master/Customer/Product 활성, 상세 양수, 상세 CustKey NULL 허용. 분배수량은 OutQuantity 원값. 단가는 ShipmentDetail.Cost 원값(NULL을 0으로 대체하지 않음), 같은 품목도 단가/단위가 다르면 분리. 데이터 누락을 감추는 Product.Cost/고객단가 fallback 없음.
기본요일은 업체 BaseOutDay 매핑(0수1일2월3화4목5토6금)을 초기값으로 사용, 저장된 업체 설정이 있으면 우선. 0을 누락으로 취급하지 않는다. 웹에서 변경해도 Customer.BaseOutDay 보존. 잔량은 설정된 요일로 이동, 명시 입력은 유지. 일괄출고일은 선택행의 전체수량을 지정요일로 옮기는 최종값 적용이며 미리보기 후 명시 적용한다.

|동작|Order/Shipment/Date/Farm|Stock/Estimate/Profit|웹 작성본|
|---|---|---|---|
|조회|SELECT|보존|읽기|
|요일/묶음 편집|보존|보존|브라우저 초안|
|저장|SELECT 재검증, 쓰기0|보존|원본 hash+버전 CAS, 불변revision 파일|
|엑셀|보존|보존|저장된 exact버전 조회|

실제 ERP 출고일 편집과 혼동되지 않도록 화면에 출고내역서용 예정일 명시. ShipmentDetail.Amount/Vat/isFix/ShipmentDtm, ShipmentDate, ShipmentFarm, OrderDetail, Estimate, WebProfitReport, ProductStock, StockHistory는 보존한다.
UI/preview/save/export는 lib/shipmentStatement.cjs의 동일 배분/검증 정책. SQL 범위는 lib/shipmentStatementService.js 공용 reader. 웹파일은 data/runtime/shipment-statements이고 코드배포로 삭제하지 않는다. 스키마 마이그레이션 없음.
기본값/0·누락/명시입력/원본변경/다른연도·차수/동시저장/양수·0/다른단가를 실행형 회귀로 검사한다. 실제 EXE GUI 저장은 미실시.

후속 downstream 독립 SELECT: 2025/2026 DetailFix=1 상세1498/1365, ViewOrder+Date+PeriodDay exact 견적노출1498/1365, Estimate179/174, WebProfitReport45차0행. 2026 상세독립금액369619801/Vat36961989(날짜JOIN중복집계값과구분). 실제production reader를 VM으로로딩해 SELECT-only실행: 업체64/66,표본품목28/29,2026 세부차수01·02·03포함,두연도 달력각7일. 운영쓰기0.

## 2026-11-10 선택형 묶음·원본 서식
FormShipmentDistribution 실제dnSpy 재실행 및 동일production reader SELECT:2025/2026 업체64/66·표본28/29·달력각7일. 2026/45는11-04수~11-10화,사용자화요일11-10확인과일치. 조회/SQL/ERPwriter변경0. 선택묶음과원본서식 기준·보존표는 plans/shipment-statement-template-2026-11-10.md. 원본XML정적서식만추출,실제과거업체/날짜/수량포함0.

## 2026-11-11 샘플 엑셀 표기
실제 EXE FormShipmentDistribution 재추출·동일reader 양연도SELECT(업체64/66·표본28/29) 및 Product 이름 SELECT 확인. Carnation CHINA / 돈셀 (Doncel) ↔ DisplayName 카네이션 CHINA / 돈셀 (DONCEL). 샘플 플로르 목 F3/G5, 알파 P22/Q24는 카네이션/돈셀. XLSX만 shipmentStatementLabels 순수규칙 적용, SQL/ERP/저장본·총량·단가·날짜·업무키·그룹순서 보존. 상세기준 plans/shipment-statement-labels-2026-11-11.md. UI/업무순서/영상노출 변경0.

## 2026-11-11 복수 품목 선택·국가품종 필터·운임비 표기
웹 화면 전용 변경. 국가+품종 버튼 필터는 여러 버튼을 함께 선택해 표시하며, 드래그/체크/Shift/표시품목 추가 선택은 기존 선택을 유지한다. 검색어·품목군 필터 변경도 선택 ID를 지우지 않는다. 전체 선택 해제만 명시적으로 초기화한다. 국내+왁스는 화면·엑셀 품목군에 운임비로 표시한다. source.category, CountryFlower 업무키, 원본 Product 및 저장 작성본은 유지. 사용자의 일괄출고일 적용은 기존과 같이 선택된 각 품목의 총량을 한 요일로 이동하는 웹작성본 변경만 수행한다. ERP 조회/저장 범위 변경 없음.

## 2026-11-12 엑셀 품목 표시명 직접 수정(매칭)
웹 전용. 표의 품목·규격 칸에서 바로 수정한 표시명을 ProdKey별 파일(data/runtime/shipment-statement-labels)로 저장하고 엑셀·미리보기 렌더링에만 적용한다. SQL/ERP writer/SP 변경0, 조회 SELECT·dnSpy 재추출 범위 변경0, 원본 row·작성본·sourceHash·불변 revision·총량·단가·날짜·업무키 보존. 비우면 자동 표시명(shipmentStatementLabels) 복귀. 실제 운영 화면 확인은 미실시.
