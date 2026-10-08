# FormWarehouse 입고 엑셀 업로드 — nenova.exe golden

## 2026-10-08 재검증 정정 — 아래 과거 요약보다 우선

- 실제 `CommonLogic`을 dnSpy CLI로 다시 확인했다. `CheckFixSave`는 같은 CountryFlower의
  현재 `ViewShipment.DetailFix=1`, 직전 `ISNULL(DetailFix,0)=0`, 직후 `DetailFix=1`을 검사한다.
  전후 차수는 달력 증감이 아니라 StockMaster.OrderYearWeek의 가장 가까운 `<`/`>` 행이다.
  연도 경계도 포함하고 수량/거래처/입고 대상 ProdKey로 추가 축소하지 않는다.
- **CheckFixSave 메서드가 있다는 것과 엑셀 업로드에서 호출된다는 것은 다르다.**
  실제 ExcelLoadingPackingList.CheckData의 품종 SQL은 INNER JOIN 뒤
  `ISNULL(p.ProdKey,0)=0`이 있어 정상 양수 품목에서는 루프가 비어 있을 수 있다.
  아래의 "대상 CountryFlower별 검사 통과"는 의도된 정책의 요약이며 실제 모든 업로드가
  이를 실행한다는 보장이 아니다. 웹은 의도된 CommonLogic 검사를 명시 적용한다.
- CommonLogic은 조회 예외를 0건으로 반환하지만 웹은 조회 실패 시 fail-closed 한다.
- 실제 운영 usp_CreateWarehouse는 공용 TempWarehouseDetail **전체**를 소비한다.
  아래의 기존 SP 재사용 권고는 새 인보이스 writer에 적용하지 않는다. 공용 staging을
  사용하지 않는 경로의 native 상세/StockHistory/Product.Stock/StockCalculation 효과를
  격리 SQL에서 검증한 후에만 writer를 연결한다. 현재는 미연결이다.
- 실제 ViewWarehouse.OrderYearWeek2는 계산 컬럼이며 Master에 추가 저장할 필드가 아니다.
  WarehouseMaster의 실제 일자는 InputDate다. TPrice는 SP가 원문을 복사하므로
  통화를 항상 USD라고 추정하지 않는다.

실행: `dnSpy.Console.exe --no-color -t CommonLogic "C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe"`.
근거: `C:\Users\USER\nenova-decompiled\Nenova\CommonLogic.cs`의 위 네 메서드,
`docs/diagnostics/2026-10-08-invoice-receipt-live-evidence.json`.
새 SELECT 사전검사 계약: `docs/plans/invoice-receipt-eligibility-v1.md`.

## dnSpy/CLI 원본

- 실행 파일: `C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe`
- decompile: `C:\Users\USER\nenova-decompiled\Nenova\ExcelLoadingPackingList.cs`
- SP wrapper: `C:\Users\USER\nenova-decompiled\Nenova\DBMSSQL.cs`
- 재현 명령: `dnSpy.Console.exe --no-color -t ExcelLoadingPackingList "C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe"`

이 문서는 decompile 소스의 `read-only` 검사 결과다. 운영 DB 쓰기나 보정은 수행하지 않았다.

## ExcelLoadingPackingList.isPacking — 고정 레이아웃

EXE는 임의 헤더 탐색을 하지 않고 0-based index 4, 즉 엑셀 5행의 고정 열을 검사한다.
공백을 제거하고 대문자로 바꾼 값이 다음과 정확히 같아야 한다.

| 열 | 값 |
|---|---|
| A | `COD` |
| B | `VARIETYNAME` |
| E | `SIZE` |
| F | `BOX` |
| I | `TOTAL\nBUNCH` |
| J | `TOTALSTEAM` |
| L | `T.PRICE` |

상세는 6행부터 읽는다. F/I/J가 모두 비어 있으면 건너뛰고, COD가 `TOTAL`이거나
VARIETY NAME이 비면 읽기를 끝낸다. `TOTALSTEAM`은 `TOTAL STEAM`이나
`TOTAL STEMS`로 임의 치환하지 않는다.

## ExcelLoadingPackingList.MakeTempTable — 필드 매핑

