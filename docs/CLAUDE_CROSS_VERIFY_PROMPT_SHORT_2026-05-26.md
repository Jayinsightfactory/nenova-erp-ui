# Claude CLI Short Cross Verification Prompt

Read-only review. Do not edit files and do not call production write APIs.

Review only these recent changes:

- `pages/estimate.js`
  - Estimate print aggregation now groups by `EstimateType + ProdKey + Unit + Cost`.
  - Alstro estimate print unit changed from `스팀` to `송이`.
- `pages/api/shipment/distribute.js`
  - Shipment distribution now uses server-side `Customer.BaseOutDay` date fallback.
  - Distribution save converts Box/Bunch/Steam quantities using `Product.OutUnit`.
- `pages/shipment/distribute.js`
  - Removed frontend `outDate` from save payload.
- `pages/api/estimate/update-quantity.js`
  - Blocks estimate quantity edits when shipment date is missing or has multiple `ShipmentDate` rows.

Please answer in Korean:

1. Any likely bug/regression in these changes?
2. Any `nenova.exe` shared DB conflict risk still present?
3. Is it safe that same product but different cost no longer merges in estimate print?
4. Top 3 next fixes only.

