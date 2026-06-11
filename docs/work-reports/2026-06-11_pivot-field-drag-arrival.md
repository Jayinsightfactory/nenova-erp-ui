# Pivot 필드 드래그 + 도착원가 — 완료 보고

> 작업일: 2026-06-11 (작성 2026-06-12) · 브랜치 master (미커밋) · 커밋/푸시 보류
> 2단계 분업: **Phase 1 데이터층**(freight-pipeline-engineer) → **Phase 2 UI**(Claude)

---

## 1. 개요

exe 「업체별 품목 통계」(DevExpress PivotGrid)와 정합을 맞추기 위해

1. **도착원가**(`/freight` 운송기준원가 `displayArrivalKRW`)를 pivot row 에 추가하고,
2. 모든 필드를 **행/열/필터/값** 4영역으로 **드래그**하는 Field List UI 를 구현했다.

기존 compact/detail 뷰·물량표 export·즐겨찾기·Filter Editor 는 **그대로 유지**(하위호환), 신규 기능은 additive.

---

## 2. Phase 1 — 데이터층 (freight-pipeline-engineer)

> 산출물: `lib/pivotFreightArrival.js`, `lib/pivotStats.js`(rows[].arrivalCost), `scripts/probe-pivot-arrival.js`, `__tests__/pivotFreightArrival.test.js`, `docs/PIVOT_DATA_SPEC_CODEX.md §7`

**데이터 계약 (UI 소비 기준):**

- `rows[].arrivalCost: number` — `/freight` 탭과 **동일 숫자**(`displayArrivalKRW`, `Product.OutUnit` 표시단위 당 도착원가). 운송 데이터 없으면 `0`.
- 산출: 차수 범위 `WarehouseMaster` → FreightCostDetail 스냅샷 우선, 없으면 라이브 `computeFreightCost` (freight/index.js `loadFreightData` 로직 재사용).
- 다중 AWB/농장 동일 ProdKey → **입고수량(inQty) 가중평균**.
- **단위 함정:** 콜롬비아 등 박스 표시단위는 스냅샷에 박스당 컬럼이 없어 → 라이브 계산으로 폴백(=freight 탭과 동일).

*(상세 산식·SQL·소스선택 규칙은 `docs/PIVOT_DATA_SPEC_CODEX.md §7` 및 Phase 1 보고 참조.)*

---

## 3. Phase 2 — UI 필드 드래그 (Claude)

### 3.1 신규 파일 `lib/pivotFieldRegistry.js`
- `PIVOT_FIELDS` 16개 필드 메타 선언 — 국가/꽃/품목명(색상)/지역/출고일/입고단가/입고총단가/AWB/비고(행), 거래처명/농장명/구분(열), 수량/판매단가/분배단가/도착원가/판매금액(값).
- `ZONES`(행/열/필터/값), `DEFAULT_LAYOUT`, `FIELD_BY_ID`, `canDropInZone()`.
- DB/번들러 의존 없는 순수 모듈.

### 3.2 `pages/stats/pivot.js` 리팩터 (수술식 diff)
- **Field List 패널** (🗂 필드 목록 토글): HTML5 DnD 4 드롭존(행/열/필터/값) + "사용 가능" 트레이. 칩을 영역으로 드래그 → 기존 state(`showXxx`/`viewMode`/`showSections`)를 구동. 고정 필드(국가/꽃/품목명/구분)는 제거 불가.
  - **설계 원칙:** pivot 엔진을 재작성하지 않고, Field List 가 **기존 검증된 토글 state 의 표현/제어 레이어**로 동작 → compact/detail·export·즐겨찾기 무손상.
