# 작업 완료 — 26-01 웹복구 유령재고 제거

**일자:** 2026-06-25  
**원인 스크립트:** `scripts/repair-negative-product-stock.js` (2026-06-24 `--all --apply`)  
**선행 보고:** [Product.Stock 음수 복구](2026-06-24_negative-product-stock-repair.md)

---

## 증상

26-1차 재고가 비정상 증가. 재고 이력에 **25차 웹복구**(`웹복구:Product.Stock→ProductStock(25-02)`) 기록 확인.

일부는 26-1 비고에 웹복구 문구 없이도 `ProductStock`만 전주(25-02) 조정으로 누적됨.

## 원인

`repair-negative-product-stock.js` 가 **음수 `Product.Stock`** 을 **25-02 `ProductStock` 스냅샷**으로 맞춤.

- 실제로는 25-02 과출고분이 음수인 경우가 많아, 스냅샷 동기화 = **유령 재고 +1,665**
- `StockHistory.OrderWeek = 25-02` 로 기록 → 26-1 화면 비고에는 안 보일 수 있음
- `usp_StockCalculation` 으로 26-01 `ProductStock` 까지 전파

## 조치

`scripts/undo-web-recovery-stock.js --apply`

| 구분 | 건수 | 처리 |
|------|------|------|
| 26-1 **수동조정 없음** | 23 | 웹복구 이력 삭제 + `Product.Stock` 복구 전값 |
| 26-1 **수동조정 있음** (사용자 수정 유지) | 20 | 웹복구 이력만 삭제 |
| 재계산 | 43품목 × 25-02·26-01 | `usp_StockCalculation` |

**결과:** 웹복구 `StockHistory` **0건**, 26-01 `ProductStock` gap≥1 **0품목**

## 26-1 수동조정 유지 (nenovaSS3 / nenovaSS1)

- 장미·수국·카네이션 등 nenovaSS3 6/25 조정 — **유지**
- 호주 품목 nenovaSS1 6/25 조정 — **유지** (웹복구와 무관)

## 재발 방지

- `repair-negative-product-stock.js` **운영 재실행 금지** (음수 → ProductStock 동기화는 과출고 시 유령재고 유발)
- 음수는 `ShipmentDetail` 확정 정합 + `usp_StockCalculation` 범위 내에서만 처리

## 26-01 전체 잔량 동기화 (2026-06-25 추가)

`sync-week-stock-to-live.js 26-01 --min=5 --apply`

| 구분 | 건수 |
|------|------|
| 네덜란드 (선행) | 58 |
| **전체 잔여** | **119** |
| 합계 처리 | 177 (중복 없음) |

- `ps→live` 89 — 차수잔량(ProductStock) 유령 제거
- `live→ps` 88 — 실시간(Product.Stock)만 과다 시 ps 기준 정리
- **스킵 29건** — 26-1 수동 StockHistory(`adj26≠0`) 유지 (장미·수국·호주 등)

검증: 26-01 gap≥5 **29건**(전부 수동조정 품목), 네덜란드 **0건**
