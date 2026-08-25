# 선출고 관리 — nenova.exe 격리 근거

## 기능 경계

선출고 관리는 주광의 실제 출고일과 견적 이동 차수를 별도로 비교하기 위한 웹 전용 계획 원장이다. 엑셀 업로드와 셀 수정은 `WebPreShipmentPlan`, `WebPreShipmentItem`, `WebPreShipmentSchedule`, `WebPreShipmentAllocation`만 변경한다. `OrderMaster`, `OrderDetail`, `ShipmentMaster`, `ShipmentDetail`, `ShipmentDate`, `ShipmentFarm`, `StockMaster`, `ProductStock`, `Estimate`, `WebProfitReport`는 모두 보존한다.

## dnSpy/CLI 기준

- 원본: `C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe`
- decompile: `C:\Users\USER\nenova-decompiled\Nenova\FormOrderAdd.cs`
- CLI: `dnSpy.Console.exe --no-color -t FormOrderAdd "C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe"`
- `CheckExistingOrder`: 실제 ERP 주문은 `CustKey + OrderYear + OrderWeek + isDeleted=0`으로 찾는다.
- `btnSave_Click`: 실제 주문등록은 `OrderMaster/OrderDetail/OrderHistory`를 저장하고 필요 시 `ShipmentMaster`를 준비한다.
- `GetDataProduct`: 실제 ERP 품목·주문 수량을 `Product`와 `OrderDetail`에서 읽는다.

선출고 화면은 위 메서드를 호출하거나 흉내 내지 않는다. 사용자가 입력하는 “견적 이동 차수”는 비교용 값이며 `Estimate`나 출고 원장에 자동 적용되지 않는다.

## 부작용 표

| 동작 | WebPreShipment* | Order/Shipment | ShipmentDate/Farm | Stock | Estimate/Profit |
|---|---|---|---|---|---|
| 주광 엑셀 업로드 | 계획·품목·출고열·배분 생성 | 보존 | 보존 | 보존 | 보존 |
| 출고일/견적차수 수정 | Schedule 수정 | 보존 | 보존 | 보존 | 보존 |
| 품목별 수량 입력 | Allocation 수정 | 보존 | 보존 | 보존 | 보존 |

## 기준값

- 원본 시트: 공백을 제거한 이름이 `주광카장수알숫자차`와 정확히 일치하는 시트만 사용한다.
- `(2)` 사본과 `고정 수량` 시트는 자동 선택에서 제외한다.
- 등록 업무키는 `OrderYear + MajorWeek + PlanKey`; 전년도 같은 차수는 별도 계획이다.
- 수량 0은 유효한 명시값이며 기본값으로 덮지 않는다.
