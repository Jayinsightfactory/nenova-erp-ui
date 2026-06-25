# 출고 확정 · exe 정합 · 음수 재고 복구

> **최종 갱신:** 2026-06-24  
> **관련 작업 보고:** [2026-06-16 reconcile](work-reports/2026-06-16_shipment-fix-exe-reconcile.md) · [2026-06-24 음수 복구](work-reports/2026-06-24_negative-product-stock-repair.md) · [2026-06-24 세션 인계](work-reports/2026-06-24_session-estimate-print-fix-status.md)

---

## 1. 배경

카테고리별 확정/취소(`e835592`, 2026-06-12) 도입 후 **25-01** 등에서:

| 시스템 | 체감 |
|--------|------|
| nenovaweb 확정현황 | `ShipmentDetail.isFix` 전부 1 → **확정** |
| nenova.exe | `StockMaster.isFix=0`, `Product.Stock` 음수 → **풀림·마이너스** |

**직접 원인:** 카테고리 SP만 돌리고 차수 전체 `usp_StockCalculation`이 빠져 `ProductStock` / `StockMaster`가 어긋남.  
**구조적 요인:** `Product.Stock`(exe 실시간, SP ±) vs `ProductStock`(차수 스냅샷) **이중 재고** — 확정취소/재확정 누적 시 실시간만 비대칭 가능.

---

## 2. 설계 원칙 (nenova.exe 충돌 방지)

| 계층 | 전산 SP | 웹 역할 |
|------|---------|---------|
| 출고 확정/취소 | `usp_ShipmentFix` / `Cancel` | **그대로 호출** (`Product.Stock` ±) |
| 차수 재고 스냅샷 | `usp_StockCalculation` | **카테고리 작업 후 차수 전체 prod 재계산** |
| 상태 표시 | DetailFix + StockMaster + `Product.Stock` | **복합 `exeAligned` 판정** |

카테고리별 편의 기능은 유지. 차이는 **작업 직후 자동 reconcile** + **UI 이중 표시**.

---

## 3. 코드 구현

### 3.1 `lib/shipmentFixReconcile.js`

- `deriveExeAlignedStatus()` — 출고확정 + 재고마감 + `Product.Stock` 음수 + Master/Detail 불일치
- `reconcileWeekAfterScopedOperation()` — 차수 outbound 전 품목 `usp_StockCalculation`
- 카테고리 필터 시 `forceFullWeekRecalc: true`

### 3.2 API

| 파일 | 역할 |
|------|------|
| `pages/api/shipment/fix.js` | fix/unfix 후 reconcile, `parity` 응답 |
| `pages/api/shipment/fix-status.js` | `exeAligned`, `FIXED_PENDING_STOCK`, bulk unfix 후 reconcile |
| `pages/api/shipment/fix-reconcile.js` | 수동 차수 복구 |
| `pages/api/dev/fix-parity-audit.js` | exe/web 불일치 진단 |

### 3.3 API 가드 (`lib/shipmentFixGuards.js`)

| 코드 | 동작 |
|------|------|
| `LOWER_UNFIXED_EXISTS` | 확정 시 **이전 차수** 미확정 검사 — **카테고리 필터 무시, 전 카테고리** |
| `PARTIAL_CATEGORY_FIX_BLOCKED` | 같은 차수에 미확정 카테고리 **2개 이상**이면 필터로 **일부만 fix 불가** |

unfix 응답: `requiresAllCategoryFix`, `pendingUnfixedCategories` 안내.

### 3.4 UI (`pages/estimate.js`)

- 확정현황: **exe** 열, `출고확정·재고미정합` 배지
- **출고확정** / **재고마감** 열 분리
- **재고 정합 복구** 버튼 → `POST /api/shipment/fix-reconcile`

### 3.5 상태 코드

| status | 의미 |
|--------|------|
| `FIXED` | 출고 확정 + 재고 마감 + exe 정합 |
| `FIXED_PENDING_STOCK` | 출고만 확정 — `StockMaster.isFix=0` 등 exe와 불일치 가능 |
| `PARTIAL` | 카테고리 부분 확정 |
| `UNFIXED` | 미확정 |

### 3.6 테스트

```bash
node __tests__/shipmentFixReconcile.test.js
node __tests__/shipmentFixGuards.test.js
```

---

## 4. 운영 복구 절차

### 4.1 진단

```bash
node scripts/probe-fix-parity-audit.mjs 25-01
# GET /api/dev/fix-parity-audit?week=25-01
node scripts/probe-negative-stock-week.js 2026 25-01
```

### 4.2 차수 재고 스냅샷 정합 (reconcile)

출고 확정은 유지한 채 `ProductStock` / `StockMaster` 재계산.

```bash
# UI: 확정현황 → 재고 정합 복구
# 또는 CLI:
node scripts/probe-reconcile-week.mjs 25-01 --apply
```

