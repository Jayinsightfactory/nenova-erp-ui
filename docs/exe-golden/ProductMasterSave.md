# Product master shared-data compatibility (2026-10-19)

Actual CLI: `dnSpy.Console.exe --no-color -t FormProductAdd "C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe"`; same ClassProduct/FormProductInfo.
FormProductInfo uses active Product and ProdKey. FormProductAdd.CheckValue requires name/country/flower/units. btnSave_Click uses Country.isSelectFlower=1 ? CounName : CounName+FlowerName and independent spnBox => SteamOf1Box. Unit changes warn that historical quantities are not converted. ClassProduct.Insert/Update writes Product and audit IDs/times, not order/shipment/estimate ledgers. This web change does not copy native Stock writes.

Read-only DB probe: active3354, CountryFlower mismatch0, independent box stem differences584 including NULL/215 non-NULL. ProdKey338:15*20 != saved0. Product trigger only normalizes tiny Stock when UPDATE(Stock); no classification/units trigger. Prior audit EXE SHA2564033996D20006213BD7D7C5454396421FC18B3836CCB7F2C47B1CB8C93C1BD63.

Criteria/side effects declared before code in product-save-compat.json. Existing fields omitted/null/0 preserved; explicit changed values validated against current codes under lock. CountryFlower recomputed only on country/flower change or create, never merely displaying web grouping. No DDL, operating data repair, SP calls or stock write. Master values can affect future reads/calculations, so explicit unit change confirms this; historical Amount/Vat/isFix/EstQuantity remain unchanged. Fixture must preserve 2025/2026 same-week ledgers and roll back on stale/readback/audit failure.
