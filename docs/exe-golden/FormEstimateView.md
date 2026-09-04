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

### 웹 딥링크 (영업지원 → 견적서)

`/estimate?popup=1&year=YYYY&week=WW&custKey=&custName=&includeUnfixed=1&highlightDeductions=1`
는 기존 `GetData`/`GetDetail` 조회만 재사용한다. 선택한 `OrderYear + 부모 OrderWeek + CustKey`
견적서를 열고 불량차감 행을 강조할 뿐 Estimate INSERT/UPDATE를 실행하지 않는다.

`previewCapture=1`은 영업지원 처리상태 옆 캡쳐용이다. 출고 목록·필터·편집 버튼을 숨기고
견적서 목록만 보여 주며, 같은 GetDetail 조회만 한다. Estimate 원장은 변경하지 않는다.

영업지원 처리상태의 `수동처리완료`도 Estimate를 만들지 않는다. 수기 처리한
`WebSalesDefectDeduction`만 `Status=MANUAL_COMPLETED`로 표시하고
`WebSalesDefectDeductionHistory.ActionType=MANUAL_COMPLETE` 이력을 남긴다.

## 웹 견적서 인쇄의 Estimate 등록행 누락 방지

정상 출고(`ShipmentDate`)에는 EXE와 같이 `PeriodDay` 요일 필터를 적용한다. 반면
불량·검역·단가차감·판매요청 등 이미 `Estimate`에 등록된 행은 거래처·차수의
`ShipmentMaster` 범위 안에서 모두 인쇄한다. 레거시 등록행 중에는 `EstimateDtm`의
시간부가 `PeriodDay.BaseYmd`와 다르거나 과거 `EstimateType` 코드가 남아 있는 경우가
있어, 이를 필수 `JOIN`으로 처리하면 웹에 등록된 행이 인쇄 전에 조용히 사라진다.
웹은 `CodeInfo`를 보조 `LEFT JOIN`으로 사용하고 유형 코드 자체를 fallback으로
표시하며, 이 보강은 읽기 전용 출력 경로에서만 동작하고 Estimate 원장을 수정하지
않는다.

### 웹 인쇄 — 불량차감 적요 기본 미표시

EXE `ReportEstimate`는 `GetPrintDetail`의 `Descr`을 그대로 적요에 바인딩한다.
웹 인쇄는 정상출고·검역·단가차감 **사용자 직접 입력** 적요만 유지한다.
웹 수량수정 운영로그(`재용3>2`)와 SqlClient 트리거 감사줄은 견적서 비고/적요에
올리지 않는다. **불량차감 적요**는 화면·인쇄 모두 기본 숨기고, 인쇄 다이얼로그의
`불량차감 적요 표시`를 켠 경우에만 `Estimate.Descr`을 출력한다. 영업지원 전산등록은
`Estimate.Descr`을 비워 저장한다.

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
4. 확정 행도 서버 잠금 아래 확정 상태를 유지한 채 증감분과 재고를 같은 거래에서 반영한다. 기존 행 수량 수정은 차수 전체 확정취소 → 재확정 사이클을 실행하지 않는다.

`OrderDetail`은 이 결합 저장에서 직접 변경하지 않는다. 출고일 수량을 0으로 만들어
해당 `ShipmentDetail` 총량이 0이 되면 EXE `GetDetail`의 `EstQuantity > 0` 조건과 같이
견적서에서 숨기기 위해 `ShipmentFarm`/`ShipmentDate`/`ShipmentDetail`을 purge한다.
주문수량이나 농장배정만 따로 바꾸는 작업은 차수피벗/출고분배의 별도 계약을 따른다.

## 확정현황 조회의 선택연도 범위

`FormEstimateView.GetData/GetDetail`은 표시 대상 출고를 연도와 차수가 결합된
`OrderYearWeek/OrderYearWeek2`로 조회한다. 웹의 확정현황 사전조회도 화면이 선택한
`OrderYear`를 별도 요청 필드로 전달하고 `ShipmentMaster.OrderYear + OrderWeek`가 모두
일치하는 행만 사용한다. `29-02` 같은 짧은 차수를 서버 현재 연도로 보정하거나 전년도
동일 차수와 합치지 않는다. 이 사전조회는 읽기 전용이며 `Estimate`, 주문, 출고수량,
출고일, 농장배정, 재고를 변경하지 않는다. 사용자가 확정취소를 실행한 경우에만 EXE와
같은 확정취소 SP와 해당 선택연도 품목의 재고계산을 수행한다.

