# 차수피벗 — 수량 변경·붙여넣기 주문등록 → 주문/분배 경로 재점검 (2026-06-16)

## 범위

| 화면/동작 | 사용자 조작 | 기대 DB 반영 |
|-----------|-------------|--------------|
| **A. 피벗 셀 편집** | 업체×품목×차수 셀 클릭 → 출고수량 수정 | OrderDetail + ShipmentDetail 동시 증감 |
| **B. 피벗 주문추가 모달** | ➕ 주문추가 | 기본: OrderDetail만 / 분배동시: Order + Shipment |
| **C. 피벗 → 붙여넣기** | 📋 붙여넣기 주문등록 (새 창) | paste 페이지 경로에 따름 (아래 §4) |

참조: `docs/ERP_COMPAT_INVARIANTS_2026-06-04.md`, `docs/OUTUNIT_WRITE_AUDIT_2026-06-10.md` §7, `docs/PAGE_DATA_INPUT_DB_PARITY_AUDIT_2026-05-26.md`

---

## 전체 흐름 요약

```mermaid
flowchart TD
  subgraph pivot [차수피벗 /shipment/week-pivot]
    A[셀 클릭 출고수량 수정] --> ADJ["POST /api/shipment/adjust<br/>ADD/CANCEL delta"]
    B1[주문추가 기본] --> AO["POST stock-status addOrder<br/>OrderDetail만"]
    B2[주문추가 + 분배동시] --> AOD["addOrderDelta + PATCH outQty delta"]
    C1[붙여넣기 버튼] --> PASTE["/orders/paste 새 창"]
  end

  subgraph paste [/orders/paste]
    P1[등록] --> ORD["POST /api/orders delta<br/>OrderDetail만"]
    P2[일괄 등록+분배] --> ADJ2["POST adjust + unit<br/>Order+Shipment"]
    P3[일괄 분배] --> DIST["POST /api/shipment/distribute<br/>ShipmentDetail 절대값"]
  end

  ADJ --> DB[(OrderDetail + ShipmentDetail + ShipmentDate + ShipmentAdjustment)]
  ADJ2 --> DB
  AO --> OM[(OrderDetail)]
  ORD --> OM
  AOD --> DB
  DIST --> SD[(ShipmentDetail + ShipmentDate)]
```

---

## A. 피벗 셀 편집 (`savePvCell`)

**코드:** `pages/shipment/week-pivot.js` (셀 표시·편집), `pages/api/shipment/adjust.js` (저장)

### 표시 vs 저장 단위

| 항목 | 값 |
|------|-----|
| 셀 표시값 | `ShipmentDetail.OutQuantity` (`outQty`, **OutUnit 기준**) |
| API | `POST /api/shipment/adjust` — `type: ADD\|CANCEL`, `qty: \|new-old\|`, **`unit` 미전송** |
| userUnit | `unit` 없음 → `normalizeOrderUnit(undefined, prodOutUnit)` = **OutUnit** |
| OrderDetail | 동일 delta로 Box/Bunch/Steam/OutQuantity 갱신 |
| ShipmentDetail | `computeShipmentAdjustUnits`로 OutUnit 환산 후 갱신 |

**단위 판정: ✅ 안전** — `OUTUNIT_WRITE_AUDIT_2026-06-10.md` §3·§7.1과 동일. 장미(OutUnit=박스) 셀에서 `5→10`이면 OutQuantity +5(박스), 10배 오류 없음.

### 전산 불변식 (9항) — adjust 경로

| # | 불변식 | 셀 편집 |
|---|--------|---------|
| 1 | Manager = UserID | OrderMaster 신규 시 `UserInfo WHERE UserName=N'관리자'` → UserID |
| 2 | OrderYearWeek = 연도+대차수 | `ywk = orderYear + orderWeek.split('-')[0]` |
| 3 | ShipmentDetail.CustKey = Master | UPDATE/INSERT 시 `@ck` 강제 |
| 4 | ShipmentDtm = BaseOutDay + ShipmentDate 재생성 | `@dt` 강제 + `refreshShipmentDatesAfterDetailChange` |
| 5 | 5종 환산, Est≠Out 강제 금지 | `computeShipmentAdjustUnits` + `estimateQuantityFromShipmentUnits` |
| 6 | ShipmentMaster 재사용 | CustKey+OrderWeek 기존 row 재사용 |
| 7 | sd.isDeleted 없음 | 쿼리에 sd.isDeleted 미사용 |
| 8 | safeNextKey + tryInsertWithRetry | 준수 |
| 9 | 1 Detail + N ShipmentDate | adjust 후 ShipmentDate 동기화 |

