# OutUnit=박스 + BunchOf1Box>1 수량 쓰기 정합 감사 — 2026-06-10

## 1. 개요

### 목적
DB 에 OrderDetail / ShipmentDetail / Estimate 의 **수량 필드**(OutQuantity·EstQuantity·BoxQuantity·BunchQuantity·SteamQuantity)를
INSERT/UPDATE 하는 모든 코드 경로를 조사하여, **`Product.OutUnit='박스'` 이면서 `Product.BunchOf1Box(B1B) > 1`** 인 품목
(엑셀·주문 원본이 단(묶음) 단위로 들어오는 장미·카네이션류)에서 **단 수량을 박스로 잘못 저장하는 10배(B1B배) 버그** 가능성을 점검한다.

위험 패턴: 단(bunch) 수량이 박스로 저장되어 `OutQuantity` 가 `B1B` 배 과대 → 잔량 마이너스·견적 과대.

### 범위 (DB 수량 쓰기 경로)
- `pages/api/shipment/distribute.js` (분배 저장)
- `pages/api/shipment/stock-status.js` (출고수량 PATCH + 차수피벗 addOrder)
- `pages/api/shipment/adjust.js` (ADD/CANCEL 분배조정)
- `lib/shipmentImport.js` (엑셀 물량표 업로드 적용)
- `pages/api/orders/index.js` (주문 등록/수정)
- `pages/api/estimate/update-quantity.js` (견적 수량 차감)
- `pages/api/estimate/update-cost.js` (견적 단가 수정)
- `pages/api/estimate/index.js` (견적 차감행 등록)
- `pages/api/public/orders.js` / `pages/api/public/shipments.js` (외부 API)
- `pages/api/m/order-request-approve.js` (모바일 주문신청 승인)
- `pages/api/shipment/estimate-period-repair.js` (견적/기간 보정·중복병합)

### 읽기 전용 명시
**본 감사는 READ-ONLY 다.** 운영 코드·DB·git 을 일절 수정하지 않았으며, 본 문서(`docs/OUTUNIT_WRITE_AUDIT_2026-06-10.md`) 1건만 작성했다.
권고(5장)는 **제안일 뿐 적용하지 않았다.**

### 공유 환산 헬퍼 (정답 기준)
- `lib/distributeUnits.js` → `distributeUnits(qty, product)` — `qty` 는 **OutUnit 기준**(박스 품목=박스수). box/bunch/steam/outQty/estQty 반환.
- `lib/shipmentImportQty.js` → `normalizeUploadQtyForProduct(row, product)` — 엑셀 셀 수량 → OutUnit 기준 환산(장미·카네이션 단→박스, 수국 제외, 알스트로 16배, 차수피벗 단위열). + `detectQtyWarnings`/peer outlier.
- `lib/unitMismatchAudit.js` → `detectStoredBunchAsBox(row, product)` — 읽기 전용 탐지기.

---

## 2. 쓰기 경로 인벤토리