2026-08-10 운영 read-only probe에서 동일 `29-02`가 2025년에는 `NO_SHIPMENT`
(master 1, detail 0), 2026년에는 `FIXED_PENDING_STOCK`(master 34, detail 211)로 서로
다른 상태임을 확인했다. 연도를 포함한 요청에서는 두 결과가 분리되었고, 원장 쓰기나
확정/확정취소 호출은 실행하지 않았다.

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
- `FormEstimateAdd.btnSave_Click`은 입력한 `ProdKey`와 별도로 선택된 `ShipmentKey`를
  `ClassEstimate.Insert()`에 전달한다. 따라서 불량차감의 `Estimate.ProdKey`가 해당
  차수의 정상 출고 품목과 다르더라도, `ShipmentKey`가 같은 업체·차수의 EXE 확정 출고를
  가리키면 등록할 수 있다. 웹 목록·미리보기·사전검증·등록 직전 재검증도 이 고객 단위
  ShipmentKey scope를 사용하고, 분배단가는 차감 품목의 과거 이력에서 별도로 조회한다.
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
않는다. 이전 차수 분배 단가가 없으면 영업지원에서 단가를 직접 입력·저장할 수 있다.
2026-08-26 decompile 원문 재확인: `FormEstimateAdd.CheckValue`는 speCost 0을 거부하고,
`btnSave_Click`은 입력한 speCost를 `ClassEstimate.Cost`로 전달한다. `ClassEstimate.Insert`
는 그 값을 Estimate에 저장하며 주문·출고·재고 단가를 변경하지 않는다.
웹 직접입력 값은 원장키·적용연도/차수·업체·품목·단위가 일치할 때만 적용하고,
목록/미리보기/사전검증/저장 트랜잭션이 동일 단가 선택 helper를 사용한다.

`FormEstimateAdd`가 받는 적용 출고는 `ShipmentMaster`만으로 판단하지 않는다. 웹은 같은
연도·적용 부모차수·거래처의 활성 `ShipmentMaster + ShipmentDetail + ShipmentDate +
PeriodDay` 행 중 `ShipmentDetail.OutQuantity > 0`인 실제 분배를 직접 확인하고 해당 업체의
활성 `ShipmentKey`를 선택한다. 사용자 업무 기준에 따라 Master/Detail 확정 여부와
`ImportConfirmed`는 eligibility에 사용하지 않는다. `FormEstimateAdd`는
`ShipmentKey`와 사용자가 고른 `ProdKey`를 독립적으로 저장하므로, 선택한 불량 품목이
그 판매행의 품목과 달라도 `Estimate.ProdKey`·단가·단위는 선택 품목을 보존하고
`ShipmentKey`만 해당 업체의 확정 판매행에서 결정한다. `FormEstimateView.GetDetail`은 출고일별
`ShipmentDate.EstQuantity`가 0인 행도 반환하므로 이를 대상 `ShipmentKey` 존재 조건으로
추가하지 않는다. 따라서 웹에서 보이는
원장 행이 EXE 견적서관리에서 보이지 않는 ghost shipment에 잘못 연결되지 않는다.

### 2026-08-18 상희꽃상사 read-only probe

운영 원장은 변경하지 않고 확인했다.

- 적용 범위: `OrderYear=2026`, `OrderWeek='33-01'`, `CustKey=401` (상희꽃상사)
- 안전한 적용 출고: `ShipmentKey=5808`, `ShipmentMaster.isFix=1`, 활성 상태
- 해당 출고의 `ShipmentDetail` 9/9행이 `isFix=1`; `CARNATION Novia` (`ProdKey=456`)와
  `CARNATION Moon Light` (`ProdKey=447`)가 모두 존재한다.
- 두 품목에서 `ViewShipment.DetailFix=0`이지만, 이는 raw Master/Detail 확정 상태와
  불일치한 조회값이다. 따라서 불량차감 Estimate 적용 출고의 eligibility는 이 View 값이
  아니라 위 원장 확정 상태를 사용한다.

이 probe는 `SELECT`만 실행했으며 `OrderDetail`, `Shipment*`, `Stock*`, `Estimate`를 변경하지 않았다.

차감 원장의 `OrderYear/OrderWeek`는 불량이 발생한 원차수로 보존한다. 원차수보다 뒤의
적용 대상 차수에 위 판매행이 있으면 `Estimate`는 그 적용 대상의 `ShipmentKey`와
`EstimateDtm`으로 저장하고, `AppliedOrderYear/AppliedOrderWeek/AppliedShipmentKey` 및
단가 원천 차수를 원장에 기록한다. 대상 판매행이 없으면 `Estimate`를 만들지 않고
영업지원 목록에서 이월 대기로 표시한다. 이후 해당 차수에 판매행이 생긴 뒤 다시 등록할
수 있다. 이 구조로 27차 재고를 28차에 사용하거나 29차 입고를 28차에 앞당겨 사용하는
경우에도 원차수와 실제 견적 적용 차수를 잃지 않는다.

