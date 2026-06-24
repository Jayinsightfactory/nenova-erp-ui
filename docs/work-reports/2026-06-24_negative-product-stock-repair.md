# Product.Stock 음수 복구 (2026-06-24)

## 원인

- `Product.Stock`(exe 실시간)과 `ProductStock`(차수 스냅샷) **이중 재고** 구조
- 카테고리별 확정취소/재확정 누적 + 전차수 bulk unfix/fix 후 `Product.Stock`만 비대칭
- 예: pk=889 화이트 수국 — `live=-129`, `ProductStock 25-01=16`, `25-02=6`

## 조치

`scripts/repair-negative-product-stock.js`

1. `Product.Stock < 0` 품목 수집
2. 목표값 = `ProductStock` **25-02 → 25-01 → …** 스냅샷
3. `StockHistory`(재고조정) + `UPDATE Product.Stock` + `usp_StockCalculation`

## 결과

| 실행 | 대상 | 결과 |
|------|------|------|
| `25-01 --apply` | 17품목 | 음수 0 |
| `--all --apply` (2026 출고 품목) | +26품목 | **전체 음수 0** |

25-01 `fix-parity-audit`: `negativeProductStock: []`  
남은 경고: `StockMaster.isFix=0` only (전산 DB 특성, 출고·실시간재고와 별개)

## 재실행

```bash
node scripts/repair-negative-product-stock.js 25-01 --apply
node scripts/repair-negative-product-stock.js --all --apply
node scripts/probe-negative-stock-week.js 2026 25-01
```