| 파일:라인 | 쓰는 필드 | 수량 소스 / 단위 | 공유헬퍼 | 박스+B1B>1 정합 | 위험도 |
|---|---|---|---|---|---|
| `pages/api/shipment/distribute.js:559,582` (ShipmentDetail U/I) | Out/Est/Box/Bunch/Steam | UI 분배 입력 `outQty` (OutUnit=박스 기준) | `distributeUnits` | 정합 | **SAFE / OK-uses-helper** |
| `pages/api/shipment/stock-status.js:1216,1244` (ShipmentDetail U/I) | Out/Est/Box/Bunch/Steam | PATCH body `outQty` (박스 기준) | `toShipmentUnits`→`distributeUnits` | 정합 | **SAFE / OK-uses-helper** |
| `pages/api/shipment/stock-status.js:1471,1493` (OrderDetail U/I, addOrder) | Out/Est/Box/Bunch/Steam | body `qty`+`unit` (사용자 단위) | `toOrderUnits` | 정합(unit 인지) | **OK-uses-helper** |
| `pages/api/shipment/adjust.js:531,554` (OrderDetail U/I) | Out/Est/Box/Bunch/Steam | `delta` + 기존값, **userUnit 기준 일관** | 로컬 `toAllUnits`(올바름) | 정합 | **SAFE** |
| `pages/api/shipment/adjust.js` (ShipmentDetail U/I) | Out/Est/Box/Bunch/Steam | `curOut(OutUnit) + computeShipmentAdjustUnits(delta,userUnit).deltaOut` | `computeShipmentAdjustUnits`(`toOrderUnits` 환산) | 정합(delta 환산) | **FIXED (2026-06-11)** |
| `lib/shipmentImport.js:1393,1455` (ShipmentDetail U/I) | Out/Est/Box/Bunch/Steam | 엑셀 셀 → `normalizeUploadQtyForProduct` | `normalize`+`distributeUnits` | 정합 | **OK-uses-helper** |
| `lib/shipmentImport.js:1075,1119` (OrderDetail U/I, sync) | Out/Est/Box/Bunch/Steam | `desiredQty=row.uploadQty`(정규화 OutUnit) | `toOrderUnits` | 정합 | **OK-uses-helper** |
| `lib/shipmentImport.js:1674,1713` (ShipmentDetail U/I, 주문→재분배) | Out/Est/Box/Bunch/Steam | 기존 OrderDetail `orderQtyFromDetail` | `distributeUnits` | 정합 | **OK-uses-helper** |
| `pages/api/orders/index.js:439/449,495` (OrderDetail U/I) | Out/Est/Box/Bunch/Steam | `item.qty`+`item.unit`(기본 OutUnit) | 로컬 `toAllUnits`(올바름) | 정합(unit 인지) | **SAFE (헬퍼중복)** |
| `pages/api/estimate/update-quantity.js:200` (ShipmentDetail U) | Box/Bunch/Steam/Out/Est | body `quantity`+`unit`(사용자 단위) | 로컬 `toAllUnits`(올바름) | 정합(unit 인지) | **SAFE (헬퍼중복)** |
| `pages/api/estimate/update-quantity.js:108` (Estimate U) | Quantity/Amount/Vat | Estimate 행 수량(EstUnit) | — | 환산 무관 | **SAFE** |
| `pages/api/estimate/update-cost.js:200,260` (Estimate/ShipmentDetail U) | Cost/Amount/Vat **(수량 미기록)** | — | — | 수량 안 씀 | **SAFE (N/A)** |
| `pages/api/estimate/index.js:554` (Estimate I) | Quantity/Amount/Vat | body `quantity`(EstUnit 명시 저장) | — | 환산 무관 | **SAFE** |
| `pages/api/public/orders.js:308,326` (OrderDetail U/I) | Out/Est/Box/Bunch/Steam | `item.qty`+`item.unit`(기본 OutUnit) | 로컬 `toAllUnits`(올바름) | 정합(unit 인지) | **SAFE (헬퍼중복)** |
| `pages/api/public/shipments.js:295,325,349` (ShipmentDetail U/I) | Box/Bunch/Steam/Out/Est | `item.qty`+`item.unit` → OutUnit 환산 (unit 없으면 박스 폴백+경고) | `toOrderUnits`→`toShipmentUnits` | 정합(unit 인지) | **FIXED (2026-06-11)** |
| `pages/api/m/order-request-approve.js:152` (OrderDetail I) | Box/Bunch/Steam/Out/Est | `d.Quantity`+`d.Unit`(신청단위) | 인라인 `qty/bpb`(올바름) | 정합(unit 인지) | **SAFE** |
| `pages/api/shipment/estimate-period-repair.js:316,410` (ShipmentDetail U) | Out/Est/Box/Bunch/Steam | 기존 DB 값 SUM·비율 재산출(신규입력 없음) | — | 보정·복원 전용 | **SAFE (수리)** |

---

## 3. 경로별 상세

### 3.1 distribute.js — 분배 저장 (SAFE)
`distribute.js:542` `qty = parseFloat(outQty)` 는 분배 화면(박스 기준)에서 온 OutUnit 수량.
`distribute.js:551` `distributeUnits(qty, product)` 로 box/bunch/steam/estQty 산출 후 UPDATE(`:559`)/INSERT(`:582`).
박스 품목은 `box=out`, `bunch=out×B1B`(distributeUnits.js:27) — 정합. EstQuantity 는 강제 동기화 없이 `distributeUnits` 의 estQty(EstUnit 기준 ROUND). **규칙 준수.**

