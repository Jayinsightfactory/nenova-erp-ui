# 주광 수량·요일 변경 확정 순서의 native 근거 — 2026-10-09

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
