# Estimate Fix Speed Optimization - 2026-05-27

## Goal

Reduce the time spent after estimate edits without changing the `nenova.exe` shipment fix/cancel structure.

## Principle

- Keep `usp_ShipmentFix` and `usp_ShipmentFixCancel` as the authority for fix/cancel.
- Do not use web-side stock math to decide final fix state.
- Keep post-fix stock recalculation at the same `CountryFlower` scope touched by the fix/cancel SP.

## Changes

- Estimate quantity edits narrow the fix/cancel cycle to the edited `CountryFlower` categories.
- `/api/shipment/fix` still accepts edited `ProdKey` values from the client for audit context, but does not use them to shrink post-SP recalculation.
- Cost-only edits no longer trigger an unfix/refix cycle because they do not change shipment quantity or stock.
- Cost edits are written directly to `ShipmentDetail` and `ShipmentDate` so `nenova.exe` estimate management can read them.

## SP Scope Verification

- `usp_ShipmentFix` / `usp_ShipmentFixCancel` support `@CountryFlower` and change `Product.Stock`, `isFix`, `StockHistory`, and `ShipmentHistory` for all matching shipment rows in that category.
- `usp_StockCalculation` supports `@ProdKey`, so a single product can be recalculated.
- However, after a category-level fix/cancel SP call, every product touched by that category SP must have its `ProductStock` snapshot recalculated.
- Therefore the safe maximum optimization is `CountryFlower` scope. Narrowing post-fix recalculation to only the edited `ProdKey` rows is unsafe and has been disabled.

## Expected Impact

Previously a whole-week cycle could touch every category. The safe optimization is now to process only the edited categories while recalculating every product in each touched category.

This is slower than `ProdKey`-only recalculation, but it preserves the `nenova.exe` fix/cancel structure.

## Verification

- `next build` passed.
- Existing warning: Turbopack NFT trace warning from `pages/api/dev/git-log.js`, unrelated to this change.
