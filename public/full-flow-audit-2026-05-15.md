# NenovaWeb Full Flow Audit - 2026-05-15

## Scope

1. 주문등록, 붙여넣기 주문등록
2. 출고분배, 출고확정, 구간 확정취소
3. 차수피벗, 통계 피벗, 엑셀 다운로드
4. 재고관리, 입고등록, 히스토리
5. Ecount ERP/경영지원 화면의 원본 데이터 매칭 검증

## Fixed In This Round

| Area | Problem | Fix |
|---|---|---|
| Common week input | Some APIs treated `2026-17-01` as a DB week instead of normalizing it to `17-01` | Added shared normalization helpers |
| Shipment distribute | Week lookup/save could miss data with year-prefixed weeks | Normalized GET/POST weeks |
| Stock | Stock lookup/adjustment could miss data with year-prefixed weeks | Normalized GET/POST weeks |
| Stats pivot | Week range could return empty data with year-prefixed weeks | Normalized range weeks |
| Stats pivot quantity | Order quantity used mixed `Box+Bunch+Steam` totals | Switched to `OrderDetail.OutQuantity` |
| Shipment list/Excel | Shipment lookup/download could miss year-prefixed weeks | Normalized week input |
| Order history | History lookup could miss year-prefixed weeks | Normalized week input |
| Warehouse pivot | Warehouse pivot could miss year-prefixed weeks | Normalized week input |

## Remaining Verification

1. Compare `FormShipmentDistribution` button behavior against web shipment distribution.
2. Compare week pivot Excel columns, formulas, residual copy values against EXE output.
3. Compare Ecount ERP sales, AR, tax invoice, and purchase source columns against web calculations.
4. Verify read APIs against `ViewOrder`, `ViewShipment`, and `ViewWarehouse`.
5. Run one production sample for order registration -> shipment distribution -> history.

