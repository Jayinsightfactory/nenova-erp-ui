# FormEstimateView — exe golden (dnSpy)

Source: `C:\Users\USER\nenova-decompiled\Nenova\FormEstimateView.cs`

Web: `pages/estimate.js` + `pages/api/estimate/index.js` + `lib/exeEstimateViewSql.js`

## 메서드 ↔ 웹

| exe | SQL 요일 필터 | nenovaweb |
|-----|--------------|-----------|
| `GetData()` | `pd.WeekDay IN (ccmbWeekDay)` | `sqlEstimateGetData` + API `weekDays` |
| `GetDetail(custKey)` | **없음** (그리드 `ActiveFilterString`) | `sqlEstimateGetDetail` + `filterItemsByExeWeekDay` |
| `GetPrintDetail(custKey)` | `pd.WeekDay IN (...)` | `sqlEstimateGetPrintDetail` + `printDetail=1` |
| `GetExcelDetail(custKey)` | `pd.WeekDay IN (...)` | `view=excelDetail` + `sqlEstimateGetExcelDetail` |

## GetData 핵심 조건

- `sm.OrderYearWeek = @orderYearWeek`
- `OrderMaster` JOIN (`om.isDeleted = 0`)
- `sd.isFix = 1` (ShipmentMaster.isFix 아님)
- `sdd.EstQuantity > 0`
- 금액: `sdd.Amount + sdd.Vat` (+ Estimate UNION)

## GetDetail 핵심 조건

- `ViewShipment` + `ViewOrder` INNER JOIN
- `vs.DetailFix = 1`
- `ISNULL(vs.EstQuantity,0) > 0`
- 단가/금액: `sdd.Cost`, `sdd.Amount`, `sdd.Vat`
- 요일: 로드 후 `WeekDay IN (2,3,4,5,6,7,1)` 그리드 필터 (CodeInfo WeekDay)

## ccmbWeekDay 기본값

`2, 3, 4, 5, 6, 7, 1` → 월~일 (일=1)

## 검증

```powershell
npm run test:estimate
node scripts/probe-estimate-exe-parity.mjs 26
```
