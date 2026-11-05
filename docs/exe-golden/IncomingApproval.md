# 입고 정정 승인 근거

2026-11-04 실제 `C:/Program Files (x86)/Wooribnc/Nenova/Nenova.exe`를 로컬 dnSpy.Console.exe로 FormShipmentDistribution 재추출. `.verify/FormShipmentDistribution.cs`의 btnSave_Click 1080행 이후 확인.

저장 순서는 ShipmentDetail의 물리 SdetailKey/ShipmentKey/ProdKey 및 환산수량/Cost/Amount/Vat → 선택 ShipmentFarm → ShipmentDate. 수량 변경시 날짜 삭제/재생성, 단가만 변경시 UpdateCost. 날짜별 금액은 `ROUND(Cost*ROUND(EstQuantity,0)/1.1,0)`과 차액 VAT. 웹은 검토한 날짜만 변경하고 기존 helper의 동일 산식을 사용한다.

농장배정 FarmKey+SdetailKey에는 WarehouseKey가 없다. 분배를 입고농장으로 자동 연결하거나 과거 농장배정을 일괄 변경할 수 없다. 고객은 ShipmentMaster.CustKey 기준. EXE 상세 CustKey=NULL 정상행 보존.

FormEstimateView.GetDetail은 ViewShipment+ViewOrder를 OrderYearWeek2+CustKey+ProdKey로 연결하고 ShipmentDate/PeriodDay 및 DetailFix=1을 확인한다. 별도 Estimate 차감 행을 일반 양수 분배의 저장소로 취급하지 않는다.

운영 SELECT 2026-11-04: 41~44차 상세1558/1412/1445/1351 전부확정, 2025 동일차수 존재. 입고7970=2026/44-01. 활성41차이후 WebProfitReportConfirm=0. 이 숫자는 표본이며 미래 데이터의 불변조건이 아니다. 운영쓰기0.

실제 격리 SQL 통합: request/submit/matching ERP 보존, A→B 양수 신규 주문+날짜 견적/상세매출 일치, 2025 동일차수 보존, 2027까지 native cascade, 중복확정, 농장-only+운송원가 연결 보존 및 명시 농장연결, 감소만, native/감사 실패와 후속음수 전체롤백, 반려/권한/CAS/0주문/원가연결 차단 PASS. `__tests__/incomingApprovalSql.test.mjs`의 실제 writer 실행. native CALC/Gate는 캡처 정의, capability 응답은 격리 fixture stub. 운영 정정 저장·EXE GUI 확인은 수행하지 않음.

일반 양수 견적은 ViewOrder와 ViewShipment 업무키+ShipmentDate/PeriodDay/DetailFix 검산, 독립 Estimate 차감은 보존. 연결 원가·확정 손익 정정은 아래 2026-11-05 확장 계약을 따른다. 배포 실브라우저 검증은 세션 기록의 최신 결과를 따른다.


## 2026-11-05 연결 원장 정정 확장

실제 dnSpy ClassWarehouseDetail의 WdetailKey UPDATE, ClassShipmentFarm의 SfarmKey UPDATE 및 FarmKey/SdetailKey/ShipmentQuantity 저장을 다시 확인했다. 기존 입고행은 명시 매핑으로 물리키를 유지하고, 과거 원가 이력이 참조하는 제외 행은 삭제하지 않고 수량을 0으로 보존한다. 농장배정은 원품목·이동 대상별 최종 합계가 수정 분배와 일치해야 한다.

운영 SELECT-only 원가 리더 검증: 7662(NL,146행),7671(CN,64행),7345(TH,19행),5560(운송원가1건). 운영 FreightCost에 통화 호환 컬럼은 없으므로 해당 선택 마이그레이션을 테스트에 강제하지 않는다. 운영 쓰기 0.

인보이스 문서·작업·원가 버전과 운송원가 활성본은 새 정정 버전을 만들며 과거 근거는 보존한다. 농장만 변경하면 원가 금액 보존을 검증한다. 확정 손익은 기존 실제 계산기를 승인 트랜잭션의 읽기로 실행하고 기존 수기값을 유지한다. 최종 검토는 동일 writer를 실행 후 rollback하여 계산값을 보여주며, 확정은 서명된 검토값과 재계산값을 대조한다. API는 외부 환율 근거를 검토 전에 확보하고 확정 트랜잭션에서는 그 근거만 재생한다.

현재 격리 검증: 기본 승인 SQL, 명시 농장배정100→80, rehearsal ERP/승인 상태 전체 복원, 비용 writer 인보이스+운송원가 감소·중간실패 전체롤백 및 단위13건 PASS. 실제 확정 손익 loader 통합·최종 배포 검증은 작업 세션 기록에 추가한다.

농장-only의 보존 대상은 출고 총수량·날짜·금액·재고·견적·손익이다. 명시 농장별 배정 A60/B40→A40/B60은 최종합계100을 보존하므로 허용한다. 개별 농장수량 multiset 불변 제한은 적용하지 않는다. 최종 전후배정표를 영업지원에 보여주고 합계99/101·타품목농장 반례는 차단한다.
