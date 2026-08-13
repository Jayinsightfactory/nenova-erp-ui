# FormStockAdd dnSpy 저장 계약

- 원본: `C:\Users\USER\nenova-decompiled\Nenova\FormStockAdd.cs`
- 확인 메서드: `FormStockAdd.btnSave_Click`, `ClassStockHistory.Insert`,
  `ClassStockHistory.ProductStockUpdate`, `DBMSSQL.uspStockCalculation`
- 확인일: 2026-08-13 (로컬 decompile 읽기 전용, 운영 DB 쓰기 없음)

EXE는 사용자가 입력한 값을 목표재고가 아니라 현재 `Product.Stock`에 더할 증감량으로
취급한다. `StockHistory.BeforeValue=Product.Stock`, `AfterValue=BeforeValue+입력증감량`을
기록하고, `Product.Stock=AfterValue`로 갱신한 다음 `usp_StockCalculation`을 호출한다.

웹 일괄편집은 선택 차수의 목표재고를 입력받으므로 다음 변환이 필요하다.

```text
delta = 선택차수 목표재고 - 선택차수 현재 계산재고
StockHistory.BeforeValue = 최신 Product.Stock
StockHistory.AfterValue  = 최신 Product.Stock + delta
Product.Stock            = 최신 Product.Stock + delta
usp_StockCalculation(선택 연도, 선택 차수, 품목)
```

과거 차수 목표값을 `Product.Stock`과 직접 비교하거나 `Product.Stock=목표값`으로 덮으면
후속 차수 cascade가 같은 차이를 다시 반영해 현재 재고가 뒤틀린다. 일괄 요청은 모든
품목을 한 트랜잭션으로 처리하고 SP 오류 시 전체 롤백한다.
