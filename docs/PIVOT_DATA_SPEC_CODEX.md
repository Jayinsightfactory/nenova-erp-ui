# Pivot 통계 데이터층 스펙 — exe 정합 + 분배단가

> 산출물: `lib/pivotStats.js` `getPivotStats()` 확장. 기존 반환 shape **하위호환 유지**(customers/farms/rows),
> 신규 필드만 additive 확장(`rows[].distCostOrders`, `rows[].summary`).
> 작성: 2026-06-12 · 검증: `npm run test:pivot`

---

## 1. Root cause — web이 exe와 다른 pivot shape인 이유

| 측면 | 내용 |
|------|------|
| 설계 차이 | exe Pivot 은 **02.주문 / 03.입고를 품목당 1열(합계 값)** 로 표시(compact). web 은 처음부터 02.주문 아래 **거래처 N열**, 03.입고 아래 **농장 M열** 로 전개(detail)하도록 구현됨. |
| 미구현 | 분배 단계에서 입력된 단가(`ShipmentDetail.Cost`)를 pivot 이 전혀 조회하지 않았음. `costOrders` 는 `CustomerProdCost || Product.Cost` (마스터 단가)일 뿐 분배단가가 아니었음. |

→ 해결: 데이터층은 **두 모드 모두**를 지원하도록 값을 제공한다. detail 용 `orders`/`incoming` 은 그대로 두고,
compact 용 단일값 `summary.{totalOrder,totalIncoming}` 와 분배단가 `distCostOrders` 를 **추가만** 한다. 뷰 전환은 UI(`pages/stats/pivot.js`) 책임.

---

## 2. SQL patch — `ShipmentDetail.Cost` → `distCostOrders[custName]`

```sql
SELECT sd.ProdKey AS prodKey, c.CustName AS custName,
       ISNULL(sd.OutQuantity, 0) AS outQty, ISNULL(sd.Cost, 0) AS cost
FROM ShipmentDetail sd
JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey AND sm.isDeleted = 0
JOIN Customer c        ON sm.CustKey = c.CustKey AND c.isDeleted = 0
WHERE (sm.OrderYear + REPLACE(sm.OrderWeek,'-','')) >= @yws
  AND (sm.OrderYear + REPLACE(sm.OrderWeek,'-','')) <= @ywe
  AND ISNULL(sd.OutQuantity, 0) > 0;
```

- **거래처 기준 = `ShipmentMaster.CustKey`** (출고 소유 거래처). `orders` 맵이 `Customer.CustName` 으로 키잉되므로
  동일하게 `c.CustName` 으로 키잉해 정합을 맞춘다.
- `isFix` 필터 **미적용**: 분배단가는 확정 전에도 의미가 있으며 exe "분배단가"는 입력 즉시 노출된다.
  (`confirmedOut` 의 `isFix=1` 과 목적이 다름.)
- `OutQuantity > 0` 으로 빈 레코드/고스트(루트 CLAUDE 패턴 1·2)를 배제.

집계는 순수함수 `aggregateDistCostOrders(records)` 가 담당 → DB 없이 단위테스트 가능.
> 구현 위치: `lib/pivotDistCost.js` (db/번들러 의존 없음). `lib/pivotStats.js` 가 동일 함수를 re-export 하므로
> 호출부는 어느 쪽에서 import 해도 된다. 테스트(`__tests__/pivotStats.test.js`)는 node 단독 실행을 위해
> `lib/pivotDistCost.js` 를 직접 import 한다.

```js
// 동일 (prodKey, custName) 다행 → OutQuantity 가중 평균
//   distCost = Σ(outQty · cost) / Σ(outQty)
//   sumOut===0 (이론상 없음) → MAX cost 폴백
const distCostMap = aggregateDistCostOrders(distCostResult.recordset);
// rows[].distCostOrders = distCostMap[prodKey] || {}
```

### Merge 규칙 선택 근거 (Edge cases 6 대응)

| 상황 | 처리 |
|------|------|
| 단일 행 | cost 그대로 |
| 다중 행 (부분 분배) | **OutQuantity 가중 평균** — 단가의 실효 평균. MAX/latest 는 한 행의 이상치에 끌려감 |
| `Cost = 0` | 가중 평균에 0으로 반영(분자 기여 0). 전부 0이면 결과 0 → UI 에서 미표시 |
| 미분배 품목 | distCost 행 없음 → `distCostOrders = {}` (키 부재) |
| `OutQuantity = 0` 빈 레코드 | WHERE 에서 제외 |

