# 출고확정 안정화 기록 (2026-05-27)

## 상황

- 견적서관리/확정현황에서 20-01 이후 차수를 21-02까지 확정하려고 했으나 일부 차수가 계속 미확정으로 남았다.
- 20-01은 부분 확정 상태에서 태국 등 잔여 카테고리 확정 시 `제품 잔량이 마이너스인 출고 정보가 존재합니다.` 오류가 발생했다.
- 확정/확정취소 후 `usp_StockCalculation` 병렬 실행 중 deadlock이 반복되어 ProductStock 스냅샷이 덜 갱신되는 현상이 확인됐다.

## 코드 보완

- `pages/api/shipment/fix.js`
  - `CountryFlower`가 비어 있거나 표시명 기준으로만 보이는 카테고리도 확정/취소 대상에서 누락되지 않도록 대상 수집을 보완했다.
  - `usp_StockCalculation` 호출을 동시 3개에서 순차 1개로 낮춰 같은 차수/품목군 내부 deadlock 가능성을 줄였다.
  - `usp_ShipmentFix` 실패 시 해당 카테고리 품목의 ProductStock을 먼저 재계산한 뒤 확정 SP를 한 번 재시도하도록 했다.
  - 직접 `ShipmentMaster.isFix`/`ShipmentDetail.isFix`를 수정하지 않고 기존 전산 SP 경로를 유지했다.

## 운영 처리 결과

- `20-01`
  - 먼저 `usp_ShipmentFixCancel` 경로로 확정취소 후 재확정했다.
  - 최종 로그: `fix_done 2026/20-01 success=7 errors=0 stockErrors=0`
- `20-02`
  - 최종 로그: `fix_done 2026/20-02 success=9 errors=0 stockErrors=0`
- `21-01`
  - 최종 로그: `fix_done 2026/21-01 success=12 errors=0 stockErrors=0`
- `21-02`
  - API 응답: `success=true`, 4개 카테고리 확정 완료

## 최종 검증

- `/api/shipment/fix-status?fromWeek=2026-20-01&toWeek=2026-21-02`
  - 20-01: `FIXED`, 미확정 0, 음수재고 0
  - 20-02: `FIXED`, 미확정 0, 음수재고 0
  - 21-01: `FIXED`, 미확정 0, 음수재고 0
  - 21-02: `FIXED`, 미확정 0, 음수재고 0
- `/api/dev/estimate-edit-audit?marker=all&limit=120`
  - 출고수량 수정 기록: 0
  - 단가 수정 기록: 68
  - 견적 차감 수정 기록: 0
  - 출고일 누락/ShipmentDate 수량 불일치 등 위험: 0

## 주의

- 이번 작업은 출고/입고 수량 자체를 직접 수정하지 않았다.
- 확정/취소 SP 실행 특성상 `Product.Stock`, `ProductStock`, `StockHistory`, `ShipmentHistory`는 전산 확정 흐름에 따라 갱신된다.
- 앞으로 대량 확정은 504가 발생해도 AppLog의 `shipmentFix` 로그를 기준으로 실제 진행 여부를 판단해야 한다.
