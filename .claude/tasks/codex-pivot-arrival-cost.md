## Problem Statement

Pivot 통계(`pages/stats/pivot.js`)에 **도착원가**를 추가해야 한다. 값은 `/freight` 운송기준원가와 동일해야 하며 `lib/freightCalc.js`의 `displayArrivalKRW` (또는 UI 컬럼 도착원가/단·/송이)와 일치해야 한다.

차수 범위 내 `WarehouseMaster` → `FreightCost` 스냅샷 또는 live `computeFreightCost` → `ProdKey`별 pivot row에 `arrivalCost` 매핑.

## Environment

- Path: C:\Users\USER\nenova-erp-ui
- Tables: WarehouseMaster, WarehouseDetail, FreightCost, FreightCostDetail, Product
- Reference: pages/api/freight/index.js loadFreightData, lib/freightCalc.js

## Constraints

- freightCalc.js 변경 시 __tests__/freightCalc.test.js 238/238 필수
- pivotStats rows[] additive only (arrivalCost, arrivalCostPerFarm optional)
- 스냅샷 없으면 live compute (DB write 없음)

## Expected Output

1. lib/pivotFreightArrival.js 완전한 코드 (순수함수 + async loader)
2. ProdKey 다중 AWB 가중평균 규칙
3. 검증 SQL 2개 + node probe 스크립트 초안 scripts/probe-pivot-arrival.js
4. FreightCostDetail.ArrivalPerBunch vs displayArrivalKRW 선택 기준 (OutUnit)

## Attempted Fixes

| # | Change | Result |
|---|--------|--------|
| — | 신규 | — |
