# 신규품목 재고단가 — 당차수 다수업체 분배단가 추천

## 확정 기준

- 대상: 원본 Excel에서 카테고리 평균원가 공식을 쓰지 않는 신규 품목 중 호주 이외 품목
- 범위: 화면에서 선택한 `OrderYear + MajorWeek + ProdKey`
- 자료: `ShipmentMaster.isFix=1`, `ShipmentDetail.isFix=1`, 삭제되지 않은 확정 분배
- 업체: `ShipmentMaster.CustKey` 기준으로 해당 차수에 분배된 모든 업체
- 단가 원천: `ShipmentDetail.Cost`의 실제 VAT 포함 단가를 그대로 보존
- 추천 순서: 같은 `Cost`를 사용한 서로 다른 `CustKey` 수가 많은 순
- 동률 순서: 업체 수가 같을 때만 해당 `Cost`의 `SUM(EstQuantity)`가 큰 순
- 적용값: 사용자가 고른 VAT 포함 `Cost / 1.1`
- 수량가중 평균이나 업체 평균으로 새 단가를 만들지 않는다.

## 화면 동작

- 재고단가가 없는 품목에만 `당차수 다수업체 분배단가` 추천을 표시한다.
- 실제 VAT 포함 단가 후보 전체와 후보별 업체 수·기준수량을 표시한다.
- 사용자가 `선택` 또는 `일괄 선택` 후 저장해야만 마지막 재고 세부차수의 단가 근거가 된다.
- 해당 차수에 유효한 확정 분배가 없으면 추측하지 않고 추천을 표시하지 않는다.

## 부작용 점검표

| 동작 | 읽기 | 쓰기 | 보존 |
|---|---|---|---|
| 추천 표시 | ShipmentMaster, ShipmentDetail, Customer, Product | 없음 | 주문·출고·출고일·농장·재고·견적·손익 원장 전체 |
| 사용자 확정 저장 | ProductStock 시점, 기존 단가근거 | WebStockPriceEvidence | Product.Cost, ShipmentDetail, ProductStock, StockHistory 및 ERP 원장 전체 |

다른 연도·차수·품목, 미확정 분배, `Product.Cost`, 최근 입고단가를 추천에 섞지 않는다. 추천 후보는 평균값이 아니라 전산에 실제 저장된 분배단가다.
