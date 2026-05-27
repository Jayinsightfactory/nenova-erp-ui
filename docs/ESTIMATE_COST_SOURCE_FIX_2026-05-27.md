# Estimate Cost Source Fix - 2026-05-27

## Reported Symptom

`nenova.exe` shipment distribution showed the edited unit price, but `nenova.exe` estimate management still showed an old or wrong value.

## Findings

- `ShipmentFarm` has no `Cost`, `Amount`, or `Vat` columns, so it is not the unit-price source.
- `FormEstimateView` uses `ShipmentDate` with `ViewShipment` for estimate detail/print/excel data.
- 21-02 had no direct unit-price source mismatch.
- 21-01 had one direct mismatch:
  - `SdetailKey=74245`
  - `청화원예 / CARNATION Moon Light`
  - `ShipmentDetail` and `ViewShipment` had cost `11000`
  - `ShipmentDate.Cost/Amount/Vat` had remained `0`

## Root Cause

Some web quantity/distribution paths recreated `ShipmentDate` with only `ShipmentQuantity`.

That left `ShipmentDate.EstQuantity`, `Cost`, `Amount`, and `Vat` empty. As a result:

- Distribution screens that read `ShipmentDetail` could look correct.
- Estimate management in `nenova.exe`, which joins `ShipmentDate`, could still show wrong values.

## Code Changes

Future writes now keep `ShipmentDate` estimate fields in sync:

- `pages/api/estimate/update-quantity.js`
- `pages/api/shipment/distribute.js`
- `pages/api/shipment/adjust.js`
- `pages/api/estimate/update-cost.js`

Diagnostics and repair:

- Added `/api/dev/estimate-cost-source-audit`
- Expanded `/api/dev/estimate-cost-date-sync?scope=all`

## Production Repair

Applied production sync for `21-01`.

Post-check:

- 21-01 direct cost-source mismatches: `0`
- 21-02 direct cost-source mismatches: `0`
- Remaining 21-01 amount mismatches are multi-date split rows where `DetailCost`, `DateCost`, and `ViewCost` all match; these are not unit-price mismatches.

## Deploy

- Build: `next build` passed
- Latest deployed commit checked by `/api/dev/git-log`: `c2d5f54`
