# Farm quality web-only boundary — 2026-09-14

## Actual dnSpy CLI read

`dnSpy.Console.exe --no-color -t FormSalesDefectView Nenova.exe` was executed locally.
Source: `C:/Users/USER/nenova-decompiled/Nenova/FormSalesDefectView.cs`.
`GetData` joins `ShipmentMaster` to `Estimate` by ShipmentKey and filters
`OrderYearWeek`; CodeInfo identifies financial defect deduction types.

## Deliberate separation

The requested feature is quality tracking, not financial deduction registration.
It reads confirmed `WebSalesDefectDeduction` rows and Product names only.
For rate denominators it also reads `ViewWarehouse` with an explicit `OrderYear`
filter and aggregates `OutQuantity` by parent week, normalized FarmName, ProdKey,
and exact `Product.OutUnit`. The farm trend denominator includes every received
product for that farm and unit; an item candidate additionally requires the same
ProdKey. Box/bunch/stem units are never converted or mixed. A missing denominator
is displayed as unknown rather than as a zero-percent defect rate.
It does not call FormSalesDefectView financial calculations or write Estimate.
Writes are exclusively new WebFarmQualityCase and WebFarmQualityEvent tables.
OrderDetail, ShipmentDetail (Amount/Vat/isFix included), ShipmentDate,
StockHistory, Estimate, WebProfitReport and the original deduction rows are preserved.
Customer identifiers/names and source notes are not included in the API projection.
No EXE counterpart exists for the new web-only rate view or comment history.
The rate query is read-only and does not change WarehouseMaster, WarehouseDetail,
Product, shipment, order, stock, estimate, or settlement rows.

## Evidence limitations

Local schema documentation and source were inspected. Production read-only schema
probe and deployment verification must be recorded in the task session before
claiming operational completion. A local successful build is not DB proof.
