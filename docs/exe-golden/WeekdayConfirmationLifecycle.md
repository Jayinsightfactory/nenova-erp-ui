# 주광 수량·요일 변경 확정 순서의 native 근거 — 2026-10-09

## 2026-10-22 실제 운영 FIX 판정 정정

설치 EXE FormShipmentDistribution을 dnSpy.Console.exe로 새 추출(exit0). btnFix_Click의 uspShipmentFix 성공 후 uspStockCalculation 호출(추출 942/947행), 취소도 같은 순서(995/1000행). 운영 OBJECT_DEFINITION으로 usp_ShipmentFix/usp_StockCalculation을 읽기 전용 확인했다.

FIX의 부족 판정은 Product.Stock이 아닌 `직전 StockMaster의 ProductStock + 선택 연도/차수 ViewWarehouse - DetailFix=1 ViewShipment + CodeInfo StockType 조정 - 이번 확정량`이다. Product.Stock은 그 후 실제 확정량만 차감하며 CALC는 ProductStock만 재계산한다. 기존 주광 Product.Stock 사전/사후 음수 차단은 이 근거와 달라 normal lifecycle에 한해 차수 검산으로 교체한다. 웹의 소수 셋째자리 부족 차단 및 후속연도 음수 rollback은 유지한다. 기존 누적 현재고를 맞추기 위한 증액·재고조정은 하지 않는다.

운영 읽기 확인: 43-01 미확정 당시 Mondial White60의 Product.Stock220 대 차수검산430, Ocean Song50은60 대70, Shimmer60은0 대10. 10월 StockHistory의 이전 After→다음 Before 단절은 이 5품목(플라야2종 포함)에서0건. 누적 차이는 이번 주광 실패 전부터 있었으며, 43-02 입고도 누적 현재고에 이미 반영되는 반면 차수 검산에는 해당 차수만 반영된다. 최초 역사적 차이 발생 행은 이번 조사에서 확정하지 않았다. 이를 특정 실패 요청의 품목 증거로 과장하지 않는다(실패 요청본문 미보관).

격리 MSSQL fixture: 현재고0/차수재고충분 날짜이동 확정 성공, 현재고는 보충 없이 native25 차감; 실제 차수부족 차단; 교차세부차수/연도, 실패 단계별 전체 rollback, 날짜 저장→실제 ALLOCATION 출력 SQL→HTML 검증. 운영 업무값 쓰기 없음.

## 새 추출 및 읽기 전용 확인
설치된 `C:/Program Files (x86)/Wooribnc/Nenova/Nenova.exe`에서 dnSpy.Console.exe --no-color -t FormShipmentDistribution, FormEstimateView, FormShipmentView, ClassShipmentDate를 새로 추출했다(모두 exit0). FormEstimate라는 타입은 없어 첫 시도 실패 후 실제 FormEstimateView로 정정했다.
Ignored `output/early-shipment-integration/fix-cycle-*.txt`와 운영 SELECT-only fix-cycle-probe.jsonl/downstream.jsonl에 원본을 보관한다. 스키마39열, PeriodDay21행, 선택한 주광 업무키 출고7행, 스냅샷15행, CodeInfo StockType8행, 실제 SP3개 정의를 확인했다. 운영 DB를 수정하지 않았다.

## 메서드와 SP
- FormShipmentDistribution.btnFixCancel_Click: CheckFixCancel→uspShipmentFixCancel→uspStockCalculation→화면 재조회.
- usp_ShipmentFixCancel: 확정 상세/마스터 해제, Product.Stock에 기존 OutQuantity 반환, StockHistory ChangeType=출고/ColumName=수량/Descr=출고확정 취소.
- usp_ShipmentFix: 날짜수량 합계와 상세수량 일치 및 재고 검사 후 상세확정, Product.Stock에서 OutQuantity 차감, StockHistory Descr=출고확정. SP 범위는 OrderYear+OrderWeek+CountryFlower의 모든 업체로 주광의 단일 상세 변경에 직접 호출할 수 없다.
- usp_StockCalculation: 선택 업무차수 이후 현재·후속연도 ProductStock 연쇄 재계산. 실제 CodeInfo StockType에 해당하는 StockHistory 증감만 재고조정으로 포함. 출고확정 StockHistory를 재고조정으로 중복 합산하지 않는다.
- ClassShipmentDate.Insert: ShipmentQuantity, EstQuantity, Cost, Amount, Vat, SdetailKey 저장. Update는 견적수량·금액·세금·비고를 바꾸고 출고수량은 보존. UpdateCost는 상세키의 날짜 단가·세금 재계산.
- FormEstimateView.btnSave_Click: 품목별 견적수량 합계가 TotalQuantity와 다르면 저장 거부. ClassShipmentDate.Update를 transaction으로 저장한다. btnPrint_Click는 선택 업체의 GetPrintDetail로 인쇄자료를 읽는다.