## 견적서관리 직접 입력 — 불량차감등록 / 판매요청

견적서관리에서 거래처를 조회·선택한 뒤 기존 불량/검역 EstimateType 선택 흐름과
신규 불량차감·판매요청 흐름을 서로 독립적으로 사용한다.

| 버튼 | 수량 부호 | 대상 확인 | 원장 영향 |
|---|---:|---|---|
| 불량/검역등록(기존) | 음수 (`-` 체크 필수) | 사용자가 선택한 EstimateType + 해당 차수 EXE 확정 판매행 | `Estimate`만 INSERT |
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
기존 `ShipmentDate` 수정 경로를 확장한 서버 잠금 기반 확정상태 보존 저장을 사용한다.
단가만 변경할 때는 아래 2026-08-26 검증에 따라 플래그와 재고를 보존하는 금액 전용
`ShipmentDetail`/`ShipmentDate` 저장 경로를 사용한다. `Estimate` 차감행은 변경하지 않는다.

## 2026-08-10 선택연도 저장 회귀 재검증

`FormEstimateView.GetData/GetDetail`의 표시 범위는 `OrderYearWeek/OrderYearWeek2`이고,
단가 저장 대상은 `ShipmentKey`로 연결된 `ShipmentMaster`와 `ShipmentDetail/ShipmentDate`다.
따라서 물리적 수량 변경의 확정상태 보존 저장은 짧은 `32-02`만 전달하지 않고 화면의
`OrderYear`를 반드시 함께 전달한다. 추가 품목 생성 때만 사용하는 범위 제한 확정 사이클도
같은 연도 규칙을 따른다. `/api/estimate/update-cost`도 `ShipmentMaster`를
`UPDLOCK/HOLDLOCK`으로 읽어 요청 연도·거래처와 실제 `OrderYear/CustKey`가 일치할 때만
`ShipmentDetail.Cost/Amount/Vat`와 연결 `ShipmentDate.Cost/Amount/Vat`를
수정한다. 2026-08-26부터 단가 전용 저장에서는 기존 EstQuantity를 재계산하지 않는다.
불일치 시 전체 트랜잭션을 중단한다.

추가 품목의 자동 편집 사이클은 `force=false`로 확정취소/재확정을 호출한다. `force`는 음수재고
검사를 건너뛰지는 않지만, 뒤 차수 확정 경고를 우회할 수 있으므로 자동 저장에서는
사용하지 않는다. 재확정 중 음수재고가 확인되면 기존 `autoStockAdd +
confirmAutoStockAdd` 명시 확인 계약 없이는 재고조정 원장을 만들지 않는다.

웹 전용 `WeekProdCost`는 `OrderWeek`가 매년 반복되는 점을 반영해 신규 저장·조회 키를
`OrderYear + OrderWeek + CustKey + ProdKey`로 사용한다. 기존 연도 컬럼이 없던 행은
연도를 추정해 채우지 않고 `NULL`로 보존하여, 선택연도 단가 조회에 섞이지 않게 한다.
이 보강은 `OrderDetail`, `ShipmentDetail.OutQuantity`, `ShipmentFarm`, `Estimate` 행을
추가·삭제하지 않는다.

견적 조회는 화면의 선택 `OrderYear`와 대차수로 `OrderYearWeek`를 구성한다. 같은 대차수의
최근 `ShipmentMaster`를 찾아 연도를 추정하지 않으며, 미확정 fallback 조회와 주문/출고
불일치 진단도 `OrderYear`를 함께 제한한다. 조회 요청은 테이블 생성·ALTER를 실행하지 않는다.
`WeekProdCost` 스키마 변경은 명시적 migration으로 분리하고 저장 시에는 read-only schema
probe만 수행한다.

## 웹 부가세 미분류 견적서 인쇄

저장 분배단가(`ShipmentDetail.Cost`)는 부가세 포함 입력이다. EXE `ReportEstimate` 기본 견적서는
그 단가로 저장된 `Amount`/`Vat` 분리를 그대로 인쇄한다.

웹 인쇄 설정의 「부가세 미분류 견적서」는 같은 품목·수량을 읽되, 분배단가 숫자를 공급가 단가로
보고 `공급가액 = 단가 × 수량`, `부가세 = 공급가액 × 10%` 로만 다시 계산한다. 인쇄와 Excel이
같다. 이 계산은 출력에만 쓰이며 `ShipmentDetail`/`Estimate` 원장은 변경하지 않는다.

