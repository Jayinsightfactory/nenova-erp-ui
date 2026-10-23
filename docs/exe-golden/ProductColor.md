# Product color description — 2026-10-23

Actual dnSpy.Console.exe against C:/Program Files (x86)/Wooribnc/Nenova/Nenova.exe,
ClassProduct: Descr is loaded and included in native INSERT/UPDATE. No separate
color field. Web changes only Descr and LastUpdateID/Dtm, not the native full row.

Read-only production probe: Product.Descr nvarchar(200), LastUpdateID nvarchar(50),
LastUpdateDtm datetime. 1310 active Netherlands products, 905 null descriptions,
54 slash-segmented descriptions. SystemActionLog exists. Product trigger
trg_Product_NormalizeTinyStock returns when NOT UPDATE(Stock), so this writer
does not invoke stock normalization. No operational writes made in verification.

Policy: active ProdKey, UPDLOCK/HOLDLOCK, exact expected description including
NULL; recognized color prefix replacement only, unknown prose preserved behind
new prefix. Full resulting description confirmed by user. All fields read back;
audit failure and unexpected mutations roll back. Order/Shipment/Warehouse,
ShipmentDate/Farm, Estimate, profit and stock remain untouched across years.
