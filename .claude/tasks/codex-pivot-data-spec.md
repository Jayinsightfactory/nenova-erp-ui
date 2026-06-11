# Codex 위임 — Pivot 통계 데이터층 (exe 정합 + 분배단가)

## Problem Statement

nenovaweb `lib/pivotStats.js`의 Pivot 통계 API가 nenova.exe Pivot 화면과 **열 구조·집계 방식**이 다르다.
exe 스크린샷(24-02, 콜롬비아): 행=국가>꽃>품목명, 열=주문년도>주문차수>구분(02.주문|03.입고) **2개 값 열** (거래처/농장 전개 없음).
웹은 02.주문 아래 거래처 N열, 03.입고 아래 농장 M열로 전개.

추가 요구: **분배에 입력된 단가** (`ShipmentDetail.Cost`, 출고분배 저장 시 기록) 를 거래처×품목별로 pivot에 노출.

## Environment

- Stack: Node.js, mssql, Next.js pages/api
- DB: MSSQL (OrderMaster/Detail, ShipmentMaster/Detail, WarehouseMaster/Detail, ProductStock, StockHistory, CustomerProdCost)
- Path: `C:\Users\USER\nenova-erp-ui`

## Relevant Code (complete)

### File: lib/pivotStats.js

```javascript
// (전체 287줄 — Cursor가 파일 전문을 Codex에 붙일 때 이 파일 그대로 사용)
// 핵심: getPivotStats({ weekStart, weekEnd, orderYear })
// rows[].orders = { custName: outQty }
// rows[].costOrders = CustomerProdCost || Product.Cost  ← 분배단가 아님
// rows[].incoming = { farmName: inQty }
// curStock = prevStock + totalIncoming - totalOrder
// noneOut = max(0, totalOrder - totalIncoming)
```

### distribute.js 단가 저장 (참고)

```javascript
// pages/api/shipment/distribute.js POST
// ShipmentDetail INSERT/UPDATE 시 Cost=@cost (resolvedCost from input or CustomerProdCost)
// ISNULL(sd.Cost, ISNULL(cpc.Cost, p.Cost)) AS 단가 in GET
```

## exe vs web 차이 (확인 필요)

| 항목 | exe (스크린샷) | web (현재) |
|------|----------------|------------|
| 02.주문 열 | 품목당 1열(합계) | 거래처별 N열 |
| 03.입고 열 | 품목당 1열(합계) | 농장별 M열 |
| 필터 | `[구분] In [02,03] And [국가]=콜롬비아` | Filter Editor + 헤더 ▼ |
| 단가 | (확인) | costOrders=마스터단가 |

## Constraints

- 기존 `getPivotStats` 반환 shape 하위호환 (customers/farms/rows 유지)
- 추가 필드만 확장: `distCostOrders`, `summaryMode` 지원 데이터
- 수국/알스트로/재고조정 입고 규칙 유지
- `confirmedOut` (isFix=1) vs order qty 관계 exe와 맞는지 검증

## Expected Output Format

1. **Root cause**: web이 왜 exe와 다른 pivot shape인지 (설계 vs 미구현)
2. **SQL patch**: ShipmentDetail.Cost → `distCostOrders[custName]` 집계 쿼리 (완전한 JS 코드)
3. **집계 공식 표**: prevStock, totalOrder, totalIncoming, noneOut, curStock — exe 기준 vs 현재 코드 diff
4. **API response 확장 스키마** (JSON 예시 1건)
5. **검증 SQL** 2~3개 (24-02 콜롬비아 장미 Freedom 50cm sanity check)
6. **Edge cases**: Cost=0, 미분배 품목, 다중 ShipmentDetail 행 merge 규칙 (MAX vs SUM vs latest)

## Attempted Fixes

| # | Change | Result |
|---|--------|--------|
| — | (신규 작업) | — |

---

**Codex 출력을 `docs/PIVOT_DATA_SPEC_CODEX.md` 형식으로 작성해 주세요.**
