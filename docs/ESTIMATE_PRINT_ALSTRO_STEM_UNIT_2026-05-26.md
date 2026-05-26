# Estimate Print Alstro Stem Unit - 2026-05-26

## Request
- In estimate print output, alstro should be shown as stems, not bunches.
- Example: `16단` should print as `160송이` and `1박스`.

## Changes
- `/api/estimate` item details now include raw shipment quantities:
  - `RawBunchQuantity`
  - `RawSteamQuantity`
  - `RawBoxQuantity`
- Estimate print rows normalize alstro display:
  - Prefer `RawSteamQuantity` when present.
  - If only bunch quantity exists, convert bunches to stems with `bunch * 10`.
  - Display unit as `송이`.
  - Keep original totals and recalculate displayed unit cost from total amount divided by displayed stem quantity.

## Safety Notes
- Print/display behavior only.
- No shipment, estimate, product, or customer data writes were changed.
