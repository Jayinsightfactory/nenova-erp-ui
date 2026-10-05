# Dutch volume distribution — native evidence, 2026-10-05

## Actual CLI execution

Source EXE: `C:/Program Files (x86)/Wooribnc/Nenova/Nenova.exe`.
Executed on the local host (not a remembered decompilation):

```powershell
& 'C:/Users/USER/Desktop/백업/다운로드/dnSpy-net-win32/dnSpy.Console.exe' --no-color -t FormShipmentDistribution 'C:/Program Files (x86)/Wooribnc/Nenova/Nenova.exe'
& 'C:/Users/USER/Desktop/백업/다운로드/dnSpy-net-win32/dnSpy.Console.exe' --no-color -t ClassShipmentDate 'C:/Program Files (x86)/Wooribnc/Nenova/Nenova.exe'
```

- `FormShipmentDistribution.GetCustomerList` reads ViewOrder/ViewShipment with OrderYear+OrderWeek and joins ShipmentDate.
- `btnSave_Click` assigns ShipmentMaster, ProdKey, actual customer BaseOutDay shipment date and Out/Box/Bunch/Steam/Est quantities to ClassShipmentDetail, then Cost/Amount/Vat.
- Amount uses rounded EstQuantity and VAT-inclusive unit cost. Quantity changes cause ShipmentDate delete/insert; otherwise ClassShipmentDate.UpdateCost updates Cost/Amount/Vat only.
- Farm writes only occur for explicitly changed farm grid rows with a valid FarmKey.
- `uspShipmentFix` and `uspShipmentFixCancel` are separate native buttons with stock effects; this feature must not invoke them automatically.
- `ClassShipmentDate.UpdateCost`: `Amount = ROUND(Cost * ROUND(EstQuantity,0) / 1.1,0)`, VAT is rounded-quantity gross minus Amount.

## Read-only DB evidence

The local `.tmp/dutch-read-probe.cjs` connected using existing local configuration and ran SELECT only. Credentials were not printed. Five 2026/40-01/CustKey533 Netherlands samples had matching ViewOrder/ViewShipment, equal date sums, no farm rows, and fixed details. Representative sample ProdKey2231 / SdetailKey94299: 100 송이, EstUnit 송이, Cost2100, DetailFix1, each View count1, DateQty100, FarmRows0.

ViewOrder Netherlands counts at the same short week40-01: 2025=14, 2026=35. Short week alone is not a valid scope.

Additional SELECT-only downstream probe on 2026-10-05: sample SdetailKey94299 had Amount190909, Vat19091, isFix1, one exact ShipmentDate→PeriodDay match and one ViewShipment+ViewOrder+ShipmentDate+PeriodDay row with DetailFix1. Netherlands 2026/40-01 confirmed totals were 30 details, Amount10075454 and Vat1007546. These are observed baselines, not immutable totals or proof of completed write verification.

These are preflight read-only observations, not evidence that new writes passed. They demonstrate a real fixed blocker and cross-year data. No production source row was changed.

## Web feature boundary

User explicitly chose the same full CountryFlower replacement as existing Excel distribution: missing customer/product shipment50 becomes0; existing order is preserved. Preview must display existing/final/delta, including synthesized zero rows. CountryFlower is read from the active Product, not inferred from file display text.

User explicitly chose all input prices KRW. Blank means no price override; currency-less/EUR draft cannot be silently reused as KRW. The existing order-preserving import core is authoritative over older MD claims about overwriting positive orders.

Reuse existing import quantity/identity/numbering/snapshot pipeline and EXE monetary helper. Price and quantity must commit atomically. New feature must recheck locked scope/fixed state/snapshot, then verify OrderDetail, ShipmentDetail, ShipmentDate, ViewOrder/ViewShipment and money before and after commit. Unrelated Estimate, WebProfitReport, ProductStock, StockHistory, Warehouse, CustomerProdCost and Product.Cost are preserved. Native existing CustKey=NULL is not a repair target.

Implementation and test results are recorded separately; this evidence alone is not completion approval.
