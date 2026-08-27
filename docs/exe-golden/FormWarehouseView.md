# FormWarehouseView 입고수량 조회 근거

## 2026-08-27 dnSpy CLI 확인

`dnSpy.Console.exe --no-color -t FormWarehouseView nenova.exe`를 실제 실행해 `GetDetail`을 확인했다.

- `WarehouseDetail wd`에서 `wd.ProdKey`, `wd.OutQuantity`를 읽는다.
- `Product p`와 `ProdKey`로 결합하고 `p.OutUnit`을 표시 단위로 사용한다.
- 선택한 입고 헤더는 `WarehouseMaster.OrderYear + OrderWeek` 범위다.
- 웹 붙여넣기 화면은 선택한 `OrderYear + OrderWeek + ProdKey`의 활성 `WarehouseMaster`만 대상으로 `SUM(WarehouseDetail.OutQuantity)`를 표시한다.

이는 조회 전용 보조 표시다. Warehouse/Order/Shipment/Stock/Estimate 원장을 수정하지 않는다.
