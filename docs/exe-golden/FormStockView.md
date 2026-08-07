# FormStockView / FormStockAdd — 재고관리 계약 근거

source: 프로젝트에 보존된 `lib/exeStockViewSql.js`, `docs/WEB_VS_ERP_CONFLICTS.md`의 FormStockView·`usp_StockCalculation` 분석

## 확인된 메서드와 원장

- `FormStockView.GetData`: `StockMaster + ProductStock`, `ViewWarehouse`, `ViewShipment`, `StockHistory`를 차수 키로 조회한다.
- `FormStockView` history focus: 품목별 `StockHistory`의 `AfterValue-BeforeValue`를 표시한다.
- `FormStockAdd.btnSave_Click`: 수동 조정 이력을 기록한 뒤 `usp_StockCalculation`을 호출하는 순서다.
- `usp_StockCalculation`: 전차수 `ProductStock.Stock + ViewWarehouse.OutQuantity - ViewShipment.OutQuantity(DetailFix=1) + 수동 StockHistory delta`로 `ProductStock`을 계산한다.

## 웹 계약

`Product.Stock`은 현재 누적값, `ProductStock.Stock`은 차수별 확정 스냅샷이다. 화면의 확정재고는 선택된 `StockKey`의 `ProductStock.Stock`만 사용한다. 미확정 분배 예상재고는 `확정재고 - SUM(선택 OrderYear+OrderWeek의 sd.isFix<>1 OutQuantity)`이다. 입고는 확정 스냅샷에 이미 포함되므로 예상재고에 다시 더하지 않는다.

이력의 signed delta는 입고 `+`, 확정출고 `-`, 미확정분배 `-`(예상치만), 수동조정 `AfterValue-BeforeValue`다. `StockHistory`의 자동 `입고/출고` 행을 입고·출고 원장과 다시 합산하지 않는다.

대체입고 후보는 같은 `CountryFlower + OutUnit`의 품목 중 예상재고가 양수인 읽기 전용 후보이며 자동 치환이나 원장 쓰기를 하지 않는다. MOYI 차수별 조회도 명시적 `OrderYear + OrderWeek`를 받아 같은 DTO를 반환한다.

## 부작용 표

| 동작 | Product.Stock | ProductStock | Warehouse* | Shipment* | StockHistory | Estimate / WebProfitReport |
|---|---|---|---|---|---|---|
| 재고·예상재고 조회 | 보존 | 읽기 | 읽기 | 읽기 | 읽기 | 보존 |
| 이력 조회 | 보존 | 보존 | 읽기 | 읽기 | 읽기 | 보존 |
| 대체입고 후보 / MOYI 조회 | 보존 | 읽기 | 읽기 | 읽기 | 보존 | 보존 |
| 수동 조정 | FormStockAdd 순서 유지 | SP만 갱신 | 보존 | 보존 | 1회 INSERT | 보존 |

## 검증 제한

외부 개인 decompile 폴더와 운영 DB probe는 이번 작업 범위에서 사용하지 않았다. 따라서 실제 운영 스키마·SP 실행 결과는 **미검증**이다. 이 문서는 프로젝트 내부 golden SQL과 기존 SP 분석만 고정하며 운영 parity 승인을 주장하지 않는다. `dnSpy.Console.exe --no-color -t FormStockView` 및 FormStockAdd의 신규 실행 결과도 미검증이다.
