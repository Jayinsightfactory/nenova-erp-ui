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