---

## 3. 집계 공식 표 — exe 기준 vs 현재 코드

| 필드 | 공식 | exe 정합 | 비고 |
|------|------|----------|------|
| `prevStock` | 직전 StockMaster 스냅샷의 `ProductStock.Stock` | ✅ | `OrderYearWeek < @yws` TOP 1 |
| `totalOrder` | Σ `OrderDetail.OutQuantity` (거래처 합) | ✅ 02.주문 | OutUnit 환산 단일값 |
| `totalIncoming` | Σ `WarehouseDetail.OutQuantity` + 재고조정 | ✅ 03.입고 | 농장 + `재고조정` farm 포함 |
| `noneOut` | `max(0, totalOrder − totalIncoming)` | ✅ 03.미발주 | |
| `curStock` | `prevStock + totalIncoming − totalOrder` | ✅ 05.현재고 | |
| `confirmedOut` | Σ `ShipmentDetail.OutQuantity` (`isFix=1`) | 참고값 | 주문열 아님 — 확정 출고량 |
| `distCostOrders[cust]` | OutQuantity 가중 평균 `ShipmentDetail.Cost` | 🆕 분배단가 | 신규 |

→ 집계 공식 자체는 exe 와 일치. **차이는 표시 shape(전개 vs 합계)뿐** → UI 책임.

---

## 4. API response 확장 스키마 (예시 1건)

```jsonc
{
  "success": true,
  "orderYear": "2024",
  "weekStart": "24-02",
  "weekEnd": "24-02",
  "customers": [ { "custKey": 31, "area": "서울", "custName": "콜롬비아상사", "orderCode": "A12", "custDescr": "" } ],
  "farms": [ "FlorAndes", "재고조정" ],
  "rows": [
    {
      "country": "콜롬비아", "flower": "장미", "prodName": "Freedom 50cm",
      "prodKey": 10231, "unit": "박스", "area": "서울",
      "prevStock": 0,
      "orders": { "콜롬비아상사": 12, "OO플라워": 8 },
      "costOrders": { "콜롬비아상사": 18000, "OO플라워": 18000 },   // 마스터 단가(기존)
      "distCostOrders": { "콜롬비아상사": 17500, "OO플라워": 18000 }, // 🆕 분배 입력단가
      "totalOrder": 20,
      "incoming": { "FlorAndes": 25 },
      "totalIncoming": 25,
      "summary": { "totalOrder": 20, "totalIncoming": 25 },          // 🆕 compact 단일값
      "noneOut": 0, "curStock": 5,
      "confirmedOut": 20, "stockAdjust": 0,
      "outDate": "2024-01-12", "inPrice": 0, "inTotal": 0, "awb": ""
    }
  ]
}
```

신규 필드: `rows[].distCostOrders`, `rows[].summary`. 그 외 모두 기존과 동일(하위호환).

---

## 5. 검증 SQL (24-02 콜롬비아 장미 Freedom 50cm sanity check)

```sql
-- (1) 분배단가 가중평균 직접 계산 — 코드 distCostOrders 와 일치해야 함
SELECT c.CustName,
       SUM(sd.OutQuantity)                         AS sumOut,
       SUM(sd.OutQuantity * ISNULL(sd.Cost,0))      AS sumCostOut,
       SUM(sd.OutQuantity * ISNULL(sd.Cost,0)) / NULLIF(SUM(sd.OutQuantity),0) AS distCost
FROM ShipmentDetail sd
JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey AND sm.isDeleted = 0
JOIN Customer c        ON sm.CustKey = c.CustKey
JOIN Product p         ON sd.ProdKey = p.ProdKey
WHERE p.ProdName = N'Freedom 50cm' AND p.CounName = N'콜롬비아'
  AND (sm.OrderYear + REPLACE(sm.OrderWeek,'-','')) = '202402'
  AND sd.OutQuantity > 0
GROUP BY c.CustName;

-- (2) totalOrder 정합 — 주문열 합계
SELECT SUM(od.OutQuantity) AS totalOrder
FROM OrderMaster om
JOIN OrderDetail od ON om.OrderMasterKey = od.OrderMasterKey AND od.isDeleted = 0
JOIN Product p      ON od.ProdKey = p.ProdKey
WHERE p.ProdName = N'Freedom 50cm' AND om.isDeleted = 0
  AND (om.OrderYear + REPLACE(om.OrderWeek,'-','')) = '202402';

-- (3) curStock 정합 — prevStock + totalIncoming - totalOrder
--     화면 05.현재고 값과 비교
```