### 3.2 stock-status.js — PATCH(updateOutQty) + addOrder
- **PATCH (`:1067`~)**: `outQty`(body)를 박스 기준으로 받아 `toShipmentUnits→distributeUnits`(`:1212`). `units.outQty` 는 입력 그대로 echo(distributeUnits 가 outQty 를 환산하지 않음 — 박스↔박스). 분배화면과 동일 계약. **SAFE.**
- **addOrder (`:1373`~)**: `qty`+`unit`(body) → `toOrderUnits(quantity, orderUnit, productInfo)`(`:1396`). `orderUnit` 미지정 시 OutUnit 으로 폴백. 단 입력시 `bunch=qty, box=qty/B1B`(shipmentImportQty.js:54) → 정합. **OK-uses-helper.**

### 3.3 adjust.js — ⚠️ ShipmentDetail 경로 GAP
- **OrderDetail 경로 (SAFE)**: `orderQtyBefore = qtyForUnit(odRow, userUnit, ...)`(`:494`) — 기존값을 **userUnit 으로** 읽고 `delta`(userUnit)와 더한 뒤 로컬 `toAllUnits`(`:418`, 단→box `/B1B`)로 환산. 단위 일관 → 정합.
- **ShipmentDetail 경로 (GAP)**: `qtyBefore = sdRow.curOut`(`:646`, **OutUnit=박스 기준**) 에 `delta`(`:360` `parseFloat(qty)` = userUnit) 를 직접 더해 `qtyAfter`(`:647`) 생성 후 `toShipmentUnits(qtyAfter, B1B, S1B)`(`:650`, `box=qty` 박스 가정, `:165`).
  - 즉 **delta 를 OutUnit 으로 환산하지 않고** 박스 누적값에 그대로 가산. `userUnit==='박스'`(=OutUnit)면 무해하나, **`userUnit='단'` + OutUnit=박스 + B1B>1 이면 단 개수가 박스로 누적** → OutQuantity·BunchQuantity 모두 B1B 배 과대.
  - **도달 경로 (운영 가능)**: `pages/orders/paste.js:1704-1706` 일괄추가/취소, `:1862-1864` 분배조정 모달이 `unit: t.unit` / `adjustModal.unit` 로 전송. `paste.js:1384` 주석 "장미/네덜란드 → 단" 처럼 장미·카네이션은 `unit='단'`(OutUnit=박스, B1B>1) 으로 보낸다. type='ADD' 이고 기존 ShipmentDetail 없으면 `qtyAfter = 0 + 단수` 가 그대로 OutQuantity 가 되어 **직접 B1B 배 과대 저장**.
  - 단, `pages/shipment/week-pivot.js:615-618` 의 adjust 호출은 `unit` 미전송 → `userUnit=OutUnit` 이라 무해(이 경로는 안전).
  - OrderDetail 측은 같은 핸들러에서 올바르게 환산되므로 **주문수량은 정상, 출고수량만 과대**해지는 비대칭이 발생(잔량 마이너스 패턴 4 유발 가능).

### 3.4 shipmentImport.js — 엑셀 업로드 (OK-uses-helper)
적용 단계(`:1305`)에서 `normalizeUploadQtyForProduct(row, productInfo)` 로 셀값을 OutUnit 기준으로 환산(장미·카네이션 단→박스, 수국·알스트로 제외/16배). 그 값으로 `distributeUnits`(`:1307`) → ShipmentDetail(`:1393/1455`). OrderDetail sync(`syncOrderDetailForShipmentImport`)는 `desiredQty=row.uploadQty`(정규화됨)를 `toOrderUnits`(`:1048`)로 환산. 미리보기 단계에서 `detectQtyWarnings`+`appendPeerQtyWarnings`+`appendCustomerPeerQtyWarnings`(`:1258~1266`)로 10배·peer outlier 차단. **정합 + 다중 가드.** 주문→재분배 경로(`:1597`)는 기존 OrderDetail 의 canonical 값을 `distributeUnits` 로 풀어 씀 — 정합.

