# 출고 확정 · exe 정합 재설계 (2026-06-16)

## 배경

카테고리별 확정/취소(`e835592`) 도입 후 **25-01** 등에서:

- 웹: `ShipmentDetail.isFix` 전부 1 → "확정"
- exe: `StockMaster.isFix=0`, `Product.Stock` 음수 → "풀림·마이너스"

원인: 카테고리 SP만 돌리고 **차수 전체 `usp_StockCalculation`** 이 빠져 `ProductStock`/`StockMaster` 가 어긋남.

## 설계 원칙 (nenova.exe 충돌 방지)

| 계층 | 전산 SP | 웹 역할 |
|------|---------|---------|
| 출고 확정/취소 | `usp_ShipmentFix` / `Cancel` | **그대로 호출** (Product.Stock ±) |
| 차수 재고 스냅샷 | `usp_StockCalculation` | **카테고리 작업 후 차수 전체 prod 재계산** |
| 상태 표시 | DetailFix + StockMaster + Product.Stock | **복합 `exeAligned` 판정** |

카테고리별 편의 기능은 유지. 차이는 **작업 직후 자동 reconcile** 과 **UI 이중 표시**.

## 구현

### `lib/shipmentFixReconcile.js`

- `deriveExeAlignedStatus()` — 출고확정 + 재고마감 + Product.Stock 음수 + Master/Detail 불일치
- `reconcileWeekAfterScopedOperation()` — 차수 outbound 전 품목 `usp_StockCalculation`
- 카테고리 필터 시 `forceFullWeekRecalc: true` (해당 카테고리만 calc 하던 기존 동작 보완)

### API

| 파일 | 변경 |
|------|------|
| `pages/api/shipment/fix.js` | fix/unfix 종료 후 `reconcile` 호출, `parity` 응답 |
| `pages/api/shipment/fix-status.js` | GET `exeAligned`, `FIXED_PENDING_STOCK`; POST bulk unfix 후 reconcile |
| `pages/api/shipment/fix-reconcile.js` | **신규** — 수동 차수 복구 |

### UI (`pages/estimate.js`)

- 확정현황: **exe** 열, `출고확정·재고미정합` 배지
- **재고 정합 복구** 버튼 → `POST /api/shipment/fix-reconcile`

### 운영

```bash
# 진단
node scripts/probe-fix-parity-audit.mjs 25-01

# 복구 (배포 후)
node scripts/probe-reconcile-week.mjs 25-01 --apply
```

## 상태 코드

| status | 의미 |
|--------|------|
| `FIXED` | 출고 확정 + 재고 마감 + exe 정합 |
| `FIXED_PENDING_STOCK` | 출고만 확정 — exe와 불일치 가능 |
| `PARTIAL` | 카테고리 부분 확정 |
| `UNFIXED` | 미확정 |

## 25-01 복구 절차

1. 확정현황에서 **재고 정합 복구** 또는 `probe-reconcile-week.mjs 25-01 --apply`
2. `fix-parity-audit` 재확인 — `exeAligned: true` 목표
3. 여전히 `Product.Stock` 음수면 **전 카테고리** unfix → 데이터 점검 → 낮은 차수부터 전체 재확정 (운영 판단)

## API 가드 (2026-06-16 추가)

| 가드 | 동작 |
|------|------|
| `LOWER_UNFIXED_EXISTS` | 확정 시 **이전 차수** 미확정 검사 — **카테고리 필터 무시, 전 카테고리** |
| `PARTIAL_CATEGORY_FIX_BLOCKED` | 같은 차수에 미확정 카테고리 **2개 이상**이면, 필터로 **일부만 fix 불가** |
| unfix 응답 | `requiresAllCategoryFix`, `pendingUnfixedCategories` 안내 |

`lib/shipmentFixGuards.js`


```bash
node __tests__/shipmentFixReconcile.test.js
```
