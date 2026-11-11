# FormWarehouseView 입고수량 조회 근거

## 2026-08-27 dnSpy CLI 확인

`dnSpy.Console.exe --no-color -t FormWarehouseView nenova.exe`를 실제 실행해 `GetDetail`을 확인했다.

- `WarehouseDetail wd`에서 `wd.ProdKey`, `wd.OutQuantity`를 읽는다.
- `Product p`와 `ProdKey`로 결합하고 `p.OutUnit`을 표시 단위로 사용한다.
- 선택한 입고 헤더는 `WarehouseMaster.OrderYear + OrderWeek` 범위다.
- 웹 붙여넣기 화면은 선택한 `OrderYear + OrderWeek + ProdKey`의 활성 `WarehouseMaster`만 대상으로 `SUM(WarehouseDetail.OutQuantity)`를 표시한다.
- 입고관리 원장 목록은 동일한 헤더별 집계를 사용하며 웹 표가 읽는 `totalBox`, `totalBunch`, `totalSteam` 필드명으로 반환한다. 입고 상세 품목명은 UI에서 줄바꿈해 전체 이름을 표시하며 ERP 원장은 변경하지 않는다.

이는 조회 전용 보조 표시다. Warehouse/Order/Shipment/Stock/Estimate 원장을 수정하지 않는다.

## 2026-11-11 웹 원장삭제 권한 검사
실제 dnSpy CLI FormWarehouseView 재추출에서 btnDelete_Click → DeleteCheck → 선택 WarehouseKey의 ClassWarehouse.Delete/DeleteDetail → 상세 StockHistory → 재고계산 순서를 확인했다. 이번 수정은 해당 EXE/SQL 저장 순서를 변경하지 않고 웹 인증 계정의 공통 수입부 권한 검사만 적용한다. EXE와 기존 웹의 삭제 부작용이 동일하다는 판정은 하지 않는다.
운영 SELECT-only: 활성 Authority4 계정4개 모두 부서명 빈값. 동일44-01 활성 입고 헤더2025년54개/2026년50개. 계정 식별정보와 자격증명 보관 없음, 운영 삭제0. 기준·부작용표: plans/incoming-delete-auth-2026-11-11.md.
