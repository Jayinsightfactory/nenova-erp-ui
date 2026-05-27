# Orchid Stock Audit - 2026-05-27

## Case

User reported that in `nenova.exe`, Vietnam orchid `20-01` still shows stock around `662` even though previous quantity and current shipment quantity should offset.

Checked product:

- `ProdKey`: `3074`
- Product: `ORCHID VIETNAM / 호접란 화이트 8 (Party grade White 8)`
- Category: `베트남호접난 Orchid`

## Findings

- `Product.Stock` live value is `661`.
- `ShipmentDetail` for `20-01` is fixed and totals `662`.
  - 신라호텔: `656`
  - 아이엠: `6`
- `ShipmentDate` totals match `ShipmentDetail.OutQuantity`.
- `ProductStock` snapshots are stale:
  - `19-01`: `688`
  - `19-02`: `688`
  - `20-01`: `683`
  - `20-02`: `683`
  - `21-01`: `683`
  - `21-02`: `683`

Expected `20-01` cascade after fixed shipment should be closer to:

`19-02 stock 688 - 20-01 shipment 662 = 26`

plus any valid stock adjustments.

## Timeline Evidence

`ShipmentDetail` quantity was changed after the original `20-01` stock snapshot:

- `2026-05-18`: 신라호텔 `352 -> 677`
- `2026-05-21`: 신라호텔 `677 -> 656`
- `2026-05-19`: 아이엠 `11 -> 0 -> 6`

`StockHistory` shows repeated official `usp_ShipmentFixCancel` / `usp_ShipmentFix` effects:

- `2026-05-19` through `2026-05-21`: multiple exe-side fix/cancel cycles by `nenovaSS1`, `nenovaSS2`
- `2026-05-27`: web-side fix/cancel cycles by `nenovaSS3` / `admin`

The web-side fix/cancel changed `Product.Stock` through the official SP path, but the `ProductStock` snapshot for this product stayed stale.

## Conclusion

This is not a paste/order matching error and not a direct quantity-edit creation by the latest web code.

The mismatch is a `ProductStock` cascade recalculation gap for `ProdKey 3074`, likely caused by shipment quantity changes after the existing `20-01` stock snapshot and later fix/cancel cycles not successfully refreshing this product's snapshot chain.

Safe repair path:

1. Do not manually edit `ProductStock`.
2. Run official `usp_StockCalculation` for `ProdKey 3074` starting at `2026 / 20-01`.
3. Recheck `ProductStock` for `20-01` through `21-02`.
4. If the SP fails, capture the returned `oResult/oMessage` and fix the underlying SP validation issue first.

## Repair Result

Executed official SP:

```sql
EXEC dbo.usp_StockCalculation
     @OrderYear = '2026',
     @OrderWeek = '20-01',
     @ProdKey = 3074,
     @iUserID = '<logged-in user>';
```

SP returned:

- `result`: `0`
- `message`: `확정 완료`

After repair:

- `20-01`: `21`
- `20-02`: `21`
- `21-01`: `21`
- `21-02`: `21`

This matches the expected stock path:

`19-02 stock 688 - 20-01 shipment 662 - quarantine deduction 5 = 21`

## Follow-up Repair For 22+ Weeks

After the first repair, `22-01` and later still showed `683`.

Observed snapshots before the follow-up repair:

- `21-03`: `21`
- `22-01`: `683`
- `22-02`: `683`
- `23-01`: `683`
- `23-02`: `683`

This happened because the `22-01` `StockMaster` row had its own later week snapshot chain and was not corrected by the initial `20-01` recalc.

Executed official SP again from the affected future boundary:

```sql
EXEC dbo.usp_StockCalculation
     @OrderYear = '2026',
     @OrderWeek = '22-01',
     @ProdKey = 3074,
     @iUserID = '<logged-in user>';
```

SP returned:

- `result`: `0`
- `message`: `확정 완료`

Final verified snapshots:

- `20-01`: `21`
- `20-02`: `21`
- `21-01`: `21`
- `21-02`: `21`
- `21-03`: `21`
- `22-01`: `21`
- `22-02`: `21`
- `23-01`: `21`
- `23-02`: `21`

## Full Future Sweep

User reported that the bad stock value reappeared after `22` weeks, so the audit was expanded from `20-01` through all visible future `2026` stock masters.

Additional stale boundaries found:

- `24-01`: `683`
- `26-01`: `683`
- `50-01`: `683`

Each boundary was repaired with the official stock calculation SP only. No direct quantity or stock table update was used.

Executed:

```sql
EXEC dbo.usp_StockCalculation
     @OrderYear = '2026',
     @OrderWeek = '24-01',
     @ProdKey = 3074,
     @iUserID = '<logged-in user>';

EXEC dbo.usp_StockCalculation
     @OrderYear = '2026',
     @OrderWeek = '26-01',
     @ProdKey = 3074,
     @iUserID = '<logged-in user>';

EXEC dbo.usp_StockCalculation
     @OrderYear = '2026',
     @OrderWeek = '50-01',
     @ProdKey = 3074,
     @iUserID = '<logged-in user>';
```

All three SP calls returned:

- `result`: `0`
- `message`: `확정 완료`

Final full future audit for `ProdKey 3074`:

- `20-01`: `21`
- `20-02`: `21`
- `21-01`: `21`
- `21-02`: `21`
- `21-03`: `21`
- `22-01`: `21`
- `22-02`: `21`
- `23-01`: `21`
- `23-02`: `21`
- `24-01`: `21`
- `24-02`: `21`
- `25-01`: `21`
- `25-02`: `21`
- `26-01`: `21`
- `27-01`: `21`
- `28-01`: `21`
- `29-01`: `21`
- `30-01`: `21`
- `50-01`: `21`

Conclusion: the product's visible 2026 future stock snapshots are now consistent. The repair used the same official `usp_StockCalculation` path that `nenova.exe` depends on, so no web-only stock structure was introduced.
