# nenova.exe ↔ nenovaweb parity (dnSpy export)

Source decompile: `C:\Users\USER\nenova-decompiled\Nenova\`

## 원칙

1. 조회 SQL은 dnSpy `Form*.cs` 문자열을 `lib/exe*Sql.js`에 그대로 포팅
2. API는 기본 `exeParity=1` (생략 시 ON). 레거시: `exeParity=0`
3. 프론트는 `lib/exeParity/client.js`의 `apiGetExe()` 사용 (기본 exe 경로)
4. 검증:
   - `npm run test:estimate` — SQL 구조 + 견적 불변식
   - `node scripts/scan-exe-forms.mjs` — decompile ↔ registry 매칭
   - `node scripts/probe-all-exe-parity.mjs` — 구조 + DB probe 일괄

## 포팅 완료 (13 forms)

| Form | lib | Web UI | API |
|------|-----|--------|-----|
| FormEstimateView | exeEstimateViewSql.js | /estimate | /api/estimate |
| FormSalesDefectView | exeSalesDefectViewSql.js | /stats/analysis | /api/stats/sales?type=analysis |
| FormSalesView | exeSalesViewSql.js | /stats/monthly | /api/stats/sales?type=monthly |
| FormSalesManagerView | exeSalesManagerViewSql.js | /stats/manager | /api/stats/sales?type=manager |
| FormAreaSalesView | exeAreaSalesViewSql.js | /stats/area | /api/stats/sales?type=area |
| FormShipmentView | exeShipmentViewSql.js | /shipment/view | /api/shipment |
| FormStockView | exeStockViewSql.js | /stock | /api/stock |
| FormWarehouseView | exeWarehouseViewSql.js | /incoming | /api/warehouse |
| FormOrderView | exeOrderViewSql.js | /orders | /api/orders?view=exe |
| FormOrderAdd | exeOrderAddSql.js | /orders/new (3-grid) | /api/orders?view=add |
| FormCustomerProdCost | exeCustomerProdCostSql.js | /master/pricing | /api/master/pricing-matrix |
| FormShipmentDistribution | exeShipmentDistributionSql.js | /shipment/distribute | /api/shipment/distribute |
| FormQuantityPivot | exeQuantityPivotSql.js | /shipment/week-pivot | /api/shipment/stock-status?view=quantityPivot |

Registry: `lib/exeParity/registry.js`

## Probe 스크립트

| 스크립트 | 용도 |
|----------|------|
| probe-estimate-exe-parity.mjs | 견적 exe vs legacy Cost×qty |
| probe-manager-exe-parity.mjs | 담당자실적 week1/week2 합계 |
| probe-orders-add-exe-parity.mjs | 주문등록 3-grid row count |
| probe-distribute-exe-parity.mjs | 배분 고객/피벗 row count |
| probe-all-exe-parity.mjs | 위 일괄 실행 |

## 미포팅 (다음 후보)

- FormOrderHistory, FormShipmentHistory
- FormEstimateAdd
- 마스터: Product, Customer, Code, User
- FormFileUpload
- ShipmentDistribution SP 쓰기 (usp_DistributeOne/Total/Clear)
