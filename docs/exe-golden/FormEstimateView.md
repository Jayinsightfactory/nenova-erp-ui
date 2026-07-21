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

## 수량 저장 — dnSpy CLI 확인

확인 명령:

```powershell
& 'C:\Users\USER\Desktop\백업\다운로드\dnSpy-net-win32\dnSpy.Console.exe' --no-color -t FormEstimateView 'C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe'
```

decompile 원본: `C:\Users\USER\nenova-decompiled\Nenova\FormEstimateView.cs` 및 `ClassShipmentDate.cs`.

`FormEstimateView.GetDetail`은 정상출고 행의 `ShipmentDate.SdateKey`를 `DetailKey`로 노출하고,
각 출고일의 `ShipmentDate.EstQuantity`를 `EstQuantity`로 표시한다. `TotalQuantity`는 같은
`OrderYearWeek + CustKey + ProdKey`의 `ViewShipment.EstQuantity` 합계다.

`btnSave_Click`은 `Sort=0` 정상출고 행을 `ProdKey`별로 묶어 모든 출고일 `EstQuantity` 합계가
`TotalQuantity`와 같은지 먼저 확인한다. 수정된 행은 `DetailKey`를 `ClassShipmentDate.SdateKey`로
사용해 `ClassShipmentDate.Update()`를 호출한다.

`ClassShipmentDate.Update()`의 실제 저장 범위는 다음과 같다.

```sql
UPDATE ShipmentDate
   SET EstQuantity = @EstQuantity,
       Amount = @Amount,
       Vat = @Vat,
       Descr = @Descr
 WHERE SdateKey = @SdateKey
```

따라서 견적서 관리의 출고일별 수량 수정은 `ShipmentDetail`·`ShipmentDate.ShipmentQuantity`·
`OrderDetail`·재고를 변경하지 않는다. `ShipmentQuantity`와 `ShipmentDetail.OutQuantity`를
변경하는 물리적 출고/분배 수량 수정은 `FormShipmentDistribution` 경로의 별도 작업이다.

## 웹 견적서의 출고일 증감 결합 정책

사용자 업무 요구가 “견적서관리에서 출고일 수량을 180→190으로 입력하면 실제 출고도
200→210으로 늘리고 확정까지 복구”하는 경우에는 위 `FormEstimateView` 단순 저장과
구분한다. 웹 `/api/estimate/update-date-quantity`는 `FormShipmentDistribution` 날짜 탭의
저장 규칙을 결합해 다음 순서로 처리한다.

1. 선택한 `SdateKey`의 `ShipmentDate.ShipmentQuantity`를 환산 단위 기준으로 변경한다.
2. 같은 `SdetailKey`의 `ShipmentDetail.OutQuantity/BoxQuantity/BunchQuantity/SteamQuantity`
   총량을 기존 날짜분포의 증감으로 갱신한다.
3. `ShipmentDetail`과 `ShipmentDate`의 `EstQuantity/Amount/Vat`를 다시 계산한다.
4. 확정 행이면 웹 화면이 확정취소 → 저장 → 재확정 사이클을 실행한다.

`OrderDetail`과 `ShipmentFarm`은 이 결합 저장에서 직접 변경하지 않는다. 주문수량이나
농장배정까지 바꾸는 작업은 각각 차수피벗/출고분배의 별도 계약을 따른다.
