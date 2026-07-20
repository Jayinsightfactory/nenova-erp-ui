# 주차별 매출이익보고서 — Nenova 호환 근거

## 기능 성격

주차별 매출이익보고서는 `nenova.exe`에 동일한 별도 입력 Form이 있는 기능이 아니라 웹 전용 보고서다. 따라서 웹이 임의의 주문·출고·견적 원장을 만들거나 수정하지 않고, `nenova.exe`가 사용하는 공용 View/테이블의 의미를 그대로 따라야 한다.

## 공용 ERP 읽기 계약

- 매출 N·불량 L·그외매출 O는 `ShipmentMaster`와 `ShipmentDetail`을 사용하며 확정 출고(`ShipmentDetail.isFix=1`)만 집계한다.
- 견적/차감은 `Estimate`와 `ShipmentMaster`의 동일 연도·차수 범위를 사용한다.
- 매입 Q, 국가별 GW/CW, 포워딩은 `WarehouseMaster`·`WarehouseDetail`을 `OrderYear + OrderWeek`로 제한한다.
- 수기 E/F/H/R/S와 비고는 웹 전용 `WebProfitReport`, `WebCustomsWeekly`, `WebColombiaWeekly`, `WebForwardingWeekly`에 저장한다.
- `OrderWeek`만으로 2025/2026 행을 재사용하지 않는다. 모든 자동 조회와 저장은 `OrderYear`를 별도 파라미터로 유지한다.

## 입고 중량·트럭 규칙

`WarehouseDetail`의 `Gross weight`/`Chargeable weight` 행을 우선 읽고, 같은 AWB의 품목 `Product.CounName`과 농장/인보이스 태그로 국가를 판별한다. 특수 중량행이 없을 때만 `WarehouseMaster.GrossWeight`/`ChargeableWeight`를 fallback으로 사용한다.

콜롬비아 국내 운송료 등급은 22~27차 매출원가 원본의 운영값을 재현한다.

| Gross Weight | 트럭 자동값 |
|---:|---|
| 0 초과 ~ 1,000kg | 1t 1대 |
| 1,000kg 초과 ~ 2,500kg | 2.5t 1대 |
| 2,500kg 초과 | 5t 1대 |

이는 물리적 적재한계를 새로 계산하는 규칙이 아니라 원본 양식의 운송료 등급 선택 규칙이다. 중량이 없으면 자동 트럭값을 만들지 않고 검증 대상으로 남긴다.

## downstream 보존

이 기능은 보고서 조회·웹 전용 수기 저장·입고 중량 읽기만 수행한다. `OrderDetail`, `ShipmentDetail.OutQuantity/Amount/Vat/isFix`, `ShipmentDate`, `Estimate`, `ProductStock`, `StockHistory`를 변경하지 않는다. 매출 집계에는 반드시 확정 출고 필터가 있어야 한다.

## 사전 확인 기록

공용 조인·확정 기준은 `docs/exe-golden/FormShipmentDistribution.md`, `docs/exe-golden/FormEstimateView.md`, `docs/DB_STRUCTURE.md`, `docs/WEB_VS_ERP_CONFLICTS.md`에 기록된 dnSpy/DB 근거를 재사용한다. 이 기록과 `docs/contracts/weekly-profit-report.json`은 변경 시 회귀 테스트와 배포 manifest 검사의 기준이다.
