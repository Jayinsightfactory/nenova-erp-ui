# FormWarehouse 입고 엑셀 업로드 — nenova.exe golden

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
비워 부분 저장을 금지한다. 이어 대상 `CountryFlower`별
`LogicManager.Common.CheckFixSave(OrderYear + OrderWeek, ..., true)`를 통과해야 한다.

참고로 현재 decompile의 미등록 개수 SQL은 LEFT JOIN 뒤 `p.isDeleted=0` 조건을 두어
NULL 행을 제외할 여지가 있다. 웹은 이를 복제해 누락시키지 않고 EXE가 의도한
“등록되지 않은 제품이 존재하면 중단” 메시지와 파일 전체 실패를 강제한다.

## ExcelLoadingPackingList.InsertMaster — 저장 순서

1. 전체 품목 정확 일치와 확정 범위를 검사한다.
2. 준비한 `WarehouseMaster` 한 행을 bulk copy한다.
3. `DBMSSQL.uspCreateWarehouse()` → `usp_CreateWarehouse(@iUserID, @oResult)`를 호출한다.
4. 성공한 경우 `uspStockCalculation(SelectOrderYear, SelectOrderWeek, 0)`을 호출한다.
5. SP 또는 재고계산 실패는 성공으로 표시하지 않는다.

웹의 동일 작업도 직접 `WarehouseDetail`을 일부 INSERT하는 경로가 아니라 이 순서와
트랜잭션 경계를 따라야 한다. 업로드는 주문·출고·견적·매출 원장을 변경하지 않는다.

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
