# FormShipmentDistribution — exe golden (dnSpy/CLI)

source: `C:\Users\USER\nenova-decompiled\Nenova\FormShipmentDistribution.cs`
verification: read-only decompile source and SQL structure inspection

## CLI verification record

```powershell
$cli = 'C:\Users\USER\Desktop\백업\다운로드\dnSpy-net-win32\dnSpy.Console.exe'
$exe = 'C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe'
& $cli --no-color -t FormShipmentDistribution $exe
```

The CLI output was inspected for `GetCustomerList`, `grdViewShipment_FocusedRowChanged`, `btnSave_Click`, `ShipmentFarm`, and `ShipmentDate`. This is a local decompile/read-only operation; no production write API or SQL write was executed.

## Farm save evidence

- `GetCustomerList`: `ViewOrder` joined with `ViewShipment` and `ShipmentDate`; no `ShipmentFarm` gate for the top customer list.
- `grdViewShipment_FocusedRowChanged`: `ViewWarehouse` grouped by `FarmName/OrderCode/ProdKey`, `Farm.FarmKey` lookup, and `ShipmentFarm` aggregation by `SdetailKey` for the farm grid.
- The farm candidate `ViewWarehouse` query is product-wide (`WHERE ProdKey=@pk`); it is not constrained by the selected shipment `OrderYear/OrderWeek`. The web GET, POST, and adjust transaction must share this exact scope.
- `btnSave_Click`: writes `ShipmentDetail`, then changed farm rows with valid `FarmKey` through `ClassShipmentFarm.Insert()`, then updates/rebuilds `ShipmentDate` when quantity-unit columns change.
- `ClassShipmentFarm.Insert()`: `INSERT INTO ShipmentFarm (FarmKey, ShipmentQuantity, SdetailKey)`.
- `read-only`: no production write was performed while deriving this structure.

## 견적서관리 02차 추가 품목등록 적용

웹의 추가 품목등록은 별도 Estimate 행을 만들지 않고 `FormShipmentDistribution.btnSave_Click`
경로를 따른다. 현재연도 `OrderWeek=NN-02`와 거래처·품목·검증된 `ShipmentDtm`을 업무키로
사용하며, 기존 활성 주문이 있으면 OrderDetail 수량은 보존하고 ShipmentDetail만 증가한다.
신규 출고에는 위 product-wide `ViewWarehouse` 후보에서 사용자가 선택한 FarmKey가 필수다.
확정행은 화면에서 확정해제→분배 저장→재확정하고 각 HTTP 쓰기는 SystemActionLog,
수량 변경은 ShipmentHistory에 기록한다. 참고단가는 표시만 하며 사용자가 출처 또는
직접입력을 명시하기 전에는 자동 확정하지 않는다.

모든 출고분배 GET/POST는 화면 차수에 포함된 연도 또는 별도 `year`를 명시한다. 짧은
`NN-NN`을 서버 현재연도로 보정하지 않는다. 입고 0/초과·음수잔량 경고의 `force`는 자동
일괄 작업이나 라움 이동에서 재시도하지 않으며, 경고 내용을 본 사용자가 단건 작업을 다시
확인한 경우에만 허용한다. 확정해제의 `force`와 재고부족 override는 서로 다른 계약이다.

## 붙여넣기 ADD 이월재고 검증 근거 (2026-08-10)

- `FormShipmentDistribution.GetProductList()`는 `GetBeforeOrderYearWeek(SelectOrderYearWeek)`로
  직전 결합키를 구하고 `StockMaster + ProductStock`의 같은 `ProdKey`에서
  `bs.Stock AS BeforeStock`을 읽는다.
- `usp_StockCalculation` 공식은 `PrevStock + 현차수 ViewWarehouse.OutQuantity
  - 현차수 ViewShipment.OutQuantity + 현차수 수동 StockHistory 조정`이다.
- 웹의 붙여넣기 ADD 사전검증은 쓰기 정책을 바꾸지 않고, 현재 `연도+차수` 결합키보다
  작은 최신 `ProductStock.Stock`을 이월재고로 더한다. `Product.Stock`이나 `isFix` 단독
  필터를 이 계산에 사용하지 않는다.
- 2025/2026에 같은 `OrderWeek`가 있어도 문자열 `OrderYear + REPLACE(OrderWeek,'-','')`
  전체를 비교하므로 현재 스냅샷과 전년도 동일 차수가 섞이지 않는다.
- 수량은 0.001 단위로 정규화해 부동소수점 꼬리와 미세 음수를 0으로 처리한다.
- 이 확인은 로컬 decompile 원문과 저장된 SP/View 근거의 읽기 전용 대조이며 운영 쓰기는
  수행하지 않았다.

## 붙여넣기 명시 단위 환산 근거 (2026-08-10)

- `FormOrderAdd.GetDataProduct()`는 `OutUnit`, `OrderBox/OrderBunch/OrderSteam`,
  `BunchOf1Box`, `SteamOf1Bunch`, `SteamOf1Box`를 함께 조회한다.
- 수량 셀 변경 시 입력한 Box/Bunch/Steam 열을 기준으로 나머지 수량을 환산하고,
  저장 시 세 수량을 모두 기록한 뒤 `UnitQuantity(true, row)`가 `OutUnit`에 해당하는
  값을 `OutQuantity`로 선택한다.
- 따라서 웹도 `1박스`라는 명시 입력을 먼저 BoxQuantity=1로 보존하고 마스터 환산값으로
  Bunch/Steam을 만든 뒤 `OutUnit='단'`이면 BunchQuantity를 OutQuantity로 저장해야 한다.
- 마스터 환산값이 0/NULL인 상태에서 1로 추정하면 전산의 세 수량 구조와 달라지므로
  조용한 fallback 없이 오류로 차단한다.
- 이 근거 확인은 로컬 dnSpy decompile 원문의 읽기 전용 검토이며 운영 주문·출고 쓰기는
  수행하지 않았다.
