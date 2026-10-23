# Dutch volume distribution — native evidence, 2026-10-05

## 2026-10-23 중국 신규 주문 재감사
- 실제 EXE FormOrderAdd/FormShipmentDistribution CLI를 재실행했다. FormOrderAdd의 CellValueChanged는 박스/단/송이 환산열을 갱신하고 UnitQuantity(false)는 EstUnit의 열을 그대로 저장한다. 출고용 Est 정수 반올림을 주문에 적용하지 않는다.
- 중국 신규 주문만 chinaOrderUnits를 미리보기/쓰기/커밋전 readback에서 공유한다. 기존 주문 모든 열은 보존한다. 8단/80송이 품목의 신규 주문 Est8 복제 반례를 수정했고, 기존 주문100→분배80/날짜80 및 새 업체 주문8/분배8/Est80을 실제 격리 SQL로 검증했다.
- 삭제 헤더를 제외하지 않는 native GetShipmentMaster에 맞춰 중국 동일 연도·차수·업체의 삭제 헤더는 snapshot reader에서 preview/apply 모두 차단한다. 자동복구·삭제헤더 재사용·중복 신규생성은 하지 않는다. 전년도 삭제 헤더는 영향을 주지 않는다.
- 근거/운영 SELECT 기준선/MD 충돌: [재검토 기준표](../work-plans/2026-10-23-china-order-guard-review.md). 운영 쓰기 없음. 다른 source 신규 주문 정책은 변경하지 않았다.

## 2026-10-23 inline customer display
- Actual dnSpy.Console FormShipmentDistribution rerun; OrderYear/OrderWeek GetCustomerList and separate ShipmentDate/Farm write flow retained. No SQL/writer change.
- SELECT-only active Customer675 / CustArea27; ViewOrder43-02 counts2025=306,2026=385. 2026/43-02 joined shipment sample empty, not proof of applied distribution.
- Popup selection and matrix quantity edit remain drafts; immutable snapshot preserves customerArea and explicit customer key. Existing acknowledged preview/apply transaction/readback remains authoritative. Plan: work-plans/2026-10-23-dutch-inline-add.md.

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

## 2026-10-23 XLSX roundtrip recheck

Local installed dnSpy.Console.exe was run again against installed Nenova.exe, type FormShipmentDistribution. btnSave_Click still resolves ShipmentMaster/customer + ProdKey, BaseOutDay date, Out/Box/Bunch/Steam/Est quantities and rounded EstQuantity-based Amount/Vat; quantity changes replace dates, price-only uses UpdateCost, changed farm rows require valid FarmKey, and the batch commits via ExcuteTransaction.

SELECT-only probe `scripts/probe-dutch-roundtrip-read.cjs`: 2026/43-02/CustKey533/ProdKey1487 had OutQuantity200, DetailFix1, Amount381818, Vat38182, exact native PeriodDay join1, farm rows0. Same scope fixed totals: 5 rows, Amount2127273, Vat212727. Prior preflight ViewOrder same short week counts: 2025=306, 2026=385. No production data was changed.

This patch changes workbook serialization/import only. It does not change native SQL writers, confirmation, stock, estimate or profit ledgers. Actual download→import input was passed to the existing isolated MSSQL preview/apply harness: added customer and edited quantities yielded the same final plan; native joins, blank/zero prices, unit conversion, old-year sentinels, order/downstream preservation and rollback passed. No production apply test was performed.
