# 작업 완료 — Product.Stock 음수 복구

**일자:** 2026-06-24  
**선행 작업:** [출고 확정 exe 정합](2026-06-16_shipment-fix-exe-reconcile.md), bulk 재확정 20-01~25-02  
**설계·운영 가이드:** [`SHIPMENT_FIX_EXE_RECONCILE.md`](../SHIPMENT_FIX_EXE_RECONCILE.md) §4.4

---

## 증상

- nenova.exe 25-01: 재고 **마이너스** 17품목 (예: 화이트 수국 live=-129, `ProductStock` 25-01=16)
- nenovaweb: 출고확정 **FIXED** (`ShipmentDetail.isFix` 전부 1)
- `fix-parity-audit`: `StockMaster.isFix=0`, `negativeProductStock` 17건

## 원인

`Product.Stock`(SP ± 누적)과 `ProductStock`(차수 스냅샷) **이중 재고** 불일치.

- 2026-06-23 카테고리별 unfix→fix (`nenovaSS2`, 25-01 일부 카테고리)
- 2026-06-24 bulk unfix/fix 20-01~25-02 후 실시간만 비대칭

`usp_StockCalculation`(reconcile)만으로는 `Product.Stock` 음수가 남음.

## 조치

`scripts/repair-negative-product-stock.js`

1. `Product.Stock < 0` 품목 수집 (차수 또는 `--all` 2026 출고)
2. 목표 = `ProductStock` **25-02 → 25-01 → 24-02 → 24-01**
3. `StockHistory`(재고조정) + `UPDATE Product.Stock` + `usp_StockCalculation`

## 결과

| 실행 | 대상 | 결과 |
|------|------|------|
| `25-01 --apply` | 17품목 | 음수 0 |
| `--all --apply` | +26품목 | **운영 DB 전체 음수 0** |

**검증 (20-01 ~ 25-02):** `negativeLiveCount: 0`  
**잔여:** `exeAligned: false` — `StockMaster.isFix=0` only (음수 아님)

## 커밋

`8142a9a` — 스크립트 3종 + 본 문서

## 재실행

```bash
node scripts/repair-negative-product-stock.js 25-01 --apply
node scripts/repair-negative-product-stock.js --all --apply
node scripts/probe-negative-stock-week.js 2026 25-01
```