---

## 6. Edge cases 요약

| # | 케이스 | 동작 |
|---|--------|------|
| 1 | `Cost = 0` | 가중평균 분자 기여 0; 전부 0이면 0 → UI 미표시 |
| 2 | 미분배 품목 | `distCostOrders` 키 부재(`{}`) |
| 3 | 다중 ShipmentDetail | **SUM 아님** — OutQuantity 가중 평균(단가 보존) |
| 4 | `OutQuantity=0` 빈 레코드 | WHERE 제외 |
| 5 | 분배만 있고 주문 없는 품목 | row 미생성(주문/입고/조정 키 기준) — 기존 동작 유지(분배단가만으로 row 추가하지 않음) |
| 6 | `ShipmentMaster.isDeleted=1` | JOIN 조건으로 제외 |

---

## 7. 도착원가 (arrivalCost)

### 7.1 정의

`rows[].arrivalCost` = 운송기준원가 탭(`/freight`)이 표시하는 `displayArrivalKRW` 와 동일한 값.

```
displayArrivalKRW = (FOB_USD + freightPerDisplayUnit_USD) × exchangeRate × (1 + tariffRate) + customsPerDisplayUnit_KRW
```

- `displayUnit`(박스/단/송이) 은 `Product.OutUnit` 최빈값으로 카테고리별 자동 결정.
- 따라서 **박스 품목은 박스당 원가**, **단 품목은 단당 원가**, **송이 품목은 송이당 원가**.
- UI 엔지니어는 `arrivalMeta.displayUnit` 을 함께 표시해 단위를 사용자에게 안내해야 한다.

### 7.2 조인 구조

```
WarehouseMaster (AWB/BILL 헤더)
  OrderYear + REPLACE(OrderWeek,'-','')  ↔  pivot weekStart~weekEnd 범위
    ↓ WarehouseKey
WarehouseDetail (입고 품목행 + 특수행)
  ProdKey  ↔  rows[].prodKey
  OutQuantity  → 가중평균 denominator (inQty)
FreightCost (스냅샷 헤더, isDeleted=0)
  WarehouseKey  ↔  WarehouseMaster.WarehouseKey
    ↓ FreightKey
FreightCostDetail (스냅샷 품목별 결과)
  ProdKey  ↔  WarehouseDetail.ProdKey
  ArrivalPerStem, ArrivalPerBunch
```

### 7.3 snapshot vs live 결정 규칙

| 조건 | 경로 | arrivalCost 산출 |
|------|------|-----------------|
| FreightCost 스냅샷 있음 + AWB 내 `OutUnit='박스'` 품목 없음 | **snapshot** | ArrivalPerBunch (단) / ArrivalPerStem (송이) |
| FreightCost 스냅샷 없음 | **live** | `computeFreightCost()` 전체 실행 → `displayArrivalKRW` |
| 스냅샷 있어도 `OutUnit='박스'` 품목이 하나라도 존재 | **live** | 동일 (박스 컬럼이 스냅샷에 없음) |

**핵심 함정 (박스 displayUnit):** `FreightCostDetail` 에는 `ArrivalPerStem` / `ArrivalPerBunch` 만 저장되고 `ArrivalPerBox` 컬럼이 없다. 콜롬비아 장미처럼 `OutUnit='박스'` 인 품목의 도착원가는 스냅샷에서 재현할 수 없으므로 반드시 LIVE 계산을 사용해야 한다.

**안전 원칙:** AWB 그룹 내에 박스/단/송이가 혼재하면 스냅샷 일부 + live 일부를 섞지 않고, **그룹 전체를 live 로 일관 처리**한다. freight 탭과 동일 로직이므로 수치 일치가 보장된다.