**판정: ✅ nenova.exe 충돌 없음** (2026-06-04 전수감사 + 2026-06-11 adjust 단위 수정 반영 전제)

### 부가 가드

- **확정 셀:** UI `isWeekPivotCellFixed` → 클릭 차단 (`ShipmentDetail.isFix=1` && outQty>0)
- **API 확정:** `assertProductScopeNotFixed` — 동일 차수·**CountryFlower 품목군** 내 확정 라인 있으면 거부
- **입고 검증:** ADD 시 totalIn=0 또는 잔량 음수 → 오류, UI에서 confirm 후 `force: true` 재시도
- **이력:** ShipmentAdjustment INSERT, ShipmentDetail.Descr·ShipmentHistory 누적

### ⚠️ 운영 주의 (버그 아님, UX/프로세스)

1. **셀은 출고수량만 표시** — 주문만 등록(`custOrderQty>0`, `outQty=0`)이면 셀은 `·`(0). 이때 셀을 5로 바꾸면 **주문+5, 분배+5** (주문 10→15, 분배 0→5). “분배만 5”가 아님.
2. **확정 가드 범위 불일치** — UI는 셀(품목×업체) 단위, API는 CountryFlower 품목군 단위. 같은 품종군 다른 업체가 확정돼 있으면 UI는 편집 가능해도 API 거부 가능.

---

## B. 피벗 주문추가 모달

**코드:** `pages/shipment/week-pivot.js` `OrderAddModal.handleSubmit`, `pages/api/shipment/stock-status.js`

| 모드 | 1단계 | 2단계 | ShipmentDetail |
|------|-------|-------|----------------|
| **기본** | `addOrder` (절대 qty) | — | **생성 안 함** |
| **분배 동시 적용 ✓** | `addOrderDelta` | `PATCH outQty`, `mode:'delta'` | delta만큼 증감 |

- 단위: 카트에 `Product.OutUnit` 기본, 사용자 변경 가능 → stock-status에서 `toOrderUnits` 환산
- OrderMaster Manager: `req.user.userId` (UserID) — 불변식 1 준수
- **피벗 조회:** `outQty` 기준이므로 기본 모드만 쓰면 **조회 후에도 출고 칸 0** — 분배동시 체크 또는 paste의 “일괄 분배”/셀 adjust 필요

**판정: ✅ 의도된 2단계 설계.** 전산과 충돌 없음. 다만 “주문만 넣고 피벗 출고 칸에 바로 숫자”를 기대하면 안 됨.

---

## C. 피벗 → 붙여넣기 주문등록

**연결:** `week-pivot.js` — `window.open('/orders/paste')`. 등록 후 **부모 창 자동 새로고침 없음** → 차수피벗에서 **🔍 조회** 수동 필요 (버튼 title에 명시).

paste → 차수피벗: `openWeekPivot()` — `?weekFrom=&weekTo=` 전달 ✅

---

## D. 붙여넣기(`/orders/paste`) — 주문/분배 3경로

### D-1. [등록] — `handleRegister`

```
POST /api/orders  { delta: true, source: 'paste', items[] }
→ OrderMaster + OrderDetail만 (ShipmentDetail 없음)
```

- 단위: `normalizeOrderUnit(it.unit)` + 파싱 시 `defaultUnit(prod, …)` (장미→단, 기타→박스 등)
- 확정 검사: **없음** (주문만이므로 적절)
- 차수피벗 반영: 행은 `custOrderQty`로 잡히지만 **셀 숫자는 outQty=0**

### D-2. [🚀 일괄 등록+분배] — `handleBulkDistribute`

```
POST /api/shipment/adjust  { type, qty, unit: t.unit, force: true }
→ OrderDetail + ShipmentDetail 동시 ADD/CANCEL
```

| 항목 | 상태 |
|------|------|
| 단위 | `unit` **명시 전송** — 2026-06-11 `computeShipmentAdjustUnits` FIX 후 ✅ (10단→1박스) |
| 확정 | `ensureWeekCanDistribute` → adjust `fixCheck` / 품목군 확정 |
| force | paste는 항상 `force: true` (입고 0 선분배 허용) |
| handleRegister | **별도 호출 불필요** (코드 주석) — 이 버튼만 쓸 것 |

