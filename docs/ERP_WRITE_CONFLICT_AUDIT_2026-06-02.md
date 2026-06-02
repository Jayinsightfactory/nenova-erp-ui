# ERP Write Conflict Audit — 2026-06-02

## Checked Reference Docs

- `docs/WEB_VS_ERP_CONFLICTS.md`
- `docs/DB_STRUCTURE.md`
- `docs/CLAUDE_CLI_CROSS_VERIFY_RESULT_2026-05-26.md`
- `docs/ESTIMATE_COST_SOURCE_FIX_2026-05-27.md`

## Required Rules

1. `ShipmentDetail` quantity writes must use the ERP-compatible single formula:
   - `OutQuantity = input box qty`
   - `BoxQuantity = input box qty`
   - `BunchQuantity = input box qty * Product.BunchOf1Box`
   - `SteamQuantity = input box qty * Product.SteamOf1Box`
   - Do not branch `ShipmentDetail` by `Product.OutUnit`.
2. Any `ShipmentDetail` write that affects estimates must keep `ShipmentDate` synced with:
   - `ShipmentQuantity`
   - `EstQuantity`
   - `Cost`
   - `Amount`
   - `Vat`
3. Manual-key tables used by `nenova.exe` must use retry-safe key creation and sync `KeyNumbering` after inserts:
   - `OrderMasterKey`
   - `OrderDetailKey`
   - `ShipmentMasterKey`
   - `ShipmentDetailKey`
4. `OrderDetail` quantity writes should fill `BoxQuantity`, `BunchQuantity`, `SteamQuantity`, `OutQuantity`, `EstQuantity`, and `NoneOutQuantity`.

## Fixed In This Audit

- `lib/shipmentImport.js`
  - Excel shipment import apply now separates order units from shipment units.
  - Order registration still uses order-unit conversion.
  - Shipment distribution uses the ERP-compatible single formula.

- `pages/api/shipment/stock-status.js`
  - PATCH distribution writes now sync `ShipmentDetail` and `ShipmentDate` with estimate amount fields.
  - `addOrder` and `addOrderDelta` no longer store only one unit column.
  - `addOrderDelta` no longer calculates order quantity by summing `Box+Bunch+Steam`.
  - New inserts sync `KeyNumbering`.

- `pages/api/public/orders.js`
  - OrderMaster creation now uses retry-safe manual key creation.
  - OrderMaster and OrderDetail inserts sync `KeyNumbering`.

- `pages/api/m/order-request-approve.js`
  - OrderMaster and OrderDetail inserts sync `KeyNumbering`.

- `pages/api/public/shipments.js`
  - Shipment writes now run in a single transaction.
  - ShipmentMaster and ShipmentDetail inserts use retry-safe manual keys and sync `KeyNumbering`.
  - ShipmentDetail writes use the ERP-compatible single formula.
  - ShipmentDate is created with `ShipmentQuantity`, `EstQuantity`, `Cost`, `Amount`, and `Vat`.

## Verification

- `next build` passed.
- `git diff --check` passed.
- No live DB mutation test was performed during this audit.