→ `usp_StockCalculation` 전 품목 실행. **`Product.Stock` 음수만으로는 해결 안 될 수 있음.**

### 4.3 전 차수 재확정 (bulk)

데이터 대칭이 깨진 경우 — **높은 차수→낮은 차수 unfix**, **낮은→높은 fix** (전 카테고리).

```bash
node scripts/bulk-refix-weeks.mjs --from 20-01 --to 25-01 --apply
```

2026-06-24 운영 실행: 12주, ~64분, API 오류 0. 이후에도 `StockMaster.isFix=0`은 DB 구조상 남을 수 있음.

### 4.4 `Product.Stock` 음수 — 🚫 `repair-negative-product-stock.js` 운영 금지

2026-06-24 `--all --apply` 실행 후 **26-1 유령재고 1,665+** 사고.  
음수를 `ProductStock` 스냅샷으로 올리면 과출고 품목에 **재고가 생김**.

**대신:** [STOCK_INTEGRITY_DESIGN.md](STOCK_INTEGRITY_DESIGN.md) §2.3 복구 사다리 (reconcile → sync-week-stock-to-live).

```bash
# 🚫 금지
# node scripts/repair-negative-product-stock.js --all --apply

# ✅ 음수 진단만 (apply 없음)
node scripts/probe-negative-stock-week.js 2026 25-01
```

스크립트 파일은 감사용으로만 보존. apply 시 exit 차단 권장(§6.2).

### 4.5 권장 순서 (25-01 유형)

1. `fix-parity-audit` — 출고확정 vs 재고마감 vs 음수 건수 확인
2. **재고 정합 복구** (§4.2)
3. 여전히 `Product.Stock` 음수 → [STOCK_INTEGRITY_DESIGN.md](STOCK_INTEGRITY_DESIGN.md) §2.3 (reconcile·sync, **repair-negative 금지**)
4. SP 대칭 오류 의심 시 → **§4.3** bulk 재확정 (운영 판단)
5. 재확인: `negativeLiveCount: 0`, exe 재고 화면

---

## 5. 운영 스크립트 일람

| 스크립트 | 용도 |
|----------|------|
| `probe-fix-parity-audit.mjs` | exe/web 확정·재고 불일치 진단 |
| `probe-reconcile-week.mjs` | 차수 `usp_StockCalculation` (--apply) |
| `probe-negative-stock-week.js` | 차수별 `Product.Stock` 음수 목록 |
| `probe-product-stock-target.js` | 품목별 스냅샷 vs live 비교 |
| `bulk-refix-weeks.mjs` | 구간 전체 unfix→fix |
| `repair-negative-product-stock.js` | 🚫 **apply 금지** — 진단만. [STOCK_INTEGRITY_DESIGN](STOCK_INTEGRITY_DESIGN.md) |
| `sync-week-stock-to-live.js` | 차수 live↔`ProductStock` 동기화 |
| `probe-week-stock-gaps.js` | 차수별 live vs ps gap 스캔 |
| `undo-web-recovery-stock.js` | `웹복구` StockHistory 롤백 |

---

## 6. 배포 이력

| 커밋 | 내용 |
|------|------|
| `407b2d4` | reconcile + guards + UI |
| `73e2dc3` | reconcile API sql type hotfix |
| `8142a9a` | 음수 복구 스크립트 + 작업 보고 |

운영: https://nenovaweb.com (Cafe24 VPS, GitHub Actions Deploy)

---

## 7. 한계 · 후속

| 항목 | 비고 |
|------|------|
| `StockMaster.isFix=0` | 일부 DB에서 웹 fix 후에도 0 유지 — `FIXED_PENDING_STOCK` 표시 |
| 실재고 부족 | reconcile/동기화로 해결 불가 — 입고·수량 점검 필요 |
| 25-02 `PARTIAL` | 일부 카테고리 미확정 — 음수 재고와 별개 |
| EXE 견적 비고 누적 | [`NENOVA_EXE_PRINT_DESCR_PATCH.md`](NENOVA_EXE_PRINT_DESCR_PATCH.md) |
| 유령재고·live↔ps drift | [`STOCK_INTEGRITY_DESIGN.md`](STOCK_INTEGRITY_DESIGN.md) |
| `ShipmentDetail.CustKey` NULL | `distribute-diagnose` — 확정 표시와 별개 |

---

## 8. 관련 문서

- [`WEB_VS_ERP_CONFLICTS.md`](WEB_VS_ERP_CONFLICTS.md) §7~9 — DetailFix, 이중 재고
- [`NENOVA_WEB_MASTER_ISSUES_AND_WORK_GUIDE.md`](NENOVA_WEB_MASTER_ISSUES_AND_WORK_GUIDE.md) §H — 확정 이슈 색인
