# Colombian mixed-AWB freight recovery

## Evidence and compatibility

Actual command executed before implementation:
`C:\Users\USER\Desktop\백업\다운로드\dnSpy-net-win32\dnSpy.Console.exe --no-color -t FormWarehouseView "C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe"`.
FormWarehouseView.GetData reads WarehouseMaster; GetDetail joins WarehouseDetail to Product and reads UPrice/TPrice. EXE deletion writes ClassWarehouseDetail, StockHistory and calls uspStockCalculation: none of these write paths are used or changed here.

Read-only SQL probe: selected-year WarehouseMaster/Detail/Product and latest WebProfitReportSnapshot for all available 2026 weeks. Mixed AWB goods context contains hydrangea and four Colombian families while freight classifier only admitted the four. Weight allocation already admitted hydrangea; invoice-text fallback cannot repair arbitrary spelling errors. Exact source row IDs, AWB and amounts reconcile the excluded rows. Private business values remain outside Git/CI logs.

Sales investigation: compare ShipmentDetail.Amount and Estimate by classification, PeriodDay exact datetime, including freight-sales products classified by product name rather than raw country. Additional-sales freight explains all remaining Colombian O differences; no sales/discount patch required.

## Criteria and side effects

|Action|ERP ledger|Web report/snapshot/confirmation|Output|
|---|---|---|---|
|Live report read|SELECT only|preserve|same mixed AWB freight/weight pool|
|Historical report read|SELECT only|preserve original bytes|clone-only exact excluded-source recovery and prior closing carry|

Identity: explicit OrderYear plus major/subweek and warehouse/detail PK. Unchanged raw amount, mixed AWB identity and existing GW/CBM allocation evidence required. Manual S/F including zero and non-category-average valuation are preserved. Prior E correction requires identity with prior saved F; unrelated historical formulas remain fixed. No auto refresh, DDL, SP or DML.

Regression: mixed 5-family AWB with arbitrary/empty invoice, conservation, foreign year, mixed-country near miss, changed source amount, manual zero, category-average closing and exact next opening, immutable/idempotent projection.

Prevention: the existing forwarding ledger enumerates every freight row, reconciles source/classified/mapped amounts and tracks unmatched IDs. This fix makes the pool identical to weight allocation and certifies frozen recovery against exact current SQL. Cache creation now rejects nonzero unmatched freight or allocation/currency nonconservation with PROFIT_FREIGHT_UNMAPPED; it cannot silently freeze a dropped cost. Existing unrelated missing sources remain diagnostics. Full report source completeness is not guaranteed by these targeted fixtures alone.

## Annual probe result

All available 2026 saved weeks and source receipts were inspected. The same mixed-pool failure was recovered in 42 and45; subsequent43 and46 receive only the matching prior-closing valuation delta. No other saved week had a recovered mixed-AWB unmatched row. This is not a blanket assertion that all other business inputs are complete.
42 Colombian N and L match SQL. O also matches after adding transport-sales rows whose Product country is domestic but explicit product names map them to Colombian families. No actual discount or shipment amount change is justified or implemented.
