# Pivot 필드 드래그 + 도착원가 — 이해·설계 (2026-06-11)

## 사용자 요구 (확인)

1. **모든 필드 버튼**을 exe처럼 **드래그** 가능 (행/열/필터 영역)
2. **필터** — 필드별 체크 활성/비활성, 조건 추가·제거
3. **단가** — 드래그 가능 필드에 포함 (판매단가·분배단가 구분 유지)
4. **도착원가** — `/freight` 운송기준원가 화면과 **동일 산식·동일 값** (`displayArrivalKRW` 또는 UI와 동일한 도착원가/단·/송이)

---

## dnSpy / exe 문자열 확인 (Cursor 직접)

| 항목 | 확인 결과 |
|------|-----------|
| exe 경로 | `C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe` ✅ 존재 |
| 메뉴 | `bbtnQuantityPivot` → **「업체별 품목 통계」** (= 웹 Pivot 통계) |
| 컨트롤 | DevExpress **PivotGrid** (`pivotGridField*`, `pgrd*`) — 다른 통계 폼에서 확인 |
| 동작 | 필드를 Row / Column / Filter / Data 영역으로 **드래그** — DevExpress 표준 (웹은 자체 구현 필요) |

한글 필드명(02.주문 등)은 exe 바이너리 UTF-16 풀에서 직접 추출되지 않음 → **리소스/런타임 바인딩** 추정. 웹 `pages/stats/pivot.js` 주석·스크린샷·기존 토글 버튼 목록을 exe 필드 목록으로 사용.

---

## exe vs web 갭 (구현 전)

| 기능 | exe (DevExpress) | web (현재) |
|------|------------------|------------|
| 필드 드래그 | Row/Col/Filter/Data 4영역 | 그룹순서(지역/비고/거래처)만 드래그 |
| 필터 | PivotGrid Prefilter + 필드 필터 | ColHeader ▼ + Filter Editor |
| 도착원가 | (확인 필요 — 운송원가 연동 추정) | **없음** |
| 분배단가 | — | `distCostOrders` (ShipmentDetail.Cost) ✅ |
| 판매단가 | — | `costOrders` (CustomerProdCost) ✅ |

---

## 도착원가 데이터 소스 (운송기준원가 = `/freight`)

**진리(source of truth):** `lib/freightCalc.js` → `computeFreightCost()` 결과

| UI 컬럼 (`pages/freight.js`) | 계산 필드 | 의미 |
|------------------------------|-----------|------|
| 도착원가/송이 | `arrivalPerStem` (M) | KRW/송이 |
| 도착원가/단 | `arrivalPerBunch` (O) | KRW/단 (= M × N) |
| (display) | `displayArrivalKRW` | **Product.OutUnit displayUnit 당** — 엑셀/UI 표시와 동일 |

**DB 경로 (우선순위):**

1. **FreightCostDetail** 스냅샷 (`ArrivalPerStem`, `ArrivalPerBunch`) — 운송기준원가 탭에서 저장한 값
2. 없으면 **라이브** `computeFreightCost()` — `/api/freight?warehouseKey=` 와 동일 로직 (`pages/api/freight/index.js` `loadFreightData`)

**Pivot 조인 키:**

- 차수: `WarehouseMaster.OrderYear + OrderWeek` ↔ pivot `weekStart~weekEnd`
- 품목: `ProdKey`
- 다중 AWB/농장: 동일 ProdKey 다행 → **입고수량 가중평균** displayArrivalKRW (분배단가와 동일 패턴)

**금지:** Product.Cost / 입고단가(inPrice)를 도착원가로 대체하지 말 것.

---

## 에이전트 팀 구성

| 순서 | Agent / AI | 담당 |
|------|------------|------|
| 1 | **Codex** | `lib/pivotFreightArrival.js` SQL+조인+가중평균 spec, FreightCostDetail vs live fallback |
| 2 | **freight-pipeline-engineer** (Claude) | 도착원가 집계 구현, `freightCalc.test.js` 회귀 없음 |
| 3 | **Claude** | `lib/pivotFieldRegistry.js` + `pages/stats/pivot.js` DevExpress형 4영역 드래그·필터 |
| 4 | **Cursor** | test/build, work-report |

---

## 필드 레지스트리 (드래그 대상 — 전부)

| id | 라벨 | 데이터 키 | 영역 기본 |
|----|------|-----------|-----------|
| country | 국가 | country | row |
| flower | 꽃 | flower | row |
| prodName | 품목명(색상) | prodName | row |
| area | 지역 | area | row/filter |
| outDate | 출고일 | outDate | row |
| inPrice | 입고단가 | inPrice | row |
| inTotal | 입고총단가 | inTotal | row |
| awb | AWB | awb | row |
| descr | 비고 | descr | row/filter |
| custName | 거래처명 | (orders keys) | column |
| farmName | 농장명 | (incoming keys) | column |
| section | 구분 | showSections | column |
| qty | 수량 | totalOrder/incoming | data |
| saleCost | 판매단가 | costOrders | data |
| distCost | 분배단가 | distCostOrders | data |
| **arrivalCost** | **도착원가** | **arrivalCost** | data |

---

## 수용 기준

- [ ] 모든 필드 버튼 draggable → row/col/filter drop zone
- [ ] filter zone 필드: 값 체크박스 + 하단 `[필드] In [...] And ...` 표시
- [ ] 도착원가 = freight 탭 `displayArrivalKRW` (±0.01) 샘플 1차수 검증 스크립트
- [ ] compact/detail 뷰 + 기존 물량표 API 하위호환
- [ ] `npm run test:pivot` + `npm run test:import-qty` + build pass