**⚠️ 이중 등록:** 먼저 [등록] 후 같은 수량으로 [일괄 등록+분배] → adjust ADD가 **주문을 한 번 더 가산**. 반드시 **둘 중 하나만** 사용.

### D-3. [🚀 일괄 분배] — `handleDistributeOnly` (등록 후)

```
POST /api/shipment/distribute  { outQty: 절대값 }
→ ShipmentDetail만 (OrderDetail 변경 없음)
```

- 등록된 `registeredOrders` 수량 기준 — 주문 재가산 없음 ✅
- `ensureWeekCanDistribute` 적용 ✅
- distribute 경로도 불변식 3·4·9 준수 (별도 감사 완료)

### D-4. 개별 분배 추가/취소 모달 — `handleAdjust`

- adjust + `unit: adjustModal.unit` — 일괄과 동일 단위 FIX 적용 ✅
- `ensureWeekCanDistribute` ✅

---

## 경로별 비교표 (운영자용)

| 목적 | 권장 조작 | API | 피벗 셀에 바로 보임 |
|------|-----------|-----|---------------------|
| 출고(분배) 수량만 ± | 피벗 셀 편집 | adjust | ✅ (outQty) |
| 카톡 붙여넣기 → 주문+분배 한 번에 | paste **일괄 등록+분배** | adjust | ✅ (조회 후) |
| 붙여넣기 → 주문만 | paste **등록** | orders | ❌ (outQty=0) |
| 주문 등록 후 분배만 | paste **등록** → **일괄 분배** | orders → distribute | ✅ |
| 피벗에서 신규 주문+분배 | 주문추가 + **분배 동시 적용** | addOrderDelta + PATCH | ✅ |

---

## nenova.exe 충돌 종합 판정

| 경로 | 전산 호환 | 단위 | 주문↔분배 대칭 | 비고 |
|------|-----------|------|----------------|------|
| A. 피벗 셀 adjust | ✅ | ✅ OutUnit | ✅ 동시 delta | 주문만 있는 셀 0 표시 주의 |
| B. 주문추가 기본 | ✅ | ✅ | ➖ 분배 없음 | 의도 |
| B. 주문추가+분배 | ✅ | ✅ | ✅ 2단계 | |
| D-1 paste 등록 | ✅ | ✅ | ➖ 분배 없음 | |
| D-2 paste 일괄 등록+분배 | ✅ | ✅ (6/11 FIX) | ✅ | 등록과 중복 사용 금지 |
| D-3 paste 일괄 분배 | ✅ | ✅ distribute | ✅ 주문 유지 | |

**결론: 2026-06-16 기준 코드·배포 HEAD(`988eb5c` 이후)에서 차수피벗 수량 변경 및 붙여넣기 주문등록→분배 경로는 nenova.exe DB 불변식과 충돌하지 않는다.**  
남는 리스크는 **코드 결함이 아니라 운영 순서**(등록+일괄분배 이중 클릭, 주문만 넣고 셀 0을 분배로 오해)와 **UI 표시(outQty vs custOrderQty)** 이다.

---

## 권장 후속 (선택, 코드 변경 아님)

1. **운영 가이드 1줄** — paste 화면 [등록] 옆에 “분배까지 하려면 일괄 등록+분배 사용, 등록과 동시 사용 금지” (이미 confirm 문구에 부분 포함).
2. **진단 스크립트** — 특정 차수 `OrderDetail.OutQuantity` vs `ShipmentDetail.OutQuantity` by CustKey×ProdKey diff (주문만/분배만 불일치 탐지).
3. **셀 표시 개선(기능)** — `outQty=0 && custOrderQty>0`일 때 셀에 `(주문 N)` 힌트 (요청 시).

---

## 검증 체크리스트 (수동)

```text
[ ] 미확정 차수에서 피벗 셀 0→N → nenova.exe 분배 화면 동일 수량
[ ] paste 일괄 등록+분배 "10단" 장미 → OutQuantity +1박스 (B1B=10)
[ ] paste [등록]만 → 피벗 조회 시 행은 있으나 출고 셀 0
[ ] paste [등록] → [일괄 분배] → 출고 셀 = 주문수량, OrderDetail 재가산 없음
[ ] 확정 품목군에서 adjust 거부 메시지 = paste ensureWeekCanDistribute 와 동일 톤
[ ] adjust 후 ShipmentDate.EstQuantity ≠ 0 (견적 노출)
```

관련 테스트: `npm run test:adjust-unit`, `npm run test:estimate` (견적 유령행은 별도 이슈, 988eb5c)