### 3.5 orders/index.js — 주문 등록 (SAFE, 헬퍼중복)
`item.qty`+`item.unit` → 로컬 `toAllUnits(qty, unit, prod)`(`:89`). `unit` 은 `item.unit` 없으면 OutUnit 폴백(`:369`). 단→box `qty/B1B`(`:99`), box→bunch `qty*B1B`(`:107`) — 공유 `toOrderUnits` 와 동일 로직의 **로컬 복제**. delta 모드(`:438`)도 환산 후 누적이라 단위 일관. OrderDetail 의 `EstQuantity=OutQuantity` 는 주문측 표준(견적 환산은 ShipmentDetail/usp_DistributeOne 단계). **정합.**

### 3.6 estimate/update-quantity.js — 견적 수량 차감 (SAFE, 헬퍼중복)
ShipmentDetail 경로: `oldQuantity` 를 **사용자 `unit` 으로** 읽고(`:165`) `toAllUnits(quantity, unit, row)`(`:30`,`:179`)로 환산. EstQuantity 는 `amountBase`(bunch>steam>box, `:195`)로 OutQuantity 와 다를 수 있음 — **규칙 준수**(강제 동기화 아님). `getUnitsPerBox` 의 `|| 10` 하드코딩 폴백(`:25`)은 B1B 누락 품목 한정이라 본 위험과 무관. **정합.**

### 3.7 estimate/update-cost.js — 단가만 (SAFE, N/A)
ShipmentDetail/Estimate 모두 Cost/Amount/Vat 만 UPDATE, **수량 필드 미기록**(`:260,:184`). 금액 기준수량은 기존 Bunch>Steam>Box(`:250`) 사용 — 읽기만. 10배 위험 없음.

### 3.8 public/orders.js (SAFE, 헬퍼중복) / public/shipments.js (⚠️ NEEDS-REVIEW)
- **public/orders.js**: 로컬 `toAllUnits`(`:38`, orders/index.js 와 동일) + `unit` OutUnit 폴백(`:298`). 정합.
- **public/shipments.js**: `toShipmentUnits(qty, productInfo)`(`:38`)가 `qty` 를 **무조건 박스로 간주**(`box=qty, bunch=qty*b1b`), `item.unit` 을 읽지 않음. 외부 호출자가 OutUnit=박스 품목에 **단 수량**을 보내면 미환산 저장 → B1B 배 과대. 임포트 경로 같은 peer/warning 가드도 없음. 외부 API 계약상 "박스 기준" 전제이나, 명시 unit 파라미터·검증 부재로 **NEEDS-REVIEW**.

### 3.9 m/order-request-approve.js — 승인 (SAFE)
`d.Unit`(신청 단위) 기준 인라인 환산: 단이면 `boxQ=qty/d.bpb`(`:137`), 박스면 `boxQ=qty`(`:141`), `bunchQ=boxQ*bpb`(`:143`). `ISNULL(BunchOf1Box,1)` 폴백. OutUnit 단일값(`:146`). **정합** (인라인이나 unit 인지·올바름).

### 3.10 estimate-period-repair.js — 보정/병합 (SAFE)
중복 ShipmentDetail 병합 시 기존 행들의 `SUM(OutQuantity/Box/Bunch/Steam)`(`:248~252`)을 keep 행에 기록(`:316`) — **기존 canonical 값 보존**, 신규 입력 환산 없음. EstQuantity 비율 보정(`:157,:410`)은 정상 차수 `AVG(Est/Out)` 비율로 OutQuantity×Ratio 재산출 — 오히려 **단×N 과대 Est 를 복원하는 수리 도구**. CLAUDE.md 의 syncEstQty 금지와 달리 비율 기반 보정이라 환산품목 정상 Est 는 자동 제외. 10배 유발 없음.

---

## 4. 갭 / 위험 요약 (10배 위험 우선)

