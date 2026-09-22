# Thai arrival-cost week recognition

## Source and criteria ledger

User source: 태국 덴파레 원가 자료 - EXCEL 2026 (38-1) (1).xlsx.
`38!C5=.38-1`, `37!C5=.37-1`; sheet names are numbered historical weeks.
Before fix: 497 parsed rows, all empty OrderWeek; target sheet contains 19 cost rows.
Filename parentheses and leading dot in the cell were both unsupported.

| Criterion | Authority | Consumer / rule |
|---|---|---|
| Week | explicit sheet identifier, then sheet header, then filename | common parser; accept punctuation boundaries, not date/id substrings |
| Historical numeric sheet | original sheet name | cannot inherit a different filename major week |
| Template | Plantilla source template | shared example-sheet exclusion |
| Cost/quantity/FX | original cached cell/formula values | unchanged extraction/calculation; no forced recomputation |
| Extent/row provenance | physical nonempty/formula cells | ignore formatting-only XFC extent; keep physical blank rows |
| Automatic scope | arrivalDriveCandidate + scopeArrivalDriveRows | exact year/week/country; no validation bypass |
| Save and authority | existing run-now/automatic import core | existing administrator/24h/id/hash/transaction/manual guards |

## Side effects

| Action | WebArrivalCost | Shared ERP / hotel manual cost |
|---|---|---|
| Local parsing/reproduction | none | preserve |
| Authorized existing import | same-year/week/country revision and history only | preserve |

Product/Farm read only. Preserve OrderMaster/Detail, WarehouseMaster/Detail,
ShipmentMaster/Detail/Date/Farm including Amount/Vat/isFix, Estimate,
ProductStock/StockHistory, WebProfitReport and WebRaumPnlItem.CostPrice.
Hotel downstream web reference may show the newly imported arrival cost; no manual-price writes.

## Evidence / validation

dnSpy CLI FormWarehouseView GetData/GetDetail rerun before edits; no ERP SQL/save changes.
Read-only probe 2025/2026 target weeks: no Thai 38-1 current rows. Existing 2026
China13-1 #24 5 rows, Ecuador37-1 #25 31 rows and prior country scopes retained.
Tests cover positive dotted week, parentheses fallback, old numeric sheet,
template, sheet priority, date/id near misses, cross-year rejection, source price
and physical row preservation. Existing common import transaction fixtures remain required.
Deployment and real-file validation results will be appended after execution.

Real source replay after correction: 497 rows overall, 19 rows in scoped38-1,
all from sheet38 physical rows15–33, quantity total4300. Each product C, quantity F,
and arrival-cost P matched the corresponding original cell exactly. Local parse529ms.
Plantilla excluded; no source cost rejected. Full ERP contract, dnSpy evidence,
manifest and write-scope gates passed.
