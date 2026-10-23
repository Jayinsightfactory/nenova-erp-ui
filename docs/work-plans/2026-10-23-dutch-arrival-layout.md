# Dutch arrival matrix / 2026-10-23

## Requested criteria
- Customer name and CL/order code occupy separate worksheet cells, with backward-compatible legacy headers.
- Region changes are workbook-local, move the entire customer column with its quantities/prices, and survive saved work and XLSX roundtrip. Customer master is preserved.
- Separate customer-column and product-row actions use explicit ERP search selection on the original matrix.
- Live rows include selected-year/subweek orders UNION actual arrivals by ProdKey. Arrival-only rows have blank allocations. No automatic order or distribution.
- Existing CATEGORY_REPLACE preview, explicit acknowledgement, transaction and readback remain authoritative. Arrival/stock summaries never become allocation quantities.

## Side effects / downstream
|Action|Customer/Product|Order/Shipment/Date/Farm|Warehouse/Stock|Estimate/WebProfitReport|
|---|---|---|---|---|
|Read arrivals / edit layout / add row-column / export-import|read/preserve|preserve|read/preserve|preserve|
|Explicit existing apply|existing contract only|positive absent order creation; existing order preserved; final shipment SET with current guards|preserve|preserve|

## Evidence before implementation
- Actual installed dnSpy CLI FormQuantityPivot and FormShipmentDistribution executed. ViewWarehouse arrival and ViewOrder customer branches are separate; native save uses master/customer, ProdKey, BaseOutDay, converted quantities, dates, Amount/Vat and changed farm rows in transaction.
- SELECT-only existing probe: 2026/43-02/533/1487 Out200, fixed, Amount381818/Vat38182, exact date join1, farms0. Fixed scope5/2127273/212727. No production writes.
- Current pivotStats already unions order and incoming product keys. Board prematurely rejects no-order periods. Dutch Excel explicitly opts out of separate CL row. These are display/loader boundaries, not permission to alter native writer.
- Old DB_STRUCTURE blanket isDeleted/identity/quantity and WEB_VS_ERP_CONFLICTS full OrderYearWeek text conflict with later actual evidence: current contracts, native NULL and current writer prevail; no schema/SP change.

## Validation pending
Legacy/new header roundtrip, region column identity, blank incoming-only quantities, product/customer additions, explicit zero and prices; cross-year and isolated SQL existing writer regression; required ERP gates/build; CI/deployment/browser smoke. Unverified until recorded.
