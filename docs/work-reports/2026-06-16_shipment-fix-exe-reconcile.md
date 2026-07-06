# 작업 완료 — 출고 확정 exe 정합 재설계

**일자:** 2026-06-16 (후속 운영: 2026-06-24)  
**설계 문서:** [`SHIPMENT_FIX_EXE_RECONCILE.md`](../SHIPMENT_FIX_EXE_RECONCILE.md)

## 목표

- 카테고리/차수별 확정·취소 편의 기능 유지
- 25-01 유형 이슈(웹 확정 vs exe 재고 꼬임) 재발 방지
- nenova.exe 와 동일 SP 경로 + 사후 정합

## 변경 요약

| # | 파일 | 내용 |
|---|------|------|
| 1 | `lib/shipmentFixReconcile.js` | exe 정합 판정 + 차수 전체 재고 재계산 |
| 2 | `lib/shipmentFixGuards.js` | 하위 차수·부분 카테고리 fix 가드 |
| 3 | `pages/api/shipment/fix.js` | scoped fix/unfix 후 reconcile |
| 4 | `pages/api/shipment/fix-status.js` | `FIXED_PENDING_STOCK`, `exeAligned` |
| 5 | `pages/api/shipment/fix-reconcile.js` | 수동 복구 API |
| 6 | `pages/estimate.js` | exe 열, 재고 정합 복구 버튼 |
| 7 | `scripts/probe-reconcile-week.mjs` | 운영 CLI |

## 검증

- `node __tests__/shipmentFixReconcile.test.js` — 통과
- `node __tests__/shipmentFixGuards.test.js` — 통과

## 배포

| 커밋 | 내용 |
|------|------|
| `407b2d4` | reconcile + guards + UI |
| `73e2dc3` | reconcile API `NVarChar` hotfix |

## 2026-06-24 운영 후속

| 작업 | 결과 |
|------|------|
| `bulk-refix-weeks.mjs` 20-01~25-02 | 출고확정 전 차수 FIXED, API 오류 0 |
| `probe-reconcile-week.mjs 25-01` | 153품목 calc OK, 음수 잔존 |
| `repair-negative-product-stock.js` | **음수 43품목 → 0** — [상세](2026-06-24_negative-product-stock-repair.md) |

## 미완 / 한계

- `StockMaster.isFix=0` — reconcile 후에도 UI `FIXED_PENDING_STOCK` 가능
- EXE 견적 비고 — [`NENOVA_EXE_PRINT_DESCR_PATCH.md`](../NENOVA_EXE_PRINT_DESCR_PATCH.md)
