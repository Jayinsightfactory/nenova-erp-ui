# 출고내역서 — 2026-11-10 실제 EXE 및 read-only 근거

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