| 우선 | 경로 | 조건 | 영향 | 비고 |
|---|---|---|---|---|
| ~~**1 (HIGH)**~~ **FIXED** | `adjust.js` ShipmentDetail | `unit='단'` + OutUnit=박스 + B1B>1 (paste.js 일괄추가/조정에서 도달) | (수정 전) `delta`(단)가 박스로 누적 → OutQuantity·BunchQuantity B1B 배 과대 | **2026-06-11 수정** — `computeShipmentAdjustUnits` 로 delta 를 OutUnit 환산 후 누적. 7장 참조 |
| ~~**2 (MED)**~~ **FIXED** | `public/shipments.js` ShipmentDetail | 외부 호출자가 박스 품목(B1B>1)에 단 수량 전송 | (수정 전) 미환산 박스 저장 → B1B 배 과대 | **2026-06-11 수정** — `item.unit` 환산 + unit 미지정 경고. 7장 참조 |

그 외 모든 경로는 SAFE 또는 OK-uses-helper. 핵심 UI 경로(distribute / stock-status PATCH / 엑셀 import)는 공유 헬퍼(`distributeUnits`/`normalizeUploadQtyForProduct`)와 다중 10배 가드로 **정합**.

### 정상(오탐 아님) 확인
- 카네이션·수국·루스커스 박스 품목의 `EstQuantity` 가 15/25/30 등으로 OutQuantity 와 다른 것은 **정상**(EstUnit 기준). 어떤 경로도 `EstQuantity=OutQuantity` 강제 동기화하지 않음(distribute/stock-status/import 는 estQty 헬퍼값, update-quantity 는 amountBase).
- 수국(hydrangea)은 `isBunchAllocationImportRow`(shipmentImportQty.js:33)에서 제외 → 단→박스 자동환산 미적용. 준수 확인.
- OrderDetail 의 `EstQuantity=OutQuantity` 는 주문측 표준이며 ShipmentDetail 규칙과 별개.

---

## 5. 권고 (제안만 — 적용 금지, READ-ONLY)

> 아래는 갭 식별에 따른 제안이며 본 감사에서 **구현하지 않았다.** "DB가 정답, 웹이 맞춘다" / ShipmentDetail OutQuantity 단일값 / EstQuantity 비강제 / 13·14차 검증 공식 유지 원칙을 위반하지 않는 범위.

1. **adjust.js ShipmentDetail delta 환산 (우선 1)**
   - 현재 OrderDetail 측은 `delta`(userUnit)를 올바르게 처리하나 ShipmentDetail 측은 `curOut`(박스)에 `delta`(userUnit)를 직접 가산.
   - 제안: ShipmentDetail 누적 전에 `delta` 를 OutUnit 기준으로 환산(예: 이미 존재하는 로컬 `toAllUnits(delta).outQ` 를 써서 `qtyAfter = curOut + toAllUnits(delta).outQ`). OrderDetail 측과 동일 단위 기준으로 통일.
   - 또는 `lib/shipmentImportQty.js` 의 `toOrderUnits(delta, userUnit, product).outQty` 공유 헬퍼 사용으로 로컬 분기 제거.

2. **public/shipments.js 단위 환산 가드 (우선 2)**
   - `item.unit` 을 받아 `normalizeUploadQtyForProduct`(또는 `toOrderUnits(qty, unit, product).outQty`)로 OutUnit 기준 환산 후 `toShipmentUnits` 입력. unit 미지정 시 OutUnit(박스) 전제는 유지하되, B1B>1 박스 품목에 단 수량 의심시 `detectQtyWarnings`/`detectStoredBunchAsBox` 경고를 응답에 포함 권장.

3. **로컬 `toAllUnits` 4중 복제 통합 (정합성 보강, 비기능)**
   - 동일 환산 로직이 `orders/index.js:89`, `public/orders.js:38`, `estimate/update-quantity.js:30`, `shipment/adjust.js:418` 에 복제됨. `lib/shipmentImportQty.js` 의 `toOrderUnits` 단일 소스로 통합하면 향후 환산 규칙 변경시 누락 방지(현재 로직은 모두 동일·정상이므로 긴급도 낮음).

---

## 6. 참조 파일 목록

