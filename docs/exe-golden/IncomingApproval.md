# 입고 정정 승인 근거

2026-11-04 실제 `C:/Program Files (x86)/Wooribnc/Nenova/Nenova.exe`를 로컬 dnSpy.Console.exe로 FormShipmentDistribution 재추출. `.verify/FormShipmentDistribution.cs`의 btnSave_Click 1080행 이후 확인.

저장 순서는 ShipmentDetail의 물리 SdetailKey/ShipmentKey/ProdKey 및 환산수량/Cost/Amount/Vat → 선택 ShipmentFarm → ShipmentDate. 수량 변경시 날짜 삭제/재생성, 단가만 변경시 UpdateCost. 날짜별 금액은 `ROUND(Cost*ROUND(EstQuantity,0)/1.1,0)`과 차액 VAT. 웹은 검토한 날짜만 변경하고 기존 helper의 동일 산식을 사용한다.

농장배정 FarmKey+SdetailKey에는 WarehouseKey가 없다. 분배를 입고농장으로 자동 연결하거나 과거 농장배정을 일괄 변경할 수 없다. 고객은 ShipmentMaster.CustKey 기준. EXE 상세 CustKey=NULL 정상행 보존.

FormEstimateView.GetDetail은 ViewShipment+ViewOrder를 OrderYearWeek2+CustKey+ProdKey로 연결하고 ShipmentDate/PeriodDay 및 DetailFix=1을 확인한다. 별도 Estimate 차감 행을 일반 양수 분배의 저장소로 취급하지 않는다.

운영 SELECT 2026-11-04: 41~44차 상세1558/1412/1445/1351 전부확정, 2025 동일차수 존재. 입고7970=2026/44-01. 활성41차이후 WebProfitReportConfirm=0. 이 숫자는 표본이며 미래 데이터의 불변조건이 아니다. 운영쓰기0.

실제 격리 SQL 통합: request/submit/matching ERP 보존, A→B 양수 신규 주문+날짜 견적/상세매출 일치, 2025 동일차수 보존, 2027까지 native cascade, 중복확정, 농장-only+운송원가 연결 보존 및 명시 농장연결, 감소만, native/감사 실패와 후속음수 전체롤백, 반려/권한/CAS/0주문/원가연결 차단 PASS. `__tests__/incomingApprovalSql.test.mjs`의 실제 writer 실행. native CALC/Gate는 캡처 정의, capability 응답은 격리 fixture stub. 운영 정정 저장·EXE GUI 확인은 수행하지 않음.

일반 양수 견적은 ViewOrder와 ViewShipment 업무키+ShipmentDate/PeriodDay/DetailFix 검산, 독립 Estimate 차감은 보존. 연결된 확정 손익/원가 revision 재작성은 이 writer 지원 범위 밖이며 차단한다. 배포 실브라우저 검증은 세션 기록의 최신 결과를 따른다.
