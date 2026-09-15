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
Evidence image drafts and their immutable event links are stored only in
`WebFarmQualityEvidence`; the authenticated web endpoint checks file signatures,
uploader identity and `OrderYear`. No image bytes or references are written to EXE tables.
OrderDetail, ShipmentDetail (Amount/Vat/isFix included), ShipmentDate,
StockHistory, Estimate, WebProfitReport and the original deduction rows are preserved.
Internal customer identifiers and source notes are not included in the API projection.
Snapshot customer names are shown in authenticated source evidence as requested on
2026-09-15 (see the coverage extension below).
No EXE counterpart exists for the new web-only rate view or comment history.
The rate query is read-only and does not change WarehouseMaster, WarehouseDetail,
Product, shipment, order, stock, estimate, or settlement rows.

The feedback list also projects only the selected year's `WebFarmQualityEvent`
rows. Each card receives the total event count and the latest three events with
their stable chronological number, kind, author and body preview. Opening the card
loads the complete numbered history. This projection does not write or recalculate
the EXE order, shipment, warehouse, estimate, stock or settlement ledgers.

Only the exact web account `nenovaSS3` can remove a feedback case. The browser
shows the destructive action only when the authenticated GET returns that exact
permission, and DELETE repeats the exact-account check on the server. It locks
the selected `OrderYear + CaseKey + Version`, removes linked evidence first,
then its web-only events and case in one transaction, and records the actor and
deleted event count in the server audit log. A stale version or another year is
rejected. `WebSalesDefectDeduction` and every EXE order, shipment, warehouse,
stock, estimate, sales and settlement row remain unchanged.

## 2026-09-14 automatic signal projection

The quality page additionally derives four read-only signals from the same confirmed
`WebSalesDefectDeduction` source: the same farm/product/unit in one parent week across
at least two `CustKey` values, multiple products from one farm in a parent week, a
product recurring in adjacent weeks (or three of four weeks), and a farm recurring
with multiple products under the same cadence. `CustKey` is used only inside the
server-side distinct-order test. It is not returned to the browser. Signal counts are
distinct `DeductionKey` counts; expanded evidence contains week, product, count and
original-unit quantity and snapshot customer names. This GET projection creates no case or event. A
`WebFarmQualityCase/Event` write still requires the user's explicit action.

| action | defect source | quality tables | ERP order/shipment/stock/estimate/settlement |
|---|---|---|---|
| load automatic signals | SELECT only | SELECT only | ViewWarehouse SELECT only; all ledgers preserved |
| expand signal details | browser state only | preserved | preserved |
| explicitly create/open feedback | source SELECT only | existing guarded Case/Event write | preserved |
| attach evidence image | preserved | WebFarmQualityEvidence draft then same-transaction EventKey link | preserved |
| delete selected feedback (`nenovaSS3` only) | preserved | linked Evidence → Event → Case DELETE in one transaction | preserved |

## 2026-09-14 comment acknowledgement repair

The comment button previously allowed a click while the list/detail refresh flag was active,
but `save()` returned without any visible result. After a successful transaction, the browser
also waited for a second list/history GET before it could show the inserted comment. A slow or
failed refresh therefore looked like a failed write even when the Event row was committed.

The transaction now returns the inserted Event and updated Case version/status. The browser
renders that result immediately and performs list/history refresh silently afterward. A refresh
failure is reported as a refresh warning and never relabels the committed write as failed.
Server logs record request/case/actor metadata without the comment body. The write scope remains
`WebFarmQualityCase`, `WebFarmQualityEvent`, and explicitly linked `WebFarmQualityEvidence` only;
all EXE order, shipment, warehouse, stock, estimate, sales, and settlement rows remain preserved.

## Evidence limitations

### 2026-09-15 automatic all-source follow-up

The coverage-only extension below did not broaden automatic detection. This
follow-up separates automatic eligibility from confirmed rate/create eligibility.
Active same-year in-range rows with valid source/product IDs and positive original
quantity enter detection even when unconfirmed or missing a farm. Known-farm
patterns are unchanged; missing-farm rows only form same-product/week multi-customer
or same-customer/product recurring-week review candidates, never inferred farm
clusters. Any incomplete confirmation or farm attribution disables case creation
for that candidate. Existing trusted qualityGroups, rate denominators and POST
source revalidation are unchanged. Customer IDs stay server-only including keys.
Signal coverage uses unique source IDs so overlapping patterns cannot inflate the
source count. Automatic unit selection defaults to all and is independent of rates.
All source and ERP tables remain read-only; no migration or automatic case writes.

### 2026-09-15 source coverage extension

The same-year active web defect source is now separately projected for coverage,
including rows that cannot enter confirmed metrics. IN_RANGE, OUT_OF_RANGE and
UNKNOWN_WEEK are explicit; out-of-range rows remain available through a UI filter.
Deleted source rows are counted, not restored. Source and active partitions must
conserve counts; the trusted qualityGroups/create validation remains unchanged.
The user explicitly requested customer names in expanded source-count details.
Only stored CustName is projected; CustKey/customerIdentity and source notes remain
server-only. Existing role/account checks are unchanged. No ERP writes are added.

Read-only production schema/count probe on 2026-09-15:
https://github.com/Jayinsightfactory/nenova-erp-ui/actions/runs/34919316967
2026 source=436, deleted=24, active=412; active missing farm=80,
unconfirmed=55 (overlapping), missing product/nonpositive quantity/customer name=0.
Required source columns including CustName exist. These are web defect source
counts, not a claim to have imported every legacy financial Estimate deduction.

Local schema documentation and source were inspected. Production read-only schema
probe and deployment verification must be recorded in the task session before
claiming operational completion. A local successful build is not DB proof.