### 7.4 다중 AWB / 다중 농장 가중평균

동일 ProdKey 가 여러 AWB 에 걸쳐 입고되면:

```
arrivalCost = Σ(WarehouseDetail.OutQuantity × displayArrivalKRW) / Σ(WarehouseDetail.OutQuantity)
```

- `OutQuantity = 0` 행 제외 (고스트/빈 레코드 — CLAUDE 패턴 1·2).
- 전부 0 이면 maxArrival 로 폴백 (이론상 없음).
- `arrivalPerStem` / `arrivalPerBunch` 도 동일 가중평균.

### 7.5 API response 확장 스키마

```jsonc
{
  "rows": [
    {
      // ... 기존 필드 모두 유지 ...
      "arrivalCost": 30250,       // 필수 계약 필드 — displayUnit 당 도착원가 KRW (0 = 데이터 없음)
      "arrivalMeta": {            // 선택 참조 필드 — UI 엔지니어 단위 표시/디버깅용
        "displayUnit": "단",      // '박스'|'단'|'송이'
        "source": "snapshot",     // 'snapshot'|'live'
        "arrivalPerStem": 3025,   // KRW/송이 (항상 제공)
        "arrivalPerBunch": 30250  // KRW/단 (null 가능 — 박스 품목)
      }
    }
  ]
}
```

`arrivalCost = 0` 이면 해당 차수에 freight 데이터가 없는 품목. UI 에서 빈칸/N/A 로 표시 권장.

### 7.6 검증 SQL (24-02 샘플 ProdKey X 기준)

```sql
-- (1) 스냅샷 ArrivalPerBunch vs pivot arrivalCost 직접 비교
SELECT fcd.ProdKey, p.ProdName, p.OutUnit,
       fcd.ArrivalPerStem, fcd.ArrivalPerBunch,
       -- 가중평균 검증
       SUM(wd.OutQuantity)                                           AS totalInQty,
       SUM(wd.OutQuantity * ISNULL(fcd.ArrivalPerBunch, fcd.ArrivalPerStem)) AS sumArrival,
       SUM(wd.OutQuantity * ISNULL(fcd.ArrivalPerBunch, fcd.ArrivalPerStem))
         / NULLIF(SUM(wd.OutQuantity), 0)                           AS arrivalCost_weighted
FROM FreightCostDetail fcd
JOIN FreightCost fc  ON fcd.FreightKey = fc.FreightKey AND fc.isDeleted = 0
JOIN WarehouseMaster wm ON fc.WarehouseKey = wm.WarehouseKey AND wm.isDeleted = 0
JOIN WarehouseDetail wd ON wd.WarehouseKey = wm.WarehouseKey AND wd.ProdKey = fcd.ProdKey
JOIN Product p ON fcd.ProdKey = p.ProdKey
WHERE (wm.OrderYear + REPLACE(wm.OrderWeek,'-','')) = '202402'
GROUP BY fcd.ProdKey, p.ProdName, p.OutUnit, fcd.ArrivalPerStem, fcd.ArrivalPerBunch;

-- (2) 스냅샷 없는 차수는 FreightCostDetail 행 없음 확인
SELECT COUNT(*) AS snapCount
FROM FreightCost fc
JOIN WarehouseMaster wm ON fc.WarehouseKey = wm.WarehouseKey AND wm.isDeleted = 0
WHERE (wm.OrderYear + REPLACE(wm.OrderWeek,'-','')) = '202402'
  AND fc.isDeleted = 0;
```

### 7.7 구현 파일 위치

| 파일 | 역할 |
|------|------|
| `lib/pivotFreightArrival.js` | `aggregateArrivalCosts(records)` 순수함수 + `getArrivalCostsForWeekRange({weekStart,weekEnd,orderYear})` DB 로더 |
| `lib/pivotStats.js` | `getArrivalCostsForWeekRange` 호출 → `rows[].arrivalCost` / `rows[].arrivalMeta` 추가 |
| `__tests__/pivotFreightArrival.test.js` | 순수함수 단위테스트 (9 케이스) — `node __tests__/pivotFreightArrival.test.js` |
| `scripts/probe-pivot-arrival.js` | 차수 24-02 live DB 검증 스크립트 — `node scripts/probe-pivot-arrival.js` |
