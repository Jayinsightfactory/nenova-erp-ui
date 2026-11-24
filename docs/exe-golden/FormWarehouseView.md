# FormWarehouseView 입고수량 조회 근거

## 2026-08-27 dnSpy CLI 확인

`dnSpy.Console.exe --no-color -t FormWarehouseView nenova.exe`를 실제 실행해 `GetDetail`을 확인했다.

- `WarehouseDetail wd`에서 `wd.ProdKey`, `wd.OutQuantity`를 읽는다.
- `Product p`와 `ProdKey`로 결합하고 `p.OutUnit`을 표시 단위로 사용한다.
- 선택한 입고 헤더는 `WarehouseMaster.OrderYear + OrderWeek` 범위다.
- 웹 붙여넣기 화면은 선택한 `OrderYear + OrderWeek + ProdKey`의 활성 `WarehouseMaster`만 대상으로 `SUM(WarehouseDetail.OutQuantity)`를 표시한다.
- 입고관리 원장 목록은 동일한 헤더별 집계를 사용하며 웹 표가 읽는 `totalBox`, `totalBunch`, `totalSteam` 필드명으로 반환한다. 입고 상세 품목명은 UI에서 줄바꿈해 전체 이름을 표시하며 ERP 원장은 변경하지 않는다.

이는 조회 전용 보조 표시다. Warehouse/Order/Shipment/Stock/Estimate 원장을 수정하지 않는다.

## 2026-11-24 박스수량과 입고 식별값

설치 EXE를 dnSpy CLI로 재추출했다. `GetData`의 박스 합계는 저장된 `WarehouseDetail.BoxQuantity`를 그대로 합하고 `WarehouseMaster.InvoiceNo/OrderNo`를 읽는다. `GetDetail`은 행에 기록한 `SteamOf1Box/SteamOf1Bunch`를 읽는다. `FormWarehouseAdd`는 입력 수량을 출고·견적 단위로 다시 계산하며 `ClassWarehouseMaster.Update`에는 인보이스·AWB 갱신이 없다.

운영 SELECT의 2026/47-02 입고 8247은 140행, 박스 미기재 62행, 명시 0행 0, 기록된 박스당 송이로 정확히 계산할 수 있는 후보 0, 웹 문서 이력 연결 3건이었다. [범위와 부작용 확인](../plans/warehouse-receipt-reading-2026-11-24.md).

## 2026-11-24 입고 원장 번호 인라인

설치본을 다시 추출해 `FormWarehouseView.GetData`가 `InvoiceNo/OrderNo`를 그대로 읽고, `ClassWarehouseMaster.Update`에서 번호 수정을 제공하지 않는 것을 확인했다. 웹은 단독 원장의 번호만 기존 최종수정 메타와 함께 갱신한다. 2026/47-02는 웹 인보이스 8249·8250의 AWB가 공란이지만 두 건 모두 문서가 연결되고 해당 차수의 출고 확정으로 공식 작성기에서 차단된다. 8249는 등록 스냅샷도 현재 원장과 다르다. [운영 읽기 확인과 영향 범위](../plans/warehouse-inline-numbers-2026-11-24.md).

## 2026-11-11 웹 원장삭제 권한 검사
실제 dnSpy CLI FormWarehouseView 재추출에서 btnDelete_Click → DeleteCheck → 선택 WarehouseKey의 ClassWarehouse.Delete/DeleteDetail → 상세 StockHistory → 재고계산 순서를 확인했다. 이번 수정은 해당 EXE/SQL 저장 순서를 변경하지 않고 웹 인증 계정의 공통 수입부 권한 검사만 적용한다. EXE와 기존 웹의 삭제 부작용이 동일하다는 판정은 하지 않는다.
운영 SELECT-only: 활성 Authority4 계정4개 모두 부서명 빈값. 동일44-01 활성 입고 헤더2025년54개/2026년50개. 계정 식별정보와 자격증명 보관 없음, 운영 삭제0. 기준·부작용표: plans/incoming-delete-auth-2026-11-11.md.
