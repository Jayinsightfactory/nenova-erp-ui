# Claude CLI Cross Verification Prompt

Read-only verification only. Do not edit files, do not run write APIs, and do not access production pages that mutate data.

Context:

- Repo: `nenova-erp-ui`
- Production: `https://nenovaweb.com`
- Recent fix under review: `44f8e15 fix: guard estimate quantity date distribution`
- The operator reported several `nenova.exe`/web shared-DB issues:
  1. `nenova.exe` one-click/individual shipment distribution sometimes appears not to work.
  2. 21-01 domestic wax distribution previously failed.
  3. Some web distribution was blocked because a week was partially fixed, even when the target product group itself was not fixed.
  4. Shipment distribution without a shipment date may cause later fix/estimate errors.
  5. Shipment distribution quantity was saved but unit price was missing; prices should come from `CustomerProdCost`.
  6. Estimate quantity/cost edits may differ from `nenova.exe` behavior, especially `ShipmentDate`, `ShipmentDetail.Amount/Vat`, fixed shipment handling, and history logging.
  7. Estimate print category/unit grouping had recent fixes and may still affect amount or grouping.

Primary files to inspect:

- `pages/api/shipment/distribute.js`
- `pages/api/shipment/adjust.js`
- `pages/api/shipment/fix.js`
- `pages/api/shipment/fix-status.js`
- `pages/api/shipment/distribute-diagnose.js`
- `pages/api/estimate/index.js`
- `pages/api/estimate/update-quantity.js`
- `pages/api/estimate/update-cost.js`
- `pages/estimate.js`
- `docs/work_history.md`
- `docs/WEB_VS_ERP_CONFLICTS.md`
- `docs/FULL_VALIDATION_AUDIT_2026-05-25.md`
- `docs/PAGE_DATA_INPUT_DB_PARITY_AUDIT_2026-05-26.md`
- `docs/ESTIMATE_EDIT_EXE_PARITY_AUDIT_2026-05-26.md`

Please answer in Korean with:

1. Confirmed resolved issues.
2. Remaining high-risk issues that can still break `nenova.exe` or shared DB behavior.
3. Any bug you can point to with exact file/line references.
4. Whether commit `44f8e15` is safe and whether it is too narrow/broad.
5. Suggested next fixes in priority order.

