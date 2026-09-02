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

## 품목 추가·매칭 및 ERP 현황 표시 (2026-08-25)

- 엑셀에 없던 품목도 `품종 + 품목명`을 입력해 선출고 계획에 추가할 수 있다. 수동 추가는
  `WebPreShipmentItem`에만 기록하며 `Product` 마스터나 주문·출고 원장을 생성하지 않는다.
- 수동 품목은 사용자가 전산 `ProdKey`를 명시적으로 선택한 경우에만 `매칭완료`로 표시한다.
  검색 결과가 없거나 선택하지 않은 행은 `미매칭`으로 남기고 임의의 품목·유사명·첫 번째
  후보로 대체하지 않는다. 매칭 변경은 선출고 계획의 매칭값만 바꾸며 원본 엑셀 명칭은 보존한다.
- 선택한 `OrderYear + OrderWeek + CustKey + ProdKey`에 대해 실제 분배수량과 출고일별 수량/상태를
  읽기 전용으로 함께 보여준다. 조회는 `ShipmentMaster`, `ShipmentDetail`, `ShipmentDate`의
  현재 연도·정확한 차수 키를 사용하며 전년도 동일 차수는 제외한다. 이 현황 표시와
  선출고 계획 저장은 서로의 `OrderDetail`, `ShipmentDetail`, `ShipmentDate`를 수정하지 않는다.
- 분배 행이 없으면 분배수량 `0`, 출고일 행이 없으면 출고일수량 `0`으로 표시하고
  `미분배/출고일 미지정` 상태를 명시한다. 매칭 전 행은 수량이 0이어도 `미매칭` 상태를
  유지하므로 “분배 0”과 “품목 미매칭”을 혼동하지 않는다.

## 선출고 후출고 재고 이력 조회 (2026-09-02)

- decompile: `C:\Users\USER\nenova-decompiled\Nenova\FormStockView.cs`
- 기준 메서드: `FormStockView.GetData`, StockHistory focus 조회. 차수 재고는
  `StockMaster`의 `StockKey`와 `ProductStock.Stock` 조합으로 읽는다.
- 이력 API는 `OrderYear + OrderWeek + ProdKey`로 `ProductStock`, `StockHistory`,
  `ViewWarehouse`, `ViewShipment`, `ShipmentDate`를 **SELECT-only**로 조회한다.
  `StockMaster.isFix`는 마감 표시일 뿐 스냅샷 후보를 제외하는 조건으로 사용하지 않는다.
- 정상 출고 차수를 비우면 같은 `OrderYear`에서 실제 `ProductStock` 행이 존재하는 다음
  `StockMaster.OrderWeek`를 고른다. 전년도 같은 `NN-NN` 차수는 후보에 섞지 않는다.
- `StockHistory`에는 거래처 FK가 없으므로, 수동 재고조정 여부는 품목/차수 시스템 이력으로만
  표시한다. 선출고 업체의 작업이라고 단정하거나 ERP 수량·재고·견적 원장을 변경하지 않는다.
