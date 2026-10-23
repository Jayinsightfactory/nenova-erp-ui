# 실제 EXE·SQL 조회 근거: 잔존 재고 환산 (2026-10-23)

## 실제 실행

- EXE: `C:/Program Files (x86)/Wooribnc/Nenova/Nenova.exe`
- CLI: `C:/Users/USER/Desktop/백업/다운로드/dnSpy-net-win32/dnSpy.Console.exe`
- 명령: `--no-color -t FormStockView <EXE>` 및 `--no-color -t FormWarehouseView <EXE>` 실제 실행, 정상 종료.
- 방법: 원본 EXE/Form/저장 프로시저를 수정하거나 호출하지 않고 decompile 출력과 SELECT만 비교했다.

## 읽기 권위

1. `FormStockView.GetData`는 StockMaster.StockKey→ProductStock.Stock을 읽고 Product.OutUnit으로 표시한다. ViewWarehouse.OutQuantity / ViewShipment.OutQuantity와 StockHistory의 CodeInfo StockType 조정을 별도 조회한다.
2. `FormWarehouseView.GetDetail`은 같은 WarehouseDetail의 BoxQuantity, BunchQuantity, SteamQuantity, OutQuantity, SteamOf1Box, SteamOf1Bunch를 읽는다.
3. 실제 `SELECT OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_StockCalculation'))` 확인 결과: 재고 계산의 출고 원천은 같은 OrderYear/OrderWeek의 **ViewShipment.DetailFix=1**이다. Master.isFix로 바꾸거나 미확정 출고를 확정 소비로 간주하지 않는다.
4. SP의 조정 원천은 StockHistory→CodeInfo(Category='StockType', Descr=ChangeType)이다. 웹 근거 복구는 CodeInfo 중복 2건 이상이면 조용히 중복 곱하거나 DISTINCT로 숨기지 않고 보류한다.
5. ProductStock은 ProdKey/StockKey/Stock만 있어 WarehouseDetailKey의 잔존 lot 연결이 없다. ShipmentFarm은 FarmKey 연결이고, 대상 두 품목에는 해당 연결도 없다.

## SQL 대사로 확인된 범위

- NL1959 / 09: Wdetail23766의 10단/200송이와 저장환산10 충돌, +10단 조정 존재 → 자동 복구 보류.
- NL1959 / 29: 29-01 Stock250=0 이후 Wdetail35875 10단100송이, 확정출고5단, Stock258=5단 → 50송이.
- NL1959 / 31: 31-01 Stock260=0 이후 Wdetail36662 10단100송이, 확정출고0, Stock261=10단 → 100송이.
- EC3227 / 33~35: 30-02 Stock259=0 이후 Wdetail36698 1박스150송이 + Wdetail37271 1박스250송이. 소비/조정0, 재고2박스 → 400송이. 29차 별도 샘플은29-02 조정363226으로 이미 소진됐다.

이는 웹 평균원가 표시를 위한 SELECT-only 물리수량 대사다. EXE의 원장 수량·계산식·저장 순서는 변경하지 않는다. 혼합 lot 일부 소비는 위 근거로 식별할 수 없으므로 FIFO/LIFO/최근비율을 자동 적용하지 않는다.

계획: `docs/plans/profit-source-recovery-2026-10-23.md`.
계약: `docs/contracts/profit-country-average.json`.
실행 회귀: `__tests__/profitReportCountryAverage.test.cjs`.
