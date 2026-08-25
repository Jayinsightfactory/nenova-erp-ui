# 작업 완료 보고 — 영업지원 수동처리완료

날짜: 2026-08-25

## 요청

처리상태에서 수기 처리했는데 표시가 안 된 항목을 체크한 뒤 수동처리완료로 별도 이력을 남긴다.

## 부작용

| 동작 | Order | Shipment | Stock | Estimate | Web 원장 |
|---|---|---|---|---|---|
| 수동처리완료 | 보존 | 보존 | 보존 | 보존(미생성) | Status=MANUAL_COMPLETED, RemainingQuantity=0, History MANUAL_COMPLETE |

## 검증

- `node __tests__/salesDefectDeductions.test.js`
- `node __tests__/salesDefectDeductionState.test.js`
- `npm run test:erp-contract`
- `npm run test:nenova-dnspy-evidence`
- `npm run test:erp-manifest -- --changed-from origin/master`
- `npm run guard:erp-writes -- --changed-from origin/master`
- `npm run build`