- `ProdName`: `VARIETY NAME`을 우측 trim한 뒤 SIZE가 있으면 공백 한 칸과 SIZE를 붙인다.
- `OrderCode`: COD 원문.
- `BoxQuantity`: BOX.
- `BunchQuantity`: TOTAL BUNCH.
- `SteamQuantity`: TOTALSTEAM.
- `SteamOf1Bunch`: G열.
- `SteamOf1Box`: H열.
- `UPrice`: K열.
- `TPrice`: L열.
- 모든 상세행은 먼저 `TempWarehouseDetail`에 bulk copy된다.

Master 메타는 `WarehouseMaster` 스키마로 준비한다. `OrderWeek=G2`, `FarmName=C2`,
`InvoiceNo=K2`, `OrderNo=C3`, `InputDate=G3`이며, `OrderYear`는 G3 날짜의 연도다.

## ExcelLoadingPackingList.CheckData — 품목과 확정 검사

품목 조인은 아래 의미의 대소문자 무시 정확 일치다.

```sql
LOWER(TempWarehouseDetail.ProdName) = LOWER(Product.ProdName)
```

따라서 SIZE를 버리거나 `LIKE '%name%'`, `TOP 1`로 유사 품목을 선택하면 EXE와
다르다. 웹 계약은 미등록 또는 중복 정확 일치가 하나라도 있으면 저장 후보 전체를
비워 부분 저장을 금지한다. 웹의 의도적 안전 보강으로 대상 `CountryFlower`별
`LogicManager.Common.CheckFixSave(OrderYear + OrderWeek, ..., true)` 정책을 적용한다.
실제 EXE CheckData는 위 정정에 적은 불가능한 품종 조회 조건 때문에 정상 품목에서
이 호출이 누락될 수 있으므로, EXE bulk 업로드의 검사 실행을 보장한다는 뜻이 아니다.

참고로 현재 decompile의 미등록 개수 SQL은 LEFT JOIN 뒤 `p.isDeleted=0` 조건을 두어
NULL 행을 제외할 여지가 있다. 웹은 이를 복제해 누락시키지 않고 EXE가 의도한
“등록되지 않은 제품이 존재하면 중단” 메시지와 파일 전체 실패를 강제한다.

## ExcelLoadingPackingList.InsertMaster — 저장 순서

1. CheckData를 호출한다. 품목/확정 검사 SQL의 누락 가능성은 위 정정 참조.
2. 준비한 `WarehouseMaster` 한 행을 bulk copy한다.
3. `DBMSSQL.uspCreateWarehouse()` → `usp_CreateWarehouse(@iUserID, @oResult)`를 호출한다.
4. 성공한 경우 `uspStockCalculation(SelectOrderYear, SelectOrderWeek, 0)`을 호출한다.
5. SP 또는 재고계산 실패는 성공으로 표시하지 않는다.

웹의 동일 작업은 이 native 입고·이력·재고 효과를 모두 검증해야 한다. 공용 staging 전체
소비가 확인되었으므로 신규 invoice writer는 위 정정의 격리 경로를 따른다.
상세 일부 INSERT만으로 호환 완료를 주장하지 않는다. 주문·출고·견적·매출 원장은 보존한다.

## 교차연도 fixture

2025년 `33-01`과 2026년 `33-01`이 함께 있어도 G3/명시 입력에서 얻은
`OrderYear=2026`, `OrderWeek=33-01`을 `usp_StockCalculation`까지 전달한다.
`OrderWeek`만으로 과거 `WarehouseMaster`, `StockMaster`, `ProductStock`을 선택하거나
재사용하지 않는다.

## 부작용 표

| 동작 | TempWarehouseDetail | WarehouseMaster/Detail | ProductStock | Order/Shipment/Estimate/WebProfitReport |
|---|---|---|---|---|
| 파싱/검토 | 보존 | 보존 | 보존 | 보존 |
| 검증 실패 | 정리/롤백 | 보존 | 보존 | 보존 |
| 업로드 성공 | stage 후 SP 소비 | EXE 순서로 생성 | 대상 연도·차수 재계산 | 보존 |
