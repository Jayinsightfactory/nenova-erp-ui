# 작업 완료 보고 — 출고 확정 exe 정합 재설계

**일자:** 2026-06-16  
**AI:** Cursor (직접 구현)

## 목표

- 카테고리/차수별 확정·취소 편의 기능 유지
- 25-01 유형 이슈(웹 확정 vs exe 재고 꼬임) 재발 방지
- nenova.exe 와 동일 SP 경로 + 사후 정합

## 변경 요약

1. **`lib/shipmentFixReconcile.js`** — exe 정합 판정 + 차수 전체 재고 재계산
2. **`fix.js`** — 카테고리 fix/unfix 후 자동 reconcile (`forceFullWeekRecalc` when scoped)
3. **`fix-status.js`** — `FIXED_PENDING_STOCK`, `exeAligned`, bulk unfix 후 reconcile
4. **`fix-reconcile.js`** — 수동 복구 API
5. **`estimate.js`** — exe 열, 재고 정합 복구 버튼, 경고 메시지
6. **`fix-parity-audit.js`** — 복합 status 정렬
7. **`scripts/probe-reconcile-week.mjs`** — 운영 복구 CLI
8. **`docs/SHIPMENT_FIX_EXE_RECONCILE.md`** — 설계 문서

## 검증

- `node __tests__/shipmentFixReconcile.test.js` — 통과
- `node __tests__/fixStatusCategories.test.js` — 통과

## 배포 후

1. 운영 배포
2. `node scripts/probe-reconcile-week.mjs 25-01 --apply`
3. 확정현황에서 25-01 `exe` 열 OK 확인

## 미완 / 한계

- `Product.Stock` 음수가 SP 대칭 오류가 아닌 **실재고 부족**이면 reconcile만으로는 해결 안 됨 → 전체 unfix/재확정 필요
- EXE 견적 비고(`Descr` 누적)는 별도 — `NENOVA_EXE_PRINT_DESCR_PATCH.md`
