# FormStockView 재고 조회 기준

## 확인 대상

- 프로그램: `C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe`
- 형식: dnSpy Console `FormStockView` 디컴파일
- 확인일: 2026-08-17

## GetData 선택 구조

`FormStockView.GetData`는 선택 차수의 `StockMaster`와 `ProductStock`을 `StockKey`로 연결한다. 비교 열은 다음 원천을 사용한다.

- 전차수 재고: 전차수 `StockMaster`에 연결된 `ProductStock.Stock`
- 입고: 같은 `OrderYearWeek2`의 `ViewWarehouse`
- 출고: 같은 `OrderYearWeek2`의 `ViewShipment`
- 재고조정: 같은 차수 `StockHistory.AfterValue - BeforeValue`
- 현재 잔량: 선택 `StockMaster`에 연결된 `ProductStock.Stock`

## 확정 여부

이 화면의 재고 스냅샷 조회 SQL에는 `StockMaster.isFix`의 SELECT, WHERE 필터, 화면 표시가 없다. 따라서 웹 주차별 매출이익보고서가 EXE와 같은 재고수량을 선택할 때도 `isFix=1`을 추가 조건으로 사용하지 않는다.

필수 선택 조건은 다음과 같다.

1. 화면에서 선택한 `OrderYear`와 대차수
2. `ProductStock` 행이 실제로 존재하는 숫자 세부차수
3. 세부차수 숫자가 가장 큰 스냅샷
4. 같은 세부차수 후보가 여러 개면 `ProductStock` 행 수, `StockKey DESC`로 결정

`isFix`는 다른 확정 업무에서 사용될 수 있으나 `FormStockView.GetData`의 재고수량 조회 조건으로 추정해서는 안 된다.

## 웹 계약

- 기말재고 수량 F: 해당 대차수의 위 스냅샷
- 기초재고 수량 E: 같은 연도의 직전 대차수 위 스냅샷
- 재고조정: 이미 `usp_StockCalculation`을 통해 `ProductStock.Stock`에 반영된 결과를 사용하고 `StockHistory` 차이를 보고서에서 다시 더하지 않는다.
- 금액 평가: 이 문서는 수량 원천만 확정한다. 품목별 단가·환율·통관비는 엑셀/입고/도착원가 증거 계약으로 별도 검증한다.