## 2026-08-26 확정 단가 전용 저장 재검증

- 설치 EXE SHA256: `4033996D20006213BD7D7C5454396421FC18B3836CCB7F2C47B1CB8C93C1BD63`.
- dnSpy CLI 재대조: `FormShipmentDistribution.btnSave_Click`는 수량 불변일 때
  `ClassShipmentDate.UpdateCost`를 호출하며, 저장된 EstQuantity로 Amount/Vat만 재계산한다.
- 운영 SELECT: ShipmentMaster/ShipmentDate/CustomerProdCost 트리거 없음. ShipmentDetail의
  수량 로그 트리거는 UPDATE(OutQuantity)에만 반응. Estimate 비고 정리 트리거는 기존 동작 유지.
- 실제 usp_ShipmentFix/usp_ShipmentFixCancel에는 단가 되돌림 SQL이 없고 재고/StockHistory 쓰기는 있다.
- 웹 금액 전용 API는 이 결과를 따르되 확정 플래그 자체를 보존한다. EXE에 '재고 없는 확정취소'가
  있다고 주장하지 않는다. 수량/신규분배 변경은 기존 확정 사이클과 후속 차수 가드를 유지한다.
- 날짜별 Cost와 표시용 fallback Cost를 분리해 DateCost로 비교한다. 수량·비고 동시 저장 후에는
  해당 저장의 성공 응답 기준값으로 다음 단가 요청을 구성한다. 최신 GET으로 stale 검사를 우회하지 않는다.
- 업체 지정단가는 동일 거래처+품목의 견적 단위 가격을 금액 저장과 같은 트랜잭션으로 갱신한다.
  다른 차수 출고의 저장 Cost를 직접 갱신하지 않는다. 기존 지정단가 fallback 조회 효과는 별개다.
- 실데이터 근거와 부작용 표: `docs/work-reports/2026-08-26_estimate-cost-no-stock-design.md`.
  운영 원장 저장 시험은 수행하지 않았다.

## 2026-08-26 불량·검역차감 체크 선택 삭제

실제 CLI `--md 0x0600011B`로 재확인한 `ClassEstimate.Delete`는
`DELETE FROM Estimate WHERE EstimateKey=...`만 수행한다.
`FormEstimateView.groupControl3_CustomButtonClick`은 정상출고 Sort=0을 거부하고
차감 삭제 확인 후 이 메서드를 호출하여 GetDetail을 새로 불러온다.
확정해제·재확정·재고계산 호출은 없다.

웹은 사용자 요청 범위에 맞춰 CodeInfo의 불량차감/검역차감이면서 음수인 행만
체크 삭제한다. 같은 업체의 부모차수에 여러 세부차수가 있어도 모든 요청의
OrderYear/CustKey/ShipmentKey/EstimateKey와 조회 스냅샷을 잠금 대조한다.
선택 외 정상출고·판매요청·다른 차감·다른 연도는 보존한다.
영업수입불량차감 원본과 과거 이력은 지우지 않고 선택한 견적 등록만 해제한다.
삭제 감사와 연결 해제는 같은 트랜잭션으로 처리하며 실패 시 전체 취소한다.

운영 SELECT에서 Estimate DELETE 트리거/참조 외래키가 없음을 확인했다.
실제 CodeInfo는 불량차감 KR0009/0010/0011/0020/0024,
검역차감 KR0012/0013/0014/0019이고 샘플·판매요청·단가차감도 별도 존재한다.
2025/2026 동일 34-01과 2026-34-02에 확정 차감이 있어 교차연도 fixture로 고정한다.
근거·부작용·검사 결과: `docs/work-reports/2026-08-26_estimate-deduction-delete.md`.

## 2026-09-04 편집 화면의 실제 행 식별

`FormEstimateView.GetDetail`의 정상출고 수량 저장 대상은 `ShipmentDate.SdateKey`,
불량·검역 차감의 저장 대상은 `Estimate.EstimateKey`다. 품목명·출고일이 같아도
`SdateKey`가 다르면 서로 다른 실제 출고행이므로 각각 별도 입력칸으로 유지한다.

EXE 호환 조회의 `ViewShipment`와 `ViewOrder` 결합에서 같은 업무키의 주문행이 여러 건이면
하나의 `SdateKey`가 조회 결과에 반복될 수 있다. 이 경우 웹은 같은 실제 기본키만 한 번
표시한다. 서로 다른 `SdateKey`를 품목명이나 날짜가 같다는 이유로 합치지 않는다.
이 정리는 조회 결과와 브라우저 입력 상태에만 적용하며 ERP 원장을 추가·수정·삭제하지 않는다.
