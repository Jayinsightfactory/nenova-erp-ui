# FormEstimateView — exe golden (dnSpy)

Source: `C:\Users\USER\nenova-decompiled\Nenova\FormEstimateView.cs`

Web: `pages/estimate.js` + `pages/api/estimate/index.js` + `lib/exeEstimateViewSql.js`

## 품목 선택 검색 순서

견적서관리의 불량차감등록·판매요청 품목 선택은 `Product` 원문을 보존한 읽기 전용
검색이다. 후보는 기존 주문등록 매칭 엔진과 같은 자연어 일치도를 먼저 적용하고,
동일·유사 후보 사이에서는 `OrderDetail`의 실제 사용량(최근 2년 사용량 가중)과
저장된 매칭 빈도를 사용해 자주 쓰는 품목을 먼저 보여준다. 이 검색은
`OrderDetail`, `ShipmentDetail`, `Estimate`, 재고 원장을 변경하지 않는다.

예를 들어 `MOON LIGHT`/`문라이트` 검색은 `CARNATION Moon Light`와 같은 직접
일치 후보를 `Candlelight`보다 우선하며, 같은 품목명이 여러 국가·화종에 있으면
실제 사용량이 높은 후보가 먼저 표시된다. 사용자가 후보를 선택하기 전에는
`ProdKey`를 저장하거나 견적서 행을 생성하지 않는다.

## 메서드 ↔ 웹

| exe | SQL 요일 필터 | nenovaweb |
|-----|--------------|-----------|
| `GetData()` | `pd.WeekDay IN (ccmbWeekDay)` | `sqlEstimateGetData` + API `weekDays` |
| `GetDetail(custKey)` | **없음** (그리드 `ActiveFilterString`) | `sqlEstimateGetDetail` + `filterItemsByExeWeekDay` |
| `GetPrintDetail(custKey)` | `pd.WeekDay IN (...)` | `sqlEstimateGetPrintDetail` + `printDetail=1` |
| `GetExcelDetail(custKey)` | `pd.WeekDay IN (...)` | `view=excelDetail` + `sqlEstimateGetExcelDetail` |

### 웹 견적서 인쇄의 Estimate 등록행 누락 방지

정상 출고(`ShipmentDate`)에는 EXE와 같이 `PeriodDay` 요일 필터를 적용한다. 반면
불량·검역·단가차감·판매요청 등 이미 `Estimate`에 등록된 행은 거래처·차수의
`ShipmentMaster` 범위 안에서 모두 인쇄한다. 레거시 등록행 중에는 `EstimateDtm`의
시간부가 `PeriodDay.BaseYmd`와 다르거나 과거 `EstimateType` 코드가 남아 있는 경우가
있어, 이를 필수 `JOIN`으로 처리하면 웹에 등록된 행이 인쇄 전에 조용히 사라진다.
웹은 `CodeInfo`를 보조 `LEFT JOIN`으로 사용하고 유형 코드 자체를 fallback으로
표시하며, 이 보강은 읽기 전용 출력 경로에서만 동작하고 Estimate 원장을 수정하지
않는다.

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

## 불량/검역 차감 등록 — FormEstimateAdd / ClassEstimate

dnSpy CLI로 확인한 원본:

```powershell
& 'C:\Users\USER\Desktop\백업\다운로드\dnSpy-net-win32\dnSpy.Console.exe' --no-color -t FormEstimateAdd 'C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe'
& 'C:\Users\USER\Desktop\백업\다운로드\dnSpy-net-win32\dnSpy.Console.exe' --no-color -t ClassEstimate 'C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe'
```

decompile 원본은 `C:\Users\USER\nenova-decompiled\Nenova\FormEstimateAdd.cs`와
`ClassEstimate.cs`이다.

- `FormEstimateAdd.btnSave_Click`은 `EstimateType`, `EstimateDtm`, `ProdKey`, `Unit`,
  `Quantity`, `Cost`, `Amount`, `Vat`, `Descr`, `ShipmentKey`를 `ClassEstimate.Insert()`에 넘긴다.
- 차감 행은 `Estimate.Quantity`·`Amount`·`Vat`가 음수이고 `Cost`는 양수이다.
  금액 공식은 `Amount = Round(Quantity * Cost / 1.1, 0)`, `Vat = Quantity * Cost - Amount`이다.
- `ClassEstimate.Insert()`/`Update()`는 `Estimate`만 쓰고 `ShipmentDetail`, `ShipmentDate`,
  `OrderDetail`, 재고를 변경하지 않는다.
- `Estimate`에는 운영 트리거가 활성화될 수 있으므로 웹 신규 등록은 `OUTPUT INSERTED.EstimateKey`
  를 클라이언트로 직접 반환하지 않는다. `OUTPUT ... INTO @EstimateInserted`로 키를 캡처한 뒤
  같은 배치의 `SELECT`로 회수해야 `The target table 'Estimate' ... enabled triggers` 오류를 피할 수 있다.
- `FormEstimateView.GetData`/`GetDetail`은 Estimate 차감행에 `ShipmentMaster.OrderYearWeek`,
  `EstimateDtm`, `CodeInfo(EstimateType)`를 사용한다. 차감행에는 `isFix` 컬럼이 없고,
  `ShipmentDetail.isFix` 확정/해제 사이클을 실행하지 않는다.
