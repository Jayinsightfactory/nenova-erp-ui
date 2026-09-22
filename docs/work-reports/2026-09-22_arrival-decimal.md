# Arrival-cost decimal binding follow-up

## Evidence and criteria

Thai38-1 parser fix deployed by PR746; Import26 has19 current rows from sheet38
rows15–33, quantity4300, all product/farm links MATCHED. Read-only source comparison
found P15=9033.76279932948 but stored SourceArrivalCostKRW=9034.
`lib/db.js` passes only `{type,value}` to Request.input, discarding sibling precision/scale.
The old bare sql.Decimal therefore has unspecified scale and loses fractional digits.

| Criterion | Source | Consumer |
|---|---|---|
| cost/quantity/weight scale4 | existing migration DECIMAL(18,4) | arrivalCost.sqlDecimal |
| USD/exchange scale6 | existing migration DECIMAL(18,6) | arrivalLineInsertParams |
| allocation shares scale8 | existing migration DECIMAL(18,8) | arrivalLineInsertParams |
| year | explicit caller | unchanged year parameter;2025/2026 fixture |
| source value incl zero | parser | preserved value; no arithmetic changes |

Scope: change only arrival-cost type bindings; do not change the shared DB wrapper.
MATCH/BASIS_CHANGE selected-cost saves also reuse the corrected helper.
Real MSSQL Request.input regression checks all17 decimal parameter scales.
Existing isolated import tests cover rollback, manual protection, idempotency and cross-year preservation.

## Side effects / requested repair

Future import/update uses existing WebArrivalCost transactions; no new public endpoint,
DDL, ERP or hotel manual price writes. Order/Shipment/Warehouse/Stock/Estimate/
WebProfitReport and WebRaumPnlItem.CostPrice remain preserved.

User explicitly approved correction of **this Thai38-1's19 rows only**.
After deployment: verify exact source hash against Import26 DRIVE_IMPORT, current scope,
sheet/source row/product/farm, SOURCE basis, no manual history. Use the same DB application
lock and row locks in one transaction. Require the old numeric values to match the known
scale0 rounding signature, then preserve columns outside source-backed decimal fields.
Record full before snapshots and after values in DECIMAL_REPAIR history; rollback on
any mismatch. No historical/cross-year/bulk correction. Dry run is rollback-only.

Validation/deployment/repair outcomes to be recorded after execution.

Local gates passed: full ERP contract, dnSpy evidence, manifest, write-scope, build.
Read-only live SQL SELECT using the two bindings: Legacy9034 vs Fixed9033.7628.
Repair review is read/rollback only: source SHA
4f5465b10c6b39aab74cc0263ac814e5ba0bd182854e791f9f19f1ccabcfb601,
19 current keys42464–42482, all original row/product/farm/raw JSON checks passed,
no manual history, no writes. Review digest:
5de48072a25fe853e7beb4f59e4aa2d7b47dfd4da5af2531cd8b827b82dbc978.