### 쓰기 경로 (분석 대상)
- `pages/api/shipment/distribute.js`
- `pages/api/shipment/stock-status.js`
- `pages/api/shipment/adjust.js` ⚠️
- `lib/shipmentImport.js`
- `pages/api/orders/index.js`
- `pages/api/estimate/update-quantity.js`
- `pages/api/estimate/update-cost.js`
- `pages/api/estimate/index.js`
- `pages/api/public/orders.js`
- `pages/api/public/shipments.js` ⚠️
- `pages/api/m/order-request-approve.js`
- `pages/api/shipment/estimate-period-repair.js`

### 공유 헬퍼 (정답 기준)
- `lib/distributeUnits.js`
- `lib/shipmentImportQty.js`
- `lib/unitMismatchAudit.js`
- `lib/orderUtils.js` (`normalizeOrderUnit`)

### 호출자 (도달 경로 검증)
- `pages/orders/paste.js` (adjust.js 단위 전송 — GAP 도달)
- `pages/shipment/week-pivot.js` (adjust.js 단위 미전송 — 안전)

### 도메인 규칙 / 선행 감사
- `CLAUDE.md`, `.claude/CLAUDE.md`
- `docs/ERP_WRITE_CONFLICT_AUDIT_2026-06-02.md`
- `docs/PAGE_DATA_INPUT_DB_PARITY_AUDIT_2026-05-26.md`

---

## 7. 수정 반영 (2026-06-11) — 갭 1·2 FIX

> 본 문서 1~6장은 2026-06-10 READ-ONLY 감사다. 아래는 그 갭 식별에 따라 2026-06-11 적용한 수정 기록이다.
> 원칙 준수: ShipmentDetail OutQuantity 단일값 / EstQuantity 비강제(단·송이 금액기준 유지) / 공유 헬퍼 재사용 / 검증 공식 유지.

### 7.1 우선1 — `adjust.js` ShipmentDetail delta 환산 (FIXED)
- **신규 순수 모듈** `lib/adjustUnits.js`:
  - `computeShipmentAdjustUnits({curOut, delta, type, unit, outUnit, bunchOf1Box, steamOf1Box})` — `delta`(userUnit)를 공유 `toOrderUnits(...).outQty` 로 **OutUnit 기준 환산**(`deltaOut`) 후 `curOut`(OutUnit)에 가/감산. `toShipmentUnits`·`estimateQuantityFromShipmentUnits` 도 이 모듈로 이전(adjust.js 로컬 중복 제거).
- **`adjust.js`**: ShipmentDetail 누적부를 `const adj = computeShipmentAdjustUnits(...)` 로 교체. OrderDetail 경로(로컬 `toAllUnits`)는 무수정.
- **효과**: 장미(OutUnit=박스, B1B=10) `unit='단'` 일괄추가/조정에서 `10단 ADD → OutQuantity +1박스`(기존 +10). `userUnit==OutUnit`(박스, week-pivot 등)이면 `deltaOut==delta` 로 **무해 no-op** → 회귀 없음.
- **테스트** `__tests__/adjustUnit.test.js` (`npm run test:adjust-unit`): 단/박스/송이 입력, 누적, 카네이션 B1B=15, CANCEL, CANCEL 초과 음수 — 전건 통과.

### 7.2 우선2 — `public/shipments.js` 단위 환산 가드 (FIXED)
- 품목 조회에 `p.OutUnit` 추가. `item.unit`(또는 `item.outUnit`) 있으면 `toOrderUnits(qty, unit, productInfo).outQty` 로 **OutUnit 환산** 후 `toShipmentUnits` 입력.
- `unit` 미지정 시 외부 API 계약대로 **박스(OutUnit) 전제 유지(회귀 방지)** 하되, OutUnit=박스·B1B>1 품목이면 응답 `results[].warning` + 최상위 `warnings[]` 로 "단 수량 의심" 경고를 포함.
- 응답 `results[].unit`·`outQty` 추가로 호출자가 환산 결과를 확인 가능.

### 7.3 검증
- `npm run test:adjust-unit` / `npm run test:import-qty` / `npm run test:repair-unit` 전건 통과, `npm run build` 성공.
- DB·repair/probe 스크립트 무수정. git commit/push 미실행(에디터에서 사용자가 검토 후 진행).
</content>
</invoke>
