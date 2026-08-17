# 주차별 매출이익 보고서 원천 연결·독립 산식 검증

## 이번 보강의 판정

원본 엑셀 파일을 그대로 복사해 “재생성 일치”로 판정하던 경로를 폐기했다. 이제 검증기는 원본 파일을 수정하거나 복사하지 않고, 본표의 수식 셀을 별도 계산기로 다시 계산한 뒤 엑셀에 저장된 수식 캐시값과 비교한다.

두 검증은 서로 다른 상태로 보관한다.

| 검증영역 | 의미 | 운영 DB 미접속 시 |
|---|---|---|
| 독립 산식 검증 | C/D/G/I/J/K/M/P/T/U 등의 수식 결과를 코드로 재계산하고 원본 캐시값과 비교 | `PASS`, `FAIL`, `UNVERIFIED` |
| DB 원천 연결 검증 | 같은 연도·차수의 ViewOrder, ViewShipment, ShipmentDate, Warehouse, StockMaster/ProductStock, 단가·환율·통관 근거를 운영 원장과 대조 | `UNVERIFIED` |

따라서 수식 검증이 `PASS`여도 운영 DB 대조가 끝나지 않은 결과는 `AUTO_COMPLETE`가 아니다. 원본 엑셀만으로 DB 원천 연결까지 완료했다고 보고하지 않는다.

## 독립 계산 범위

본표 행 7~23에서 다음 계산 열을 대상으로 한다.

`C, D, G, I, J, K, M, P, T, U`

계산기는 셀 참조, 시트 참조, 범위, 사칙연산, 비교, `IFERROR`, `SUM`, `SUMIF`를 해석한다. 계산 중 지원하지 않는 함수·순환참조·원천 셀 누락이 발생하면 임의값으로 채우지 않고 `UNVERIFIED`로 보고한다. 금액 허용오차는 1원, 비율 허용오차는 0.0001이다.

## 신규 품목 자동완성 조건

신규 품목은 다음 항목이 모두 확인될 때만 `AUTO_COMPLETE`로 승격한다.

- `ProdKey`
- 국가
- 품종
- 전산 단위
- 단위 환산 근거(동일 단위 또는 박스·단·송이 환산계수)
- 통화
- 확인된 단가 근거

하나라도 없으면 `INPUT_REQUIRED`다. 유사한 이름이나 최근 품목을 근거 없이 자동 연결하지 않는다. 현재 저장된 재고 원가 catalog의 일부 행은 국가·품종·환산·통화가 구조화되어 있지 않으므로 신규 품목 자동완성으로 판정하지 않는다.

## dnSpy에서 확인된 재고 기준

`FormStockView.GetData`를 실제 `nenova.exe`에서 확인한 결과, 화면의 재고 수량은 `StockMaster`와 `ProductStock`를 `StockKey`로 연결해 선택한 연도·차수의 `ProductStock.Stock`을 읽는다. 입고는 같은 `OrderYearWeek2`의 `ViewWarehouse`, 출고는 같은 `OrderYearWeek2`의 `ViewShipment`, 조정은 `StockHistory.AfterValue - BeforeValue`다. `StockMaster.isFix`를 화면 조회 필터로 사용하지 않는다.

이 근거는 재고 수량의 조회 의미를 확정하지만, 다음을 자동으로 확정해 주지는 않는다.

- 엑셀 재고잔량의 각 품목 행과 실제 `ProdKey`의 일대일 연결
- 품목별 국가·품종·단위·박스/단/송이 환산계수
- 재고 스냅샷 시점의 품목별 단가와 단가의 통화·과세환율
- 당시 엑셀의 수기 통관비·환율·외부 청구서와 운영 원장의 연결

이 항목은 운영 DB read-only 대조와 원천 증거가 있어야 `PASS`로 바꿀 수 있다.

## 과장 표현 제거

검증 보고서에서 “7개 원본을 재생성했다”, “재생성 parity가 PASS다”라는 표현을 제거했다. 보고서에는 독립 산식 결과와 DB 원천 연결 결과를 별도로 표시하며, DB 대조 전에는 자동완성률을 최종 완료율로 해석하지 않는다.

## 남은 운영 검증

현재 작업은 코드·엑셀 산식 검증기 보강 범위이며 운영 DB 쓰기는 하지 않는다. 운영 반영 전 다음 read-only 대조가 필요하다.

1. 22~32차의 `OrderYear + OrderWeek`별 `ViewOrder`·`ViewShipment` 집계
2. `ShipmentDate` 출고일별 수량과 `ShipmentDetail.OutQuantity/EstQuantity` 대조
3. `StockMaster/ProductStock` 마지막 세부차수와 `FormStockView` 표시값 대조
4. 재고잔량 E/F 품목별 `ProdKey`·단위·환산·단가 근거 대조
5. 포워딩·과세환율·통관비의 차수·국가 원천 및 수기 입력 상태 대조
6. 2025/2026 동일 차수의 업무키 격리 대조

위 대조가 모두 통과하고 외부 확정값에 `sourceRef`, `effectiveAt`, `confirmedBy`, `confirmedAt`가 있으면 그때만 해당 행 또는 차수를 `AUTO_COMPLETE`로 표시한다.