- `ClassEstimate.Delete()`는 `DELETE FROM Estimate WHERE EstimateKey = ...`를 실행한다.
  웹의 영업수입불량차감 원장은 삭제 전/후 상태를 별도 이력 테이블에 남긴 뒤 동일하게
  연결된 `Estimate`를 삭제한다.

영업수입불량차감 웹 등록 규칙도 이 계약을 그대로 따른다. 예를 들어 29차를 등록할 때
단가는 28차 같은 연도·거래처·품목의 `ShipmentDate.Cost`를 우선하고, 없으면
`ShipmentDetail.Cost`를 사용한다. `CustomerProdCost`나 `Product.Cost`로 임의 대체하지
않으며, 이전 차수 분배 단가가 없으면 등록 전에 오류로 알린다.

등록 대상 출고는 `ShipmentMaster`만으로 판단하지 않는다. nenova.exe와 동일하게
`ViewShipment`와 `ViewOrder`를 `OrderYearWeek2 + CustKey + ProdKey`로 INNER JOIN하고,
`ShipmentDate`와 `PeriodDay`를 연결한 뒤 `DetailFix=1`, `ViewShipment.EstQuantity>0`,
`ShipmentDate.EstQuantity>0`을 모두 만족하는 판매행만 대상이 된다. 따라서 웹에서 보이는
원장 행이 EXE 견적서관리에서 보이지 않는 ghost shipment에 잘못 연결되지 않는다.

차감 원장의 `OrderYear/OrderWeek`는 불량이 발생한 원차수로 보존한다. 원차수보다 뒤의
적용 대상 차수에 위 판매행이 있으면 `Estimate`는 그 적용 대상의 `ShipmentKey`와
`EstimateDtm`으로 저장하고, `AppliedOrderYear/AppliedOrderWeek/AppliedShipmentKey` 및
단가 원천 차수를 원장에 기록한다. 대상 판매행이 없으면 `Estimate`를 만들지 않고
영업지원 목록에서 이월 대기로 표시한다. 이후 해당 차수에 판매행이 생긴 뒤 다시 등록할
수 있다. 이 구조로 27차 재고를 28차에 사용하거나 29차 입고를 28차에 앞당겨 사용하는
경우에도 원차수와 실제 견적 적용 차수를 잃지 않는다.

## 견적서관리 직접 입력 — 불량차감등록 / 판매요청

견적서관리에서 거래처를 조회·선택한 뒤 두 입력 모드를 사용한다.

| 버튼 | 수량 부호 | 대상 확인 | 원장 영향 |
|---|---:|---|---|
| 불량차감등록 | 음수 (`-` 체크 필수) | 해당 차수의 EXE 확정 판매행이 있어야 함 | `Estimate`만 INSERT |
| 판매요청 | 양수 (`-` 체크 해제) | 선택 거래처의 현재 `ShipmentKey` 사용 | `Estimate`만 INSERT |

품목을 Product DB에서 검색·선택하면 웹이 `/api/estimate?view=defectContext`를 호출해
이전 부모차수의 `ShipmentDate.Cost`/`ShipmentDetail.Cost` 중 최근 유효 분배단가를
자동 표시한다. 단위는 사용자가 `단/박스/스팀(대)` 중 선택하지만 `Estimate.Unit`에는
`Product.EstUnit`를 우선 기록해 EXE 원본 단위 계약을 보존한다. 금액은
`Amount = Round(Quantity * Cost / 1.1, 0)`, `Vat = Quantity * Cost - Amount`의 부호를
수량과 함께 적용한다.

불량차감은 `ViewShipment + ViewOrder + ShipmentDate + PeriodDay + DetailFix=1` 판매행이
없으면 등록하지 않고 구체적인 이월 안내를 반환한다. 판매요청은 선택된 거래처의 출고키에
양수 Estimate를 기록한다. 두 모드 모두 `OrderDetail`, `ShipmentDetail`, `ShipmentDate`,
재고, 손익 원장은 변경하지 않으며, Estimate 트리거와 충돌하지 않도록
`OUTPUT INSERTED.EstimateKey INTO @EstimateInserted`를 사용한다.

## 기존 견적 행 정보창 편집 — 웹 보강

견적서관리에서 품목명을 선택하면 해당 행의 정보창을 연다. 행에
`EstimateKey`가 있으면 `ClassEstimate.Update`와 같은 범위로
`Estimate.ProdKey/Unit/Quantity/Cost/Amount/Vat/Descr/EstimateDtm`만 저장한다.
기존 `ShipmentKey`와 불량차감 음수·판매요청 양수 부호는 보존하고, 저장 전
수량·단가 스냅샷을 확인해 다른 사용자의 변경을 덮어쓰지 않는다. `Estimate`에
운영 트리거가 있을 수 있으므로 직접 `OUTPUT`을 쓰지 않고 UPDATE 뒤 SELECT로
재조회한다.

정상출고(`SdetailKey`/`SdateKey`)를 선택한 경우 품목명과 단위는
`ShipmentDetail` 원장과 연결되어 있어 정보창에서 변경하지 않는다. 수량은
기존 `ShipmentDate` 수정 경로, 단가는 기존 `ShipmentDetail` 단가 수정 경로와
확정취소·저장·재확정 사이클을 사용한다. 이 보강은 `OrderDetail`, 재고,
`Estimate` 차감행을 변경하지 않는다.