- **필터 영역**: 데이터키 있는 차원 필드 드롭 → 값 체크 드롭다운(전체/해제) → `fieldFilters` 로 `filteredRows` AND 필터. 하단바에 칩 + 제거.
- **도착원가 측정 필드**: `showArrival` 토글 → 좌측 고정열(입고총단가 뒤)에 `r.arrivalCost`(=freight) 표시. 버튼바·export·즐겨찾기·totalFixedCols 반영.
- **단가 = 판매단가(saleCost) + 분배단가(distCost)** 각각 값 영역 드래그 가능 (기존 `showCost`/`showDistCost` 매핑).
- **하단 통합 요약바**: `[구분] In [02.주문, 03.입고] And [국가] = [콜롬비아]` 형식 — `showSections` + `fieldFilters` + `filterConditions` 통합 표시.
- **localStorage `pivotFieldLayout`**: 필터영역 배치 + 값 체크 + 패널 열림 상태 저장/복원.

### 3.3 `package.json`
- `test:pivot-freight` → `node __tests__/pivotFreightArrival.test.js`
- `probe:pivot-arrival` → `node scripts/probe-pivot-arrival.js`

---

## 4. exe vs web 필드 드래그 차이표

| 기능 | exe (DevExpress PivotGrid) | web (구현 후) |
|------|----------------------------|----------------|
| 필드 드래그 영역 | Row / Column / Filter / Data 4영역 | **행/열/필터/값 4영역** Field List (HTML5 DnD) ✅ |
| 필드 목록 | 별도 Field List 창 | 🗂 필드 목록 패널 (토글) ✅ |
| 필터 영역 값 선택 | Prefilter + 필드 체크 | 필터존 칩 → 값 체크 드롭다운 + 하단 요약 ✅ |
| 측정값(Data) | 합계/단가 자유 배치 | 수량·판매단가·분배단가·도착원가·판매금액 ✅ |
| 도착원가 | 운송원가 연동(추정) | `/freight` `displayArrivalKRW` 동치 ✅ |
| 행/열 임의 재피벗 | 완전 자유 | 검증된 계층(국가>꽃>품목 / 거래처·농장) 유지 — 의도적 제한(회귀 방지) ⚠️ |
| 레이아웃 영속 | 사용자 프로필 | localStorage `pivotFieldLayout` + 즐겨찾기 ✅ |

> **의도적 차이:** 행/열의 임의 재피벗(예: 거래처를 행으로)은 13/14차 검증된 집계 shape 를 깨뜨릴 위험이 커서 구현하지 않음. Field List 는 기존 토글을 드래그 UX 로 노출하는 데 집중.

---

## 5. 검증

```
node __tests__/freightCalc.test.js   → 238 passed, 0 failed  (freightCalc 무변경 확인 — zero diff)
npm run test:pivot                   → all passed
npm run test:pivot-freight           → all passed (17 cases)
npm run test:import-qty              → all passed
npm run build                        → ✓ Compiled successfully (/stats/pivot 포함)
                                       (잔여 warning 1건 = next.config.js NFT trace, 본 작업과 무관·기존)
```

`git diff --stat` (미커밋):
```
 lib/pivotStats.js     |  42 ++  (arrivalCost/arrivalMeta additive — Phase 1)
 package.json          |   3 ++  (test:pivot-freight, probe:pivot-arrival)
 pages/stats/pivot.js  | 443 ++  (Field List 패널·도착원가열·통합 필터바)
신규: lib/pivotFieldRegistry.js, lib/pivotFreightArrival.js, lib/pivotArrivalCalc.js,
      __tests__/pivotFreightArrival.test.js, scripts/probe-pivot-arrival.js
```

### 데이터 계약 보강 (Phase 1 → Phase 2 반영)
- `rows[].arrivalMeta.displayUnit` ('박스'|'단'|'송이') 로 도착원가 셀 툴팁에 단위 표기 — **송이당 일괄 표기 금지**(박스 품목 오표시 방지).
- `arrivalCost = 0` 은 운송 데이터 없음 → 빈칸 표시(`fN(0)=''`), ₩0 아님.
- 스냅샷/라이브 소스는 `arrivalMeta.source` 툴팁 노출.

---

## 6. 미결 / 후속

- 도착원가 ±0.01 parity: `npm run probe:pivot-arrival` (24-02 샘플 3건) 운영 DB 에서 확인 필요.
- 행/열 임의 재피벗은 별도 검토(요청 시).
