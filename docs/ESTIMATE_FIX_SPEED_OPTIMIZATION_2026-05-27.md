# Estimate Fix Speed Optimization - 2026-05-27

## Goal

Reduce the time spent after estimate edits without changing the `nenova.exe` shipment fix/cancel structure.

## Principle

- Keep `usp_ShipmentFix` and `usp_ShipmentFixCancel` as the authority for fix/cancel.
- Do not use web-side stock math to decide final fix state.
- Use the actual edited quantity rows to narrow the slow post-fix stock calculation.

## Changes

- Estimate quantity edits now pass edited `ProdKey` values to `/api/shipment/fix`.
- `/api/shipment/fix` still calls fix/cancel by category, but `usp_StockCalculation` is restricted to the edited product keys when provided.
- Cost-only edits no longer trigger an unfix/refix cycle because they do not change shipment quantity or stock.
- Cost edits are written directly to `ShipmentDetail` and `ShipmentDate` so `nenova.exe` estimate management can read them.

## Expected Impact

Previously a category with 50 products could take around 100 seconds because every product ran `usp_StockCalculation`.

After this change, if the user edits only 1-3 quantity rows, stock calculation should run only those products, while the fix/cancel SP remains aligned with `nenova.exe`.

## Verification

- `next build` passed.
- Existing warning: Turbopack NFT trace warning from `pages/api/dev/git-log.js`, unrelated to this change.
