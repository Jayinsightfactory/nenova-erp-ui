# 입고 정정 승인 근거

## 2026-11-09 영향 차수 분배 검토·확정 상태 복원

실제 로컬 dnSpy로 FormShipmentDistribution/ ClassShipmentDetail 재추출. btnFix_Click(910), btnFixCancel_Click(981)은 국가품종 단위 usp_ShipmentFix/Cancel 뒤 native 재계산을 수행한다. ClassShipmentDetail.Update(313)는 물리 상세키에 isFix를 포함한다. 운영 SELECT로 SP 두 개와 상세 트리거를 확인했다. SP는 범주 전체 상세/헤더·Product.Stock/StockHistory를 바꾸므로 입고정정의 선택행 경로에서 호출하지 않는다. 기존 receipt gate 및 locked business scope 아래 기존 확정 상세만 0→값/날짜 저장→1 복원하며, 헤더·미확정 원본은 유지한다. 기존 signed delta와 native cascade를 사용하여 Product.Stock을 중복 차감하지 않는다. 전체 차수 SP와 동일 경로라고 간주하지 않는다.

운영 읽기 표본7662/2026/41-02/ProdKey22: 2026/41~45 상세9·출고일9·견적조인(DetailFix=1)9, 농장배정0, 2025 동일품목차수5, 45 활성손익확정0. 실제 45-01 입고→45-03 분배 표본은 없어 격리 SQL에서 별도로 검증했다. 운영 원장쓰기0.

실제 writer 격리 SQL: 45-01 입고100→90/45-03 분배100→90, fixed/unfixed 각각 저장 순간 isFix=0 확인, 최종 원래 상태 유지, Product.Stock=입고−10+확정분배감소10(미확정이면 입고−10만), 날짜합90/공급가9000/VAT900, 2025 동일45-03·독립 Estimate/WebProfitReport 보존. 날짜 UPDATE 중간실패 후 전체원상복구 및 기존 후속연도 cascade/부족 명시동의·late audit rollback 회귀 PASS. 운영 승인 저장은 수행하지 않았다.

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

2026-11-05 실제 dnSpy FormStockAdd.btnSave_Click (.verify/FormStockAdd.cs:104) 확인: 현재 Product.Stock 조회 → StockHistory BeforeValue/AfterValue 차액 기록 → Product.Stock 갱신 → native 재계산. 운영 CodeInfo StockType/재고조정 정확1행 SELECT 확인, 운영쓰기0. 승인 경로는 native 부족발생기간별 최소증분을 명시검토한 뒤 같은 트랜잭션으로 이력·재계산·원가손익·감사를 저장하며 실패시 전부롤백한다. 격리SQL 2027/01만5조정 및2026/2025보존 PASS.

2026-11-05 예약 회귀 보완: 입고 100→70, 기존 미확정 분배 80 유지(매칭 수정 없음)도 가용재고 부족 10으로 제안한다. native가 산출한 영향 품목의 각 후속 StockMaster 차수에서 같은 연도·대차수의 01부터 해당 세부차수까지 DetailFix=0 분배를 누적하여 차감한다. 따라서 41-02 정정에서도 41-01 예약은 41-02 검증에 포함하고 과거 41-01 원장은 수정하지 않는다. 기존 예약의 StockMaster 기준 누락·중복은 보정 금지. 농장명만 정정하여 재고 변화가 없는 경우는 이 검증·조정 범위를 늘리지 않는다. __tests__/incomingApprovalSql.test.mjs 실제 SQL 회귀: 부족 10 미동의 차단 → 명시 동의 후 해당 차수 재고조정 10 → native 재고 80/기존 미확정 분배 80 보존 PASS. 전체 fixture는 rollbackOnly로 원상 보존하며 운영 쓰기 0.

## 2026-11-05 수입부 직접행 수정·문제 중심 검토

실제 로컬 EXE의 ClassWarehouseDetail/FormShipmentDistribution을 새 작업트리에서 다시 추출했다. WdetailKey 기준 입고행 보존, 출고 Detail→Farm→Date 저장 순서는 그대로다. 운영 연결 원가 SELECT-only7662/7671/7345/5560 리더 PASS(쓰기0). 기존 원자 writer 및 native 재계산을 재사용하며 UI의 내부 준비 절차를 자동화한다.

직접 편집은 기존 농장/입고 범위와 SourceWdetailKey를 검증하고 조회 당시 sourceDigest를 preview/create/최종확정의 공통 readFacts에서 다시 비교한다. 농장변경 외 농장보존, 수량-only의 품목/단가/포장기준 보존 및 수량·총액 비례검증을 추가했다. 새로운 품목의 원가·중량은 추정하지 않고 영업지원 문제로 표시한다.

financial.prepared는 기존 근거의 계산 준비이며 사람의 acknowledged를 자동 생성하지 않는다. 최종 ERP 반영은 기존 signed preview와 영업지원 confirmed를 요구한다. 부족재고 동의는 자동 준비하지 않는다. 실제 격리SQL에서 prepared/acknowledged=false의 명시확정 및 전체rollback/재시도, confirmed=false 원장불변, 다른행 변경 뒤 오래된 sourceDigest 차단을 검증했다. 기존 교차연도·견적/매출·원가/확정손익 검증도 PASS. 최종 빌드/가이드/배포는 이번 세션 기록을 따른다.