## 선택 상세 구현의 허용 차이
사용자가 선택한 상세 업무키만 해제/재확정한다. 범위는 SdetailKey와 잠긴 Master OrderYear/OrderWeek/CustKey 및 ProdKey로 재검증한다. 다른 업체·품목 isFix를 바꾸지 않는다. touched Master는 surviving 전체 자식 상세 상태로 재계산한다. native 전체 품종 SP의 범위를 복사하지 않는다. 이력·수량·확정·날짜·native 재계산·감사 UUID와 readback은 하나의 outer transaction으로 묶는다.

## 견적 downstream
Estimate/WebProfitReport 직접 쓰기 없음. 실제 저장 ShipmentDate와 DetailFix=1을 선택 날짜와 업체로 검사한다. 다른 업체의 미확정 상세는 주광 요일 출력 차단의 근거가 아니다. 주광 선택 날짜 자체의 미확정/불일치 행은 명확한 오류로 출력 차단한다. 화면 초안은 인쇄에 포함하지 않는다.

설치 EXE SHA256: 4033996D20006213BD7D7C5454396421FC18B3836CCB7F2C47B1CB8C93C1BD63.

## 2026-10-12 같은 날짜의 세부차수 정정

동일 설치 EXE를 로컬 CLI로 다시 추출했다(`ClassShipmentDate`, `FormShipmentDistribution`, exit0; ignored `outputs/subweek-*.txt`). ClassShipmentDate는 날짜가 아닌 SdetailKey에 귀속해 저장하며, FormShipmentDistribution은 선택 OrderYear/OrderWeek를 유지한다. 따라서 화면의 달력 열이 달라졌다고 기존 상세의 차수를 자동 재해석하면 안 된다.

운영 SELECT: 2026/41-01/533/359 상세94736은 확정6박스(10/11 4,10/13 2), 41-02 상세 없음. 원장 단가와 대상 CustomerProdCost가10500으로 같고 활성 주문은 각각5/3박스다. 농장 링크·Estimate·해당 WebProfitReport는 없었다. 실제 당시 입력 요청은 확인되지 않았으며 현재 코드 경로와 원장 불일치를 근거로 수정한다.

명시적 정정은 source 날짜0과 canonical target 날짜2를 기존 ALLOCATION 단일 트랜잭션에 제출한다. source의 다른 날짜, 기존 양쪽 주문수량, 단가와 총 gross를 보존하며 확정 전환 및 native 재고 재계산을 수행한다. 실제 SQL fixture가 같은 날짜37-01→37-02, source25→23/target2, 타 날짜·타 업체·2025 보존, 생성/확정 실패 rollback, UUID replay를 검증한다. 운영 보정 결과는 해당 세션 기록을 따른다.

## 2026-10-23 박스·낱개 입력의 표시/저장 정밀도
실제 설치 EXE를 dnSpy.Console로 FormShipmentDistribution 및 ClassShipmentDetail 재추출(exit0). CellValueChanged 684~767행은 카네이션 단/BunchOf1Box, 수국 송이/SteamOf1Box를 decimal로 환산한다. 그리드 N2/F2는 표시이며 ClassShipmentDetail.Insert/Update(307/313행)는 수량에 ROUND를 적용하지 않는다. 공용 헬퍼의 과거 'EXE 소수2자리 저장' 주석을 이 기능의 근거로 사용하지 않는다.

2026-10-23 SELECT probe: Product359/363/365/389/518는 15단·300송이/박스; 수국866는30,873는50,3472는16송이/박스. ShipmentDetail 수량 및 ShipmentDate.ShipmentQuantity/EstQuantity의 실제 SQL 타입은 float. 하드코딩 없이 최신 마스터를 사용한다.

주광 카네이션/수국 박스 출고의 정수 낱개 환산만 명시적으로 확장: 입력/합계 소수9자리, 물리적 낱개 정수 검산 1e-6, 화면 소수2자리 표시와 별개. 기존 ALLOCATION 업무키·트랜잭션·확정·재고 부족·금액·롤백 계약 유지. Wilson은 웹 JSON 분류 정밀도만9자리로 확장(ERP 별도출고 없음). 운영 원장/제품 마스터/재고 보정 없음.

격리 SQL fixture를 실제 float 타입으로 맞춘 시나리오에서 카네이션1단+1단, 수국1송이+1송이의 날짜합계·견적2단/2송이 검증. 전년도/타업체 보호 및 기존 실패단계 rollback도 통과. 자세한 작업/배포 결과: docs/work-sessions/2026-10-23_weekday-box-parts.md.

추가 SELECT 근거: 주광2026/41-02 카네이션363는 OutQuantity=0.0666666666666667/BunchQuantity=1/SteamQuantity=20,39-02는0.2/3/60으로 실제 저장돼 있다. Product.Stock 및 StockHistory.BeforeValue/AfterValue도 float. 신규 UI는 이 native 분수 박스 원칙을 따른다(소수9자리 전달 오차만 허용). 운영값 변경 없음.
